'use strict';

/**
 * 真实站点审计（不经过 Forge 运行时，用站点 REST + 我们自己的引擎）。
 *
 * 目的：给出一个可复核的样本数与结论，而不是"我们会做试点"的空话。
 * 输入：JIRA_BASE / JIRA_EMAIL / JIRA_TOKEN / PROJECT / LIMIT / OUT
 * 输出：每条 issue 的 verdict、owner、天数，以及汇总计数。
 */

const fs = require('node:fs');
const path = require('node:path');

const { createRestPort } = require('../src/ports/evidence.rest');
const { shapeDecisionIssue, shapeLinks, linkedKeysOf } = require('../src/ports/jira.client');
const { withStamps } = require('../src/ports/confirm');
const { textOfBody } = require('../src/io/adf');
const { summarize, aggregate } = require('../src/engine/score');
const { getProfile } = require('../src/engine/profiles');
const { maxDecided } = require('../src/engine/rules');

const BASE = process.env.JIRA_BASE || 'https://one-atlas-ngpq.atlassian.net';
const EMAIL = process.env.JIRA_EMAIL || 'guyuezheng33@gmail.com';
const TOKEN = process.env.JIRA_TOKEN;
const PROJECT = process.env.PROJECT || 'MOBL';
const LIMIT = Number(process.env.LIMIT || 8);
const OUT = process.env.OUT || path.join('runs', 'real-audit.json');
const PROFILE = process.env.PROFILE || 'software';
const LANG = process.env.LANG_PROFILE || 'zh';

if (!TOKEN) {
  console.error('JIRA_TOKEN is required');
  process.exit(2);
}

const AUTH = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`;

async function jget(p) {
  const res = await fetch(`${BASE}${p}`, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${p}`);
  return res.json();
}

const FIELDS = 'summary,status,created,updated,project,statuscategorychangedate,resolution,issuelinks,assignee,description';

const client = {
  async getIssue(key) {
    const raw = await jget(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${FIELDS}`);
    const f = raw.fields || {};
    return {
      key: raw.key,
      fields: {
        summary: f.summary,
        status: f.status,
        created: f.created,
        updated: f.updated,
        statuscategorychangedate: f.statuscategorychangedate,
        resolution: f.resolution,
        project: f.project,
      },
    };
  },
  async getIssueLinks(key) {
    const [remote, issue] = await Promise.all([
      jget(`/rest/api/3/issue/${encodeURIComponent(key)}/remotelink`).catch(() => []),
      jget(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${FIELDS}`).catch(() => null),
    ]);
    const linked = [];
    for (const k of linkedKeysOf(issue || {})) {
      try {
        linked.push(await jget(`/rest/api/3/issue/${encodeURIComponent(k)}?fields=${FIELDS}`));
      } catch {
        // 单条关联读失败就少一条证据，不让整条收据消失
      }
    }
    return [...linked.map(shapeDecisionIssue).filter(Boolean), ...shapeLinks(remote)];
  },
  async searchIssues(projectKey, limit) {
    const jql = `project = "${projectKey}" ORDER BY created DESC`;
    const q = new URLSearchParams({ jql, maxResults: String(limit), fields: 'summary,status' });
    const raw = await jget(`/rest/api/3/search/jql?${q.toString()}`);
    return (raw.issues || []).map((i) => i.key);
  },
  async getIssueGoals() {
    return [];
  },
  // 复核痕迹回读：只认带 mandate:dd-<8hex> 指纹的评论，时间取服务器 created。
  // 没有这一步，lastConfirmAt 永远是 null，"还款"在审计里就看不见。
  async getComments(key) {
    const raw = await jget(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`);
    return (raw.comments || []).map((c) => ({
      id: c.id,
      body: textOfBody(c.body),
      author: c.author?.accountId,
      created: c.created,
    }));
  },
};

async function main() {
  const port = createRestPort({ client, timeoutMs: 15_000, concurrency: 2 });
  const keys = await client.searchIssues(PROJECT, LIMIT);
  const bundles = [];
  for (const key of keys) {
    // 单条才读评论（withStamps 的纪律）：扫描绝不逐条 N+1。
    bundles.push(await withStamps(await port.getBundle(key), client, { timeoutMs: 15_000 }));
  }
  const profile = getProfile(PROFILE, LANG);
  const summaries = bundles.map((b) => summarize(b, profile));
  const agg = aggregate(bundles, profile);

  const rows = summaries.map((s, i) => {
    const p2 = (s.criteria || []).find((c) => c.p === 'P2') || null;
    const p2flag = (s.flags || []).find((f) => f.primitive === 'P2') || null;
    const b = bundles[i];
    return {
      issueKey: s.issueKey,
      summary: s.summary,
      verdict: s.authority.verdict,
      kind: s.authority.kind,
      owner: s.authority.ownerName,
      approvedAt: s.authority.updatedAt,
      daysOld: s.authority.daysWithoutConfirm,
      record: s.authority.title,
      debt: s.grade === 'unknown' ? null : s.debt,
      grade: s.grade,
      // P2 逐条可核查：state 是 hit/clear/unknown；decidedAt 必须来自真实记录的
      // 服务器编辑时间（editedAt），不是描述里手写的 approved 日期，更不是常量。
      p2: {
        state: p2 ? p2.state : null,
        why: p2 ? p2.why : null,
        decidedAt: (() => {
          const t = maxDecided(b.edges?.decisions?.items || []);
          return t != null ? new Date(t).toISOString() : null;
        })(),
        hitEvidenceDecidedAt: p2flag?.evidence?.decidedAt ?? null,
        lastConfirmAt: b.lastConfirmAt ?? null,
        confirmSource: b.confirmSource ?? null,
        records: (b.edges?.decisions?.items || []).map((d) => ({
          id: d.id,
          updated: d.updated ?? null,
          editedAt: d.editedAt ?? null,
        })),
      },
    };
  });
  const counts = rows.reduce((m, r) => {
    m[r.verdict] = (m[r.verdict] || 0) + 1;
    return m;
  }, {});

  const result = {
    generatedAt: new Date().toISOString(),
    site: BASE,
    project: PROJECT,
    sample: { requested: LIMIT, fetched: rows.length },
    counts,
    aggregate: agg,
    rows,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ sample: result.sample, counts, avg: agg.avg, grade: agg.grade, out: OUT }, null, 2));

  // 可判定验收（程序拒绝，不靠人眼）：
  //   P2_ASSERT=judged → 至少 1 条 P2 已判（hit/clear），且 decidedAt 必须等于
  //                      某条真实记录的服务器 editedAt（常量/手写日期会被拒绝）。
  //   P2_ASSERT=hit    → 在 judged 之上，还要求至少 1 条 hit。
  const mode = process.env.P2_ASSERT;
  if (mode === 'judged' || mode === 'hit') {
    const isoOf = (v) => (v ? new Date(v).toISOString() : null);
    const judged = rows.filter((r) => {
      if (!r.p2 || (r.p2.state !== 'hit' && r.p2.state !== 'clear')) return false;
      if (!r.p2.decidedAt) return false;
      return r.p2.records.some((rec) => rec.editedAt && isoOf(rec.editedAt) === r.p2.decidedAt);
    });
    if (!judged.length) {
      console.error('P2_ASSERT failed: no judged P2 whose decidedAt equals a real record editedAt');
      process.exit(1);
    }
    if (mode === 'hit') {
      const hits = judged.filter((r) => r.p2.state === 'hit');
      if (!hits.length) {
        console.error('P2_ASSERT failed: no P2 hit (drift must be >= threshold days old and unconfirmed)');
        process.exit(1);
      }
      if (hits.some((r) => r.p2.hitEvidenceDecidedAt !== r.p2.decidedAt)) {
        console.error('P2_ASSERT failed: hit evidence decidedAt disagrees with record editedAt');
        process.exit(1);
      }
    }
    console.log(`P2_ASSERT ${mode}: PASS (${judged.length} judged, ${judged.filter((r) => r.p2.state === 'hit').length} hit)`);
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
