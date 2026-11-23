'use strict';

/**
 * 四个入口是否给出同一个判决。
 *
 * 面板、resolver、Rovo agent、MCP 的入参形状各不相同（见 `src/agent/handlers.js`），
 * 但它们是同一台引擎的四个门。任何一天有人"顺手在某个入口里补一段计算"，
 * 四个入口就会开始各说各话 —— 这正是本产品立身之本的反面。
 *
 * 这里用同一个假 Jira 客户端，从四个入口各调一次，要求 debt / grade / criteria 完全一致。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolve, buildActions } = require('../src/index');
const handlers = require('../src/agent/handlers');

const ISSUE = {
  key: 'S-1',
  fields: {
    summary: 'One-click archive for inactive projects',
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    project: { key: 'S' },
    created: '2026-01-10T00:00:00.000Z',
    updated: '2026-11-01T00:00:00.000Z',
    statuscategorychangedate: '2026-01-20T00:00:00.000Z',
  },
};

function fakeJira(overrides = {}) {
  return {
    getIssue: async () => ISSUE,
    getIssueLinks: async () => [
      {
        globalId: 'g1',
        title: 'Archive policy',
        url: 'https://example.atlassian.net/wiki/spaces/S/pages/1',
      },
    ],
    getComments: async () => [],
    searchIssues: async () => ['S-1', 'S-2'],
    ...overrides,
  };
}

const CTX = { accountId: 'acc-1', scopes: ['read:jira-work'], jira: fakeJira() };

function comparable(payload) {
  return {
    debt: payload.debt,
    grade: payload.grade,
    flags: (payload.flags || []).map((f) => `${f.p}:${f.w ?? f.weight}`).sort(),
    criteria: (payload.criteria || []).map((c) => `${c.p}:${c.state}:${c.w}`),
  };
}

test('同一条工作项：面板 / resolver / agent / MCP 四个入口的判决完全一致', async () => {
  // 1) resolver：Forge 运行时里的形状（payload.functionKey + context）
  const viaResolver = await resolve({
    payload: { functionKey: 'getIssueProvenance', issueKey: 'S-1' },
    context: CTX,
  });

  // 2) 面板：自定义 UI 直接调 action 的形状
  const viaPanel = await buildActions(CTX).getIssueProvenance({
    inputs: { issueKey: 'S-1', userId: CTX.accountId },
  });

  // 3) Rovo agent：action 的扁平 payload + 第二参数 context
  const viaAgent = await handlers.getIssueProvenance({ issueKey: 'S-1' }, CTX);

  // 4) MCP：同样是扁平 payload，但上下文被嵌在 payload.context 里
  //    （真机上 context 还会带 product client；没有 client 时会退回 asUser REST，
  //     那条路径在单测里没有 Forge 运行时，所以这里显式给一个假 client）
  const viaMcp = await handlers.getIssueProvenance(
    { issueKey: 'S-1', context: { accountId: CTX.accountId, jira: fakeJira() } },
    undefined,
  );

  for (const [name, out] of [
    ['resolver', viaResolver],
    ['panel', viaPanel],
    ['agent', viaAgent],
    ['mcp', viaMcp],
  ]) {
    assert.equal(out.ok, true, `${name}: 应成功，实际 ${out.code}`);
  }

  const base = comparable(viaResolver);
  assert.equal(typeof base.debt, 'number');
  for (const [name, out] of [
    ['panel', viaPanel],
    ['agent', viaAgent],
    ['mcp', viaMcp],
  ]) {
    assert.deepEqual(comparable(out), base, `${name} 与 resolver 的判决不一致`);
  }
});

test('项目页与 agent 的项目视角给出同一个聚合，且编译器不替界面选语言', async () => {
  const viaResolver = await resolve({
    payload: { functionKey: 'listContextDebt', projectKey: 'S', limit: 2 },
    context: CTX,
  });
  const viaAgent = await handlers.listContextDebt({ projectKey: 'S', limit: 2 }, CTX);
  assert.equal(viaResolver.ok, true);
  assert.equal(viaAgent.ok, true);
  assert.equal(viaResolver.debt, viaAgent.debt);
  assert.deepEqual(viaResolver.disclosure, viaAgent.disclosure);
  assert.deepEqual(
    (viaResolver.items || []).map((i) => [i.issueKey, i.debt]),
    (viaAgent.items || []).map((i) => [i.issueKey, i.debt]),
  );
  // 界面文案属于 copy.json，payload 里不该出现整句中文
  assert.ok(!JSON.stringify(viaResolver).includes('这次交付'), 'payload 里出现了界面句子');
});

test('模型伪造 accountId 不会改变缓存分区（身份只认平台给的 context）', async () => {
  const inputs = handlers.toInputs({ issueKey: 'S-1', userId: 'spoofed' }, { accountId: 'real-1' });
  assert.equal(inputs.userId, 'real-1');
  assert.equal(inputs.issueKey, 'S-1');
});

test('四个入口的错误都以数据形式返回，不抛异常', async () => {
  const broken = { accountId: 'acc-1', scopes: [], jira: fakeJira({ getIssue: async () => { throw Object.assign(new Error('403'), { code: 'E_SCOPE' }); } }) };
  const viaResolver = await resolve({ payload: { functionKey: 'getIssueProvenance', issueKey: 'S-2' }, context: broken });
  const viaAgent = await handlers.getIssueProvenance({ issueKey: 'S-2' }, broken);
  for (const out of [viaResolver, viaAgent]) {
    assert.equal(out.ok, false);
    assert.equal(typeof out.code, 'string');
    assert.ok(out.message || out.title, '错误必须带一句给人看的话');
  }
});
