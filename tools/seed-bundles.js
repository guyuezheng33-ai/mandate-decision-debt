'use strict';

/**
 * 把 `site/seed-21.csv`（21 条构造样本）折成引擎认识的 bundle。
 *
 * 这里只有**映射**，没有判断：哪条判据命中、分数多少，全部由 src/engine 决定。
 * 探针（tools/mandate_probe.js）与预览（preview/emit.js）共用这一份，
 * 避免"探针上一套、演示里又一套"——两套映射会让同一个数字在报告和截图里对不上。
 *
 * 两点口径必须写在代码旁：
 * 1. 页面标题优先从 URL slug 取（`.../pages/1004/pricing-experiment-guardrails`）。
 *    早前一律用 issue 的 summary 当页面标题，两份不同主题的页面会被当成"标题完全相同"，
 *    P3（依据冲突）就变成"只要有两页、owner 不同就命中"——命中的理由被我们自己造没了。
 * 2. 贡献者只有人数、没有 id。这里用 `c1..cn` 占位，只用于让 P6 看到长度；
 *    它不是人名，也不能被当成真实协作者。
 */

const fs = require('node:fs');
const { normalizeBundle } = require('../src/engine/normalize');

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

function splitList(v) {
  return String(v || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function maxDay(list) {
  return list.filter(Boolean).sort().slice(-1)[0] || null;
}

/** `.../pages/1004/pricing-experiment-guardrails` → `pricing experiment guardrails`。 */
function slugTitle(url) {
  const last = String(url || '').split('/').filter(Boolean).pop() || '';
  return last.replace(/-/g, ' ').trim();
}

function bundleFromRow(row, { asOf = '2026-11-20', titleMode = 'slug' } = {}) {
  const pages = splitList(row.decision_page_ids);
  const urls = splitList(row.decision_page_urls);
  const updated = splitList(row.decision_page_updated);
  const owners = splitList(row.decision_page_author);
  const counts = splitList(row.decision_page_contributor_count).map((n) => Number(n) || 0);
  const reviewers = splitList(row.reviewer_ids);
  const reviewDates = splitList(row.review_event_dates);
  const reopens = splitList(row.reopen_events);
  const contributorsFor = (n) => Array.from({ length: n }, (_, i) => `c${i + 1}`);

  return normalizeBundle({
    key: row.issue_key,
    projectKey: row.project || null,
    summary: row.summary,
    status: row.status,
    statusCategory: row.status_category,
    created: row.created,
    updated: row.updated,
    inProgressSince: row.status_changed_at,
    reopenedCount: row.reopened_count === '' ? undefined : Number(row.reopened_count),
    lastReopenedAt: maxDay(reopens),
    asOf,
    source: 'seed',
    edges: {
      decisions: pages.length
        ? {
            state: 'present',
            items: pages.map((id, i) => ({
              id,
              title: titleMode === 'slug' && urls[i] ? slugTitle(urls[i]) || row.summary : row.summary,
              url: urls[i] || null,
              updated: updated[i] || null,
              owner: owners[i] || null,
              contributors: contributorsFor(counts[i] || 0),
              spaceKey: null,
            })),
          }
        : { state: 'absent', items: [] },
      goals: row.goal_id
        ? { state: 'present', items: [{ id: row.goal_id, title: row.goal_id, status: row.goal_status, updated: row.goal_updated }] }
        : { state: 'absent', items: [] },
      reviewTraces: reviewers.length
        ? { state: 'present', items: reviewers.map((actorId, i) => ({ pageId: pages[0] || '', actorId, at: reviewDates[i] || null })) }
        : { state: 'absent', items: [] },
    },
  });
}

function bundlesFromSeed(csvPath, opts) {
  return parseCsv(fs.readFileSync(csvPath, 'utf8')).map((row) => bundleFromRow(row, opts));
}

module.exports = { parseCsv, splitList, maxDay, slugTitle, bundleFromRow, bundlesFromSeed };
