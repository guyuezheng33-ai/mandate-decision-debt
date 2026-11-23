'use strict';

/**
 * 写路径的四条硬规则，每条一个用例。
 * 这些错都只在真站点上出现，本地假 client 恰好会把它们全部掩盖：
 *   - ADF 与纯文本不一致（写进去读不回来）
 *   - 指纹含 lastConfirmAt（写完自己让指纹变了 → 重复写）
 *   - 写成功但读不到（谎报已留痕）
 *   - 写失败一律报"没有权限"（用户被告知去申请权限，而真实原因是超时）
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { createWritePort } = require('../src/ports/write.jira');
const { createRepairPort } = require('../src/ports/repair.jira');
const { withStamps } = require('../src/ports/confirm');
const { createFixturePort } = require('../src/ports/evidence.fixture');
const { createActions } = require('../src/resolvers/action');
const { createCache } = require('../src/io/cache');
const { adfFromText, textOfBody } = require('../src/io/adf');
const { MARKER, latestStampAt } = require('../src/io/marker');

const FIXTURES = path.join(__dirname, '..', 'src', 'fixtures');

function forgeApi({ comments = [], onCreate = null } = {}) {
  const calls = [];
  let seq = 0;
  return {
    calls,
    asUser: () => ({
      async requestJira(route, init = {}) {
        const method = init.method || 'GET';
        calls.push({ route, method, body: init.body });
        if (method === 'GET') {
          return { ok: true, status: 200, json: async () => ({ comments }) };
        }
        seq += 1;
        const created = onCreate ? onCreate(seq) : { id: `c${seq}`, created: new Date().toISOString() };
        if (created) comments.push({ id: created.id, body: JSON.parse(init.body).body, created: created.created });
        return { ok: true, status: 201, json: async () => ({ id: created?.id ?? null }) };
      },
    }),
  };
}

/** 一个最小的写 client：只实现 repair 需要的两个方法，行为可调。 */
function memoryWrite({ failList = 0, failPost = 0, hideAfterPost = false } = {}) {
  const store = [];
  let seq = 0;
  const read = async () => {
    if (failList) throw Object.assign(new Error('list failed'), { status: failList });
    return store.slice();
  };
  return {
    store,
    client: {
      // 生产里这两件事由两个模块各做一半：读（jira.client.getComments）、写（write.jira.listComments）。
      // 这里合成一个 client，好让"写→读回"的闭环在一个用例里完整跑通。
      getComments: read,
      listComments: read,
      async addComment(key, text) {
        if (failPost) throw Object.assign(new Error('post failed'), { status: failPost });
        seq += 1;
        const c = { id: `c${seq}`, body: text, created: new Date().toISOString() };
        if (!hideAfterPost) store.push(c);
        return { id: c.id };
      },
    },
  };
}

test('写端口：没有 write scope 时不存在；有 scope 时评论 body 是 ADF', async () => {
  assert.equal(createWritePort({ api: forgeApi(), scopes: ['read:jira-work'] }), null);

  const api = forgeApi();
  const port = createWritePort({ api, scopes: ['read:jira-work', 'write:jira-work'] });
  assert.equal(port.available, true);
  await port.addComment('KAN-3', 'hello\nworld');

  const post = api.calls.find((c) => c.method === 'POST');
  const payload = JSON.parse(post.body);
  assert.equal(payload.body.type, 'doc');
  assert.equal(payload.body.content.length, 2);
  assert.equal(payload.body.content[0].content[0].text, 'hello');
});

test('ADF 往返：指纹写进段落，读回来还能捞出来', () => {
  const text = `依据已复核\n${MARKER}dd-1a2b3c4d\n复核人：QA`;
  const body = adfFromText(text);
  const back = textOfBody(body);
  assert.ok(back.includes(`${MARKER}dd-1a2b3c4d`));
  assert.equal(latestStampAt([{ body: back, created: '2026-11-20T01:00:00.000Z' }]), '2026-11-20T01:00:00.000Z');
});

test('repair：同一份证据只写一条（指纹不含 lastConfirmAt）', async () => {
  const { client, store } = memoryWrite();
  const repair = createRepairPort({ client, scopes: ['read:jira-work', 'write:jira-work'] });
  const bundle = await createFixturePort({ dir: FIXTURES }).getBundle('KAN-3');
  const first = await repair.stamp(bundle, { key: 'software', name: 'Software delivery' }, { actor: 'qa' });
  const second = await repair.stamp(bundle, { key: 'software', name: 'Software delivery' }, { actor: 'qa' });

  assert.equal(first.ok, true);
  assert.equal(first.verified, true);
  assert.equal(second.skipped, true);
  assert.equal(store.length, 1);
});

test('repair：写完读不到自己的指纹时报 E_WRITE_UNVERIFIED，不谎报成功', async () => {
  const { client } = memoryWrite({ hideAfterPost: true });
  const repair = createRepairPort({ client, scopes: ['read:jira-work', 'write:jira-work'] });
  const bundle = await createFixturePort({ dir: FIXTURES }).getBundle('KAN-3');
  const r = await repair.stamp(bundle, { key: 'software', name: 'Software delivery' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_WRITE_UNVERIFIED');
});

test('repair：写失败按真实原因分类（403 是权限，500 是平台，不是同一句话）', async () => {
  const denied = createRepairPort({ client: memoryWrite({ failPost: 403 }).client, scopes: ['write:jira-work'] });
  const server = createRepairPort({ client: memoryWrite({ failPost: 500 }).client, scopes: ['write:jira-work'] });
  const bundle = await createFixturePort({ dir: FIXTURES }).getBundle('KAN-3');

  const a = await denied.stamp(bundle, { key: 'software', name: 'Software delivery' });
  const b = await server.stamp(bundle, { key: 'software', name: 'Software delivery' });
  assert.equal(a.code, 'E_WRITE_DENIED');
  assert.equal(b.code, 'E_SERVER');
});

test('confirm：评论里的留痕折成 lastConfirmAt；读失败不改证据', async () => {
  const base = await createFixturePort({ dir: FIXTURES }).getBundle('KAN-3');
  const stamped = await withStamps(base, {
    getComments: async () => [{ body: `${MARKER}dd-1a2b3c4d`, created: '2026-11-20T01:00:00.000Z' }],
  });
  assert.equal(stamped.lastConfirmAt, '2026-11-20T01:00:00.000Z');
  assert.equal(stamped.confirmSource, 'stamp');

  const failed = await withStamps(base, {
    getComments: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(failed.lastConfirmAt, null);
  assert.equal(failed.confirmLookup, 'failed');
});

test('stampMandate：写后重算，debtBefore → debtAfter 真的下降', async () => {
  const { client } = memoryWrite();
  const base = createFixturePort({ dir: FIXTURES });
  const evidencePort = {
    getBundle: async (key, opts) => withStamps(await base.getBundle(key, opts), client),
    listBundles: async () => [],
    status: () => ({ source: 'fixture' }),
  };
  const repairPort = createRepairPort({ client, scopes: ['read:jira-work', 'write:jira-work'] });

  const calls = [];
  const actions = createActions({
    evidencePort,
    repairPort,
    invalidate: (args) => {
      calls.push(args);
      return 2;
    },
  });

  const out = await actions.stampMandate({ inputs: { issueKey: 'KAN-3', actor: 'qa' } });
  assert.equal(out.ok, true);
  assert.equal(out.debtBefore, 28);
  assert.equal(out.debtAfter, 8); // P2 沉默，只剩 P6
  assert.equal(out.delta, 20);
  assert.equal(out.invalidated, 2);
  assert.equal(calls[0].projectKey, 'KAN');
});

test('cache.dropWhere：只失效本用户的条目，不误伤别人', () => {
  const cache = createCache({ ttlMs: 60_000, max: 10 });
  const mineIssue = cache.key('u1', ['rest', 'KAN-3', 'software', '-']);
  const mineScan = cache.key('u1', ['twg-scan', 'KAN', '50', '-']);
  const other = cache.key('u2', ['rest', 'KAN-3', 'software', '-']);
  const lookalike = cache.key('u1', ['rest', 'KAN-30', 'software', '-']);
  for (const k of [mineIssue, mineScan, other, lookalike]) cache.set(k, { grade: 'watch' });

  const dropped = cache.dropWhere((k) => k.startsWith('u1|') && (k.includes('|KAN-3|') || k.includes('|KAN|')));
  assert.equal(dropped, 2);
  assert.equal(cache.size(), 2);
  assert.ok(cache.get(other));
  assert.ok(cache.get(lookalike));
});
