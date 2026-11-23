'use strict';

/**
 * 离线种子表的数据层：表结构、逐行校验、按 issue_key upsert、按键查询。
 *
 * 为什么需要它：评估器不能每次把 CSV 当字符串数组直接喂给引擎；那样没有表结构，
 * 也没有“同一键重复写入会覆盖”的语义。这一层只服务离线评估与回归，不进入 Forge 运行时，
 * 也不承载真实业务数据流。
 */

const fs = require('node:fs');

const { parseCsv } = require('./seed-bundles');

// 这不是数据库 schema，是评估表的最小列契约：少一列就拒绝加载。
const schema = Object.freeze({
  key: 'issue_key',
  required: ['issue_key', 'project', 'summary', 'status', 'created', 'updated'],
  optional: [
    'status_category',
    'status_changed_at',
    'reopened_count',
    'reopen_events',
    'decision_page_ids',
    'decision_page_urls',
    'decision_page_updated',
    'decision_page_author',
    'decision_page_contributor_count',
    'goal_id',
    'goal_status',
    'goal_updated',
    'reviewer_ids',
    'review_event_dates',
    'human_label',
    'human_note',
  ],
});

function assertSchema(columns) {
  const missing = schema.required.filter((c) => !columns.includes(c));
  if (missing.length) {
    throw new Error(`seed table missing required columns: ${missing.join(', ')}`);
  }
  return true;
}

/** 读入 CSV，校验列契约，返回带索引的离线表。 */
function load_data(csvPath) {
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const columns = rows.length ? Object.keys(rows[0]) : [];
  assertSchema(columns);
  const byKey = new Map();
  for (const row of rows) {
    const key = String(row[schema.key] || '').trim();
    if (!key) throw new Error('seed table has a row without issue_key');
    byKey.set(key, row);
  }
  return { schema, columns, rows, byKey };
}

/** 按 issue_key upsert：同键覆盖，新键追加；返回写入后的行数。 */
function upsert(store, row) {
  const key = String(row[schema.key] || '').trim();
  if (!key) throw new Error('upsert requires issue_key');
  const previous = store.byKey.get(key);
  if (previous) {
    Object.assign(previous, row);
  } else {
    store.rows.push(row);
    store.byKey.set(key, row);
  }
  return store.rows.length;
}

function query(store, issueKey) {
  return store.byKey.get(String(issueKey || '').trim()) || null;
}

module.exports = { schema, assertSchema, load_data, upsert, query };
