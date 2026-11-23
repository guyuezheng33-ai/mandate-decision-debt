'use strict';

/**
 * 缓存的两条并发规则，各一个用例：
 *
 * 1. 单飞：同一 key 的并发读只真正执行一次。面板与 Rovo agent 同一秒点开同一条，
 *    Forge 又是每实例一份内存缓存，所以"还没写进缓存的那一瞬"只能靠单飞挡住。
 * 2. 世代：读请求在失效之前出发、失效之后回来，它手里的是旧世界，不许写回缓存。
 *    没有这条，刚留痕的用户会看到分数被旧结果打回原样，而且要等满 60 秒。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCache } = require('../src/io/cache');

test('单飞：同一 key 的 5 个并发请求只执行 1 次 loader', async () => {
  const cache = createCache();
  let calls = 0;
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const loader = async () => {
    calls += 1;
    await gate;
    return { ok: true, debt: 28 };
  };
  const all = Array.from({ length: 5 }, () => cache.single('u|twg|KAN-3', loader));
  release();
  const results = await Promise.all(all);
  assert.equal(calls, 1, '并发请求不应打穿到 loader');
  assert.ok(results.every((r) => r.debt === 28));
});

test('单飞：失败不会粘住，下一次调用会重新执行', async () => {
  const cache = createCache();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    if (calls === 1) throw new Error('boom');
    return { ok: true };
  };
  await assert.rejects(() => cache.single('u|k', loader));
  const ok = await cache.single('u|k', loader);
  assert.equal(ok.ok, true);
  assert.equal(calls, 2);
});

test('世代：失效之后回来的旧结果不许写回缓存', () => {
  const cache = createCache();
  const token = cache.epoch();
  cache.dropWhere(() => true); // 模拟写后失效
  cache.set('u|rest|KAN-3', { ok: true, debt: 28 }, token);
  assert.equal(cache.get('u|rest|KAN-3'), undefined, '旧世代的结果必须被拒写');
});

test('世代不变时，普通写入照常命中', () => {
  const cache = createCache();
  const token = cache.epoch();
  cache.set('u|rest|KAN-3', { ok: true, debt: 28 }, token);
  assert.equal(cache.get('u|rest|KAN-3').debt, 28);
});
