'use strict';

/**
 * 入口层的断言：Forge handler 的形状对了，面板/agent/MCP 才叫得到东西。
 * 这一层最容易在"本地能跑、上站就 404"的缝里出事，所以单独测。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { handler, ACTIONS } = require('../src/index');

function ctx({ denyLinks = false } = {}) {
  return {
    scopes: [],
    jira: {
      getIssue: async () => ({ key: 'KAN-3', fields: { summary: 's', status: { name: 'In Review' } } }),
      // 读能力不按 scopes 门控：平台没授权时，请求本身会 403。这里模拟那个 403。
      getIssueLinks: async () => {
        if (denyLinks) throw Object.assign(new Error('403 Forbidden: missing scope'), { code: 'E_SCOPE' });
        return [];
      },
    },
  };
}

test('handler 是函数，且四个 action 都已定义', () => {
  assert.equal(typeof handler, 'function');
  assert.deepEqual(ACTIONS, ['getIssueProvenance', 'listContextDebt', 'traceDrift', 'stampMandate']);
});

test('按 Forge 的 call.functionKey 形状分派', async () => {
  const r = await handler({ call: { functionKey: 'traceDrift', payload: { issueKey: 'KAN-3' } }, context: ctx({ denyLinks: true }) });
  assert.equal(typeof r, 'object');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_SCOPE');
});

test('未知 action 会抛错，而不是静默返回空', async () => {
  await assert.rejects(
    handler({ call: { functionKey: 'notAnAction', payload: {} }, context: ctx() }),
    /no definition/i,
  );
});

test('lang 解析：只认 zh，其余一律 en', () => {
  const { readInputs } = require('../src/resolvers/action');
  assert.equal(readInputs({ lang: 'zh' }).lang, 'zh');
  assert.equal(readInputs({ lang: 'zh-CN' }).lang, 'zh');
  assert.equal(readInputs({ lang: 'fr' }).lang, 'en');
  assert.equal(readInputs({}).lang, 'en');
});

// ---- 错误码必须原样透传：把超时压成 E_PARTIAL，界面就会让用户"稍后重试"，而真实原因是没给 scope ----
const { createActions } = require('../src/resolvers/action');
const { makeError } = require('../src/io/errors');

function portThatThrows(code) {
  const err = new Error(`simulated ${code}`);
  err.code = code;
  return {
    getBundle: async () => { throw err; },
    listBundles: async () => { throw err; },
    status: () => ({ source: 'twg' }),
  };
}

test('端口抛 E_TIMEOUT 时，action 返回的仍是 E_TIMEOUT', async () => {
  const a = createActions({ evidencePort: portThatThrows('E_TIMEOUT') });
  const r = await a.getIssueProvenance({ issueKey: 'KAN-3' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_TIMEOUT');
  assert.equal(r.retriable, true);
  assert.equal(/[\u4e00-\u9fff]/.test(r.messageEn), false);
  assert.ok(r.hintEn.length > 0);
});

test('端口抛 E_SCOPE 时，action 不重试也不改写错误码', async () => {
  const a = createActions({ evidencePort: portThatThrows('E_SCOPE') });
  const r = await a.listContextDebt({ projectKey: 'KAN' });
  assert.equal(r.code, 'E_SCOPE');
  assert.equal(r.retriable, false);
  assert.equal(r.projectKey, 'KAN');
});

test('未知口径返回 E_UNKNOWN_PROFILE，且提示里列出可用口径', async () => {
  const a = createActions({ evidencePort: portThatThrows('E_TIMEOUT') });
  const r = await a.getIssueProvenance({ issueKey: 'KAN-3', profile: 'compliance' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_UNKNOWN_PROFILE');
  assert.match(r.hintEn, /software/i);
  assert.equal(r.messageEn.includes('compliance'), true);
});

test('两种语言给的是两句话，不是同一句', async () => {
  const a = createActions({ evidencePort: portThatThrows('E_TIMEOUT') });
  const r = await a.getIssueProvenance({ issueKey: 'KAN-3', lang: 'zh' });
  assert.match(r.message, /超时|没有按时|取不到/);
  assert.notEqual(r.messageZh, r.messageEn);
  assert.ok(r.hintZh.length > 0);
});

test('makeError 对未知码给出兜底，而不是 undefined', () => {
  const e = makeError('E_SOMETHING_NEW', { detail: 'x' });
  assert.equal(e.code, 'E_SOMETHING_NEW');
  assert.ok(e.message.includes('x'));
});
