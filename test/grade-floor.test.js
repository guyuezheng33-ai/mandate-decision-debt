'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { base, fixture, decision } = require('./helpers');
const { getProfile } = require('../src/engine/profiles');
const { summarize, aggregate } = require('../src/engine/score');
const { bundlesFromSeed } = require('../tools/seed-bundles');
const path = require('node:path');

const soft = getProfile('software');
const SEED = path.join(__dirname, 'fixtures', 'inbox', 'seed-21.csv');

/**
 * 这一组断言保护的是一句界面承诺：**"健康" = 没有值得处理的问题**。
 * data-inbox 的 21 条样本把这句话打穿过一次：P3 依据冲突在 software 口径只有 15 分，
 * 落在 <=15 的健康带里，屏幕上就是"15 · 健康"配一条"两份依据互相打架"——
 * 分数没算错，话是错的。修法不是改阈值，而是给等级一个严重度地板。
 */

test('中等严重度命中不能落在健康带：15 分的依据冲突必须是 watch', () => {
  const conflict = base({
    key: 'T-9',
    edges: {
      decisions: { items: [decision({ id: 'p1', title: 'pricing guardrails', owner: 'a' }), decision({ id: 'p2', title: 'pricing guardrails', owner: 'b' })] },
    },
  });
  const s = summarize(conflict, soft);
  assert.equal(s.debt, 15, 'P3 在 software 口径是 15');
  assert.equal(s.flags[0].primitive, 'P3');
  assert.equal(s.grade, 'watch', '有 medium 命中时，"15 分"不能被读成"健康"');
});

test('低严重度可以留在健康带：只有 P6（单人无复核，8 分）仍是 healthy', () => {
  const s = summarize(fixture('kan3'), soft);
  // kan3 同时有 P2(20)，所以它是 watch；这条用 kan20（干净样本）验证反向不成立
  assert.equal(summarize(fixture('kan20'), soft).grade, 'healthy');
  assert.equal(summarize(fixture('kan20'), soft).flagCount, 0);
  // 单条 P6：把 kan3 的 P2 摘掉，剩 8 分且 severity=low
  const onlyP6 = base({
    key: 'T-10',
    edges: {
      decisions: { items: [decision({ contributors: ['u1'] })] },
      reviewTraces: { state: 'absent', items: [] },
    },
  });
  const s6 = summarize(onlyP6, soft);
  assert.equal(s6.debt, 8);
  assert.deepEqual(s6.flags.map((f) => [f.primitive, f.severity]), [['P6', 'low']]);
  assert.equal(s6.grade, 'healthy', '补一条复核不等于有债，不能被地板抬成 watch');
});

test('严重度是语义而不是权重：portfolio 口径下 P2 权重 14，严重度仍是 high', () => {
  const s = summarize(fixture('kan3'), getProfile('portfolio'));
  const p2 = s.flags.find((f) => f.primitive === 'P2');
  assert.ok(p2, 'kan3 在 portfolio 口径下仍有 P2');
  assert.equal(p2.weight, 14, '权重来自口径');
  assert.equal(p2.severity, 'high', '同一个事实的严重度不随权重变形');
});

test('项目均分低但多数条目有命中时，项目等级不能是 healthy', () => {
  const agg = aggregate(bundlesFromSeed(SEED), soft);
  assert.equal(agg.itemCount, 21);
  assert.equal(agg.debt, 14, '均分仍印原值：地板只抬等级，不改分数');
  assert.equal(agg.flaggedCount, 17);
  assert.equal(agg.flaggedShare, 0.81);
  assert.ok(agg.grade !== 'healthy', '81% 条目有命中的项目不能叫健康');
  assert.equal(agg.grade, 'watch');
});

test('项目级 at_risk 需要"多数条目 + 均分过 25"两个条件同时成立', () => {
  // 同一条 seed 语料换到 portfolio 口径：均分 13 → 仍是 watch（不能只凭比例升级）
  const agg = aggregate(bundlesFromSeed(SEED), getProfile('portfolio'));
  assert.equal(agg.debt, 13);
  assert.equal(agg.flaggedShare, 0.81);
  assert.equal(agg.grade, 'watch', '比例高但均分低，说明多数是单条小缺口，不是整页在烂');
});

test('干净语料不会被地板误伤：四条干净样本的项目仍是 healthy', () => {
  const clean = [fixture('kan20'), fixture('kan20'), fixture('kan20'), fixture('kan20')];
  const agg = aggregate(clean, soft);
  assert.equal(agg.debt, 0);
  assert.equal(agg.flaggedCount, 0);
  assert.equal(agg.grade, 'healthy');
});
