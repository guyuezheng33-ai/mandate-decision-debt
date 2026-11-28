'use strict';

/**
 * 文档里的断言数不该手抄。
 *
 * `verify` 每次加一条断言，README、验证协议、Devpost 稿、数据包记录里的数字就全部过期；
 * 手改四份文本迟早漏一处，而漏的那一处恰好会在评审点开时被看到。
 *
 * 这个脚本跑一次 verify，把真实结果**回填**进所有写死了数字的文件：
 *   - 逐组的 `name n/n`（compact 10/10 这类）
 *   - 末尾 `total N/N  => PASS`
 *   - 正文里的 `N assertions` / `N 条断言` / `**N 条**`
 *
 * 它只改数字，不改句子。用法：
 *   node tools/sync-counts.js          # 回填
 *   node tools/sync-counts.js --check  # 只检查，有漂移就 exit 1（可挂进 CI）
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DESKTOP = path.resolve(ROOT, '..');
const CHECK = process.argv.includes('--check');

const FILES = [
  path.join(ROOT, 'README.md'),
  path.join(ROOT, 'README.zh.md'),
  path.join(ROOT, 'docs', 'verification.md'),
  path.join(DESKTOP, '02_验证协议与实现范围.md'),
  path.join(DESKTOP, '07_Devpost提交稿.md'),
  path.join(DESKTOP, '09_数据包回灌_变更说明.md'),
  path.join(ROOT, 'docs', 'data-inbox-verification.md'),
];

function runVerify() {
  try {
    return execFileSync(process.execPath, [path.join(ROOT, 'verify.js')], { encoding: 'utf8' });
  } catch (err) {
    // verify 失败也要读 stdout：数字照样要回填，失败与否由 CI 判断。
    return String(err.stdout || '');
  }
}

const out = runVerify();
const totalLine = out.split(/\r?\n/).find((l) => /total\s+\d+\/\d+/.test(l)) || '';
const totals = totalLine.match(/total\s+(\d+)\/(\d+)/);
if (!totals) {
  console.error('读不到 verify 的 total 行，什么都没改。输出：');
  console.error(out.trim() || '(empty)');
  process.exit(1);
}
const passed = Number(totals[1]);
const total = Number(totals[2]);

const suites = {};
for (const m of totalLine.matchAll(/([a-z][a-z0-9-]+)\s+(\d+)\/(\d+)/g)) {
  const [, name, , denom] = m;
  if (name === 'total') continue;
  suites[name] = Number(denom);
}

let drift = 0;
const report = [];

for (const file of FILES) {
  if (!fs.existsSync(file)) {
    report.push(`skip    ${path.relative(DESKTOP, file)}（不存在）`);
    continue;
  }
  const original = fs.readFileSync(file, 'utf8');
  let text = original;

  // 1) 逐组 n/n → 真实值（同一组可能在文档里出现多次）
  //    必须要求名字前面是空白或行首：否则 `entry 9/9` 会匹配进 `agent-entry 9/9` 里面，
  //    先把 agent-entry 改成 15/15，再被 entry 那条改回 9/9——两组互相覆盖，永远是错的。
  for (const [name, denom] of Object.entries(suites)) {
    const re = new RegExp(`(^|\\s)(${name}\\s+)(\\d+)/(\\d+)`, 'g');
    text = text.replace(re, (all, lead, pre) => `${lead}${pre}${denom}/${denom}`);
  }

  // 2) total N/N（含 `verify: N/N PASS` 这种简写）
  text = text.replace(/(verify:\s*)(\d+)\/(\d+)/g, (all, pre) => `${pre}${passed}/${total}`);
  text = text.replace(/total\s+(\d+)\/(\d+)(\s*=>\s*(PASS|FAIL))?/g, (all, a, b, tail) => {
    const verdict = tail ? `  => ${passed === total ? 'PASS' : 'FAIL'}` : '';
    return `total ${passed}/${total}${verdict}`;
  });

  // 3) 正文里的总数（四种写法；offline 变体须先于裸 assertions 处理）
  text = text.replace(/(\d+)\s+offline\s+assertions/gi, `${total} offline assertions`);
  text = text.replace(/(\d+)\s+assertions/g, `${total} assertions`);
  text = text.replace(/(\d+)\s+条断言/g, `${total} 条断言`);
  text = text.replace(/\*\*(\d+)\s+条\*\*/g, `**${total} 条**`);

  if (text !== original) {
    drift += 1;
    if (!CHECK) fs.writeFileSync(file, text, 'utf8');
    report.push(`${CHECK ? 'DRIFT  ' : 'patched'} ${path.relative(DESKTOP, file)}`);
  } else {
    report.push(`ok      ${path.relative(DESKTOP, file)}`);
  }
}

console.log(`verify ${passed}/${total} · ${Object.keys(suites).length} suites`);
for (const line of report) console.log(line);

// D9 · 结构断言：METHOD.md 必须可独立引用（缺章节 = 漂移，--check 时 FAIL）
{
  const { methodDocCheck } = require('./doc-structure');
  const methodPath = path.join(ROOT, 'docs', 'METHOD.md');
  const text = fs.existsSync(methodPath) ? fs.readFileSync(methodPath, 'utf8') : '';
  const r = methodDocCheck(text);
  console.log(`${r.status === 'PASS' ? 'ok     ' : 'DRIFT  '} docs/METHOD.md  ${r.detail}`);
  if (r.status !== 'PASS') drift += 1;
}

if (CHECK && drift > 0) {
  console.error(`\n${drift} 处文档漂移（断言数或 METHOD.md 结构）：数字跑 node tools/sync-counts.js 回填；结构缺章节须补写 docs/METHOD.md。`);
  process.exit(1);
}
console.log(CHECK ? '\n文档与断言数一致。' : `\n回填完成：${drift} 个文件。`);
