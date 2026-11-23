'use strict';

/**
 * 离线演示：不装 Forge、不连站点，也能看到"漂移卡长什么样"。
 * 用途有两个：seed 验证时逐条核对；视频里抓画面。
 *
 *   node cli.js                 # 列出样本
 *   node cli.js KAN-3           # 中文界面
 *   node cli.js KAN-3 --en      # 英文界面（录屏/评审用这个）
 *   node cli.js KAN-3 launch    # 换口径看同一条工作
 */

const path = require('node:path');
const { createFixturePort } = require('./src/ports/evidence.fixture');
const { createActions } = require('./src/resolvers/action');
const { getProfile, PROFILES } = require('./src/engine/profiles');

const dir = path.join(__dirname, 'src', 'fixtures');
const port = createFixturePort({ dir });
const actions = createActions({ evidencePort: port });

const UI = {
  en: {
    samples: 'Samples:\n',
    profiles: '\nProfiles: ',
    usage: 'usage: node cli.js KAN-3 [profile] [--en]\n',
    lens: 'Lens ',
    debt: 'Decision Debt',
    unknown: 'unknown (no score)',
    coverage: 'Coverage ',
    suppressed: (n, ps) => `  (${n} criteria suppressed: ${ps})`,
    unknownBody: 'No evidence chain at all — by rule, no score and no findings.\n',
    cleanBody: 'No criterion hit — this work can account for its own evidence.\n',
    weight: 'weight ',
    breakdown: 'Breakdown ',
    evidence: 'Evidence: ',
    join: ' · ',
  },
  zh: {
    samples: '样本：\n',
    profiles: '\n口径：',
    usage: '用法：node cli.js KAN-3 [profile]\n',
    lens: '口径 ',
    debt: '决策债',
    unknown: '不可知（不出分）',
    coverage: '覆盖 ',
    suppressed: (n, ps) => `  （${n} 条判据被抑制：${ps}）`,
    unknownBody: '这条工作的依据链一条都没拿到——按规则不出分，也不报问题。\n',
    cleanBody: '没有命中的判据——这项工作能说清自己的依据。\n',
    weight: '权重 ',
    breakdown: '拆解 ',
    evidence: '证据：',
    join: '、',
  },
};

function bar(debt) {
  const filled = Math.max(0, Math.min(20, Math.round(debt / 5)));
  return `${'█'.repeat(filled)}${'·'.repeat(20 - filled)}`;
}

async function main() {
  const args = process.argv.slice(2);
  const lang = args.includes('--en') ? 'en' : 'zh';
  const t = UI[lang];

  if (!args.length) {
    process.stdout.write(t.samples);
    for (const b of port.listBundles('KAN', 99)) process.stdout.write(`  ${b.issueKey}  ${b.summary}\n`);
    process.stdout.write(`${t.profiles}${Object.keys(PROFILES).join(' / ')}\n${t.usage}`);
    return;
  }

  const key = args[0];
  const positional = args.slice(1).filter((a) => !a.startsWith('-'));
  const profile = getProfile(positional[0] || 'software', lang);
  const r = await actions.getIssueProvenance({ inputs: { issueKey: key, profile: profile.key, lang } });

  if (!r.ok) {
    process.stdout.write(`${r.code} ${r.message}\n${r.hint}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\n${r.issueKey}  ${r.summary}\n`);
  process.stdout.write(`${t.lens}${profile.name}｜${profile.q}\n`);
  if (r.grade === 'unknown') {
    process.stdout.write(`${t.debt} —    ${bar(0)}  ${t.unknown}\n`);
  } else {
    process.stdout.write(`${t.debt} ${String(r.debt).padStart(3)}  ${bar(r.debt)}  ${r.grade}\n`);
  }
  process.stdout.write(
    `${t.coverage}${r.coverage.known}/${r.coverage.total}${
      r.suppressed.length ? t.suppressed(r.suppressed.length, r.suppressed.map((s) => s.p).join(',')) : ''
    }\n`,
  );
  // 一行拆解：分数 = 命中权重之和。没命中的印 0，没判的印 ?，两者不能混。
  const bits = (r.criteria || [])
    .map((c) => `${c.p} ${c.state === 'hit' ? `+${c.w}` : c.state === 'unknown' ? '?' : '0'}`)
    .join(' · ');
  process.stdout.write(`${t.breakdown}${bits}\n\n`);

  if (r.grade === 'unknown') {
    process.stdout.write(t.unknownBody);
  } else if (!r.flags.length) {
    process.stdout.write(t.cleanBody);
  }

  for (const f of r.flags) {
    process.stdout.write(`[${f.p}] ${f.label}  (${t.weight}${f.w})\n`);
    process.stdout.write(`     ${f.detail}\n`);
    process.stdout.write(`     → ${f.action}\n`);
    const src = (f.evidence && f.evidence.sources) || [];
    if (src.length) process.stdout.write(`     ${t.evidence}${src.map((s) => s.url || s.id).join(t.join)}\n`);
    process.stdout.write('\n');
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack}\n`);
  process.exitCode = 1;
});
