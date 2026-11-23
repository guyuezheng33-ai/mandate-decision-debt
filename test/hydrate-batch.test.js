'use strict';

/**
 * 项目页批量补水：一页 50 条只能打一次 Jira，不能退化成 N 次 GET。
 *
 * 这组的价值不在"能补上字段"，而在**不许 N+1**：
 * 一旦有人把 listBundles 改回逐条 hydrateBundle，第 1 条断言就会红。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { hydrateBundles } = require('../src/ports/hydrate');
const { createJiraClient } = require('../src/ports/jira.client');

function rows(n = 5) {
  // 引擎 bundle 的真实形状是 issueKey（normalize 之后就叫这个），
  // 用 key 写测试会让"补水整页静默不生效"这种 bug 躲过去。
  return Array.from({ length: n }, (_, i) => ({
    issueKey: `DEL-${101 + i}`,
    summary: null,
    status: null,
    inProgressSince: null,
    asOf: null,
    edges: {},
  }));
}

const fakeJira = (impl) => {
  const calls = { batch: 0, single: 0, keys: [] };
  return {
    calls,
    getIssue: async () => {
      calls.single += 1;
      return { fields: {} };
    },
    getIssues: async (keys) => {
      calls.batch += 1;
      calls.keys = keys;
      return impl(keys);
    },
  };
};

const fields = (upd) => ({
  summary: 's',
  status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
  created: '2026-05-01T00:00:00.000+0000',
  updated: upd,
  statuscategorychangedate: '2026-06-18T00:00:00.000+0000',
});

test('批量补水：5 条只打 1 次 Jira，逐条接口一次都不许被调', async () => {
  const list = rows(5);
  const jira = fakeJira((keys) => keys.map((key) => ({ key, fields: fields('2026-11-18T00:00:00.000+0000') })));
  await hydrateBundles(list, jira);
  assert.equal(jira.calls.batch, 1);
  assert.equal(jira.calls.single, 0);
  for (const b of list) {
    assert.equal(b.status, 'In Progress');
    assert.equal(b.inProgressSince, '2026-06-18T00:00:00.000+0000');
    assert.equal(b.asOf, '2026-11-18T00:00:00.000+0000');
    assert.deepEqual(b.metaGaps, []);
  }
});

test('批量补水：不覆盖图已经给出的值（图优先，REST 只填洞）', async () => {
  const list = rows(2);
  list[0].status = 'Done';
  list[0].summary = 'graph title';
  const jira = fakeJira((keys) => keys.map((key) => ({ key, fields: fields('2026-11-18T00:00:00.000+0000') })));
  await hydrateBundles(list, jira);
  assert.equal(list[0].status, 'Done');
  assert.equal(list[0].summary, 'graph title');
  assert.equal(list[0].asOf, '2026-11-18T00:00:00.000+0000', '空字段仍然要补');
});

test('批量补水：失败只记缺口，不逐条兜底、不抛错', async () => {
  const list = rows(3);
  const jira = fakeJira(() => {
    throw Object.assign(new Error('boom'), { code: 'E_TIMEOUT' });
  });
  const out = await hydrateBundles(list, jira);
  assert.equal(out.length, 3);
  assert.equal(jira.calls.single, 0, '失败后不许退化成 N 次单条补水');
  for (const b of list) {
    assert.equal(b.metaError, 'E_PARTIAL');
    assert.ok(b.metaGaps.length > 0);
    assert.equal(b.asOf, null, '拿不到就是拿不到，不许填今天');
  }
});

test('getIssues：一条 JQL 拿整页、丢弃非法 key、上限 50', async () => {
  const seen = [];
  const api = {
    asUser: () => ({
      requestJira: async (path) => {
        seen.push(path);
        return {
          ok: true,
          json: async () => ({
            issues: [
              { key: 'DEL-101', fields: { summary: 'a', status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, updated: '2026-11-18' } },
            ],
          }),
        };
      },
    }),
  };
  const client = createJiraClient({ api });
  const out = await client.getIssues(['DEL-101', "DEL-101' OR 1=1", 'DEL-101', ...Array.from({ length: 60 }, (_, i) => `X-${i + 1}`)]);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /jql=key(?:%20|\s)in(?:%20|\s)\(/);
  assert.ok(!seen[0].includes('%27'), '单引号必须被过滤掉，不能带进 JQL');
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'DEL-101');
  const sent = decodeURIComponent(seen[0]).match(/key in \(([^)]+)\)/)[1].split(',');
  assert.equal(sent.length, 50, '最多 50 个 key');
  assert.ok(!sent.some((k) => k.includes("'")));
});

test('getIssues：没有合法 key 时不发请求', async () => {
  let hits = 0;
  const api = { asUser: () => ({ requestJira: async () => { hits += 1; return { ok: true, json: async () => ({ issues: [] }) }; } }) };
  const client = createJiraClient({ api });
  assert.deepEqual(await client.getIssues(['nope', '', null]), []);
  assert.equal(hits, 0);
});

test('端点迁移：/search/jql 返回 410 时退到 /search；403 不许换端点', async () => {
  const calls = [];
  const make = (status) => ({
    asUser: () => ({
      requestJira: async (path) => {
        calls.push(path);
        if (calls.length === 1 && status) return { ok: false, status, json: async () => ({}) };
        return { ok: true, json: async () => ({ issues: [{ key: 'DEL-101', fields: { summary: 'x' } }] }) };
      },
    }),
  });

  const client = createJiraClient({ api: make(410) });
  const out = await client.getIssues(['DEL-101']);
  assert.equal(calls.length, 2, '新端点下线时必须再试一次旧端点');
  assert.match(calls[0], /search\/jql/);
  assert.match(calls[1], /\/rest\/api\/3\/search\?/);
  assert.equal(out.length, 1);

  calls.length = 0;
  const forbidden = createJiraClient({ api: make(403) });
  await assert.rejects(() => forbidden.getIssues(['DEL-101']), (e) => e.status === 403);
  assert.equal(calls.length, 1, '403 换端点只是把权限错误藏起来');
});
