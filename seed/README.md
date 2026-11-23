# seed 验证 · 30 分钟，决定这个题目成不成立

这一步不是"测代码"，是**测选题**：六个判据在这套站点的真实数据上有没有素材。
如果三条以上是空的，该换的是内容，不是阈值。

## 怎么做

1. 打开你的站点，选 **3 个项目**，每个项目取 **7 条工作项**（跳过纯子任务、纯文档类）。
2. 用 Excel 打开 `seed-sheet.csv`（有 BOM，不会乱码），一行一条，把空格填成 `true` / `false` / 数字。
   也可以填中文 `是` / `否`，判定器都认。
3. 存成 **CSV UTF-8**（Excel 的"另存为 → CSV UTF-8（逗号分隔）"），文件名保持不变。
4. 运行：

```bash
npm run seed
```

5. 判定器会输出四项阈值 + 各原语命中分布 + 一条结论（进入 v1 / 砍原语 / 换内容）。

> 不用 Excel 也可以改 `seed-sheet.json`：`node seed/grade.js seed/seed-sheet.json`。
> 两种格式的判定逻辑完全一致，CSV 只是给不习惯 JSON 的人一条路。

**第三种做法（点选）**：双击 `seed/fill.html`，一条一张卡，点「是 / 否」，右侧实时显示会命中哪条判据，
填完点「导出 CSV」直接得到同格式文件。适合不想在 13 列里对格子的人。

> 判定器本身用虚构样本自检过：`node seed/grade.js seed/dry-run.json` → 应输出 `=> 内容冻结`。
> `dry-run.json` 是**虚构数据**，只用来证明判定器没坏，不要当样本用。

## 每个字段怎么判（照着屏幕看，不需要解析时间戳）

| 字段 | 取值 | 判断方法 |
|---|---|---|
| `issueKey` | 文本 | 工作项编号 |
| `hasEvidence` | true/false | 该工作项有没有关联的依据页（链接、remote link、描述里的 Confluence URL 都算） |
| `hasGoal` | true/false | 有没有挂在目标 / Epic 目标下 |
| `goalEnded` | true/false | 关联目标是否已完成 / 归档 / 取消（没有目标时填 false） |
| `changeAfterStart` | true/false | 依据页的最后更新时间，是否**晚于**该工作项进入 In Progress 的时间 |
| `confirmedAfterChange` | true/false | 那次更新之后，工作项上有没有确认记录（评论、链接、子任务都算） |
| `conflictSameTopic` | true/false | 是否存在另一份"在说同一件事但结论/负责人不同"的依据页 |
| `reopenedCount` | 数字 | 重开次数，没有填 0 |
| `evidenceAfterLastReopen` | true/false | 最后一次重开之后，依据页有没有被更新过 |
| `singleContributor` | true/false | 依据页是否只有 1 位贡献者 |
| `secondReviewer` | true/false | 页面上有没有第二个人留下的复核痕迹（评论 / 审批） |
| `issueDone` | true/false | 该工作项本身是否已完成 |
| `note` | 文本 | 一句话备注，方便复看 |

## 判定规则（与 `02_验证协议与实现范围.md` 一致）

| 指标 | 阈值 | 不达标时该做什么 |
|---|---|---|
| 依据页关联率 | ≥ 40% | 砍 P3、P6，只留 P2，口径缩为两套 |
| 目标关联率 | ≥ 20% | P4 恒空：并入 P1，组合治理口径下线 |
| 命中条数 | ≥ 8 / 21 | **换内容**（不要调阈值） |
| 原语覆盖 | ≥ 3 条各命中 ≥2 次 | 补原语或换内容 |

判定器会自己区分"砍原语级别"和"换内容级别"，并在结论里写明。

## 填完之后

- **全过** → 内容冻结，进 v1（面板 → agent → MCP）。
- **砍原语** → 改 `src/engine/profiles.js` 的权重表与 `01` 的口径表，重跑 `npm run verify`。
- **换内容** → 停下来重选题，不要在这里继续投入工程量。

## 为什么先做这一步

规则命中率决定产品在这套系统里的"存在性"。21 条只命中 1 条的题目，无论写得多好，演示时都是空屏——而这 30 分钟比分十天的代码更值钱。
