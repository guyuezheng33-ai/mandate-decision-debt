'use strict';

/**
 * 错误码：界面上永不出现 "Something went wrong"。
 * 每个码都带"用户能做什么"，因为评委站点上的 scope 差异是必然发生的。
 *
 * 双语是必需的：评审看英文界面，本地核对看中文。所以每条都写 en / zh 两版，
 * `makeError` 按 lang 取证，另外把另一版也带回去（UI 可即时切换语言而不用重算）。
 */

const CODES = {
  E_SCOPE: {
    retriable: false,
    zh: '缺少授权：{detail}',
    en: 'Permission not granted: {detail}',
    hintZh: '请站点管理员授予 {scope} 后重试；当前先按只读降级模式显示。',
    hintEn: 'Ask a site admin to grant {scope}, then reload. Until then the app stays in read-only degraded mode.',
  },
  E_TIMEOUT: {
    retriable: true,
    zh: '深度依据链暂时取不到（超时）',
    en: 'The deep evidence chain did not answer in time',
    hintZh: '已保留快照层信息；直接点开原文即可继续判断。',
    hintEn: 'Snapshot-level data is still shown; open the source page directly to keep going.',
  },
  E_RATE_LIMIT: {
    retriable: true,
    zh: '接口限流，本次结果不完整',
    en: 'Rate limited — this result is incomplete',
    hintZh: '已自动重试一次；仍失败时先看快照层，稍后再点"重新计算"。',
    hintEn: 'One automatic retry already ran. Use the snapshot layer and press Recompute shortly.',
  },
  E_SERVER: {
    retriable: true,
    zh: '平台侧返回临时错误',
    en: 'The platform returned a temporary error',
    hintZh: '已自动重试一次；这类错误不代表你的数据有问题。',
    hintEn: 'One automatic retry already ran. This does not mean your data is wrong.',
  },
  E_PARTIAL: {
    retriable: true,
    zh: '只拿到部分依据链',
    en: 'Only part of the evidence chain came back',
    hintZh: '未能确认的条目已标记为"不可知"，不会据此报问题。',
    hintEn: 'Unconfirmed items are marked unknown; no finding is raised from them.',
  },
  E_PARSE: {
    retriable: false,
    zh: '依据不可解析（页面可能已归档或被移动）',
    en: 'The mandate cannot be parsed (page archived or moved)',
    hintZh: '这不等于"从来没有依据"；请打开原文确认，或补建一份新的依据页。',
    hintEn: 'This does not mean there never was a mandate. Open the page, or create a new one.',
  },
  E_WRITE_DENIED: {
    retriable: false,
    zh: '没有写入权限',
    en: 'No write permission',
    hintZh: '只读模式：仍可查看与复制结论，留痕按钮已隐藏。',
    hintEn: 'Read-only mode: findings can still be read and copied; the trace button is hidden.',
  },
  E_WRITE_UNVERIFIED: {
    retriable: false,
    zh: '留痕写了，但读不回来（无法确认已生效）',
    en: 'The trace was written but could not be read back',
    hintZh: '可能是评论权限或索引延迟；请到该工作项的评论里确认是否存在以 {detail} 开头的记录，不要重复点击。',
    hintEn: 'A comment permission or search-index delay can cause this. Check the issue comments for a record starting with {detail}; do not press the button again.',
  },
  E_UNKNOWN_ISSUE: {
    retriable: false,
    zh: '找不到这项工作',
    en: 'Work item not found',
    hintZh: '请确认工作项 key 是否正确。',
    hintEn: 'Check that the issue key is correct.',
  },
  E_UNKNOWN_PROFILE: {
    retriable: false,
    zh: '未知口径：{detail}',
    en: 'Unknown lens: {detail}',
    hintZh: '可用口径为 software / launch / portfolio，切换后重新计算即可。',
    hintEn: 'Available lenses are software / launch / portfolio. Pick one and recompute.',
  },
};

const FILL = (tpl, vars) =>
  String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? `{${k}}` : String(vars[k])));

function makeError(code, { detail = '', scope = '', cause = null, lang = 'en' } = {}) {
  const meta = CODES[code] || {
    retriable: false,
    zh: '未知错误：{detail}',
    en: 'Unknown error: {detail}',
    hintZh: '',
    hintEn: '',
  };
  const vars = { detail: detail || code, scope: scope || (lang === 'zh' ? '所需 scope' : 'the required scope') };
  const zh = { message: FILL(meta.zh, vars), hint: FILL(meta.hintZh, vars) };
  const en = { message: FILL(meta.en, vars), hint: FILL(meta.hintEn, vars) };
  const active = lang === 'zh' ? zh : en;
  return {
    ok: false,
    code,
    retriable: Boolean(meta.retriable),
    message: active.message,
    hint: active.hint,
    messageZh: zh.message,
    hintZh: zh.hint,
    messageEn: en.message,
    hintEn: en.hint,
    detail: detail || null,
    cause: cause ? String(cause.message || cause) : null,
  };
}

function isErrorPayload(value) {
  return Boolean(value) && typeof value === 'object' && value.ok === false && typeof value.code === 'string';
}

/** 把来源不明的错误映射成可展示的错误码。 */
function classify(err, lang = 'en') {
  const known = err && typeof err.code === 'string' && CODES[err.code] ? err.code : null;
  if (known) return makeError(known, { detail: String(err.message || known), cause: err, lang });

  const status = err && (err.status ?? err.statusCode);
  if (status === 429) return makeError('E_RATE_LIMIT', { detail: 'HTTP 429', cause: err, lang });
  if (status >= 500 && status < 600) return makeError('E_SERVER', { detail: `HTTP ${status}`, cause: err, lang });

  const text = String((err && (err.message || err)) || '');
  if (/scope|permission|forbidden|403/i.test(text)) return makeError('E_SCOPE', { detail: text, cause: err, lang });
  if (/timeout|timed out|ETIMEDOUT|EAI_AGAIN/i.test(text)) return makeError('E_TIMEOUT', { detail: text, cause: err, lang });
  if (/parse|malformed|invalid json/i.test(text)) return makeError('E_PARSE', { detail: text, cause: err, lang });
  return makeError('E_PARTIAL', { detail: text, cause: err, lang });
}

module.exports = { CODES, makeError, isErrorPayload, classify, FILL };
