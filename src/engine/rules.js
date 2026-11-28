'use strict';

/**
 * 六个判据原语：纯函数，零 I/O，零随机，时间从入参来。
 *
 * 每条规则声明 requires（它需要哪几条边是"可知"的）。
 * 只要有一条必需边是 unknown，规则就被抑制——这也是"不把看不到说成没有"的落点。
 */

const { STATES } = require('./normalize');
const { missingFor, coverageOf } = require('./tri');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 严重度是**语义**，不是权重。
 *
 * 早前这里按权重反推（>=18 high / >=12 medium），于是同一个事实"变更未传导"
 * 在 software 口径（20）是 high，在 portfolio 口径（14）就变成 medium ——
 * 同一件事的说法随权重变形，界面上的严重度就不可信了。
 * 权重回答"在这个口径里值多少分"，严重度回答"这算什么性质的问题"，两者分开。
 */
const SEVERITY = { P1: 'high', P2: 'high', P3: 'medium', P4: 'high', P5: 'medium', P6: 'low' };

function parseDate(value) {
  if (!value) return null;
  const t = typeof value === 'number' ? value : Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function daysBetween(later, earlier) {
  const l = typeof later === 'number' ? later : parseDate(later);
  const e = typeof earlier === 'number' ? earlier : parseDate(earlier);
  if (l == null || e == null) return null;
  return Math.round((l - e) / DAY_MS);
}

function maxUpdated(items) {
  const stamps = items.map((d) => parseDate(d.updated) ?? 0).filter(Boolean);
  return stamps.length ? Math.max(...stamps) : null;
}

/**
 * P2 / traceDrift 共用的"记录最近一次变更"时间：
 * 优先服务器编辑时间 editedAt（Jira 原生授权记录的 fields.updated），
 * 没有时退回 updated（页面最后修改 / 批准日期）。
 * 两个入口必须用同一个函数，否则面板与 agent 会对同一条 issue 给出不同的漂移天数。
 */
function maxDecided(items) {
  const stamps = items.map((d) => parseDate(d.editedAt) ?? parseDate(d.updated) ?? 0).filter(Boolean);
  return stamps.length ? Math.max(...stamps) : null;
}

function isDone(bundle) {
  if (bundle.statusCategory === 'done') return true;
  return /^(done|closed|resolved|completed|已完成|已关闭)$/i.test(bundle.status || '');
}

function isEnded(goal) {
  return /^(closed|completed|archived|done|cancelled|canceled)$/i.test(goal.status || '');
}

const EN_STOP = new Set([
  'decision', 'decisions', 'plan', 'plans', 'meeting', 'meetings', 'notes', 'note',
  'record', 'records', 'doc', 'docs', 'page', 'pages', 'policy', 'draft', 'final',
  'and', 'or', 'the', 'a', 'of', 'for', 'brief', 'v1', 'v2', 'v3',
]);

const CJ_STOP = ['决策', '决定', '方案', '会议', '纪要', '记录', '文档', '页面', '立项', '评审'];

/** 标题分词：拉丁词 + 中文二元组。用于判断"这两页是不是在说同一件事"。 */
function topicTokens(title) {
  const raw = String(title || '').toLowerCase();
  const set = new Set();
  for (const w of raw.match(/[a-z0-9]{2,}/g) || []) {
    if (EN_STOP.has(w)) continue;
    if (/^[0-9]+$/.test(w)) continue; // 60 / 180 这类阈值是"冲突点"，不是"主题词"
    set.add(w.length > 3 ? w.replace(/s$/, '') : w); // portals → portal
  }
  const hanChunks = raw.replace(/[^\p{Script=Han}]/gu, ' ').split(/\s+/).filter(Boolean);
  for (const chunk of hanChunks) {
    let stripped = chunk;
    for (const stop of CJ_STOP) stripped = stripped.split(stop).join(' ');
    for (const part of stripped.split(/\s+/).filter(Boolean)) {
      if (part.length === 1) set.add(part);
      for (let i = 0; i + 1 < part.length; i += 1) set.add(part.slice(i, i + 2));
    }
  }
  return set;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** 把标题相近的页面聚簇；threshold 由口径决定（launch 更低 = 冲突容忍度 0）。 */
function clusterDecisions(decisions, threshold = 0.5) {
  const clusters = [];
  for (const d of decisions) {
    const tokens = topicTokens(d.title);
    const hit = clusters.find((c) => jaccard(c.tokens, tokens) >= threshold);
    if (hit) hit.items.push(d);
    else clusters.push({ tokens, items: [d] });
  }
  return clusters;
}

function ownerSet(items) {
  return new Set(items.map((d) => d.owner).filter(Boolean));
}

const RULES = [
  {
    id: 'P1',
    kind: 'no_mandate',
    severity: 'high',
    requires: ['decisions', 'goals'],
    label: { en: 'No mandate', zh: '无依据' },
    test(bundle) {
      return (
        bundle.edges.decisions.state === STATES.ABSENT &&
        bundle.edges.goals.state === STATES.ABSENT
      );
    },
    detail(bundle, profile) {
      const term = profile.term;
      const termZh = typeof profile.evidenceTerm === 'string' ? profile.evidenceTerm : profile.evidenceTerm.zh;
      return {
        en: `No linked ${term} and no linked goal — nothing records why this work exists.`,
        zh: `这项工作既没有关联的${termZh}，也没有关联目标，等于没有任何"为什么做"的记录。`,
      };
    },
    evidence(bundle) {
      return { issueKey: bundle.issueKey, decisions: 0, goals: 0 };
    },
    suggest(bundle, profile) {
      const term = profile.term;
      const termZh = typeof profile.evidenceTerm === 'string' ? profile.evidenceTerm : profile.evidenceTerm.zh;
      return {
        en: `Link the authorising ${term}, or attach the review notes that already exist.`,
        zh: `把立项依据补成一份${termZh}并关联；已有的评审记录直接挂上来即可。`,
      };
    },
  },
  {
    id: 'P2',
    kind: 'drift_not_propagated',
    severity: 'high',
    requires: ['decisions'],
    label: { en: 'Change not propagated', zh: '变更未传导' },
    /**
     * 边在，但"依据页什么时候被改过"没回来 —— 这时 P2 判不了，不是"没发生"。
     * TWG 只在你注册的 Cypher 里返回 updated 时才有这个字段；REST 的关联页更没有。
     */
    gaps(bundle) {
      const items = bundle.edges.decisions.items || [];
      const out = [];
      if (items.length && items.every((d) => !d.updated && !d.editedAt)) out.push('decisions-no-updated');
      // 依据页有时间、但"开工时间"没回来：算不出先后，只能判 unknown。
      // 以前这里直接 return false，屏幕上就是"变更未传导：未命中"——一条假 clear。
      const decided = maxDecided(items);
      if (decided != null) {
        const started = parseDate(bundle.inProgressSince) ?? parseDate(bundle.createdAt);
        if (started == null) out.push('issue-no-start');
        if (parseDate(bundle.asOf) == null) out.push('issue-no-asof');
      }
      return out;
    },
    test(bundle, profile) {
      const decided = maxDecided(bundle.edges.decisions.items);
      if (decided == null) return false;
      const started = parseDate(bundle.inProgressSince) ?? parseDate(bundle.createdAt);
      if (started == null) return false;
      // 依据在执行开始之后被改过，才叫"变更未传导"；早于执行开始是另一件事
      if (decided <= started) return false;
      const confirmed = parseDate(bundle.lastConfirmAt);
      if (confirmed != null && confirmed >= decided) return false;
      const asOf = parseDate(bundle.asOf);
      const gap = daysBetween(asOf, decided);
      if (gap == null) return false;
      return gap >= profile.driftDays;
    },
    detail(bundle, profile) {
      const decided = maxDecided(bundle.edges.decisions.items);
      const started = parseDate(bundle.inProgressSince) ?? parseDate(bundle.createdAt);
      const gap = daysBetween(parseDate(bundle.asOf ?? bundle.updatedAt), decided);
      const startText = started ? new Date(started).toISOString().slice(0, 10) : '?';
      const decidedText = new Date(decided).toISOString().slice(0, 10);
      const term = profile.term;
      const termZh = typeof profile.evidenceTerm === 'string' ? profile.evidenceTerm : profile.evidenceTerm.zh;
      return {
        en: `The ${term} was edited on ${decidedText}, work started on ${startText}, and nobody has confirmed since — ${gap} days apart.`,
        zh: `${termZh}在 ${decidedText} 被更新过，执行从 ${startText} 起就没有再确认，已相隔 ${gap} 天。`,
      };
    },
    evidence(bundle) {
      const decided = maxDecided(bundle.edges.decisions.items);
      return {
        issueKey: bundle.issueKey,
        decidedAt: decided ? new Date(decided).toISOString() : null,
        inProgressSince: bundle.inProgressSince ?? bundle.createdAt,
        lastConfirmAt: bundle.lastConfirmAt,
        decisions: bundle.edges.decisions.items.map((d) => ({ id: d.id, title: d.title, url: d.url, updated: d.updated, editedAt: d.editedAt ?? null })),
      };
    },
    suggest(bundle, profile) {
      const term = profile.term;
      const termZh = typeof profile.evidenceTerm === 'string' ? profile.evidenceTerm : profile.evidenceTerm.zh;
      return {
        en: `Ask the ${term} owner to re-confirm, and append "still valid / changed" back to the page so the delivery side has something to point at.`,
        zh: `请${termZh}的 owner 复核一次，并把"仍然有效 / 已变更"追加回原文，让执行的这一端有据可依。`,
      };
    },
  },
  {
    id: 'P3',
    kind: 'conflicting_mandates',
    severity: 'medium',
    requires: ['decisions'],
    label: { en: 'Conflicting mandates', zh: '依据冲突' },
    /** 两份以上依据页、却有人没有 owner：分不出"谁跟谁冲突"，不是"没有冲突"。 */
    gaps(bundle) {
      const items = bundle.edges.decisions.items || [];
      return items.length >= 2 && items.some((d) => !d.owner) ? ['decisions-no-owner'] : [];
    },
    test(bundle, profile) {
      const clusters = clusterDecisions(bundle.edges.decisions.items, profile.conflictSimilarity);
      return clusters.some((c) => c.items.length >= 2 && ownerSet(c.items).size >= 2);
    },
    detail(bundle, profile) {
      const clusters = clusterDecisions(bundle.edges.decisions.items, profile.conflictSimilarity);
      const c = clusters.find((x) => x.items.length >= 2 && ownerSet(x.items).size >= 2);
      const titlesEn = c.items.map((d) => `"${d.title}"`).join(', ');
      const titlesZh = c.items.map((d) => `「${d.title}」`).join('、');
      const term = profile.term;
      const termZh = typeof profile.evidenceTerm === 'string' ? profile.evidenceTerm : profile.evidenceTerm.zh;
      return {
        en: `Two ${term}s cover the same topic with different owners (${titlesEn}) — each team may be executing a different reading.`,
        zh: `同一主题下存在 ${c.items.length} 份 ${termZh}（${titlesZh}），负责人不同，各自执行的人可能各按各的理解走。`,
      };
    },
    evidence(bundle, profile) {
      const clusters = clusterDecisions(bundle.edges.decisions.items, profile.conflictSimilarity);
      const c = clusters.find((x) => x.items.length >= 2 && ownerSet(x.items).size >= 2);
      return {
        issueKey: bundle.issueKey,
        decisions: c.items.map((d) => ({ id: d.id, title: d.title, owner: d.owner, url: d.url })),
      };
    },
    suggest() {
      return {
        en: 'Name one owner, mark the other page as superseded, and link them both ways so nobody executes a stale reading.',
        zh: '指定唯一 owner，把另一份标注为"已被取代"并互链，避免后人各按各的理解执行。',
      };
    },
  },
  {
    id: 'P4',
    kind: 'goal_drift',
    severity: 'high',
    requires: ['goals'],
    label: { en: 'Goal drift', zh: '目标漂移' },
    /** 目标回来了，但既没有状态也没有更新时间：既不能说它结束了，也不能说它还活着。 */
    gaps(bundle) {
      const goals = bundle.edges.goals.items || [];
      return goals.length && goals.every((g) => g.status === 'unknown' && !g.updated) ? ['goals-no-state'] : [];
    },
    test(bundle, profile) {
      if (isDone(bundle)) return false;
      const goals = bundle.edges.goals.items;
      if (!goals.length) return false;
      const allEnded = goals.every(isEnded);
      if (allEnded) return true;
      const staleDays = profile.goalStaleDays;
      if (!staleDays) return false;
      const asOf = parseDate(bundle.asOf);
      return goals.some((g) => {
        const updated = parseDate(g.updated);
        if (updated == null) return false;
        const gap = daysBetween(asOf, updated);
        return gap != null && gap >= staleDays && !isDone(bundle);
      });
    },
    detail(bundle, profile) {
      const goals = bundle.edges.goals.items;
      const ended = goals.filter(isEnded);
      const names = goals.map((g) => g.title || g.id).join(', ');
      if (ended.length === goals.length) {
        return {
          en: `The linked goal (${names}) has ended, but this work is still "${bundle.status}".`,
          zh: `关联目标（${names}）已经结束，工作项仍处于「${bundle.status}」。`,
        };
      }
      return {
        en: `The linked goal (${names}) has not been updated for ${profile.goalStaleDays} days, yet the work is still moving.`,
        zh: `关联目标（${names}）已超过 ${profile.goalStaleDays} 天没有更新，而工作项仍在推进。`,
      };
    },
    evidence(bundle) {
      return {
        issueKey: bundle.issueKey,
        status: bundle.status,
        goals: bundle.edges.goals.items.map((g) => ({ id: g.id, status: g.status, updated: g.updated })),
      };
    },
    suggest() {
      return {
        en: 'Decide whether this work should continue: attach it to a live goal, or close it.',
        zh: '确认这项工作是否还有必要继续：需要就挂到新的目标下，不需要就关掉。',
      };
    },
  },
  {
    id: 'P5',
    kind: 'rework_churn',
    severity: 'medium',
    requires: ['decisions'],
    label: { en: 'Re-litigation', zh: '反复翻案' },
    /** REST 的 issue 没有"重开次数"：返回 0 会让这条永远沉默，所以缺这个字段就是 unknown。 */
    gaps(bundle) {
      return !bundle.reopenedKnown && !bundle.lastReopenedAt ? ['issue-no-reopen-count'] : [];
    },
    test(bundle) {
      if ((bundle.reopenedCount || 0) < 2) return false;
      const decided = maxDecided(bundle.edges.decisions.items);
      const lastReopen = parseDate(bundle.lastReopenedAt);
      if (lastReopen != null) return decided == null || decided < lastReopen;
      const created = parseDate(bundle.createdAt);
      if (created == null) return false;
      return decided == null || decided <= created;
    },
    detail(bundle) {
      return {
        en: `This work has been reopened ${bundle.reopenedCount} times, with no new evidence recorded to explain any of the reversals.`,
        zh: `这项工作被重新打开 ${bundle.reopenedCount} 次，期间没有新增依据记录来解释每一次转向。`,
      };
    },
    evidence(bundle) {
      return {
        issueKey: bundle.issueKey,
        reopenedCount: bundle.reopenedCount || 0,
        lastReopenedAt: bundle.lastReopenedAt ?? null,
      };
    },
    suggest() {
      return {
        en: 'Record a reason for each reopen and write the conclusion back to the decision page — otherwise the same argument returns next quarter.',
        zh: '为每次重开补一条原因，并把结论回写到依据页——否则下一次还会再吵一遍。',
      };
    },
  },
  {
    id: 'P6',
    kind: 'single_point_no_review',
    severity: 'low',
    requires: ['decisions', 'reviewTraces'],
    label: { en: 'Single author, no review', zh: '单人且无复核' },
    /**
     * 这条最容易撒谎：拿不到"贡献者名单"或"复核痕迹挂在哪个页面"时，
     * 缺省值会让它得出"只有一个作者、没人复核"——那是我们没看见，不是事实。
     */
    gaps(bundle) {
      const decisions = bundle.edges.decisions.items || [];
      const traces = bundle.edges.reviewTraces.items || [];
      const out = [];
      if (decisions.length && decisions.every((d) => d.contributorsKnown === false)) out.push('decisions-no-contributors');
      if (traces.length && traces.every((t) => !t.pageId || !t.actorId)) out.push('reviewtraces-unkeyed');
      return out;
    },
    test(bundle) {
      const decisions = bundle.edges.decisions.items.filter((d) => (d.contributors || []).length <= 1);
      if (!decisions.length) return false;
      const traces = bundle.edges.reviewTraces.items;
      return decisions.some((d) => {
        const reviewers = new Set(
          traces
            .filter((t) => t.pageId === d.id && t.actorId)
            .map((t) => t.actorId)
            .filter((id) => id !== d.owner && !(d.contributors || []).includes(id)),
        );
        return reviewers.size === 0;
      });
    },
    detail(bundle) {
      const d = bundle.edges.decisions.items.find((x) => (x.contributors || []).length <= 1);
      const n = (d.contributors || []).length;
      return {
        en: `The decision page "${d.title}" has ${n} contributor${n === 1 ? '' : 's'}, and no second person left a review trace — the reasoning lives in one person's memory.`,
        zh: `依据页「${d.title}」只有 ${n} 位贡献者，页面上也没有第二个人留下的复核痕迹——判断全在一个人的记忆里。`,
      };
    },
    evidence(bundle) {
      const d = bundle.edges.decisions.items.find((x) => (x.contributors || []).length <= 1);
      return { issueKey: bundle.issueKey, decision: d.id, contributors: d.contributors || [] };
    },
    suggest() {
      return {
        en: 'Ask a second colleague who has actually read it to review and comment, turning one person\'s memory into a team record.',
        zh: '请第二位相关同事复核并留下评论，把"一个人的记忆"变成"团队的记录"。',
      };
    },
  },
];

/**
 * @param {object} bundle ProvenanceBundle
 * @param {object} profile 口径配置
 * @returns {{flags:Array, skipped:Array, coverage:object}}
 */
function evaluate(bundle, profile) {
  const flags = [];
  const skipped = [];
  // 六条判据各自的结论都要留下来，不只留"命中了哪几条"。
  // 用户看到 28 分时，下一个问题一定是"另外几条为什么没算"——没有这张表，
  // 唯一能给出的答案就是"没命中"，而"没命中"和"看不见"是两件完全不同的事。
  const criteria = [];
  const lang = profile.lang || 'en';
  const pick = (v) => (v && typeof v === 'object' ? v[lang] ?? v.en ?? '' : v);

  for (const rule of RULES) {
    const weight = profile.weights[rule.id] ?? 0;
    const label = pick(rule.label);
    const missing = missingFor(bundle, rule.requires);
    if (missing.length) {
      skipped.push({
        primitive: rule.id,
        kind: rule.kind,
        label,
        reason: `unknown:${missing.join(',')}`,
      });
      criteria.push({ p: rule.id, w: weight, state: 'unknown', label, why: missing.join(',') });
      continue;
    }
    let hit = false;
    // 边在，但判据需要的字段没回来（没有更新时间、没有 owner、没有贡献者名单）：
    // 这时判"没命中"就是把"看不见"洗成"没问题"，所以压低成 unknown。
    const gaps = typeof rule.gaps === 'function' ? rule.gaps(bundle) : [];
    if (gaps.length) {
      skipped.push({ primitive: rule.id, kind: rule.kind, label, reason: `insufficient:${gaps.join(',')}` });
      criteria.push({ p: rule.id, w: weight, state: 'unknown', label, why: gaps.join(',') });
      continue;
    }
    try {
      hit = Boolean(rule.test(bundle, profile));
    } catch (err) {
      // 规则自身异常时，绝不把工作项判成"有问题"
      skipped.push({ primitive: rule.id, kind: rule.kind, label, reason: `rule-error:${err.message}` });
      criteria.push({ p: rule.id, w: weight, state: 'unknown', label, why: 'rule-error' });
      continue;
    }
    if (!hit) {
      criteria.push({ p: rule.id, w: weight, state: 'clear', label, why: null });
      continue;
    }
    flags.push({
      primitive: rule.id,
      kind: rule.kind,
      severity: SEVERITY[rule.id] || 'low',
      weight,
      label,
      detail: pick(rule.detail(bundle, profile)),
      evidence: rule.evidence(bundle, profile),
      suggest: pick(rule.suggest(bundle, profile)),
    });
    criteria.push({ p: rule.id, w: weight, state: 'hit', label, why: null });
  }

  flags.sort((a, b) => b.weight - a.weight || a.primitive.localeCompare(b.primitive));
  return { flags, skipped, criteria, coverage: coverageOf(bundle, ['decisions', 'goals', 'reviewTraces']) };
}

module.exports = {
  RULES,
  SEVERITY,
  evaluate,
  topicTokens,
  jaccard,
  clusterDecisions,
  daysBetween,
  parseDate,
  maxUpdated,
  maxDecided,
  isDone,
  isEnded,
};
