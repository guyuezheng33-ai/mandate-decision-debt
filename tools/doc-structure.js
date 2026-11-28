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

module.exports = { methodDocCheck };
