'use strict';

/**
 * 把 fixture 跑出来的真实 payload 落成一个静态 JSON，给本地 UI 预览用。
 * 目的：让 src/ui（真正上架的界面）能在浏览器里被看见、被截图，
 * 而不是只能到 Jira 里才看得见。
 *
 *   node preview/emit.js   → preview/dev/payloads.json
 *
 * 注意：这个 JSON 里是**合成数据**，所以它必须留在 preview/ 下。
 * 如果放进 resources 指向的 src/ui/，它会被打包进上架包 —— 评审在包里看到
 * 一份虚构的 Jira 站点数据，是最难解释的那种"看起来像作弊"。
 */

const fs = require('node:fs');
const path = require('node:path');
const { createFixturePort } = require('../src/ports/evidence.fixture');
const { summarize } = require('../src/engine/score');
const { compactIssue, compactProject } = require('../src/io/compact');
const { aggregate } = require('../src/engine/score');
const { PROFILES, getProfile } = require('../src/engine/profiles');
const { bundlesFromSeed } = require('../tools/seed-bundles');

const FIXTURE_DIR = path.join(__dirname, '..', 'src', 'fixtures');
const OUT = path.join(__dirname, 'dev', 'payloads.json');
const KEYS = ['kan3', 'kan7', 'kan9', 'kan20', 'kan11'];
const LANGS = ['en', 'zh'];

const port = createFixturePort({ dir: FIXTURE_DIR });
const out = {};

for (const key of KEYS) {
  const bundle = port.getBundle(key);
  out[key] = {};
  for (const lang of LANGS) {
    out[key][lang] = {};
    for (const name of Object.keys(PROFILES)) {
      const payload = compactIssue(summarize(bundle, getProfile(name, lang)));
      out[key][lang][name] = Object.assign({ ok: true }, payload);
    }
  }
}

/**
 * 降级态要能看见：主端口没授权、REST 顶上时，面板会长出一行 "degraded twg→rest"。
 * 这是评审最可能真实遇到的场景（试用站点往往没给 graph scope），所以它必须在预览里有一张。
 */
for (const lang of LANGS) {
  const bundle = port.getBundle('kan3');
  const degraded = {
    ...bundle,
    source: 'rest',
    edges: {
      ...bundle.edges,
      goals: { state: 'unknown', items: [], reason: 'degraded:E_SCOPE' },
      reviewTraces: { state: 'unknown', items: [], reason: 'degraded:E_SCOPE' },
    },
    degraded: { from: 'twg', to: 'rest', reason: 'E_SCOPE', blindEdges: ['goals', 'reviewTraces'] },
  };
  out.degraded = out.degraded || {};
  out.degraded[lang] = { software: Object.assign({ ok: true }, compactIssue(summarize(degraded, getProfile('software', lang)))) };
}

/**
 * 项目页也要能看见：jira:projectPage 用的是同一份 payload 形状（compactProject），
 * 只是入口从 issue 换成 project。没有这张，项目页就只能到真站点上才知道长什么样。
 */
for (const lang of LANGS) {
  const bundles = port.listBundles('KAN');
  // 预览里的扫描预算是**如实**的：这一页五条就是项目全部，没有下一页，也没撞上限；
  // 唯一要念的免责是"扫描不读复核痕迹"。真正撞上限的样本在下面 projectrest 那张。
  bundles.scan = { source: 'rest', requested: 5, fetched: bundles.length, cap: 8, capped: false, hasMore: false, confirmLookup: 'not-read' };
  out.project = out.project || {};
  out.project[lang] = {};
  for (const name of Object.keys(PROFILES)) {
    const agg = aggregate(bundles, getProfile(name, lang));
    out.project[lang][name] = { ok: true, ...compactProject(agg) };
  }
}

/**
 * REST 降级扫描的同一页：只拿得到依据页时，每一行都有一半判据不可知。
 * 这张样本存在的理由很硬——它证明"部分可知的分数"在界面上不是 0，而是一个带 † 的数。
 */
for (const lang of LANGS) {
  const bundles = port.listBundles('KAN');
  for (const b of bundles) {
    b.edges = {
      ...b.edges,
      goals: { state: 'unknown', items: [], reason: 'degraded:E_SCOPE' },
      reviewTraces: { state: 'unknown', items: [], reason: 'degraded:E_SCOPE' },
    };
  }
  // 这一页是"只翻到第一页"的样子：项目里有 25 条，只拿回 5 条，站点还说后面还有。
  // 三句披露必须同时在场——拿了几条、条目不等全、复核痕迹没读。
  bundles.scan = {
    source: 'rest',
    requested: 25,
    fetched: bundles.length,
    cap: 8,
    capped: false,
    hasMore: true,
    confirmLookup: 'not-read',
    degraded: true,
  };
  out.projectrest = out.projectrest || {};
  out.projectrest[lang] = {};
  for (const name of Object.keys(PROFILES)) {
    const agg = aggregate(bundles, getProfile(name, lang));
    out.projectrest[lang][name] = { ok: true, ...compactProject(agg) };
  }
}

/**
 * 第三张项目页：**21 条构造样本**（data-inbox 的 seed-21，已作为 test fixture 入库）。
 *
 * 为什么它必须存在：KAN 的 5 条 fixture 是"手写的五个故事"，干净得像教科书；
 * 而 seed-21 是"四类问题各 ≥3 条 + 4 条干净"的混合分布，能拍到真实项目页最难的那件事——
 * 均分不高、但 17/21 条都有命中，界面上必须同时说"14"和"17 of 21 flagged"，
 * 否则一个 81% 条目有缺口的项目会被读成"健康"。
 *
 * 数据是 tier=S（受控仿真），所以这一页只活在 preview/ 里，永远不会进上架包。
 */
for (const lang of LANGS) {
  const seedPath = path.join(__dirname, '..', 'test', 'fixtures', 'inbox', 'seed-21.csv');
  const bundles = bundlesFromSeed(seedPath);
  // 这 21 条是从语料里整包读进来的，不是分页扫到的一页：没有下一页，也没撞上限。
  // 但 `confirm_event_dates` 这一列语料本身就没有，所以"复核后的确认没读"必须照样念出来。
  bundles.scan = {
    source: 'seed',
    requested: bundles.length,
    fetched: bundles.length,
    cap: 50,
    capped: false,
    hasMore: false,
    degraded: false,
  };
  out.seed = out.seed || {};
  out.seed[lang] = {};
  for (const name of Object.keys(PROFILES)) {
    const agg = aggregate(bundles, getProfile(name, lang));
    out.seed[lang][name] = { ok: true, ...compactProject(agg, { maxItems: 6 }) };
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
process.stdout.write(`written: ${OUT}\n`);

