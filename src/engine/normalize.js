'use strict';

/**
 * 归一化：把 TWG / Jira REST / fixture 三种来源，统一成规则层认识的同一个形状。
 *
 * 关键设计：**边有三种状态**（present / absent / unknown）。
 * 规则只认这个 bundle，不知道数据从哪来，所以任何一条规则都能在离线 fixture 上被钉死。
 */

const STATES = Object.freeze({
  PRESENT: 'present',
  ABSENT: 'absent',
  UNKNOWN: 'unknown',
});

function asArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function iso(v) {
  if (!v) return null;
  if (typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function str(v, fallback) {
  return v == null ? fallback : String(v);
}

function normalizeDecision(raw) {
  const contributorsRaw = raw.contributors;
  const contributors = asArray(contributorsRaw)
    .map((c) => (typeof c === 'string' ? c : (c && (c.id ?? c.accountId)) || null))
    .filter(Boolean);
  const ownerRaw = raw.owner ?? raw.ownerId ?? null;
  return {
    id: str(raw.id ?? raw.pageId ?? raw.contentId, ''),
    title: str(raw.title ?? raw.name, '(untitled)'),
    url: raw.url ?? null,
    updated: iso(raw.updated ?? raw.lastModified),
    owner: ownerRaw && typeof ownerRaw === 'object' ? ownerRaw.id ?? ownerRaw.accountId ?? null : ownerRaw,
    // 有些图返回 owner 对象，有些返回纯 accountId。名字只作为显示层可选字段，
    // 缺名字时 UI 退回 accountId，绝不把 id 编成一个像人名的东西。
    ownerName:
      raw.ownerName ??
      (ownerRaw && typeof ownerRaw === 'object' ? ownerRaw.displayName ?? ownerRaw.name ?? null : null),
    contributors,
    // "名单是空的"和"名单没回来"必须分开：P6 的结论完全取决于这一位。
    contributorsKnown: Array.isArray(contributorsRaw),
    spaceKey: raw.spaceKey ?? null,
  };
}

function normalizeGoal(raw) {
  return {
    id: str(raw.id ?? raw.goalId, ''),
    title: raw.title ?? raw.name ?? null,
    status: str(raw.status ?? raw.state, 'unknown').toLowerCase(),
    updated: iso(raw.updated),
  };
}

function normalizeTrace(raw) {
  return {
    pageId: str(raw.pageId ?? raw.decisionId, ''),
    actorId: raw.actorId ?? raw.authorId ?? null,
    at: iso(raw.at ?? raw.created),
  };
}

/**
 * 把一条边归一化。显式给了 state 就用，否则按数组长度推断。
 * @param {object|array|null} raw
 * @param {(item:object)=>object} mapper
 * @param {string} [fallbackState] 数据源无法判断时传 'unknown'
 */
function normalizeEdge(raw, mapper, fallbackState) {
  if (raw == null) {
    return { state: fallbackState ?? STATES.UNKNOWN, items: [], reason: 'edge-not-provided' };
  }
  if (Array.isArray(raw)) {
    const items = raw.map(mapper);
    return { state: items.length ? STATES.PRESENT : STATES.ABSENT, items, reason: null };
  }
  if (typeof raw !== 'object') {
    return { state: STATES.UNKNOWN, items: [], reason: 'bad-edge-shape' };
  }
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const declared = raw.state;
  let state = fallbackState ?? STATES.UNKNOWN;
  if (declared === STATES.PRESENT || declared === STATES.ABSENT || declared === STATES.UNKNOWN) {
    state = declared;
  } else {
    state = rawItems.length ? STATES.PRESENT : STATES.UNKNOWN;
  }
  // present 却说没有条目，是数据源自相矛盾，降级为 unknown，避免据此报"无依据"
  if (state === STATES.PRESENT && rawItems.length === 0) {
    state = STATES.UNKNOWN;
  }
  return { state, items: rawItems.map(mapper), reason: raw.reason ?? null };
}

/**
 * @param {object} raw 任意来源
 * @returns {object} ProvenanceBundle
 */
function normalizeBundle(raw) {
  if (!raw || typeof raw !== 'object') throw new TypeError('normalizeBundle: raw is not an object');
  const key = raw.key ?? raw.issueKey;
  if (!key) throw new TypeError('normalizeBundle: missing issue key');

  const decisions = normalizeEdge(raw.edges?.decisions ?? raw.decisions, normalizeDecision);
  const goals = normalizeEdge(raw.edges?.goals ?? raw.goals, normalizeGoal);
  const reviewTraces = normalizeEdge(
    raw.edges?.reviewTraces ?? raw.reviewTraces,
    normalizeTrace,
    STATES.UNKNOWN,
  );

  return {
    issueKey: String(key),
    summary: str(raw.summary ?? raw.title, ''),
    projectKey: raw.projectKey ?? raw.project?.key ?? null,
    status: str(raw.status ?? raw.statusName, 'unknown'),
    statusCategory: str(raw.statusCategory ?? raw.status?.category, 'unknown').toLowerCase(),
    createdAt: iso(raw.created ?? raw.createdAt),
    updatedAt: iso(raw.updated ?? raw.updatedAt),
    inProgressSince: iso(raw.inProgressSince ?? raw.startedAt),
    lastConfirmAt: iso(raw.lastConfirmAt ?? raw.lastStampedAt),
    lastReopenedAt: iso(raw.lastReopenedAt),
    reopenedCount: Number(raw.reopenedCount ?? 0) || 0,
    // "重开过 0 次"和"没有重开次数这个字段"是两件事。REST 没有这个字段，
    // 缺省成 0 会让 P5 永远沉默——所以把"有没有"单独记下来（ADR 0016）。
    reopenedKnown: raw.reopenedCount != null,
    asOf: iso(raw.asOf ?? raw.updated ?? raw.updatedAt),
    edges: { decisions, goals, reviewTraces },
    source: str(raw.source, 'unknown'),
    errors: asArray(raw.errors),
  };
}

module.exports = { STATES, normalizeBundle, normalizeDecision, normalizeGoal, normalizeTrace, normalizeEdge };
