'use strict';

/**
 * 上架前的自证脚本：把 listing / 隐私政策里对审查员说的每一句，回到代码里验一遍。
 *
 * 声明过的三句硬话：
 *   1. 不调用任何外部服务
 *   2. 不持久化任何内容
 *   3. 不申请任何写权限
 * 这三句只要有一句在代码里不成立，上架就是虚假陈述——比被拒更糟。
 *
 *   node marketplace/check.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// 生成物：src/ui/index.js 是 esbuild 打出来的包，里面必然含有 @forge/bridge 自带的
// fetch 与 @forge/api 字样。审的是我们自己写的源码（src/ui/src/app.js），不是 vendor 代码。
const GENERATED = new Set([path.join(SRC, 'ui', 'index.js')]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'fixtures') continue;
      walk(p, out);
    } else if (e.name.endsWith('.js') && !GENERATED.has(p)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail, kind: 'hard' });
}
/**
 * 与"工程是否过关"分开记：app.id / icon / 支持邮箱 / 隐私政策地址这四项，
 * 只有注册站点并拥有账号的人才能填。把它们混进 FAIL，会让每次回跑都显示"红"，
 * 于是真正的红就没人看了——这才是要修的毛病，不是占位符本身。
 */
function pending(name, ok, detail) {
  results.push({ name, ok, detail, kind: 'pending' });
}

// 1) 无外部网络调用
const netHits = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const re = /\bfetch\s*\(|\baxios\b|require\(\s*['"]https?['"]\s*\)/g;
  const m = text.match(re);
  if (m) netHits.push(`${path.relative(ROOT, f)}: ${m.join(',')}`);
}
check('无外部服务调用', netHits.length === 0, netHits.join(' | ') || `${files.length} 个源文件均无 fetch/axios`);

// 2) 无持久化：只认 storage / sql / kv 这类落盘 API。
//    注意 @forge/api 本身不等于存储 —— 它也是 requestJira / requestTeamworkGraph 的入口，
//    把 require('@forge/api') 当成"用了存储"是假阳性，会让这条自证变成噪音。
const storeHits = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const m = text.match(/\bstorage\s*\.\s*(set|get|delete|query)|\bsql\.|\bkv\.|@forge\/api\/storage/g);
  if (m) storeHits.push(`${path.relative(ROOT, f)}: ${m.join(',')}`);
}
check('不持久化内容', storeHits.length === 0, storeHits.join(' | ') || '未引用 storage / sql / kv');

// 2b) 写请求只允许出现在唯一写模块里。
//    "只读"不是"源码里一个动词都不能有"——那样就写不出留痕。准确的说法是：
//    默认路径不发写请求，唯一能写的地方是 src/ports/write.jira.js，且它要 write scope 才存在。
const WRITE_MODULE = path.join(SRC, 'ports', 'write.jira.js');
const writeHits = [];
for (const f of files) {
  if (f === WRITE_MODULE) continue;
  const text = fs.readFileSync(f, 'utf8');
  const m = text.match(/method\s*:\s*['"](POST|PUT|PATCH|DELETE)['"]/g);
  if (m) writeHits.push(`${path.relative(ROOT, f)}: ${m.join(',')}`);
}
check('写请求只在唯一写模块', writeHits.length === 0, writeHits.join(' | ') || '除 write.jira.js 之外没有 POST/PUT/PATCH/DELETE');

// 2c) 写端口按 scope 开关：没有 scope 时 createWritePort 必须返回 null。
//     这条是"按钮只在有权限时出现"的可执行版本，而不是一句注释。
let gateOk = false;
let gateDetail = '';
try {
  const { createWritePort } = require(WRITE_MODULE);
  const fakeApi = { asUser: () => ({ requestJira: async () => ({ ok: true, json: async () => ({}) }) }) };
  const noScope = createWritePort({ api: fakeApi, scopes: ['read:jira-work'] });
  const withScope = createWritePort({ api: fakeApi, scopes: ['read:jira-work', 'write:jira-work'] });
  gateOk = noScope === null && withScope !== null && withScope.available === true;
  gateDetail = `no-scope=${noScope === null ? 'null' : 'port'} with-scope=${withScope ? 'port' : 'null'}`;
} catch (err) {
  gateDetail = String(err.message || err);
}
check('写端口按 scope 开关', gateOk, gateDetail);

// 3) manifest：写 scope 必须没开
const manifest = fs.readFileSync(path.join(ROOT, 'manifest.yml'), 'utf8');
const activeScopes = manifest
  .split(/\r?\n/)
  .filter((l) => /^\s*-\s+\S/.test(l) && !/^\s*#/.test(l))
  .map((l) => l.replace(/^\s*-\s+/, '').trim());
const writeScopes = activeScopes.filter((s) => s.startsWith('write:'));
check('未申请写权限', writeScopes.length === 0, writeScopes.join(', ') || 'scopes 中无 write:*');

// 4) manifest：代码真正消费的 graph scope 齐全。Confluence 页面 scope 故意不申请：
//    Jira 托管的 app 在生产站点拿不到跨产品 token（实测 401 → UNAVAILABLE_TOKEN_ERROR），
//    申请一个用不了的 scope 只会多一次授权、多一条失败路径。
const need = ['read:graph:issue:jira', 'read:graph:user:atlassian'];
const missing = need.filter((s) => !activeScopes.includes(s));
check('graph scope 齐全', missing.length === 0, missing.join(', ') || need.join(' / '));
check(
  '未申请跨产品 Confluence scope',
  !activeScopes.includes('read:graph:page:confluence'),
  'page scope absent by design (Jira app cannot mint it)'
);

// 5) 四个入口模块在位（面板、项目页、agent、mcp）
const hasAgent = /^\s*rovo:agent:/m.test(manifest);
const hasMcp = /^\s*rovo:mcp:/m.test(manifest);
const hasPanel = /^\s*jira:issuePanel:/m.test(manifest);
const hasProjectPage = /^\s*jira:projectPage:/m.test(manifest);
check(
  '四个入口模块在位',
  hasAgent && hasMcp && hasPanel && hasProjectPage,
  `agent=${hasAgent} mcp=${hasMcp} panel=${hasPanel} projectPage=${hasProjectPage}`,
);

// 6) 上架阻塞项：占位符
const placeholders = [];
if (manifest.includes('REPLACE_AFTER_FORGE_REGISTER')) placeholders.push('manifest: app.id 未回填');
if (manifest.includes('REPLACE_WITH_ICON_URL')) placeholders.push('manifest: icon URL 未替换');
for (const rel of ['marketplace/privacy-policy.md', 'marketplace/listing.md']) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    placeholders.push(`${rel} 缺失`);
    continue;
  }
  const text = fs.readFileSync(abs, 'utf8');
  if (/REPLACE_WITH_(SUPPORT_EMAIL|PRIVACY_URL)/.test(text)) placeholders.push(`${rel}: 仍有 REPLACE_WITH_*`);
}
pending('账号类占位符（注册后回填）', placeholders.length === 0, placeholders.join(' | ') || '全部已替换');
// 7) 上架包里不能有开发用文件：评审会解开 jar 看内容，一份 fixture 数据在包里很难解释
const devLeaks = [];
for (const rel of ['src/ui']) {
  const abs = path.join(ROOT, rel);
  const walkRes = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'dev' || e.name === 'fixtures') devLeaks.push(`${path.relative(ROOT, p)}/ 是开发目录`);
        walkRes(p);
      } else if (/payloads\.json|shim\.js|\.test\.js|\.map$/.test(e.name)) {
        devLeaks.push(path.relative(ROOT, p));
      }
    }
  };
  if (fs.existsSync(abs)) walkRes(abs);
}
const panelBuilt = fs.existsSync(path.join(ROOT, 'src', 'ui', 'index.js'));
if (!panelBuilt) devLeaks.push('src/ui/index.js 未构建（面板会是一个空壳）');
check('上架包只含运行时文件', devLeaks.length === 0, devLeaks.join(' | ') || 'src/ui 内只有 index.html / style.css / index.js 与源码');

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  const label = r.ok ? 'PASS' : r.kind === 'pending' ? 'TODO' : 'FAIL';
  process.stdout.write(`${label}  ${r.name.padEnd(width)}  ${r.detail}\n`);
}
const hard = results.filter((r) => r.kind === 'hard');
const hardPassed = hard.filter((r) => r.ok).length;
const pendingLeft = results.filter((r) => r.kind === 'pending' && !r.ok).length;

// 三种结果，而不是两种：
//   0 = 全部完成              → READY
//   3 = 工程全过、只剩账号项  → PENDING-PLACEHOLDERS（可提交，只有你能填）
//   2 = 工程侧真失败          → BLOCKED
const engineeringOk = hardPassed === hard.length;
process.stdout.write(
  `\nmarketplace check  工程 ${hardPassed}/${hard.length} · 账号待填 ${pendingLeft}  => ${
    !engineeringOk ? 'BLOCKED' : pendingLeft ? 'PENDING-PLACEHOLDERS' : 'READY'
  }\n`
);
if (pendingLeft) {
  // 待填项要带"怎么填"，否则每次回跑看到的都只是一行红字，而不是一个待办。
  process.stdout.write(
    [
      'NEXT  下面三处填完就不必再跑这一项（其余字段一个都不用动）：',
      'NEXT    manifest.yml  app.id            ← 注册站点后 forge 给出的 app id',
      'NEXT    privacy-policy.md / listing.md  REPLACE_WITH_SUPPORT_EMAIL ← 你的支持邮箱',
      'NEXT    listing.md    REPLACE_WITH_PRIVACY_URL ← privacy-policy.md 的公开地址',
      'NEXT    （图标已随包：resource:assets;icon-48.png，无需公网 URL）',
    ].join('\n') + '\n',
  );
}
process.exitCode = !engineeringOk ? 2 : pendingLeft ? 3 : 0;
