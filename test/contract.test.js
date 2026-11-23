'use strict';

/**
 * 契约测试：三个端口（TWG / REST / fixture）必须满足**同一份**接口契约。
 *
 * 为什么单靠各自的单元测试不够：单元测试证明"这个端口在它自己的条件下对"，
 * 契约测试证明"换成另一个端口，上层代码不用改"。Devpost 里那句
 * "the same contract test runs against both ports" 指的就是这个文件。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createFixturePort } = require('../src/ports/evidence.fixture');
const { createRestPort } = require('../src/ports/evidence.rest');
const { createTwgPort } = require('../src/ports/evidence.twg');
const { STATES } = require('../src/engine/normalize');
const { summarize } = require('../src/engine/score');
const { getProfile } = require('../src/engine/profiles');

const FIXTURES = path.join(__dirname, '..', 'src', 'fixtures');
const EDGES = ['decisions', 'goals', 'reviewTraces'];

/** 一份 bundle 必须满足的形状。三个端口都过这一关。 */
function assertBundleContract(b, label) {
  assert.ok(b && typeof b === 'object', `${label}: 不是对象`);
  assert.equal(typeof b.issueKey, 'string', `${label}: issueKey 缺失`);
  assert.ok(['twg', 'rest', 'fixture'].includes(b.source), `${label}: source=${b.source}`);
  assert.ok(b.edges && typeof b.edges === 'object', `${label}: 没有 edges`);
  assert.deepEqual(Object.keys(b.edges).sort(), [...EDGES].sort(), `${label}: 边的集合不一致`);
  for (const name of EDGES) {
    const e = b.edges[name];
    assert.ok(e, `${label}: ${name} 缺失`);
    assert.ok(
      [STATES.PRESENT, STATES.ABSENT, STATES.UNKNOWN].includes(e.state),
      `${label}: ${name}.state=${e.state}`,
    );
    // present 必须真的带着东西：一个"我看见了，但里面是空的"比 unknown 更误导
    if (e.state === STATES.PRESENT) {
      assert.ok(Array.isArray(e.items) && e.items.length > 0, `${label}: ${name} present 但没有 items`);
    }
    if (e.state !== STATES.PRESENT) {
      assert.ok(Array.isArray(e.items) && e.items.length === 0, `${label}: ${name} 非 present 却带 items`);
    }
  }
  // 可序列化：payload 要走 JSON，任何 Date / 循环引用都会在图查询里炸掉
  const round = JSON.parse(JSON.stringify(b));
  assert.deepEqual(Object.keys(round).sort(), Object.keys(b).sort(), `${label}: 序列化后字段丢失`);
}

/** 三个端口共同的行为。 */
function contractSuite(name, makePort, key) {
  test(`${name} · getBundle 满足契约，且能被打分`, async () => {
    const port = makePort();
    const b = await port.getBundle(key);
    assertBundleContract(b, name);
    const s = summarize(b, getProfile('software', 'en'));
    assert.ok(s.debt >= 0 && s.debt <= 100);
    assert.equal(s.criteria.length, 6);
  });

  test(`${name} · status() 至少说清来源`, async () => {
    const port = makePort();
    const st = port.status();
    assert.ok(st && typeof st === 'object');
    assert.equal(typeof st.source, 'string');
  });
}

contractSuite('fixture', () => createFixturePort({ dir: FIXTURES }), 'kan3');

contractSuite(
  'rest',
  () =>
    createRestPort({
      client: {
        getIssue: async (k) => ({
          fields: {
            summary: `Work ${k}`,
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            project: { key: 'R' },
            created: '2026-01-01T00:00:00.000Z',
            updated: '2026-11-01T00:00:00.000Z',
          },
        }),
        getIssueLinks: async () => [
          { globalId: 'g1', title: 'Pricing decision', url: 'https://x.atlassian.net/wiki/spaces/A/pages/1' },
        ],
        searchIssues: async () => ['R-1', 'R-2'],
      },
    }),
  'R-1',
);

contractSuite(
  'twg',
  () =>
    createTwgPort({
      query: async () => ({
        issue: { key: 'T-1', summary: 'x', status: 'In Progress' },
        decisions: {
          state: STATES.PRESENT,
          items: [{ id: 'p1', title: 'Policy', updated: '2026-08-10T00:00:00.000Z', owner: 'u1', contributors: ['u1'] }],
        },
        goals: { state: STATES.PRESENT, items: [{ id: 'g1', status: 'in_progress', updated: '2026-09-01T00:00:00.000Z' }] },
        reviewTraces: { state: STATES.ABSENT, items: [] },
      }),
    }),
  'T-1',
);

test('所有端口在客户端抛错时都不向上抛，而是降级成 unknown bundle', async () => {
  const failing = [
    ['rest', createRestPort({ client: { getIssue: async () => { throw Object.assign(new Error('403'), { code: 'E_SCOPE' }); } } })],
    ['twg', createTwgPort({ query: async () => { throw Object.assign(new Error('403'), { code: 'E_SCOPE' }); } })],
  ];
  for (const [name, port] of failing) {
    const b = await port.getBundle('X-1'); // 不许 throw
    assertBundleContract(b, `${name}-failing`);
    const unknowns = EDGES.filter((e) => b.edges[e].state === STATES.UNKNOWN);
    assert.ok(unknowns.length >= 1, `${name}: 失败时至少要有一条边是 unknown`);
    assert.ok((b.errors || []).length >= 1, `${name}: 失败必须带错误码`);
    assert.equal((b.errors || [])[0].code, 'E_SCOPE');
  }
});

test('所有端口的分数字段都由同一引擎算出（同一输入 → 同一 debt）', async () => {
  const b = await createFixturePort({ dir: FIXTURES }).getBundle('kan3');
  const p = getProfile('software', 'en');
  const a = summarize(b, p);
  const c = summarize(JSON.parse(JSON.stringify(b)), p);
  assert.equal(a.debt, c.debt);
  assert.deepEqual(a.criteria, c.criteria);
});

test('listBundles 在三个端口都返回数组，且每条都过 bundle 契约', async () => {
  const ports = [
    ['fixture', createFixturePort({ dir: FIXTURES }), 'KAN'],
    [
      'rest',
      createRestPort({
        client: {
          searchIssues: async () => ['R-1', 'R-2'],
          getIssue: async (k) => ({ fields: { summary: k, status: { name: 'In Progress' }, project: { key: 'R' } } }),
          getIssueLinks: async () => [],
        },
      }),
      'R',
    ],
    [
      'twg',
      createTwgPort({
        query: async () => ({
          issues: [
            { issue: { key: 'S-1' }, decisions: { state: STATES.ABSENT, items: [] }, goals: { state: STATES.ABSENT, items: [] }, reviewTraces: { state: STATES.UNKNOWN, items: [] } },
          ],
        }),
      }),
      'S',
    ],
  ];
  for (const [name, port, projectKey] of ports) {
    const list = await port.listBundles(projectKey, 5);
    assert.ok(Array.isArray(list), `${name}: 不是数组`);
    assert.ok(list.length > 0, `${name}: 空列表`);
    assert.ok(list.length <= 5, `${name}: 超过 limit`);
    for (const b of list) assertBundleContract(b, `${name}-list`);
    if (list.scan) {
      assert.equal(typeof list.scan.source, 'string');
      assert.equal(typeof list.scan.requested, 'number');
    }
  }
});
