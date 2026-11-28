'use strict';

/**
 * D9 · METHOD.md 结构断言的反例测试 + 对真实文档的守卫。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { methodDocCheck } = require('../tools/doc-structure');

const FULL = [
  '# METHOD',
  '## 1. Formal model',
  'debt(w) = Σ weight(c)',
  '## 2. Falsifiable conditions',
  '| F1 | ceiling | npm test |',
  '## 3. Applicability boundaries',
  'read-only',
  '## 4. Reproduction kit',
  'test/fixtures/inbox',
  'npm run check',
  'LIMIT=30 node scripts/real-audit.js',
].join('\n');

test('methodDoc：完整结构 PASS', () => {
  assert.equal(methodDocCheck(FULL).status, 'PASS');
});

test('methodDoc：缺「可证伪条件」独立章节 → FAIL（D9 验收反例）', () => {
  const noFals = FULL.replace('## 2. Falsifiable conditions', '## 2. Notes');
  const r = methodDocCheck(noFals);
  assert.equal(r.status, 'FAIL');
  assert.ok(r.detail.includes('可证伪条件'));
});

test('methodDoc：空文档 / 缺边界 / 缺复跑入口 → FAIL', () => {
  assert.equal(methodDocCheck('').status, 'FAIL');
  assert.equal(methodDocCheck(FULL.replace('## 3. Applicability boundaries', '## 3. Misc')).status, 'FAIL');
  assert.equal(methodDocCheck(FULL.replace('npm run check', 'npm test')).status, 'FAIL');
});

test('methodDoc：仓库里真实的 docs/METHOD.md 必须通过结构断言', () => {
  const p = path.resolve(__dirname, '..', 'docs', 'METHOD.md');
  const r = methodDocCheck(fs.readFileSync(p, 'utf8'));
  assert.equal(r.status, 'PASS', r.detail);
});
