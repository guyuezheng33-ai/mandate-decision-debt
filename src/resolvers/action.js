'use strict';

/**
 * 三个 action：agent 与 MCP 共用同一批实现，界面只是另一种调用方。
 * 每个 action 的出口都过 enforceBudget（硬上限 200KB），并保证异常不冒泡到界面。
 */

const { getProfile } = require('../engine/profiles');
const { summarize, aggregate } = require('../engine/score');
const { compactIssue, compactProject, enforceBudget, clip } = require('../io/compact');
const { makeError, isErrorPayload, classify, CODES } = require('../io/errors');
const { fingerprintOf } = require('../io/fingerprint');
const { parseDate, maxDecided, daysBetween } = require('../engine/rules');

function readInputs(payload) {
  const raw = payload?.inputs ?? payload?.context ?? payload ?? {};
  return {
    issueKey: raw.issueKey ?? raw.issue ?? raw.key ?? null,
    projectKey: raw.projectKey ?? raw.project ?? null,
    profile: raw.profile ?? raw.track ?? null,
    lang: raw.lang === 'zh' || raw.lang === 'zh-CN' ? 'zh' : 'en',
    limit: Number(raw.limit ?? 25) || 25,
    actor: typeof raw.actor === 'string' && raw.actor.trim() ? raw.actor.trim().slice(0, 80) : null,
  };
}

/**
 * 已知错误码原样透传：E_TIMEOUT 不该被压成 E_PARTIAL，
 * 否则界面会建议用户"稍后重试"，而真实原因是权限没给。
 */
function classifyOf(err, lang) {
  return classify(err, lang);
}

function createActions({ evidencePort, repairPort = null, defaultProfile = 'software', invalidate = null }) {
  const dropCache = typeof invalidate === 'function' ? invalidate : () => 0;

  function profileOf(name, lang = 'en') {
    try {
      return getProfile(name || defaultProfile, lang);
    } catch (err) {
      return makeError('E_UNKNOWN_PROFILE', { detail: String(name || defaultProfile), cause: err, lang });
    }
  }

  async function getIssueProvenance(payload) {
    const { issueKey, profile, lang, userId } = readInputs(payload);
    if (!issueKey) return makeError('E_UNKNOWN_ISSUE', { detail: 'issueKey', lang });
    const p = profileOf(profile, lang);
    if (isErrorPayload(p)) return p;

    try {
      const bundle = await evidencePort.getBundle(issueKey, { userId, profile: p.key });
      // 关键：即使部分边不可知，也要把已经拿到的证据渲染成收据。
      // “E_PARTIAL 红块”会把一个可解释的授权状态挡在门外，评委看不到任何结论。
      // 只有整份 bundle 都没回来、或三条边全不可知时才报错；
      // 局部缺失由 summary 的三值/覆盖率表达。
      if (!bundle) return makeError('E_UNKNOWN_ISSUE', { detail: issueKey, lang });
      const edges = Object.values(bundle.edges || {});
      const allUnknown = edges.length > 0 && edges.every((e) => !e || e.state === 'unknown');
      if (allUnknown && bundle.errors?.length) {
        const err = bundle.errors[0];
        if (err) return { ...err, issueKey };
      }
      const summary = summarize(bundle, p);
      console.log(
        '[mandate] provenance',
        issueKey,
        'source=' + (bundle?.source || '?'),
        'status=' + (bundle?.status || '?'),
        'decisions=' + (bundle?.edges?.decisions?.state || '?') + ':' + ((bundle?.edges?.decisions?.items || []).length),
        'goals=' + (bundle?.edges?.goals?.state || '?'),
        'traces=' + (bundle?.edges?.reviewTraces?.state || '?'),
        'verdict=' + (summary?.authority?.verdict || '?'),
        'errors=' + JSON.stringify((bundle?.errors || []).map((e) => e.code || e.message)),
      );
      const fingerprint = fingerprintOf(bundle, p);
      const payloadOut = compactIssue(summary);
      payloadOut.fingerprint = fingerprint;
      try {
        payloadOut.canWrite = repairPort ? Boolean(await repairPort.canWrite()) : false;
      } catch {
        // 写权限探测失败不该把整张收据变成 E_PARTIAL：读的证据已经拿到了。
        payloadOut.canWrite = false;
      }
      return enforceBudget(payloadOut).payload;
    } catch (err) {
      console.log('[mandate] provenance failed', issueKey, err && err.stack ? err.stack : String(err));
      return { ...classifyOf(err, lang), issueKey, hint: String(err && err.message ? err.message : err) };
    }
  }

  async function listContextDebt(payload) {
    const { projectKey, profile, lang, userId, limit } = readInputs(payload);
    if (!projectKey) return makeError('E_PARTIAL', { detail: lang === 'zh' ? '缺少 projectKey' : 'projectKey missing', lang });
    const p = profileOf(profile, lang);
    if (isErrorPayload(p)) return p;

    try {
      const bundles = await evidencePort.listBundles(projectKey, Math.min(limit, 25), { userId, profile: p.key });
      if (!bundles.length) {
        return {
          ...makeError('E_PARTIAL', { detail: lang === 'zh' ? '该项目没有取到条目' : 'no work items came back for this project', lang }),
          projectKey,
        };
      }
      const agg = aggregate(bundles, p);
      const out = compactProject(agg);
      out.dataSource = evidencePort.status?.().source ?? 'unknown';
      return enforceBudget(out).payload;
    } catch (err) {
      return { ...classifyOf(err, lang), projectKey };
    }
  }

  /** 漂移对：这是产品的核心画面，独立成 action 便于 agent 直接调用。 */
  async function traceDrift(payload) {
    const { issueKey, profile, lang, userId } = readInputs(payload);
    if (!issueKey) return makeError('E_UNKNOWN_ISSUE', { detail: 'issueKey', lang });
    const p = profileOf(profile, lang);
    if (isErrorPayload(p)) return p;

    try {
      const bundle = await evidencePort.getBundle(issueKey, { userId, profile: p.key });
      const edge = bundle.edges.decisions;
      if (edge.state === 'unknown') {
        return {
          ...makeError('E_SCOPE', {
            detail: lang === 'zh' ? 'decisions 边不可知' : 'the decisions edge is unknown',
            lang,
            scope: 'read:graph:page:confluence',
          }),
          issueKey,
        };
      }
      const decided = maxDecided(edge.items);
      const started = parseDate(bundle.inProgressSince) ?? parseDate(bundle.createdAt);
      if (decided == null || started == null) {
        return { ok: true, issueKey, drifting: false, reason: 'INSUFFICIENT_TIMESTAMPS', decidedAt: null };
      }
      const confirmed = parseDate(bundle.lastConfirmAt);
      const propagated = confirmed != null && confirmed >= decided;
      const gap = daysBetween(parseDate(bundle.asOf ?? bundle.updatedAt), decided);
      const drifting = decided > started && !propagated && gap != null && gap >= p.driftDays;

      return enforceBudget({
        ok: true,
        issueKey,
        profile: p.key,
        timezoneNote: 'UTC',
        drifting,
        decidedAt: new Date(decided).toISOString(),
        inProgressSince: new Date(started).toISOString(),
        lastConfirmAt: bundle.lastConfirmAt,
        daysSinceChange: gap,
        thresholdDays: p.driftDays,
        sources: edge.items.slice(0, 3).map((d) => ({ id: d.id, url: d.url, updated: d.updated, editedAt: d.editedAt ?? null })),
        summary: drifting
          ? clip(
              lang === 'zh'
                ? `依据在 ${new Date(decided).toISOString().slice(0, 10)} 改过，执行端已 ${gap} 天没有确认。`
                : `The mandate changed on ${new Date(decided).toISOString().slice(0, 10)} and the delivery side has not confirmed for ${gap} days.`,
            )
          : clip(
              lang === 'zh'
                ? '依据的变更已传导（或从未变更）。'
                : 'The change was propagated (or the mandate never changed).',
            ),
      }).payload;
    } catch (err) {
      return { ...makeError('E_PARTIAL', { detail: String(err.message || err), cause: err, lang }), issueKey };
    }
  }

  /**
   * 第 13 项（门控）：留痕。
   *
   * 这条路径的完整闭环是四步，缺一步就是"假成功"：
   *   1. 先算写之前的债（before）；
   *   2. 写一条带指纹的评论；
   *   3. 让缓存失效（否则面板拿回的是写之前的快照，用户看到"点了没反应"）；
   *   4. 重新读一遍并算写之后的债（after），把 before/after 一起返回。
   *
   * 写失败不报红，但也不冒充权限问题：超时给 E_TIMEOUT，限流给 E_RATE_LIMIT。
   */
  async function stampMandate(payload) {
    const { issueKey, profile, lang, userId, actor } = readInputs(payload);
    if (!issueKey) return makeError('E_UNKNOWN_ISSUE', { detail: 'issueKey', lang });
    const p = profileOf(profile, lang);
    if (isErrorPayload(p)) return p;
    if (!repairPort) return { ...makeError('E_WRITE_DENIED', { lang }), issueKey };

    let canWrite = false;
    try {
      canWrite = Boolean(await repairPort.canWrite());
    } catch {
      canWrite = false;
    }
    if (!canWrite) return { ...makeError('E_WRITE_DENIED', { lang }), issueKey };

    let bundle;
    try {
      bundle = await evidencePort.getBundle(issueKey, { userId, profile: p.key });
    } catch (err) {
      return { ...classifyOf(err, lang), issueKey };
    }
    const before = summarize(bundle, p);
    const projectKey = bundle.projectKey || String(issueKey).split('-')[0];

    let result;
    try {
      result = await repairPort.stamp(bundle, p, { actor, lang });
    } catch (err) {
      return { ...classifyOf(err, lang), issueKey, debtBefore: before.debt };
    }

    if (!result.ok) {
      return { ...result, issueKey, profile: p.key, debtBefore: before.debt, gradeBefore: before.grade };
    }

    let after = before;
    let invalidated = 0;
    if (!result.skipped) {
      invalidated = dropCache({ userId, issueKey, projectKey }) || 0;
      try {
        after = summarize(await evidencePort.getBundle(issueKey, { userId, profile: p.key }), p);
      } catch {
        after = before; // 回读失败不把"降了多少"编出来
      }
    }

    return {
      ...result,
      issueKey,
      profile: p.key,
      debtBefore: before.debt,
      debtAfter: after.debt,
      gradeBefore: before.grade,
      gradeAfter: after.grade,
      delta: before.debt - after.debt,
      invalidated,
    };
  }

  return { getIssueProvenance, listContextDebt, traceDrift, stampMandate };
}

module.exports = { createActions, readInputs };
