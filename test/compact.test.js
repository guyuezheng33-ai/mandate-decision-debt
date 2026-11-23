'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, aggregate } = require('../src/engine/score');
const { getProfile } = require('../src/engine/profiles');
const { compactIssue, compactProject, enforceBudget, clip, byteSize, MAX_PAYLOAD_BYTES } = require('../src/io/compact');
const { base, fixture } = require('./helpers');

const soft = getProfile('software');

test('compactIssue 只留白名单字段，正文与贡献者名单不外泄', () => {
  const out = compactIssue(summarize(fixture('kan3'), soft));
  assert.equal(out.ok, true);
  assert.equal(out.issueKey, 'KAN-3');
  assert.equal(out.profile, 'software');
  assert.equal(out.flags.length, 2);
  assert.equal(JSON.stringify(out).includes('"body"'), false, '评论正文不应进入 payload');
  assert.equal(JSON.stringify(out).includes('"description"'), false, '描述不应进入 payload');
  assert.ok(out.coverage.known >= 2);
});

test('compactProject 只带 top N，并保留覆盖率披露', () => {
  const agg = aggregate([fixture('kan3'), fixture('kan7'), fixture('kan9'), fixture('kan11')], soft);
  const out = compactProject(agg, { maxItems: 2 });
  assert.equal(out.items.length, 2);
  assert.equal(out.itemCount, 4);
  assert.equal(out.unknownCount, 1);
  assert.equal(out.disclosure.counted, 3);
  assert.equal(out.disclosure.total, 4);
  assert.equal(out.dataSource, undefined);
});

test('compactProject 必须带出确定度与带缺口条数，否则 16 分会被念成"完整结论"', () => {
  const agg = aggregate([fixture('kan3'), fixture('kan7'), fixture('kan9'), fixture('kan11')], soft);
  const out = compactProject(agg, { maxItems: 2 });
  assert.equal(typeof out.certainty, 'number');
  assert.equal(typeof out.partialCount, 'number');
  assert.ok(out.certainty > 0 && out.certainty <= 1);
  // 项目级确定性 = 有分条目的平均确定度：KAN-11 不出分，所以只由另外三条决定。
  const expected = Math.round(
    (aggregate([fixture('kan3'), fixture('kan7'), fixture('kan9')], soft).items
      .reduce((s, i) => s + i.certainty, 0) / 3) * 100,
  ) / 100;
  assert.equal(out.certainty, expected);
});

test('不可知条目必须带出"缺哪条边"，不能只说 no criterion hit', () => {
  const agg = aggregate([fixture('kan11')], soft);
  const out = compactProject(agg, { maxItems: 5 });
  const blind = out.items[0];
  assert.equal(blind.grade, 'unknown');
  // 分数给 null 而不是 0：下游（另一个模型、一段脚本、一个仪表盘）读 0 会当成"很健康"
  assert.equal(blind.debt, null, '不可知条目在 payload 里必须是 null，不能是 0');
  assert.ok(blind.missing.length >= 1, '不可知条目缺少 missing 边名，界面就只能说"没有命中"');
  assert.ok(blind.missing.every((e) => ['decisions', 'goals', 'reviewTraces'].includes(e)), 'missing 只能是三条已知边的名字');
});

test('单条 payload 也要带"只判了一半"，否则 agent 会照着面板没印的等级念', () => {
  const full = compactIssue(summarize(fixture('kan3'), soft));
  assert.equal(full.partial, false);
  assert.equal(full.certainty, 1);
  assert.equal(full.thin, false);

  const half = fixture('kan3');
  half.edges.goals = { state: 'unknown', items: [], reason: 'goals-unavailable' };
  half.edges.reviewTraces = { state: 'unknown', items: [], reason: 'rest-has-no-commenters' };
  const out = compactIssue(summarize(half, soft));
  assert.equal(out.partial, true);
  assert.deepEqual(out.unknownPrims.sort(), ['P1', 'P4', 'P6'].sort());
  assert.ok(out.certainty < 0.5);
  assert.equal(out.thin, true, '面板印 PARTIAL，agent 就不能印 watch');
});

test('缺判据的条目要在行上标出来，否则低分会被读成"更安全"', () => {
  // KAN-3 的基线是"证据齐全"（3/3 边可知），所以部分可知要用降级形状来造：
  // 只有依据页回来、目标与复核边不可见 —— 这正是 TWG 退 REST 的那一档。
  const partial = fixture('kan3');
  partial.edges.goals = { state: 'unknown', items: [], reason: 'goals-unavailable' };
  partial.edges.reviewTraces = { state: 'unknown', items: [], reason: 'rest-has-no-commenters' };
  const out = compactProject(aggregate([partial, fixture('kan20')], soft), { maxItems: 5 });
  const row = out.items.find((i) => i.issueKey === 'KAN-3');
  const healthy = out.items.find((i) => i.issueKey === 'KAN-20');
  assert.equal(row.grade, 'watch');
  assert.equal(row.partial, true, '有判据不可知的行必须带 partial');
  assert.deepEqual(row.unknownPrims.sort(), ['P1', 'P4', 'P6'].sort());
  assert.equal(healthy.partial, false, '全知的健康条目不该被标成 partial');
  assert.deepEqual(healthy.unknownPrims, []);
  assert.equal(healthy.certainty, 1);
  // 45/96 的权重 → 只能排序，不能自称 watch。界面据此印"判据不足"而不是等级。
  assert.ok(row.certainty < 0.5, `certainty=${row.certainty}`);
  // 不可知条目本身是"判不了"，不是"部分判不了"：部分标记只属于有分的行。
  const blind = compactProject(aggregate([fixture('kan11')], soft), { maxItems: 5 }).items[0];
  assert.equal(blind.partial, false);
  assert.deepEqual(blind.unknownPrims, []);
});

test('compactProject 必须把"这页不是全部"透出去：hasMore 与有缺口条数', () => {
  const bundles = [fixture('kan3'), fixture('kan7'), fixture('kan9')];
  bundles.scan = { source: 'twg', requested: 3, fetched: 3, cap: 50, capped: false, hasMore: true, confirmLookup: 'not-read' };
  const out = compactProject(aggregate(bundles, soft), { maxItems: 5 });
  assert.equal(out.scan.hasMore, true, 'scan 说还有下一页，项目 payload 就不能假装扫描完整');
  assert.equal(out.scan.confirmLookup, 'not-read');
  assert.ok(out.flaggedCount >= 1);
  assert.equal(typeof out.flaggedShare, 'number');
  assert.ok(out.flaggedShare > 0 && out.flaggedShare <= 1);
  assert.ok(out.severeCount >= 1, '有 high 命中的条目必须被数进 severe');
});

test('超预算时逐级裁剪，永远不返回 1MB 的错误', () => {
  const big = [];
  for (let i = 0; i < 4000; i += 1) {
    big.push({ p: 'P2', k: 'drift_not_propagated', w: 20, s: 'high', label: 'x'.repeat(200), detail: 'y'.repeat(400), evidence: { pad: 'z'.repeat(200) } });
  }
  const payload = { ok: true, issueKey: 'BIG-1', flags: big };
  const r = enforceBudget(payload);
  assert.equal(r.trimmed, true);
  assert.ok(r.bytes <= MAX_PAYLOAD_BYTES, `trimmed payload ${r.bytes}B exceeds budget`);
});

test('clip 截断长文本并加省略号', () => {
  assert.equal(clip('短文本'), '短文本');
  assert.equal(clip('a'.repeat(500)).length, 240);
  assert.ok(clip('a'.repeat(500)).endsWith('…'));
});

test('中文 payload 的字节数按 UTF-8 计算', () => {
  assert.equal(byteSize('决策债'), Buffer.byteLength('决策债', 'utf8'));
  const summary = summarize(fixture('kan7'), soft);
  assert.ok(byteSize(compactIssue(summary)) < MAX_PAYLOAD_BYTES);
});
