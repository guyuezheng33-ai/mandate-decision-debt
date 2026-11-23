'use strict';

/**
 * 界面文案是要被评委看见的东西，所以它也要有断言：
 * 1) 每新增一个错误码，两种语言都必须有对应文案 —— 否则界面上会出现英文码 + 空说明；
 * 2) 英文文案里不许混中文（曾经出现过 helpers 把中文括注进 en 的情况）；
 * 3) 中文文案不许是英文原文照搬；
 * 4) 口径按钮必须和 engine 里的三套口径严格一一对应。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const COPY = require('../src/ui/src/copy.json');
const { CODES } = require('../src/io/errors');
const { PROFILES } = require('../src/engine/profiles');

const CJK = /[\u4e00-\u9fff]/;
const LANGS = ['en', 'zh'];
const UI_CODES = Object.keys(CODES);

function stringsOf(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') return stringsOf(v, key);
    return [[key, String(v)]];
  });
}

test('两种语言都有同一套顶层键', () => {
  const en = Object.keys(COPY.en).sort();
  const zh = Object.keys(COPY.zh).sort();
  assert.deepEqual(en, zh);
});

test('每个错误码都有中英文标题与说明，且没有多余的死文案', () => {
  for (const lang of LANGS) {
    const states = COPY[lang].errorStates;
    for (const code of UI_CODES) {
      const entry = states[code];
      assert.ok(entry, `${lang} 缺少 ${code} 的文案`);
      assert.ok(entry.title && entry.title.trim().length > 0, `${lang} ${code} 缺标题`);
      assert.ok(entry.body && entry.body.trim().length > 0, `${lang} ${code} 缺说明`);
    }
    assert.ok(states.default, `${lang} 缺 default 兜底文案`);
  }
  const known = new Set([...UI_CODES, 'default']);
  for (const lang of LANGS) {
    for (const code of Object.keys(COPY[lang].errorStates)) {
      assert.ok(known.has(code), `${lang} 里的 ${code} 不是真实错误码`);
    }
  }
});

test('英文文案里不出现中日韩字符', () => {
  for (const [key, value] of stringsOf(COPY.en)) {
    assert.equal(CJK.test(value), false, `en 的 ${key} 混入了非英文字符：${value}`);
  }
});

test('中文文案确实翻译过，不是英文原文照搬', () => {
  const enFlat = Object.fromEntries(stringsOf(COPY.en));
  for (const [key, value] of stringsOf(COPY.zh)) {
    if (value.length < 2) continue;
    assert.notEqual(value, enFlat[key], `zh 的 ${key} 与英文完全一致，疑似漏翻`);
  }
});

test('三套口径按钮与 engine 的口径一一对应', () => {
  const engineKeys = Object.keys(PROFILES).sort();
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(COPY[lang].panels).sort(), engineKeys, `${lang} 的口径按钮与 engine 不一致`);
    for (const k of engineKeys) assert.ok(COPY[lang].panels[k].length > 0);
  }
});

test('copy.json 里没有残留的模板占位符', () => {
  for (const lang of LANGS) {
    for (const [key, value] of stringsOf(COPY[lang])) {
      assert.equal(/REPLACE|\{\{|\$\{/.test(value), false, `${lang} 的 ${key} 还留着占位符`);
    }
  }
});

/**
 * 项目页的三句披露（有缺口 / 撞上限 / 还有下一页 / 扫描不读复核）是"这页是不是全部"的
 * 唯一说明。少一句，界面就在暗示一个它没看过的项目是干净的；占位符对不上，界面会印出
 * 字面 `{n}` 或在缺参数时印 `undefined`。所以这里同时钉"键存在"和"占位符一致"。
 */
test('项目页披露文案齐全，且两种语言的占位符一一对应', () => {
  const keys = ['projectFlagged', 'coverageGap', 'scanCapped', 'scanMore', 'confirmNotRead'];
  const holes = (s) => (s.match(/\{[a-z]+\}/g) || []).sort();
  for (const lang of LANGS) {
    for (const k of keys) {
      const v = COPY[lang].panels && COPY[lang].panels[k] !== undefined ? COPY[lang].panels[k] : COPY[lang][k];
      assert.ok(v, `${lang} 缺少披露文案 ${k}`);
      assert.ok(String(v).trim().length > 0, `${lang} 的 ${k} 是空的`);
    }
  }
  for (const k of keys) {
    const en = COPY.en.panels[k] !== undefined ? COPY.en.panels[k] : COPY.en[k];
    const zh = COPY.zh.panels[k] !== undefined ? COPY.zh.panels[k] : COPY.zh[k];
    assert.deepEqual(holes(en), holes(zh), `${k} 的中英文占位符不一致：en=${holes(en)} zh=${holes(zh)}`);
  }
});
