'use strict';

/**
 * 把 `data-inbox` 这一包语料跑成一张**可复现的报告**（docs/corpus-report.md）。
 *
 * 为什么要有它：截图能证明"界面长这样"，探针能证明"数字对得上"，但评审没法自己
 * 把 21 条语料喂进引擎。这个脚本就是那条命令——一条命令重算报告，任何人 run 一次
 * 都能得到同一份表，没有一处数字是手填的。
 *
 * 三条口径必须写在代码里，否则报告会被读成校准：
 * 1. `human_label` 是**生成器自己打的标签**（同源），所以"17/17 命中"只证明管道自洽，
 *    不证明判断正确。报告里明确写这句话，不靠读者自己怀疑。
 * 2. `humans/labels.csv` 是 4 位评分人的**占位骨架**（`raters.md` 自述），
 *    `would_check` 只是计数，不能当"从业者认同率"。
 * 3. 报告只输出引擎算出来的东西；不同口径的差异必须显式并列，不取平均。
 *
 * 用法：
 *   node tools/corpus-report.js                 # 读 ../data-inbox，写 ../docs/corpus-report.md
 *   node tools/corpus-report.js <inbox> <out>   # 显式指定
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { parseCsv, bundleFromRow } = require('./seed-bundles');
const { summarize, score_project } = require('../src/engine/score');
const { getProfile, PROFILES } = require('../src/engine/profiles');

const ROOT = path.resolve(__dirname, '..');
const INBOX = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(ROOT, '..', 'data-inbox');
const OUT = process.argv[3] ? path.resolve(process.argv[3]) : path.resolve(ROOT, 'docs', 'corpus-report.md');

const LABEL_TO_P = {
  无依据: 'P1',
  依据过时: 'P2',
  依据冲突: 'P3',
  目标漂移: 'P4',
  反复翻案: 'P5',
  单人无复核: 'P6',
};

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** manifest.json 里逐文件登记了 sha256：报告先证明"读的是同一份数据"。 */
function verifyManifest() {
  const mf = JSON.parse(fs.readFileSync(path.join(INBOX, 'manifest.json'), 'utf8'));
  const files = mf.files || mf.entries || mf;
  const list = Array.isArray(files) ? files : Object.values(files);
  const rows = list
    .map((f) => (typeof f === 'string' ? { path: f } : f))
    .map((f) => {
      const rel = f.path || f.file || f.name;
      const file = path.join(INBOX, rel);
      const ok = fs.existsSync(file) && (!f.sha256 || sha256(file) === f.sha256);
      return { rel, ok, declared: Boolean(f.sha256) };
    });
  return {
    total: rows.length,
    ok: rows.filter((r) => r.ok).length,
    hashChecked: rows.filter((r) => r.declared).length,
    failed: rows.filter((r) => !r.ok).map((r) => r.rel),
    generator: mf.generator || null,
    tier: mf.tier || null,
    seed: mf.seed || null,
    asOf: mf.asOf || mf.as_of || null,
  };
}

const money = (n) => (n === null || n === undefined ? '—' : String(n));
const sign = (n) => (n > 0 ? `+${n}` : String(n));

function main() {
  if (!fs.existsSync(path.join(INBOX, 'site', 'seed-21.csv'))) {
    console.error(`找不到语料：${path.join(INBOX, 'site', 'seed-21.csv')}`);
    console.error('把 data-inbox 放到 repo 同级目录，或用第一个参数指定路径。');
    process.exit(1);
  }

  const man = verifyManifest();
  const seedRows = parseCsv(fs.readFileSync(path.join(INBOX, 'site', 'seed-21.csv'), 'utf8'));
  const labelRows = fs.existsSync(path.join(INBOX, 'humans', 'labels.csv'))
    ? parseCsv(fs.readFileSync(path.join(INBOX, 'humans', 'labels.csv'), 'utf8'))
    : [];

  const raters = new Map();
  for (const l of labelRows) {
    const k = l.issue_key;
    const cur = raters.get(k) || { total: 0, check: 0, types: new Set() };
    cur.total += 1;
    cur.check += Number(l.would_check) || 0;
    if (l.problem_type) cur.types.add(l.problem_type);
    raters.set(k, cur);
  }

  const lenses = Object.keys(PROFILES);
  const per = {};
  for (const lens of lenses) {
    const profile = getProfile(lens);
    const agg = score_project(seedRows.map((r) => bundleFromRow(r)), profile);
    per[lens] = {
      agg,
      rows: seedRows.map((r) => {
        const s = summarize(bundleFromRow(r), profile);
        return { key: r.issue_key, s, flags: s.criteria.filter((c) => c.state === 'hit').map((c) => c.p), row: r };
      }),
    };
  }

  // 标签对齐只看 software：三口径的判据集合完全相同，差别只在权重。
  const base = per.software.rows;
  const labelled = base.filter((x) => LABEL_TO_P[x.row.human_label]);
  const hit = labelled.filter((x) => x.flags.includes(LABEL_TO_P[x.row.human_label]));
  const clean = base.filter((x) => !LABEL_TO_P[x.row.human_label]);
  const cleanHit = clean.filter((x) => x.flags.length > 0);

  const disagreements = [];
  for (const x of labelled) {
    const p = LABEL_TO_P[x.row.human_label];
    const r = raters.get(x.key);
    const would = r ? r.check : 0;
    if (!x.flags.includes(p)) {
      disagreements.push(
        `| \`${x.key}\` | ${x.row.human_label} | ${x.flags.join(',') || '—'} | ${money(x.s.debt)} ${x.s.grade} | ${would}/${r ? r.total : 0} | 标签判据未被命中 |`
      );
    } else if (x.flags.length === 0 && would > 0) {
      disagreements.push(`| \`${x.key}\` | ${x.row.human_label} | — | 0 healthy | ${would}/${r ? r.total : 0} | 有分无 finding |`);
    }
  }
  // 反向：引擎 healthy 但多数评分人说要查。
  for (const x of base) {
    const r = raters.get(x.key);
    if (!r || r.total === 0) continue;
    if (x.s.grade === 'healthy' && r.check > r.total / 2 && !disagreements.some((d) => d.includes(`\`${x.key}\``))) {
      disagreements.push(
        `| \`${x.key}\` | ${x.row.human_label || '（无标签）'} | ${x.flags.join(',') || '—'} | ${money(x.s.debt)} healthy | ${r.check}/${r.total} | 评分人多数要查、引擎判健康 |`
      );
    }
  }

  const lines = [];
  lines.push('# 语料报告：`data-inbox` 跑出来的每个数字');
  lines.push('');
  lines.push('> 本文件由 `node tools/corpus-report.js` 生成，**不要手改**。');
  lines.push('> 改完引擎重跑一次，表会自己变；哪张表变了，就是哪条判据变了。');
  lines.push('');
  lines.push('## 0. 这份语料是什么');
  lines.push('');
  lines.push(
    `- 来源：\`${path.basename(INBOX)}\`，tier=\`${man.tier || '?'}\`，生成器 \`${man.generator || '?'}\`，seed=\`${man.seed || '?'}\`，asOf=\`${man.asOf || '?'}\`。`
  );
  lines.push(
    `- 完整性：${man.total} 个文件登记、${man.hashChecked} 个带 sha256、本次校验通过 **${man.ok}/${man.total}**${man.failed.length ? `（失败：${man.failed.join(', ')}）` : ''}。`
  );
  lines.push(
    '- **它是受控仿真，不是真实站点抓取。** 下面的每一个数字都只能读成"这套逻辑在这份语料上算出了什么"，不能读成"真实团队的授权状况"。'
  );
  lines.push('');
  lines.push('## 1. 项目级：三口径并列（不取平均）');
  lines.push('');
  lines.push('| 口径 | 债 | 等级 | 可计/总数 | 有缺口 | 严重缺口 | 确定度 | 主要来源 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const lens of lenses) {
    const a = per[lens].agg;
    const drv = (a.drivers || []).slice(0, 4).map((d) => `${d.p} ${d.sum} (${d.items})`).join(' · ');
    lines.push(
      `| \`${lens}\` | **${money(a.debt)}** | \`${a.grade}\` | ${a.countedCount}/${a.total ?? a.itemCount} | ${a.flaggedCount} (${Math.round((a.flaggedShare || 0) * 100)}%) | ${a.severeCount} | ${a.certainty === null ? '—' : a.certainty.toFixed(2)} | ${drv || '—'} |`
    );
  }
  lines.push('');
  lines.push('三口径的判据集合完全相同，差别只在权重与英雄判据；所以**同一行在不同口径下分数不同、命中相同**。');
  lines.push('');
  lines.push('## 2. 等级分布');
  lines.push('');
  lines.push('| 口径 | healthy | watch | at_risk | critical | unknown |');
  lines.push('|---|---|---|---|---|---|');
  for (const lens of lenses) {
    const rows = per[lens].rows;
    const count = (g) => rows.filter((x) => x.s.grade === g).length;
    lines.push(`| \`${lens}\` | ${count('healthy')} | ${count('watch')} | ${count('at_risk')} | ${count('critical')} | ${count('unknown')} |`);
  }
  lines.push('');
  lines.push('## 3. 21 条逐条（software 口径）');
  lines.push('');
  lines.push('| key | 人类标签 | 命中判据 | 债 | 等级 | 确定度 | 评分人要查 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const x of base) {
    const r = raters.get(x.key);
    lines.push(
      `| \`${x.key}\` | ${x.row.human_label || '说不好'} | ${x.flags.join(',') || '—'} | ${money(x.s.debt)} | \`${x.s.grade}\` | ${x.s.certainty === null ? '—' : x.s.certainty.toFixed(2)} | ${r ? `${r.check}/${r.total}` : '—'} |`
    );
  }
  lines.push('');
  lines.push('## 4. 排序质量：有问题的是不是排在最前面');
  lines.push('');
  lines.push(
    '"这产品有没有用"最直接的回答不是均分，而是**有限的时间先看哪几条**。这里只看一个指标：'
      + '前 k 条里有多少条是语料标了问题的（标"说不好"记为干净），以及干净条目有没有被挤进前排。'
  );
  lines.push('');
  lines.push('| 口径 | precision@5 | precision@10 | 前 5 里的干净条目 |');
  lines.push('|---|---|---|---|');
  const isProblem = (key) => {
    const row = seedRows.find((r) => r.issue_key === key);
    return Boolean(row && LABEL_TO_P[row.human_label]);
  };
  for (const lens of lenses) {
    const ranked = per[lens].agg.items || [];
    const pAt = (k) => {
      const top = ranked.slice(0, k).filter((i) => i.debt !== null);
      if (!top.length) return null;
      return top.filter((i) => isProblem(i.issueKey)).length / top.length;
    };
    const cleanTop5 = ranked.slice(0, 5).filter((i) => !isProblem(i.issueKey)).length;
    const fmt = (v) => (v === null ? '—' : `${Math.round(v * 100)}%`);
    lines.push(`| \`${lens}\` | ${fmt(pAt(5))} | ${fmt(pAt(10))} | ${cleanTop5} |`);
  }
  lines.push('');
  lines.push(
    '- 这个指标只在"标签可信"的前提下有意义；标签同源，所以它测的是**排序是否对齐语料里的问题类型**，'
      + '不是"团队是否真的会先看这几条"。它的用处是排除一种失败：把干净条目排到前面、把有问题的压到后面。'
  );
  lines.push('');
  lines.push('## 5. 一致性与分歧');
  lines.push('');
  lines.push(`- 有标签的 **${labelled.length}** 条里，标签对应判据被引擎命中的 **${hit.length}** 条（${labelled.length ? Math.round((hit.length / labelled.length) * 100) : 0}%）。`);
  lines.push(`- 标"说不好"的干净样本 **${clean.length}** 条，其中引擎也判无命中的 **${clean.length - cleanHit.length}** 条。`);
  lines.push(
    '- **这句必须一起读**：标签是同一套生成器打的，所以上面的比例只证明"输入到输出的管道没走样"，不证明判据本身对真实团队成立。'
  );
  lines.push('');
  if (disagreements.length) {
    lines.push('| key | 标签 | 引擎命中 | 引擎结论 | 评分人 | 分歧 |');
    lines.push('|---|---|---|---|---|---|');
    lines.push(...disagreements);
    lines.push('');
    lines.push('这些分歧不是 bug 列表，而是**口径边界**：低分但有一条 finding 的条目，引擎判 `healthy` 并显式带出那条 finding；');
    lines.push('要不要把"有人提过"也算风险，是产品决策，不是评分错误。');
  } else {
    lines.push('本次没有检测到需要单独解释的分歧。');
  }
  lines.push('');
  lines.push('## 6. 复现');
  lines.push('');
  lines.push('```');
  lines.push('node tools/corpus-report.js              # 重算本文件');
  lines.push('node tools/mandate_probe.js              # 跑五类端到端探针（含写路径与规模）');
  lines.push('npm run verify                           # 断言账');
  lines.push('```');
  lines.push('');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(`written: ${path.relative(ROOT, OUT)}  (${seedRows.length} items · ${lenses.length} lenses · manifest ${man.ok}/${man.total})`);
}

main();
