'use strict';

/**
 * 元数据补水：图的 bundle 只保证"证据链"，不保证 issue 的 summary / status / 进入状态的时间。
 *
 * 为什么只给单条补水、不给扫描补水：
 *   扫描一次 50 条，逐条补 = 50 次 REST 往返，正是本产品明令禁止的 N+1。
 *   单条补水 = 最多 1 次额外调用，换来面板上"这项工作叫什么、现在什么状态"可读。
 *
 * 补水只补空的字段，不覆盖图已经给出的值；补水失败不影响分数（它是展示层的事实，不是判据）。
 */

const { guarded } = require('../io/timeout');
const { makeError } = require('../io/errors');

function missingMeta(bundle) {
  const gaps = [];
  if (!bundle.summary) gaps.push('summary');
  if (!bundle.status) gaps.push('status');
  if (!bundle.inProgressSince) gaps.push('inProgressSince');
  if (!bundle.asOf) gaps.push('asOf');
  return gaps;
}

async function hydrateBundle(bundle, jira, { timeoutMs = 4_000 } = {}) {
  if (!bundle || !jira || typeof jira.getIssue !== 'function') return bundle;
  const gaps = missingMeta(bundle);
  if (!gaps.length) return { ...bundle, metaGaps: [] };

  try {
    const raw = await guarded(() => jira.getIssue(bundle.issueKey), { timeoutMs });
    const f = raw?.fields || {};
    return {
      ...bundle,
      summary: bundle.summary ?? f.summary ?? null,
      status: bundle.status ?? f.status?.name ?? null,
      statusCategory: bundle.statusCategory ?? f.status?.statusCategory?.key ?? null,
      inProgressSince: bundle.inProgressSince ?? f.statuscategorychangedate ?? f.created ?? null,
      createdAt: bundle.createdAt ?? f.created ?? null,
      // updated / asOf 也必须补：P2 要拿"观测时间"和"依据页改动时间"比先后，
      // 少了它 daysBetween 返回 null，P2 会从 unknown 掉成 clear（假 clear）。
      updated: bundle.updated ?? f.updated ?? null,
      asOf: bundle.asOf ?? f.updated ?? null,
      hydratedFrom: 'rest',
      metaGaps: gaps,
    };
  } catch (err) {
    // 补水失败只记一笔，不改变任何判据；界面依旧显示"不可知 / 待补"。
    return { ...bundle, metaGaps: gaps, metaError: makeError('E_PARTIAL', { detail: String(err.message || err) }).code };
  }
}

/**
 * 项目页批量补水：一次 REST 调用补齐一页最多 50 条 issue 的元数据。
 *
 * 为什么不是逐条补水：50 条逐条补 = 50 次往返，这正是不许的 N+1。
 * 这里用一条 `key in (...)` 的 JQL 换回整页字段，成本是 O(1)，与页大小无关。
 *
 * 只补空字段，不覆盖图给的值；批量不可用时退回"保留缺口"，绝不逐条兜底。
 */
async function hydrateBundles(bundles, jira, { timeoutMs = 5_000, max = 50 } = {}) {
  const list = Array.isArray(bundles) ? bundles : [];
  if (!list.length) return bundles;
  // 引擎的 bundle 用 issueKey，端口行的原始形状用 key：两个都要认，否则整页补水会静默不生效。
  const keyOf = (b) => b.key ?? b.issueKey ?? null;
  if (!jira || typeof jira.getIssues !== 'function') {
    for (const b of list) b.metaGaps = missingMeta(b);
    return bundles;
  }

  const need = list.filter((b) => missingMeta(b).length).map(keyOf).filter(Boolean).slice(0, max);
  if (!need.length) {
    for (const b of list) b.metaGaps = [];
    return bundles;
  }

  try {
    const raws = await guarded(() => jira.getIssues(need), { timeoutMs });
    const byKey = new Map((raws || []).map((r) => [r.key, r.fields || {}]));
    for (const b of list) {
      const f = byKey.get(keyOf(b));
      if (!f) {
        b.metaGaps = missingMeta(b);
        continue;
      }
      b.summary = b.summary ?? f.summary ?? null;
      b.status = b.status ?? f.status?.name ?? null;
      b.statusCategory = b.statusCategory ?? f.status?.statusCategory?.key ?? null;
      b.inProgressSince = b.inProgressSince ?? f.statuscategorychangedate ?? f.created ?? null;
      b.createdAt = b.createdAt ?? f.created ?? null;
      b.updated = b.updated ?? f.updated ?? null;
      b.asOf = b.asOf ?? f.updated ?? null;
      b.hydratedFrom = 'rest-batch';
      b.metaGaps = missingMeta(b);
    }
  } catch (err) {
    const code = makeError('E_PARTIAL', { detail: String(err.message || err) }).code;
    for (const b of list) {
      b.metaGaps = missingMeta(b);
      b.metaError = code;
    }
  }
  return bundles;
}

module.exports = { hydrateBundle, hydrateBundles, missingMeta };
