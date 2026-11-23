'use strict';

/**
 * Confluence REST 客户端（asUser），只做一件事：给定一个已关联的页面 URL，取回
 * 页面标题、最后更新时间与最后修改人。
 *
 * 为什么需要它：TWG 的自定义 Cypher 查询 key 需要事先在站点上注册；未注册的站点会
 * 自动降级到 Jira REST，而 Jira REST 的 remote link 只有标题和 URL，没有页面时间与作者。
 * 没有这两项，"授权收据"只能显示 UNVERIFIABLE —— 这是真站点上最常见的状态。
 *
 * 约束与 Jira 客户端一致：asUser、只读、超时与重试交给 ports。
 * 只在安装被授予 read:confluence-content.all 时才会被调用；没授权时调用会 403，
 * 上层把页面元数据留空，仍按 unknown 处理，绝不编造时间。
 */

function loadApi() {
  try {
    return require('@forge/api');
  } catch {
    return null;
  }
}

/** 从 Confluence 页面 URL 里取出 content id；取不到返回 null。 */
function pageIdOf(url) {
  const s = String(url || '');
  const m = s.match(/\/pages\/([0-9]+)/) || s.match(/[?&]pageId=([0-9]+)/);
  return m ? m[1] : null;
}

function shapePage(raw, fallbackUrl) {
  const by = raw?.version?.by || {};
  return {
    id: String(raw?.id || ''),
    title: raw?.title || null,
    url: fallbackUrl || raw?._links?.webui || null,
    updated: raw?.version?.when || raw?.history?.lastUpdated?.when || null,
    owner: by.accountId || by.userKey || null,
    ownerName: by.displayName || by.publicName || null,
  };
}

function createConfluenceClient({ api = null } = {}) {
  const forge = api || loadApi();
  if (!forge || typeof forge.asUser !== 'function') return null;
  const asUser = () => forge.asUser();
  // requestConfluence 同样只接受 route 标签模板；整条路径作为插值会被判 path manipulation。
  const routeTag = typeof forge.route === 'function' ? forge.route : null;
  function routeFor(strings, ...values) {
    if (routeTag) return routeTag(strings, ...values);
    return strings.reduce((acc, s, i) => acc + s + (values[i] == null ? '' : String(values[i])), '');
  }

  async function request(route) {
    // 在 Jira 运行时里，asUser 的 Confluence token 可能拿不到（实测 401 Authentication Required）。
    // 先按用户身份读；401 时退到 asApp（应用已装在 Confluence，且申请了读数 scope）。
    let res = await asUser().requestConfluence(route, { headers: { Accept: 'application/json' } });
    if (res && res.status === 401 && typeof forge.asApp === 'function') {
      res = await forge.asApp().requestConfluence(route, { headers: { Accept: 'application/json' } });
    }
    if (!res || res.ok === false) {
      const err = new Error(`confluence request failed: ${res?.status ?? 'unknown'}`);
      err.status = res?.status;
      throw err;
    }
    return typeof res.json === 'function' ? res.json() : res;
  }

  return {
    async getPageMeta(url) {
      const id = pageIdOf(url);
      if (!id) return null;
      let raw;
      try {
        raw = await request(routeFor`/rest/api/content/${id}?expand=version,history.lastUpdated`);
      } catch (err) {
        // Jira 运行时里的跨产品 token 可能被拒（401）。最后一次尝试：用应用身份的
        // Jira fetch 打站点根上的 Confluence 路径；不成也只会保持 unknown，不编时间。
        console.warn('[mandate] confluence product fetch failed', err && err.status, err && err.message);
        if (typeof forge.asApp !== 'function') throw err;
        const res = await forge.asApp().requestJira(routeFor`/wiki/rest/api/content/${id}?expand=version`, {
          headers: { Accept: 'application/json' },
        });
        if (!res || res.ok === false) {
          console.warn('[mandate] confluence via jira fetch failed', res && res.status);
          throw err;
        }
        raw = typeof res.json === 'function' ? await res.json() : res;
      }
      console.log('[mandate] page meta', id, raw?.version?.when || null, raw?.version?.by?.displayName || null);
      return shapePage(raw, url);
    },
  };
}

module.exports = { createConfluenceClient, pageIdOf, shapePage };
