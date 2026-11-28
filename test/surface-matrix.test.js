'use strict';

/**
 * D7 · 四端一致性矩阵：真实入口全等 + 能被程序拒绝的反例。
 */

const test = require('node:test');
const assert = require('node:assert');
const { runMatrix, diffProjections } = require('../tools/surface-matrix');

test('fixture KAN-3：panel / agent / mcp / audit 四端 debt/grade/criteria/coverage 全等', async () => {
  const r = await runMatrix({ issueKey: 'KAN-3', mode: 'fixture' });
  assert.equal(r.ok, true, `diffs=${r.diffs.join(',')} errors=${JSON.stringify(r.errors)}`);
  assert.equal(r.diffs.length, 0);
  assert.equal(typeof r.proj.panel.debt, 'number');
  assert.equal(r.proj.panel.criteria.length, 6);
});

test('fixture KAN-11（NO SCORE）：四端同样全等，且 debt 为 null 不是 0', async () => {
  const r = await runMatrix({ issueKey: 'KAN-11', mode: 'fixture' });
  assert.equal(r.ok, true, `diffs=${r.diffs.join(',')} errors=${JSON.stringify(r.errors)}`);
  assert.equal(r.proj.panel.debt, null);
  assert.equal(r.proj.audit.debt, null);
});

test('反例：任一端 debt 被改 1 分 → diffProjections 必须点名该端', async () => {
  const r = await runMatrix({ issueKey: 'KAN-3', mode: 'fixture' });
  const tampered = JSON.parse(JSON.stringify(r.proj));
  tampered.agent.debt += 1;
  const diffs = diffProjections(tampered);
  assert.ok(diffs.includes('agent'));
});

test('反例：任一端 criteria 状态被翻 → 必须被拒绝', async () => {
  const r = await runMatrix({ issueKey: 'KAN-3', mode: 'fixture' });
  const tampered = JSON.parse(JSON.stringify(r.proj));
  const c = tampered.mcp.criteria.find((x) => x.state === 'hit');
  c.state = 'clear';
  assert.ok(diffProjections(tampered).includes('mcp'));
});
