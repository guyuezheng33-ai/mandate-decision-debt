'use strict';

/**
 * Rovo action / MCP tool 的入口。
 *
 * 它们与面板调的是同一批 action，但**入参形状不同**：
 *   面板：   invoke('getIssueProvenance', { issueKey, profile, lang })
 *   action： payload = { issueKey, profile, lang, context: {...jira 上下文} }, context 作为第二参数
 *
 * 如果不做这一层，"同一条契约、三种表面"就只是文档里的一句话：agent 与 MCP 会拿到
 * 一个没有 issueKey 的 payload，然后在真站点上安静地失败。
 *
 * 身份一律取 context.accountId（不是 payload）：payload 来自模型抽取，可能被幻觉污染，
 * 而 accountId 决定缓存分区与可见性边界，绝不能由调用方指定。
 */

const { buildActions } = require('../index');

function pickFirst(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
  return null;
}

function toInputs(payload, context) {
  const p = payload || {};
  const ctx = context || p.context || {};
  const jira = ctx.jira || p.context?.jira || {};
  const locale = pickFirst(ctx.locale, p.context?.locale, p.locale) || '';
  const isZh = String(locale).toLowerCase().startsWith('zh');

  return {
    issueKey: pickFirst(p.issueKey, jira.issueKey, p.context?.issueKey),
    projectKey: pickFirst(p.projectKey, jira.projectKey, p.context?.projectKey),
    profile: pickFirst(p.profile, p.track),
    lang: pickFirst(p.lang, isZh ? 'zh' : null),
    limit: p.limit,
    // 复核人署名：模型可以说"是我"，但只有平台给的显示名才写进评论
    actor: pickFirst(p.actor, ctx.actorName, ctx.accountName),
    // 身份只认平台给的 accountId
    userId: pickFirst(ctx.accountId, p.context?.accountId),
  };
}

function makeHandler(name) {
  return async function handler(payload, context) {
    const ctx = context || payload?.context || {};
    const actions = buildActions(ctx);
    const fn = actions[name];
    if (typeof fn !== 'function') throw new Error(`no action named ${name}`);
    return fn({ inputs: toInputs(payload, ctx) });
  };
}

module.exports = {
  toInputs,
  getIssueProvenance: makeHandler('getIssueProvenance'),
  listContextDebt: makeHandler('listContextDebt'),
  traceDrift: makeHandler('traceDrift'),
  stampMandate: makeHandler('stampMandate'),
};
