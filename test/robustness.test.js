'use strict';

/**
 * 两个容易被忽略的稳定性维度：
 *
 * 1. **畸形数据**：图与 REST 都会返回半个对象、错类型的数组、null 日期。评分层如果因为一个
 *    坏字段抛异常，面板在真站点上就是一块白屏。这里用固定种子的随机变异跑 200 轮，
 *    只要求三条：不抛、分数落在 0–100、覆盖率自洽。
 * 2. **时区**：P2 是"两个日期差多少天"，如果实现依赖本地时区，同一个站点在 UTC+8 与 UTC-8
 *    会差一天，评委看到的数字就和我写的不一样。这里用子进程在三个时区各跑一遍同一份 fixture，
 *    要求 debt / grade / flags 完全一致。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { summarize } = require('../src/engine/score');
const { getProfile, PROFILES } = require('../src/engine/profiles');
const { normalizeBundle } = require('../src/engine/normalize');
const { createFixturePort } = require('../src/ports/evidence.fixture');

const FIXTURE_DIR = path.join(__dirname, '..', 'src', 'fixtures');
const KEYS = ['kan3', 'kan7', 'kan9', 'kan20', 'kan11'];

// 固定种子：失败必须可复现，不能"这次没崩"
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const GARBAGE = [null, undefined, 0, -1, 'x', '', [], {}, NaN, true, 1e9];

function mutate(value, rand, depth = 0) {
  if (depth > 3) return value;
  if (Array.isArray(value)) {
    if (rand() < 0.3) return GARBAGE[Math.floor(rand() * GARBAGE.length)];
    return value.map((v) => (rand() < 0.4 ? mutate(v, rand, depth + 1) : v));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = rand() < 0.35 ? GARBAGE[Math.floor(rand() * GARBAGE.length)] : mutate(v, rand, depth + 1);
    }
    return out;
  }
  return rand() < 0.5 ? GARBAGE[Math.floor(rand() * GARBAGE.length)] : value;
}

test('200 轮畸形数据：不抛异常，分数与覆盖率自洽', () => {
  const port = createFixturePort({ dir: FIXTURE_DIR });
  const base = Object.fromEntries(KEYS.map((k) => [k, port.getBundle(k)]));
  const rand = rng(20261120);

  for (let i = 0; i < 200; i += 1) {
    const key = KEYS[i % KEYS.length];
    const mutated = mutate(JSON.parse(JSON.stringify(base[key])), rand);
    // issueKey 是身份而不是数据：变异它等于换了一条工作项，不该在这里测。
    // 它缺失时 normalizeBundle 会明确抛错，这一点单独断言（见下一个用例）。
    mutated.issueKey = base[key].issueKey;
    const bundle = normalizeBundle(mutated);
    for (const lens of Object.keys(PROFILES)) {
      const s = summarize(bundle, getProfile(lens));
      assert.ok(Number.isInteger(s.debt) && s.debt >= 0 && s.debt <= 100, `第 ${i} 轮 ${lens} 分数越界：${s.debt}`);
      assert.ok(['critical', 'at_risk', 'watch', 'healthy', 'unknown'].includes(s.grade), `第 ${i} 轮 grade 非法：${s.grade}`);
      assert.ok(s.coverage.known <= s.coverage.total, '覆盖率 known 不应超过 total');
      for (const f of s.flags) assert.ok(f.weight > 0, '判据权重必须为正');
    }
  }
});

test('缺 issueKey 时是一个明确的编程错误，而不是一条 0 分的假数据', () => {
  assert.throws(() => normalizeBundle({ edges: {} }), /missing issue key/i);
});

const TZ_SCRIPT = `
const path = require('node:path');
const { createFixturePort } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'ports', 'evidence.fixture.js'))});
const { summarize } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'engine', 'score.js'))});
const { getProfile } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'engine', 'profiles.js'))});
const port = createFixturePort({ dir: ${JSON.stringify(FIXTURE_DIR)} });
const rows = ['kan3','kan7','kan9','kan20'].map((k) => {
  const b = port.getBundle(k);
  return ['software','launch','portfolio'].map((l) => {
    const s = summarize(b, getProfile(l));
    return [s.debt, s.grade, s.flags.map((f) => f.primitive).join('+')].join('/');
  }).join(' | ');
});
process.stdout.write(rows.join('\\n'));
`;

test('同一份数据在 UTC+8 / UTC / UTC-8 得到完全相同的分数', () => {
  const run = (tz) =>
    execFileSync(process.execPath, ['-e', TZ_SCRIPT], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  const a = run('Asia/Singapore');
  const b = run('UTC');
  const c = run('America/Los_Angeles');
  assert.equal(a, b, 'UTC+8 与 UTC 结果不一致');
  assert.equal(a, c, 'UTC+8 与 UTC-8 结果不一致');
});
