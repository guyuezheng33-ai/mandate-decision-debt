'use strict';

/**
 * 一条命令跑完全部自证，并且**跑两遍**来证明结果可复现。
 *
 * 这个脚本存在的理由很具体：反复回跑时冒出来的红，往往不是产品错，而是
 *   (a) 我改了代码但没同步文档 → docs:check 抓；
 *   (b) 只有账号能填的占位 → 单独记 TODO，不算失败；
 *   (c) 真的回归 → 只有这一类该让命令非零退出。
 * 把三类混在同一行红色里，真正该修的那条就会被淹掉。
 *
 * 判定：
 *   hard  失败 → exit 1（工程侧）
 *   TODO      → exit 0（只剩注册后才能填的账号项）
 *   全绿       → exit 0
 *
 * 用法：
 *   node tools/full-check.js           # 跑一遍 + 复跑校验
 *   node tools/full-check.js --once    # 只跑一遍（更快）
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ONCE = process.argv.includes('--once');

const rows = [];
const record = (name, status, detail) => rows.push({ name, status, detail });

function run(script, args = [], opts = {}) {
  const res = spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    timeout: opts.timeout || 240000,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  return { code: res.status, out, last: out.trim().split(/\r?\n/).filter(Boolean).pop() || '' };
}

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const totals = (text) => {
  const m = text.match(/total\s+(\d+)\/(\d+)/);
  return m ? { pass: Number(m[1]), total: Number(m[2]) } : null;
};

// 1) manifest 接线
{
  const r = run('manifest.check.js');
  record('manifest', r.code === 0 ? 'PASS' : 'FAIL', r.last);
}

// 2) 断言账：跑两遍，数字与结论必须一致
{
  const a = run('verify.js');
  const t1 = totals(a.out);
  const first = a.code === 0 && t1 && t1.pass === t1.total;
  if (ONCE || !first) {
    record('verify', first ? 'PASS' : 'FAIL', t1 ? `${t1.pass}/${t1.total}` : a.last);
  } else {
    const b = run('verify.js');
    const t2 = totals(b.out);
    const same = t2 && t1.pass === t2.pass && t1.total === t2.total && b.code === 0;
    record('verify ×2', same ? 'PASS' : 'FAIL', same ? `${t1.total}/${t1.total} 两次一致` : `第一遍 ${t1 && t1.total} · 第二遍 ${t2 && t2.total}`);
  }
}

// 3) 单元测试：node --test 直接跑，不靠 verify 的代跑
{
  const res = spawnSync(process.execPath, ['--test', 'test/*.test.js'], {
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 240000,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const pass = out.match(/# pass (\d+)/);
  const fail = out.match(/# fail (\d+)/);
  const ok = res.status === 0 && pass && fail && Number(fail[1]) === 0;
  record('test', ok ? 'PASS' : 'FAIL', pass && fail ? `${pass[1]} pass · ${fail[1]} fail` : out.trim().split(/\r?\n/).filter(Boolean).pop() || 'no output');
}

// 4) 文档里的断言数不许过期
{
  const r = run(path.join('tools', 'sync-counts.js'), ['--check']);
  record('docs', r.code === 0 ? 'PASS' : 'FAIL', r.last);
}

// 5) 语料报告：跑两遍，字节必须一致（否则"可复现"是假的）
{
  const outFile = path.join(ROOT, 'docs', 'corpus-report.md');
  const first = run(path.join('tools', 'corpus-report.js'));
  const h1 = fs.existsSync(outFile) ? sha(outFile) : null;
  if (ONCE || first.code !== 0) {
    record('corpus', first.code === 0 ? 'PASS' : 'FAIL', first.last);
  } else {
    const second = run(path.join('tools', 'corpus-report.js'));
    const h2 = fs.existsSync(outFile) ? sha(outFile) : null;
    const same = second.code === 0 && h1 && h1 === h2;
    record('corpus ×2', same ? 'PASS' : 'FAIL', same ? '生成物两次字节一致' : '两次生成的报告不一致（输出不稳定）');
  }
}

// 6) 性能：只审计不阻塞；超预算才算失败。
//    跑两次取较快的一次：这台机器上 bench 会因负载在 120–165ms 之间摆动，
//    拿单次读数去卡 300ms 的预算，会制造"机器忙就变红"的假失败。
{
  const a = run('bench.js');
  const b = ONCE ? { out: '' } : run('bench.js');
  const ms = (t) => {
    const m = t.match(/(\d+(?:\.\d+)?)\s*ms/);
    return m ? Number(m[1]) : null;
  };
  const v1 = ms(a.out);
  const v2 = ms(b.out);
  const best = v1 === null ? v2 : v2 === null ? v1 : Math.min(v1, v2);
  const ok = a.code === 0 && best !== null && best <= 300;
  record('bench', ok ? 'PASS' : 'FAIL', best === null ? a.last : `${best}ms（预算 300ms${v2 !== null ? `，两次 ${v1}/${v2}` : ''}）`);
}

// 7) 上架自证：0 READY / 3 只剩账号项 / 2 工程失败
{
  const r = run(path.join('marketplace', 'check.js'));
  const status = r.code === 0 ? 'PASS' : r.code === 3 ? 'TODO' : 'FAIL';
  // 结论行固定是 "marketplace check ..."；它后面还会跟 NEXT 指引，所以不能取最后一行。
  const verdict = (r.out.match(/^marketplace check.*$/m) || [r.last])[0];
  record('marketplace', status, verdict);
}

// 8) 数据包探针：26/26 校验、21 条对齐、写回读。
//    语料目录不在（换机器 / 被移走）时记 SKIP，不算工程失败——它验证的是数据，不是代码。
{
  const inbox = path.resolve(ROOT, '..', 'data-inbox');
  if (!fs.existsSync(inbox)) {
    record('probe', 'SKIP', 'data-inbox 不在，跳过语料校验');
  } else {
    const r = run(path.join('tools', 'mandate_probe.js'));
    const files = r.out.match(/(\d+)\/(\d+)\s*文件校验通过/);
    const label = r.out.match(/对齐\s+(\d+)\/(\d+)/);
    const ok = r.code === 0 && files && files[1] === files[2] && label && label[1] === label[2];
    record('probe', ok ? 'PASS' : 'FAIL', files ? `文件 ${files[1]}/${files[2]} · 标签 ${label ? `${label[1]}/${label[2]}` : '—'}` : r.last);
  }
}

// 9) 提交面：数字自洽、占位符、bonus 对应、无样本 claim、视频时长、访问链接。
//    这是"代码没问题但材料扣分"的那一类，单列，不混进工程口径。
{
  const r = run(path.join('tools', 'submission-check.js'));
  const status = r.code === 0 ? (/(TODO)/.test(r.out) ? 'TODO' : 'PASS') : 'FAIL';
  const verdict = (r.out.match(/^submission check.*$/m) || [r.last])[0];
  record('submission', status, verdict);
}

// 10) 评估证据：数学四件套与增量重放必须同时成立
{
  const e = run(path.join('tools', 'authority-eval.js'));
  const inc = run(path.join('tools', 'incremental-eval.js'));
  const evalOk = e.code === 0 && /f1=.*baseline=.*diffCI=.*holdout=.*p2Flip=/.test(e.out);
  const incOk = inc.code === 0 && /invariants=PASS/.test(inc.out);
  record('eval', evalOk ? 'PASS' : 'FAIL', e.last);
  record('incremental', incOk ? 'PASS' : 'FAIL', inc.last);
}

// 11) 证据文件：最后生成，记录上面这些真实结果
{
  const r = run('proof.js');
  record('proof', r.code === 0 ? 'PASS' : 'FAIL', r.last);
}

const width = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) process.stdout.write(`${r.status.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}\n`);

const hardFail = rows.filter((r) => r.status === 'FAIL');
const todo = rows.filter((r) => r.status === 'TODO');
const skip = rows.filter((r) => r.status === 'SKIP');
const clean = rows.length - hardFail.length - todo.length - skip.length;
process.stdout.write(
  `\nfull-check  ${hardFail.length ? 'BLOCKED' : todo.length ? 'CLEAN-EXCEPT-PLACEHOLDERS' : skip.length ? 'CLEAN-EXCEPT-SKIPS' : 'CLEAN'}` +
    `  工程 ${clean}/${rows.length - todo.length - skip.length} · 待填 ${todo.length} · 跳过 ${skip.length} · 失败 ${hardFail.length}\n`
);
process.exit(hardFail.length ? 1 : 0);
