'use strict';

/**
 * 打分：把 flags 折算成 0–100 的决策债（Decision Debt）。
 *
 * 两条纪律：
 * 1. 分数只是聚合，首屏讲的是"漂移对"（P2）——分数是派生量，漂移是事实。
 * 2. unknown 的条目**不进分母**，同时单独披露覆盖率；否则数据全拿不到时分数会是满分。
 */

const { evaluate, daysBetween } = require('./rules');

const GRADE_ORDER = { healthy: 0, watch: 1, at_risk: 2, critical: 3 };
const DAY_MS = 24 * 60 * 60 * 1000;

function parseTime(value) {
  if (!value) return null;
  const t = typeof value === 'number' ? value : Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * 授权收据：把“谁、在哪份文档、什么时候、今天还算不算数”四件事，
 * 从 bundle 里一次算出来。UI 不应该从 flags 反推这四个字段——
 * 那会把“没命中”误显示成“没有授权”，也会让三个入口各说各话。
 */
function authorityOf(bundle, flags, profile) {
  const edge = bundle.edges?.decisions || { state: 'unknown', items: [] };
  const items = Array.isArray(edge.items) ? edge.items : [];
  const primary = [...items]
    .sort((a, b) => (parseTime(b.updated) || 0) - (parseTime(a.updated) || 0))[0] || null;
  const updated = parseTime(primary?.updated);
  const started = parseTime(bundle.inProgressSince) ?? parseTime(bundle.createdAt);
  const confirmed = parseTime(bundle.lastConfirmAt);
  // 真实站点没有“演示 asOf”：用当前时间判断“今天还算不算数”。
  // 拿 issue 的 updated 当 asOf 会把页面时间与 issue 时间相减，得到负数或错的天数。
  const asOf = parseTime(bundle.asOf) ?? Date.now();
  const daysSinceUpdate = updated != null && asOf != null ? Math.round((asOf - updated) / DAY_MS) : null;
  const driftDays = Number(profile?.driftDays) || 0;
  const hasConflict = flags.some((f) => f.primitive === 'P3');

  let verdict = 'unknown';
  if (edge.state === 'absent') verdict = 'missing';
  else if (edge.state !== 'present' || !primary) verdict = 'unknown';
  else if (hasConflict) verdict = 'contested';
  else if (updated != null && started != null && updated > started) {
    if (confirmed != null && confirmed >= updated) verdict = 'current';
    else if (daysSinceUpdate != null && daysSinceUpdate >= driftDays) verdict = 'stale';
    else verdict = 'current';
  } else if (updated != null) {
    // 授权早于当前工作开始，不代表它天然有效：这正是"上一任批准、后来没人复核"的场景。
    // 只有明确复核过（confirmed >= updated）才算 current，否则仍按漂移天数判 stale。
    if (confirmed != null && confirmed >= updated) verdict = 'current';
    else if (daysSinceUpdate != null && daysSinceUpdate >= driftDays) verdict = 'stale';
    else verdict = 'current';
  }

  const contributors = primary && Array.isArray(primary.contributors) ? primary.contributors.length : null;
  return {
    state: edge.state,
    verdict,
    owner: primary?.owner || null,
    ownerName: primary?.ownerName || null,
    // 记录的来源决定说法：Confluence 页是"最后修改"，Jira 授权记录是"批准日期"。
    // 两种都叫"修改"会让收据读起来像版本日志，而不是一次授权。
    kind: primary && (primary.application === 'Jira' || /^jira:/.test(String(primary.id || ''))) ? 'jira' : 'page',
    title: primary?.title || null,
    url: primary?.url || null,
    updatedAt: updated != null ? new Date(updated).toISOString() : null,
    lastConfirmAt: confirmed != null ? new Date(confirmed).toISOString() : null,
    daysSinceUpdate,
    daysWithoutConfirm: verdict === 'stale' ? daysSinceUpdate : null,
    contributors,
    decisionCount: items.length,
  };
}


function maxGrade(a, b) {
  return (GRADE_ORDER[a] ?? -1) >= (GRADE_ORDER[b] ?? -1) ? a : b;
}

function grade(debt) {
  if (debt <= 15) return 'healthy';
  if (debt <= 35) return 'watch';
  if (debt <= 60) return 'at_risk';
  return 'critical';
}

/** 单条的债 = 命中权重之和（上限 100）。 */
function debtOf(flags) {
  const total = flags.reduce((sum, f) => sum + (f.weight || 0), 0);
  return Math.max(0, Math.min(100, Math.round(total)));
}

/**
 * 这个口径下**可能达到**的最高分。
 *
 * 六条判据不是互不相干：P1 要求"依据与目标都缺席"，而 P2/P3/P5/P6 都要求依据在册、
 * P4 要求目标在册。所以 P1 命中的时候，其余五条一条也命中不了。
 *
 * 结果是天花板 = max(P1, P2+P3+P4+P5+P6)，software 口径下是 71，不是 100。
 * 这不影响分数本身的含义，但意味着"0–100"是一个上界而不是一个可达值 ——
 * 与其让评委自己算出 71 然后怀疑标尺，不如把这条不变式写进断言里。
 */
function ceiling(profile) {
  const w = profile.weights || {};
  const rest = ['P2', 'P3', 'P4', 'P5', 'P6'].reduce((s, id) => s + (w[id] || 0), 0);
  return Math.max(w.P1 || 0, rest);
}

function summarize(bundle, profile) {
  const { flags, skipped, criteria, coverage } = evaluate(bundle, profile);
  const debt = debtOf(flags);
  const unknowable = coverage.known === 0;

  // 分数是**下界**：unknown 的判据不进分子。所以必须同时给出"这个下界有多硬"。
  // certainty = 已判权重 / 应有权重（skipped 的判据不算"应有"，它们在本口径下不适用）。
  const applicableWeight = criteria.reduce((s, c) => s + (c.w || 0), 0);
  const unknownWeight = criteria.reduce((s, c) => s + (c.state === 'unknown' ? c.w || 0 : 0), 0);
  const certainty = applicableWeight ? Math.round(((applicableWeight - unknownWeight) / applicableWeight) * 100) / 100 : 0;

  // 有一条判据看不见，就可能是"看不见的债"，不能把下界当成结论报成 healthy。
  // 但只因为 P5（重开历史）缺失就整条不出分，会让真站点上永远没有分数，
  // 所以这里只对"主判据"（P2 变更未传导）要求必须可知：它看不见时，等级一律 unknown。
  const heroUnknown = bundle.edges?.decisions?.state === 'present' && criteria.some((c) => c.p === 'P2' && c.state === 'unknown');
  // 低分不等于干净：P3 依据冲突在 software 口径只有 15 分，落在 <=15 的健康带里，
  // 屏幕上就会出现"15 分 · 健康"配一条"两份依据互相打架"的命中 —— 自相矛盾。
  // 所以等级有一个**下限**：只要有 high / medium 级的判据命中，至少是 watch。
  // 只有低严重度（P6 单人无复核）可以留在健康带：它是"补一条复核"，不是"有债"。
  const severe = flags.some((f) => f.severity && f.severity !== 'low');
  const baseGrade = unknowable || heroUnknown ? 'unknown' : severe ? maxGrade(grade(debt), 'watch') : grade(debt);
  const authority = authorityOf(bundle, flags, profile);
  // 授权状态是这张收据的主结论。不能一边写"授权已过期"，一边挂一个绿色"健康"。
  // 缺记录/冲突 → 至少 at_risk；过期 → 至少 watch。不知道就不升级（unknown 仍是 unknown）。
  // 缺记录或已过期，至少是 watch：不能一边写"没有依据/已失效"，一边挂绿色"健康"。
  const authorityFloor =
    authority.verdict === 'missing' || authority.verdict === 'stale' ? 'watch' : null;
  const gradeValue = baseGrade !== 'unknown' && authorityFloor ? maxGrade(baseGrade, authorityFloor) : baseGrade;

  return {
    issueKey: bundle.issueKey,
    summary: bundle.summary,
    status: bundle.status,
    profile: profile.key,
    debt,
    authority,
    // 一条证据都不可知时不出分：0 分会被误读成"很健康"，这与我们的可信度底线冲突
    grade: gradeValue,
    certainty,
    partial: unknownWeight > 0,
    unknownWeight,
    flagCount: flags.length,
    topFlag: flags.length ? { primitive: flags[0].primitive, kind: flags[0].kind, weight: flags[0].weight } : null,
    flags,
    skipped,
    // 六条判据的逐条结论：hit / clear / unknown。分数只是这张表的和。
    criteria,
    coverage,
    source: bundle.source,
    // 降级来源要跟着分数一起走：一个来自 REST 的 28 和一个来自 TWG 的 28 不是同一句话。
    degraded: bundle.degraded || null,
  };
}

/**
 * 项目级聚合：
 * 分母只算"三条必需边都可知"的条目；不可知的单独计数并披露。
 */
function aggregate(bundles, profile) {
  const items = bundles.map((b) => summarize(b, profile));
  // "算得出等级"才算进分母：有主判据看不见的条目，宁可不出分，也不出一个偏低的假健康分。
  const counted = items.filter((i) => i.grade !== 'unknown');
  const unknown = items.length - counted.length;
  const avg = counted.length
    ? Math.round(counted.reduce((s, i) => s + i.debt, 0) / counted.length)
    : 0;
  // 覆盖不足一半时不出项目级等级：那是"一页里大多数看不见"，不是一个可汇报的数。
  const enough = items.length > 0 && counted.length / items.length >= 0.5;

  // "哪个判据真正在制造债"比"平均分多少"更像交付负责人会问的问题。
  //
  // 项目级同样需要下限：21 条构造样本里 17 条有命中，平均 14 分，按纯平均会被
  // 报成"14 · 健康"——一个 81% 的条目都有缺口的项目叫健康，是这张表最危险的说错话。
  // 所以：有任何条目带 high/medium 命中 → 至少 watch；多数条目带缺口且均分已过
  // watch 中段（25）→ 至少 at_risk。均分仍印原值，等级只是加了地板。
  const flagged = counted.filter((i) => (i.flags || []).length > 0);
  const flaggedSevere = counted.filter((i) => (i.flags || []).some((f) => f.severity !== 'low'));
  const flaggedShare = counted.length ? flagged.length / counted.length : 0;
  let g = enough ? grade(avg) : 'unknown';
  if (enough && flaggedSevere.length > 0) g = maxGrade(g, 'watch');
  if (enough && flaggedShare >= 0.6 && avg >= 25) g = maxGrade(g, 'at_risk');

  const driverMap = new Map();
  for (const it of counted) {
    for (const f of it.flags || []) {
      const row = driverMap.get(f.primitive) || { p: f.primitive, items: 0, sum: 0, w: profile.weights[f.primitive] ?? 0 };
      row.items += 1;
      row.sum += f.weight || 0;
      driverMap.set(f.primitive, row);
    }
  }
  const drivers = [...driverMap.values()].sort((a, b) => b.sum - a.sum || b.items - a.items);

  return {
    projectKey: bundles[0]?.projectKey ?? null,
    profile: profile.key,
    itemCount: items.length,
    countedCount: counted.length,
    unknownCount: unknown,
    coverageRatio: items.length ? counted.length / items.length : 0,
    debt: enough ? avg : null,
    grade: g,
    // 项目页的 certainty：有分条目的平均确定度。界面上"这份看板有多可信"就靠它。
    certainty: counted.length
      ? Math.round(counted.reduce((s, i) => s + (i.certainty || 0), 0) / counted.length * 100) / 100
      : 0,
    // 有多少条真的带缺口：均分会把 4 条干净条目和 17 条有债条目揉成一个 14。
    // 不披露这个比例，项目页就只剩一个平均数，读者无法知道"是普发还是个例"。
    flaggedCount: flagged.length,
    flaggedShare: Math.round(flaggedShare * 100) / 100,
    severeCount: flaggedSevere.length,
    partialCount: counted.filter((i) => i.partial).length,
    critical: counted.filter((i) => i.grade === 'critical').length,
    atRisk: counted.filter((i) => i.grade === 'at_risk').length,
    items: [...items].sort((a, b) => b.debt - a.debt),
    drivers,
    // 披露用数字，不用句子：文案属于界面，引擎不该替界面选语言。
    disclosure: { counted: counted.length, total: items.length, unknown },
    // 扫描预算随结果透传：REST 降级一次只算 8 条，界面必须能把这句话说出来。
    scan: bundles.scan || null,
  };
}

/** 公共项目级评分入口：CLI、语料报告、探针和 agent 都从这里拿同一份聚合。 */
function score_project(bundles, profile) {
  return aggregate(bundles, profile);
}

/** 修复前后对比：用于演示"分数真的会下降"。 */
function diff(before, after) {
  const from = before?.debt ?? null;
  const to = after?.debt ?? null;
  return { from, to, delta: from != null && to != null ? to - from : null };
}

module.exports = { debtOf, grade, ceiling, summarize, aggregate, score_project, diff };
