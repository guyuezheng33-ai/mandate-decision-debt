'use strict';

/**
 * D7 · 四端一致性矩阵。
 *
 * 同一个 issue，四条真实入口各跑一次：
 *   panel  — Forge resolver 定义（UI Kit 面板调的形状）
 *   agent  — Rovo action handler（payload 来自模型抽取 + 平台 context）
 *   mcp    — resolve() 纯函数入口（functionKey 分派，MCP/agent 运行时走这条）
 *   audit  — REST 端口 + summarize（real-audit 的同一条计算）
 *
 * 逐字段比 debt / grade / criteria(p,state) / coverage；任一不等 → 退出码 1。
 * fixture 模式离线可复跑；live 模式（JIRA_TOKEN）对真实站点出矩阵。
 *
 *   node tools/surface-matrix.js                 # fixture，KAN-3
 *   ISSUE=MOBL-57 MODE=live node tools/surface-matrix.js   # 真实站点
 */

const fs = require('node:fs');
const path = require('node:path');
const { createFixturePort } = require('../src/ports/evidence.fixture');
const { createRestPort } = require('../src/ports/evidence.rest');
const { shapeDecisionIssue, shapeLinks, linkedKeysOf } = require('../src/ports/jira.client');
const { textOfBody } = require('../src/io/adf');
const handlers = require('../src/agent/handlers');
const { resolve, handler } = require('../src/index');
const { summarize } = require('../src/engine/score');
const { getProfile } = require('../src/engine/profiles');

const ROOT = path.resolve(__dirname, '..');

function projection(r) {
  // 发布口径：grade unknown = NO SCORE → debt 发 null（与 compactIssue / compactProject 同规则）。
  // audit 端拿的是 summarize 原始输出（内部下界），这里按同一发布规则投影后再比。
  const grade = r.grade ?? null;
  return {
    debt: grade === 'unknown' ? null : (r.debt ?? null),
    grade,
    criteria: (r.criteria || []).map((c) => ({ p: c.p, state: c.state })),
    coverage: r.coverage ?? null,
  };
}

/** live 模式的最小 REST client：与 real-audit 同一组字段、同一套 Basic auth。 */
function liveClient() {
  const BASE = process.env.JIRA_BASE || 'https://one-atlas-ngpq.atlassian.net';
  const EMAIL = process.env.JIRA_EMAIL || 'guyuezheng33@gmail.com';
  const TOKEN = process.env.JIRA_TOKEN;
  if (!TOKEN) throw new Error('JIRA_TOKEN is required for MODE=live');
  const AUTH = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`;
  const FIELDS = 'summary,status,created,updated,project,statuscategorychangedate,resolution,issuelinks,assignee,description';
  async function jget(p) {
    const res = await fetch(`${BASE}${p}`, { headers: { Authorization: AUTH, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status} ${p}`);
    return res.json();
  }
  const shape = (raw) => ({
    key: raw.key,
    fields: {
      summary: raw.fields?.summary,
      status: raw.fields?.status,
      created: raw.fields?.created,
      updated: raw.fields?.updated,
      statuscategorychangedate: raw.fields?.statuscategorychangedate,
      resolution: raw.fields?.resolution,
      project: raw.fields?.project,
      assignee: raw.fields?.assignee,
      description: raw.fields?.description,
      issuelinks: raw.fields?.issuelinks,
    },
  });
  return {
    getIssue: async (key) => shape(await jget(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${FIELDS}`)),
    getIssues: async (keys) => Promise.all(keys.map(async (k) => shape(await jget(`/rest/api/3/issue/${encodeURIComponent(k)}?fields=${FIELDS}`)))),
    getIssueLinks: async (key) => {
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
    getComments: async (key) => {
      const out = await jget(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`).catch(() => ({ comments: [] }));
      return (out.comments || []).map((c) => ({ id: c.id, body: textOfBody(c.body), author: c.author?.accountId, created: c.created }));
    },
  };
}

function diffProjections(proj) {
  const diffs = [];
  const base = JSON.stringify(proj.panel);
  for (const [name, p] of Object.entries(proj)) {
    if (JSON.stringify(p) !== base) diffs.push(name);
  }
  return diffs;
}

async function runMatrix({ issueKey, profileKey = 'software', mode } = {}) {
  const key = issueKey || process.env.ISSUE || 'KAN-3';
  const m = mode || process.env.MODE || (process.env.JIRA_TOKEN ? 'live' : 'fixture');
  const profile = getProfile(profileKey, 'en');

  let port;
  let ctx;
  if (m === 'live') {
    const client = liveClient();
    port = createRestPort({ scopes: ['read:jira-work'], client });
    ctx = { accountId: 'surface-matrix', scopes: ['read:jira-work'], jira: client };
  } else {
    port = createFixturePort({ dir: path.join(ROOT, 'src', 'fixtures') });
    ctx = { accountId: 'surface-matrix', scopes: ['read:jira-work'], evidencePort: port };
  }

  const payload = { issueKey: key, profile: profileKey, lang: 'en' };
  const panel = await handler({ call: { functionKey: 'getIssueProvenance', payload }, context: ctx });
  const agent = await handlers.getIssueProvenance(payload, ctx);
  const mcp = await resolve({ payload: { functionKey: 'getIssueProvenance', ...payload }, context: ctx });
  const audit = summarize(await port.getBundle(key), profile);

  const surfaces = { panel, agent, mcp, audit };
  const proj = {};
  const errors = {};
  for (const [name, r] of Object.entries(surfaces)) {
    if (!r || r.ok === false) errors[name] = r && r.code ? r.code : 'no payload';
    proj[name] = projection(r || {});
  }
  const diffs = diffProjections(proj);
  const ok = diffs.length === 0 && Object.keys(errors).length === 0;
  return { mode: m, issueKey: key, profileKey, proj, diffs, errors, ok };
}

function render(result) {
  const { mode, issueKey, profileKey, proj, diffs, errors, ok } = result;
  const names = Object.keys(proj);
  const lines = [
    '# Surface matrix · 四端一致性（D7）',
    '',
    `Generated: ${new Date().toISOString()} · mode: **${mode}** · issue: **${issueKey}** · profile: ${profileKey}`,
    '',
    '同一 issue 经 panel / agent / mcp / audit 四条入口，逐字段比 debt / grade / criteria / coverage。',
    '任一字段不等即 FAIL（`node tools/surface-matrix.js` 退出码 1）。',
    '',
    '| field | ' + names.join(' | ') + ' |',
    '|---|' + names.map(() => '---').join('|') + '|',
    '| debt | ' + names.map((n) => String(proj[n].debt)).join(' | ') + ' |',
    '| grade | ' + names.map((n) => String(proj[n].grade)).join(' | ') + ' |',
    '| coverage.known/total | ' + names.map((n) => (proj[n].coverage ? `${proj[n].coverage.known}/${proj[n].coverage.total}` : '–')).join(' | ') + ' |',
  ];
  const prims = (proj.panel.criteria || []).map((c) => c.p);
  for (const p of prims) {
    lines.push(`| ${p} | ` + names.map((n) => {
      const c = (proj[n].criteria || []).find((x) => x.p === p);
      return c ? c.state : '–';
    }).join(' | ') + ' |');
  }
  lines.push('', `Result: **${ok ? 'PASS · 四端全等' : 'FAIL'}**`);
  if (diffs.length) lines.push(`- 不一致入口：${diffs.join(', ')}`);
  for (const [n, code] of Object.entries(errors)) lines.push(`- ${n} 返回错误：${code}`);
  lines.push('', '```json', JSON.stringify(proj, null, 2), '```', '');
  return lines.join('\n');
}

async function main() {
  const result = await runMatrix({});
  const out = process.env.OUT || path.join(ROOT, 'docs', 'surface-matrix.md');
  fs.writeFileSync(out, render(result), 'utf8');
  console.log(`surface-matrix ${result.ok ? 'PASS' : 'FAIL'} · ${result.mode} · ${result.issueKey} → ${path.relative(ROOT, out)}`);
  if (!result.ok) {
    console.error(`diffs: ${result.diffs.join(', ') || '(none)'} · errors: ${JSON.stringify(result.errors)}`);
    process.exit(1);
  }
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { runMatrix, projection, diffProjections, render };
