'use strict';

/**
 * 进程内 LRU 缓存（每条 Forge 函数实例都有自己的一份）。
 *
 * 这里只有一条铁律：**缓存键必须包含 userId**。
 * 理由：TWG 与 Jira 都以 asUser() 授权，同一个 issueKey 对不同用户可见的边可能不同。
 * 少了 userId，A 看到的依据链会被 B 命中——那不是缓存，是越权泄漏。
 *
 * 另外两条：
 * - 只缓存成功结果：错误与 unknown 一律不进缓存，否则一次超时会污染 60 秒。
 * - TTL 短（默认 60s）：这是"同一屏刷新不要重复打图"，不是离线快照。
 */

function createCache({ ttlMs = 60_000, max = 200, now = () => Date.now() } = {}) {
  const store = new Map();
  const hits = { get: 0, hit: 0, miss: 0, evict: 0, reject: 0 };
  // 每发生一次批量失效就 +1。读请求出发时记下它看到的世代，
  // 回来时对不上，就不许把旧结果写回缓存。
  let epoch = 0;

  function key(userId, parts) {
    if (!userId) return null; // 没有身份就不许缓存
    return [userId, ...parts].join('|');
  }

  function get(k) {
    if (!k) {
      hits.reject += 1;
      return undefined;
    }
    hits.get += 1;
    const row = store.get(k);
    if (!row) {
      hits.miss += 1;
      return undefined;
    }
    if (row.expires <= now()) {
      store.delete(k);
      hits.miss += 1;
      return undefined;
    }
    // LRU：命中后移到队尾
    store.delete(k);
    store.set(k, row);
    hits.hit += 1;
    return row.value;
  }

  function set(k, value, token) {
    if (!k) {
      hits.reject += 1;
      return;
    }
    if (value == null) return;
    if (typeof value === 'object' && value.ok === false) return; // 错误不缓存
    if (typeof value === 'object' && value.grade === 'unknown') return; // 未知不缓存
    // 失效令牌：读请求在"失效之前"出发、在"失效之后"才回来时，它手里的是旧世界。
    // 没有这一行，刚留痕的用户会看到分数被打回原样，且要等满 60 秒。
    if (token !== undefined && token !== epoch) {
      hits.reject += 1;
      return;
    }
    store.delete(k);
    store.set(k, { value, expires: now() + ttlMs });
    while (store.size > max) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
      hits.evict += 1;
    }
  }

  /**
   * 按 key 前缀/片段批量失效。写操作之后必须调它，否则面板会继续展示写之前的分数，
   * 用户看到的是"我点了复核，数字没动"——这比没有按钮更伤信任。
   */
  function dropWhere(predicate) {
    let dropped = 0;
    epoch += 1; // 只要调用方明确发过一次失效，旧世代的读结果就不许再写回
    for (const k of store.keys()) {
      if (predicate(k)) {
        store.delete(k);
        dropped += 1;
        hits.evict += 1;
      }
    }
    if (dropped) for (const k of inflight.keys()) if (predicate(k)) inflight.delete(k);
    return dropped;
  }

  /**
   * 单飞：同一个 key 的并发请求只真正执行一次，其余的等同一个 Promise。
   *
   * 为什么值得写这一段：面板与 Rovo agent 可以同一秒打同一条 issue，
   * Forge 的每个函数实例又是独立进程，缓存救不了"还没写进缓存的那一刻"。
   * 没有单飞，同一屏两次点开就是两次图查询——在 20 秒超时的接口上，
   * 这不是浪费，是把自己推近超时线。
   *
   * 失败不进缓存（由 set() 的规则保证），这里只保证**并发**不重复。
   */
  const inflight = new Map();
  function single(k, loader) {
    if (!k) return loader();
    const running = inflight.get(k);
    if (running) return running;
    const p = Promise.resolve()
      .then(loader)
      .finally(() => {
        inflight.delete(k);
      });
    inflight.set(k, p);
    return p;
  }

  return {
    key,
    get,
    set,
    single,
    dropWhere,
    epoch: () => epoch,
    clear: () => store.clear(),
    size: () => store.size,
    stats: () => ({ ...hits, size: store.size }),
  };
}

module.exports = { createCache };
