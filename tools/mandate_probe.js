'use strict';

/**
 * data-inbox 探针：把 `data-inbox/` 里的数据跑过真引擎，输出可复现的 JSON 报告。
 *
 * 用法：
 *   node tools/mandate_probe.js
 *   node tools/mandate_probe.js --inbox "D:\桌面\Codegeist 2026\data-inbox" --out "D:\桌面\Codegeist 2026\outputs\mandate\probe.json"
 *
 * 它回答四个问题：
 *   1. manifest 里的 sha256 与实际文件是否一致（数据包有没有被改过）；
 *   2. 图返回的两种形状（basic / extended）经过映射层后，六条判据各落在什么状态；
 *   3. 21 条 seed 事实折算出的"应当命中"，与引擎实际命中是否一致（逐条 diff）；
 *   4. 写入报文里的指纹、规模样本的扫描成本，能否被现有代码解释。
 *
 * 注意：数据包是 tier=S（受控仿真），报告里每个结论都要带着这一条一起读。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { mapRows } = require('../src/ports/graph.client');
const { createGraphClient } = require('../src/ports/graph.client');
const { normalizeBundle } = require('../src/engine/normalize');
const { summarize, aggregate } = require('../src/engine/score');
const { getProfile } = require('../src/engine/profiles');
const grade = require('../seed/grade.js');
const { bundleFromRow, maxDay: maxDayOf } = require('./seed-bundles');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_INBOX = path.resolve(ROOT, '..', 'data-inbox');
const DEFAULT_OUT = path.resolve(ROOT, '..', 'outputs', 'mandate', 'probe.json');

const LABEL_TO_P = {
  无依据: 'P1',
  依据过时: 'P2',
  依据冲突: 'P3',
  目标漂移: 'P4',
  反复翻案: 'P5',
  单人无复核: 'P6',
  说不好: null,
};

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const INBOX = path.resolve(arg('inbox', DEFAULT_INBOX));
const OUT = path.resolve(arg('out', DEFAULT_OUT));

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(INBOX, rel), 'utf8'));
const readText = (rel) => fs.readFileSync(path.join(INBOX, rel), 'utf8').replace(/\uFEFF/, '');
const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(INBOX, rel))).digest('hex');

/** 极简 CSV（与 seed/grade.js 同口径）。 */
function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
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
  const head = split(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const row = {};
    head.forEach((h, i) => {
      row[h] = cells[i] === undefined ? '' : cells[i];
    });
    return row;
  });
}

const day = (s) => (s ? String(s).slice(0, 10) : null);
const maxDay = maxDayOf;

function splitList(v) {
  return String(v || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------- 1. provenance ----------
function provenance() {
  const manifest = readJson('manifest.json');
  const mismatches = [];
  for (const f of manifest.files || []) {
    let actual = null;
    try {
      actual = sha(f.path);
    } catch {
      mismatches.push({ path: f.path, reason: 'missing' });
      continue;
    }
    if (actual !== f.sha256) mismatches.push({ path: f.path, reason: 'sha256', expected: f.sha256, actual });
  }
  return {
    tier: manifest.tier,
    provenance: manifest.provenance,
    generator: manifest.generator,
    seed: manifest.seed,
    files: (manifest.files || []).length,
    verified: (manifest.files || []).length - mismatches.length,
    mismatches,
  };
}

// ---------- 2. graph shapes ----------
function bundleFromPayload(payload, { asOf = '2026-11-20' } = {}) {
  const rows = mapRows(payload);
  if (!rows.length) return null;
  const r = rows[0];
  return normalizeBundle({
    key: r.issue.key,
    summary: r.issue.summary,
    status: r.issue.status,
    created: r.issue.created,
    updated: r.issue.updated,
    inProgressSince: r.issue.inProgressSince,
    reopenedCount: r.issue.reopenedCount,
    asOf,
    source: 'twg',
    edges: { decisions: r.decisions, goals: r.goals, reviewTraces: r.reviewTraces },
  });
}

function graphShapes() {
  const out = {};
  for (const [name, rel] of [
    ['basic', 'graph/01-bundle.json'],
    ['extended', 'graph/01b-bundle.extended.json'],
  ]) {
    const b = bundleFromPayload(readJson(rel));
    const s = summarize(b, getProfile('software'));
    out[name] = {
      issueKey: s.issueKey,
      debt: s.debt,
      grade: s.grade,
      criteria: s.criteria.map((c) => ({ p: c.p, state: c.state, why: c.why || null })),
      edges: {
        decisions: b.edges.decisions.state,
        goals: b.edges.goals.state,
        reviewTraces: b.edges.reviewTraces.state,
      },
      asOf: b.asOf,
      created: b.createdAt,
      inProgressSince: b.inProgressSince,
    };
  }

  const scanPayload = readJson('graph/02-scan.json');
  const rows = mapRows(scanPayload);
  const bundles = rows.map((r) =>
    normalizeBundle({
      key: r.issue.key,
      summary: r.issue.summary,
      status: r.issue.status,
      created: r.issue.created,
      updated: r.issue.updated,
      inProgressSince: r.issue.inProgressSince,
      reopenedCount: r.issue.reopenedCount,
      asOf: '2026-11-20',
      source: 'twg',
      edges: { decisions: r.decisions, goals: r.goals, reviewTraces: r.reviewTraces },
    })
  );
  const summaries = bundles.map((b) => summarize(b, getProfile('software')));
  const agg = aggregate(summaries, getProfile('software'));
  out.scan = {
    rows: rows.length,
    issueKeys: rows.map((r) => r.issue.key),
    perRow: summaries.map((s) => ({
      issueKey: s.issueKey,
      debt: s.debt,
      grade: s.grade,
      unknown: s.criteria.filter((c) => c.state === 'unknown').map((c) => c.p),
    })),
    project: { debt: agg.debt, grade: agg.grade, counted: agg.countedCount, unknown: agg.unknownCount },
  };
  return out;
}

async function errorEnvelope() {
  const payload = readJson('graph/03-error-noscope.json');
  const api = { asUser: () => ({ requestTeamworkGraph: async () => payload }) };
  const client = createGraphClient({ bundleKey: 'MANDATE_QK_BUNDLE', api });
  try {
    await client.query({ type: 'provenance.bundle', issueKey: 'DEL-101' });
    return { threw: false, code: null };
  } catch (err) {
    return { threw: true, code: err.code || null, scope: err.scope || null, status: err.status || null };
  }
}

// ---------- 3. seed 21: facts → grade → engine ----------
const ENDED = new Set(['closed', 'archived', 'done', 'complete', 'completed', 'cancelled']);

function factsFromRow(row) {
  const pages = splitList(row.decision_page_ids);
  const pageUpdated = splitList(row.decision_page_updated);
  const owners = splitList(row.decision_page_author);
  const counts = splitList(row.decision_page_contributor_count).map((n) => Number(n) || 0);
  const reviewers = splitList(row.reviewer_ids);
  const reviewDates = splitList(row.review_event_dates);
  const reopens = splitList(row.reopen_events);
  const changedAt = day(row.status_changed_at);
  const latestPage = maxDay(pageUpdated);
  const lastReopen = maxDay(reopens);

  return {
    hasEvidence: pages.length > 0,
    hasGoal: Boolean(row.goal_id),
    goalEnded: ENDED.has(String(row.goal_status || '').toLowerCase()),
    changeAfterStart: Boolean(latestPage && changedAt && latestPage > changedAt),
    // 数据缺口：seed-21.csv 没有"执行侧确认事件"这一列。
    // review_event_dates 是页面复核痕迹（P6 的证据），不是 P2 要的"改完之后有人重新确认"。
    // 把两者混为一谈，会让 6 条真漂移样本被判成"已确认"——所以这里显式取 false，
    // 并在报告的 dataIssues 里把缺列写出来（应为 confirm_event_dates）。
    confirmedAfterChange: false,
    conflictSameTopic: pages.length >= 2,
    reopenedCount: Number(row.reopened_count) || 0,
    evidenceAfterLastReopen: Boolean(latestPage && (!lastReopen || latestPage > lastReopen)),
    singleContributor: counts.length > 0 && counts.every((n) => n <= 1),
    secondReviewer: reviewers.length > 0,
    issueDone: String(row.status_category || '').toLowerCase() === 'done',
  };
}

function seedRun() {
  const rows = parseCsv(readText('site/seed-21.csv'));
  const facts = rows.map(factsFromRow);
  const forGrade = rows.map((row, i) => ({ ...facts[i], issueKey: row.issue_key }));
  const graded = grade.grade(forGrade, { sampleSize: 21 });

  const perRow = [];
  for (const row of rows) {
    const s = summarize(bundleFromRow(row), getProfile('software'));
    const engine = s.criteria.filter((c) => c.state === 'hit').map((c) => c.p);
    const expected = grade.predict({ ...factsFromRow(row), issueKey: row.issue_key }) || [];
    const label = LABEL_TO_P[row.human_label] ?? null;
    perRow.push({
      issueKey: row.issue_key,
      label: row.human_label,
      engine,
      expected,
      labelPrimitive: label,
      engineVsFacts: engine.join(',') === expected.join(','),
      engineVsLabel: label ? engine.includes(label) : null,
      debt: s.debt,
      grade: s.grade,
      unknown: s.criteria.filter((c) => c.state === 'unknown').map((c) => c.p),
    });
  }

  const mismatches = perRow.filter((r) => !r.engineVsFacts);
  const labelHits = perRow.filter((r) => r.engineVsLabel !== null);
  return {
    rows: rows.length,
    graded: {
      passed: graded.passed,
      perPrimitive: graded.perPrimitive,
      rates: graded.rates,
      checks: graded.checks.map((c) => ({ key: c.key, pass: c.pass, actual: c.actual, need: c.need })),
    },
    mismatches: mismatches.length,
    mismatchDetail: mismatches,
    labelAlignment: {
      comparable: labelHits.length,
      hit: labelHits.filter((r) => r.engineVsLabel).length,
    },
    perRow,
  };
}

/**
 * 图只给决策页、不给 issue 元数据时，P2 是 clear 还是 unknown？
 * 期望：hydrate 之前 unknown（issue-no-start / issue-no-asof），hydrate 之后能算出 P2。
 */
async function hydrateCheck() {
  const { hydrateBundle } = require('../src/ports/hydrate');
  const b = bundleFromPayload(readJson('graph/01b-bundle.extended.json'));
  const before = summarize(b, getProfile('software')).criteria.find((c) => c.p === 'P2');
  const fakeJira = {
    getIssue: async () => ({
      fields: {
        summary: 'Checkout split — tax service cutover',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        created: '2026-05-28T10:10:00.000+0000',
        updated: '2026-11-18T17:53:00.000+0000',
        statuscategorychangedate: '2026-06-18T08:40:00.000+0000',
      },
    }),
  };
  const after = await hydrateBundle(b, fakeJira);
  const p2 = summarize(after, getProfile('software')).criteria.find((c) => c.p === 'P2');
  return {
    before: { state: before.state, why: before.why || null },
    after: { state: p2.state, why: p2.why || null },
    hydrated: { asOf: after.asOf, inProgressSince: after.inProgressSince, createdAt: after.createdAt },
  };
}

/**
 * 项目页在"只有扫描、没有 issue 元数据"时是什么状态？
 * 这里只报事实：数据包本身没给 issue 元数据，所以整页应当是"不出分"，
 * 而不是 0 分 healthy。补水后能算出多少，见 test/data-inbox.test.js 的 inbox/project。
 */
async function projectScan() {
  const { aggregate } = require('../src/engine/score');
  const { getProfile } = require('../src/engine/profiles');
  const payload = readJson('graph/02-scan.json');
  const rows = mapRows(payload);
  const bundles = rows.map((r) =>
    normalizeBundle({
      key: r.issue.key,
      summary: r.issue.summary,
      status: r.issue.status,
      created: r.issue.created,
      updated: r.issue.updated,
      inProgressSince: r.issue.inProgressSince,
      reopenedCount: r.issue.reopenedCount,
      asOf: '2026-11-20',
      source: 'twg',
      edges: { decisions: r.decisions, goals: r.goals, reviewTraces: r.reviewTraces },
    })
  );
  const agg = aggregate(bundles, getProfile('software'));
  return {
    scanned: agg.itemCount,
    counted: agg.countedCount,
    unknown: agg.unknownCount,
    debt: agg.debt,
    grade: agg.grade,
    certainty: agg.certainty,
    heroUnknown: agg.items.filter((i) => (i.criteria || []).some((c) => c.p === 'P2' && c.state === 'unknown')).length,
  };
}

// ---------- 4. humans / write / scale ----------
function humansRun() {
  const rows = parseCsv(readText('humans/labels.csv'));
  const keys = new Set(rows.map((r) => r.issue_key));
  const raters = new Set(rows.map((r) => r.rater_id));
  const ratersMd = readText('humans/raters.md');
  return {
    rows: rows.length,
    keys: keys.size,
    raters: raters.size,
    // 骨架数据：raters.md 自己写着"占位"，所以这里必须显式标出来。
    placeholder: /占位|placeholder|tier=S/i.test(ratersMd),
    perRater: [...raters].map((id) => ({
      rater: id,
      rows: rows.filter((r) => r.rater_id === id).length,
      wouldCheck: rows.filter((r) => r.rater_id === id && r.would_check === '1').length,
    })),
  };
}

function writeRun() {
  const req = readJson('write/01-comment-request.adf.json');
  const res = readJson('write/02-comment-response.json');
  const texts = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (typeof n.text === 'string') texts.push(n.text);
    (n.content || []).forEach(walk);
  };
  walk(req.body);
  const bodyText = texts.join('\n');
  const marker = (bodyText.match(/mandate:dd-[0-9a-f]{8}/) || [null])[0];
  const resTexts = [];
  const walk2 = (n) => {
    if (!n || typeof n !== 'object') return;
    if (typeof n.text === 'string') resTexts.push(n.text);
    (n.content || []).forEach(walk2);
  };
  walk2(res.body);
  const resText = resTexts.join('\n');
  return {
    marker,
    bodyHasMarker: Boolean(marker),
    responseHasSameMarker: marker ? resText.includes(marker) : false,
    created: res.created || null,
    commentId: res.id || null,
    status403: readJson('write/03-403-body.json'),
  };
}

function scaleRun() {
  const rows = parseCsv(readText('scale/project-100.csv'));
  const counts = rows.map((r) => Number(r.linked_page_count) || 0).sort((a, b) => a - b);
  const n = counts.length;
  const q = (p) => counts[Math.min(n - 1, Math.max(0, Math.floor(p * n)))];
  return {
    issues: n,
    linkedPages: { min: counts[0] || 0, p50: q(0.5), p90: q(0.9), max: counts[n - 1] || 0 },
    restCallsIfHydratedAll: counts.reduce((a, b) => a + b, 0),
    // 现行预算：TWG 一次扫描 + 最多 8 次 REST；这里给出"按 8 条上限会漏多少"。
    twgOneQuery: true,
    restCap: 8,
    cappedOut: Math.max(0, n - 8),
  };
}

function lensesRun() {
  const out = {};
  for (const name of ['software', 'launch', 'portfolio']) {
    const rows = parseCsv(readText(`lenses/${name}.csv`));
    out[name] = { rows: rows.length, distinctKeys: new Set(rows.map((r) => r.issue_key)).size };
  }
  return out;
}

async function main() {
  if (!fs.existsSync(INBOX)) {
    throw new Error(`找不到 data-inbox：${INBOX}`);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    inbox: INBOX,
    tier: 'S',
    warning: '受控仿真数据；不得在任何对外材料里写成真实站点验证或从业者校准。',
    provenance: provenance(),
    graph: graphShapes(),
    errorEnvelope: await errorEnvelope(),
    hydrate: await hydrateCheck(),
    project: await projectScan(),
    dataIssues: [
      {
        field: 'confirm_event_dates',
        file: 'site/seed-21.csv',
        why: '缺"执行侧确认事件"列；现有 review_event_dates 是页面复核痕迹（P6），不能当 P2 的确认',
        effect: '探针把 confirmedAfterChange 一律取 false；否则 6 条真漂移会被误判为"已确认"',
      },
    ],
    seed: seedRun(),
    humans: humansRun(),
    write: writeRun(),
    scale: scaleRun(),
    lenses: lensesRun(),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const P = report.provenance;
  const G = report.graph;
  console.log(`data-inbox probe · tier=${P.tier} · ${P.verified}/${P.files} 文件校验通过`);
  if (P.mismatches.length) console.log(`  校验失败：${P.mismatches.map((m) => m.path).join(', ')}`);
  console.log(`  basic   : debt=${G.basic.debt} ${G.basic.grade} · ${G.basic.criteria.map((c) => c.p + '=' + c.state).join(' ')}`);
  console.log(`  extended: debt=${G.extended.debt} ${G.extended.grade} · ${G.extended.criteria.map((c) => c.p + '=' + c.state).join(' ')}`);
  console.log(`  scan    : ${G.scan.rows} 行 → ${G.scan.perRow.map((r) => r.issueKey).join(', ')} · project ${G.scan.project.debt}/${G.scan.project.grade}`);
  console.log(`  error   : code=${report.errorEnvelope.code} scope=${report.errorEnvelope.scope}`);
  console.log(`  hydrate : P2 ${report.hydrate.before.state}(${report.hydrate.before.why}) → ${report.hydrate.after.state}`);
  console.log(`  project : ${report.project.scanned} 行 · counted ${report.project.counted} · debt ${report.project.debt} · ${report.project.grade}`);
  console.log(`  seed    : ${report.seed.rows} 条 · 引擎与事实不一致 ${report.seed.mismatches} 条 · 与人类标签对齐 ${report.seed.labelAlignment.hit}/${report.seed.labelAlignment.comparable}`);
  console.log(`  write   : marker=${report.write.marker} · 回读同指纹=${report.write.responseHasSameMarker}`);
  console.log(`  scale   : ${report.scale.issues} 条 · p50 页=${report.scale.linkedPages.p50} p90=${report.scale.linkedPages.p90} · REST cap 8 会漏 ${report.scale.cappedOut}`);
  console.log(`  报告：${OUT}`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
