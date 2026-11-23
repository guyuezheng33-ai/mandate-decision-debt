'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { base, fixture, decision } = require('./helpers');
const { getProfile } = require('../src/engine/profiles');
const { debtOf, grade, summarize, aggregate, diff } = require('../src/engine/score');

const soft = getProfile('software');

test('债务分等于命中权重之和，且被夹在 0–100', () => {
  assert.equal(debtOf([{ weight: 20 }, { weight: 8 }]), 28);
  assert.equal(debtOf([{ weight: 120 }]), 100);
  assert.equal(debtOf([]), 0);
});

test('分级边界：<=15 健康 / <=35 关注 / <=60 风险 / >60 危急', () => {
  assert.equal(grade(0), 'healthy');
  assert.equal(grade(15), 'healthy');
  assert.equal(grade(16), 'watch');
  assert.equal(grade(35), 'watch');
  assert.equal(grade(36), 'at_risk');
  assert.equal(grade(60), 'at_risk');
  assert.equal(grade(61), 'critical');
});

test('项目聚合：不可知条目不进分母，并如实披露覆盖率', () => {
  const good = base();
  const debt3 = base({
    key: 'T-2',
    lastConfirmAt: null,
    edges: { decisions: { items: [decision()] } },
  });
  const blind = base({
    key: 'T-3',
    edges: {
      decisions: { state: 'unknown', items: [], reason: 'E_SCOPE' },
      goals: { state: 'unknown', items: [], reason: 'E_SCOPE' },
      reviewTraces: { state: 'unknown', items: [], reason: 'E_SCOPE' },
    },
  });
  const agg = aggregate([good, debt3, blind], soft);
  assert.equal(agg.countedCount, 2);
  assert.equal(agg.unknownCount, 1);
  assert.equal(agg.debt, 10, '20/2，不可知的那条不能把平均拉成 0 或 100');
  assert.equal(agg.disclosure.counted, 2);
  assert.equal(agg.disclosure.total, 3);
  assert.equal(agg.coverageRatio.toFixed(2), '0.67');
});

test('债的来源按权重贡献计，且总和等于可计条目的命中权重之和', () => {
  const agg = aggregate([fixture('kan3'), fixture('kan9'), fixture('kan11')], soft);
  const hits = agg.items
    .filter((i) => i.coverage.known === i.coverage.total)
    .reduce((n, i) => n + i.flags.reduce((s, f) => s + f.weight, 0), 0);
  const fromDrivers = agg.drivers.reduce((n, d) => n + d.sum, 0);
  assert.equal(fromDrivers, hits, 'driver 的权重和必须等于可计条目的命中权重和（不可知条目不计入）');
  // P1(25) 单条就比 P2(20) 重：贡献排序不等于命中次数排序
  assert.equal(agg.drivers[0].p, 'P1');
});

test('修复前后对比：移除权重后分数单调下降', () => {
  const before = summarize(fixture('kan3'), soft);
  const after = { ...before, debt: before.debt - 20 };
  assert.equal(diff(before, after).delta, -20);
  assert.equal(before.debt, 28);
});

test('三条边全不可知时不出分（0 分会被误读成"很健康"）', () => {
  const blind = summarize(fixture('kan11'), soft);
  assert.equal(blind.grade, 'unknown');
  assert.equal(blind.flagCount, 0);
  assert.equal(blind.coverage.known, 0);
});

/**
 * 这张表是分数的解释权：面板上"这个分数怎么来的"直接读它。
 * 如果它和 flags / skipped 对不上，用户点开看到的解释就是假的——
 * 而这种假不会抛异常，只会安静地说错话。
 */
test('criteria 六条判据一条不少，且与 flags / skipped 自洽', () => {
  const s = summarize(fixture('kan3'), soft);
  assert.equal(s.criteria.length, 6, '六条原语必须全部出现在解释表里');
  const hit = s.criteria.filter((c) => c.state === 'hit').map((c) => c.p).sort();
  assert.deepEqual(hit, s.flags.map((f) => f.primitive).sort(), 'state=hit 的集合必须等于命中集合');
  const unknown = s.criteria.filter((c) => c.state === 'unknown').map((c) => c.p).sort();
  assert.deepEqual(unknown, s.skipped.map((x) => x.primitive).sort(), 'state=unknown 的集合必须等于被抑制集合');
  const summed = s.criteria.reduce((sum, c) => sum + (c.state === 'hit' ? c.w : 0), 0);
  assert.equal(summed, s.debt, '分数必须等于 state=hit 的权重和');
});
