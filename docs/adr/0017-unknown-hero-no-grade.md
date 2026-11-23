# ADR 0017：看不见主判据时，不出等级

日期：2026-11-20
状态：已采纳（替换 `aggregate` 原来"三条边齐全即可计入分母"的规则）

## 背景

项目页原先把"三条必需边都可知"当作可计入分母的条件：

```js
const counted = items.filter((i) => i.coverage.known === i.coverage.total);
```

这三条边是 `decisions` / `goals` / `reviewTraces`，都不包含 issue 自身的
`updated` / `inProgressSince`。而 P2（变更未传导）恰恰要拿"依据页最后改动时间"
和"执行开始时间 + 观测时间"比先后。结果是：

- 扫描回来、还没有 issue 元数据时，`coverage` 是 3/3；
- 条目照样计入分母，`debt=0`，项目页给出 **8 / healthy**。

数据越缺，看板越干净。这和产品存在的理由正好相反。

## 决定

1. `summarize` 增加三个字段：`certainty`（已判权重/应判权重）、`partial`、`unknownWeight`。
2. **P2 是主判据**：当依据边存在、而 P2 判为 `unknown` 时，该条 `grade` 直接 `unknown`，
   不论其余判据多干净。理由：P2 是"这项工作的授权今天是否还成立"的唯一直接证据，
   它看不见时，任何"健康"结论都是无根据的。
3. `aggregate` 只把 `grade !== 'unknown'` 的条目计入分母；覆盖不足一半时
   项目级 `debt = null`、`grade = 'unknown'`（界面印 `–` / `NO SCORE`），
   并输出 `certainty` 与 `partialCount` 供界面披露。
4. 界面同一条线：项目级 `certainty < 0.5` 时等级位写 `PARTIAL`（中文"判据不足"），
   不写 healthy/watch；单条行早在 01 呈现契约第 11 条已有同样规则，这次把项目级补齐。

## 代价

- `aggregate.debt` 可能是 `null`，调用方必须处理（`compactProject` 透传，UI 印破折号）。
- 项目页在没有批量补水时会显示"不出分"，看起来"更糟"——这是刻意的：
  看不见就说看不见，而不是给一个偏低但好看的数。

## 验证

- `test/data-inbox.test.js`：`inbox/project` 断言补水前 `countedCount=1 / grade=unknown / debt=null`，
  一次批量补水后 `5/5 · 16 · watch · certainty 0.90`。
- `test/golden.test.js` 与五份 golden 未受影响（fixture 里 P2 均可知，KAN-11 本就六条全 unknown）。
- 浏览器复核：`?sample=projectrest` 头部从 `11 健康` 变为 `11 判据不足`，
  英文 `11 PARTIAL`，截图 `preview/harness-partial.png` / `-zh.png`。
