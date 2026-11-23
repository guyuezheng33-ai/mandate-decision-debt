# ADR 0019：选择集被 schema 拒绝时退 basic，但 403 不退

日期：2026-11-20
状态：已采纳

## 背景

`buildGql(fields)` 有两套选择集：

- `basic`：`id / data.title / webUrl` —— 任何 schema 版本都有的最小集；
- `extended`：再加 `lastModified / author / contributors`、`Goal.status`、issue 的
  `created / updated / statusCategoryChangedAt`。

extended 是 P2/P6/P4 能出结论的前提，但它依赖字段存在。数据包
（`graph/05-column-gap.md` G1）明确写了这一点，而默认打开未验证的选择集，
风险会落在评委的第一次点击上。

## 决定

1. 默认 `basic`；`MANDATE_GRAPH_FIELDS=extended` 显式打开。
2. extended 第一次被 **schema** 拒绝（`Cannot query field` / `GRAPHQL_VALIDATION_FAILED` /
   `400`）时，同一函数实例内退 `basic` 重试一次，并在结果上带
   `fields: "basic"`、`fieldsFallback: true`。
3. **403 / `E_SCOPE` 一律不重试**：少取几个字段不能让没权限变成有权限，
   退选择集只会把一条明确的授权错误变成一条模糊的"数据不足"。
4. `basic` 自己失败不重试（没有更低的选择集可退）。

## 代价

- 退回后 P2/P6/P4 会重新变成 `unknown`（这正是 basic 的事实），分数带 `†`，
  按 ADR 0017 的规则可能不出等级。这是对的：宁可说"我看不见"，也不拿残字段凑结论。
- `fieldsFallback` 目前透在端口结果上，还没有单独的错误码文案；界面通过 `unknownPrims`
  已经能说清"哪条判据没判"，暂不新增文案。

## 验证

`test/graph-fields.test.js`（3 条）：extended→basic 的第二次调用必须不含 `lastModified`；
403 只发一次；basic 失败不重试。
