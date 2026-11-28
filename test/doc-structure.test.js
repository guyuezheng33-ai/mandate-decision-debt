'use strict';

/**
 * D9 · METHOD.md 结构断言的反例测试 + 对真实文档的守卫。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { methodDocCheck, statusBaselineCheck } = require('../tools/doc-structure');

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

const STATUS = '状态基线: 2026-11-28\n| 视频 | 已产出：90s MP4 |\n| seed | 真实项目 seed 0/21 待 owner |\n';
const DOC_OK = '状态基线：docs/STATUS.md（2026-11-28）\n视频已产出，YouTube 待上传。';

test('statusBaseline：日期 + 引用齐全且无相反陈述 → PASS', () => {
  const r = statusBaselineCheck(STATUS, [{ name: '00', text: DOC_OK }]);
  assert.equal(r.status, 'PASS', r.detail);
});

test('statusBaseline：文档写「视频不存在」与 STATUS 相反 → FAIL（D8 验收反例）', () => {
  const bad = DOC_OK + '\n① 视频不存在；② 没有 YouTube 链接。';
  const r = statusBaselineCheck(STATUS, [{ name: '10', text: bad }]);
  assert.equal(r.status, 'FAIL');
  assert.ok(r.detail.includes('相反'));
});

test('statusBaseline：缺基线日期 / 缺引用 / 日期不一致 → FAIL', () => {
  assert.equal(statusBaselineCheck('没有日期', [{ name: '00', text: DOC_OK }]).status, 'FAIL');
  assert.equal(statusBaselineCheck(STATUS, [{ name: '00', text: '2026-11-28 状态良好' }]).status, 'FAIL');
  assert.equal(statusBaselineCheck(STATUS, [{ name: '00', text: 'docs/STATUS.md（2026-11-22）' }]).status, 'FAIL');
});

test('statusBaseline：仓库真实 STATUS + 00/07/10 必须一致', () => {
  const root = path.resolve(__dirname, '..');
  const desktop = path.resolve(root, '..');
  const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
  const r = statusBaselineCheck(readIf(path.join(root, 'docs', 'STATUS.md')), [
    { name: '00', text: readIf(path.join(desktop, '00_你手上的事_操作手册.md')) },
    { name: '07', text: readIf(path.join(desktop, '07_Devpost提交稿.md')) },
    { name: '10', text: readIf(path.join(desktop, '10_评审打分表.md')) },
  ]);
  assert.equal(r.status, 'PASS', r.detail);
});
