'use strict';

/**
 * 硬化断言：这些不是"功能对不对"，而是"在别人的站点上会不会出事"。
 * 每一条都对应一个真实会发生的故障：卡死、限流、跨用户串数据、脚本注入、N+1。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { withTimeout, retry, isTransient, timeoutErr } = require('../src/io/timeout');
const { createCache } = require('../src/io/cache');
const { safeUrl } = require('../src/io/safe');
const { makeError } = require('../src/io/errors');
const { createTwgPort } = require('../src/ports/evidence.twg');
const { createRestPort, mapLimit } = require('../src/ports/evidence.rest');

test('超时：无响应的查询在 5ms 后变成 E_TIMEOUT，而不是把面板挂住', async () => {
  const never = new Promise(() => {});
  await assert.rejects(withTimeout(never, 5), (err) => err.code === 'E_TIMEOUT');
});

test('重试：429 允许重试一次，业务错误一次都不重试', async () => {
  let calls = 0;
  const once = await retry(
    async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('rate limited');
        err.status = 429;
        throw err;
      }
      return 'ok';
    },
    { attempts: 2 },
  );
  assert.equal(once, 'ok');
  assert.equal(calls, 2);

  let scopeCalls = 0;
  await assert.rejects(
    retry(
      async () => {
        scopeCalls += 1;
        throw makeError('E_SCOPE', { detail: 'missing scope' });
      },
      { attempts: 3, shouldRetry: isTransient },
    ),
  );
  assert.equal(scopeCalls, 1, 'scope 错误不该被重试三次');
});

test('缓存：键必须带 userId，两个用户同一 key 不能互相命中', () => {
  const cache = createCache({ ttlMs: 60_000, max: 10 });
  const kA = cache.key('user-A', ['twg', 'KAN-3', 'software']);
  const kB = cache.key('user-B', ['twg', 'KAN-3', 'software']);
  assert.notEqual(kA, kB);

  cache.set(kA, { debt: 28 });
  assert.equal(cache.get(kA).debt, 28);
  assert.equal(cache.get(kB), undefined, 'B 不能命中 A 的缓存');
  assert.equal(cache.key(null, ['twg', 'KAN-3']), null, '没有身份就不许造键');
});

test('缓存：错误与 unknown 不入缓存，TTL 到期即失效', () => {
  let clock = 0;
  const cache = createCache({ ttlMs: 10, max: 5, now: () => clock });
  const k = cache.key('u', ['twg', 'KAN-9']);
  cache.set(k, { ok: false, code: 'E_TIMEOUT' });
  cache.set(cache.key('u', ['twg', 'KAN-11']), { grade: 'unknown', debt: 0 });
  assert.equal(cache.get(k), undefined, '错误不进缓存');
  assert.equal(cache.get(cache.key('u', ['twg', 'KAN-11'])), undefined, 'unknown 不进缓存');

  cache.set(k, { ok: true, debt: 12 });
  assert.equal(cache.get(k).debt, 12);
  clock = 20;
  assert.equal(cache.get(k), undefined, '过期即失效');
});

test('链接安全：javascript:/data: 一律不放行', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('JavaScript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(safeUrl('  javascript:alert(1)  '), null);
  assert.equal(safeUrl(''), null);
  assert.equal(safeUrl(null), null);
  assert.equal(
    safeUrl('https://example.atlassian.net/wiki/spaces/KAN/pages/8841'),
    'https://example.atlassian.net/wiki/spaces/KAN/pages/8841',
  );
});

test('能力探测：缺 page scope 时 decisions 直接 unknown，不发猜测', async () => {
  let queried = 0;
  const port = createTwgPort({
    scopes: ['read:graph:issue:jira'],
    query: async () => {
      queried += 1;
      return {
        issue: { key: 'T-1' },
        decisions: { state: 'present', items: [{ id: 'p1', title: 'Should be ignored' }] },
        goals: { state: 'present', items: [] },
        reviewTraces: { state: 'present', items: [] },
      };
    },
  });
  const b = await port.getBundle('T-1');
  assert.equal(b.edges.decisions.state, 'unknown');
  assert.equal(b.edges.decisions.reason, 'decisions-scope-missing');
  assert.equal(b.edges.decisions.items.length, 0);
  assert.ok(queried <= 1);
  assert.deepEqual(port.status().missing, ['decisions', 'reviewTraces']);
});

test('扫描只有一次往返：25 条不滑成 25 次查询', async () => {
  let calls = 0;
  const port = createTwgPort({
    query: async ({ type }) => {
      calls += 1;
      assert.equal(type, 'provenance.scan');
      return {
        issues: Array.from({ length: 25 }, (_, i) => ({
          issue: { key: `S-${i}`, summary: `s${i}` },
          decisions: { state: 'absent', items: [] },
          goals: { state: 'absent', items: [] },
          reviewTraces: { state: 'absent', items: [] },
        })),
      };
    },
  });
  const bundles = await port.listBundles('S', 25);
  assert.equal(bundles.length, 25);
  assert.equal(calls, 1, 'scan 必须一次取回全部边');
});

test('扫描有上限：limit 50 被夹到 50，超过即拒', async () => {
  const seen = [];
  const port = createTwgPort({
    query: async ({ limit }) => {
      seen.push(limit);
      return { issues: [] };
    },
  });
  await port.listBundles('S', 999);
  assert.equal(seen[0], 50);
});

test('REST 降级：并发有界，且单条失败不影响其余条目', async () => {
  let inFlight = 0;
  let peak = 0;
  const client = {
    getIssue: async (key) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      if (key === 'R-2') throw timeoutErr(1);
      return { fields: { summary: key, project: { key: 'R' } } };
    },
    getIssueLinks: async () => [],
    searchIssues: async () => ['R-1', 'R-2', 'R-3', 'R-4', 'R-5', 'R-6'],
  };
  const port = createRestPort({ client, concurrency: 2 });
  const bundles = await port.listBundles('R', 6);
  assert.equal(bundles.length, 6);
  assert.ok(peak <= 2, `并发不得超过 2，实际 ${peak}`);
  assert.equal(bundles[1].status, 'unknown', '失败那条是 unknown，不是缺失');
  assert.equal(bundles[0].edges.decisions.state, 'absent', '其余条目照常给结论');
});

test('mapLimit 保持顺序：并发不等于乱序', async () => {
  const out = await mapLimit([3, 1, 2], 2, async (n) => {
    await new Promise((r) => setTimeout(r, n * 2));
    return n * 10;
  });
  assert.deepEqual(out, [30, 10, 20]);
});

test('错误码双语：英文回复里不出现中文', () => {
  const en = makeError('E_SCOPE', { detail: 'page scope', scope: 'read:graph:page:confluence', lang: 'en' });
  assert.ok(!/[\u4e00-\u9fa5]/.test(en.message), `英文 message 混入中文：${en.message}`);
  assert.ok(!/[\u4e00-\u9fa5]/.test(en.hint), `英文 hint 混入中文：${en.hint}`);
  assert.match(en.message, /page scope/);

  const zh = makeError('E_SCOPE', { detail: 'page scope', scope: 'read:graph:page:confluence', lang: 'zh' });
  assert.match(zh.message, /缺少授权/);
  assert.equal(zh.messageEn, en.message, '两版都要带回去，切语言不用重算');
});
