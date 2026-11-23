'use strict';

/**
 * 修复端口：把一次"我复核过了"写成一条可审计的评论。
 *
 * 四条硬规则（第 13 项验收门控的就是这四条）：
 *   1. 能力探测先行：没有 write:jira-work 就返回 null 端口，按钮根本不出现；
 *   2. 指纹幂等：同一份证据只写一条，重复点击返回 skipped；
 *   3. 写完必须读回来核实：读不到自己刚写的指纹 = E_WRITE_UNVERIFIED，不谎报成功；
 *   4. 写失败不伪装成"没有权限"：超时是超时，限流是限流，各自有自己的码。
 *
 * 写入不会修改工作项状态，也不会改字段；它只加一条评论，评论本身由读端口
 * （confirm.js）折算成 lastConfirmAt，从而真的让 P2 沉默 —— 写与读是一对，缺一不可。
 */

const { makeError } = require('../io/errors');
const { fingerprintOf } = require('../io/fingerprint');
const { MARKER } = require('../io/marker');
const { guarded } = require('../io/timeout');

const WRITE_TIMEOUT_MS = 6_000;

function writeError(err, lang) {
  const status = err?.status ?? err?.statusCode;
  const text = String(err?.message || err || '');
  if (status === 401 || status === 403) return makeError('E_WRITE_DENIED', { detail: `HTTP ${status}`, cause: err, lang });
  if (status === 429) return makeError('E_RATE_LIMIT', { detail: 'HTTP 429', cause: err, lang });
  if (status >= 500 && status < 600) return makeError('E_SERVER', { detail: `HTTP ${status}`, cause: err, lang });
  if (/scope|permission|forbidden/i.test(text)) return makeError('E_WRITE_DENIED', { detail: text, cause: err, lang });
  if (/timeout|timed out|ETIMEDOUT|EAI_AGAIN/i.test(text)) return makeError('E_TIMEOUT', { detail: text, cause: err, lang });
  return makeError('E_PARTIAL', { detail: text, cause: err, lang });
}

function bodyLines(bundle, profile, fingerprint, extra) {
  const decided = (bundle.edges?.decisions?.items || [])
    .map((d) => d.updated)
    .filter(Boolean)
    .sort()
    .pop();
  const sources = (bundle.edges?.decisions?.items || []).map((d) => d.url || d.id).filter(Boolean);
  return [
    `依据已复核（Mandate · ${profile.name}）`,
    `${MARKER}${fingerprint}`,
    `依据页：${sources.join('、') || '（无）'}`,
    `依据最后更新：${decided ? new Date(decided).toISOString().slice(0, 10) : '未知'}`,
    `复核人：${extra.actor || '（当前用户）'}`,
    `复核时间：${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  ].join('\n');
}

/**
 * @param {object} deps
 * @param {null|{listComments:Function, addComment:Function}} deps.client 由 write.jira 提供
 * @param {string[]} [deps.scopes]
 */
function createRepairPort({ client = null, scopes = [] } = {}) {
  const hasWrite = Array.isArray(scopes) && scopes.includes('write:jira-work');
  const capable = Boolean(
    hasWrite && client && typeof client.listComments === 'function' && typeof client.addComment === 'function',
  );

  return {
    /** 渲染前探一次：不通过就不出现按钮，而不是点了报错。 */
    async canWrite() {
      return capable;
    },

    /**
     * @returns {Promise<{ok:boolean, skipped?:boolean, verified?:boolean, commentId?:string|null,
     *   fingerprint?:string, code?:string}>}
     */
    async stamp(bundle, profile, extra = {}) {
      const lang = extra.lang === 'zh' ? 'zh' : 'en';
      if (!capable) return { ...makeError('E_WRITE_DENIED', { lang }), ok: false };
      if (!bundle?.issueKey) return { ...makeError('E_UNKNOWN_ISSUE', { detail: 'issueKey', lang }), ok: false };

      // 指纹只覆盖"被复核的证据状态"，不含 lastConfirmAt —— 否则写完自己就让指纹变了，
      // 下一次点击会被判成"新证据"，于是重复写第二条。这个坑由 test/write.test.js 钉住。
      const fingerprint = fingerprintOf(bundle, profile);

      let existing;
      try {
        existing = await guarded(() => client.listComments(bundle.issueKey), { timeoutMs: WRITE_TIMEOUT_MS, attempts: 1 });
      } catch (err) {
        return { ...writeError(err, lang), ok: false, fingerprint };
      }

      const hit = (existing || []).find((c) => String(c.body || '').includes(`${MARKER}${fingerprint}`));
      if (hit) {
        return { ok: true, skipped: true, verified: true, commentId: hit.id ?? null, fingerprint };
      }

      let created;
      try {
        // 写只试一次：重试一次 POST 就可能写出两条，重复比失败更难解释。
        created = await guarded(
          () => client.addComment(bundle.issueKey, bodyLines(bundle, profile, fingerprint, extra)),
          { timeoutMs: WRITE_TIMEOUT_MS, attempts: 1 },
        );
      } catch (err) {
        return { ...writeError(err, lang), ok: false, fingerprint };
      }

      // 写完读回：读不到自己刚写的东西，就不能说"已留痕"。
      let after;
      try {
        after = await guarded(() => client.listComments(bundle.issueKey), { timeoutMs: WRITE_TIMEOUT_MS, attempts: 1 });
      } catch {
        return { ok: true, skipped: false, verified: false, commentId: created?.id ?? null, fingerprint, verify: 'unreadable' };
      }
      const seen = (after || []).some((c) => String(c.body || '').includes(`${MARKER}${fingerprint}`));
      if (!seen) {
        return {
          ...makeError('E_WRITE_UNVERIFIED', { detail: `${MARKER}${fingerprint}`, lang }),
          ok: false,
          commentId: created?.id ?? null,
          fingerprint,
        };
      }
      return { ok: true, skipped: false, verified: true, commentId: created?.id ?? null, fingerprint };
    },
  };
}

module.exports = { createRepairPort, bodyLines, writeError, WRITE_TIMEOUT_MS };
