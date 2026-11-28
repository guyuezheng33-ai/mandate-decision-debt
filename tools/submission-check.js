'use strict';

/**
 * submission-check · 提交面自检
 *
 * 工程闸门（full-check）证明代码能跑；这个脚本只回答一个问题：
 * **把这份材料原样交上去，评审会不会看到自相矛盾、占位符、或兑现不了的 claim。**
 *
 * 它不检查代码，只检查提交面：
 *   1. counts      文档里的断言数必须与 docs/verification.md 一致
 *   2. placeholders 提交稿/listing/manifest 里不能有未填的账号项
 *   3. fields      Devpost 必填字段与非空值
 *   4. bonuses     四个 bonus 的模块与材料逐一对得上
 *   5. banned      没有样本支撑的百分比、或"真实客户"类说法
 *   6. video       脚本时长 ≤ 5:00，且首帧在 Jira
 *   7. access      评审真的点得开（安装链接不是占位符）
 *   8. videoHost   Video 字段必须是 YouTube 公开链接（拒 catbox/Vimeo/Unlisted）
 *   9. sourceHonesty MCP 示例响应块必须自报 source；fixture 不许被称 live
 *
 * 退出码：0 = PASS 或只剩账号项（TODO）；1 = 有自相矛盾/假 claim（FAIL）
 *   node tools/submission-check.js
 *   node tools/submission-check.js --strict   # TODO 也算失败（临提交前用）
 */

const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.resolve(ROOT, '..');
const STRICT = process.argv.includes('--strict');

const rows = [];
const record = (name, status, detail) => rows.push({ name, status, detail });

const read = (rel) => {
  const p = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const readDoc = (name) => read(path.join(DOCS, name));

const devpost = readDoc('07_Devpost提交稿.md');
const script = readDoc('06_视频脚本_90秒.md');
const listing = read('marketplace/listing.md');
const privacy = read('marketplace/privacy-policy.md');
const manifest = read('manifest.yml');
const verification = read('docs/verification.md');

const countMatch = verification.match(/(\d+)\s+assertions\s+·\s+all passing/);
const VERIFY = countMatch ? Number(countMatch[1]) : null;

const { videoHostCheck, sourceHonestyCheck } = require('./submission-rules');

// 1) 断言数：提交面文档里任何 "N assertions / N 条断言" 都必须等于证明文件的数字
{
  if (!VERIFY) {
    record('counts', 'FAIL', 'docs/verification.md 里找不到 "N assertions · all passing"');
  } else {
    const sources = [
      ['07', devpost],
      ['README', read('README.md')],
      ['README.zh', read('README.zh.md')],
      ['06', script],
      ['listing', listing],
    ];
    const bad = [];
    let seen = 0;
    for (const [name, text] of sources) {
      for (const m of text.matchAll(/(\d+)\s+(?:offline\s+)?assertions?|(\d+)\s*条断言/gi)) {
        seen += 1;
        const n = Number(m[1] || m[2]);
        if (n !== VERIFY) bad.push(`${name}:${n}`);
      }
    }
    record(
      'counts',
      bad.length ? 'FAIL' : 'PASS',
      bad.length ? `与 ${VERIFY} 不一致 → ${bad.join(', ')}` : `${seen} 处引用全部 = ${VERIFY}`
    );
  }
}

// 2) 账号类占位符：只扫会被评审看到的文件；作战文档（00/04/05）允许保留说明性占位
{
  const checks = [
    ['07 video', /\[YouTube[^\]]*\]/.test(devpost)],
    ['07 try-it-out', /\[Marketplace listing URL[^\]]*\]/.test(devpost)],
    ['07 repo', /\[GitHub[^\]]*\]/.test(devpost)],
    ['07 tester quote', /\{quote\}/.test(script)],
    ['manifest app.id', /REPLACE_AFTER_FORGE_REGISTER/.test(manifest)],
    ['manifest icon', /REPLACE_WITH_ICON_URL/.test(manifest)],
    ['listing email', /REPLACE_WITH_SUPPORT_EMAIL/.test(listing)],
    ['listing privacy URL', /REPLACE_WITH_PRIVACY_URL/.test(listing)],
    ['privacy email', /REPLACE_WITH_SUPPORT_EMAIL/.test(privacy)],
  ];
  const open = checks.filter(([, missing]) => missing).map(([name]) => name);
  record(
    'placeholders',
    open.length ? 'TODO' : 'PASS',
    open.length ? `${open.length} 项待账号/托管后填：${open.join(' · ')}` : '无占位符'
  );
}

// 3) Devpost 必填字段：值不能为空，也不能是模板括号
{
  // 07 的字段名是给人看的（Tagline 带长度说明、Category 叫"赛道"），按前缀匹配。
  const need = ['Project name', 'Tagline', '赛道', 'Bonus prizes', 'Video', 'Try it out', 'Repo'];
  const missing = [];
  const lines = devpost.split(/\r?\n/);
  for (const field of need) {
    const line = lines.find((l) => l.trim().startsWith(`| ${field}`));
    if (!line) missing.push(`${field}: 缺行`);
    else {
      const value = (line.split('|')[2] || '').trim();
      if (!value) missing.push(`${field}: 空`);
    }
  }
  record('fields', missing.length ? 'FAIL' : 'PASS', missing.length ? missing.join(' · ') : `${need.length} 个必填字段有值`);
}

// 4) 四个 bonus：模块在 manifest，材料在提交稿
{
  const moduleOk =
    /\n\s+rovo:agent:/.test(manifest) && /\n\s+rovo:mcp:/.test(manifest) && /-\s*read:graph:/.test(manifest);
  const named = ['Best Agents', 'Best MCP', 'Best TWG', 'Best Marketplace'].filter((b) => devpost.includes(b));
  const ok = moduleOk && named.length === 4;
  record(
    'bonuses',
    ok ? 'PASS' : 'FAIL',
    `${moduleOk ? 'agent+mcp+graph 在位' : '模块缺失'} · 提交稿点名 ${named.length}/4`
  );
}

// 5) 没有样本支撑的说法：只拦会被评审抓住的那几类
{
  const files = [['07', devpost], ['06', script], ['listing', listing]];
  const negated = /不能|不要|禁止|不得|never|don't|do not|avoid/i;
  const hits = [];
  for (const [name, text] of files) {
    for (const line of text.split(/\r?\n/)) {
      if (negated.test(line)) continue; // "不能说所有行业" 是规则，不是 claim
      const pct = /(\b\d{1,3}\s*%\s*(faster|less|fewer|reduction|improvement|increase)|效率\s*提升\s*\d+\s*%|返工\s*减少\s*\d+\s*%)/i;
      if (pct.test(line)) hits.push(`${name}: ${line.trim().slice(0, 60)}`);
      for (const phrase of ['all industries', '所有行业', 'real customer site', '真实客户站点']) {
        if (line.toLowerCase().includes(phrase.toLowerCase())) hits.push(`${name}: ${phrase}`);
      }
    }
  }
  record('banned', hits.length ? 'FAIL' : 'PASS', hits.length ? `无样本 claim：${hits.join(' | ')}` : '无百分比/全行业/真实客户类说法');
}

// 6) 视频：脚本必须 ≤ 5:00，且 0:00 在 Jira（评审第一眼要看出这是 Atlassian 平台）
{
  const times = [...script.matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));
  const max = times.length ? Math.max(...times) : null;
  const opensInJira = /0:00[^\n]*Jira|Jira[^\n]*0:00/.test(script);
  const ok = max !== null && max <= 300 && opensInJira;
  record(
    'video',
    ok ? 'PASS' : 'FAIL',
    `${max === null ? '脚本无时间码' : `最长 ${Math.floor(max / 60)}:${String(max % 60).padStart(2, '0')}（上限 5:00）`}` +
      ` · 首帧 ${opensInJira ? 'Jira' : '未见 Jira'}`
  );
}

// 7) 访问：Stage One 是 pass/fail —— 评审点不开，后面四项都不算分
{
  const row = devpost.split(/\r?\n/).find((l) => l.trim().startsWith('| Try it out |')) || '';
  const usable = /https?:\/\/\S+/.test(row) && !/\[/.test(row);
  record('access', usable ? 'PASS' : 'TODO', usable ? '安装/试用链接已填' : '安装链接仍是占位符（Stage One 风险）');
}

// 8) 视频托管：官方要 public 视频；catbox/Vimeo/Unlisted 一律拒绝（D6）
{
  const r = videoHostCheck(devpost, script);
  record('videoHost', r.status, r.detail);
}

// 9) 来源诚实：MCP 示例的每个响应块自报 source；fixture 不许被散文称 live（D6）
{
  const r = sourceHonestyCheck(read('docs/mcp-examples.md'));
  record('sourceHonesty', r.status, r.detail);
}

const width = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) process.stdout.write(`${r.status.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}\n`);

const fail = rows.filter((r) => r.status === 'FAIL');
const todo = rows.filter((r) => r.status === 'TODO');
process.stdout.write(
  `\nsubmission check  ${fail.length ? 'BLOCKED' : todo.length ? 'PENDING-PLACEHOLDERS' : 'READY'}` +
    `  · 通过 ${rows.length - fail.length - todo.length}/${rows.length} · 待填 ${todo.length} · 失败 ${fail.length}\n`
);
if (fail.length) process.exit(1);
if (STRICT && todo.length) {
  process.stdout.write('--strict：待填项也必须清零才允许提交\n');
  process.exit(1);
}
process.exit(0);
