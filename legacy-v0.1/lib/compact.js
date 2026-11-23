'use strict';

/**
 * 紧凑化：Rovo action 的实测容忍度约为 1MB / 20 秒（官方文档写 55 秒，但 Rovo 会更早放弃）。
 * 所以所有对外返回都必须裁剪：只留能被 UI 和 agent 用到的字段。
 */

const MAX_STR = 240;
const DEFAULT_FLAG_LIMIT = 6;

function clip(value, max = MAX_STR) {
  const s = String(value ?? '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function clipDeep(input, depth = 0) {
  if (typeof input === 'string') return clip(input);
  if (Array.isArray(input)) return input.slice(0, 20).map((v) => clipDeep(v, depth + 1));
  if (input && typeof input === 'object') {
    if (depth > 4) return '[depth-limit]';
    const out = {};
    for (const [k, v] of Object.entries(input)) out[k] = clipDeep(v, depth + 1);
    return out;
  }
  return input;
}

function byteSize(obj) {
  return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

/** 单工作项对外形状：健康分 + 前 N 条 flag，证据只留定位信息。 */
function compactIssue(summaryResult, flagLimit = DEFAULT_FLAG_LIMIT) {
  return clipDeep({
    ok: true,
    issueKey: summaryResult.issueKey,
    summary: summaryResult.summary,
    status: summaryResult.status,
    health: summaryResult.health,
    grade: summaryResult.grade,
    flagCount: summaryResult.flagCount,
    source: summaryResult.source,
    flags: summaryResult.flags.slice(0, flagLimit).map((f) => ({
      ruleId: f.ruleId,
      kind: f.kind,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      suggest: f.suggest,
      evidence: f.evidence,
    })),
    truncated: summaryResult.flags.length > flagLimit,
  });
}

/** 项目级对外形状：分数 + Top N 风险项，不带每项的完整证据。 */
function compactProject(aggregateResult, limit = 10) {
  return clipDeep({
    ok: true,
    projectKey: aggregateResult.projectKey,
    itemCount: aggregateResult.itemCount,
    health: aggregateResult.health,
    grade: aggregateResult.grade,
    critical: aggregateResult.critical,
    atRisk: aggregateResult.atRisk,
    items: aggregateResult.items.slice(0, limit).map((i) => ({
      issueKey: i.issueKey,
      summary: i.summary,
      health: i.health,
      grade: i.grade,
      topKind: i.topKind,
      flagCount: i.flagCount,
    })),
    truncated: aggregateResult.items.length > limit,
  });
}

module.exports = { clip, clipDeep, byteSize, compactIssue, compactProject, MAX_STR };
