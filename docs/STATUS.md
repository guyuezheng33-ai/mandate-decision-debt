# STATUS · 单一事实源

状态基线: 2026-11-28

本文件是项目状态的**唯一权威**。00 / 07 / 10 等文档的状态描述必须引用本文件并带基线日期；
`node tools/sync-counts.js --check` 会拒绝相反陈述（D8）。数字类事实以 `docs/verification.md`
与 `npm run check` 的真实输出为准，本文件只记状态，不手抄断言数。

| 事实 | 状态（2026-11-28） | 谁来做 |
|---|---|---|
| 断言与闸门 | 221 条断言全过；full-check 11/12，唯一 FAIL = submission/videoHost | 工程已绿；videoHost 见下 |
| 视频 | 已产出：90s MP4（catbox 临时托管）；**YouTube public 上传待办**（赛事硬要求，Unlisted/非 YouTube 不合规） | owner 上传后把 07 Video 字段换成 YouTube 链接 |
| 截图 | 3 张真实 Jira 外框已备：MOBL-57 收据 / MOBL-57 展开 6 checks / MOBL-56 NO RECORD；项目页完整图待补（live 路由当前 E_PARTIAL） | owner 补项目页与 MOBL-27 面板图 |
| 安装链接 | 旧 install-link 已死（落到 http://6.12.0.0 证书页）；Console Distribution 重生成 + 第二站点实测待办 | owner |
| live 审计 | `runs/real-audit-mobl-30.json`：28 missing / 1 stale / 1 unknown；P2_ASSERT=judged PASS；P2 hit 受日期门（记录编辑 2026-11-23 + 14 天，最早 2026-12-07，且需 asOf 推进） | 工程届时复跑 P2_ASSERT=hit |
| 四端矩阵 | `docs/surface-matrix.md`（fixture KAN-3）与 `docs/surface-matrix-live.md`（MOBL-57）均 PASS；NO SCORE 发布口径统一为 debt=null | 完成 |
| bonus 材料 | `docs/mcp-examples.md` 含 live REST 抓包（MOBL-57，source=rest，全量在 `runs/live-provenance-mobl57.json`）；TWG live 抓包与视频 25s agent 段待 owner（需 Forge 运行时/录制） | owner |
| seed | 真实项目 seed 0/21 待 owner 填；simulated corpus 21 行与引擎逐行 0 分歧（形状证据，非校准） | owner |
| AI 披露 | 已完成：`docs/AI-DISCLOSURE.md` + 07 §11.6 | 完成 |
| GitHub | 本地 master 自 61ce41c 起未 push（凭据弹窗需 owner）；D1/D6/D3/D9 已本地 commit | owner push |
| Marketplace | 工程自检 9/9 READY；review ticket 待提交 | owner |
| Devpost | 07 草稿就绪（含 §4.5 点名竞品、§11.6 AI 披露）；表单提交待 owner | owner |
| 部署 | 6.12.0 production，one-atlas-ngpq.atlassian.net；项目页正确路由 `/jira/software/projects/MOBL/apps/<appId>/<envId>` | 完成 |
| 待裁决 | D4 真实还款事件需启用 `write:jira-work`（门控第 13 项）；D10 Forge storage/scheduledTrigger 与「不持久化」立场冲突 | owner 拍板，工程不替选 |

## 用法

- 任何文档写状态前先对本表；对不上就改文档，不改本表来迁就文档。
- 本表更新时改基线日期，并同步 00 / 07 / 10 头部的基线引用。
- 程序断言：`tools/doc-structure.js` 的 `statusBaselineCheck`（缺日期、缺引用、相反陈述 → FAIL）。
