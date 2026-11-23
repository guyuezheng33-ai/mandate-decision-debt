'use strict';

/**
 * 超时与重试：这两个东西不做，最后都会变成"偶发红灯"。
 *
 * 为什么必须显式做：
 * - 图查询没有超时，一次卡住会把面板拖到 30 秒，用户以为坏了；
 * - 平台偶尔 429/5xx，一次失败就变成 unknown，覆盖率就白掉了；
 * - 但重试不能重试到底：重试 3 次 × 20 秒 = 60 秒，比不重试更糟。
 *
 * 约定：超时抛 `E_TIMEOUT`，重试用尽抛原始错误（保留 code 供 classify 用）。
 */

const { makeError } = require('./errors');

const TRANSIENT = new Set(['E_TIMEOUT', 'E_RATE_LIMIT', 'E_SERVER']);

function timeoutErr(ms) {
  const err = new Error(`timed out after ${ms}ms`);
  err.code = 'E_TIMEOUT';
  return err;
}

/** 给任意 promise 套一个上限；到点就 reject，且不会留下未处理的 rejection。 */
function withTimeout(promise, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutErr(ms)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * 有限重试。`shouldRetry` 默认只认瞬时错误码，业务错误（scope 不足、解析失败）不重试。
 */
async function retry(fn, { attempts = 2, shouldRetry = isTransient, onRetry = null } = {}) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn(i);
    } catch (err) {
      last = err;
      if (i === attempts - 1 || !shouldRetry(err)) throw err;
      if (typeof onRetry === 'function') onRetry(err, i + 1);
    }
  }
  throw last;
}

function isTransient(err) {
  if (!err) return false;
  if (TRANSIENT.has(err.code)) return true;
  const status = err.status ?? err.statusCode;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(String(err.message || ''));
}

/** 组合：超时 + 重试。端口层只调这一个。 */
async function guarded(fn, { timeoutMs, attempts = 2, onRetry = null } = {}) {
  return retry(() => withTimeout(Promise.resolve().then(fn), timeoutMs), { attempts, onRetry });
}

module.exports = { withTimeout, retry, guarded, isTransient, timeoutErr, makeError };
