'use strict';

/**
 * 三值证据：有 / 无 / 不可知。
 *
 * 为什么这是整个产品最重要的一条：
 * 图查询返回空，可能是"真没有依据"，也可能是"scope 没给 / 超时 / 被截断 / 页面解析不了"。
 * 如果一律当成"没有"，就会在评审的站点上刷出一片假红——假红一次，全盘信任就没了。
 *
 * 规则：只有 absent 能触发"无依据"这类断言；unknown 一律抑制，并在界面上如实披露。
 */

const { STATES } = require('./normalize');

const EDGE_NAMES = ['decisions', 'goals', 'reviewTraces'];

/**
 * 一条边是否"可以据此下结论"。
 * @returns {{known:boolean, state:string, reason:string|null}}
 */
function edgeKnowledge(bundle, name) {
  const edge = bundle.edges?.[name];
  if (!edge) return { known: false, state: STATES.UNKNOWN, reason: `${name}:missing` };
  if (edge.state === STATES.PRESENT) return { known: true, state: edge.state, reason: null };
  if (edge.state === STATES.ABSENT) return { known: true, state: edge.state, reason: null };
  return { known: false, state: STATES.UNKNOWN, reason: `${name}:${edge.reason || 'unknown'}` };
}

/**
 * 一条规则所需的边里，有哪些还不可知。
 * @param {object} bundle
 * @param {string[]} requires
 */
function missingFor(bundle, requires) {
  return requires.filter((n) => !edgeKnowledge(bundle, n).known);
}

/**
 * 覆盖率：这条工作项的证据里，有多少条必需边是可知的。
 * 用于概览页那句"本页覆盖 18 / 25 项，7 项不可知"——没有这句话，分数会在全不可知时变成满分。
 */
function coverageOf(bundle, requires = EDGE_NAMES) {
  const total = requires.length || 1;
  const known = requires.filter((n) => edgeKnowledge(bundle, n).known).length;
  return { known, total, ratio: known / total };
}

/** 是否整条工作项都"不可知"（一条可信内容都没有）。 */
function entirelyUnknown(bundle) {
  return EDGE_NAMES.every((n) => !edgeKnowledge(bundle, n).known);
}

module.exports = { EDGE_NAMES, edgeKnowledge, missingFor, coverageOf, entirelyUnknown };
