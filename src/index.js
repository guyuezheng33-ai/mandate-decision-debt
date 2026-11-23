'use strict';

/**
 * Forge resolver 入口：四个 action 挂在同一个函数上。
 *
 * 为什么用 @forge/resolver：自定义 UI 里 `invoke('getIssueProvenance', {...})` 与
 * rovo/mcp 的 action 调用最终都走 `payload.functionKey`，由 resolver 自己分派；
 * 手写一个裸函数去猜这个字段容易在真站点上失配。
 *
 * 这里刻意保持"薄"：端口在哪、口径怎么选、预算怎么裁，全在下面几层里，
 * 所以这个文件在评审环境里出问题的概率最低。TWG 不可用时自动退 REST，
 * 两者都不可用时返回 unknown 而不是报红——这条路径由 test/ports.test.js 覆盖。
 */

const ForgeResolver = require('@forge/resolver');
const Resolver = ForgeResolver.default || ForgeResolver;
const { createActions } = require('./resolvers/action');
const { createTwgPort } = require('./ports/evidence.twg');
const { createRestPort } = require('./ports/evidence.rest');
const { createChainPort } = require('./ports/chain');
const { createGraphClient } = require('./ports/graph.client');
const { createJiraClient } = require('./ports/jira.client');
const { createWritePort } = require('./ports/write.jira');
const { withStamps } = require('./ports/confirm');
const { hydrateBundle, hydrateBundles } = require('./ports/hydrate');
const { createRepairPort } = require('./ports/repair.jira');
const { createCache } = require('./io/cache');

const ACTIONS = ['getIssueProvenance', 'listContextDebt', 'traceDrift', 'stampMandate'];

/** 一次函数实例一份缓存：TTL 60s，只为了同一屏重复刷新不打两次图。 */
const CACHE = createCache({ ttlMs: 60_000, max: 200 });

function buildPort(context) {
  const scopes = (context?.scopes || []).map(String);

  // 面板进来时 context 里可能带 product client；Rovo action / MCP 的 context 里没有，
  // 这时退回 asUser 的 REST 客户端 —— 否则 agent 与 MCP 两条入口在真站点上一定失败。
  // 只有真的实现了 getIssue 的对象才被当成 client，避免"有个对象但方法不存在"的半可用状态。
  const jira = context?.jira && typeof context.jira.getIssue === 'function' ? context.jira : createJiraClient();
  // 面板注入的 context.jira 只保证 getIssue；remote links / 批量 / JQL 不保证有。
  // 这些能力统一走 asUser REST 客户端，否则真站点上 decisions 永远 unknown。
  const restJira = createJiraClient();

  async function issueOf(key) {
    if (jira && typeof jira.getIssue === 'function') {
      try {
        return await jira.getIssue(key);
      } catch (err) {
        console.warn('[mandate] context jira getIssue failed', key, err && err.status, err && err.message);
        if (!(restJira && typeof restJira.getIssue === 'function')) throw err;
      }
    }
    if (restJira && typeof restJira.getIssue === 'function') return restJira.getIssue(key);
    const e = new Error('no jira client available');
    e.code = 'E_SCOPE';
    throw e;
  }

  // context.jira 有这个方法时先用它；它抛错（或根本没有这个方法）再退 REST。
  // 两条路都不可用时返回空，让引擎判 unknown，而不是让整张收据报红。
  async function linksOf(key) {
    // 先用我们自己的 REST 端口：它会把 remote link 与「关联 issue 里的 MANDATE 记录」一起解析。
    // 面板注入的 context.jira.getIssueLinks 只保证 remote link，会把授权记录丢掉，
    // 收据就永远只能判 UNVERIFIABLE。
    if (restJira && typeof restJira.getIssueLinks === 'function') {
      try {
        return await restJira.getIssueLinks(key);
      } catch (err) {
        if (!(jira && typeof jira.getIssueLinks === 'function')) throw err;
      }
    }
    if (jira && typeof jira.getIssueLinks === 'function') return jira.getIssueLinks(key);
    return [];
  }

  async function issuesOf(keys) {
    if (jira && typeof jira.getIssues === 'function') {
      try {
        return await jira.getIssues(keys);
      } catch (err) {
        if (!(restJira && typeof restJira.getIssues === 'function')) throw err;
      }
    }
    if (restJira && typeof restJira.getIssues === 'function') return restJira.getIssues(keys);
    return [];
  }

  async function searchOf(projectKey, limit) {
    if (jira && typeof jira.searchIssues === 'function') {
      try {
        return await jira.searchIssues(projectKey, limit);
      } catch (err) {
        if (!(restJira && typeof restJira.searchIssues === 'function')) throw err;
      }
    }
    if (restJira && typeof restJira.searchIssues === 'function') return restJira.searchIssues(projectKey, limit);
    return [];
  }
  // 页面元数据走 Confluence REST 需要跨产品 scope，而 Jira 侧安装拿不到 Confluence token（实测 401）。
  // v1 不申请 Confluence scope：授权记录改用 Jira 原生 issue（description 里的 MANDATE 头）。
  const confluence = null;

  const client = jira
    ? {
        getIssue: (key) => issueOf(key),
        getIssueLinks: (key) => linksOf(key),
        // 批量补水走一条 JQL，不是 N 次 GET；没有这个能力就让它缺着，引擎自己判 unknown。
        getIssues: (keys) => issuesOf(keys),
        searchIssues: (projectKey, limit) => searchOf(projectKey, limit),
        getPageMeta: (url) =>
          confluence && typeof confluence.getPageMeta === 'function' ? confluence.getPageMeta(url) : null,
      }
    : {
        // 一条路都走不通时，返回"缺授权"的明确错误，而不是一个空数组。
        getIssue: async () => {
          const e = new Error('no jira client available');
          e.code = 'E_SCOPE';
          throw e;
        },
        getIssueLinks: async () => [],
        getIssues: async () => [],
        searchIssues: async () => [],
        getPageMeta: async () => null,
      };

  const rest = createRestPort({ scopes, cache: CACHE, client });

  // 图的持久化查询 key 从环境变量读：没注册就不发请求，直接让链降级到 REST。
  const graph = createGraphClient({
    bundleKey: process.env.MANDATE_QK_BUNDLE || null,
    scanKey: process.env.MANDATE_QK_SCAN || null,
  });

  let base = rest;
  if (graph.available) {
    const twg = createTwgPort({ scopes, cache: CACHE, query: (req) => graph.query(req) });

    // 图给证据链，issue 的 summary / status 由 Jira REST 补一次（只补单条，扫描绝不补水）。
    const primary = {
      ...twg,
      getBundle: async (key, opts) => hydrateBundle(await twg.getBundle(key, opts), jira),
    };

    // goals / reviewTraces 只有图能证：一旦降级到 REST，这两条边必须显式变 unknown。
    base = createChainPort({ primary, fallback: rest, blindEdges: ['goals', 'reviewTraces'] });
  }

  /**
   * 单条读取时把"我们写进去的复核痕迹"折回证据里；扫描保持原样。
   *
   * 这里的 this 很关键：listBundles 如果走 wrapper，就会变成"每条都读评论"的 N+1。
   * 所以扫描显式调用 base.listBundles（this 指向 base），只有 getBundle 被包。
   *
   * 但项目页不能整页 unknown：扫描行没有 issue 元数据，P2 会全是 unknown。
   * 所以扫描结果出来后补一次批量 JQL（O(1)，不是 N 次），让 P2 在项目页可算。
   */
  return {
    ...base,
    getBundle: async (key, opts) => withStamps(await base.getBundle(key, opts), jira),
    listBundles: async (projectKey, limit, opts) => {
      const rows = await base.listBundles(projectKey, limit, opts);
      const out = await hydrateBundles(rows, jira, { max: Math.min(Number(limit) || 50, 50) });
      // fixture 端口会把预算信息挂在数组上（emit/预览依赖），补水不能把它弄丢。
      if (rows && rows.scan && !out.scan) out.scan = rows.scan;
      return out;
    },
  };
}

function buildActions(context) {
  const evidencePort = buildPort(context);
  const scopes = (context?.scopes || []).map(String);

  // 写端口在构造时就按 scope 决定是否存在：没有 write:jira-work 就没有端口，
  // 面板连按钮都不会出现，而不是点了再报"没有权限"。
  const write = createWritePort({ scopes });
  const repairPort = write ? createRepairPort({ client: write, scopes }) : null;

  const invalidate = ({ userId, issueKey, projectKey }) => {
    if (!userId) return 0; // 没有身份就没有可失效的分区，绝不按 issueKey 全域扫
    return CACHE.dropWhere(
      (k) =>
        k.startsWith(`${userId}|`) &&
        (k.includes(`|${issueKey}|`) || (projectKey ? k.includes(`|${projectKey}|`) : false)),
    );
  };

  return createActions({ evidencePort, repairPort, invalidate });
}

/** 把调用方的身份塞进 payload：缓存键必须带它，否则同 key 跨用户会串数据。 */
function withIdentity(payload, context) {
  return { ...(payload || {}), userId: context?.accountId ?? context?.principal?.accountId ?? null };
}

/** 保留一个纯函数入口，方便离线复现与测试（不经过 Forge 运行时）。 */
async function resolve(event) {
  const payload = event?.payload ?? {};
  const { functionKey } = payload;
  const context = event?.context ?? {};
  const actions = buildActions(context);
  const handler = actions[functionKey];
  if (typeof handler !== 'function') {
    return { ok: false, code: 'E_UNKNOWN_ISSUE', message: `未知 action：${functionKey}` };
  }
  return handler({ inputs: withIdentity(payload, context) });
}

const resolver = new Resolver();
for (const name of ACTIONS) {
  resolver.define(name, async (req) => {
    const context = req?.context ?? {};
    const actions = buildActions(context);
    return actions[name]({ inputs: withIdentity(req?.payload, context) });
  });
}

// Forge 的 handler 约定
const definitions = resolver.getDefinitions();

module.exports = { resolve, buildPort, buildActions, ACTIONS, CACHE, handler: definitions };
