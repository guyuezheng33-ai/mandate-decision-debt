'use strict';

/**
 * 端口链的断言：降级必须是"诚实降级"，不是"换个来源继续报红"。
 * 这里每条断言都对应一个真站点上必然会出现的场景。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createChainPort, usable } = require('../src/ports/chain');
const { getProfile } = require('../src/engine/profiles');
const { summarize } = require('../src/engine/score');

const EDGE = (state, items = []) => ({ state, items, reason: null });

function twgBundle(over = {}) {
  return {
    issueKey: 'KAN-3',
    summary: 'One-click archive',
    status: 'In Review',
    statusCategory: 'indeterminate',
    inProgressSince: '2026-06-20',
    reopenedCount: 0,
    source: 'twg',
    edges: {
      decisions: EDGE('present', [{ id: 'p1', title: 'Decision record', updated: '2026-08-14', owner: 'me' }]),
      goals: EDGE('present', [{ id: 'g1', status: 'open' }]),
      reviewTraces: EDGE('present', [{ id: 'c1', author: 'me' }]),
      ...over,
    },
  };
}

function restBundle() {
  // REST 只能看见 remote links：页面更新时间、贡献者一律拿不到
  return {
    issueKey: 'KAN-3',
    summary: 'One-click archive',
    status: 'In Review',
    statusCategory: 'indeterminate',
    inProgressSince: '2026-06-20',
    reopenedCount: 0,
    source: 'rest',
    edges: {
      decisions: EDGE('present', [{ id: 'p1', title: 'Decision record', updated: null, owner: null }]),
      goals: EDGE('absent'),
      reviewTraces: EDGE('unknown'),
    },
  };
}

function counting(port) {
  const calls = { getBundle: 0, listBundles: 0 };
  return {
    calls,
    port: {
      ...port,
      getBundle: (k, o) => {
        calls.getBundle += 1;
        return port.getBundle(k, o);
      },
      listBundles: (p, l, o) => {
        calls.listBundles += 1;
        return port.listBundles(p, l, o);
      },
    },
  };
}

const scopeError = () => Object.assign(new Error('missing read:graph:page'), { code: 'E_SCOPE' });

test('主端口可用时，降级端口一次都不被调用', async () => {
  const primary = counting({
    capabilities: () => ({ decisions: true, goals: true, reviewTraces: true }),
    status: () => ({ source: 'twg' }),
    getBundle: async () => twgBundle(),
    listBundles: async () => [twgBundle()],
  });
  const fallback = counting({
    capabilities: () => ({ decisions: true, goals: false, reviewTraces: false }),
    status: () => ({ source: 'rest' }),
    getBundle: async () => restBundle(),
    listBundles: async () => [restBundle()],
  });

  const chain = createChainPort({ primary: primary.port, fallback: fallback.port });
  const b = await chain.getBundle('KAN-3', { userId: 'u1' });
  assert.equal(b.source, 'twg');
  assert.equal(b.degraded, undefined);
  assert.equal(fallback.calls.getBundle, 0);
  await chain.listBundles('KAN', 25, { userId: 'u1' });
  assert.equal(fallback.calls.listBundles, 0);
});

test('主端口整体抛 E_SCOPE 时降级，并把降级原因带在 bundle 上', async () => {
  const primary = {
    capabilities: () => ({ decisions: true, goals: true, reviewTraces: true }),
    status: () => ({ source: 'twg' }),
    getBundle: async () => {
      throw scopeError();
    },
    listBundles: async () => {
      throw scopeError();
    },
  };
  const fallback = {
    capabilities: () => ({ decisions: true, goals: false, reviewTraces: false }),
    status: () => ({ source: 'rest' }),
    getBundle: async () => restBundle(),
    listBundles: async () => [restBundle()],
  };

  const chain = createChainPort({ primary, fallback });
  const b = await chain.getBundle('KAN-3', { userId: 'u1', asOf: '2026-11-20' });

  assert.equal(b.source, 'rest');
  assert.equal(b.degraded.from, 'twg');
  assert.equal(b.degraded.to, 'rest');
  assert.equal(b.degraded.reason, 'E_SCOPE');
  // 主端口能证、REST 证不了的边必须压成 unknown
  assert.equal(b.edges.goals.state, 'unknown');
  assert.equal(b.edges.reviewTraces.state, 'unknown');
  assert.deepEqual(b.degraded.blindEdges.sort(), ['goals', 'reviewTraces']);
});

test('降级后的分数不产生"基于没看到"的判据，且覆盖率如实下降', async () => {
  const primary = { getBundle: async () => { throw scopeError(); }, listBundles: async () => [] };
  const fallback = { getBundle: async () => restBundle(), listBundles: async () => [restBundle()] };
  const chain = createChainPort({ primary, fallback });
  const b = await chain.getBundle('KAN-3', { userId: 'u1' });

  const s = summarize(b, getProfile('software'));
  assert.equal(s.flagCount, 0, '不该报出任何判据');
  assert.ok(s.coverage.known < s.coverage.total, '覆盖率必须显示为不足');
  assert.equal(s.degraded.from, 'twg');
});

test('主端口局部不可知时不降级（不把两份证据拼成一份）', async () => {
  const primary = counting({
    getBundle: async () => twgBundle({ decisions: EDGE('unknown', []) }),
    listBundles: async () => [],
  });
  const fallback = counting({ getBundle: async () => restBundle(), listBundles: async () => [] });

  const chain = createChainPort({ primary: primary.port, fallback: fallback.port });
  const b = await chain.getBundle('KAN-3', { userId: 'u1' });
  assert.equal(fallback.calls.getBundle, 0);
  assert.equal(b.edges.decisions.state, 'unknown');
  assert.equal(b.degraded, undefined);
});

test('两个端口都不可用时，保留主端口的错误码（信息量更大）', async () => {
  const primary = { getBundle: async () => { throw scopeError(); } };
  const fallback = { getBundle: async () => { throw Object.assign(new Error('boom'), { status: 503 }); } };
  const chain = createChainPort({ primary, fallback });
  const b = await chain.getBundle('KAN-3', { userId: 'u1' });
  assert.equal(usable(b), false);
  assert.equal(b.errors[0].code, 'E_SCOPE');
  assert.equal(b.edges.decisions.state, 'unknown');
});

test('扫描降级时条目被夹到 50，且每一条都带降级标记', async () => {
  const many = Array.from({ length: 80 }, (_, i) => restBundle());
  const primary = { listBundles: async () => { throw scopeError(); }, getBundle: async () => twgBundle() };
  const fallback = { listBundles: async () => many, getBundle: async () => restBundle() };

  const chain = createChainPort({ primary, fallback });
  const list = await chain.listBundles('KAN', 999, { userId: 'u1' });
  assert.equal(list.length, 50);
  assert.equal(list.every((b) => b.degraded && b.degraded.reason === 'E_SCOPE'), true);
});

test('降级后 status() 说出"从哪降到了哪"，而不是假装一切正常', async () => {
  const primary = { status: () => ({ source: 'twg' }), getBundle: async () => { throw scopeError(); } };
  const fallback = { status: () => ({ source: 'rest' }), getBundle: async () => restBundle() };
  const chain = createChainPort({ primary, fallback });
  await chain.getBundle('KAN-3', { userId: 'u1' });
  const s = chain.status();
  assert.equal(s.source, 'twg→rest');
  assert.equal(s.degraded, true);
  assert.equal(s.degradedReason, 'E_SCOPE');
});
