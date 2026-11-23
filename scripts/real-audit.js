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
const { summarize, aggregate } = require('../src/engine/score');
const { getProfile } = require('../src/engine/profiles');

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
};

async function main() {
  const port = createRestPort({ client, timeoutMs: 15_000, concurrency: 2 });
  const keys = await client.searchIssues(PROJECT, LIMIT);
  const bundles = [];
  for (const key of keys) {
    bundles.push(await port.getBundle(key));
  }
  const profile = getProfile(PROFILE, LANG);
  const summaries = bundles.map((b) => summarize(b, profile));
  const agg = aggregate(bundles, profile);

  const rows = summaries.map((s) => ({
    issueKey: s.issueKey,
    summary: s.summary,
    verdict: s.authority.verdict,
    kind: s.authority.kind,
    owner: s.authority.ownerName,
    approvedAt: s.authority.updatedAt,
    daysOld: s.authority.daysWithoutConfirm,
    record: s.authority.title,
    debt: s.debt,
    grade: s.grade,
        }));
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
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
