'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { base, decision, goal } = require('./helpers');
const { evaluate, clusterDecisions, topicTokens, jaccard, daysBetween } = require('../src/engine/rules');
const { getProfile } = require('../src/engine/profiles');

const soft = getProfile('software');
const launch = getProfile('launch');
const portfolio = getProfile('portfolio');

function ids(bundle, profile = soft) {
  return evaluate(bundle, profile).flags.map((f) => f.primitive).sort();
}

test('基线：一条规则都不许命中（否则整套判据都在误报）', () => {
  assert.deepEqual(ids(base()), []);
});

test('P1 命中：决策与目标都明确为空', () => {
  const b = base({
    edges: { decisions: { state: 'absent', items: [] }, goals: { state: 'absent', items: [] } },
  });
  assert.deepEqual(ids(b), ['P1']);
});

test('P1 不命中：只有目标、没有决策页，属于"有授权但没记依据"', () => {
  const b = base({ edges: { decisions: { state: 'absent', items: [] } } });
  assert.deepEqual(ids(b), []);
});

test('P2 命中：依据在执行开始后改过，且此后无确认', () => {
  const b = base({ lastConfirmAt: null, edges: { decisions: { items: [decision()] } } });
  assert.deepEqual(ids(b), ['P2']);
});

test('P2 不命中：变更之后有人确认过', () => {
  const b = base({ lastConfirmAt: '2026-09-01T00:00:00.000Z' });
  assert.deepEqual(ids(b), []);
});

test('P2 不命中：依据早于执行开始（那是"没跟上"，不是"变更未传导"）', () => {
  const b = base({
    lastConfirmAt: null,
    edges: { decisions: { items: [decision({ updated: '2026-01-15T00:00:00.000Z' })] } },
  });
  assert.deepEqual(ids(b), []);
});

test('P2 不命中：间隔不到阈值（12 天 < 14 天）', () => {
  const b = base({
    lastConfirmAt: null,
    edges: { decisions: { items: [decision({ updated: '2026-10-20T00:00:00.000Z' })] } },
  });
  assert.deepEqual(ids(b), []);
});

test('P3 命中：同主题两份依据、负责人不同', () => {
  const b = base({
    edges: {
      decisions: {
        items: [
          decision({ id: 'p1', title: 'Release scope policy', owner: 'u1' }),
          decision({ id: 'p2', title: 'Release scope policy v2', owner: 'u3', contributors: ['u3', 'u4'] }),
        ],
      },
      reviewTraces: { items: [{ pageId: 'p1', actorId: 'u2' }, { pageId: 'p2', actorId: 'u4' }] },
    },
  });
  assert.deepEqual(ids(b), ['P3']);
});

test('P3 不命中：两份依据讲的不是一件事（标题不同主题），哪怕负责人不同', () => {
  // 这是数据包替我们抓到的坑：早前页面标题一律取 issue 的 summary，
  // 同一条工作项下两份不同主题的页面就变成"标题完全相同"，P3 永远命中。
  // 现在标题取自 URL slug，所以这条必须不命中。
  const b = base({
    edges: {
      decisions: {
        items: [
          decision({ id: 'p1', title: 'pricing experiment guardrails', owner: 'u1' }),
          decision({ id: 'p2', title: 'refund retry policy', owner: 'u3' }),
        ],
      },
    },
  });
  assert.deepEqual(ids(b), []);
});

test('P3 命中：同一主题的改版会归一（-v2 / -round-2 / 年份后缀）', () => {
  const b = base({
    edges: {
      decisions: {
        items: [
          decision({ id: 'p1', title: 'psd2 sca fallback', owner: 'u1' }),
          decision({ id: 'p2', title: 'psd2 sca fallback v2', owner: 'u3' }),
        ],
      },
    },
  });
  assert.deepEqual(ids(b), ['P3']);
});


test('P3 不命中：同主题但同一位负责人（只是改版）', () => {
  const b = base({
    edges: {
      decisions: {
        items: [
          decision({ id: 'p1', title: 'Release scope policy' }),
          decision({ id: 'p2', title: 'Release scope policy v2' }),
        ],
      },
      reviewTraces: { items: [{ pageId: 'p1', actorId: 'u2' }, { pageId: 'p2', actorId: 'u2' }] },
    },
  });
  assert.deepEqual(ids(b), []);
});

test('P4 命中：目标已结束，工作项仍在跑', () => {
  const b = base({ edges: { goals: { items: [goal({ status: 'completed' })] } } });
  assert.deepEqual(ids(b), ['P4']);
});

test('P4 不命中：工作项自己也已完成', () => {
  const b = base({
    status: 'Done',
    statusCategory: 'done',
    edges: { goals: { items: [goal({ status: 'completed' })] } },
  });
  assert.deepEqual(ids(b), []);
});

test('P4 只有组合治理会因"目标长期未更新"命中（软件交付不会）', () => {
  const b = base({ edges: { goals: { items: [goal({ updated: '2026-04-01T00:00:00.000Z' })] } } });
  assert.deepEqual(ids(b, soft), []);
  assert.deepEqual(ids(b, portfolio), ['P4']);
});

test('P5 命中：重开 3 次，且最后一次重开之后没有新依据', () => {
  const b = base({
    reopenedCount: 3,
    lastReopenedAt: '2026-10-20T00:00:00.000Z',
    edges: { decisions: { items: [decision()] } },
  });
  assert.deepEqual(ids(b), ['P5']);
});

test('P5 不命中：重开之后补过依据', () => {
  const b = base({
    reopenedCount: 3,
    lastReopenedAt: '2026-05-01T00:00:00.000Z',
    edges: { decisions: { items: [decision()] } },
  });
  assert.deepEqual(ids(b), []);
});

test('P6 命中：单人维护且没有任何第二人复核痕迹', () => {
  const b = base({
    edges: {
      decisions: { items: [decision({ contributors: ['u1'] })] },
      reviewTraces: { state: 'absent', items: [] },
    },
  });
  assert.deepEqual(ids(b), ['P6']);
});

test('P6 不命中：有第二人留下复核痕迹', () => {
  const b = base({ edges: { decisions: { items: [decision({ contributors: ['u1'] })] } } });
  assert.deepEqual(ids(b), []);
});

test('P6 被抑制：复核痕迹不可知时，不允许报"无人复核"', () => {
  const b = base({
    edges: {
      decisions: { items: [decision({ contributors: ['u1'] })] },
      reviewTraces: { state: 'unknown', items: [], reason: 'E_SCOPE' },
    },
  });
  const r = evaluate(b, soft);
  assert.deepEqual(r.flags.map((f) => f.primitive), []);
  assert.ok(r.skipped.some((s) => s.primitive === 'P6'));
});

test('权重来自口径：P3 在发布口径下更重（22 vs 15）', () => {
  const b = base({
    edges: {
      decisions: {
        items: [
          decision({ id: 'p1', title: 'Launch messaging', owner: 'u1' }),
          decision({ id: 'p2', title: 'Launch messaging v2', owner: 'u5', contributors: ['u5', 'u6'] }),
        ],
      },
      reviewTraces: { items: [{ pageId: 'p1', actorId: 'u2' }, { pageId: 'p2', actorId: 'u6' }] },
    },
  });
  const s = evaluate(b, soft).flags.find((f) => f.primitive === 'P3');
  const l = evaluate(b, launch).flags.find((f) => f.primitive === 'P3');
  assert.equal(s.weight, 15);
  assert.equal(l.weight, 22);
});

test('flags 按权重降序排列', () => {
  const b = base({
    lastConfirmAt: null,
    edges: {
      decisions: {
        items: [
          decision({ id: 'p1', title: 'Policy', contributors: ['u1'] }),
          decision({ id: 'p2', title: 'Policy v2', owner: 'u9', contributors: ['u9'] }),
        ],
      },
      reviewTraces: { state: 'absent', items: [] },
      goals: { items: [goal({ status: 'completed' })] },
    },
  });
  const weights = evaluate(b, soft).flags.map((f) => f.weight);
  assert.ok(weights.length >= 3);
  assert.deepEqual(weights, [...weights].sort((a, b2) => b2 - a));
});

test('分词与聚簇：同一份政策的两个版本能聚到一簇，不同主题不会', () => {
  const a = topicTokens('Portal lifecycle policy — close after 60 days idle');
  const b = topicTokens('Portal lifecycle policy — close after 180 days idle');
  assert.ok(jaccard(a, b) >= 0.8, `similarity=${jaccard(a, b)}`);
  assert.equal(clusterDecisions([{ title: 'Portal lifecycle policy A' }, { title: 'Billing export rewrite' }], 0.5).length, 2);
});

test('daysBetween 对顺序、字符串与空值都稳健', () => {
  assert.equal(daysBetween('2026-11-01T00:00:00Z', '2026-08-10T00:00:00Z'), 83);
  assert.equal(daysBetween(null, '2026-08-10T00:00:00Z'), null);
});

// ---- 字段充分性：边在，但判据要的字段没回来 ----

function criterion(bundle, p, profile = soft) {
  return evaluate(bundle, profile).criteria.find((c) => c.p === p);
}

test('P2 不能因为"页面没有更新时间"就判 clear', () => {
  // REST 拿关联页时不返回页面更新时间；TWG 也只有在 Cypher 里点了 updated 才有。
  // 判 clear 等于说"变更没有晚于执行"，而我们根本不知道它什么时候改过。
  const b = base({ lastConfirmAt: null, edges: { decisions: { items: [decision({ updated: null })] } } });
  const c = criterion(b, 'P2');
  assert.equal(c.state, 'unknown');
  assert.equal(c.why, 'decisions-no-updated');
});

test('P6 不能因为"复核痕迹没带页面/作者"就判单人', () => {
  const b = base({
    edges: {
      decisions: { items: [decision({ contributors: undefined })] },
      reviewTraces: { items: [{ pageId: null, actorId: null }] },
    },
  });
  const c = criterion(b, 'P6');
  assert.equal(c.state, 'unknown');
  assert.ok(c.why.includes('decisions-no-contributors'));
  assert.ok(c.why.includes('reviewtraces-unkeyed'));
});

test('P4 不能因为"目标只回来一个标题"就当作还在跑', () => {
  const b = base({ edges: { goals: { items: [goal({ status: null, updated: null })] } } });
  const c = criterion(b, 'P4');
  assert.equal(c.state, 'unknown');
  assert.equal(c.why, 'goals-no-state');
});

test('P5 不能因为"数据源没有重开次数"就判没翻案', () => {
  // REST 的 issue 从不返回重开次数；缺省 0 会让 P5 永远沉默 —— 沉默被读成"没问题"。
  const b = base({ reopenedCount: undefined });
  assert.equal(b.reopenedKnown, false);
  const c = criterion(b, 'P5');
  assert.equal(c.state, 'unknown');
  assert.equal(c.why, 'issue-no-reopen-count');

  // 但如果确实给了日期，就算没有计数也判得了。
  const withDate = base({ reopenedCount: undefined, lastReopenedAt: '2026-10-01T00:00:00Z' });
  assert.equal(withDate.reopenedKnown, false);
  assert.notEqual(criterion(withDate, 'P5').state, 'unknown');
});
