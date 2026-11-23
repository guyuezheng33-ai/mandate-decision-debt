'use strict';

/**
 * 授权收据的四行事实必须由引擎一次算出来，不能由 UI 从 flags 反推。
 * 这组断言钉住三件事：
 * 1) stale 的日期与天数来自同一条依据页；
 * 2) 没有依据页时是 missing，不是 current；
 * 3) 依据页冲突时是 contested，即使最近一次复核还在窗口内。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createFixturePort } = require('../src/ports/evidence.fixture');
const { summarize } = require('../src/engine/score');
const { getProfile } = require('../src/engine/profiles');

const FIXTURES = path.join(__dirname, '..', 'src', 'fixtures');
const port = createFixturePort({ dir: FIXTURES });
const soft = getProfile('software', 'en');

test('KAN-3: 授权页 2026-08-14 更新，92 天没有重申，收据为 stale', () => {
  const authority = summarize(port.getBundle('kan3'), soft).authority;
  assert.equal(authority.verdict, 'stale');
  assert.equal(authority.ownerName, 'Alice Ng');
  assert.equal(authority.title, 'Archive policy: archive anything inactive for 90 days');
  assert.equal(authority.updatedAt.slice(0, 10), '2026-08-14');
  assert.equal(authority.daysSinceUpdate, 92);
  assert.equal(authority.daysWithoutConfirm, 92);
  assert.equal(authority.decisionCount, 1);
});

test('KAN-9: 没有依据页时收据为 missing，不能显示成“仍然有效”', () => {
  const authority = summarize(port.getBundle('kan9'), soft).authority;
  assert.equal(authority.verdict, 'missing');
  assert.equal(authority.title, null);
  assert.equal(authority.owner, null);
});

test('KAN-7: 两份依据页互相冲突时收据为 contested，即使复核日期很新', () => {
  const authority = summarize(port.getBundle('kan7'), soft).authority;
  assert.equal(authority.verdict, 'contested');
  assert.equal(authority.decisionCount, 2);
});

test('KAN-11: 依据链不可知时收据为 unknown，不猜 owner 也不猜日期', () => {
  const authority = summarize(port.getBundle('kan11'), soft).authority;
  assert.equal(authority.verdict, 'unknown');
  assert.equal(authority.owner, null);
  assert.equal(authority.updatedAt, null);
});

test('授权早于工作开始：不能因为“批准过”就默认 current，仍要按漂移天数判 stale', () => {
  const base = port.getBundle('kan20');
  const bundle = {
    ...base,
    createdAt: '2026-08-01T00:00:00.000Z',
    inProgressSince: '2026-08-01T00:00:00.000Z',
    lastConfirmAt: null,
    asOf: '2026-11-24T00:00:00.000Z',
    edges: {
      ...base.edges,
      decisions: {
        state: 'present',
        items: [
          {
            id: 'jira:MDEMO-2',
            title: 'Product requirements — approval record',
            url: 'https://one-atlas-ngpq.atlassian.net/browse/MDEMO-2',
            updated: '2022-03-26T00:00:00.000Z',
            ownerName: 'Alana Grant',
            contributors: ['Alana Grant'],
          },
        ],
      },
    },
  };
  const summary = summarize(bundle, soft);
  assert.equal(summary.authority.verdict, 'stale');
  assert.equal(summary.authority.kind, 'jira');
  assert.equal(summary.authority.ownerName, 'Alana Grant');
  assert.ok(summary.authority.daysWithoutConfirm > 1600);
  // 收据不能一边写“已失效”，一边挂一个绿色“健康”。
  assert.notEqual(summary.grade, 'healthy');
});
