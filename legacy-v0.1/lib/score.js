'use strict';

/** 打分：把 flags 折算成 0–100 的 Context Health Score。规则与权重全部对外可见。 */

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function healthOf(flags) {
  const penalty = flags.reduce((sum, f) => sum + (f.weight || 0), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function grade(health) {
  if (health >= 85) return 'healthy';
  if (health >= 65) return 'watch';
  if (health >= 40) return 'at_risk';
  return 'critical';
}

function summarize(ctx, flags) {
  const sorted = [...flags].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.weight - a.weight,
  );
  const health = healthOf(flags);
  return {
    issueKey: ctx.key,
    summary: ctx.summary,
    status: ctx.status,
    health,
    grade: grade(health),
    flagCount: sorted.length,
    topKind: sorted.length ? sorted[0].kind : null,
    flags: sorted,
    source: ctx.source || 'unknown',
  };
}

/** 项目级聚合：加权平均 + 风险项排序。 */
function aggregate(contexts) {
  const items = contexts.map((ctx) => {
    const { evaluate } = require('./rules');
    return summarize(ctx, evaluate(ctx));
  });

  const total = items.length;
  const avg = total ? Math.round(items.reduce((s, i) => s + i.health, 0) / total) : 100;
    const critical = items.filter((i) => i.health < 40).length;
  const atRisk = items.filter((i) => i.health >= 40 && i.health < 65).length;

  return {
    projectKey: contexts[0]?.projectKey ?? null,
    itemCount: total,
    health: avg,
    grade: grade(avg),
    critical,
    atRisk,
    items: items.sort((a, b) => a.health - b.health),
  };
}

module.exports = { healthOf, grade, summarize, aggregate };
