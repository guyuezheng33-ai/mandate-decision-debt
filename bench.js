'use strict';

/**
 * 规模基准：证明"25 条扫描不会滑成 25 次往返"之外，还有一层——
 * 纯计算本身要够快，否则再少的往返也救不了面板。
 *
 * 跑法：node bench.js
 * 输出一行可直接贴进 README：bench 500 items × 3 lenses in Xms · payload Y KB
 */

const { summarize, aggregate } = require('./src/engine/score');
const { compactProject, enforceBudget } = require('./src/io/compact');
const { getProfile } = require('./src/engine/profiles');
const { normalizeBundle } = require('./src/engine/normalize');

const N = 500;
const LENSES = ['software', 'launch', 'portfolio'];
const BUDGET_MS = 300;

function iso(daysAgo) {
  return new Date(Date.UTC(2026, 10, 20) - daysAgo * 86400000).toISOString();
}

function synthetic(i) {
  const started = 120 + (i % 40);
  const changed = 30 + (i % 25);
  return {
    key: `BENCH-${i}`,
    summary: `Synthetic work item ${i} for the budget check`,
    projectKey: 'BENCH',
    status: i % 5 === 0 ? 'Done' : 'In Progress',
    statusCategory: i % 5 === 0 ? 'done' : 'indeterminate',
    created: iso(started + 10),
    updated: iso(0),
    asOf: iso(0),
    inProgressSince: iso(started),
    lastConfirmAt: i % 3 === 0 ? iso(changed - 5) : null,
    reopenedCount: i % 7 === 0 ? 3 : 0,
    source: 'bench',
    edges: {
      decisions:
        i % 11 === 0
          ? { state: 'absent', items: [] }
          : {
              state: 'present',
              items: [
                {
                  id: `page-${i}`,
                  title: `Mandate ${i}: policy for area ${i % 13}`,
                  url: `https://example.atlassian.net/wiki/spaces/BENCH/pages/${1000 + i}`,
                  updated: iso(changed),
                  owner: `acc-${i % 9}`,
                  contributors: i % 4 === 0 ? [`acc-${i % 9}`] : [`acc-${i % 9}`, `acc-${(i + 1) % 9}`],
                },
                ...(i % 6 === 0
                  ? [
                      {
                        id: `page-${i}-alt`,
                        title: `Mandate ${i}: policy for area ${i % 13}`,
                        url: `https://example.atlassian.net/wiki/spaces/BENCH/pages/${2000 + i}`,
                        updated: iso(changed + 1),
                        owner: `acc-${(i + 2) % 9}`,
                        contributors: [`acc-${(i + 2) % 9}`],
                      },
                    ]
                  : []),
              ],
            },
      goals:
        i % 13 === 0
          ? { state: 'absent', items: [] }
          : { state: 'present', items: [{ id: `goal-${i}`, title: `Goal ${i}`, status: i % 8 === 0 ? 'closed' : 'in_progress', updated: iso(200) }] },
      reviewTraces: i % 5 === 0 ? { state: 'present', items: [{ pageId: `page-${i}`, actorId: 'acc-review', at: iso(20) }] } : { state: 'absent', items: [] },
    },
  };
}

const bundles = Array.from({ length: N }, (_, i) => normalizeBundle(synthetic(i)));

/**
 * 为什么不是"跑一次计时"：
 * 一次读数里混着 JIT 首次编译、GC 时机、以及这台机器当时在跑什么。
 * 同一棵树在 120ms 与 330ms 之间摆，会让"回跑就变红"变成噪音，
 * 真回归反而没人看。这里改成：一次预热（不计时）+ 7 轮计时，取中位数(p50)判预算，
 * 同时把 min/max 印出来——摆动的幅度本身也是信息。
 */
const ROUNDS = 7;

function onePass() {
  const t0 = process.hrtime.bigint();
  let scored = 0;
  let payload = null;
  let rawKb = 0;
  for (const lens of LENSES) {
    const p = getProfile(lens, 'en');
    const agg = aggregate(bundles, p);
    const compact = enforceBudget(compactProject(agg));
    scored += agg.items.length;
    if (!payload) {
      payload = compact;
      rawKb = Math.round(Buffer.byteLength(JSON.stringify(agg)) / 1024);
    }
  }
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, scored, payload, rawKb };
}

const warm = onePass(); // 预热：让 JIT 编译完成，这次结果不参与判定
const rounds = [];
let last = warm;
for (let r = 0; r < ROUNDS; r += 1) {
  last = onePass();
  rounds.push(last.ms);
}
rounds.sort((a, b) => a - b);
const p50 = rounds[Math.floor(rounds.length / 2)];
const min = rounds[0];
const max = rounds[rounds.length - 1];

const payload = last.payload;
const scored = last.scored;
const rawKb = last.rawKb;
const kb = Math.round(Buffer.byteLength(JSON.stringify(payload)) / 1024);

// 面板的典型负载：一条 issue 的 payload 有多大（Rovo 的 1MB 与 200KB 预算都按这个吃）
const { compactIssue, enforceBudget: enforceOne } = require('./src/io/compact');
const singles = [];
for (const lens of LENSES) {
  const p = getProfile(lens, 'en');
  for (const b of bundles.slice(0, 20)) singles.push(Buffer.byteLength(JSON.stringify(enforceOne(compactIssue(summarize(b, p))).payload)));
}
const maxSingleKb = Math.round(Math.max(...singles) / 1024);
const avgSingleKb = Math.round(singles.reduce((a, b) => a + b, 0) / singles.length / 1024);

// 单条面板的 p95：面板慢不慢由图查询决定，计算本身必须可以忽略。
// 这条断言的意思是"如果哪天有人往规则里塞了正则回溯或深拷贝，这里会先炸"。
const ONE_MS_BUDGET = 5;
const samples = [];
for (let r = 0; r < 5; r += 1) {
  for (const b of bundles.slice(0, 40)) {
    const p = getProfile(LENSES[r % LENSES.length], 'en');
    const s = process.hrtime.bigint();
    summarize(b, p);
    samples.push(Number(process.hrtime.bigint() - s) / 1e6);
  }
}
samples.sort((a, b) => a - b);
const p95 = samples[Math.floor(samples.length * 0.95)];

process.stdout.write(
  `bench ${N} items × ${LENSES.length} lenses · ${scored} scores · p50 ${p50.toFixed(1)}ms (min ${min.toFixed(1)} / max ${max.toFixed(1)}, ${ROUNDS} rounds, budget ${BUDGET_MS}ms) · aggregate ${rawKb}KB → project payload ${kb}KB (cap 200KB) · issue payload max ${maxSingleKb}KB avg ${avgSingleKb}KB · single-score p95 ${p95.toFixed(2)}ms\n`,
);

// 判定只认 p50：max 摆动是环境噪声，印出来但不判死。
if (p50 > BUDGET_MS) {
  process.stderr.write(`bench median ${p50.toFixed(1)}ms > budget ${BUDGET_MS}ms（min ${min.toFixed(1)} / max ${max.toFixed(1)}）\n`);
  process.exitCode = 1;
}
if (max > BUDGET_MS * 2) {
  process.stdout.write(`note 某一轮 max ${max.toFixed(1)}ms 超过预算两倍；这台机器当时可能在跑别的东西（p50 才是判定口径）\n`);
}
if (kb > 200) {
  process.stderr.write(`payload exceeded cap: ${kb}KB > 200KB\n`);
  process.exitCode = 1;
}
if (p95 > ONE_MS_BUDGET) {
  process.stderr.write(`single-score p95 ${p95.toFixed(2)}ms > ${ONE_MS_BUDGET}ms\n`);
  process.exitCode = 1;
}
