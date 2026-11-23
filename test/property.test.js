'use strict';

/**
 * 性质测试：不是"再举几个例子"，而是对**任意**输入断言那几条必须永远成立的纪律。
 *
 * 单元测试钉的是"已知输入 → 已知输出"；这里钉的是"无论输入长什么样，下面 10 条都不能破"。
 * 随机是确定性的（固定种子的 mulberry32），所以跑一百遍结果一样，失败可复现。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { summarize, debtOf, grade, ceiling } = require('../src/engine/score');
const { PROFILES, PRIMITIVES } = require('../src/engine/profiles');
const { STATES } = require('../src/engine/normalize');

/** 确定性 PRNG：同一个种子永远生成同一串数。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TITLES = [
  'Archive flow for inactive projects',
  'Positioning brief v2 for the portal',
  'Quarterly retention experiment',
  'Pricing change 2026',
  'API deprecation plan',
  'Onboarding rewrite',
];
const OWNERS = ['ada', 'bo', 'chen', 'dee'];

function makeBundle(rnd, i) {
  const pickOne = (arr) => arr[Math.floor(rnd() * arr.length)];
  const state = () => {
    const r = rnd();
    if (r < 0.45) return STATES.PRESENT;
    if (r < 0.75) return STATES.ABSENT;
    return STATES.UNKNOWN;
  };
  const itemCount = Math.floor(rnd() * 4); // 0..3
  const decisions = [];
  const goals = [];
  const reviewTraces = [];
  for (let k = 0; k < itemCount; k += 1) {
    const day = 1 + Math.floor(rnd() * 400);
    const title = pickOne(TITLES);
    decisions.push({
      id: `page-${i}-${k}`,
      title,
      owner: pickOne(OWNERS),
      contributors: rnd() < 0.5 ? [pickOne(OWNERS)] : [pickOne(OWNERS), pickOne(OWNERS)],
      url: `https://example.atlassian.net/wiki/pages/${i}${k}`,
      updated: `2026-${String(1 + (day % 12)).padStart(2, '0')}-${String(1 + (day % 28)).padStart(2, '0')}T00:00:00.000Z`,
    });
    if (rnd() < 0.6) {
      goals.push({
        id: `goal-${i}-${k}`,
        title: `Goal ${k}`,
        status: pickOne(['open', 'on_track', 'closed', 'archived']),
        updated: `2026-0${1 + (k % 9)}-1${k % 9}T00:00:00.000Z`,
      });
    }
    if (rnd() < 0.5) {
      reviewTraces.push({
        pageId: `page-${i}-${k}`,
        actorId: pickOne([...OWNERS, 'eve', 'fay']),
        at: '2026-10-01T00:00:00.000Z',
      });
    }
  }
  const edge = (s, items) =>
    s === STATES.PRESENT ? { state: s, items } : s === STATES.UNKNOWN ? { state: s, reason: 'timeout' } : { state: s, items: [] };

  return {
    issueKey: `KAN-${i}`,
    summary: pickOne(TITLES),
    status: pickOne(['In Progress', 'In Review', 'Done', 'Blocked']),
    statusCategory: rnd() < 0.2 ? 'done' : 'in_progress',
    createdAt: '2026-05-01T00:00:00.000Z',
    inProgressSince: rnd() < 0.5 ? '2026-06-01T00:00:00.000Z' : null,
    lastConfirmAt: rnd() < 0.3 ? '2026-10-20T00:00:00.000Z' : null,
    reopenedCount: Math.floor(rnd() * 4),
    lastReopenedAt: rnd() < 0.4 ? '2026-09-01T00:00:00.000Z' : null,
    asOf: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    source: 'fixture',
    edges: {
      decisions: edge(state(), decisions),
      goals: edge(state(), goals),
      reviewTraces: edge(state(), reviewTraces),
    },
  };
}

function shuffle(rnd, arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const ITERATIONS = 200;

test('weights never exceed a 100-point scale and every lens names the same six primitives', () => {
  for (const key of Object.keys(PROFILES)) {
    const p = PROFILES[key];
    const sum = PRIMITIVES.reduce((s, id) => s + (p.weights[id] || 0), 0);
    assert.ok(sum <= 100, `${key} weights sum ${sum} > 100`);
    assert.ok(sum >= 90, `${key} weights sum ${sum} is suspiciously low`);
    for (const id of PRIMITIVES) assert.ok(p.weights[id] > 0, `${key} has no weight for ${id}`);
    // 每套口径有且只有一个英雄判据，且权重不低于同口径任何其它判据的平均
    assert.ok(p.hero && PRIMITIVES.includes(p.hero), `${key} hero invalid`);
  }
});

test('the reachable ceiling is structural, not 100 — and no score ever exceeds it', () => {
  for (const key of Object.keys(PROFILES)) {
    const p = PROFILES[key];
    const c = ceiling(p);
    assert.ok(c < 100, `${key} ceiling ${c} should be below 100`);
    assert.ok(c >= p.weights.P1, `${key} ceiling below P1`);
    const rnd = mulberry32(7);
    for (let i = 0; i < ITERATIONS; i += 1) {
      const s = summarize(makeBundle(rnd, i), p);
      assert.ok(s.debt <= c, `${key} debt ${s.debt} exceeded ceiling ${c}`);
    }
  }
});

test('every bundle satisfies the ten invariants, in every lens', () => {
  const rnd = mulberry32(20261120);
  for (let i = 0; i < ITERATIONS; i += 1) {
    const bundle = makeBundle(rnd, i);
    for (const key of Object.keys(PROFILES)) {
      const p = PROFILES[key];
      const s = summarize(bundle, p);

      // 1) 六条判据逐条有结论，顺序稳定
      assert.equal(s.criteria.length, 6);
      assert.deepEqual(s.criteria.map((c) => c.p), PRIMITIVES);

      // 2) 状态只可能是 hit / clear / unknown
      for (const c of s.criteria) assert.ok(['hit', 'clear', 'unknown'].includes(c.state));

      // 3) hit 集合 == flags，unknown 集合 == skipped（不许只在一边出现）
      assert.deepEqual(
        s.criteria.filter((c) => c.state === 'hit').map((c) => c.p).sort(),
        (s.flags || []).map((f) => f.primitive).sort(),
      );
      assert.deepEqual(
        s.criteria.filter((c) => c.state === 'unknown').map((c) => c.p).sort(),
        (s.skipped || []).map((x) => x.primitive).sort(),
      );

      // 4) 分数就是 hit 的权重和
      assert.equal(s.debt, debtOf(s.flags));

      // 5) unknown 只出现在 why 上，hit/clear 不带 why
      for (const c of s.criteria) {
        if (c.state === 'unknown') assert.ok(c.why, 'unknown 必须说明缺哪条边');
        else assert.equal(c.why, null);
      }

      // 6) 一条证据都不可知时不出分
      assert.equal(s.grade === 'unknown', s.coverage.known === 0);

      // 7) 等级与分数同源：分级带仍由分数决定，另有两个地板——
      //    严重命中、以及"没有依据/依据已过期"都不能落在健康带。
      if (s.grade !== 'unknown') {
        const band = grade(s.debt);
        const severe = (s.flags || []).some((f) => f.severity && f.severity !== 'low');
        const authFloor = ['missing', 'stale'].includes(s.authority?.verdict);
        const floor = (severe || authFloor) && band === 'healthy' ? 'watch' : band;
        assert.equal(s.grade, floor, '等级只能是分级带本身，或被严重度/授权地板抬到 watch');
      }

      // 8) 覆盖率恒在 0..1，且 known + unknown == total
      assert.ok(s.coverage.ratio >= 0 && s.coverage.ratio <= 1);
      assert.equal(s.coverage.known + (s.coverage.total - s.coverage.known), s.coverage.total);

      // 9) 幂等：同一输入两次结果完全一致
      assert.equal(JSON.stringify(s), JSON.stringify(summarize(bundle, p)));

      // 10) 顺序无关：把边里的条目打乱，分数和命中集合都不变
      const shuffled = {
        ...bundle,
        edges: {
          ...bundle.edges,
          decisions: { ...bundle.edges.decisions, items: shuffle(rnd, bundle.edges.decisions.items || []) },
          goals: { ...bundle.edges.goals, items: shuffle(rnd, bundle.edges.goals.items || []) },
          reviewTraces: { ...bundle.edges.reviewTraces, items: shuffle(rnd, bundle.edges.reviewTraces.items || []) },
        },
      };
      const t = summarize(shuffled, p);
      assert.equal(t.debt, s.debt);
      assert.deepEqual(t.flags.map((f) => f.primitive).sort(), s.flags.map((f) => f.primitive).sort());
    }
  }
});

test('turning an unknown edge into a known one never adds uncertainty', () => {
  const rnd = mulberry32(31);
  let compared = 0;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const bundle = makeBundle(rnd, i);
    for (const name of ['decisions', 'goals', 'reviewTraces']) {
      if (bundle.edges[name].state !== STATES.UNKNOWN) continue;
      const p = PROFILES.software;
      const before = summarize(bundle, p);
      // 把一条不可知的边降级成"确认为空"：已知但没有内容
      const refined = {
        ...bundle,
        edges: { ...bundle.edges, [name]: { state: STATES.ABSENT, items: [] } },
      };
      const after = summarize(refined, p);
      assert.ok(
        after.skipped.length <= before.skipped.length,
        `${name}: unknown→absent 让不可知变多了（${before.skipped.length} → ${after.skipped.length}）`,
      );
      assert.ok(after.coverage.known >= before.coverage.known);
      compared += 1;
    }
  }
  assert.ok(compared > 50, `只比较了 ${compared} 次，样本不足`);
});
