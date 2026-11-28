'use strict';

/**
 * 降级端口：只用 Jira REST。
 *
 * 它天生比 TWG 弱一档，这不是缺陷，而是设计：
 *   - 能拿到 issue 字段与 remote links（所以"有没有关联页"可知）
 *   - 拿不到页面的更新时间、贡献者、评论者（所以 P2 会算不出来、P6 必须被抑制）
 *   - 拿不到跨产品关系（所以目标边通常 unknown）
 * 结论：REST 下 P1 能给准，P2/P6 一律"不可知"而不是硬报。这就是三值逻辑的实际收益。
 *
 * 工程约束：单条 4s 超时；扫描按并发 4 跑（不是 for-await 一条一条等，也不打满限流）；
 * 与 TWG 共用同一份缓存，但键里的 source 不同，不会串味。
 */

const { normalizeBundle, STATES } = require('../engine/normalize');
const { classify } = require('../io/errors');
const { guarded } = require('../io/timeout');
const { withStamps } = require('./confirm');

/**
 * REST 扫描的硬预算：一次项目页加载最多取回 8 条。
 *
 * 为什么不跟 TWG 一样取 50：REST 没有批量关系端点，一条工作项至少要两次请求
 * （issue + remote links）。50 条 = 100 次往返，正是本产品批评的 N+1，
 * 而且在限流下会以"全都 unknown"的形式失败 —— 那比只算 8 条更不可信。
 * 上限写进契约、写进 payload、写在界面上，用户知道"这次只看了前 8 条"。
 */
const REST_SCAN_CAP = 8;

function isPageLink(link) {
  const url = String(link?.url || link?.object?.url || '');
  return /\/wiki\/|confluence|\.atlassian\.net\/wiki/i.test(url);
}

/**
 * 依据记录有两个来源，不能只认 Confluence 页面：
 *   - 页面链接（remote link）：时间/作者要再查页面元数据，查不到就只能 unknown；
 *   - Jira 原生记录（description 里带 MANDATE 头）：approved 日期与 owner 就在 issue 里，
 *     不需要跨产品 token，收据能直接算出天数。
 * 只认页面会让 MDEMO-2 这种真实记录被静默丢掉，收据退回 UNVERIFIABLE。
 */
function isDecisionLink(link) {
  return isPageLink(link) || link?.application === 'Jira' || /^jira:/.test(String(link?.globalId || ''));
}

/** 有界并发映射：REST 扫描的耗时上限由它决定，而不是由条目数决定。 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      out[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return out;
}

function createRestPort({ client, cache = null, timeoutMs = 4_000, concurrency = 4 } = {}) {
  // 读能力不再以 "scopes 数组里有没有 read:jira-work" 为开关。
  //
  // 原来按 scope 门控，表面上是"没授权就别发请求"，实际引入第二套真相：
  // 面板的 context 带 scopes，Rovo action / MCP 的 context 不保证带 ——
  // 同一条工作项会因为入口不同，decisions 从 clear 变成 unknown，分数从 28 变成"不可知"。
  // 平台本身就是权限的最终裁决者：真的没 scope，这次调用会 403，我们据此判 unknown 即可。
  const canReadLinks = typeof client?.getIssueLinks === 'function';

  function cacheKey(key, opts) {
    if (!cache || !opts?.userId) return null;
    return cache.key(opts.userId, ['rest', key, opts.profile || '-', String(opts.asOf || '-')]);
  }

  return {
    capabilities() {
      return { decisions: canReadLinks, goals: false, reviewTraces: false };
    },

    status() {
      return {
        source: 'rest',
        degraded: true,
        missing: ['goals', 'reviewTraces'],
        note: '仅 Jira REST：依据页逐条取回，跨产品关系与页面元数据不可知',
      };
    },

    async getBundle(key, opts = {}) {
      const ck = cacheKey(key, opts);
      if (ck) {
        const hit = cache.get(ck);
        if (hit) return hit;
      }

      // 出发时记下缓存世代：如果这趟读回来时已经发生过一次失效（比如有人刚留痕），
      // 手里这份就是旧世界，不许写回缓存。
      const token = cache && cache.epoch ? cache.epoch() : undefined;
      const build = async () => {
      let issue;
      try {
        issue = await guarded(() => client.getIssue(key), { timeoutMs });
      } catch (err) {
        console.error('[mandate] getIssue failed', key, err && err.status, err && err.code, err && err.message);
        const e = classify(err);
        return normalizeBundle({
          key,
          source: 'rest',
          status: 'unknown',
          edges: {
            decisions: { state: STATES.UNKNOWN, items: [], reason: e.code },
            goals: { state: STATES.UNKNOWN, items: [], reason: e.code },
            reviewTraces: { state: STATES.UNKNOWN, items: [], reason: e.code },
          },
          errors: [e],
        });
      }

      let links = null;
      if (canReadLinks && typeof client.getIssueLinks === 'function') {
        try {
          links = await guarded(() => client.getIssueLinks(key), { timeoutMs });
        } catch {
          links = null;
        }
      }

      let decisions =
        links == null
          ? { state: STATES.UNKNOWN, items: [], reason: 'links-unavailable' }
          : {
              state: links.some(isDecisionLink) ? STATES.PRESENT : STATES.ABSENT,
              items: links.filter(isDecisionLink).map((l, i) => ({
                id: l.globalId || `link-${i}`,
                title: l.title || l.object?.title || '(linked page)',
                url: l.url || l.object?.url || null,
                // Jira 原生记录自带 approved 日期与 owner；页面链接则留空，等页面元数据。
                updated: l.updated || null,
                // 服务器编辑时间（Jira 原生记录才有）：P2 用它判"变更未传导"。
                editedAt: l.editedAt || null,
                owner: l.owner || null,
                ownerName: l.ownerName || null,
                contributors: l.ownerName ? [l.ownerName] : [],
              })),
              reason: null,
            };

      // 有 Confluence REST 能力时补页面时间与作者。
      // 这一步不是"锦上添花"：没有 updated，"授权收据"只能判 UNVERIFIABLE。
      // 补不到就保持 null（unknown），绝不用 issue 的时间冒充页面时间。
      const pageItems = decisions.items.filter((i) => isPageLink({ url: i.url }));
      if (
        pageItems.length &&
        typeof client?.getPageMeta === 'function'
      ) {
        console.log('[mandate] page meta start', pageItems.length, pageItems.map((i) => i.url));
        const metas = await mapLimit(pageItems, concurrency, async (item) => {
          try {
            return await guarded(() => client.getPageMeta(item.url), { timeoutMs });
          } catch (err) {
            console.error('[mandate] page meta failed', item.url, err && err.status, err && err.message);
            return null;
          }
        });
        const metaById = new Map(pageItems.map((item, i) => [item.id, metas[i]]));
        decisions = {
          ...decisions,
          items: decisions.items.map((item) => {
            const meta = metaById.get(item.id);
            if (!meta) return item;
            return {
              ...item,
              id: meta.id || item.id,
              title: meta.title || item.title,
              updated: meta.updated || item.updated,
              owner: meta.owner || item.owner,
              ownerName: meta.ownerName || item.ownerName || null,
            };
          }),
        };
      }

      const goals =
        typeof client.getIssueGoals === 'function'
          ? await guarded(() => client.getIssueGoals(key), { timeoutMs })
              .then((gs) => ({ state: gs.length ? STATES.PRESENT : STATES.ABSENT, items: gs, reason: null }))
              .catch(() => ({ state: STATES.UNKNOWN, items: [], reason: 'goals-unavailable' }))
          : { state: STATES.UNKNOWN, items: [], reason: 'goals-unavailable' };

      const bundle = normalizeBundle({
        key,
        summary: issue.fields?.summary,
        status: issue.fields?.status?.name,
        statusCategory: issue.fields?.status?.statusCategory?.key,
        created: issue.fields?.created,
        updated: issue.fields?.updated,
        inProgressSince: issue.fields?.statuscategorychangedate ?? null,
        // Jira REST 没有重开次数：不填 0。填了 0 就等于替数据源保证"从没翻过案"，
        // P5 会据此判 clear；留空则被判 unknown（ADR 0016）。
        ...(issue.fields?.reopenedCount != null ? { reopenedCount: issue.fields.reopenedCount } : {}),
        lastConfirmAt: null,
        projectKey: issue.fields?.project?.key,
        source: 'rest',
        edges: { decisions, goals, reviewTraces: { state: STATES.UNKNOWN, items: [], reason: 'rest-has-no-commenters' } },
      });
      // 单条回读复核留痕（D1/D7）：只认带 mandate:dd-<8hex> 指纹的评论，时间取服务器 created。
      // 没有这一步，面板/agent/MCP 在真站点上永远看不见"还款"，与审计脚本各说各话。
      // 扫描（opts.scan）绝不逐条 N+1；审计脚本的 withStamps 与此同纪律、幂等。
      let stamped = bundle;
      if (!opts.scan && typeof client?.getComments === 'function') {
        try {
          stamped = await withStamps(bundle, client, { timeoutMs });
        } catch {
          stamped = bundle;
        }
      }
      if (ck) cache.set(ck, stamped, token);
      return stamped;
      };
      // 单飞：同一 key 并发只打一次 REST（面板 + agent 同秒点开是常态）。
      return ck && typeof cache.single === 'function' ? cache.single(ck, build) : build();
    },

    async listBundles(projectKey, limit = 25, opts = {}) {
      const requested = Math.min(Number(limit) || 25, 50);
      const wanted = Math.min(requested, REST_SCAN_CAP);
      const ids = await guarded(() => client.searchIssues(projectKey, wanted), { timeoutMs: timeoutMs * 2 });
      const out = await mapLimit((ids || []).slice(0, wanted), concurrency, (id) => this.getBundle(id, { ...opts, scan: true }));
      // 预算写在结果上，而不是藏在注释里：聚合层、payload、界面都要能说出"这次只算了 8 条"。
      out.scan = {
        source: 'rest',
        requested,
        fetched: out.length,
        cap: REST_SCAN_CAP,
        requestsPerItem: 2,
        capped: requested > wanted,
      };
      return out;
    },
  };
}

module.exports = { createRestPort, isPageLink, mapLimit, REST_SCAN_CAP };
