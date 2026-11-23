'use strict';

/**
 * 归一化：把不同数据源（Teamwork Graph / Jira REST / 本地 fixture）的原始结果，
 * 统一成规则层认识的同一个形状。
 * 规则层因此完全不知道数据从哪来——这是它能被单测的前提，也是降级路径的前提。
 */

const ISO = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function asArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function normalizeDecision(raw) {
  return {
    id: String(raw.id ?? raw.pageId ?? raw.contentId ?? ''),
    title: String(raw.title ?? raw.name ?? '(untitled)'),
    url: raw.url ?? null,
    updated: ISO(raw.updated ?? raw.lastModified ?? ''),
    owner: raw.owner ?? raw.ownerId ?? null,
    contributors: asArray(raw.contributors).map((c) => (typeof c === 'string' ? c : c?.id ?? c?.accountId)).filter(Boolean),
  };
}

function normalizeGoal(raw) {
  return {
    id: String(raw.id ?? raw.goalId ?? ''),
    title: raw.title ?? raw.name ?? null,
    status: String(raw.status ?? raw.state ?? 'unknown').toLowerCase(),
  };
}

/**
 * @param {object} raw 任意来源的对象，字段名见下
 * @returns {object} 归一化 context
 */
function normalizeContext(raw) {
  if (!raw || typeof raw !== 'object') throw new TypeError('normalizeContext: raw is not an object');
  if (!raw.key && !raw.issueKey) throw new TypeError('normalizeContext: missing issue key');

  const decisions = asArray(raw.decisions).map(normalizeDecision);
  const goals = asArray(raw.goals).map(normalizeGoal);

  return {
    key: String(raw.key ?? raw.issueKey),
    summary: String(raw.summary ?? raw.title ?? ''),
    projectKey: raw.projectKey ?? raw.project?.key ?? null,
    status: raw.status ?? raw.statusName ?? 'unknown',
    statusCategory: (raw.statusCategory ?? raw.status?.category ?? 'unknown').toLowerCase(),
    created: ISO(raw.created),
    updated: ISO(raw.updated),
    inProgressSince: ISO(raw.inProgressSince ?? raw.startedAt ?? null),
    reopenedCount: Number(raw.reopenedCount ?? 0) || 0,
    decisions,
    goals,
    source: raw.source ?? 'unknown',
  };
}

module.exports = { normalizeContext, normalizeDecision, normalizeGoal };
