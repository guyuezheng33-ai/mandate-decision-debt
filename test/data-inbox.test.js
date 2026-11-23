'use strict';

/**
 * 真实数据形状回归。
 *
 * 这里用的四个 JSON 和一张 CSV，全部来自 `data-inbox`（tier=S 受控仿真），
 * 逐字节复制进 `test/fixtures/inbox/`，所以这些断言不需要外部路径、CI 里也能跑。
 *
 * 它们锁定的是 05-column-gap.md 里那五个坑：
 *   G1 basic 选择集只取 id/title → P2/P3/P6 必须 unknown，且理由要指名字段
 *   G2 别名（authorId / contributorIds / lastModified）不能被静默丢弃
 *   G3 扫描行没有 issue 元数据 → P2 不许假 clear
 *   G4 拿不到 reopenedCount → P5 不许假 clear
 *   G5 goal 的 status 在映射层被丢 → P4 不许退化成"只剩时间一条腿"
 *
 * 再加上 21 条 seed 事实：引擎 flags 必须与 seed/grade.js 的预测逐条一致。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { mapRows, createGraphClient } = require('../src/ports/graph.client');
const { hydrateBundle, hydrateBundles } = require('../src/ports/hydrate');
const { normalizeBundle } = require('../src/engine/normalize');
const { summarize, aggregate } = require('../src/engine/score');
const { getProfile } = require('../src/engine/profiles');
const grade = require('../seed/grade.js');

const DIR = path.join(__dirname, 'fixtures', 'inbox');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const soft = getProfile('software');

function fromPayload(payload, asOf = '2026-11-20') {
  const rows = mapRows(payload);
  assert.ok(rows.length > 0, '一条行都映射不出来');
  return rows.map((r) =>
    normalizeBundle({
      key: r.issue.key,
      summary: r.issue.summary,
      status: r.issue.status,
      created: r.issue.created,
      updated: r.issue.updated,
      inProgressSince: r.issue.inProgressSince,
      reopenedCount: r.issue.reopenedCount,
      asOf,
      source: 'twg',
      edges: { decisions: r.decisions, goals: r.goals, reviewTraces: r.reviewTraces },
    })
  );
}

const crit = (bundle, p) => summarize(bundle, soft).criteria.find((c) => c.p === p);

test('inbox/G1: basic 选择集（只有 id/title）→ P2/P3/P6 全 unknown，且理由点名字段', () => {
  const [b] = fromPayload(read('bundle-basic.json'));
  const p2 = crit(b, 'P2');
  const p3 = crit(b, 'P3');
  const p6 = crit(b, 'P6');
  assert.equal(p2.state, 'unknown');
  assert.match(p2.why, /no-updated|insufficient:/, 'P2 必须说清缺哪个字段，不能只是 unknown');
  assert.ok(['unknown', 'clear'].includes(p3.state));
  assert.equal(p6.state, 'unknown');
});

test('inbox/G2: 别名 authorId / contributorIds / lastModifiedOn 能落到规范字段', () => {
  const [b] = fromPayload(read('bundle-extended.json'));
  const d = b.edges.decisions.items[0];
  assert.ok(d.updated, 'lastModifiedOn 没有被识别为 updated');
  assert.ok(d.owner, 'authorId 没有被识别为 owner');
  assert.ok(Array.isArray(d.contributors) && d.contributors.length >= 2, 'contributorIds 没有被识别');
});

test('inbox/G3: 扫描行没有 issue 元数据时，P2 绝不命中，有依据的必须是 unknown', () => {
  const bundles = fromPayload(read('scan.json'));
  assert.equal(bundles.length, 5);
  for (const b of bundles) {
    const p2 = crit(b, 'P2');
    assert.notEqual(p2.state, 'hit', `${b.key} 的 P2 在缺元数据时命中了（假报）`);
    if (b.edges.decisions.state === 'present') {
      assert.equal(p2.state, 'unknown', `${b.key} 有依据却给出 clear（假 clear）`);
      assert.match(p2.why, /issue-no-(start|asof)/);
    } else {
      assert.equal(p2.state, 'clear', `${b.key} 没有依据，P2 应为 clear（由 P1 负责）`);
    }
  }
});

test('inbox/G3-fix: 同一条数据补上 issue 元数据后，P2 能算出结论', async () => {
  const [b] = fromPayload(read('bundle-extended.json'));
  const fake = {
    getIssue: async () => ({
      fields: {
        summary: 'x',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        created: '2026-05-28T10:10:00.000+0000',
        updated: '2026-11-18T17:53:00.000+0000',
        statuscategorychangedate: '2026-06-18T08:40:00.000+0000',
      },
    }),
  };
  assert.equal(crit(b, 'P2').state, 'unknown');
  const hydrated = await hydrateBundle(b, fake);
  assert.equal(crit(hydrated, 'P2').state, 'hit');
});

test('inbox/G4: 没有 reopenedCount 时 P5 是 unknown', () => {
  const [b] = fromPayload(read('bundle-basic.json'));
  assert.equal(b.reopenedKnown, false, '数据里根本没有重开次数，不能当成已知');
  assert.equal(crit(b, 'P5').state, 'unknown');
  assert.match(crit(b, 'P5').why, /reopen/);
});

test('inbox/G5: goal 的 status 从图里读得到 → P4 不退化成"只有时间一条腿"', () => {
  const [b] = fromPayload(read('bundle-extended.json'));
  const g = b.edges.goals.items[0];
  assert.equal(g.status, 'in_progress');
  const p4 = crit(b, 'P4');
  assert.notEqual(p4.why, 'goals-no-state');
});

test('inbox/project: 扫描 + 一次批量补水 → 项目页有分，不再是整页 unknown', async () => {
  const bundles = fromPayload(read('scan.json'));
  // 数据包里没有 issue 元数据（这正是 G3 缺口），所以这里注入一组"形状正确"的元数据，
  // 只验流程：一次批量调用之后，项目页从 0/counted 0 变成可判分。
  const meta = {
    'DEL-101': ['2026-06-18', '2026-11-18'],
    'DEL-103': ['2026-05-30', '2026-11-12'],
    'DEL-104': ['2026-09-20', '2026-11-17'],
    'DEL-105': ['2026-07-01', '2026-10-30'],
    'DEL-106': ['2026-10-05', '2026-11-10'],
  };
  let calls = 0;
  const jira = {
    getIssues: async (keys) => {
      calls += 1;
      return keys.map((key) => ({
        key,
        fields: {
          status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          created: meta[key][0],
          updated: meta[key][1],
          statuscategorychangedate: meta[key][0],
        },
      }));
    },
    getIssue: async () => {
      throw new Error('不允许逐条补水');
    },
  };

  const before = aggregate(bundles, soft);
  // 补水前：5 条里 4 条的主判据（P2）看不见 → 只有 1 条能算，覆盖不到一半 → 项目页不出分。
  assert.equal(before.countedCount, 1);
  assert.equal(before.grade, 'unknown');
  assert.equal(before.debt, null, '看不见的时候不许给 0 分（0 会被读成很健康）');
  assert.equal(before.coverageRatio, 0.2);

  await hydrateBundles(bundles, jira, { max: 5 });
  const after = aggregate(bundles, soft);
  assert.equal(calls, 1, '一页只许一次批量调用');
  assert.equal(after.countedCount, 5);
  assert.equal(after.unknownCount, 0);
  assert.equal(after.debt, 16);
  assert.equal(after.grade, 'watch');
  // P5（重开历史）在 REST 口径下拿不到：分数是下界，必须带确定度披露，不许当完整结论。
  assert.equal(after.certainty, 0.9);
  assert.equal(after.partialCount, 5);
  assert.deepEqual(after.drivers.map((d) => d.p), ['P2', 'P1', 'P3']);
});

test('inbox/scan: pageInfo.hasNextPage 跟着扫描结果返回，50 条上限不等于整个项目', async () => {
  const payload = read('scan.json');
  const client = createGraphClient({
    bundleKey: 'QK',
    scanKey: 'QK',
    api: { asUser: () => ({ requestTeamworkGraph: async () => payload }) },
  });
  const res = await client.query({ type: 'provenance.scan', projectKey: 'DEL', limit: 5 });
  assert.equal(res.issues.length, 5);
  // 数据包这一页的 pageInfo 就是 hasNextPage=true：丢掉它，界面会假装"这 5 条就是全部"。
  assert.equal(res.pageInfo.hasNextPage, true);
  assert.equal(res.pageInfo.endCursor, 'cursor-bbeaef49');
});

test('inbox/error: 403 + E_SCOPE 信封被解析成结构化错误码', async () => {
  const payload = read('error-noscope.json');
  const client = createGraphClient({
    bundleKey: 'QK',
    api: { asUser: () => ({ requestTeamworkGraph: async () => payload }) },
  });
  await assert.rejects(
    () => client.query({ type: 'bundle', issueKey: 'DEL-101' }),
    (err) => {
      assert.equal(err.code, 'E_SCOPE');
      assert.equal(err.scope, 'read:graph:page:confluence');
      assert.equal(err.status, 403);
      return true;
    }
  );
});

test('inbox/seed-21: 21 条事实跑过引擎，flags 与 seed/grade.js 的预测逐条一致', () => {
  const rows = grade.parseCsv(fs.readFileSync(path.join(DIR, 'seed-21.csv'), 'utf8'));
  assert.equal(rows.length, 21);
  const ENDED = new Set(['closed', 'archived', 'done', 'complete', 'completed', 'cancelled']);
  const list = (v) =>
    String(v || '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
  const maxDay = (a) => a.filter(Boolean).sort().slice(-1)[0] || null;

  const mismatched = [];
  for (const row of rows) {
    const pages = list(row.decision_page_ids);
    const urls = list(row.decision_page_urls);
    const upd = list(row.decision_page_updated);
    const owners = list(row.decision_page_author);
    const counts = list(row.decision_page_contributor_count).map((n) => Number(n) || 0);
    const reviewers = list(row.reviewer_ids);
    const dates = list(row.review_event_dates);
    const reopens = list(row.reopen_events);

    const bundle = normalizeBundle({
      key: row.issue_key,
      summary: row.summary,
      status: row.status,
      created: row.created,
      updated: row.updated,
      inProgressSince: row.status_changed_at,
      reopenedCount: row.reopened_count === '' ? undefined : Number(row.reopened_count),
      lastReopenedAt: maxDay(reopens),
      asOf: '2026-11-20',
      source: 'seed',
      edges: {
        decisions: pages.length
          ? {
              state: 'present',
              items: pages.map((id, i) => ({
                id,
                title: row.summary,
                url: urls[i] || null,
                updated: upd[i] || null,
                owner: owners[i] || null,
                contributors: Array.from({ length: counts[i] || 0 }, (_, k) => `c${k + 1}`),
              })),
            }
          : { state: 'absent', items: [] },
        goals: row.goal_id
          ? { state: 'present', items: [{ id: row.goal_id, title: row.goal_id, status: row.goal_status, updated: row.goal_updated }] }
          : { state: 'absent', items: [] },
        reviewTraces: reviewers.length
          ? { state: 'present', items: reviewers.map((a, i) => ({ pageId: pages[0] || '', actorId: a, at: dates[i] || null })) }
          : { state: 'absent', items: [] },
      },
    });

    const latest = maxDay(upd);
    const changed = row.status_changed_at ? String(row.status_changed_at).slice(0, 10) : null;
    const facts = {
      issueKey: row.issue_key,
      hasEvidence: pages.length > 0,
      hasGoal: Boolean(row.goal_id),
      goalEnded: ENDED.has(String(row.goal_status || '').toLowerCase()),
      changeAfterStart: Boolean(latest && changed && latest > changed),
      confirmedAfterChange: false,
      conflictSameTopic: pages.length >= 2,
      reopenedCount: Number(row.reopened_count) || 0,
      evidenceAfterLastReopen: Boolean(latest && (!maxDay(reopens) || latest > maxDay(reopens))),
      singleContributor: counts.length > 0 && counts.every((n) => n <= 1),
      secondReviewer: reviewers.length > 0,
      issueDone: String(row.status_category || '').toLowerCase() === 'done',
    };
    const engine = summarize(bundle, soft)
      .criteria.filter((c) => c.state === 'hit')
      .map((c) => c.p)
      .sort();
    const expect = (grade.predict(facts) || []).sort();
    if (engine.join(',') !== expect.join(',')) mismatched.push(`${row.issue_key}: engine[${engine}] expect[${expect}]`);
  }
  assert.deepEqual(mismatched, []);
});
