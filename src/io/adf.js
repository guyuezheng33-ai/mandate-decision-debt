'use strict';

/**
 * ADF（Atlassian Document Format）與純文本之間的兩個方向。
 *
 * 為什麼要獨立成模組：寫評論的人（write.jira）和讀評論的人（jira.client）都必須用同一份轉換。
 * 一邊用 ADF、另一邊按純文本處理，結果就是"寫進去了，讀回來匹配不到"——
 * 這個錯在本地假 client 上是完全隱形的（它的 body 是字符串）。
 */

/** 純文本 → ADF。每行一個 paragraph，空行保留為空段落。 */
function adfFromText(text) {
  const lines = String(text ?? '').split('\n');
  return {
    type: 'doc',
    version: 1,
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  };
}

/** ADF → 純文本。段落之間補換行，好讓 `mandate:dd-xxxxxxxx` 能被正則撈出來。 */
function textOfAdf(node) {
  const parts = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text);
    if (n.type === 'hardBreak') parts.push('\n');
    if (Array.isArray(n.content)) {
      n.content.forEach(walk);
      if (n.type === 'paragraph' || n.type === 'heading') parts.push('\n');
    }
  };
  walk(node);
  return parts.join('');
}

function textOfBody(body) {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') return textOfAdf(body);
  return '';
}

module.exports = { adfFromText, textOfAdf, textOfBody };
