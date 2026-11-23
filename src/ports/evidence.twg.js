'use strict';

/**
 * 主端口：Teamwork Graph。
 *
 * 只有两种查询形状（多一种都不许加，否则就会滑成 N+1）：
 *   bundle：单条 issue 的完整依据链
 *   scan  ：一个项目的前 N 条，一次取回全部边，在内存里算
 *
 * 25 条逐条查 = 25 次往返，必然踩 Rovo 的 20 秒放弃线；一次 scan = 1 次往返。
 *
 * 这一层现在有四个硬约束（每一个都值一条测试）：
 * 1. 超时：bundle 8s / scan 20s，超时映射成 E_TIMEOUT，而不是把面板卡住
 * 2. 重试：只重试瞬时错误（429 / 5xx / 网络），业务错误不重试
 * 3. 能力探测：scope 缺哪个，对应的边直接标 unknown('scope-missing')，不发无用的查询
 * 4. 缓存：键必须含 userId（asUser 授权下跨用户缓存 = 泄漏），错误与 unknown 不入缓存
 */

const { normalizeBundle, STATES } = require('../engine/normalize');
const { classify } = require('../io/errors');
const { guarded } = require('../io/timeout');

const QUERY = {
  bundle: 'provenance.bundle',
  scan: 'provenance.scan',
};

const TIMEOUT = { bundle: 8_000, scan: 20_000 };
const MAX_SCAN = 50;

const EDGE_SCOPE = {
  decisions: ['read:graph:page:confluence', 'read:graph:issue:jira'],
  goals: ['read:graph:issue:jira'],
  reviewTraces: ['read:graph:user:atlassian'],
};

/** 能力探测：返回每条边"现在能不能查"。缺 scope 时不要发请求，直接标 unknown。 */
function capabilitiesOf(scopes = []) {
  const list = scopes.map(String);
  // 没声明 scope（离线测试、旧调用）时按"都可用"处理：不可知由 available 决定，
  // 而不是由"没告诉我"决定。
  if (!list.length) return { decisions: true, goals: true, reviewTraces: true };
  const has = (s) => list.includes(s);
  const out = {};
  for (const [edge, required] of Object.entries(EDGE_SCOPE)) {
    out[edge] = required.every(has);
  }
  return out;
}

function mapIssue(issue) {
  return {
    key: issue.key ?? issue.issueKey,
    summary: issue.summary,
    status: issue.status,
    statusCategory: issue.statusCategory,
    projectKey: issue.projectKey,
    created: issue.created,
    updated: issue.updated,
    inProgressSince: issue.inProgressSince,
    reopenedCount: issue.reopenedCount,
    lastReopenedAt: issue.lastReopenedAt,
    lastConfirmAt: issue.lastConfirmAt,
  };
}

function edgeOf(raw, name, cap) {
  if (cap === false) return { state: STATES.UNKNOWN, items: [], reason: `${name}-scope-missing` };
  if (!raw) return { state: STATES.UNKNOWN, items: [], reason: `${name}-not-returned` };
  return {
    state: raw.state ?? (Array.isArray(raw.items) && raw.items.length ? STATES.PRESENT : STATES.UNKNOWN),
    items: Array.isArray(raw.items) ? raw.items : [],
    reason: raw.reason ?? null,
  };
}

function toBundle(raw, caps) {
  const c = caps || { decisions: true, goals: true, reviewTraces: true };
  return normalizeBundle({
    ...mapIssue(raw.issue ?? raw),
    source: 'twg',
    edges: {
      decisions: edgeOf(raw.decisions, 'decisions', c.decisions),
      goals: edgeOf(raw.goals, 'goals', c.goals),
      reviewTraces: edgeOf(raw.reviewTraces, 'reviewTraces', c.reviewTraces),
    },
    errors: raw.errors ?? [],
  });
}

function unknownBundle(key, err, caps) {
  const e = classify(err);
  const c = caps || { decisions: false, goals: false, reviewTraces: false };
  const edge = (name) => ({
    state: STATES.UNKNOWN,
    items: [],
    reason: c[name] === false ? `${name}-scope-missing` : e.code,
  });
  return normalizeBundle({
    key,
    source: 'twg',
    status: 'unknown',
    edges: { decisions: edge('decisions'), goals: edge('goals'), reviewTraces: edge('reviewTraces') },
    errors: [e],
  });
}

/**
 * @param {object} deps
 * @param {(req:object)=>Promise<object>} deps.query 注入的查询器：测试里换成假函数即可
 * @param {string[]} deps.scopes 当前安装被授予的 scope
 * @param {boolean} deps.available 是否具备 graph 能力（false 时全部 unknown）
 * @param {object|null} deps.cache   createCache() 的实例
 */
function createTwgPort({ query, available = true, scopes = [], cache = null, timeoutMs = TIMEOUT } = {}) {
  const caps = capabilitiesOf(scopes);

  function cacheKey(key, opts) {
    if (!cache || !opts?.userId) return null;
    return cache.key(opts.userId, ['twg', key, opts.profile || '-', String(opts.asOf || '-')]);
  }

  return {
    capabilities() {
      return { ...caps };
    },

    status() {
      const missing = Object.entries(caps)
        .filter(([, ok]) => !ok)
        .map(([edge]) => edge);
      return {
        source: available ? 'twg' : 'none',
        degraded: !available || missing.length > 0,
        missing,
        note: available
          ? missing.length
            ? `Teamwork Graph：已授权，但 ${missing.join('/')} 边缺 scope，会显示为不可知`
            : 'Teamwork Graph：issue→页面→人→目标一次取全'
          : '未授权 Teamwork Graph，已降级',
      };
    },

    async getBundle(key, opts = {}) {
      if (!available) return unknownBundle(key, new Error('scope not granted'), caps);

      const ck = cacheKey(key, opts);
      if (ck) {
        const hit = cache.get(ck);
        if (hit) return hit;
      }

      // 同 REST：出发时的世代对不上，回来就不许写回（写后失效是常见触发场景）。
      const token = cache && cache.epoch ? cache.epoch() : undefined;
      const build = async () => {
      try {
        const raw = await guarded(() => query({ type: QUERY.bundle, issueKey: key }), {
          timeoutMs: timeoutMs.bundle,
        });
        if (!raw) return unknownBundle(key, new Error('empty result'), caps);
        const bundle = toBundle(raw, caps);
        if (ck) cache.set(ck, bundle, token);
        return bundle;
      } catch (err) {
        return unknownBundle(key, err, caps);
      }
      };
      return ck && typeof cache.single === 'function' ? cache.single(ck, build) : build();
    },

    async listBundles(projectKey, limit = 25, opts = {}) {
      if (!available) return [];
      const cap = Math.min(Math.max(Number(limit) || 25, 1), MAX_SCAN);
      const ck = cache
        ? cache.key(opts.userId, ['twg-scan', projectKey, String(cap), String(opts.asOf || '-')])
        : null;
      if (ck) {
        const hit = cache.get(ck);
        if (hit) return hit;
      }
      const token = cache && cache.epoch ? cache.epoch() : undefined;
      const build = async () => {
      try {
        const raw = await guarded(() => query({ type: QUERY.scan, projectKey, limit: cap }), {
          timeoutMs: timeoutMs.scan,
        });
        const issues = raw?.issues ?? [];
        const seen = new Set();
        const bundles = issues
          .map((i) => toBundle(i, caps))
          .filter((b) => {
            if (!b.issueKey || seen.has(b.issueKey)) return false;
            seen.add(b.issueKey);
            return true;
          });
        // 扫描的预算与"还有没有下一页"必须跟着结果走：
        // 只显示前 50 条、却让读者以为这就是整个项目，比不出分更糟。
        bundles.scan = {
          source: 'twg',
          requested: cap,
          fetched: bundles.length,
          cap: MAX_SCAN,
          capped: bundles.length >= cap,
          hasMore: Boolean(raw?.pageInfo?.hasNextPage),
        };
        if (ck) cache.set(ck, bundles, token);
        return bundles;
      } catch {
        return [];
      }
      };
      return ck && typeof cache.single === 'function' ? cache.single(ck, build) : build();
    },
  };
}

module.exports = { createTwgPort, QUERY, toBundle, capabilitiesOf, TIMEOUT, MAX_SCAN };
