'use strict';

/**
 * 离线评估：给 Decision Debt 的“要不要查”判断补上四件套。
 *
 * 这不是产品运行时，也不是校准声明。它只回答四个问题：
 * 1. 点估计是多少？——F1 / precision / recall。
 * 2. 误差多大？——对 21 条样本做固定种子 bootstrap，给 95% 区间。
 * 3. 换了条件会不会翻？——按 updated 时间做 20% 留出；再做 P2 反事实翻转。
 * 4. 有没有对照？——对“全部要查”的基线，以及对债务阈值调参后的基线。
 *
 * 口径必须写在代码旁：`site/seed-21.csv` 的 `human_label` 是生成器同源标签，
 * 不是真人校准。因此本评估只能证明“管道与统计脚本自洽”，不能证明“判断正确”。
 * 任何把这个 F1 读成“准确率”的说法都是过度声明。
 *
 * 用法：
 *   node tools/authority-eval.js
 *   node tools/authority-eval.js <inbox> <out.md> <out.json>
 */

const fs = require('node:fs');
const path = require('node:path');

const { bundleFromRow } = require('./seed-bundles');
const { load_data } = require('./seed-store');
const { summarize } = require('../src/engine/score');
const { getProfile, PROFILES } = require('../src/engine/profiles');
const { log } = require('../src/lib/log');

const ROOT = path.resolve(__dirname, '..');
const INBOX = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(ROOT, '..', 'data-inbox');
const OUT_MD = process.argv[3] ? path.resolve(process.argv[3]) : path.resolve(ROOT, 'docs', 'evaluation.md');
const OUT_JSON = process.argv[4] ? path.resolve(process.argv[4]) : path.resolve(ROOT, 'docs', 'evaluation.json');

const SEED = 20261122;
const BOOTSTRAP_ROUNDS = 5000;
const HOLDOUT_RATE = 0.2;

const LABEL_TO_P = {
  无依据: 'P1',
  依据过时: 'P2',
  依据冲突: 'P3',
  目标漂移: 'P4',
  反复翻案: 'P5',
  单人无复核: 'P6',
};

function truthOf(row) {
  return Boolean(row.human_label && LABEL_TO_P[row.human_label]);
}

function predictEngine(row, profile) {
  const summary = summarize(bundleFromRow(row), profile);
  const hit = summary.criteria.some((c) => c.state === 'hit');
  return { hit, debt: summary.debt, grade: summary.grade, summary };
}

function predictAlways() {
  return true;
}

function predictNoEvidence(row) {
  return !String(row.decision_page_ids || '').trim();
}

function metrics(rows, predict) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const row of rows) {
    const y = truthOf(row);
    const yhat = predict(row);
    if (y && yhat) tp += 1;
    else if (!y && yhat) fp += 1;
    else if (!y && !yhat) tn += 1;
    else fn += 1;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const accuracy = rows.length ? (tp + tn) / rows.length : 0;
  return { n: rows.length, tp, fp, tn, fn, precision, recall, f1, accuracy };
}

function round(n, digits = 3) {
  return Number(n.toFixed(digits));
}

function isoDay(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function minusOneDay(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** 确定性 LCG：同一输入永远得到同一区间，不用 Math.random。 */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function bootstrapDiff(rows, enginePred, baselinePred) {
  const random = rng(SEED);
  const diffs = [];
  for (let i = 0; i < BOOTSTRAP_ROUNDS; i += 1) {
    const sample = [];
    for (let j = 0; j < rows.length; j += 1) sample.push(rows[Math.floor(random() * rows.length)]);
    const e = metrics(sample, enginePred);
    const b = metrics(sample, baselinePred);
    diffs.push(e.f1 - b.f1);
  }
  return {
    rounds: BOOTSTRAP_ROUNDS,
    seed: SEED,
    ci_low: round(percentile(diffs, 0.025)),
    ci_high: round(percentile(diffs, 0.975)),
  };
}

/** 在训练段上选债务阈值，再到留出段上评；阈值不碰留出段。 */
function tuneDebtThreshold(rows, profile) {
  let best = { threshold: 0, f1: -1 };
  for (let t = 0; t <= 100; t += 1) {
    const pred = (row) => predictEngine(row, profile).debt > t;
    const m = metrics(rows, pred);
    if (m.f1 > best.f1) best = { threshold: t, f1: m.f1 };
  }
  return best;
}

function sortByUpdated(rows) {
  return [...rows].sort((a, b) => String(a.updated).localeCompare(String(b.updated)));
}

function holdoutSplit(rows) {
  const ordered = sortByUpdated(rows);
  const holdoutN = Math.ceil(ordered.length * HOLDOUT_RATE);
  return {
    ordered,
    train: ordered.slice(0, ordered.length - holdoutN),
    holdout: ordered.slice(ordered.length - holdoutN),
    holdoutN,
  };
}

function flipP2(row, profile) {
  const before = predictEngine(row, profile);
  const p2Before = before.summary.criteria.some((c) => c.p === 'P2' && c.state === 'hit');
  if (!p2Before) return null;
  const statusDay = isoDay(row.status_changed_at);
  const safeDay = minusOneDay(row.status_changed_at);
  if (!statusDay || !safeDay) return null;
  const mutated = { ...row, decision_page_updated: String(row.decision_page_updated || '')
    .split(';')
    .filter(Boolean)
    .map(() => safeDay)
    .join(';') };
  const after = predictEngine(mutated, profile);
  const p2After = after.summary.criteria.some((c) => c.p === 'P2' && c.state === 'hit');
  return { issue: row.issue_key, statusDay, safeDay, p2Before, p2After, flipped: !p2After };
}

function perProject(rows, profile) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.project || '(none)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([project, items]) => ({
    project,
    n: items.length,
    f1: round(metrics(items, (r) => predictEngine(r, profile).hit).f1),
    positives: items.filter(truthOf).length,
  }));
}

/** 数据包的 as_of 是评估基准日；不用运行时钟，保证两次生成同一份报告。 */
function readAsOf() {
  const manifest = path.join(INBOX, 'manifest.json');
  if (!fs.existsSync(manifest)) return 'unknown';
  try {
    const doc = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    return doc.as_of || doc.asOf || 'unknown';
  } catch {
    return 'unknown';
  }
}

function main() {
  const seedPath = path.join(INBOX, 'site', 'seed-21.csv');
  if (!fs.existsSync(seedPath)) {
    console.error(`找不到评估样本：${seedPath}`);
    process.exit(1);
  }
  log('evaluation.start', { seedPath });

  const rows = load_data(seedPath).rows;
  const profile = getProfile('software');
  const enginePred = (row) => predictEngine(row, profile).hit;
  const baselinePred = predictAlways;
  const noEvidencePred = predictNoEvidence;

  const point = metrics(rows, enginePred);
  const baseline = metrics(rows, baselinePred);
  const noEvidence = metrics(rows, noEvidencePred);
  const diff = bootstrapDiff(rows, enginePred, baselinePred);
  const split = holdoutSplit(rows);
  const tuned = tuneDebtThreshold(split.train, profile);

  const engineTrain = metrics(split.train, enginePred);
  const engineHoldout = metrics(split.holdout, enginePred);
  const baselineHoldout = metrics(split.holdout, baselinePred);
  const tunedHoldout = metrics(split.holdout, (row) => predictEngine(row, profile).debt > tuned.threshold);

  const flips = rows.map((row) => flipP2(row, profile)).filter(Boolean);
  const flipped = flips.filter((x) => x.flipped).length;
  const flipRate = flips.length ? flipped / flips.length : 0;
  const projects = perProject(rows, profile);
  const lensF1 = Object.keys(PROFILES).map((lens) => ({
    lens,
    f1: round(metrics(rows, (r) => predictEngine(r, getProfile(lens)).hit).f1),
  }));

  const report = {
    schema: 'mandate/authority-eval@1',
    as_of: readAsOf(),
    caveat: 'human_label 是生成器同源标签，不是真人校准；本评估只证明管道自洽，不证明判断正确。',
    input: {
      path: seedPath,
      rows: rows.length,
      positives: rows.filter(truthOf).length,
      negatives: rows.filter((r) => !truthOf(r)).length,
      holdout_rate: HOLDOUT_RATE,
    },
    point: {
      f1: round(point.f1),
      precision: round(point.precision),
      recall: round(point.recall),
      accuracy: round(point.accuracy),
      n: point.n,
    },
    baseline: {
      always_flag: {
        f1: round(baseline.f1),
        precision: round(baseline.precision),
        recall: round(baseline.recall),
        accuracy: round(baseline.accuracy),
      },
      no_evidence_rule: {
        f1: round(noEvidence.f1),
        precision: round(noEvidence.precision),
        recall: round(noEvidence.recall),
        accuracy: round(noEvidence.accuracy),
      },
      tuned_debt_threshold: {
        threshold: tuned.threshold,
        train_f1: round(tuned.f1),
        holdout_f1: round(tunedHoldout.f1),
      },
    },
    interval: {
      metric: 'f1_engine_minus_always_flag',
      diff: round(point.f1 - baseline.f1),
      ci_low: diff.ci_low,
      ci_high: diff.ci_high,
      rounds: diff.rounds,
      seed: diff.seed,
    },
    out_of_sample: {
      split: 'time_holdout_by_updated',
      train_n: split.train.length,
      holdout_n: split.holdout.length,
      engine_train_f1: round(engineTrain.f1),
      engine_holdout_f1: round(engineHoldout.f1),
      baseline_holdout_f1: round(baselineHoldout.f1),
      tuned_holdout_f1: round(tunedHoldout.f1),
    },
    robustness: {
      identification: 'P2 counterfactual: move every decision-page update before execution start',
      p2_cases: flips.length,
      p2_flipped: flipped,
      p2_flip_rate: round(flipRate),
      per_project: projects,
      lens_f1: lensF1,
    },
  };

  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const pct = (n) => `${(n * 100).toFixed(1)}%`;
  const md = [
    '# Authority evaluation',
    '',
    '> **不是校准。** `human_label` 是生成器同源标签，不是真人标注。',
    '> 本评估只证明：管道、统计脚本和反事实检查是自洽的；它不证明判断正确，也不支持“准确率 xx%”的说法。',
    '',
    `样本：${rows.length} 条（正 ${report.input.positives} / 负 ${report.input.negatives}），软件口径；基准日 ${report.as_of}。`,
    '',
    '## 1. 点估计与区间',
    '',
    '| 指标 | 值 |',
    '| --- | --- |',
    `| F1 | ${report.point.f1} |`,
    `| Precision | ${report.point.precision} |`,
    `| Recall | ${report.point.recall} |`,
    `| Accuracy | ${report.point.accuracy} |`,
    `| F1 差值（引擎 − 全查基线） | ${report.interval.diff} |`,
    `| 95% bootstrap 区间 | [${report.interval.ci_low}, ${report.interval.ci_high}]（${report.interval.rounds} 次，seed ${report.interval.seed}） |`,
    '',
    `区间说明：${report.interval.diff > 0 ? '点估计为正，且区间不跨 0；但标签同源，仍不能外推成真实准确率。' : '点估计未优于基线。'}`,
    `本样本 n=${report.point.n}；区间只说明“这批构造样本上的差值”，不是对外部总体的估计。`,
    '',
    '## 2. 对照基线',
    '',
    '| 基线 | F1 | Precision | Recall |',
    '| --- | --- | --- | --- |',
    `| 全查（always flag） | ${report.baseline.always_flag.f1} | ${report.baseline.always_flag.precision} | ${report.baseline.always_flag.recall} |`,
    `| 只看无依据（no evidence） | ${report.baseline.no_evidence_rule.f1} | ${report.baseline.no_evidence_rule.precision} | ${report.baseline.no_evidence_rule.recall} |`,
    `| 债务阈值（训练段调参，t=${report.baseline.tuned_debt_threshold.threshold}） | ${report.baseline.tuned_debt_threshold.train_f1}（训练） | — | — |`,
    '',
    '## 3. 时间留出（out-of-sample）',
    '',
    `按 \`updated\` 排序，最后 ${report.out_of_sample.holdout_n} 条留出；阈值只在训练段选。`,
    '',
    '| 段 | n | 引擎 F1 | 全查基线 F1 | 调参基线 F1 |',
    '| --- | --- | --- | --- | --- |',
    `| 训练 | ${report.out_of_sample.train_n} | ${report.out_of_sample.engine_train_f1} | — | — |`,
    `| 留出 | ${report.out_of_sample.holdout_n} | ${report.out_of_sample.engine_holdout_f1} | ${report.out_of_sample.baseline_holdout_f1} | ${report.out_of_sample.tuned_holdout_f1} |`,
    '',
    '## 4. 稳健性与可翻转',
    '',
    `P2 反事实：把每条命中 P2 的决策页更新时间移到执行开始前一天，再看 P2 是否消失。`,
    '',
    `- 可翻转样本：${report.robustness.p2_flipped}/${report.robustness.p2_cases}（${pct(report.robustness.p2_flip_rate)}）`,
    '',
    '| 项目 | n | 正例 | F1 |',
    '| --- | --- | --- | --- |',
    ...report.robustness.per_project.map((p) => `| ${p.project} | ${p.n} | ${p.positives} | ${p.f1} |`),
    '',
    '| 口径 | F1 |',
    '| --- | --- |',
    ...report.robustness.lens_f1.map((x) => `| ${x.lens} | ${x.f1} |`),
    '',
    '## 5. 复现',
    '',
    '```powershell',
    'cd "D:\\桌面\\Codegeist 2026\\decision-debt"',
    'npm run eval',
    '```',
    '',
    '输出：`docs/evaluation.json`（机器读）与 `docs/evaluation.md`（人读）。',
    '',
    '## 6. 不能拿这份报告说什么',
    '',
    '- 不能说“准确率 100%”：标签与引擎同源。',
    '- 不能说“真实用户校准通过”：没有真人样本。',
    '- 不能说“样本外有效”：留出段仍是同一份合成语料。',
    '- 只能说：引擎在这 21 条构造样本上，管道自洽；基线、区间、留出和反事实检查都可复现。',
    '',
    '## 7. 增量重放',
    '',
    '`npm run eval:incremental` 用 `issue_key` 去重、`updated` 做水位，验证：',
    '第一次 21/21 重算；第二次 0/21 重算；新增一条只算 1 条；10 倍表第二次 0/210 重算。',
    '结果落在 `docs/incremental-eval.json`，`invariants=PASS` 才算通过。',
    '',
  ].join('\n');

  fs.writeFileSync(OUT_MD, `${md}\n`, 'utf8');
  console.log(`evaluation: n=${rows.length} f1=${report.point.f1} baseline=${report.baseline.always_flag.f1} ` +
    `diffCI=[${report.interval.ci_low},${report.interval.ci_high}] holdout=${report.out_of_sample.engine_holdout_f1} ` +
    `p2Flip=${report.robustness.p2_flipped}/${report.robustness.p2_cases}`);
  console.log(`written: ${OUT_MD}`);
  console.log(`written: ${OUT_JSON}`);
  log('evaluation.end', {
    n: rows.length,
    f1: report.point.f1,
    holdoutF1: report.out_of_sample.engine_holdout_f1,
    p2Flips: report.robustness.p2_flipped,
  });
}

main();
