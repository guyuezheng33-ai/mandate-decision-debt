'use strict';

/**
 * 第二、三条入口（Rovo action / MCP tool）的断言。
 * 面板那条入口有 panel harness 可看，这两条只能靠断言证明"它真的接上了"。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const handlers = require('../src/agent/handlers');
const { hydrateBundle, missingMeta } = require('../src/ports/hydrate');
const { mapColumns, mapRows, createGraphClient } = require('../src/ports/graph.client');

test('action 的入参从 payload 与 context 两处取，identity 只认 context.accountId', () => {
  const inputs = handlers.toInputs({ issueKey: 'KAN-3', accountId: 'forged' }, { accountId: 'real', jira: { issueKey: 'KAN-3', projectKey: 'KAN' } });
  assert.equal(inputs.issueKey, 'KAN-3');
  assert.equal(inputs.projectKey, 'KAN');
  assert.equal(inputs.userId, 'real');
});

test('payload 没给 issueKey 时，从 Jira 上下文补', () => {
  const inputs = handlers.toInputs({}, { jira: { issueKey: 'KAN-7', projectKey: 'KAN' }, locale: 'zh-CN' });
  assert.equal(inputs.issueKey, 'KAN-7');
  assert.equal(inputs.lang, 'zh');
});

test('MCP 调用 getIssueProvenance 能跑通并返回可读结果（注入 jira client）', async () => {
  const context = {
    accountId: 'u1',
    scopes: ['read:jira-work'],
    jira: {
      getIssue: async () => ({
        key: 'KAN-3',
        fields: {
          summary: 'One-click archive',
          status: { name: 'In Review', statusCategory: { key: 'indeterminate' } },
          created: '2026-06-01',
          statuscategorychangedate: '2026-06-20',
          project: { key: 'KAN' },
        },
      }),
      getIssueLinks: async () => [{ globalId: 'p1', object: { title: 'Decision record', url: 'https://x.atlassian.net/wiki/spaces/A/pages/1' } }],
    },
  };
  const r = await handlers.getIssueProvenance({ issueKey: 'KAN-3' }, context);
  assert.equal(r.ok, true);
  assert.equal(r.issueKey, 'KAN-3');
  // NO SCORE（grade unknown）发布 null；其余情况 debt 是数字下界。
  if (r.grade === 'unknown') assert.equal(r.debt, null);
  else assert.equal(typeof r.debt, 'number');
  assert.equal(r.source, 'rest');
  assert.ok(r.degraded === null || typeof r.degraded === 'object');
});

test('MCP 在没有任何 client 时返回结构化错误，而不是抛异常', async () => {
  const r = await handlers.getIssueProvenance({ issueKey: 'KAN-3' }, { accountId: 'u1', scopes: [] });
  assert.equal(r.ok, false);
  assert.ok(typeof r.code === 'string' && r.code.startsWith('E_'));
  assert.ok(r.hint.length > 0);
});

test('stampMandate 在只读安装下返回 E_WRITE_DENIED', async () => {
  const r = await handlers.stampMandate({ issueKey: 'KAN-3' }, { accountId: 'u1', scopes: ['read:jira-work'] });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_WRITE_DENIED');
});

// ---- 补水 ----

test('补水只补空字段，且不改动已经拿到的值', async () => {
  const bundle = { issueKey: 'KAN-3', summary: null, status: null, inProgressSince: null, edges: {} };
  const jira = {
    getIssue: async () => ({
      key: 'KAN-3',
      fields: { summary: 'One-click archive', status: { name: 'In Review' }, statuscategorychangedate: '2026-06-20', created: '2026-06-01' },
    }),
  };
  const h = await hydrateBundle(bundle, jira);
  assert.equal(h.summary, 'One-click archive');
  assert.equal(h.status, 'In Review');
  assert.equal(h.inProgressSince, '2026-06-20');
  assert.deepEqual(h.metaGaps.sort(), ['asOf', 'inProgressSince', 'status', 'summary']);
  // 补水回来的 fields 里没有 updated，所以 asOf 仍然是空：这一条不许被硬填成"今天"。
  assert.equal(h.asOf, null);
});

test('字段齐全时不发多余请求', async () => {
  let calls = 0;
  const jira = { getIssue: async () => { calls += 1; return {}; } };
  const bundle = { issueKey: 'KAN-3', summary: 's', status: 'In Review', inProgressSince: '2026-06-20', asOf: '2026-11-18', edges: {} };
  const h = await hydrateBundle(bundle, jira);
  assert.equal(calls, 0);
  assert.equal(h.summary, 's');
  assert.equal(missingMeta(bundle).length, 0);
});

test('只缺观测时间也会补一次水（asOf 是 P2 的必要条件，不能默认成今天）', async () => {
  let calls = 0;
  const jira = {
    getIssue: async () => { calls += 1; return { fields: { updated: '2026-11-18T17:53:00.000+0000' } }; },
  };
  const bundle = { issueKey: 'KAN-3', summary: 's', status: 'In Review', inProgressSince: '2026-06-20', edges: {} };
  const h = await hydrateBundle(bundle, jira);
  assert.equal(calls, 1);
  assert.equal(h.asOf, '2026-11-18T17:53:00.000+0000');
  assert.deepEqual(missingMeta(bundle), ['asOf']);
});

test('补水失败不污染分数，只留一个可披露的缺口', async () => {
  const jira = { getIssue: async () => { throw Object.assign(new Error('nope'), { code: 'E_TIMEOUT' }); } };
  const bundle = { issueKey: 'KAN-3', summary: null, status: null, inProgressSince: null, edges: {} };
  const h = await hydrateBundle(bundle, jira);
  assert.equal(h.summary, null);
  assert.equal(h.metaError, 'E_PARTIAL');
  assert.ok(h.metaGaps.length > 0);
});

test('prompt 有项目级的"不出分"与"下界"两种说法，不许只给一个平均分', () => {
  const prompt = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'agent', 'prompt.md'), 'utf8');
  assert.match(prompt, /NO SCORE/, '缺"不出分"模板，agent 会把 null 念成 0');
  assert.match(prompt, /certainty/, '缺"下界"模板，agent 会把 16† 念成完整结论');
  assert.match(prompt, /lower bound/, '英文说法要对得上界面上的 †');
});

// ---- 图的映射 ----

test('customQuery 的 columns 映射成端口形状，陌生列被忽略', () => {
  const payload = {
    data: {
      customQuery: {
        edges: [
          {
            node: {
              columns: [
                { key: 'decisions', value: { __typename: 'CypherQueryResultListNode', nodes: [{ id: 'ari:page/1', data: { __typename: 'ConfluencePage', title: 'Decision record', webUrl: 'https://x/wiki/1' } }] } },
                { key: 'goals', value: { __typename: 'CypherQueryResultListNode', nodes: [{ id: 'ari:goal/1', data: { __typename: 'Goal', title: null } }] } },
                { key: 'contributors', value: { __typename: 'CypherQueryResultListNode', nodes: [{ id: 'ari:user/1', data: { __typename: 'AtlassianUser', displayName: 'Ada' } }] } },
                { key: 'somethingElse', value: { __typename: 'CypherQueryResultListNode', nodes: [{ id: 'x', data: {} }] } },
              ],
            },
          },
        ],
      },
    },
  };
  const m = mapColumns(payload);
  assert.equal(m.decisions.length, 1);
  assert.equal(m.decisions[0].title, 'Decision record');
  assert.equal(m.decisions[0].url, 'https://x/wiki/1');
  assert.equal(m.goals.length, 1);
  assert.equal(m.reviewTraces.length, 1);
  assert.equal(m.reviewTraces[0].title, 'Ada');
  assert.equal(Object.keys(m).includes('somethingElse'), false);
});

test('scan 的每一行是一条工作项，不是一个依据页', () => {
  const listNode = (items) => ({
    __typename: 'CypherQueryResultListNode',
    nodes: items,
  });
  const payload = {
    data: {
      customQuery: {
        edges: [
          {
            node: {
              columns: [
                { key: 'issue', value: listNode([{ id: 'ari:issue/KAN-3', data: { __typename: 'JiraIssue', title: 'KAN-3' } }]) },
                { key: 'decisions', value: listNode([{ id: 'ari:page/1', data: { __typename: 'ConfluencePage', title: 'Decision record', webUrl: 'https://x/wiki/1' } }]) },
                { key: 'goals', value: null },
                { key: 'reviewTraces', value: listNode([{ id: 'ari:user/1', data: { __typename: 'AtlassianUser', displayName: 'Ada' } }]) },
              ],
            },
          },
          {
            node: {
              columns: [
                { key: 'issue', value: listNode([{ id: 'ari:issue/KAN-9', data: { __typename: 'JiraIssue', title: 'KAN-9' } }]) },
                { key: 'decisions', value: listNode([]) },
                { key: 'goals', value: listNode([]) },
                { key: 'reviewTraces', value: listNode([]) },
              ],
            },
          },
        ],
      },
    },
  };
  const rows = mapRows(payload);
  assert.equal(rows.length, 2, '两行必须是两条工作项');
  assert.equal(rows[0].issue.key, 'ari:issue/KAN-3');
  assert.equal(rows[0].decisions.state, 'present');
  // 列没回来 = 我们不知道；列回来但为空 = 确认没有。这两件事分数上必须分开。
  assert.equal(rows[0].goals.state, 'unknown');
  assert.equal(rows[1].decisions.state, 'absent');
  assert.equal(rows[1].goals.state, 'absent');
});

test('graph 客户端把 scan 结果按行交给端口，边不再被清空', async () => {
  const listNode = (items) => ({ __typename: 'CypherQueryResultListNode', nodes: items });
  const payload = {
    data: {
      customQuery: {
        edges: [
          {
            node: {
              columns: [
                { key: 'issue', value: listNode([{ id: 'ari:issue/S-1', data: { __typename: 'JiraIssue', title: 'S-1' } }]) },
                { key: 'decisions', value: listNode([{ id: 'ari:page/1', data: { __typename: 'ConfluencePage', title: 'Policy', webUrl: 'https://x/wiki/1' } }]) },
                { key: 'goals', value: listNode([]) },
                { key: 'reviewTraces', value: listNode([]) },
              ],
            },
          },
        ],
      },
    },
  };
  const api = { asUser: () => ({ requestTeamworkGraph: async () => payload }) };
  const graph = createGraphClient({ bundleKey: 'b', scanKey: 's', api });
  const out = await graph.query({ type: 'provenance.scan', projectKey: 'S', limit: 5 });
  assert.equal(out.issues.length, 1);
  assert.equal(out.issues[0].decisions.state, 'present');
  assert.equal(out.issues[0].decisions.items.length, 1);
});

test('没有注册查询时，图客户端判定自己不可用并不发请求', async () => {
  const graph = createGraphClient({ bundleKey: null });
  assert.equal(graph.available, false);
  await assert.rejects(graph.query({ type: 'provenance.bundle', issueKey: 'KAN-3' }), /not registered/);
});

test('拿到 key 后按 customQuery 发一次请求，且失败映射成 E_SCOPE', async () => {
  let calls = 0;
  const api = {
    asUser: () => ({
      requestTeamworkGraph: async () => {
        calls += 1;
        return { errors: [{ message: 'scope read:graph:page:confluence missing' }] };
      },
    }),
  };
  const graph = createGraphClient({ bundleKey: 'qk-1', api });
  assert.equal(graph.available, true);
  await assert.rejects(graph.query({ type: 'provenance.bundle', issueKey: 'KAN-3' }), /scope/);
  assert.equal(calls, 1);
});
