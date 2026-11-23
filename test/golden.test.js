'use strict';

/**
 * 黄金快照：把五条 fixture × 三套口径的分数与命中判据钉死。
 *
 * 为什么值得一条测试：判据的权重和阈值是这个产品的全部卖点，
 * 任何一次"顺手调一下"都会让视频里说过的数字对不上。
 * 这条测试的作用不是防 bug，是防**自己**在最后两周改主意。
 *
 * 如果确实要改口径：改完跑 `node -e "...golden..."` 重生成 test/golden.json，
 * 并在提交说明里写清为什么改。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const golden = require('./golden.json');
const { createFixturePort } = require('../src/ports/evidence.fixture');
const { summarize } = require('../src/engine/score');
const { getProfile, PROFILES } = require('../src/engine/profiles');

const port = createFixturePort({ dir: path.join(__dirname, '..', 'src', 'fixtures') });

test('五条样本 × 三套口径的分数与命中判据不得漂移', () => {
  for (const [key, lenses] of Object.entries(golden)) {
    const bundle = port.getBundle(key);
    for (const lens of Object.keys(PROFILES)) {
      const s = summarize(bundle, getProfile(lens, 'en'));
      const want = lenses[lens];
      assert.equal(s.debt, want.debt, `${key}/${lens} 分数变了`);
      assert.equal(s.grade, want.grade, `${key}/${lens} 等级变了`);
      assert.deepEqual(
        (s.flags || []).map((f) => f.primitive),
        want.flags,
        `${key}/${lens} 命中判据变了`,
      );
      assert.equal(s.coverage.known, want.coverage.known, `${key}/${lens} 覆盖数变了`);
      assert.equal(s.coverage.total, want.coverage.total, `${key}/${lens} 覆盖分母变了`);
    }
  }
});

test('英雄判据在三套口径里互不相同（真广的最小条件）', () => {
  const heroes = Object.values(PROFILES).map((p) => p.hero);
  assert.equal(new Set(heroes).size, heroes.length);
  assert.deepEqual(heroes, ['P2', 'P3', 'P4']);
});
