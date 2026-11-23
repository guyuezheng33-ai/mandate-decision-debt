'use strict';

/**
 * 三套口径：同一引擎，不同权重 / 阈值 / 称谓 / 英雄判据。
 *
 * 真广与假广的分界线：
 * 每套口径必须有且只有一个"英雄判据"，且三者各不相同（P2 / P3 / P4）；
 * 至少有一个阈值不同；"依据"的称谓不同（决定证据该指向哪类文档）。
 */

const PROFILES = {
  software: {
    key: 'software',
    name: 'Software delivery',
    question: {
      en: 'Which decision does this work rest on — and is it still valid?',
      zh: '这次交付依据的是哪个决定，它还成立吗？',
    },
    hero: 'P2',
    evidenceTerm: { en: 'decision record', zh: '决策记录' },
    weights: { P1: 25, P2: 20, P3: 15, P4: 18, P5: 10, P6: 8 },
    driftDays: 14,
    conflictSimilarity: 0.5,
    goalStaleDays: null,
  },
  launch: {
    key: 'launch',
    name: 'Launch & marketing',
    question: {
      en: 'Is the story we tell outside the same story we agreed inside?',
      zh: '对外讲的故事和内部定的故事，是不是同一个？',
    },
    hero: 'P3',
    evidenceTerm: { en: 'positioning brief', zh: 'brief / positioning' },
    weights: { P1: 25, P2: 20, P3: 22, P4: 12, P5: 10, P6: 8 },
    driftDays: 14,
    conflictSimilarity: 0.35,
    goalStaleDays: null,
  },
  portfolio: {
    key: 'portfolio',
    name: 'Portfolio governance',
    question: {
      en: 'Is the work in flight still serving a goal that is on the books?',
      zh: '在跑的工作，是否仍服务于在册目标？',
    },
    hero: 'P4',
    evidenceTerm: { en: 'mandate page', zh: '立项页' },
    weights: { P1: 25, P2: 14, P3: 15, P4: 26, P5: 10, P6: 8 },
    driftDays: 30,
    conflictSimilarity: 0.5,
    goalStaleDays: 180,
  },
};

const PRIMITIVES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

/** 取语言下的一个字段：兼容纯字符串（演化期的 profile 可能是旧的写法）。 */
function pick(value, lang) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[lang] || value.en || value.zh || '';
}

function getProfile(key, lang = 'en') {
  const p = PROFILES[key];
  if (!p) throw new Error(`unknown profile: ${key}`);
  return Object.assign({}, p, {
    lang,
    term: pick(p.evidenceTerm, lang),
    q: pick(p.question, lang),
  });
}

/** 配置自检：权重完整、为正、英雄判据在册、阈值齐全。测试里对三套口径各跑一次。 */
function validateProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object') return ['profile is not an object'];
  if (!profile.key) errors.push('missing key');
  if (!profile.hero) errors.push('missing hero');
  if (!PRIMITIVES.includes(profile.hero)) errors.push(`hero not a primitive: ${profile.hero}`);
  for (const p of PRIMITIVES) {
    const w = profile.weights?.[p];
    if (typeof w !== 'number') errors.push(`weight missing: ${p}`);
    else if (!(w > 0)) errors.push(`weight not positive: ${p}`);
  }
  if (typeof profile.driftDays !== 'number' || profile.driftDays <= 0) errors.push('bad driftDays');
  if (typeof profile.conflictSimilarity !== 'number') errors.push('bad conflictSimilarity');
  if (!profile.evidenceTerm) errors.push('missing evidenceTerm');
  if (!pick(profile.question, 'en')) errors.push('missing question.en');
  if (!pick(profile.evidenceTerm, 'en')) errors.push('missing evidenceTerm.en');
  return errors;
}

/** 三套口径整体自检：英雄判据互不相同（否则就是换皮）。 */
function validateProfileSet(set = PROFILES) {
  const errors = [];
  const heroes = [];
  for (const [key, p] of Object.entries(set)) {
    const own = validateProfile(p);
    if (own.length) errors.push(`${key}: ${own.join('; ')}`);
    heroes.push(p.hero);
  }
  const unique = new Set(heroes);
  if (unique.size !== heroes.length) errors.push(`heroes are not distinct: ${heroes.join(',')}`);
  return errors;
}

module.exports = { PROFILES, PRIMITIVES, getProfile, validateProfile, validateProfileSet };
