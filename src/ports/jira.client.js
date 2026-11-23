'use strict';

/**
 * Jira REST 客户端（asUser）。
 *
 * 为什么需要它：面板走 Forge 注入的 `context.jira`，但 Rovo agent / MCP action 的 context
 * 里没有 product client，只有 cloudId 与 accountId。没有这一层，agent 与 MCP 两条入口
 * 在任何真站点上都会当场失败 —— 而在单测里它们一直"能跑"，因为单测注入了假 client。
 *
 * 约束：
 *   - 一律 asUser：图与 issue 的可见性必须跟随当前用户，不能用 asApp 越权。
 *   - 只读：这里没有任何 POST/PUT/DELETE。
 *   - 超时与重试不在这里做，交给 ports（guarded），保持单一职责。
 */

const { textOfBody } = require('../io/adf');

const ROUTE = {
  issue: (key) => `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,created,updated,project,statuscategorychangedate,resolution,issuelinks,assignee,description`,
  remoteLinks: (key) => `/rest/api/3/issue/${encodeURIComponent(key)}/remotelink`,
  search: (jql, limit) => `/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${limit}&fields=summary,status,project`,
  // Jira Cloud 把 /search 迁到了 /search/jql（旧端点已在陆续下线）。
  // 两个都发：先新后旧，靠 404/410 判断该走哪条，而不是假设站点版本。
  searchJql: (jql, limit, fields = 'summary,status,project') =>
    `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${limit}&fields=${fields}`,
  // 批量补水用：一次拿回整页字段。fields 与单条保持一致，避免两条路径喂出不同形状。
  issuesByKeys: (keys) =>
    `/rest/api/3/search/jql?jql=${encodeURIComponent(`key in (${keys.join(',')})`)}&maxResults=${keys.length}` +
    '&fields=summary,status,created,updated,project,statuscategorychangedate',
  issuesByKeysLegacy: (keys) =>
    `/rest/api/3/search?jql=${encodeURIComponent(`key in (${keys.join(',')})`)}&maxResults=${keys.length}` +
    '&fields=summary,status,created,updated,project,statuscategorychangedate',
};

const KEY_RE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

function loadApi() {
  try {
    return require('@forge/api');
  } catch {
    return null;
  }
}

function shapeIssue(raw) {
  const f = raw?.fields || {};
  return {
    key: raw?.key,
    fields: {
      summary: f.summary,
      status: { name: f.status?.name, statusCategory: { key: f.status?.statusCategory?.key } },
      created: f.created,
      updated: f.updated,
      statuscategorychangedate: f.statuscategorychangedate,
      project: { key: f.project?.key ?? String(raw?.key || '').split('-')[0] },
      // Jira REST 没有"重开次数"这个字段。这里**不填 0**：填 0 等于告诉引擎"它从没被重开过"，
      // 而 P5 会据此判 clear。留空 → 引擎判 unknown（ADR 0016）。
    },
  };
}

function shapeLinks(raw) {
  // Jira 的 /remotelink 在只有一条链接时返回**单个对象**，不是数组。
  // 早先按数组处理会把唯一一条依据当成"没有依据"，这是真站点上最致命的一种误判。
  const list = Array.isArray(raw) ? raw : raw?.remoteLinks || (raw?.object ? [raw] : []);
  return list
    .filter((l) => l?.object?.url || l?.object?.title)
    .map((l) => ({
      globalId: l.globalId,
      title: l.object?.title,
      url: l.object?.url,
      application: l.application?.name,
    }));
}

/**
 * Jira 原生授权记录：关联 issue 的 description 里带一段可解析的 MANDATE 头，
 * 例如 `approved: 2022-03-26` / `owner: Alana Grant`。
 *
 * 为什么需要它：Jira 运行时读不到 Confluence 页面元数据（跨产品 token 实测 401），
 * 但 Jira issue 的关联、描述、经办人都是本产品能读到的真实字段。把授权记录放在
 * Jira issue 里，收据才有可核验的时间和授权人，而不是永远 UNVERIFIABLE。
 * 只认带 MANDATE 标记的关联，普通 "relates to" 不会被误判成依据。
 */
function shapeDecisionIssue(raw) {
  const f = raw?.fields || {};
  const key = raw?.key;
  const text = textOfBody(f.description);
  if (!/mandate/i.test(text)) return null;
  const date = text.match(/approved\s*[:=]\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  if (!date) return null;
  const ownerName = text.match(/owner\s*[:=]\s*([^\n\r]+)/i);
  const self = String(raw?.self || '');
  const base = self.split('/rest/api/3/')[0];
  return {
    globalId: `jira:${key}`,
    title: f.summary || key,
    url: key && base ? `${base}/browse/${key}` : null,
    updated: date[1],
    owner: f.assignee?.accountId || null,
    ownerName: ownerName ? ownerName[1].trim() : f.assignee?.displayName || null,
    application: 'Jira',
  };
}

function linkedKeysOf(raw) {
  const links = raw?.fields?.issuelinks || [];
  return links
    .map((l) => l?.outwardIssue?.key || l?.inwardIssue?.key)
    .filter(Boolean);
}

/**
 * @param {object} deps
 * @param {object} [deps.api] 注入 @forge/api（测试时传假对象）
 * @returns {null | {getIssue,getIssueLinks,searchIssues,getComments}}
 */
function createJiraClient({ api = null } = {}) {
  const forge = api || loadApi();
  if (!forge || typeof forge.asUser !== 'function') return null;

  const asUser = () => forge.asUser();
  // Forge 的 requestJira 只接受 `route` 标签模板产出的路由；传普通字符串会被运行时拒绝
  // （"You must create your route using the 'route' export"）。整条路径作为插值还会被
  // 判成 "path manipulation"，所以这里把静态路径写在模板里，只把 key / jql / limit 作变量。
  const routeTag = typeof forge.route === 'function' ? forge.route : null;
  function routeFor(strings, ...values) {
    if (routeTag) return routeTag(strings, ...values);
    return strings.reduce((acc, s, i) => acc + s + (values[i] == null ? '' : String(values[i])), '');
  }
  const ISSUE_FIELDS = 'summary,status,created,updated,project,statuscategorychangedate,resolution';

  const request = async (route, label) => {
    let res;
    try {
      res = await asUser().requestJira(route, { headers: { Accept: 'application/json' } });
    } catch (err) {
      // Forge 的 product fetch 在认证失败时是 throw，而不是返回 401 响应。
      const auth = err && (err.status === 401 || /Authentication Required/i.test(err.message));
      if (!auth || typeof forge.asApp !== 'function') throw err;
      console.warn('[mandate] jira asUser threw, retry asApp', label || 'request', err && err.status, err && err.message);
      res = await forge.asApp().requestJira(route, { headers: { Accept: 'application/json' } });
    }
    // 生产安装后 asUser token 可能返回 401（用户会话与 app 授权不同步）。
    // 读路径退到 asApp：只读、只取当前用户已经打开的工作项，避免整张收据变红。
    if (res && res.status !== 200) {
      console.log('[mandate] jira fetch status', label || 'request', res.status, 'asApp?', typeof forge.asApp);
    }
    if (res && res.status === 401 && typeof forge.asApp === 'function') {
      console.warn('[mandate] jira asUser 401, retry asApp', label || 'request');
      res = await forge.asApp().requestJira(route, { headers: { Accept: 'application/json' } });
    }
    if (!res || res.ok === false) {
      const err = new Error(`jira ${label || 'request'} failed: ${res?.status ?? 'unknown'}`);
      err.status = res?.status;
      throw err;
    }
    return typeof res.json === 'function' ? res.json() : res;
  };

  /**
   * 端点迁移期要把"新端点没上线"和"权限/参数错"分开：
   * 只有 404 / 410 才说明这条路径在站点上不存在，换下一条；
   * 401/403/400 是这条路径本身的问题，换端点只会把错误藏起来。
   */
  async function requestAny(paths) {
    let last = null;
    for (const path of paths) {
      try {
        return await request(path);
      } catch (err) {
        last = err;
        if (err.status !== 404 && err.status !== 410) throw err;
      }
    }
    throw last;
  }

  return {
    async getIssue(key) {
      return shapeIssue(await request(routeFor`/rest/api/3/issue/${key}`, 'issue'));
    },

    async getIssueLinks(key) {
      const [remoteRaw, issueRaw] = await Promise.all([
        request(routeFor`/rest/api/3/issue/${key}/remotelink`, 'remote links'),
        request(routeFor`/rest/api/3/issue/${key}`, 'issue links').catch((err) => {
          // 关联 issue 取不到不能连累 remote link；页面链接仍是一条可见依据。
          console.warn('[mandate] issue links failed', key, err && err.status);
          return null;
        }),
      ]);
      const linked = [];
      for (const k of linkedKeysOf(issueRaw)) {
        try {
          linked.push(await request(routeFor`/rest/api/3/issue/${k}`, 'linked issue'));
        } catch (err) {
          console.warn('[mandate] linked issue failed', k, err && err.status);
        }
      }
      // 授权记录优先于普通页面链接：前者带 approved 日期与 owner，收据才可核验。
      return [...linked.map(shapeDecisionIssue).filter(Boolean), ...shapeLinks(remoteRaw)];
    },

    /**
     * 批量补水：一次请求拿回一页 issue 的元数据（最多 50 条）。
     * 非法 key 直接丢弃——JQL 是拼字符串，不能把调用方给的值原样塞进去。
     */
    async getIssues(keys = []) {
      const safe = [...new Set(keys.map(String).filter((k) => KEY_RE.test(k)))].slice(0, 50);
      if (!safe.length) return [];
      const q = `key in (${safe.join(',')})`;
      const raw = await requestAny([
        routeFor`/rest/api/3/search/jql?jql=${q}&maxResults=${safe.length}`,
        routeFor`/rest/api/3/search?jql=${q}&maxResults=${safe.length}`,
      ]);
      return (raw?.issues || []).map(shapeIssue);
    },

    async searchIssues(projectKey, limit = 25) {
      const jql = `project = "${String(projectKey).replace(/"/g, '')}" ORDER BY updated DESC`;
      const capped = Math.min(Number(limit) || 25, 50);
      const raw = await requestAny([
        routeFor`/rest/api/3/search/jql?jql=${jql}&maxResults=${capped}`,
        routeFor`/rest/api/3/search?jql=${jql}&maxResults=${capped}`,
      ]);
      const issues = raw?.issues ?? [];
      return issues.map((i) => i.key).filter(Boolean);
    },

    async getComments(key) {
      const raw = await request(routeFor`/rest/api/3/issue/${key}/comment`, 'comments');
      // body 是 ADF 对象（v3），压成纯文本再交给 confirm.js 匹配指纹。
      // 这里不返回 body 会让"留痕"永远读不回来——单测里用字符串 body 是看不出来的。
      return (raw?.comments || []).map((c) => ({
        id: c.id,
        body: textOfBody(c.body),
        author: c.author?.accountId,
        created: c.created,
      }));
    },

    async canWrite() {
      return false; // 只读：写入能力由 manifest 的 scope 决定，v1 不申请
    },
  };
}

module.exports = { createJiraClient, shapeIssue, shapeLinks, shapeDecisionIssue, linkedKeysOf, ROUTE };
