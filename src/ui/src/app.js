import { invoke, view } from '@forge/bridge';
import { safeUrl } from '../../io/safe';

import COPY from './copy.json';

const T = COPY;
const SAMPLE = {
  issueKey: 'KAN-3',
  summary: 'One-click archive for projects inactive over 90 days',
  status: 'In Review',
  debt: 28,
  grade: 'watch',
  authority: {
    state: 'present',
    verdict: 'stale',
    owner: 'acc-1123',
    ownerName: 'Alice Ng',
    title: 'Archive policy: archive anything inactive for 90 days',
    url: 'https://example.atlassian.net/wiki/spaces/KAN/pages/8841',
    updatedAt: '2026-08-14T06:00:00.000Z',
    lastConfirmAt: null,
    daysSinceUpdate: 92,
    daysWithoutConfirm: 92,
    contributors: 1,
    decisionCount: 1,
  },
  coverage: { known: 3, total: 3 },
  suppressed: [],
  flags: [
    {
      p: 'P2',
      label: 'Change not propagated',
      w: 20,
      s: 'high',
      detail:
        'The decision record was edited on 2026-08-14, work started on 2026-06-20, and nobody has confirmed since — 92 days apart.',
      action:
        'Ask the decision record owner to re-confirm, and append "still valid / changed" back to the page so the delivery side has something to point at.',
      evidence: { sources: [{ title: 'Decision record', url: '#' }] },
    },
  ],
};

let lang = 'en';
let lens = 'software';
let issueKey = null;
let projectKey = null;
let siteBase = null;
let state = { loading: true, data: null, error: null };
let isSample = false;
let copyTimer = null;

const ISSUE_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*-[0-9]+$/;
const root = () => document.getElementById('root');
const esc = (s) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function t() {
  return T[lang];
}

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function gradeLabel(g) {
  return (t().gradeNames && t().gradeNames[g]) || g || '';
}

function kindOf(a) {
  if (a && a.kind) return a.kind;
  // 旧 payload 没有 kind：靠 URL 判断，页面是 /wiki/，Jira 授权记录是 /browse/。
  return /\/browse\//.test(String((a && a.url) || '')) ? 'jira' : 'page';
}

function verdictMeta(v) {
  const kind = kindOf(v);
  const map = {
    current: {
      label: t().receiptCurrent,
      headline: t().currentHeadline,
      reason: kind === 'jira' ? t().currentReasonJira : t().currentReason,
      valid: t().validYes,
      tone: 'ok',
    },
    stale: {
      label: t().receiptStale,
      headline: t().staleHeadline,
      reason: (kind === 'jira' ? t().staleReasonJira : t().staleReason).replace('{n}', String(v.daysWithoutConfirm ?? v.daysSinceUpdate ?? '')),
      valid: t().validNo,
      tone: 'high',
    },
    contested: {
      label: t().receiptContested,
      headline: t().contestedHeadline,
      reason: t().contestedReason.replace('{n}', String(v.decisionCount || 2)),
      valid: t().validContested,
      tone: 'med',
    },
    missing: {
      label: t().receiptMissing,
      headline: t().missingHeadline,
      reason: t().missingReason,
      valid: t().validMissing,
      tone: 'high',
    },
    unknown: {
      label: t().receiptUnknown,
      headline: t().unknownHeadline,
      reason: t().unknownReason,
      valid: t().validUnknown,
      tone: 'neutral',
    },
  };
  return map[v.verdict] || map.unknown;
}

function authorityOf(d) {
  if (d && d.authority) return d.authority;
  // 兼容旧 payload：宁可显示 unknown，也不从 flags 编一个人名或日期。
  const hit = (p) => Boolean(d && d.flags && d.flags.some((f) => f.p === p));
  return {
    verdict: d && d.grade === 'unknown' ? 'unknown' : hit('P1') ? 'missing' : 'unknown',
    owner: null,
    ownerName: null,
    title: null,
    url: null,
    updatedAt: null,
    lastConfirmAt: null,
    daysSinceUpdate: null,
    daysWithoutConfirm: null,
    contributors: null,
    decisionCount: null,
  };
}

function whoText(a) {
  if (a.verdict === 'unknown') return `<span class="muted">${esc(t().unknownValue)}</span>`;
  if (a.verdict === 'missing') return `<span class="muted">${esc(t().noOwner)}</span>`;
  if (a.verdict === 'contested') {
    const n = a.contributors ?? a.decisionCount;
    if (n) return esc(t().ownersCount.replace('{n}', String(n)));
  }
  if (a.ownerName) return esc(a.ownerName);
  if (a.owner) return `${esc(a.owner)}<span class="subvalue">${esc(t().ownerId)}</span>`;
  if (a.contributors != null && a.contributors > 0) {
    return `${t().contributors.replace('{n}', String(a.contributors))}<span class="subvalue">${esc(t().ownerFallback)}</span>`;
  }
  return `<span class="muted">${esc(t().ownerFallback)}</span>`;
}

function whereText(a) {
  if (!a.title && a.verdict === 'unknown') return `<span class="muted">${esc(t().unknownValue)}</span>`;
  if (!a.title) return `<span class="muted">${esc(t().noRecord)}</span>`;
  const href = safeUrl(a.url);
  const title = esc(a.title);
  return href
    ? `<a class="record-link" href="${esc(href)}" target="_blank" rel="noreferrer">${title}<span class="arrow">↗</span></a>`
    : `<span>${title}</span>`;
}

function validSubtext(a, v) {
  const verdict = a.verdict;
  if (verdict === 'stale') {
    const days = a.daysWithoutConfirm ?? a.daysSinceUpdate;
    const bits = [];
    if (days != null) bits.push(t().daysSince.replace('{n}', String(days)));
    bits.push(t().neverConfirmed);
    return bits.join(' · ');
  }
  if (verdict === 'current') {
    return a.lastConfirmAt ? t().confirmedOn.replace('{d}', fmtDate(a.lastConfirmAt)) : t().currentReason;
  }
  if (verdict === 'contested') {
    const records = t().recordsCount.replace('{n}', String(a.decisionCount || 2));
    const people = a.contributors != null ? t().contributors.replace('{n}', String(a.contributors)) : t().validUnknown;
    return `${records} · ${people}`;
  }
  if (verdict === 'missing') return t().missingReason;
  return t().unknownReason;
}

function scoreChip(d) {
  if (!d || d.grade === 'unknown' || d.debt == null) {
    return `<div class="scorechip unknown"><span class="score-num">—</span><span class="score-cap">${esc(t().noScore)}</span></div>`;
  }
  // 授权状态优先：一张"0 决策债 / 关注"的卡，和"授权已过期 1703 天"自相矛盾。
  // 过期/缺失/冲突时，右上角改印授权事实本身；判据分退回明细，不抢主结论。
  const a = authorityOf(d);
  if (a.verdict === 'stale') {
    return `<div class="scorechip high">
      <span class="score-num">${esc(a.daysWithoutConfirm ?? a.daysSinceUpdate ?? '—')}</span>
      <span class="score-cap">${esc(t().chipStale)}</span>
      <span class="score-grade">${esc(gradeLabel(d.grade))}</span>
    </div>`;
  }
  if (a.verdict === 'missing') {
    return `<div class="scorechip high">
      <span class="score-num">0</span>
      <span class="score-cap">${esc(t().chipMissing)}</span>
      <span class="score-grade">${esc(gradeLabel(d.grade))}</span>
    </div>`;
  }
  if (a.verdict === 'contested') {
    return `<div class="scorechip med">
      <span class="score-num">${esc(a.decisionCount ?? 2)}</span>
      <span class="score-cap">${esc(t().chipContested)}</span>
      <span class="score-grade">${esc(gradeLabel(d.grade))}</span>
    </div>`;
  }
  if (a.verdict === 'unknown') {
    return `<div class="scorechip unknown">
      <span class="score-num">—</span>
      <span class="score-cap">${esc(t().chipUnknown)}</span>
    </div>`;
  }
  const hue = d.debt >= 36 ? 'high' : d.debt >= 16 ? 'med' : 'ok';
  return `<div class="scorechip ${hue}">
    <span class="score-num">${d.debt}</span>
    <span class="score-cap">${esc(t().score)}</span>
    <span class="score-grade">${esc(gradeLabel(d.grade))}</span>
  </div>`;
}

function receiptBlock(d) {
  if (!d) return '';
  const a = authorityOf(d);
  const v = verdictMeta(a);
  const score = scoreChip(d);
  return `<section class="receipt ${esc(v.tone)}" aria-labelledby="receipt-title">
    <div class="receipt-top">
      <div>
        <div class="eyebrow">${esc(t().receipt)}</div>
        <div id="receipt-title" class="stamp ${esc(v.tone)}">${esc(v.label)}</div>
      </div>
      ${score}
    </div>
    <h2 class="receipt-headline">${esc(v.headline)}</h2>
    <div class="receipt-reason">${esc(v.reason)}</div>
    <dl class="receipt-grid">
      <div class="rcell">
        <dt>${esc(t().who)}</dt>
        <dd>${whoText(a)}</dd>
      </div>
      <div class="rcell">
        <dt>${esc(kindOf(a) === 'jira' ? t().approvedAt : t().when)}</dt>
        <dd>${a.updatedAt ? esc(fmtDate(a.updatedAt)) : `<span class="muted">${esc(a.verdict === 'unknown' ? t().unknownValue : '—')}</span>`}</dd>
      </div>
      <div class="rcell wide">
        <dt>${esc(t().where)}</dt>
        <dd>${whereText(a)}</dd>
      </div>
      <div class="rcell wide valid ${esc(v.tone)}">
        <dt>${esc(t().valid)}</dt>
        <dd><strong>${esc(v.valid)}</strong><span class="subvalue">${esc(validSubtext(a, v))}</span></dd>
      </div>
    </dl>
  </section>`;
}

function topFlags(d) {
  return (d && d.flags ? d.flags : []).slice(0, 2);
}

function whyLine(d) {
  const flags = topFlags(d);
  const a = authorityOf(d);
  if (!flags.length) {
    if (a.verdict === 'missing') return t().missingWhy;
    if (a.verdict === 'contested') return t().contestedWhy;
    if (a.verdict === 'unknown') return t().unknownWhy;
    if (d && d.grade === 'unknown') return t().emptyUnknown;
    if (a.verdict === 'stale') {
      return t().staleWhy.replace('{n}', String(a.daysWithoutConfirm ?? a.daysSinceUpdate ?? ''));
    }
    return t().emptyOk;
  }
  return flags.map((f) => `+${f.w} ${esc(f.label)}`).join(' · ');
}

function issueAction(d) {
  if (!d) return '';
  const flags = topFlags(d);
  const a = authorityOf(d);
  // 授权收据是首屏主结论，下一步必须先跟它对齐：
  // 过期/缺记录/有冲突时，即使六条判据都没命中，也不能写"无需动作"。
  if (a.verdict === 'stale') {
    return t()
      .staleAction.replace('{owner}', a.ownerName || a.owner || t().ownerFallback)
      .replace('{n}', String(a.daysWithoutConfirm ?? a.daysSinceUpdate ?? ''));
  }
  if (a.verdict === 'missing') return t().missingAction;
  if (a.verdict === 'contested') return t().contestedAction;
  const action = a.verdict === 'unknown' ? t().unknownAction : flags.length ? flags[0].action : null;
  const recordHref = safeUrl(a.url);
  const issueHref = siteBase && ISSUE_KEY_RE.test(String(d.issueKey || '')) ? `${siteBase}/browse/${d.issueKey}` : null;
  const whoPlain =
    a.verdict === 'unknown' ? t().unknownValue
    : a.verdict === 'missing' ? t().noOwner
    : a.verdict === 'contested' && (a.contributors ?? a.decisionCount)
      ? t().ownersCount.replace('{n}', String(a.contributors ?? a.decisionCount))
      : a.ownerName || a.owner || t().ownerFallback;
  const wherePlain =
    a.verdict === 'unknown' ? t().unknownValue : a.title || t().noRecord;
  const copyTextValue = [
    `Mandate · ${d.issueKey}`,
    `${d.summary || ''}`,
    `${verdictMeta(a).label}: ${verdictMeta(a).headline}`,
    `${t().who}: ${whoPlain}`,
    `${t().where}: ${wherePlain}`,
    `${kindOf(a) === 'jira' ? t().approvedAt : t().when}: ${a.updatedAt ? fmtDate(a.updatedAt) : '—'}`,
    `${t().valid}: ${verdictMeta(a).valid}`,
    `${t().score}: ${d.debt == null ? '—' : d.debt} (${gradeLabel(d.grade)})`,
    action ? `${t().nextAction}: ${action}` : '',
    isSample ? t().demo : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `<section class="actioncard">
    <div class="eyebrow">${esc(action ? t().nextAction : t().noAction)}</div>
    <p class="actiontext">${action ? esc(action) : esc(t().noActionBody)}</p>
    <div class="actionrow">
      <button type="button" class="primary" data-act="copy" data-copy="${esc(encodeURIComponent(copyTextValue))}">${esc(t().copyNote)}</button>
      ${recordHref ? `<a class="secondary" href="${esc(recordHref)}" target="_blank" rel="noreferrer">${esc(t().openRecord)} ↗</a>` : ''}
      ${issueHref ? `<a class="tertiary" href="${esc(issueHref)}" target="_blank" rel="noreferrer">${esc(t().jiraHistory)}</a>` : ''}
    </div>
    <div class="copy-state" role="status" aria-live="polite"></div>
  </section>`;
}

function checksBlock(d) {
  if (!d || !d.criteria || !d.criteria.length) return '';
  const rows = d.criteria
    .map((c) => {
      const word = c.state === 'hit' ? t().stateHit : c.state === 'unknown' ? t().stateUnknown : t().stateClear;
      const num = c.state === 'hit' ? `+${c.w}` : c.state === 'unknown' ? '·' : '0';
      return `<li class="check ${esc(c.state)}">
        <span class="dot"></span>
        <span class="clabel">${esc(c.label)}</span>
        <span class="cstate">${esc(word)}</span>
        <span class="cw">${esc(num)}</span>
      </li>`;
    })
    .join('');
  return `<details class="checks">
    <summary><span>${esc(t().checks)}</span><span class="whyline">${whyLine(d)}</span><span class="chev">›</span></summary>
    <ul class="checklist">${rows}</ul>
    <p class="checksnote">${esc(t().checksNote)}</p>
  </details>`;
}

function coverageLine(d) {
  if (!d) return '';
  const cov = d.coverage || { known: 0, total: 0 };
  const bits = [`${t().coverageShort} ${cov.known}/${cov.total}`];
  if (d.source) bits.push(`${t().source}${d.source}`);
  if (d.degraded) bits.push(`${t().degradedShort} ${d.degraded.from}→${d.degraded.to}`);
  return bits.join(' · ');
}

function header(d, isProject) {
  const key = isProject ? (d && d.projectKey) || projectKey || 'preview' : (d && d.issueKey) || issueKey || 'preview';
  const summary = d && d.summary ? d.summary : '';
  const status = d && d.status ? d.status : '';
  return `<header class="top">
    <div class="brandrow"><span class="brand">MANDATE</span>${status ? `<span class="statuspill">${esc(status)}</span>` : ''}</div>
    <div class="issuerow"><span class="key">${esc(key)}</span>${summary ? `<h1>${esc(summary)}</h1>` : ''}</div>
  </header>`;
}

function issueBody(d) {
  if (!d) return '';
  return `${receiptBlock(d)}${issueAction(d)}${checksBlock(d)}`;
}

/* ---------- 项目页：同一台引擎，换一个视角 ---------- */

function projectHeader(d) {
  return header(d, true);
}

function projectBlock(d) {
  if (!d) return '';
  if (d.grade === 'unknown') {
    return `<section class="projecthero neutral">
      <div class="eyebrow">${esc(t().receipt)}</div>
      <div class="stamp neutral">${esc(t().receiptUnknown)}</div>
      <h2>${esc(t().unknownHeadline)}</h2>
      <div class="receipt-reason">${esc(t().projectEmpty)}</div>
    </section>`;
  }
  const thin = d.certainty != null && d.certainty < 0.5;
  return `<section class="projecthero">
    <div class="projecthero-top">
      <div><div class="eyebrow">${esc(t().projectAuthority)}</div><h2>${esc(d.debt)} <small>${esc(t().score)}</small></h2></div>
      <div class="stamp ${thin ? 'neutral' : d.grade === 'critical' || d.grade === 'at_risk' ? 'high' : d.grade === 'watch' ? 'med' : 'ok'}">${esc(thin ? t().partialGrade : gradeLabel(d.grade))}</div>
    </div>
    <div class="projecthero-foot">${esc(projectCoverageText(d))}</div>
  </section>`;
}

function projectCoverageText(d) {
  if (!d) return '';
  const gap = d.disclosure
    ? t().coverageGap.replace('{c}', d.disclosure.counted).replace('{total}', d.disclosure.total).replace('{u}', d.disclosure.unknown)
    : `${d.countedCount}/${d.itemCount}`;
  const flagged = d.flaggedCount != null && d.countedCount && d.flaggedShare >= 0.5
    ? t().projectFlagged.replace('{n}', d.flaggedCount).replace('{c}', d.countedCount)
    : '';
  const part = d.certainty != null && d.certainty < 1 && d.partialCount
    ? t().projectPartial.replace('{n}', d.partialCount).replace('{pct}', Math.round(d.certainty * 100))
    : '';
  const degraded = d.degraded ? ` · ${t().degradedPrefix}${d.degraded.from}→${d.degraded.to}` : '';
  return [gap, flagged, part].filter(Boolean).join(' · ') + degraded;
}

function projectRows(d) {
  if (!d) return '';
  if (!d.items || !d.items.length) return `<div class="empty">${esc(t().projectEmpty)}</div>`;
  return `<div class="plist">${d.items
    .map((i) => {
      const unknown = i.grade === 'unknown' || i.debt == null;
      const missing = i.missing && i.missing.length
        ? `${t().notVisible}${i.missing.map((e) => (t().edgeNames && t().edgeNames[e]) || e).join(t().join || ', ')}`
        : t().noFinding;
      const k = String(i.issueKey || '');
      const linked = siteBase && ISSUE_KEY_RE.test(k);
      const keyCell = linked
        ? `<a class="pkey" href="${esc(siteBase + '/browse/' + k)}" target="_blank" rel="noopener">${esc(k)}</a>`
        : `<span class="pkey">${esc(k)}</span>`;
      const gaps = Array.isArray(i.unknownPrims) ? i.unknownPrims : [];
      const partial = Boolean(i.partial && gaps.length);
      const thin = partial && typeof i.certainty === 'number' && i.certainty < 0.5;
      const hover = partial ? ` title="${esc(t().partialHover + gaps.join(', '))}"` : '';
      const debtCell = unknown
        ? `<span class="pdebt">–</span>`
        : `<span class="pdebt${partial ? ' partial' : ''}"${hover}>${i.debt}${partial ? '<span class="dag">†</span>' : ''}</span>`;
      const verdictMap = {
        current: t().validYes,
        stale: t().validNo,
        contested: t().validContested,
        missing: t().validMissing,
        unknown: t().validUnknown,
      };
      const verdict = i.authorityVerdict
        ? `<span class="pverdict ${esc(i.authorityVerdict)}">${esc(verdictMap[i.authorityVerdict] || i.authorityVerdict)}</span>`
        : '';
      const rowLabel = unknown ? missing : thin ? t().partialLabel + gaps.join(' ') : i.label || t().noFinding;
      return `<div class="prow"${partial ? ' data-partial="1"' : ''}>
        ${keyCell}
        ${debtCell}
        <span class="pgrade ${esc(unknown || thin ? 'unknown' : i.grade)}">${esc(unknown ? t().noScore : thin ? t().partialGrade : gradeLabel(i.grade))}</span>
        <span class="plabel">${verdict}${esc(rowLabel)}</span>
      </div>`;
    })
    .join('')}</div>`;
}

function projectLegend(d) {
  const any = d && Array.isArray(d.items) && d.items.some((i) => i && i.partial);
  return any ? `<div class="plegend">${esc(t().partialNote)}</div>` : '';
}

function errorBlock(e) {
  const m = (t().errorStates && (t().errorStates[e.code] || t().errorStates.default)) || { title: t().loadFailed, body: '' };
  return `<div class="err" role="alert">
    <b>${esc(m.title)}</b>
    <div class="errdetail">${esc(m.body)}</div>
    <code>${esc(e.code)}</code>${e.msg ? ` <span class="hint">${esc(e.msg)}</span>` : ''}
  </div>`;
}

function lensSelect() {
  return `<label class="lensselect">${esc(t().viewAs)}
    <select data-lens>${Object.keys(T[lang].panels)
      .map((k) => `<option value="${esc(k)}"${k === lens ? ' selected' : ''}>${esc(t().panels[k])}</option>`)
      .join('')}</select>
  </label>`;
}

function footer(d, isProject) {
  const left = isProject ? '' : coverageLine(d);
  return `<footer class="foot">
    <div class="footmeta">${esc(left)}${isSample ? ` · ${esc(t().demo)}` : ''}</div>
    <div class="foottools"><button type="button" data-act="lang" aria-label="${esc(lang === 'zh' ? 'Switch to English' : '切换到中文')}">${lang === 'zh' ? 'EN' : '中文'}</button>${lensSelect()}<button type="button" data-act="refresh">${esc(t().refresh)}</button></div>
  </footer>`;
}

function render() {
  if (state.loading && !state.data) {
    root().innerHTML = `<div class="boot" role="status">${esc(t().loading)}</div>`;
    return;
  }
  const d = state.data;
  const isProject = Boolean(projectKey) && !issueKey;
  const body = state.error
    ? errorBlock(state.error)
    : isProject
      ? projectBlock(d) + projectRows(d) + projectLegend(d)
      : issueBody(d);
  root().innerHTML = `${header(d, isProject)}${body}${footer(d, isProject)}`;

  const sel = root().querySelector('[data-lens]');
  if (sel) {
    sel.onchange = () => {
      lens = sel.value;
      load();
    };
  }
  const r = root().querySelector('[data-act="refresh"]');
  if (r) r.onclick = () => load();
  const lg = root().querySelector('[data-act="lang"]');
  if (lg)
    lg.onclick = () => {
      lang = lang === 'zh' ? 'en' : 'zh';
      document.documentElement.lang = lang;
      load();
    };
  const c = root().querySelector('[data-act="copy"]');
  if (c) {
    c.onclick = async () => {
      const text = c.getAttribute('data-copy') || '';
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(decodeURIComponent(text));
        else throw new Error('no clipboard');
        c.textContent = t().copied;
        const s = root().querySelector('.copy-state');
        if (s) s.textContent = t().copied;
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(() => render(), 1600);
      } catch {
        const s = root().querySelector('.copy-state');
        if (s) s.textContent = 'Ctrl+C';
      }
    };
  }
}

async function load() {
  state = { loading: true, data: state.data, error: null };
  render();
  if (!issueKey && !projectKey) {
    isSample = true;
    state = { loading: false, data: SAMPLE, error: null };
    render();
    return;
  }
  try {
    const target = issueKey ? 'getIssueProvenance' : 'listContextDebt';
    const payload = issueKey ? { issueKey, profile: lens, lang } : { projectKey, profile: lens, lang, limit: 25 };
    const res = await invoke(target, payload);
    if (!res || !res.ok) {
      state = { loading: false, data: null, error: { code: (res && res.code) || 'E_UNKNOWN_ISSUE', msg: (res && res.hint) || t().loadFailed } };
    } else {
      state = { loading: false, data: res, error: null };
    }
  } catch (err) {
    state = { loading: false, data: null, error: { code: 'E_INVOKE', msg: err && err.message ? err.message : t().loadFailed } };
  }
  render();
}

async function boot() {
  try {
    const ctx = await view.getContext();
    const ext = (ctx && ctx.extension) || {};
    issueKey = (ext.issue && ext.issue.key) || null;
    projectKey = (ext.project && (ext.project.key || ext.project.projectKey)) || ext.projectKey || null;
    const loc = (ctx && (ctx.locale || ext.locale)) || '';
    lang = String(loc).toLowerCase().startsWith('zh') ? 'zh' : 'en';
    const rawBase = (ctx && (ctx.siteUrl || ctx.siteBaseUrl || ext.siteUrl)) || '';
    siteBase =
      typeof rawBase === 'string' && /^https:\/\/[^\s]+$/.test(rawBase)
        ? rawBase.replace(/\/+$/, '')
        : null;
    isSample = Boolean(ext.demo || (ctx && ctx.demo)) || !(issueKey || projectKey);
  } catch (err) {
    issueKey = null;
    projectKey = null;
    siteBase = null;
    isSample = true;
  }
  document.documentElement.lang = lang;
  await load();
}

boot();
