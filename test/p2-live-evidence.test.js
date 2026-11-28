'use strict';

/**
 * D1 · P2 在真实站点可判：编辑时间是一等证据，复核时间只认真实留痕。
 *
 * 每条用例都是一个能被程序拒绝的反例：
 *   - 把描述里手写的 approved 日期当编辑时间 → decidedAt 对不上服务器 updated，FAIL
 *   - 用常量日期冒充 decidedAt → 与记录 editedAt 不等，FAIL
 *   - 记录没有任何时间 → P2 必须是 unknown，不许洗成 clear，FAIL
 *   - 普通评论（无 mandate 指纹）→ 不许推动 lastConfirmAt，FAIL
 */

const test = require('node:test');
const assert = require('node:assert');

const { shapeDecisionIssue } = require('../src/ports/jira.client');
const { normalizeBundle, normalizeDecision } = require('../src/engine/normalize');
const { evaluate, maxDecided } = require('../src/engine/rules');
const { getProfile } = require('../src/engine/profiles');
const { withStamps } = require('../src/ports/confirm');
const { adfFromText, textOfBody } = require('../src/io/adf');

const PROFILE = getProfile('software', 'en');

/** 一条 Jira 原生授权记录：批准日期在 2022，服务器编辑时间在 2026。两者必须分开。 */
function rawDecisionIssue() {
  return {
    key: 'MDEMO-2',
    self: 'https://example.atlassian.net/rest/api/3/issue/66401',
    fields: {
      summary: 'Product requirements — approval record',
      updated: '2026-11-23T17:16:22.000+0000',
      created: '2026-11-23T17:16:13.000+0000',
      assignee: { accountId: 'acc-1', displayName: 'Alana Grant' },
      description: adfFromText('MANDATE\napproved: 2022-03-26\nowner: Alana Grant'),
    },
  };
}

test('shapeDecisionIssue：approved 日期与服务器 editedAt 分开，editedAt 来自 fields.updated', () => {
  const shaped = shapeDecisionIssue(rawDecisionIssue());
  assert.ok(shaped, 'MANDATE 记录必须被识别');
  assert.equal(shaped.updated, '2022-03-26');
  assert.equal(new Date(shaped.editedAt).toISOString(), '2026-11-23T17:16:22.000Z');
  assert.notEqual(shaped.updated, shaped.editedAt);
});

test('normalizeDecision：editedAt 透传；缺省时为 null，绝不拿 updated 冒充', () => {
  const withEdit = normalizeDecision({ id: 'x', updated: '2022-03-26', editedAt: '2026-11-23T17:16:22Z' });
  assert.equal(withEdit.editedAt, '2026-11-23T17:16:22.000Z');
  const without = normalizeDecision({ id: 'y', updated: '2022-03-26' });
  assert.equal(without.editedAt, null);
});

/** 开工 2026-10-02，记录 2026-11-23 被编辑，asOf 2026-12-10：间隔 17 天 >= 14，应命中。 */
function bundleWith({ editedAt, updated, asOf = '2026-12-10T00:00:00Z', lastConfirmAt = null }) {
  return normalizeBundle({
    key: 'MOBL-57',
    created: '2026-10-02T01:12:32Z',
    updated: asOf,
    inProgressSince: '2026-10-02T01:12:33Z',
    asOf,
    lastConfirmAt,
    source: 'rest',
    edges: {
      decisions: {
        state: 'present',
        items: [{ id: 'jira:MDEMO-2', title: 'approval record', url: 'https://example/browse/MDEMO-2', updated, editedAt }],
      },
      goals: { state: 'unknown', items: [] },
      reviewTraces: { state: 'unknown', items: [] },
    },
  });
}

test('P2：decidedAt 取服务器 editedAt，不是手写 approved 日期；命中且证据可对账', () => {
  const b = bundleWith({ editedAt: '2026-11-23T17:16:22Z', updated: '2022-03-26' });
  const { flags, criteria } = evaluate(b, PROFILE);
  const p2 = criteria.find((c) => c.p === 'P2');
  assert.equal(p2.state, 'hit');
  const flag = flags.find((f) => f.primitive === 'P2');
  assert.equal(flag.evidence.decidedAt, '2026-11-23T17:16:22.000Z');
  // 反例守卫：若实现退回 approved 日期或常量，这里立刻不等。
  assert.equal(flag.evidence.decidedAt, new Date(b.edges.decisions.items[0].editedAt).toISOString());
  assert.equal(flag.evidence.decisions[0].editedAt, '2026-11-23T17:16:22.000Z');
});

test('P2：只有 approved 日期、没有 editedAt 时退回 updated（fixture 兼容），不编造编辑时间', () => {
  const b = bundleWith({ editedAt: null, updated: '2026-11-01T00:00:00Z' });
  const { flags } = evaluate(b, PROFILE);
  const flag = flags.find((f) => f.primitive === 'P2');
  assert.ok(flag, '2026-11-01 编辑、开工 10-02、asOf 12-10：应命中');
  assert.equal(flag.evidence.decidedAt, '2026-11-01T00:00:00.000Z');
  assert.equal(flag.evidence.decisions[0].editedAt, null);
});

test('P2：记录没有任何时间 → unknown，不许洗成 clear', () => {
  const b = bundleWith({ editedAt: null, updated: null });
  const { criteria, flags } = evaluate(b, PROFILE);
  const p2 = criteria.find((c) => c.p === 'P2');
  assert.equal(p2.state, 'unknown');
  assert.ok(String(p2.why).includes('decisions-no-updated'));
  assert.ok(!flags.some((f) => f.primitive === 'P2'));
});

test('P2：已复核（confirmed >= editedAt）→ clear；复核早于编辑 → 仍 hit', () => {
  const confirmed = bundleWith({
    editedAt: '2026-11-23T17:16:22Z',
    updated: '2022-03-26',
    lastConfirmAt: '2026-11-24T00:00:00Z',
  });
  assert.equal(evaluate(confirmed, PROFILE).criteria.find((c) => c.p === 'P2').state, 'clear');
  const stale = bundleWith({
    editedAt: '2026-11-23T17:16:22Z',
    updated: '2022-03-26',
    lastConfirmAt: '2026-11-20T00:00:00Z',
  });
  assert.equal(evaluate(stale, PROFILE).criteria.find((c) => c.p === 'P2').state, 'hit');
});

test('maxDecided：editedAt 优先于 updated；面板与 traceDrift 共用同一函数', () => {
  const items = [
    { updated: '2022-03-26', editedAt: '2026-11-23T17:16:22Z' },
    { updated: '2026-11-25T00:00:00Z', editedAt: null },
  ];
  assert.equal(new Date(maxDecided(items)).toISOString(), '2026-11-25T00:00:00.000Z');
});

test('withStamps：只认带指纹的真实评论；正文手写日期与普通评论一律不推动 lastConfirmAt', async () => {
  const base = bundleWith({ editedAt: '2026-11-23T17:16:22Z', updated: '2022-03-26' });
  const stamped = textOfBody(adfFromText('依据已复核\nmandate:dd-1a2b3c4d'));
  const client = {
    getComments: async () => [
      { body: 'approved: 2026-12-01，我觉得没问题', created: '2026-12-01T00:00:00Z' },
      { body: stamped, created: '2026-11-24T09:00:00Z' },
    ],
  };
  const out = await withStamps(base, client);
  assert.equal(out.lastConfirmAt, '2026-11-24T09:00:00.000Z');
  assert.equal(out.confirmSource, 'stamp');

  const plain = await withStamps(base, {
    getComments: async () => [{ body: 'mandate 看起来没问题', created: '2026-12-02T00:00:00Z' }],
  });
  assert.equal(plain.lastConfirmAt, null);
});
