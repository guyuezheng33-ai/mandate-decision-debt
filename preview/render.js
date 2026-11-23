'use strict';

/**
 * 面板预览生成器：把真实的 compactIssue payload 渲染成一张可打开的页面。
 *
 * 为什么要有它：
 * 1. 评审看的不是代码，是"3 秒能不能看懂"；这件事必须先在自己屏幕上验证一次。
 * 2. 视频需要稳定的画面，预览页比临时开站点更可控。
 * 3. 三口径差异在这张页面上一眼可见——这是那 20 秒旁证镜头的依据。
 *
 *   node preview/render.js        → preview/panel.html（英文界面，评审与录屏用这个）
 *   node preview/render.js --zh   → 中文界面
 */

const fs = require('node:fs');
const path = require('node:path');
const { createFixturePort } = require('../src/ports/evidence.fixture');
const { summarize } = require('../src/engine/score');
const { compactIssue } = require('../src/io/compact');
const { PROFILES, getProfile } = require('../src/engine/profiles');

const FIXTURE_DIR = path.join(__dirname, '..', 'src', 'fixtures');
const OUT = path.join(__dirname, 'panel.html');
const KEYS = ['kan3', 'kan7', 'kan9', 'kan20', 'kan11'];
const LANG = process.argv.includes('--zh') ? 'zh' : 'en';

const port = createFixturePort({ dir: FIXTURE_DIR });

const payloads = {};
for (const key of KEYS) {
  const bundle = port.getBundle(key);
  payloads[key] = {};
  for (const name of Object.keys(PROFILES)) {
    payloads[key][name] = compactIssue(summarize(bundle, getProfile(name, LANG)));
  }
}

const UI = {
  en: {
    title: 'Mandate · Decision Debt',
    note: 'Fixtures from src/fixtures — the same samples npm run verify uses. KAN-11 is the "nothing known" sample, kept to show the degraded state.',
    unknown: 'Not known',
    noScore: 'no score',
    coverage: 'Coverage ',
    source: 'source ',
    suppressed: ' criteria suppressed: ',
    emptyUnknown: 'No evidence chain at all — nothing to report, and no score.',
    emptyOk: 'Evidence chain holds: page, goal, change propagated.',
    weight: 'weight ',
    next: 'Next',
    evidence: 'Evidence ',
    cssLang: 'en',
  },
  zh: {
    title: 'Mandate · 决策债',
    note: '数据来自 src/fixtures，与 npm run verify 用的是同一批样本；KAN-11 是"全不可知"样本，用来看降级时的界面。',
    unknown: '不可知',
    noScore: '不 出 分',
    coverage: '覆盖 ',
    source: '来源 ',
    suppressed: ' 条判据被抑制：',
    emptyUnknown: '依据链一条都没拿到——不报问题，也不出分。',
    emptyOk: '能说清依据：有依据页、有目标、变更已传导。',
    weight: '权重 ',
    next: '下一步',
    evidence: '证据 ',
    cssLang: 'zh-CN',
  },
};

const t = UI[LANG];

const html = `<!doctype html>
<html lang="${t.cssLang}">
<meta charset="utf-8" />
<title>${t.title}</title>
<style>
  :root{
    --ink:#172b4d; --sub:#5e6c84; --line:#dfe1e6; --bg:#f4f5f7;
    --high:#de350b; --med:#ff991f; --low:#6b778c; --ok:#00875a; --accent:#0052cc;
  }
  *{box-sizing:border-box}
  body{margin:0;padding:24px 28px;background:var(--bg);color:var(--ink);
    font:14px/1.5 -apple-system,"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif}
  h1{font-size:15px;letter-spacing:.02em;margin:0 0 4px}
  .sub{color:var(--sub);font-size:12px;margin-bottom:16px}
  .switcher{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap}
  .switcher button{border:1px solid var(--line);background:#fff;color:var(--sub);padding:6px 12px;
    border-radius:3px;cursor:pointer;font-size:12px}
  .switcher button.on{border-color:var(--accent);color:var(--accent);font-weight:600;box-shadow:0 0 0 1px var(--accent) inset}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:14px}
  .card{background:#fff;border:1px solid var(--line);border-radius:4px;padding:14px 16px}
  .keyrow{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
  .key{font-weight:700;font-size:13px;color:var(--accent)}
  .title{color:var(--ink);font-size:13px;flex:1}
  .debt{display:flex;align-items:center;gap:10px;margin:10px 0 6px}
  .num{font-size:30px;font-weight:700;line-height:1}
  .num.unk{font-size:16px;color:var(--sub);font-weight:600}
  .bar{flex:1;height:8px;background:#ebecf0;border-radius:4px;overflow:hidden}
  .bar i{display:block;height:100%;background:var(--med)}
  .grade{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--sub)}
  .cov{font-size:11px;color:var(--sub);border-top:1px dashed var(--line);padding-top:8px;margin-top:6px}
  .flag{border-left:3px solid var(--line);padding:8px 0 8px 10px;margin:10px 0 0}
  .flag.high{border-color:var(--high)} .flag.med{border-color:var(--med)} .flag.low{border-color:var(--low)}
  .fhead{display:flex;gap:8px;align-items:center;font-size:12px;font-weight:600}
  .p{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:#fff;background:var(--sub);
    border-radius:2px;padding:1px 5px}
  .flag.high .p{background:var(--high)} .flag.med .p{background:var(--med)}
  .w{color:var(--sub);font-weight:400;font-size:11px}
  .detail{font-size:12.5px;color:var(--ink);margin:5px 0 4px}
  .act{font-size:12px;color:var(--sub)}
  .act b{color:var(--accent);font-weight:600}
  .src{margin-top:4px;font-size:11px}
  .src a{color:var(--accent);text-decoration:none;border-bottom:1px solid rgba(0,82,204,.3)}
  .sup{font-size:11px;color:var(--sub);margin-top:10px}
  .empty{font-size:12.5px;color:var(--ok);margin-top:8px}
  .note{font-size:11px;color:var(--sub);margin-top:14px}
</style>
<h1>${t.title}</h1>
<div class="sub" id="q"></div>
<div class="switcher" id="sw"></div>
<div class="grid" id="grid"></div>
<div class="note">${t.note}</div>
<script>
const DATA = ${JSON.stringify(payloads)};
const PROFILES = ${JSON.stringify(
  Object.fromEntries(Object.entries(PROFILES).map(([k]) => [k, { name: PROFILES[k].name, q: getProfile(k, LANG).q }])),
)};
const T = ${JSON.stringify(t)};
let current = 'software';

function sev(s){ return s === 'high' ? 'high' : s === 'medium' ? 'med' : 'low'; }
function barColor(debt){ return debt >= 61 ? 'var(--high)' : debt >= 36 ? 'var(--med)' : debt > 15 ? '#ffab00' : 'var(--ok)'; }

function render(){
  document.getElementById('q').textContent = PROFILES[current].q;
  const sw = document.getElementById('sw');
  sw.innerHTML = '';
  Object.keys(PROFILES).forEach((k) => {
    const b = document.createElement('button');
    b.textContent = PROFILES[k].name;
    if (k === current) b.className = 'on';
    b.onclick = () => { current = k; render(); };
    sw.appendChild(b);
  });

  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  Object.keys(DATA).forEach((key) => {
    const d = DATA[key][current];
    const card = document.createElement('div');
    card.className = 'card';

    const head = '<div class="keyrow"><span class="key">' + d.issueKey + '</span><span class="title">'
      + (d.summary || '') + '</span></div>';

    let body = '';
    if (d.grade === 'unknown') {
      body = '<div class="debt"><span class="num unk">' + T.unknown + '</span>'
        + '<div class="bar"><i style="width:0"></i></div><span class="grade">' + T.noScore + '</span></div>';
    } else {
      body = '<div class="debt"><span class="num">' + d.debt + '</span>'
        + '<div class="bar"><i style="width:' + Math.min(100, d.debt) + '%;background:' + barColor(d.debt) + '"></i></div>'
        + '<span class="grade">' + d.grade + '</span></div>';
    }

    const cov = '<div class="cov">' + T.coverage + d.coverage.known + '/' + d.coverage.total
      + (d.source ? ' · ' + T.source + d.source : '')
      + (d.suppressed.length ? ' · ' + d.suppressed.length + T.suppressed + d.suppressed.map((s) => s.p).join(',') : '')
      + '</div>';

    let flags = '';
    if (!d.flags.length) {
      flags = '<div class="empty">' + (d.grade === 'unknown' ? T.emptyUnknown : T.emptyOk) + '</div>';
    }
    d.flags.forEach((f) => {
      flags += '<div class="flag ' + sev(f.s) + '">'
        + '<div class="fhead"><span class="p">' + f.p + '</span>' + f.label + '<span class="w">' + T.weight + f.w + '</span></div>'
        + '<div class="detail">' + f.detail + '</div>'
        + '<div class="act"><b>' + T.next + '</b> · ' + f.action + '</div>'
        + ((f.evidence && f.evidence.sources && f.evidence.sources.length)
            ? '<div class="src">' + T.evidence + f.evidence.sources.map((s) => '<a href="' + (s.url || '#') + '" target="_blank">' + (s.title || s.id || s.url) + '</a>').join(' · ') + '</div>'
            : '')
        + '</div>';
    });

    card.innerHTML = head + body + cov + flags;
    grid.appendChild(card);
  });
}
render();
</script>
`;

fs.writeFileSync(OUT, html, 'utf8');
process.stdout.write(`written: ${OUT}  (${KEYS.length} 条 × ${Object.keys(PROFILES).length} 口径, lang=${LANG})\n`);
