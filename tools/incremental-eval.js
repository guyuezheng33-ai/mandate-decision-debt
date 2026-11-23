'use strict';

/**
 * 增量重放：给 `site/seed-21.csv` 这类评估表加水位线。
 *
 * 这不是产品运行时数据库，而是评估数据的增量入口：
 * - 去重键：issue_key
 * - 水位列：updated
 * - 每批 upsert；只有 updated > watermark 或缓存里没有的 key 才重算
 * - 全量重算只做 `--reset` 的校准跑
 *
 * 验收输出只认数字：
 *   第一次 processed=21 reused=0
 *   第二次 processed=0  reused=21
 *   新增一条 processed=1 reused=21
 *   10 倍表第二次 processed=0
 *
 * 用法：
 *   node tools/incremental-eval.js
 *   node tools/incremental-eval.js <inbox> <cache.json>
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { bundleFromRow } = require('./seed-bundles');
const { load_data } = require('./seed-store');
const { summarize } = require('../src/engine/score');
const { getProfile } = require('../src/engine/profiles');

const ROOT = path.resolve(__dirname, '..');
const INBOX = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(ROOT, '..', 'data-inbox');
const CACHE = process.argv[3] ? path.resolve(process.argv[3]) : path.join(os.tmpdir(), 'mandate-eval-cache.json');
const PROFILE = getProfile('software');

function score(row) {
  const summary = summarize(bundleFromRow(row), PROFILE);
  return {
    issueKey: row.issue_key,
    updated: row.updated,
    debt: summary.debt,
    grade: summary.grade,
    hit: summary.criteria.some((c) => c.state === 'hit'),
  };
}

function loadCache() {
  if (!fs.existsSync(CACHE)) return { watermark: '', items: {} };
  return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
}

function saveCache(cache) {
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

/**
 * 增量入口：先按水位筛，再按 key upsert。
 * 返回 processed（本次真正重算的条数）与 reused（直接命中缓存的条数）。
 */
function runIncremental(rows, cache) {
  const watermark = cache.watermark || '';
  const items = { ...cache.items };
  // 水位过滤 + 缓存缺失兜底：没有缓存的 key 必须算，不能因为 updated 旧就跳过。
  const candidates = rows.filter((row) => {
    const key = row.issue_key;
    const previous = items[key];
    return !previous || String(row.updated) > watermark;
  });
  for (const row of candidates) items[row.issue_key] = score(row);
  const nextWatermark = rows.reduce((max, row) => {
    const v = String(row.updated || '');
    return v > max ? v : max;
  }, watermark);
  const next = { watermark: nextWatermark, items };
  saveCache(next);
  return {
    processed: candidates.length,
    reused: rows.length - candidates.length,
    watermark: nextWatermark,
    scored: rows.map((row) => items[row.issue_key]),
  };
}

function readRows(seedPath) {
  return load_data(seedPath).rows;
}

function makeNewRow(row) {
  return {
    ...row,
    issue_key: 'DEL-999',
    summary: 'Synthetic incremental probe',
    updated: '2026-11-21T10:00:00.000+0000',
    human_label: '说不好',
  };
}

function makeScale(rows, factor) {
  const out = [];
  for (let batch = 0; batch < factor; batch += 1) {
    for (const row of rows) {
      const n = batch * rows.length + out.length + 1;
      out.push({
        ...row,
        issue_key: `${row.issue_key}-B${batch}`,
        updated: `2026-${String(5 + (batch % 7)).padStart(2, '0')}-${String((n % 27) + 1).padStart(2, '0')}T10:00:00.000+0000`,
      });
    }
  }
  return out;
}

function main() {
  const seedPath = path.join(INBOX, 'site', 'seed-21.csv');
  if (!fs.existsSync(seedPath)) {
    console.error(`找不到评估样本：${seedPath}`);
    process.exit(1);
  }
  if (fs.existsSync(CACHE)) fs.rmSync(CACHE, { force: true });

  const rows = readRows(seedPath);
  const first = runIncremental(rows, { watermark: '', items: {} });
  const second = runIncremental(rows, loadCache());

  const withNew = [...rows, makeNewRow(rows[0])];
  const third = runIncremental(withNew, loadCache());

  const scaleRows = makeScale(rows, 10);
  const scaleFirst = runIncremental(scaleRows, { watermark: '', items: {} });
  const scaleSecond = runIncremental(scaleRows, loadCache());

  const report = {
    schema: 'mandate/incremental-eval@1',
    cache: CACHE,
    key: 'issue_key',
    watermark_column: 'updated',
    first_run: { rows: rows.length, processed: first.processed, reused: first.reused },
    second_run: { rows: rows.length, processed: second.processed, reused: second.reused },
    one_new_row: { rows: withNew.length, processed: third.processed, reused: third.reused },
    scale_10x: {
      rows: scaleRows.length,
      first_processed: scaleFirst.processed,
      second_processed: scaleSecond.processed,
      second_reused: scaleSecond.reused,
    },
    invariants: {
      second_run_zero_new: second.processed === 0,
      one_new_row_only_one: third.processed === 1,
      scale_second_zero_new: scaleSecond.processed === 0,
      reused_equals_total: second.reused === rows.length && scaleSecond.reused === scaleRows.length,
    },
  };

  const ok = Object.values(report.invariants).every(Boolean);
  fs.writeFileSync(path.join(ROOT, 'docs', 'incremental-eval.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`incremental: first=${first.processed}/${rows.length} second=${second.processed}/${rows.length} ` +
    `new=${third.processed}/${withNew.length} scaleSecond=${scaleSecond.processed}/${scaleRows.length} ` +
    `invariants=${ok ? 'PASS' : 'FAIL'}`);
  console.log(`cache: ${CACHE}`);
  if (!ok) process.exitCode = 1;
}

main();
