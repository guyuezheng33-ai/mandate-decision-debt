'use strict';

/**
 * 链接安全：依据页的 URL 来自图数据（也就是别人的页面内容），不能直接进 href。
 *
 * `javascript:`、`data:`、`vbscript:` 之类的 scheme 一旦被点，等于在 Jira 里执行脚本。
 * 这里只放行 http/https，其余一律返回 null，界面上降级成纯文本。
 */

const ALLOWED = /^https?:\/\//i;

function safeUrl(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (!ALLOWED.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

module.exports = { safeUrl };
