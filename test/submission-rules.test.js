'use strict';

/**
 * D6 · 提交面硬规则的反例测试。
 * 每条都是一个「如果实现放水就会漏过」的坏输入，必须被拒绝。
 */

const test = require('node:test');
const assert = require('node:assert');
const { videoHostCheck, sourceHonestyCheck } = require('../tools/submission-rules');

const vp = (url) => `| Video | [90-second demo](${url}) — happy path included |\n`;

test('videoHost：catbox 直链必须 FAIL（上一轮漏检的根因）', () => {
  const r = videoHostCheck(vp('https://files.catbox.moe/l0iw16.mp4'), '');
  assert.equal(r.status, 'FAIL');
  assert.ok(r.detail.includes('catbox'));
});

test('videoHost：Vimeo 必须 FAIL', () => {
  assert.equal(videoHostCheck(vp('https://vimeo.com/123456'), '').status, 'FAIL');
});

test('videoHost：YouTube watch / youtu.be 短链 PASS', () => {
  assert.equal(videoHostCheck(vp('https://www.youtube.com/watch?v=abc123'), '').status, 'PASS');
  assert.equal(videoHostCheck(vp('https://youtu.be/abc123'), '').status, 'PASS');
});

test('videoHost：Video 字段无链接 FAIL', () => {
  assert.equal(videoHostCheck('| Video | 待上传 |\n', '').status, 'FAIL');
});

test('videoHost：肯定语境的 Unlisted 表述 FAIL，否定/规则语境放行', () => {
  const yes = videoHostCheck(vp('https://youtu.be/a'), '8. 上传 YouTube（Unlisted），标题 Mandate');
  assert.equal(yes.status, 'FAIL');
  const no = videoHostCheck(vp('https://youtu.be/a'), '8. 上传 YouTube 并设为 public（不接受 Unlisted 或私有链接）');
  assert.equal(no.status, 'PASS');
});

const sec = (prose, json) => `# page\n\n## Call X\n\n${prose}\n\n\`\`\`json\n${json}\n\`\`\`\n`;
const OK_FIXTURE = '{ "ok": true, "issueKey": "KAN-3", "source": "fixture" }';

test('sourceHonesty：fixture 块被散文称为 live 抓包 → FAIL', () => {
  const r = sourceHonestyCheck(sec('This is a live capture from the tenant.', OK_FIXTURE));
  assert.equal(r.status, 'FAIL');
  assert.ok(r.detail.includes('live'));
});

test('sourceHonesty：fixture 块如实标注 fixture port → PASS', () => {
  const r = sourceHonestyCheck(sec('Abridged; the real payload from the fixture port, not a mock-up.', OK_FIXTURE));
  assert.equal(r.status, 'PASS');
});

test('sourceHonesty：响应块不自报 source → FAIL', () => {
  const r = sourceHonestyCheck(sec('Response:', '{ "ok": true, "issueKey": "KAN-3" }'));
  assert.equal(r.status, 'FAIL');
  assert.ok(r.detail.includes('source'));
});

test('sourceHonesty：scan.source 也算自报；twg/rest 放行', () => {
  const scan = '{ "ok": true, "projectKey": "KAN", "scan": { "source": "rest", "cap": 8 } }';
  assert.equal(sourceHonestyCheck(sec('Response:', scan)).status, 'PASS');
  const twg = '{ "ok": true, "issueKey": "MOBL-57", "source": "twg" }';
  assert.equal(sourceHonestyCheck(sec('Live tenant response.', twg)).status, 'PASS');
});

test('sourceHonesty：没有任何响应块 → FAIL（空页不许蒙混）', () => {
  assert.equal(sourceHonestyCheck('# page\n\n## nothing\n\ntext only').status, 'FAIL');
});
