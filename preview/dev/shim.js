import P from './payloads.json';

/**
 * 本地开发用的 @forge/bridge 替身：
 * - view.getContext() 返回一个假的 issue context（KAN-3，英文 locale）
 * - invoke() 从 payloads.json 里取同一套 fixture 结果
 *
 * 只在 preview/ui-harness.html 里用，不会进上架包。
 */

const SAMPLE = (typeof window !== 'undefined' && window.location.search.match(/sample=([a-z0-9]+)/)) ? window.location.search.match(/sample=([a-z0-9]+)/)[1] : 'kan3';

// 截图用：浅色系统上也能拍出深色态（真机上走 prefers-color-scheme，不靠这个开关）
if (typeof document !== 'undefined' && /theme=dark/.test(window.location.search)) {
  document.documentElement.dataset.theme = 'dark';
}

let currentKey = SAMPLE;

const KEY_LABEL = { kan3: 'KAN-3', kan7: 'KAN-7', kan9: 'KAN-9', kan20: 'KAN-20', kan11: 'KAN-11', degraded: 'KAN-3' };
export const view = {
  getContext: () =>
    Promise.resolve({
      // project 样本走项目页上下文（没有 issue，只有 project）——两个入口的 context 形状本来就不同
      // project 样本走项目页上下文（没有 issue，只有 project）——两个入口的 context 形状本来就不同。
      // projectrest 是"REST 降级扫描"的同一页：每行只有依据页可知，分数带 †。
      extension: currentKey === 'project' || currentKey === 'projectrest' || currentKey === 'seed' ? { project: { key: currentKey === 'seed' ? 'DEL' : 'KAN' } } : { issue: { key: KEY_LABEL[currentKey] || 'KAN-3' } },
      demo: true,
      locale: (typeof window !== 'undefined' && /lang=zh/.test(window.location.search)) ? 'zh' : 'en',
    }),
};

export const invoke = (name, payload = {}) => {
  const lang = payload.lang === 'zh' ? 'zh' : 'en';
  const lens = payload.profile || 'software';
  const bucket = P[currentKey] && P[currentKey][lang];
  if (!bucket || !bucket[lens]) {
    return Promise.resolve({ ok: false, code: 'E_UNKNOWN_ISSUE', hint: 'sample not found' });
  }
  return Promise.resolve(bucket[lens]);
};

export const setSample = (k) => {
  currentKey = k;
};
