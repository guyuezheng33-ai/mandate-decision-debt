'use strict';

/**
 * seed 验证：把人工记录的事实折算成"规则能不能命中"，并给出四种处置之一。
 *
 * 这一步是选题唯一的硬验证：如果规则在这套站点的真实数据上是空的，
 * 该换的是**内容**，不是阈值——调低阈值只会让误报变多，评审一试就露。
 *
 *   node seed/grade.js seed/seed-sheet.json      # 填表后判定
 *   node seed/grade.js seed/dry-run.json         # 用虚构样本自检判定器
 */

const fs = require('node:fs');
const path = require('node:path');

const THRESHOLDS = {
  evidenceRate: 0.4, // 依据页关联率 ≥ 40%
  goalRate: 0.2, // 目标关联率 ≥ 20%
  hitCount: 8, // 21 条里 ≥ 8 条命中
  primitiveCoverage: 3, // ≥ 3 条原语各命中 ≥ 2 次
};

const REQUIRED = [
  'issueKey',
  'hasEvidence',
  'hasGoal',
  'goalEnded',
  'changeAfterStart',
  'confirmedAfterChange',
  'conflictSameTopic',
  'reopenedCount',
  'evidenceAfterLastReopen',
  'singleContributor',
  'secondReviewer',
  'issueDone',
];

const BOOL_FIELDS = REQUIRED.filter((k) => k !== 'issueKey' && k !== 'reopenedCount');

function toBool(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (s === '') return null;
  if (['true', '1', 'yes', 'y', '是', '有'].includes(s)) return true;
  if (['false', '0', 'no', 'n', '否', '无', ''].includes(s)) return false;
  return undefined;
}

/** 极简 CSV：够用即可，支持引号包裹与字段内逗号 */
function parseCsv(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== '');
  const split = (line) => {
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = !quoted;
      } else if (ch === ',' && !quoted) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = split(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const row = {};
    header.forEach((h, i) => {
      row[h] = cells[i] === undefined ? '' : cells[i];
    });
    for (const f of BOOL_FIELDS) row[f] = toBool(row[f]);
    if (row.reopenedCount !== undefined) {
      const n = Number(String(row.reopenedCount).trim());
      row.reopenedCount = Number.isFinite(n) && String(row.reopenedCount).trim() !== '' ? n : null;
    }
    return row;
  });
}

function load(file) {
  const abs = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    throw new Error(`找不到文件：${abs}`);
  }
  const text = fs.readFileSync(abs, 'utf8');

  if (abs.toLowerCase().endsWith('.csv')) {
    return { meta: { title: path.basename(abs), sampleSize: 21 }, rows: parseCsv(text) };
  }

  const raw = JSON.parse(text);
  const rows = Array.isArray(raw) ? raw : raw.rows;
  if (!Array.isArray(rows)) throw new Error('文件里没有 rows 数组');
  return { meta: raw.meta ?? {}, rows };
}

function unfilled(row) {
  return REQUIRED.filter((k) => row[k] === null || row[k] === undefined || row[k] === '');
}

/** 由事实推出应当命中的原语。null 表示"这条填不全，不参与统计"。 */
function predict(row) {
  if (unfilled(row).length) return null;
  const hits = [];
  if (!row.hasEvidence && !row.hasGoal) hits.push('P1');
  if (row.hasEvidence && row.changeAfterStart === true && row.confirmedAfterChange === false) hits.push('P2');
  if (row.hasEvidence && row.conflictSameTopic === true) hits.push('P3');
  if (row.hasGoal && row.goalEnded === true && row.issueDone === false) hits.push('P4');
  if (row.reopenedCount >= 2 && row.evidenceAfterLastReopen === false) hits.push('P5');
  if (row.hasEvidence && row.singleContributor === true && row.secondReviewer === false) hits.push('P6');
  return hits;
}

function grade(rows, meta) {
  const expected = Number(meta.sampleSize ?? 21);
  const done = rows.filter((r) => unfilled(r).length === 0);
  const pending = rows.length - done.length;

  const withEvidence = done.filter((r) => r.hasEvidence === true).length;
  const withGoal = done.filter((r) => r.hasGoal === true).length;
  const hitsByRow = done.map((r) => predict(r)).filter((h) => h && h.length);
  const perPrimitive = {};
  for (const h of hitsByRow) for (const p of h) perPrimitive[p] = (perPrimitive[p] || 0) + 1;

  const basis = done.length || 1;
  const rates = {
    evidenceRate: withEvidence / basis,
    goalRate: withGoal / basis,
    hitRate: hitsByRow.length / basis,
  };
  const primitivesAtLeastTwice = Object.values(perPrimitive).filter((n) => n >= 2).length;

  const checks = [
    {
      key: 'evidenceRate',
      label: '依据页关联率',
      actual: `${(rates.evidenceRate * 100).toFixed(0)}%（${withEvidence}/${done.length}）`,
      pass: rates.evidenceRate >= THRESHOLDS.evidenceRate,
      need: '≥ 40%',
      onFail: 'P2 / P3 / P6 没有素材：砍掉 P3 与 P6，只保留 P2，口径缩为两套',
    },
    {
      key: 'goalRate',
      label: '目标关联率',
      actual: `${(rates.goalRate * 100).toFixed(0)}%（${withGoal}/${done.length}）`,
      pass: rates.goalRate >= THRESHOLDS.goalRate,
      need: '≥ 20%',
      onFail: 'P4 恒空：把目标缺失并入 P1，组合治理口径下线',
    },
    {
      key: 'hitCount',
      label: '命中条数',
      actual: `${hitsByRow.length} / ${done.length}`,
      pass: hitsByRow.length >= THRESHOLDS.hitCount,
      need: `≥ ${THRESHOLDS.hitCount} / 21`,
      onFail: '这个题目在这套站点上是空的：换内容，不要调阈值',
    },
    {
      key: 'primitiveCoverage',
      label: '原语覆盖（各命中 ≥2 次）',
      actual: `${primitivesAtLeastTwice} 条`,
      pass: primitivesAtLeastTwice >= THRESHOLDS.primitiveCoverage,
      need: `≥ ${THRESHOLDS.primitiveCoverage} 条`,
      onFail: '产品会退化成单一 linter：补原语或换内容',
    },
    {
      key: 'sample',
      label: '样本完整度',
      actual: `${done.length} / ${expected}`,
      pass: pending === 0 && done.length >= Math.min(expected, THRESHOLDS.hitCount * 2),
      need: `填满 ${expected} 条`,
      onFail: '还有空行：先把 21 条填完再判',
    },
  ];

  return { checks, perPrimitive, rates, pending, done: done.length, expected, passed: checks.every((c) => c.pass) };
}

function render(title, result) {
  const lines = [];
  lines.push(`\nseed 验证 · ${title}`);
  lines.push('─'.repeat(56));

  // 表还没填完时，只报完整度：在空数据上给出"换内容"是在制造假结论
  if (result.done < result.expected * 0.5) {
    lines.push(`WAIT  ${'样本完整度'.padEnd(22)} ${`${result.done} / ${result.expected}`.padEnd(16)} 需要 填满 ${result.expected} 条`);
    lines.push('');
    lines.push('结论：表还没开始填，先填完再判——空数据上不给任何选题结论。');
    lines.push('');
    return lines.join('\n');
  }

  for (const c of result.checks) {
    lines.push(`${c.pass ? 'PASS' : 'FAIL'}  ${c.label.padEnd(22)} ${String(c.actual).padEnd(16)} 需要 ${c.need}`);
  }
  lines.push('');
  const order = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
  lines.push(`各原语命中：${order.map((p) => `${p}=${result.perPrimitive[p] || 0}`).join('  ')}`);
  if (result.pending) lines.push(`未填完：${result.pending} 条（不参与判定）`);
  lines.push('');

  if (result.passed) {
    lines.push('结论：内容冻结，可以进入 v1。');
  } else {
    const failed = result.checks.filter((c) => !c.pass);
    lines.push(`结论：${failed.length} 项不达标 →`);
    for (const f of failed) lines.push(`  · ${f.label}：${f.onFail}`);
    const hard = failed.some((f) => f.key === 'hitCount' || f.key === 'primitiveCoverage');
    lines.push(hard ? '  → 属于"换内容"级别，不要靠调阈值抢救。' : '  → 属于"砍原语 / 缩口径"级别，内容本身仍成立。');
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const file = process.argv[2];
  if (!file) {
    process.stdout.write('用法：node seed/grade.js <seed.json>\n');
    process.exitCode = 1;
    return;
  }
  const { meta, rows } = load(file);
  const result = grade(rows, meta);
  process.stdout.write(render(meta.title || path.basename(file), result));

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ meta, ...result }, null, 2)}\n`);
  }
  process.exitCode = result.passed ? 0 : 2;
}

// 允许被 tools/ 里的探针复用同一套判定口径（CLI 行为不变）。
if (require.main === module) main();

module.exports = { parseCsv, predict, grade, render, load, unfilled, THRESHOLDS, REQUIRED };
