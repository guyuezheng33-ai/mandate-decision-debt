'use strict';

/**
 * 序列化与预算：出口硬上限 200KB（Rovo 实测约 1MB / 20 秒就放弃，留 5 倍余量）。
 * 字段白名单先说清楚：正文、描述、评论内容一律不进 payload，只留定位字段。
 */

const MAX_PAYLOAD_BYTES = 200 * 1024;
const HARD_LIMIT_BYTES = 1024 * 1024;
const MAX_STR = 240;

function byteSize(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

function clip(text, limit = MAX_STR) {
  const s = String(text ?? '');
  return s.length <= limit ? s : `${s.slice(0, limit - 1)}…`;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] != null) out[k] = obj[k];
  return out;
}

function compactFlag(flag) {
  return {
    p: flag.primitive,
    k: flag.kind,
    w: flag.weight,
    s: flag.severity,
    label: clip(flag.label),
    detail: clip(flag.detail),
    action: clip(flag.suggest),
    evidence: compactEvidence(flag.primitive, flag.evidence),
  };
}

function compactEvidence(primitive, evidence) {
  if (!evidence || typeof evidence !== 'object') return {};
  if (primitive === 'P2') {
    return pick(evidence, ['issueKey', 'decidedAt', 'inProgressSince', 'lastConfirmAt'])
      ? {
          issueKey: evidence.issueKey,
          decidedAt: evidence.decidedAt,
          inProgressSince: evidence.inProgressSince,
          lastConfirmAt: evidence.lastConfirmAt,
          sources: (evidence.decisions || []).slice(0, 3).map((d) => pick(d, ['title', 'id', 'url', 'updated'])),
        }
      : {};
  }
  if (primitive === 'P3') {
    return {
      issueKey: evidence.issueKey,
      sources: (evidence.decisions || []).slice(0, 3).map((d) => ({
        id: d.id,
        title: clip(d.title),
        owner: d.owner,
        url: d.url,
      })),
    };
  }
  if (primitive === 'P4') {
    return {
      issueKey: evidence.issueKey,
      status: evidence.status,
      goals: (evidence.goals || []).slice(0, 3).map((g) => pick(g, ['id', 'status', 'updated'])),
    };
  }
  if (primitive === 'P6') {
    return pick(evidence, ['issueKey', 'decision', 'contributors']);
  }
  return pick(evidence, ['issueKey', 'reopenedCount', 'lastReopenedAt', 'decisions', 'goals']);
}

/** 已知判据的权重占全部权重的比例：分数可以排序，但低于一半时没资格自称等级。 */
function certaintyOf(criteria) {
  const list = criteria || [];
  const total = list.reduce((n, c) => n + (c.w || 0), 0) || 1;
  const known = list.filter((c) => c.state !== 'unknown').reduce((n, c) => n + (c.w || 0), 0);
  return Number((known / total).toFixed(2));
}

function compactAuthority(a) {
  if (!a || typeof a !== 'object') return null;
  return {
    state: a.state,
    verdict: a.verdict,
    owner: a.owner || null,
    ownerName: a.ownerName ? clip(a.ownerName, 80) : null,
    title: a.title ? clip(a.title, 120) : null,
    url: a.url || null,
    updatedAt: a.updatedAt || null,
    lastConfirmAt: a.lastConfirmAt || null,
    daysSinceUpdate: a.daysSinceUpdate ?? null,
    daysWithoutConfirm: a.daysWithoutConfirm ?? null,
    contributors: a.contributors ?? null,
    decisionCount: a.decisionCount ?? null,
  };
}

/** 单条 issue 的对外 payload。 */
function compactIssue(summary, { maxFlags = 6 } = {}) {
  const unknownPrims = (summary.criteria || []).filter((c) => c.state === 'unknown').map((c) => c.p);
  const certainty = certaintyOf(summary.criteria);
  return {
    ok: true,
    issueKey: summary.issueKey,
    summary: clip(summary.summary),
    status: summary.status,
    profile: summary.profile,
    // 发布口径与项目行一致：grade unknown = NO SCORE，debt 发 null 不发 0。
    // 0 会被 agent/评审误读成"很健康"；内部下界仍留在 summarize 里供审计。
    debt: summary.grade === 'unknown' ? null : summary.debt,
    grade: summary.grade,
    authority: compactAuthority(summary.authority),
    // 三个入口（面板 / agent / MCP）必须能对"这条只判了一半"说同一句话，
    // 否则 agent 会照着 debt 念一个 watch，而面板写着 PARTIAL。
    partial: summary.grade !== 'unknown' && unknownPrims.length > 0,
    unknownPrims: summary.grade === 'unknown' ? [] : unknownPrims,
    certainty,
    thin: summary.grade !== 'unknown' && certainty < 0.5,
    flagCount: summary.flagCount,
    flags: (summary.flags || []).slice(0, maxFlags).map(compactFlag),
    suppressed: (summary.skipped || []).slice(0, 8).map((s) => ({ p: s.primitive, why: clip(s.reason, 80) })),
    // 六条判据逐条落在哪个状态：hit / clear / unknown。分数是这张表的和，
    // 面板据此回答"为什么是 28 而不是 40"，不需要用户自己去拼 flags + suppressed。
    criteria: (summary.criteria || []).map((c) => ({ p: c.p, w: c.w, state: c.state, label: clip(c.label, 40), why: c.why ? clip(c.why, 40) : null })),
    coverage: summary.coverage,
    source: summary.source,
    degraded: summary.degraded ? { from: summary.degraded.from, to: summary.degraded.to, reason: summary.degraded.reason } : null,
  };
}

/** 项目级 payload：只带 top N。 */
function compactProject(agg, { maxItems = 10 } = {}) {
  return {
    ok: true,
    projectKey: agg.projectKey,
    profile: agg.profile,
    debt: agg.debt,
    grade: agg.grade,
    itemCount: agg.itemCount,
    countedCount: agg.countedCount,
    unknownCount: agg.unknownCount,
    coverageRatio: Number(agg.coverageRatio.toFixed(2)),
    // 项目级也要说"这个数有多硬"：有分条目平均确定度 + 其中带缺口的条数。
    certainty: agg.certainty ?? null,
    partialCount: agg.partialCount ?? null,
    // 均分会把"4 条干净 + 17 条有债"揉成一个 14。把带缺口的条数单独带出去，
    // 项目页才能说"17 of 21 with a gap"，而不是让读者以为这个平均分代表整页。
    flaggedCount: agg.flaggedCount ?? null,
    flaggedShare: agg.flaggedShare ?? null,
    severeCount: agg.severeCount ?? null,
    disclosure: agg.disclosure ? { counted: agg.disclosure.counted, total: agg.disclosure.total, unknown: agg.disclosure.unknown } : null,
    // 预算披露：算法侧给出的 requested/fetched/cap，界面据此说"只看了前 8 条"。
    scan: agg.scan
      ? {
          source: agg.scan.source || null,
          requested: agg.scan.requested ?? null,
          fetched: agg.scan.fetched ?? null,
          cap: agg.scan.cap ?? null,
          capped: Boolean(agg.scan.capped),
          // 站点自己说"还有下一页"：这一页不是全部。扫描上限 50 时尤其要命。
          hasMore: Boolean(agg.scan.hasMore),
          degraded: Boolean(agg.scan.degraded),
          // 扫描不读评论（否则 8 条 × 1 次评论分页 = N+1）。代价是这一页看到的 P2
          // 可能比单条面板更悲观：面板会把留痕折成 lastConfirmAt，扫描不会。
          // 宁可把这件事写在界面上，也不要让两个入口给出不同的分数却不解释。
          confirmLookup: 'not-read',
        }
      : null,
    critical: agg.critical,
    atRisk: agg.atRisk,
    // 债从哪条判据来：权重贡献，不是命中次数（见 aggregate 注释）
    drivers: (agg.drivers || []).map((d) => ({ p: d.p, items: d.items, sum: d.sum, w: d.w })),
    items: agg.items.slice(0, maxItems).map((i) => {
      // 不可知的条目不能只说"没有命中"——那是把"看不见"写成"没问题"。
      // 把缺哪条边带出来，项目页才能说"目标与复核边不可见"而不是"无事发生"。
      const missing = [
        ...new Set(
          (i.skipped || [])
            .map((s) => String(s.reason || ''))
            .filter((r) => r.startsWith('unknown:'))
            .flatMap((r) => r.slice('unknown:'.length).split(','))
            .filter(Boolean),
        ),
      ];
      // 分数是"已知判据的权重和"，缺判据的分数天生偏低。若不在行上标出来，
      // 一个只缺 P2 的条目会以 28 分排在一条六条全知的 30 分后面，看起来"更安全"。
      // 判据状态的唯一真相是 criteria（含"边在但字段没回来"的 insufficient），
      // 不要从 skipped 的文案里反推 —— 那会把两种不同的缺失混成一种。
      const unknownPrims = (i.criteria || [])
        .filter((c) => c.state === 'unknown')
        .map((c) => String(c.p || ''))
        .filter(Boolean);
      // 低于一半权重时不该印等级：能排序，但没资格自称 healthy / watch。
      const certainty = certaintyOf(i.criteria);
      return {
        issueKey: i.issueKey,
        // 不可知的条目给 null，不给 0：0 在 JSON 里会被下游读成"很健康"，
        // 而这条不是健康，是"判不了"。界面早就会把 null 印成破折号。
        debt: i.grade === 'unknown' ? null : i.debt,
        grade: i.grade,
        authorityVerdict: i.authority?.verdict || null,
        authorityTitle: i.authority?.title ? clip(i.authority.title, 80) : null,
        partial: i.grade !== 'unknown' && unknownPrims.length > 0,
        unknownPrims: i.grade === 'unknown' ? [] : unknownPrims,
        certainty,
        top: i.topFlag ? i.topFlag.primitive : null,
        label: i.topFlag ? clip(i.flags[0].label, 40) : null,
        missing,
      };
    }),
  };
}

/**
 * 收尾保险：超预算时逐级丢字段，绝不返回一个 1MB 的错误。
 * @returns {{payload:object, bytes:number, trimmed:boolean}}
 */
function enforceBudget(payload, budget = MAX_PAYLOAD_BYTES) {
  let bytes = byteSize(payload);
  if (bytes <= budget) return { payload, bytes, trimmed: false };

  const trimmed = JSON.parse(JSON.stringify(payload));
  trimmed.flags = (trimmed.flags || []).map((f) => ({ ...f, detail: clip(f.detail, 60), evidence: {} }));
  bytes = byteSize(trimmed);
  if (bytes <= budget) return { payload: trimmed, bytes, trimmed: true };

  trimmed.flags = (trimmed.flags || []).slice(0, 3);
  trimmed.suppressed = [];
  bytes = byteSize(trimmed);
  if (bytes <= budget) return { payload: trimmed, bytes, trimmed: true };

  const minimal = pick(trimmed, ['ok', 'issueKey', 'summary', 'status', 'profile', 'debt', 'grade', 'flagCount', 'coverage']);
  minimal.flags = (trimmed.flags || []).slice(0, 1).map((f) => pick(f, ['p', 'k', 'w', 's', 'label']));
  return { payload: minimal, bytes: byteSize(minimal), trimmed: true };
}

module.exports = { MAX_PAYLOAD_BYTES, HARD_LIMIT_BYTES, MAX_STR, byteSize, clip, compactIssue, compactProject, enforceBudget };
