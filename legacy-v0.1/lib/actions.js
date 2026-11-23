'use strict';

const { normalizeContext } = require('./normalize');
const { evaluate } = require('./rules');
const { summarize, aggregate } = require('./score');
const { compactIssue, compactProject, byteSize } = require('./compact');

const MAX_PAYLOAD_BYTES = 900_000;

/** Rovo action 的 payload 有两种形状，这里都兼容：直接给字段，或包在 inputs 里。 */
function pickArgs(payload) {
  if (!payload || typeof payload !== 'object') return {};
  return payload.inputs && typeof payload.inputs === 'object' ? payload.inputs : payload;
}

function safeMsg(err) {
  return String((err && err.message) || err || 'unknown error').slice(0, 300);
}

/**
 * 三个 action 的实现，与传输层无关：
 * - 本地 CLI 传 fixture 读取器进来
 * - Forge 传 TWG + Jira REST 的读取器进来
 * 所以同一套行为在两种环境下可验证地一致。
 *
 * @param {{getContext: Function, listProjectContexts: Function}} deps
 */
function createActions(deps) {
  if (typeof deps.getContext !== 'function') throw new TypeError('createActions: getContext is required');

  return {
    /** 为什么这项工作存在：决策链 + 命中规则。 */
    async getIssueProvenance(payload) {
      const args = pickArgs(payload);
      const issueKey = String(args.issueKey ?? '').trim().toUpperCase();
      if (!issueKey) return { ok: false, error: 'issueKey is required' };
      try {
        const raw = await deps.getContext(issueKey);
        const ctx = normalizeContext(raw);
        const result = compactIssue(summarize(ctx, evaluate(ctx)), Number(args.flagLimit) || 6);
        return byteSize(result) <= MAX_PAYLOAD_BYTES ? result : { ...result, flags: [], truncated: true };
      } catch (err) {
        return { ok: false, error: safeMsg(err), issueKey };
      }
    },

    /** 项目级决策债清单：谁最该先补依据。 */
    async listContextDebt(payload) {
      const args = pickArgs(payload);
      const projectKey = String(args.projectKey ?? '').trim().toUpperCase();
      if (!projectKey) return { ok: false, error: 'projectKey is required' };
      const limit = Math.min(25, Math.max(1, Number(args.limit) || 10));
      try {
        const contexts = await deps.listProjectContexts(projectKey);
        if (!contexts || !contexts.length) {
          return { ok: true, projectKey, itemCount: 0, health: 100, grade: 'healthy', items: [] };
        }
        const agg = aggregate(contexts.map(normalizeContext));
        const result = compactProject(agg, limit);
        return byteSize(result) <= MAX_PAYLOAD_BYTES ? result : { ...result, items: [] , truncated: true };
      } catch (err) {
        return { ok: false, error: safeMsg(err), projectKey };
      }
    },

    /** 单条 flag 展开：证据、影响、建议动作。 */
    async explainFlag(payload) {
      const args = pickArgs(payload);
      const issueKey = String(args.issueKey ?? '').trim().toUpperCase();
      const ruleId = String(args.ruleId ?? '').trim().toUpperCase();
      if (!issueKey || !ruleId) return { ok: false, error: 'issueKey and ruleId are required' };
      try {
        const ctx = normalizeContext(await deps.getContext(issueKey));
        const flag = evaluate(ctx).find((f) => f.ruleId === ruleId);
        if (!flag) return { ok: true, issueKey, ruleId, found: false, message: `该工作项没有命中 ${ruleId}。` };
        return {
          ok: true,
          issueKey,
          ruleId,
          found: true,
          kind: flag.kind,
          severity: flag.severity,
          title: flag.title,
          detail: flag.detail,
          evidence: flag.evidence,
          suggest: flag.suggest,
        };
      } catch (err) {
        return { ok: false, error: safeMsg(err), issueKey, ruleId };
      }
    },
  };
}

module.exports = { createActions, pickArgs };
