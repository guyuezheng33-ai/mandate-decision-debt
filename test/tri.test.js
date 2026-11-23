'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { base } = require('./helpers');
const { normalizeBundle, STATES } = require('../src/engine/normalize');
const { edgeKnowledge, coverageOf, missingFor, entirelyUnknown, EDGE_NAMES } = require('../src/engine/tri');
const { evaluate } = require('../src/engine/rules');
const { getProfile } = require('../src/engine/profiles');

const soft = getProfile('software');

test('三条边都可知时，覆盖率是 3/3', () => {
  const c = coverageOf(base());
  assert.deepEqual(c, { known: 3, total: 3, ratio: 1 });
});

test('一条边不可知时，覆盖率下降但不影响其它规则', () => {
  const b = base({ edges: { reviewTraces: { state: 'unknown', items: [], reason: 'E_TIMEOUT' } } });
  const c = coverageOf(b);
  assert.equal(c.known, 2);
  assert.equal(c.ratio.toFixed(2), '0.67');
  assert.deepEqual(missingFor(b, ['decisions', 'reviewTraces']), ['reviewTraces']);
});

test('全部不可知时，整条工作项判为不可知', () => {
  const b = normalizeBundle({
    key: 'X-1',
    edges: {
      decisions: { state: STATES.UNKNOWN, items: [], reason: 'E_SCOPE' },
      goals: { state: STATES.UNKNOWN, items: [], reason: 'E_SCOPE' },
      reviewTraces: { state: STATES.UNKNOWN, items: [], reason: 'E_SCOPE' },
    },
  });
  assert.ok(entirelyUnknown(b));
  assert.equal(coverageOf(b).known, 0);
});

test('缺一条边（undefined）不得被当成"没有依据"', () => {
  const b = base({ edges: { decisions: undefined } });
  const r = evaluate(b, soft);
  assert.equal(edgeKnowledge(b, 'decisions').known, false);
  assert.equal(r.flags.some((f) => f.primitive === 'P1'), false);
  assert.ok(r.skipped.some((s) => s.reason.includes('decisions')));
});

test('声明 present 却没有条目，是数据源自相矛盾，降级为 unknown', () => {
  const raw = { key: 'X-2', edges: { decisions: { state: 'present', items: [] }, goals: { state: 'absent', items: [] } } };
  const b = normalizeBundle(raw);
  assert.equal(b.edges.decisions.state, STATES.UNKNOWN);
  const r = evaluate(b, soft);
  assert.equal(r.flags.length, 0, '不该因此报 P1');
});

test('全部不可知时，六条规则全部被抑制而不是全部命中', () => {
  const b = normalizeBundle({
    key: 'X-3',
    edges: {
      decisions: { state: STATES.UNKNOWN, items: [], reason: 'E_SCOPE' },
      goals: { state: STATES.UNKNOWN, items: [], reason: 'E_SCOPE' },
      reviewTraces: { state: STATES.UNKNOWN, items: [], reason: 'E_SCOPE' },
    },
  });
  const r = evaluate(b, soft);
  assert.equal(r.flags.length, 0);
  assert.equal(r.skipped.length, 6);
  assert.deepEqual(missingFor(b, EDGE_NAMES).sort(), ['decisions', 'goals', 'reviewTraces']);
});
