'use strict';

/**
 * 端口契约（三种实现共同遵守）：
 *   status()                 → { source, degraded, note }
 *   getBundle(key)           → ProvenanceBundle
 *   listBundles(projectKey,n) → ProvenanceBundle[]
 *
 * 降级路径不是 try/catch 里的备胎，而是与主路径平级的第二种实现：
 * 契约测试对三种实现跑同一组断言，所以"评委站点 scope 被拒"在开发阶段就已经被处理过。
 */

const fs = require('node:fs');
const path = require('node:path');
const { normalizeBundle, STATES } = require('../engine/normalize');

function fileFor(dir, key) {
  const raw = String(key);
  const candidates = [
    raw,
    raw.toLowerCase(),
    raw.toLowerCase().replace(/[^a-z0-9]/g, ''),
  ];
  for (const c of candidates) {
    const file = path.join(dir, `${c}.json`);
    if (fs.existsSync(file)) return file;
  }
  return path.join(dir, `${raw}.json`);
}

function createFixturePort({ dir }) {
  const cache = new Map();

  function load(key) {
    if (cache.has(key)) return cache.get(key);
    const file = fileFor(dir, key);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bundle = normalizeBundle({ ...raw, source: raw.source ?? 'fixture' });
    cache.set(key, bundle);
    return bundle;
  }

  return {
    status() {
      return { source: 'fixture', degraded: false, note: '离线样本，用于单测与演示' };
    },
    getBundle(key) {
      const bundle = load(key);
      if (!bundle) throw new Error(`fixture not found: ${key}`);
      return bundle;
    },
    listBundles(projectKey, limit = 25) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      const out = [];
      for (const f of files) {
        const key = f.replace(/\.json$/, '');
        const bundle = load(key);
        if (!bundle) continue;
        if (projectKey && bundle.projectKey !== projectKey) continue;
        out.push(bundle);
        if (out.length >= limit) break;
      }
      return out;
    },
  };
}

module.exports = { createFixturePort, STATES };
