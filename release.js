'use strict';

/**
 * 一条命令回答"现在能不能提交"。
 *
 * ci:release 原来的写法是 && 串联：marketplace 一红，proof 就不再生成，
 * 于是"最该看证据的时刻"恰恰没有证据。这里改成顺序执行、逐项记账，
 * 并把"用户侧才有的占位符"与"工程侧的真失败"分开报，退出码只对后者非零。
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const step = (label, script, args = []) => {
  const res = spawnSync(process.execPath, [path.join(__dirname, script), ...args], { encoding: 'utf8' });
  const out = (res.stdout || '').trim();
  // 有些脚本在结论后还会印 NEXT 指引；结论取"最后一条不是指引"的行。
  const lines = out.split(/\r?\n/).filter((l) => l.trim() && !/^NEXT\b/.test(l.trim()));
  return { label, code: res.status, summary: lines[lines.length - 1] || '' };
};

const steps = [
  step('manifest', 'manifest.check.js'),
  step('verify', 'verify.js'),
  step('bench', 'bench.js'),
  // 文档里的断言数必须等于刚跑出来的数字；漂移了就在这里红，而不是等评审点开发现。
  step('docs', path.join('tools', 'sync-counts.js'), ['--check']),
  step('marketplace', path.join('marketplace', 'check.js')),
];

// proof 永远最后跑：它记录的是上面这些步骤在这棵树上的真实结果
const proof = step('proof', 'proof.js');

const hard = steps.filter((s) => s.label !== 'marketplace' && s.code !== 0);
const marketplace = steps.find((s) => s.label === 'marketplace');

for (const s of steps) {
  // marketplace 有三种结果：0 READY / 3 只剩账号项 / 2 工程侧真失败。
  const label = s.code === 0 ? 'PASS' : s.code === 3 ? 'TODO' : 'FAIL';
  process.stdout.write(`${s.label.padEnd(12)} ${label}  ${s.summary}\n`);
}
process.stdout.write(`${proof.label.padEnd(12)} ${proof.code === 0 ? 'PASS' : 'FAIL'}  ${proof.summary}\n`);

if (hard.length) {
  process.stdout.write(`\nrelease  BLOCKED  工程侧失败 ${hard.length} 项：${hard.map((s) => s.label).join(', ')}\n`);
  process.exit(1);
}

if (marketplace && marketplace.code === 2) {
  process.stdout.write('\nrelease  BLOCKED  上架自证有工程侧失败（看 marketplace 那一行哪条是 FAIL）\n');
  process.exit(1);
}

if (marketplace && marketplace.code === 3) {
  process.stdout.write('\nrelease  READY-EXCEPT-PLACEHOLDERS  工程全过；只剩注册站点后才能填的账号项\n');
  process.exit(0);
}

process.stdout.write('\nrelease  READY  可以提交\n');
process.exit(0);
