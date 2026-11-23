'use strict';

/**
 * 测试用的 bundle 构造器。
 * 基线（零命中）：依据在 08 月改过、12 号已确认、目标在跑、有第二人复核。
 * 想测某条规则，就只改那一个字段——这样每个用例失败时都能立刻看出是哪条规则的回退。
 */

const { normalizeBundle } = require('../src/engine/normalize');
const fs = require('node:fs');
const path = require('node:path');

function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function base(over = {}) {
  const raw = {
    key: 'T-1',
    summary: 'Baseline work item',
    projectKey: 'T',
    status: 'In Progress',
    statusCategory: 'indeterminate',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-11-01T00:00:00.000Z',
    asOf: '2026-11-01T00:00:00.000Z',
    inProgressSince: '2026-02-01T00:00:00.000Z',
    lastConfirmAt: '2026-08-12T00:00:00.000Z',
    reopenedCount: 0,
    source: 'fixture',
    edges: {
      decisions: {
        state: 'present',
        items: [
          {
            id: 'page-1',
            title: 'Release scope policy',
            url: 'https://x.atlassian.net/wiki/spaces/T/pages/1',
            updated: '2026-08-10T00:00:00.000Z',
            owner: 'u1',
            contributors: ['u1', 'u2'],
          },
        ],
      },
      goals: { state: 'present', items: [{ id: 'goal-1', title: 'Ship it', status: 'in_progress' }] },
      reviewTraces: {
        state: 'present',
        items: [{ pageId: 'page-1', actorId: 'u2', at: '2026-08-11T00:00:00.000Z' }],
      },
    },
  };
  return normalizeBundle(deepMerge(raw, over));
}

function fixture(name) {
  const file = path.join(__dirname, '..', 'src', 'fixtures', `${name}.json`);
  return normalizeBundle(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/** 决策页构造器：只改你要测的那个字段，其余保持基线。 */
function decision(over = {}) {
  return {
    id: 'page-1',
    title: 'Release scope policy',
    url: 'https://x.atlassian.net/wiki/spaces/T/pages/1',
    updated: '2026-08-10T00:00:00.000Z',
    owner: 'u1',
    contributors: ['u1', 'u2'],
    ...over,
  };
}

function goal(over = {}) {
  return { id: 'goal-1', title: 'Ship it', status: 'in_progress', ...over };
}

module.exports = { base, fixture, deepMerge, decision, goal };
