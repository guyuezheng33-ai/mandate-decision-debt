'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createFixturePort } = require('../src/ports/evidence.fixture');
const { createRestPort } = require('../src/ports/evidence.rest');
const { createTwgPort, QUERY } = require('../src/ports/evidence.twg');
const { createChainPort } = require('../src/ports/chain');
const { createRepairPort } = require('../src/ports/repair.jira');
const { createActions } = require('../src/resolvers/action');
const { STATES } = require('../src/engine/normalize');

const FIXTURES = path.join(__dirname, '..', 'src', 'fixtures');

test('fixture 端口：返回归一化后的 bundle，并标明来源', async () => {
  const port = createFixturePort({ dir: FIXTURES });
  const b = await port.getBundle('kan3');
  assert.equal(b.issueKey, 'KAN-3');
  assert.equal(b.source, 'fixture');
  assert.equal(b.edges.decisions.state, STATES.PRESENT);
});

test('fixture 端口：按项目过滤并遵守 limit', async () => {
  const port = createFixturePort({ dir: FIXTURES });
  const list = await port.listBundles('KAN', 3);
  assert.equal(list.length, 3);
  assert.ok(list.every((b) => b.projectKey === 'KAN'));
});

test('REST 端口：links 为空 → decisions 明确 absent（可以据此报"无依据"）', async () => {
  const port = createRestPort({
    client: { getIssue: async () => ({ fields: { summary: 's', status: { name: 'In Progress' } } }), getIssueLinks: async () => [] },
  });
  const b = await port.getBundle('R-1');
  assert.equal(b.edges.decisions.state, STATES.ABSENT);
});

test('REST 端口：Jira 原生授权记录不能被"只认页面链接"过滤掉', async () => {
  const record = {
    globalId: 'jira:MDEMO-2',
    title: 'Product requirements — approval record',
    url: 'https://one-atlas-ngpq.atlassian.net/browse/MDEMO-2',
    updated: '2022-03-26',
    ownerName: 'Alana Grant',
    application: 'Jira',
  };
  const port = createRestPort({
    client: {
      getIssue: async () => ({
        fields: { summary: 'Compliance', status: { name: 'To Do', created: '2026-08-01T00:00:00.000Z' } },
      }),
      getIssueLinks: async () => [record],
    },
  });
  const b = await port.getBundle('MOBL-57');
  assert.equal(b.edges.decisions.state, STATES.PRESENT);
  assert.equal(b.edges.decisions.items.length, 1);
  assert.equal(b.edges.decisions.items[0].id, 'jira:MDEMO-2');
  assert.equal(b.edges.decisions.items[0].updated.slice(0, 10), '2022-03-26');
  assert.equal(b.edges.decisions.items[0].ownerName, 'Alana Grant');
});

test('REST 端口：links 失败 → decisions unknown（绝不当成"没有"）', async () => {
  const port = createRestPort({
    client: {
      getIssue: async () => ({ fields: { summary: 's' } }),
      getIssueLinks: async () => {
        throw new Error('403 Forbidden: scope');
      },
    },
  });
  const b = await port.getBundle('R-2');
  assert.equal(b.edges.decisions.state, STATES.UNKNOWN);
  assert.equal(b.edges.reviewTraces.state, STATES.UNKNOWN);
});

test('REST 端口：拿不到目标就标 unknown，不当成没有目标', async () => {
  const port = createRestPort({
    client: { getIssue: async () => ({ fields: { summary: 's' } }), getIssueLinks: async () => [] },
  });
  const b = await port.getBundle('R-3');
  assert.equal(b.edges.goals.state, STATES.UNKNOWN);
  assert.equal(port.status().degraded, true);
});

test('TWG 端口：把图查询结果映射成同一形状', async () => {
  const port = createTwgPort({
    query: async () => ({
      issue: { key: 'T-9', summary: 'x', status: 'In Progress', inProgressSince: '2026-02-01T00:00:00Z' },
      decisions: { state: 'present', items: [{ id: 'p1', title: 'Policy', updated: '2026-08-10T00:00:00Z', owner: 'u1', contributors: ['u1', 'u2'] }] },
      goals: { state: 'present', items: [{ id: 'g1', status: 'in_progress' }] },
      reviewTraces: { state: 'present', items: [{ pageId: 'p1', actorId: 'u2' }] },
    }),
  });
  const b = await port.getBundle('T-9');
  assert.equal(b.source, 'twg');
  assert.equal(b.edges.decisions.items[0].id, 'p1');
  assert.equal(port.status().degraded, false);
});

test('TWG 端口：scope 报错 → 返回 unknown bundle 并附错误码，而不是抛异常', async () => {
  const port = createTwgPort({
    query: async () => {
      throw new Error('403 Forbidden: missing scope read:graph:page:confluence');
    },
  });
  const b = await port.getBundle('T-10');
  assert.equal(b.edges.decisions.state, STATES.UNKNOWN);
  assert.equal(b.errors[0].code, 'E_SCOPE');
});

test('TWG 端口：scan 一次取回多条（避免 N+1）', async () => {
  const port = createTwgPort({
    query: async (req) => {
      assert.equal(req.type, QUERY.scan);
      return {
        issues: [
          { issue: { key: 'S-1' }, decisions: { state: 'absent', items: [] }, goals: { state: 'absent', items: [] } },
          { issue: { key: 'S-2' }, decisions: { state: 'absent', items: [] }, goals: { state: 'absent', items: [] } },
        ],
      };
    },
  });
  const list = await port.listBundles('S', 25);
  assert.equal(list.length, 2);
});

test('action：getIssueProvenance 返回可展示 payload，并带证据指纹与写能力标记', async () => {
  const actions = createActions({
    evidencePort: createFixturePort({ dir: FIXTURES }),
    repairPort: createRepairPort({ client: { canWrite: async () => false, listComments: async () => [], addComment: async () => ({}) }, scopes: [] }),
  });
  const out = await actions.getIssueProvenance({ inputs: { issueKey: 'KAN-3' } });
  assert.equal(out.ok, true);
  assert.equal(out.debt, 28);
  assert.equal(out.canWrite, false);
  assert.match(out.fingerprint, /^dd-/);
  assert.equal(out.flags[0].p, 'P2');
});

test('action：缺 issueKey 时返回可读错误码，而不是抛异常', async () => {
  const actions = createActions({ evidencePort: createFixturePort({ dir: FIXTURES }) });
  const out = await actions.getIssueProvenance({});
  assert.equal(out.ok, false);
  assert.equal(out.code, 'E_UNKNOWN_ISSUE');
});

test('action：listContextDebt 带覆盖率披露，且不可知条目不计入均分', async () => {
  const actions = createActions({ evidencePort: createFixturePort({ dir: FIXTURES }) });
  const out = await actions.listContextDebt({ inputs: { projectKey: 'KAN', limit: 5 } });
  assert.equal(out.ok, true);
  assert.equal(out.unknownCount, 1);
  assert.equal(out.disclosure.counted, 4);
  assert.equal(out.disclosure.total, 5);
});

test('action：traceDrift 明确返回"是否漂移"与阈值，供 agent 直接复述', async () => {
  const actions = createActions({ evidencePort: createFixturePort({ dir: FIXTURES }) });
  const out = await actions.traceDrift({ inputs: { issueKey: 'KAN-3' } });
  assert.equal(out.ok, true);
  assert.equal(out.drifting, true);
  assert.equal(out.thresholdDays, 14);
  assert.ok(out.daysSinceChange >= 14);
});

test('repair 端口：同一证据指纹不写第二条评论（幂等）', async () => {
  const store = [];
  const client = {
    canWrite: async () => true,
    listComments: async () => store,
    addComment: async (key, body) => {
      const c = { id: `c${store.length + 1}`, body };
      store.push(c);
      return c;
    },
  };
  const port = createRepairPort({ client, scopes: ['read:jira-work', 'write:jira-work'] });
  const actions = createActions({ evidencePort: createFixturePort({ dir: FIXTURES }), repairPort: port });
  const first = await actions.stampMandate({ inputs: { issueKey: 'KAN-3' } });
  const second = await actions.stampMandate({ inputs: { issueKey: 'KAN-3' } });
  assert.equal(first.ok, true);
  assert.equal(second.skipped, true);
  assert.equal(store.length, 1);
});

test('repair 端口：无写权限时按钮能力为 false，调用返回 E_WRITE_DENIED', async () => {
  const port = createRepairPort({ client: {}, scopes: ['read:jira-work'] });
  assert.equal(await port.canWrite(), false);
  const r = await port.stamp({ issueKey: 'X', edges: { decisions: { items: [] } } }, { key: 'software', name: 'Software delivery' });
  assert.equal(r.code, 'E_WRITE_DENIED');
});

test('REST 端口：扫描有硬预算，20 条也只取前 8 条', async () => {
  let issueCalls = 0;
  const ids = Array.from({ length: 20 }, (_, i) => `R-${i}`);
  const port = createRestPort({
    client: {
      searchIssues: async (project, limit) => {
        assert.equal(limit, 8); // 下限在 JQL 层就被夹住，不是取回 20 条再截
        return ids;
      },
      getIssue: async () => {
        issueCalls += 1;
        return { fields: { summary: 's', status: { name: 'In Progress' }, project: { key: 'R' } } };
      },
      getIssueLinks: async () => [],
    },
  });

  const list = await port.listBundles('R', 25);
  assert.equal(list.length, 8);
  assert.equal(issueCalls, 8);
  assert.equal(list.scan.cap, 8);
  assert.equal(list.scan.requested, 25);
  assert.equal(list.scan.capped, true);
});

test('链：降级扫描把预算披露一起带出来，且标注 degraded', async () => {
  const ids = Array.from({ length: 12 }, (_, i) => `R-${i}`);
  const fallback = createRestPort({
    client: {
      searchIssues: async () => ids,
      getIssue: async () => ({ fields: { summary: 's', status: { name: 'In Progress' }, project: { key: 'R' } } }),
      getIssueLinks: async () => [],
    },
  });
  const primary = {
    capabilities: () => ({ decisions: true }),
    status: () => ({ source: 'twg', degraded: false }),
    getBundle: async () => {
      throw Object.assign(new Error('missing scope'), { code: 'E_SCOPE' });
    },
    listBundles: async () => {
      throw Object.assign(new Error('missing scope'), { code: 'E_SCOPE' });
    },
  };
  const chain = createChainPort({ primary, fallback, blindEdges: ['goals', 'reviewTraces'] });

  const list = await chain.listBundles('R', 25);
  assert.equal(list.length, 8);
  assert.equal(list.scan.cap, 8);
  assert.equal(list.scan.degraded, true);
  assert.equal(list[0].degraded.from, 'twg');
});

test('REST 端口：带 Confluence 页面元数据时，收据能拿到真实时间与作者', async () => {
  const port = createRestPort({
    client: {
      getIssue: async () => ({ fields: { summary: 's' } }),
      getIssueLinks: async () => [
        { object: { title: 'Archive policy', url: 'https://x.atlassian.net/wiki/spaces/A/pages/123/Archive' } },
      ],
      getPageMeta: async () => ({
        id: '123',
        title: 'Archive policy',
        updated: '2026-08-14T00:00:00Z',
        owner: 'u-alice',
        ownerName: 'Alice Ng',
      }),
    },
  });
  const b = await port.getBundle('R-4');
  const d = b.edges.decisions.items[0];
  assert.equal(d.updated, '2026-08-14T00:00:00.000Z');
  assert.equal(d.ownerName, 'Alice Ng');
});

test('Confluence 页面 URL → content id：取不到就返回 null，不发猜测请求', () => {
  const { pageIdOf } = require('../src/ports/confluence.client');
  assert.equal(pageIdOf('https://x.atlassian.net/wiki/spaces/A/pages/123/Archive'), '123');
  assert.equal(pageIdOf('https://x.atlassian.net/wiki/pages/viewpage.action?pageId=456'), '456');
  assert.equal(pageIdOf('https://example.com/no-page-id'), null);
});

test('Jira remote link：只有一条时返回对象而不是数组，也必须认成一条依据', () => {
  const { shapeLinks } = require('../src/ports/jira.client');
  const one = shapeLinks({
    id: '1',
    object: { url: 'https://x.atlassian.net/wiki/spaces/A/pages/123/Archive', title: 'Archive policy' },
  });
  assert.equal(one.length, 1);
  assert.equal(one[0].title, 'Archive policy');
  assert.equal(shapeLinks({ remoteLinks: [] }).length, 0);
});

