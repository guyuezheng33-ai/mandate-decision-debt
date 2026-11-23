'use strict';

/**
 * 选择集不是"越全越好"：extended 里的 lastModified / author / contributors / Goal.status
 * 只在部分 schema 版本上存在。被 schema 拒绝时退 basic 继续出分；
 * 但 403 重试多少次都是 403 —— 拿"少取几个字段"当权限问题的解药，只会把错误藏起来。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGraphClient } = require('../src/ports/graph.client');

function api(responses) {
  const calls = [];
  return {
    calls,
    asUser: () => ({
      requestTeamworkGraph: async (gql, vars) => {
        calls.push({ gql, vars });
        const next = responses[Math.min(calls.length - 1, responses.length - 1)];
        if (typeof next === 'function') return next(gql, vars);
        return next;
      },
    }),
  };
}

const OK = {
  data: {
    customQuery: {
      edges: [
        {
          node: {
            columns: [
              { key: 'issue', value: { nodes: [{ id: 'DEL-101', data: { __typename: 'JiraIssue', title: 'x' } }] } },
            ],
          },
        },
      ],
    },
  },
};

const SCHEMA_ERR = {
  errors: [{ message: "Cannot query field 'lastModified' on type 'ConfluencePage'.", extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }],
};

test('extended 被 schema 拒绝 → 自动退 basic，结果里写明退回', async () => {
  const fake = api([SCHEMA_ERR, OK]);
  const client = createGraphClient({ bundleKey: 'QK', api: fake, fields: 'extended' });
  const out = await client.query({ type: 'bundle', issueKey: 'DEL-101' });
  assert.equal(fake.calls.length, 2);
  assert.match(fake.calls[0].gql, /lastModified/, '第一次必须真的试过 extended');
  assert.ok(!/lastModified/.test(fake.calls[1].gql), '第二次必须是 basic 选择集');
  assert.equal(out.fields, 'basic');
  assert.equal(out.fieldsFallback, true);
  assert.equal(out.issue.key, 'DEL-101');
});

test('403 不许触发选择集降级：那是权限问题，不是字段问题', async () => {
  const fake = api([
    { errors: [{ message: 'not allowed', extensions: { code: 'E_SCOPE', scope: 'read:graph:page:confluence', statusCode: 403 } }] },
    OK,
  ]);
  const client = createGraphClient({ bundleKey: 'QK', api: fake, fields: 'extended' });
  await assert.rejects(
    () => client.query({ type: 'bundle', issueKey: 'DEL-101' }),
    (err) => {
      assert.equal(err.code, 'E_SCOPE');
      assert.equal(err.scope, 'read:graph:page:confluence');
      return true;
    }
  );
  assert.equal(fake.calls.length, 1, '403 之后再发一次只会浪费预算');
});

test('basic 自己失败时不重试（没有更低的选择集可退）', async () => {
  const fake = api([SCHEMA_ERR, OK]);
  const client = createGraphClient({ bundleKey: 'QK', api: fake, fields: 'basic' });
  await assert.rejects(() => client.query({ type: 'bundle', issueKey: 'DEL-101' }));
  assert.equal(fake.calls.length, 1);
});
