# 真实数据形状回归：`data-inbox` 跑通记录

> 一句话：把外部数据包（tier=S，受控仿真）逐字节搬进仓库，变成 14 条可重复跑的断言；
> 跑的过程中抓到并修掉 3 个真问题：P2 假 clear、整页项目页不出分、缺字段时算成"健康"。

## 0. 先说这份数据是什么，不是什么

| 项 | 事实 |
|---|---|
| 来源 | `data-inbox/00_数据来源与认知状态.md`：`tier=S`（simulated，受控仿真），`generator=datasupply-mandate/1.0`，`seed=20261120`，`as_of=2026-11-20` |
| 数量 | 26 个文件，`manifest.json` 逐文件 sha256 |
| 规模 | issues 152 / pages 121 / goals 10 |
| 可以说的 | schema 与判据已在 21 条构造样本上跑通，每个数字都能回溯到生成器 |
| 不可以说的 | 不得写成"真实站点验证"，也不得写成"经 N 位从业者校准"（`humans/raters.md` 自己标了占位） |

探针每次运行都会先按 `manifest.json` 校验全部 26 个文件的 sha256，任何一位被改过就直接失败，
所以"跑的是这一包数据"这件事不是口头承诺，而是每次运行都重新验证的前提。

```
node tools/mandate_probe.js
data-inbox probe · tier=S · 26/26 文件校验通过
```

## 1. 五个列缺口（`graph/05-column-gap.md` G1–G5）现在的状态

| 缺口 | 现象 | 处置 | 断言 |
|---|---|---|---|
| G1 | basic 选择集只取 `id/title`，`updated/owner/contributors` 全缺 | 两套选择集 + `MANDATE_GRAPH_FIELDS`；默认 basic，**extended 被 schema 拒绝时自动退 basic 并把 `fieldsFallback` 带回**（ADR 0019） | `inbox/G1`、`graph-fields` 3 条 |
| G2 | 图字段叫 `lastModifiedOn / authorId / contributorIds`，引擎叫 `updated / owner / contributors` | `nodeToItem` 全部别名映射；`contributorsKnown` 区分"空名单"与"名单没回来" | `inbox/G2` |
| G3 | 扫描行没有 issue 元数据，P2 曾算出 `clear`（假 clear） | `rules.js` 加 `issue-no-start` / `issue-no-asof` 两条 gap；hydrate 必补 `updated/asOf` | `inbox/G3`、`inbox/G3-fix` |
| G4 | REST 没有"重开次数"，曾硬填 0 → P5 假 clear | 去掉硬填 0，`reopenedKnown=false` → P5 `unknown(issue-no-reopen-count)` | `inbox/G4` |
| G5 | goal 的 `status` 在映射层被丢，P4 退化成"只看时间" | `nodeToItem` 映射 `status/state`，`normalizeGoal` 统一小写 | `inbox/G5` |

G1 为什么默认仍是 basic：extended 选择集要真站点 schema 点头才能开，
未验证就默认打开，等于把"可能 400"的风险放到评委第一次点击上。
但现在不是二选一：`MANDATE_GRAPH_FIELDS=extended` 打开后，第一个 schema 拒绝会自动退 basic
继续出分（`fieldsFallback: true` 一路透到界面），403 则照旧抛 `E_SCOPE`，不会拿"少取字段"掩盖权限问题。

## 2. 21 条 seed 事实：引擎与事实逐条对齐

```
seed : 21 条 · 引擎与事实不一致 0 条 · 与人类标签对齐 17/17
```

- 不一致从 6 条降到 0 条，根因是数据包缺一列：`seed-21.csv` 没有"执行侧确认事件"
  （`confirm_event_dates`）。`review_event_dates` 是**页面复核痕迹**（P6 的证据），
  不是 P2 要的"改完之后有人重新确认"。把两者混用，6 条真漂移会被判成"已确认"。
- 探针显式取 `confirmedAfterChange=false`，并把缺列写进 `dataIssues`；
  这条缺口属于数据侧，代码侧不猜。
- `17/17` 是有人类标签的 17 条（其余 4 条标"说不好"，按规则不参与对齐）。

## 2.1 效果审计：产品自己说错话的三处（已修）

把 21 条逐条折成 bundle 跑引擎、再和 `human_label` / `labels.csv` 对照，抓到的不是"分不准"，
而是**同一句话自相矛盾**。这类错比算错更伤，因为它会让读者不再相信任何一个数字。

| 现象 | 根因 | 修法 | 断言 |
|---|---|---|---|
| `15 · HEALTHY` 配一条"两份依据互相打架" | 等级只看分数带，不看命中的严重度 | `summarize` 加严重度地板：有 `medium/high` 命中 → 至少 `watch`；只有 `low` 命中（P6）仍可 `healthy` | `grade-floor` |
| 同一事实在 software 判 high、在 portfolio 判 medium | `severity` 由本口径权重反推 | `rules.js` 固定 `SEVERITY={P1/P2/P4:high,P3/P5:medium,P6:low}`，severity 不再随权重变形 | `grade-floor` |
| 21 条里 17 条有缺口，项目页却印 `14 · HEALTHY` | 项目级只取均分 | `aggregate` 增加 `flaggedCount/flaggedShare/severeCount`；任意 severe 条目 → ≥`watch`；`flaggedShare≥0.6 && avg≥25` → ≥`at_risk`；均分仍印原值，地板只抬等级 | `grade-floor` |

修后分布：**14 watch / 7 healthy**（修前 10 watch / 11 healthy）。项目级三口径都落在 watch：
software `14 · 17/21 flagged · severe 14`，launch `14`（drivers P2 120 / P3 66），
portfolio `13`（drivers P2 84 / P4 52）。

审计同时查出的人类分歧，按"不改代码"处理，写在这里备查：
`PAY-203`（seed 标"依据冲突"，4 位评分人里 1 位说要查，引擎 P3 watch 15）属评分噪声；
`PAY-204` / `OPS-303`（P6 单人无复核 8 分，引擎 healthy，2–3 位评分人说要查）属
"低分但有 finding"的既定口径——它现在被 `grade-floor` 固定成"healthy + 1 条 low"，
界面不会把它读成完全干净，也不会把它抬成 watch。

## 3. 项目页：从"整页不出分"到"16 / watch"

扫描只带证据链、不带 issue 元数据时，5 条里有 4 条的 P2 看不见。
旧行为：`coverage` 只看三条边，四条看不见的条目照样计入分母，项目页给出 **8 / healthy**——
数据越缺，看板越干净。这是本产品最不该犯的错，已在 `score.js` 修掉：

- `summarize` 新增 `certainty`（已判权重 / 应判权重）、`partial`、`unknownWeight`；
- **主判据（P2）看不见时等级一律 `unknown`**，不拿下界冒充结论；
- `aggregate` 只把"出得了等级"的条目计入分母，覆盖不足一半时项目级不出分（`debt=null`）。

同时补上真正的工程缺口：项目页现在是**一次批量 JQL** 补齐整页元数据，不是 N 次 GET。

| 阶段 | 可计条目 | 项目债 | 等级 | 确定度 |
|---|---|---|---|---|
| 只有扫描（补水前） | 1 / 5 | `null`（不出分） | unknown | — |
| 一次批量补水后 | 5 / 5 | **16** | watch | 0.90（P5 仍缺，带 †） |

`certainty 0.90` 不是瑕疵，是披露：REST 拿不到重开历史，P5 永远缺一条，
所以项目页写"4 条带缺口 · 确定度 47%"这类话，而不是把 16 分当成完整结论。
`inbox/project` 与 `hydrate-batch` 共 205 条断言把这个行为钉住，
其中一条专门断言"失败后不许退化成 N 次单条补水"。

同一页在**21 条 seed** 上（`preview/ui-harness.html?sample=seed`）的实测：
`14 WATCH · Coverage 21/21 countable · 0 unknown · 17 of 21 flagged`，
前六行是两条 25 分"无依据"（DEL-106 / OPS-307）与四条 20 分"变更未传导"（DEL-101/102/103、PAY-201）。
这一页存在的理由是它证明"均分不高但大多数条目有缺口"时，界面必须同时说这两件事。

## 4. 人体实验（`humans/`）与写路径（`write/`）

- `humans/labels.csv`：4 位评分人（`rater-01..04`）、21 条 seed key + 9 个非 seed key、
  `would_check` 计数；`raters.md` 是占位，
  所以探针输出里显式带 `placeholder: true`，对外材料不许引用为"校准"。
- `write/01-comment-request.adf.json` 的 ADF 树里带指纹 `mandate:dd-50c76351`，
  `02-comment-response.json` 回读同指纹、`id=10321`、`created=2026-11-20T03:41:12.480+0000`。
  探针核对的是"写进去的指纹能被读回来"这一条闭环，不是"写成功了"。

## 5. 规模与退化（`scale/`、`edge-cases.md`）

```
scale : 120 条 · p50 页=1 p90=1 · REST cap 8 会漏 112
```

- 120 条样本里，绝大多数只有 1 页依据，说明 P3（同题冲突）在真实分布里是低频但存在；
- REST 降级一次 8 条，120 条会漏 112 条——这正是扫描预算必须印在界面上的原因，
  而不是悄悄只算前 8 条。

## 6. 现在的断言账

`npm run verify`：**205 条**，其中数据包这一轮新增 9 条（`data-inbox` 10、`hydrate-batch` 6、
`graph-fields` 3、`grade-floor` 6、`agent-entry` +2、`compact` +1）：

| 组 | 条数 | 钉住的是什么 |
|---|---|---|
| `data-inbox` | 10 | G1–G5 五个缺口、错误信封、项目页从不出分到出分、21 条 seed 逐条对齐、扫描 `pageInfo` 必须透出 |
| `hydrate-batch` | 6 | 一页一次调用、图值优先、失败不退化 N+1、JQL 注入过滤、上限 50、端点迁移 |
| `graph-fields` | 3 | extended 被 schema 拒绝时退 basic；403 不退；basic 自己失败不重试 |
| `grade-floor` | 6 | 有 medium/high 命中至少 watch；P6-only 仍可 healthy；严重度不随权重变形；项目级 81% 有缺口不许 HEALTHY |

把整包重算成一张表：`npm run corpus` → [`corpus-report.md`](corpus-report.md)（三口径并列、等级分布、
21 条逐条、与标签的每一处分歧，并在同一次运行里校验 manifest 26/26）。

## 7. 还没做的事（写在这里，免得被当成已完成）

1. `MANDATE_GRAPH_FIELDS` 默认 basic，extended 需要真站点 schema 验证；
2. `seed-21.csv` 缺 `confirm_event_dates`，属数据侧缺口，代码侧不补猜；
3. 写路径只在探针层核对指纹闭环，未走真实站点 POST；
4. 项目页批量补水在离线 fixture 上跑通，真站点上"一条 JQL 拿 50 条"的延迟未实测；
5. 真人测评尚未开始（用户侧）。
