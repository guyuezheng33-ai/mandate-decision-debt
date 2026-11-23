'use strict';

/**
 * 证据指纹：把一条工作的证据状态压成一个稳定短串。
 * 两个用途：
 *   1) 留痕幂等——同一指纹不写第二条评论；
 *   2) 判断"依据是否变过"——重扫时指纹相同就不必再打扰人。
 */

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * 指纹只覆盖"结论所依赖的事实"，不覆盖 UI 文案，也不覆盖 lastConfirmAt。
 *
 * 不含 lastConfirmAt 是刻意的：留痕本身会改变 lastConfirmAt，如果把它算进指纹，
 * 第一次写完指纹就变了 → 第二次点击被当成"新证据" → 写出第二条评论。
 * 幂等性依赖"指纹描述被复核的对象，而不是复核的结果"。
 */
function fingerprintOf(bundle, profile) {
  const material = {
    issueKey: bundle.issueKey,
    profile: profile?.key ?? null,
    decisions: (bundle.edges?.decisions?.items || []).map((d) => `${d.id}@${d.updated || ''}`).sort(),
    goals: (bundle.edges?.goals?.items || []).map((g) => `${g.id}#${g.status}`).sort(),
    inProgressSince: bundle.inProgressSince,
    reopenedCount: bundle.reopenedCount || 0,
  };
  return `dd-${fnv1a(stableStringify(material))}`;
}

module.exports = { stableStringify, fnv1a, fingerprintOf };
