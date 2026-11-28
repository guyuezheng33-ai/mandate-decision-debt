'use strict';

/**
 * D6 · 提交面两条硬规则（纯函数，可单测）。
 *
 * videoHost：Devpost 的 Video 字段必须是 YouTube 公开链接。
 *   官方要求 public 视频；catbox/Vimeo/Unlisted 都曾在旧稿里出现，
 *   上一轮 7/7 READY 与 YouTube 硬要求冲突的根因就是这里漏检。
 * sourceHonesty：MCP 示例页里任何响应块必须自报 source；
 *   标着 fixture 的块不许被散文称为 live / 真实抓包。
 *
 * 两条都返回 {status, detail}；FAIL 必须让 submission-check 退出码 1。
 */

const ALLOWED_VIDEO_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be',
]);

/** 否定/规则语境：这些行里的 unlisted 是「不允许」，不是「打算用」。 */
const NEGATED = /不接受|不得|禁止|不能|不要|拒绝|不合规|reject|not accept|must be public/i;

function videoHostCheck(devpostText, scriptText) {
  const line = String(devpostText || '').split(/\r?\n/).find((l) => l.trim().startsWith('| Video')) || '';
  const urls = [...line.matchAll(/https?:\/\/[^\s)\]|]+/g)].map((m) => m[0]);
  if (!urls.length) return { status: 'FAIL', detail: 'Video 字段没有链接' };

  const badHosts = [];
  for (const u of urls) {
    let host = '';
    try { host = new URL(u).hostname.toLowerCase(); } catch { badHosts.push(`${u}(无法解析)`); continue; }
    if (!ALLOWED_VIDEO_HOSTS.has(host)) badHosts.push(host);
  }

  const unlisted = [];
  for (const [name, text] of [['07', devpostText], ['06', scriptText]]) {
    for (const l of String(text || '').split(/\r?\n/)) {
      if (!/\bunlisted\b/i.test(l) || NEGATED.test(l)) continue;
      unlisted.push(name);
    }
  }

  const problems = [];
  if (badHosts.length) problems.push(`host 不在 YouTube 白名单：${badHosts.join(', ')}`);
  if (unlisted.length) problems.push(`Unlisted 表述：${[...new Set(unlisted)].join(', ')}`);
  if (problems.length) return { status: 'FAIL', detail: problems.join(' · ') };
  return { status: 'PASS', detail: `Video host = YouTube · 无 Unlisted 表述` };
}

/** 把一节里的代码块挖掉，只剩散文，避免把 JSON 里的词当 claim。 */
function proseOf(section) {
  return section.replace(/```[\s\S]*?```/g, '');
}

function sourceHonestyCheck(mcpText) {
  const text = String(mcpText || '');
  if (!text.trim()) return { status: 'FAIL', detail: 'docs/mcp-examples.md 缺失或为空' };

  const sections = text.split(/^## /m).slice(1);
  const problems = [];
  let responses = 0;

  for (const sec of sections) {
    const title = sec.split(/\r?\n/)[0].trim();
    const blocks = [...sec.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]);
    const prose = proseOf(sec);
    for (const block of blocks) {
      if (!/"ok"\s*:\s*true/.test(block)) continue; // 工具 schema 等非响应块跳过
      responses += 1;
      const top = block.match(/"source"\s*:\s*"([a-z]+)"/);
      const scan = block.match(/"scan"\s*:\s*\{[^}]*"source"\s*:\s*"([a-z]+)"/);
      const source = (top && top[1]) || (scan && scan[1]) || null;
      if (!source) {
        problems.push(`${title}: 响应块未自报 source`);
        continue;
      }
      if (!['fixture', 'twg', 'rest'].includes(source)) {
        problems.push(`${title}: source=${source} 不在 {fixture,twg,rest}`);
      }
      if (source === 'fixture') {
        const claimsLive = /\blive\b|真实抓包|live capture|real[- ]tenant (payload|capture)/i.test(prose)
          && !/not (a |claimed as |passed off as )?(live|mock)|fixture port|simulated|sample data/i.test(prose);
        if (claimsLive) problems.push(`${title}: fixture 块被散文称为 live`);
      }
    }
  }

  if (!responses) return { status: 'FAIL', detail: '没有任何带 ok:true 的响应块可供核对' };
  if (problems.length) return { status: 'FAIL', detail: problems.join(' · ') };
  return { status: 'PASS', detail: `${responses} 个响应块全部自报 source · fixture 未被称 live` };
}

/**
 * D3 · 竞品必须点名：07 与 docs/COMPETITORS.md 都要出现三个真实产品名 + Marketplace URL。
 * 「某审批应用 / some approval app」这类不点名写法直接 FAIL。
 */
const COMPETITORS = [
  { name: 'Group Sign-Off', url: 'marketplace.atlassian.com/apps/1211104' },
  { name: 'Approval Path', url: 'marketplace.atlassian.com/apps/1220490' },
  { name: 'SealDoc', url: 'marketplace.atlassian.com/apps/2595855992' },
];

function competitorsCheck(devpostText, competitorsText) {
  const dev = String(devpostText || '');
  const comp = String(competitorsText || '');
  const problems = [];
  if (!comp.trim()) problems.push('docs/COMPETITORS.md 缺失或为空');
  for (const c of COMPETITORS) {
    if (!dev.includes(c.name)) problems.push(`07 未点名 ${c.name}`);
    if (!dev.includes(c.url)) problems.push(`07 缺 ${c.name} 的 Marketplace URL`);
    if (comp.trim() && !comp.includes(c.url)) problems.push(`COMPETITORS.md 缺 ${c.name} URL`);
  }
  if (/某审批应用|某个审批|some approval app|a certain approval/i.test(dev)) {
    problems.push('07 出现不点名的「某审批应用」类写法');
  }
  if (problems.length) return { status: 'FAIL', detail: problems.join(' · ') };
  return { status: 'PASS', detail: '三个真实竞品点名 + URL（07 与 COMPETITORS.md 一致）' };
}

module.exports = { videoHostCheck, sourceHonestyCheck, competitorsCheck, ALLOWED_VIDEO_HOSTS };
