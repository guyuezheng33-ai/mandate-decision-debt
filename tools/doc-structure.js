'use strict';

/**
 * D9 · 方法文档的结构断言（纯函数，可单测）。
 * docs/METHOD.md 必须可独立引用：形式化模型 + 独立的「可证伪条件」章节 +
 * 适用边界 + 复跑入口。缺任一章节，docs 闸门（sync-counts --check）FAIL。
 */

function methodDocCheck(text) {
  const t = String(text || '');
  const problems = [];
  if (!t.trim()) {
    return { status: 'FAIL', detail: 'docs/METHOD.md 缺失或为空' };
  }
  if (!/##\s*\d*\.?\s*Formal model|形式化模型/i.test(t)) problems.push('缺形式化模型章节');
  if (!/##\s*\d*\.?\s*Falsifiable conditions|可证伪条件/i.test(t)) problems.push('缺独立的「可证伪条件 / Falsifiable conditions」章节');
  if (!/##\s*\d*\.?\s*Applicability boundaries|适用边界/i.test(t)) problems.push('缺适用边界章节');
  if (!/npm run check/.test(t) || !/real-audit\.js/.test(t)) problems.push('缺复跑命令（npm run check / real-audit）');
  if (!/test\/fixtures\/inbox/.test(t)) problems.push('未公开 corpus 路径 test/fixtures/inbox');
  if (problems.length) return { status: 'FAIL', detail: problems.join(' · ') };
  return { status: 'PASS', detail: 'METHOD.md 结构完整：模型 / 可证伪条件 / 边界 / 复跑入口' };
}

/**
 * D8 · 状态基线单一事实源。
 * docs/STATUS.md 必须带基线日期；00/07/10 必须引用它并带同一日期；
 * 任何文档与 STATUS 的已定事实相反（如视频已产出却仍写「视频不存在/暂缓」）→ FAIL。
 */
function statusBaselineCheck(statusText, docs) {
  const s = String(statusText || '');
  const problems = [];
  const m = s.match(/状态基线[::]\s*(\d{4}-\d{2}-\d{2})/);
  if (!m) problems.push('STATUS.md 缺「状态基线: YYYY-MM-DD」');
  const date = m ? m[1] : null;
  const videoProduced = /视频\s*\|\s*已产出/.test(s);
  const seedPending = /seed\s*\|\s*真实项目 seed 0\/21/.test(s);

  for (const d of docs || []) {
    const t = String(d.text || '');
    if (!t.includes('docs/STATUS.md')) problems.push(`${d.name} 未引用 docs/STATUS.md`);
    if (date && !t.includes(date)) problems.push(`${d.name} 未带基线日期 ${date}`);
    if (videoProduced && /视频不存在|视频暂缓|暂缓[^\n]{0,12}视频|只差录/.test(t)) {
      problems.push(`${d.name} 与 STATUS 相反：视频已产出，文中仍写不存在/暂缓/只差录`);
    }
    if (seedPending && /seed\s*21\/21|样本完整度\s*21\/21/.test(t) && !/目标|成功标志|待/.test(t)) {
      problems.push(`${d.name} 与 STATUS 相反：真实 seed 仍 0/21，文中写成已完成`);
    }
  }
  if (problems.length) return { status: 'FAIL', detail: problems.join(' · ') };
  return { status: 'PASS', detail: `状态基线 ${date} · ${docs.length} 份文档引用一致，无相反陈述` };
}

module.exports = { methodDocCheck, statusBaselineCheck };
