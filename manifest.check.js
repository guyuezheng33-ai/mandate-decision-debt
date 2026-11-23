'use strict';

/**
 * manifest 的离线自检。
 *
 * 为什么需要它：`forge lint` 的前置是登录 + 已注册的 app id，而这两件事都在用户手上。
 * 于是"manifest 写错了"这件事会一直藏到最后一刻才炸 —— 而它恰恰是最便宜就能查出来的：
 * 引用的函数在不在、action key 与 MCP tools 对不对得上、handler 指向的导出存不存在。
 *
 *   node manifest.check.js
 */

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = __dirname;
const MANIFEST = path.join(ROOT, 'manifest.yml');
const errors = [];
const notes = [];

function fail(msg) {
  errors.push(msg);
}

let doc;
try {
  doc = yaml.load(fs.readFileSync(MANIFEST, 'utf8'));
} catch (err) {
  process.stdout.write(`manifest 解析失败：${err.message}\n`);
  process.exit(1);
}

const modules = doc.modules || {};
const functions = (modules.function || []).map((f) => f.key);
const actions = modules.action || [];
const actionKeys = actions.map((a) => a.key);
const resources = (doc.resources || []).map((r) => r.key);

// 1) 每个 action 的 function 必须存在
for (const a of actions) {
  if (!functions.includes(a.function)) fail(`action ${a.key} 指向不存在的 function: ${a.function}`);
  for (const field of ['name', 'actionVerb', 'description']) {
    if (!a[field]) fail(`action ${a.key} 缺 ${field}`);
  }
  if (!['GET', 'CREATE', 'UPDATE', 'DELETE', 'TRIGGER'].includes(a.actionVerb)) fail(`action ${a.key} 的 actionVerb 非法：${a.actionVerb}`);
  const inputs = a.inputs || {};
  if (!Object.keys(inputs).length) fail(`action ${a.key} 没有任何 inputs（平台要求 inputs 必填）`);
  for (const [name, spec] of Object.entries(inputs)) {
    if (!spec.title) fail(`action ${a.key}.${name} 缺 title`);
    if (!spec.type) fail(`action ${a.key}.${name} 缺 type`);
    if (typeof spec.required !== 'boolean') fail(`action ${a.key}.${name} 的 required 必须是布尔值`);
    if (!['string', 'integer', 'number', 'boolean'].includes(spec.type)) fail(`action ${a.key}.${name} 的 type 非法：${spec.type}`);
  }
}

// 2) MCP tools / agent actions 必须是 action key，不能是函数名或 action 的 display name
const mcp = modules['rovo:mcp'] || [];
if (mcp.length !== 1) fail(`rovo:mcp 必须恰好一个（实际 ${mcp.length} 个）`);
for (const m of mcp) {
  if (!m.name) fail('rovo:mcp 缺 name');
  if (String(m.name).length > 30) fail(`rovo:mcp 的 name 超过 30 字符：${m.name}`);
  for (const t of m.tools || []) {
    if (!actionKeys.includes(t)) fail(`rovo:mcp.tools 里的 ${t} 不是已声明的 action key`);
  }
}

const agents = modules['rovo:agent'] || [];
if (agents.length !== 1) fail(`rovo:agent 必须恰好一个（实际 ${agents.length} 个）`);
for (const a of agents) {
  if (String(a.name || '').length > 30) fail(`rovo:agent 的 name 超过 30 字符：${a.name}`);
  if (!a.prompt) fail(`rovo:agent ${a.key} 缺 prompt`);
  const promptMatch = String(a.prompt).match(/^resource:([a-zA-Z0-9_-]+);(\S+)$/);
  if (promptMatch) {
    const [, rkey, rel] = promptMatch;
    const res = (doc.resources || []).find((r) => r.key === rkey);
    if (!res) fail(`agent prompt 引用了不存在的 resource: ${rkey}`);
    else if (!fs.existsSync(path.join(ROOT, res.path, rel))) fail(`agent prompt 文件不存在: ${path.join(res.path, rel)}`);
    else notes.push(`agent prompt → ${path.join(res.path, rel)}`);
  }
  for (const act of a.actions || []) {
    if (!actionKeys.includes(act)) fail(`rovo:agent.actions 里的 ${act} 不是已声明的 action key`);
  }
}

// 3) 面板模块的 resource / resolver
const panelModules = [
  ...(modules['jira:issuePanel'] || []).map((p) => ({ ...p, kind: 'issuePanel' })),
  ...(modules['jira:projectPage'] || []).map((p) => ({ ...p, kind: 'projectPage' })),
];
if (!panelModules.length) fail('没有任何面板模块（issuePanel / projectPage）');
for (const p of panelModules) {
  if (!resources.includes(p.resource)) fail(`${p.kind} 的 resource 未声明：${p.resource}`);
  if (!p.resolver || !functions.includes(p.resolver.function)) fail(`${p.kind} 的 resolver.function 不存在：${p.resolver && p.resolver.function}`);
  if (!p.title) fail(`${p.kind} 缺 title`);
  if (!p.icon) fail(`${p.kind} 缺 icon`);
  else if (/REPLACE_WITH/.test(p.icon)) notes.push(`${p.kind}.icon 仍是占位符（注册后回填）`);
}

// 4) 每个 function 的 handler 必须真的能在本机 require 到对应导出
// Forge 的 handler 路径相对 src/ 解析（例如 index.handler → src/index.js），
// 不是相对 manifest 所在的仓库根目录。这里的校准必须和 forge lint 完全一致。
for (const f of modules.function || []) {
  const m = String(f.handler || '').match(/^(\S+)\.(\S+)$/);
  if (!m) {
    fail(`function ${f.key} 的 handler 形状不对：${f.handler}`);
    continue;
  }
  const [, rel, symbol] = m;
  const abs = path.join(ROOT, 'src', `${rel}.js`);
  if (!fs.existsSync(abs)) {
    fail(`function ${f.key} 的 handler 文件不存在：src/${rel}.js`);
    continue;
  }
  try {
    const mod = require(abs);
    if (typeof mod[symbol] !== 'function') fail(`function ${f.key} 的导出 ${symbol} 不是函数`);
    else notes.push(`${f.key} → ${rel}.${symbol} ✓`);
  } catch (err) {
    fail(`function ${f.key} 的 handler 加载失败：${err.message}`);
  }
}

// 5) scope 形状：必须是 read: 或 read:graph:，写权限默认关闭
const scopes = (doc.permissions && doc.permissions.scopes) || [];
for (const s of scopes) if (!/^read:/.test(s)) fail(`出现了非只读 scope：${s}`);

for (const n of notes) process.stdout.write(`note  ${n}\n`);
if (!errors.length) {
  process.stdout.write(`manifest check  OK  ${actions.length} actions · ${functions.length} functions · ${scopes.length} scopes\n`);
  process.exit(0);
}
for (const e of errors) process.stdout.write(`FAIL  ${e}\n`);
process.stdout.write(`\nmanifest check  ${errors.length} 个问题\n`);
process.exit(2);
