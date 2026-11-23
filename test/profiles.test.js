'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PROFILES, PRIMITIVES, getProfile, validateProfile, validateProfileSet } = require('../src/engine/profiles');
const { evaluate } = require('../src/engine/rules');
const { fixture } = require('./helpers');

test('每套口径自身合法：权重完整为正、英雄判据在册、阈值齐全', () => {
  for (const key of Object.keys(PROFILES)) {
    assert.deepEqual(validateProfile(getProfile(key)), [], `profile ${key} invalid`);
  }
});

test('三套口径的英雄判据互不相同（否则就是换皮）', () => {
  assert.deepEqual(validateProfileSet(), []);
  const heroes = new Set(Object.values(PROFILES).map((p) => p.hero));
  assert.equal(heroes.size, 3);
});

test('同一份样本在发布口径下命中 P3、在软件交付口径下不命中', () => {
  const b = fixture('kan20');
  const soft = evaluate(b, getProfile('software')).flags.map((f) => f.primitive);
  const launch = evaluate(b, getProfile('launch')).flags.map((f) => f.primitive);
  assert.equal(soft.includes('P3'), false);
  assert.equal(launch.includes('P3'), true);
});

test('权重表覆盖全部六个原语，且阈值确实不同', () => {
  for (const p of Object.values(PROFILES)) {
    for (const prim of PRIMITIVES) assert.ok(p.weights[prim] > 0, `${p.key} missing ${prim}`);
  }
  assert.notEqual(PROFILES.software.driftDays, PROFILES.portfolio.driftDays);
  assert.notEqual(PROFILES.software.conflictSimilarity, PROFILES.launch.conflictSimilarity);
});
