'use strict';

/**
 * 留痕标记：写进去的评论和读回来的证据，靠这一小段字符串对齐。
 *
 * 为什么单独成一个模块：写端口（POST 评论）与读端口（从评论推 lastConfirmAt）
 * 如果各自复制一份标记格式，改动时必然有一边忘记同步，结果是"写成功了，但分数不动"——
 * 这种错在本地测不出来，只有真站点上看一眼才发现。
 */

const MARKER = 'mandate:';
const FINGERPRINT_RE = /mandate:(dd-[0-9a-f]{8})/i;

function isStamp(text) {
    return typeof text === 'string' && text.includes(MARKER);
}

function fingerprintIn(text) {
    const m = String(text || '').match(FINGERPRINT_RE);
    return m ? m[1] : null;
}

/**
 * 从评论列表推出"最后一次复核时间"。
 *
 * 只认带标记的评论，且用评论的 created（服务器时间），不用正文里人写的日期——
 * 后者可以被随手写成任何一天，而 P2 的判定完全建立在这个时间与依据页更新时间的先后上。
 *
 * @param {Array<{body?: string, created?: string}>} comments
 * @returns {string|null} ISO 时间
 */
function latestStampAt(comments) {
    let best = null;
    for (const c of Array.isArray(comments) ? comments : []) {
        if (!isStamp(c?.body)) continue;
        const t = Date.parse(c.created);
        if (!Number.isFinite(t)) continue;
        if (best == null || t > best) best = t;
    }
    return best == null ? null : new Date(best).toISOString();
}

module.exports = { MARKER, isStamp, fingerprintIn, latestStampAt };
