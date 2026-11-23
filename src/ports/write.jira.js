'use strict';

/**
 * 唯一的写路径：在 issue 上写一条结构化评论。
 *
 * 为什么写评论而不是改字段：
 *   - 复核这件事需要"谁、什么时候、对着哪份依据"三个信息，字段装不下；
 *   - 评论是 Jira 里天然可审计、可回溯、别人能在时间线上看到的；
 *   - 评论不改变工作项状态，不会打断任何人的工作流。
 *
 * 三个真网站上的坑，在这里一次性处理掉：
 *   1. Jira Cloud REST v3 的评论 body 必须是 ADF（不是纯文本），发纯文本会 400；
 *   2. 读回来的 body 也是 ADF，指纹存在段落节点里，必须能把它压回纯文本再匹配；
 *   3. 拿不到 write scope 时这个方法根本不会被调用 —— 端口在构造时就返回 null。
 *
 * 本模块是源码里唯一允许出现写请求动词的地方。`marketplace/check.js` 会对此断言：
 * 除它以外任何文件出现 POST/PUT/PATCH/DELETE 都算破例。
 */

const { MARKER } = require('../io/marker');
const { adfFromText, textOfAdf, textOfBody } = require('../io/adf');

const COMMENT_ROUTE = (key) => `/rest/api/3/issue/${encodeURIComponent(key)}/comment`;

function loadApi() {
  try {
    return require('@forge/api');
  } catch {
    return null;
  }
}

/**
 * @param {object} deps
 * @param {object} [deps.api] 注入 @forge/api（测试时传假对象）
 * @param {string[]} [deps.scopes] 本次调用的授权范围
 * @returns {null | {available:true, listComments:Function, addComment:Function}}
 */
function createWritePort({ api = null, scopes = [] } = {}) {
  const forge = api || loadApi();
  const granted = Array.isArray(scopes) && scopes.includes('write:jira-work');
  if (!granted || !forge || typeof forge.asUser !== 'function') return null;

  const routeTag = typeof forge.route === 'function' ? forge.route : null;
  function routeFor(strings, ...values) {
    if (routeTag) return routeTag(strings, ...values);
    return strings.reduce((acc, s, i) => acc + s + (values[i] == null ? '' : String(values[i])), '');
  }
  const commentRoute = (key) => routeFor`/rest/api/3/issue/${key}/comment`;

  const request = async (route, init) => {
    const res = await forge.asUser().requestJira(route, init);
    if (!res || res.ok === false) {
      const err = new Error(`jira write ${path} failed: ${res?.status ?? 'unknown'}`);
      err.status = res?.status;
      throw err;
    }
    return typeof res.json === 'function' ? res.json() : res;
  };

  return {
    available: true,

    async listComments(key) {
      const raw = await request(commentRoute(key), { headers: { Accept: 'application/json' } });
      return (raw?.comments || []).map((c) => ({
        id: c.id,
        body: textOfBody(c.body),
        created: c.created,
        author: c.author?.accountId ?? null,
      }));
    },

    /** @returns {Promise<{id:string|null}>} */
    async addComment(key, text) {
      const raw = await request(commentRoute(key), {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: adfFromText(text) }),
      });
      return { id: raw?.id ?? null };
    },
  };
}

module.exports = { createWritePort, adfFromText, textOfAdf, textOfBody, COMMENT_ROUTE, MARKER };
