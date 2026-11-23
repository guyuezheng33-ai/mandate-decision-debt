# ADR 0018：项目页补水用一条 JQL，不做 N+1

日期：2026-11-20
状态：已采纳

## 背景

项目页扫描拿到的是证据链，issue 的 `summary / status / created / updated /
statuscategorychangedate` 通常不在扫描选择集里。没有这些字段，P2 一律 `unknown`，
按 ADR 0017 整页就"不出分"——项目页作为四个入口之一等于废掉。

最直接的补法是逐条 `getIssue(key)`：8 到 50 条就是 8 到 50 次往返。
这正是本产品在文档里反复点名禁止的 N+1，也会让项目页在真实站点上超时。

## 决定

1. `jira.client` 新增 `getIssues(keys)`：一条
   `GET /rest/api/3/search?jql=key in (A,B,…)`，`maxResults = keys.length`，
   字段与单条 `getIssue` 完全一致（两条路径不能喂出不同形状）。
2. 入参做两件事：按 `^[A-Za-z][A-Za-z0-9_]*-\d+$` 过滤（JQL 是拼字符串，
   不能把调用方给的值原样塞进去），去重后**最多 50 个**。
3. `hydrate.js` 新增 `hydrateBundles(bundles, jira, {timeoutMs, max})`：
   只补空字段，图给的值优先；失败时统一记 `metaError=E_PARTIAL` 并保留缺口，
   **绝不退回逐条补水**。
4. `src/index.js` 的 `listBundles` 在端口返回后调用一次 `hydrateBundles`，
   并把端口挂在数组上的 `scan` 预算信息原样带出（预览与披露都依赖它）。

## 为什么不是"扫描查询里直接选这些字段"

能选就该在查询里选。但 TWG 的持久化查询选择集要真站点 schema 点头，
而项目页不能等这件事验证完才能用；批量 REST 是这次就能验证、且成本 O(1) 的路径。
等 extended 选择集在真站点通过后，这一层可以去掉，接口不变。

## 代价与边界

- 多一次 REST 往返（不是 N 次），4–6 秒超时，失败只降级不报红。
- 只补展示与判据需要的字段，不碰评论、不碰 changelog——后者才是真正的 N+1。
- P5（重开次数）仍然拿不到，所以项目页分数带 `†` 与 `certainty`（ADR 0017）。

## 验证

`test/hydrate-batch.test.js`（5 条）：

1. 5 条只打 1 次批量接口，单条接口调用次数必须为 0；
2. 图已经给出的 `status/summary` 不被覆盖，空字段才补；
3. 批量失败后 `metaError=E_PARTIAL`、`asOf` 仍为 `null`（不许填今天），且不退化成 N 次；
4. `getIssues` 的 JQL 去掉单引号、最多 50 个 key；
5. 没有合法 key 时不发请求。

集成断言：`test/data-inbox.test.js` 的 `inbox/project`——扫描 5 条 + 一次补水，
项目页从 `debt=null / counted 1` 变成 `16 / watch / 5 counted / certainty 0.90`。
