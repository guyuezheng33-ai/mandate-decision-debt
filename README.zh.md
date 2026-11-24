# Mandate · Decision Debt

> 每条工作项都应该说得出**是谁、在哪份文档、什么时候**授权了它 —— 以及那份授权**今天还算不算数**。
> 说不出来的时候，这个缺口就是 Decision Debt，0–100 分。

Mandate 是一个 Forge 应用：审计每条 Jira 工作项背后的授权边（谁、哪份页面、何时），按六条条件检查该授权在 *t* 时刻是否仍成立，把未满足条件用三值证据量化为 0–100 的 Decision Debt，并给出一个 owner 级动作；只有 `absent` 触发 finding，打分确定性、基线可复现，打分预算 300ms（开发机 P50 30–43ms）。

完整定义（形式化模型、品类、价值、证明义务）见 [`docs/PRODUCT-DEFINITION.md`](docs/PRODUCT-DEFINITION.md)。

**CI：** [verify workflow](https://github.com/guyuezheng33-ai/mandate-decision-debt/actions/workflows/ci.yml)。

为 Atlassian Codegeist 2026 而写。主用户是 **交付负责人**：手上同时跑多条工作线，每周都要回答一次"这个东西为什么在做"。

---

## 它做什么

多个入口，一套判据：

| 入口 | 它回答的问题 |
|---|---|
| Jira 工作项面板 | 这条为什么存在？它的授权今天还有效吗？ |
| Jira 项目页 | 这个项目背了多少债，我该先看哪一条？（覆盖率印在排序上方） |
| Rovo agent | 这个项目里哪些工作，压在需要重新确认的证据上？ |
| MCP（Cursor / Claude） | 同一套判据，在 IDE 里直接调。 |

项目页模块在 manifest 中；team-managed 项目 Jira 不暴露项目页槽位，所以图库里的项目页是标了 `Sample data` 的 fixture。真实租户跑通的是 issue panel、Rovo agent、MCP 三个入口。

这些入口都调同三个只读 action（`get-issue-provenance` / `list-context-debt` / `trace-drift`）；面板经 `@forge/resolver` 进，agent 与 MCP 经 `action` 模块进。没有任何东西算两遍，也没有任何东西在提示词里算。

## 六条判据（事实，不是模型猜测）

| ID | 名称 | 判据 | 权重 |
|---|---|---|---|
| P1 | 无依据 | 既没有授权文档，也没有关联目标 | 25 |
| P2 | **变更未传导** | 授权页在工作开始之后被改过，且此后没有任何确认 | 20 |
| P3 | 依据冲突 | 同一主题下有两份以上授权文档，负责人不同 | 15 |
| P4 | 目标漂移 | 关联目标已关闭（或已过期），工作仍在继续 | 18 |
| P5 | 反复翻案 | 重开 ≥2 次，中间没有新的授权文档 | 10 |
| P6 | 单人无复核 | 授权页只有一个贡献者，且没有第二人复核痕迹 | 8 |

**P2 是英雄判据**，因为它比的是 diff，不是阈值。它不说"这份文档旧了"，它说"这份文档变了，而这个变更没有人往执行的人那边传下去"。

## 三套口径（一个引擎，不同的英雄）

| 口径 | 主问题 | 英雄判据 |
|---|---|---|
| 软件交付 | 这条工作压在哪一个决策上 —— 它还成立吗？ | P2 |
| 发布与营销 | 我们对外的故事，和我们对内议定的是同一个吗？ | P3 |
| 组合治理 | 在飞的这些工作，还在服务账面上那个目标吗？ | P4 |

三套口径的差别在**主问题 + 英雄判据 + 证据的称谓 + 权重 + 阈值**，引擎是共享的。

---

## 唯一一处会写的地方

除了这一处，全是只读。`stampMandate` 只做一件事：加**一条**评论，记录"有人对着这份依据复核过"——复核人、UTC 时间、被复核内容的指纹、依据页链接。

它是一个闭环，不是一次 POST：写完立刻读回（读不到就报 `E_WRITE_UNVERIFIED`），折成 `lastConfirmAt`，再把 `debtBefore / debtAfter` 一起返回。依据页之后再改，`confirmed < decided` 会重新触发 P2，不需要额外记账。

`write:jira-work` 默认是注释掉的；没有它，写端口在构造时就是 `null`，`canWrite` 为 false，按钮根本不出现。`src/ports/write.jira.js` 是 `src/` 里唯一允许出现写动词的文件，`npm run marketplace` 会对这条边界做断言。

---

## 三值证据

一次空的图查询，可能是"确实没有依据"，也可能是"scope 没给 / 调用超时 / 页面没解析出来"。把两者都当成"无依据"，就会在别人的站点上刷出一墙假红 —— 而一面假红，赔掉的是全部信任。

所以每条边只带三种状态之一：`present` / `absent` / `unknown`。

- 只有 `absent` 能触发"无依据"这类断言
- `unknown` 一律压制断言，并且面板会说出来：缺的是哪条边、需要哪个 scope
- 项目扫描永远印覆盖率（"18/25 有据，7 条不可知"），而一条已知边都没有的 bundle **不出分**
- 扫描预算也印出来（"本次扫描 8/25 条 · REST 每次上限 8 条"）——只算了一部分的分数，就是一部分的分数
- 扫描不读评论，所以还会印一句"扫描不读复核痕迹"。单条面板与项目页唯一可能合法不一致的地方，写在页面上让人看见，而不是等人自己发现
- 每个分数都能被拆开：折叠的六行表逐条写着 `hit` / `clear` / `unknown` 与各自权重，命中的权重之和必须等于屏幕上那个数字（有断言）
- 项目页同时回答第二个问题：`债的构成：P1 26% · P2 21%`——按权重贡献算，不按命中次数算，一条 P1（25）不会被两条 P6（8）投掉
- 同一条的并发读会被合并成一次（单飞）；在失效之前出发的读，回来时会被拒写——留痕的分数不会被一条更慢的请求打回原样

一句话：**真相是"看不见"的时候，它绝不说"不存在"。**

---

## 跑起来（不需要 Forge CLI，不需要站点）

```bash
npm run verify       # 187 条断言，输出一行结论
npm run seed:dry     # 自检 seed 判定器（虚构样本）
npm run preview      # 生成 preview/panel.html，双击即看
npm run ui:build     # 打包真正的 Forge 面板 UI（esbuild）
node cli.js          # 列出样本
node cli.js KAN-3    # 一条工作项的交付口径卡片
node cli.js KAN-20 launch   # 同一条，换口径 —— 颜色不同
node cli.js KAN-3 --en     # 英文输出
node bench.js              # 500 条 × 3 口径，p50 30–43ms 区间（7 轮取中位，预算 300ms），报文尺寸
npm run manifest          # 离线校验 manifest 接线（action / tools / handler）
npm run harness           # 重建本地面板 harness（顺带产出 preview/dev/payloads.json）
npm run proof             # 用真实 TAP 输出重新生成 docs/verification.md
npm run corpus            # 21 条语料 × 三口径 → docs/corpus-report.md（顺带校验 manifest 26/26）
npm run docs:check        # 文档里还写着过期断言数就报错
npm run check             # 一次跑全：verify ×2、corpus ×2、bench p50、probe、marketplace
npm run ci                # ui:build + manifest + verify + bench
npm run ci:release        # 上一条 + 上架检查 + 证据文件，一条命令回答"能不能提交"
```

`preview/ui-harness.html` 渲染的是**真面板 UI**（`src/ui/`）打 fixture 报文，不需要 Jira 租户。`?sample=kan11` 看不可知态，`?sample=degraded` 看 REST 降级态（没有 Graph Preview 的试用租户看到的就是这一屏），`?sample=project` 看项目页，`?lang=zh` 看中文。

面板跟系统深色主题走（`prefers-color-scheme`）。Jira 不会替 Forge iframe 反色，所以深色调色板是我们在 `src/ui/style.css` 里自己声明的一套，不是默认就有的。

MCP 客户端实际拿到什么——三个工具的 schema、三次真实请求、三份由 fixture 端口跑出来的响应，以及刻意**不**暴露的东西——见 [`docs/mcp-examples.md`](docs/mcp-examples.md)。站点上注册的图查询必须满足的列契约（每条判据需要哪个字段、字段缺失时会发生什么）见 [`docs/registered-queries.md`](docs/registered-queries.md)。

上真站点之前只有一道闸：**`npm run seed`**。拿 21 条真实工作项填进 `seed/seed-sheet.csv`（判定器 JSON / CSV 都收），它告诉你这些判据在这个站点上到底有没有材料。三条以上是空的，该换的是内容，不是阈值。

`verify` 输出大致长这样：

```
verify 2026-11-20  agent-entry 15/15  cache 4/4  chain 7/7  compact 10/10  contract 9/9  copy 7/7
                   data-inbox 10/10  entry 9/9  golden 2/2  grade-floor 6/6  graph-fields 3/3
                   hardening 11/11  hydrate-batch 6/6  ports 20/20  profiles 4/4  property 4/4
                   robustness 3/3  rules 27/27  score 7/7  surface 4/4  tri 6/6  write 8/8
                   |  total 187/187  => PASS
bench  500 items × 3 lenses · 1500 scores · p50 30.6ms（min 28.7 / max 42.7，7 轮，预算 300ms）· aggregate 927KB → project payload 3KB（上限 200KB）
       issue payload max 2KB · single-score p95 0.08ms
```

`npm run proof` 把上面的输出变成 [`docs/verification.md`](docs/verification.md)：一条断言一行，写明它在守什么。这张表由脚本从真实 TAP 结果生成，不是手写的，所以不会悄悄过期。

`npm run corpus` 把 21 条语料跑过三口径，写成 [`docs/corpus-report.md`](docs/corpus-report.md)：三口径项目级数字并列、等级分布、21 条逐条命中、前排精度（排序页有没有把有缺口的排在前面）、以及引擎与语料自带标签**每一处不一致**。每次运行同时校验 manifest sha256（26/26）。报告第一段就写清"语料是仿真、标签同源，所以 17/17 只证明管道一致，不证明判据正确"——少了这句话，这组数字就是在夸大。

`npm run check` 是唯一该信的命令，而且它**故意跑两遍**：`verify ×2`（断言数与结论必须一致）、`corpus ×2`（报告字节必须一致）、`bench` 取 7 轮中位数、语料探针、上架自证。它只会落在三种结论之一——把这三种混成一个"红"，才会让每次回跑看起来都有问题：

| 结论 | 含义 | 退出码 |
|---|---|---|
| `CLEAN` | 全过 | 0 |
| `CLEAN-EXCEPT-PLACEHOLDERS` | 工程全过；只剩必须有站点/账号才能填的字段（`app.id`、icon URL、支持邮箱、隐私政策地址） | 0 |
| `BLOCKED` | 真回归 | 1 |

`bench` 判定用中位数而不是单次读数：一台在跑别的东西的机器上，这个数会在 67ms 与 330ms 之间摆，拿单次读数卡 300ms 预算，只会把"机器忙"变成假红。

## 目录

```
src/
├─ engine/     归一化 / 三值边 / 六条判据 / 三套口径 / 打分   ← 零 I/O，完全可离线测
├─ io/         报文裁剪（200KB 上限）/ 错误码 / 证据指纹
├─ ports/      chain(twg→rest) / twg / graph client / jira client / rest / hydrate / confirm / fixture / repair / write   ← 一份契约，十个实现
├─ resolvers/  四个 action（agent、MCP、面板共用）
├─ agent/      Rovo agent 提示词 + 三个 action handler（与面板同一契约）
├─ ui/         Forge 面板 + 项目页（自定义 UI，esbuild 打包）
└─ fixtures/   KAN-3 漂移 · KAN-7 冲突 · KAN-9 无依据 · KAN-11 全不可知 · KAN-20 口径差异
test/          187 条断言（rules · tri · profiles · score · compact · ports · chain · entry · agent-entry · copy · hardening · write · robustness · golden · cache · property · contract · surface · data-inbox · grade-floor · graph-fields · hydrate-batch）
verify.js      一条命令跑完
```

## 测试到底钉住了什么

不是"它能跑"，是"这个产品会在哪几种情况下悄悄变错"：

| 风险 | 测试 |
|---|---|
| 超时被报成"没有依据" | `hardening`：失败的边保持 `unknown`；缺 `read:graph:page` 时即便数据回来了，结论也是 `unknown` |
| 一个用户的可见范围泄漏进另一个人的分数 | `hardening`：同一个 key、两个 `userId`，不交叉读；没有 userId 的缓存 key 直接拒绝构造 |
| 25 条的项目变成 25 趟往返 | `hardening`：扫描恰好一次查询；`limit: 999` 被夹到 50 |
| 畸形图数据把面板打成白屏 | `robustness`：200 轮固定种子变异 —— 不抛异常，debt 始终在 0–100，覆盖率自洽 |
| 换一个时区分数就变一天 | `robustness`：同一份 fixture 在 `Asia/Singapore`、`UTC`、`America/Los_Angeles` 得到完全相同的分数 |
| 谁下周"调一下权重"，数字就漂了 | `golden`：5 条 fixture × 3 口径，`debt / grade / flags / coverage` 全部钉死 |
| 没开 Graph Preview 的试用租户看到一屏红 | `chain`：主端口 `E_SCOPE` → 降级端口应答，图专属的边强制 `unknown`，面板印 `degraded {from,to,reason}` |
| agent / MCP 调用打到形状不对的函数 | `agent-entry`：action payload 与 context 合并，`accountId` 只认 `context`，错误以数据形式返回 |
| 新错误码上线却没有一句给人看的话 | `copy`：`errors.CODES` 里每个码在中英文都必须有标题与正文 |
| 留痕写了评论，分数一动不动 | `write`：评论 → `lastConfirmAt` → `debtBefore 28 / debtAfter 8`，走真实 ADF 往返 |
| 重试一次就写出第二条留痕 | `write`：指纹不含 `lastConfirmAt`，第二次返回 `skipped` |
| 写成功其实读不回来 | `write`：报 `E_WRITE_UNVERIFIED` 而不是打绿勾；500 报 `E_SERVER`，不冒充"没有权限" |
| REST 扫描号称不 N+1 却发了 51 个请求 | `ports`：20 个 id 进来，JQL 只问 8 个，`getIssue` 只调 8 次；项目页印「8/25 已扫描」 |
| 面板与 agent 同一秒打开同一条，打两次图查询 | `cache`：五个并发读只执行一次 loader；失败立即释放，下一次可重试 |
| 留痕之后，一条更慢的读把分数打回旧值 | `cache`：出发时的世代 token 与当前不符则拒写；`dropWhere` 同时清掉在途项 |
| 面板写着 28，却没人能说清另外四条为什么是 0 | `score` / `compact`：`criteria` 六行与 `flags` / `skipped` 严格对齐，`hit` 权重和 == `debt` |
| 项目页只说"债很多"，说不出是谁在制造债 | `score`：`drivers` 按权重贡献排序，P1(25) 必须排在 P2(20) 之前 |
| 随便换一份数据，某条不变式就破了 | `property`：200 个随机 bundle × 三镜头，十条不变式；分数不越 71 的天花板 |
| 换端口（TWG→REST）上层就要改代码 | `contract`：同一份契约跑三个端口，失败一律降级为 unknown 且不抛 |
| 面板说 28、agent 说"不可知"，同一条工作项两个答案 | `surface`：四个入口（面板 / resolver / agent / MCP）对同一输入给出同一份 debt、grade 与六行判据 |
| 证据页回来了，但没有更新时间 / owner / 贡献者名单，被判成"没命中" | `rules` 的 `gaps`：字段缺失一律 `unknown`，`why` 带出具体字段名；`normalize` 记录 `contributorsKnown` |

另有 11 条重试语义：429 会重试，`E_SCOPE` 重试零次（权限问题不是天气），单条 REST 失败不会把整个列表清空。

`node bench.js` 报的是真实工作量的形状：`500 条 × 3 口径 · 1500 次打分 · 约 43ms · aggregate 735KB → 项目报文 2KB · 单条报文最大 2KB（上限 200KB）· 单条 p95 0.02ms`。

## 决策，以及被否掉的选项

[`docs/adr/`](docs/adr/) 里十九篇短记录：三值证据 · 两种查询形状 · agent 从不算数 · 缓存 key 含用户 · 不用外部模型 · 默认只读 · 单端口降级 · 图只走已注册查询 · 留痕必须读回 · 扫描预算 · 单飞与世代拒写 · 分数必须可整除 · 天花板是 71 · 读不按 scope 门控 · 扫描一行就是一条工作项 · 缺字段就是 unknown · 主判据看不见就不出等级 · 项目页补水一条 JQL · 选择集被拒退 basic、403 不退。每一篇都写明了被否掉的选项和原因 —— 包括那些"上线更快"的选项。

## 明确不做

- **不做 workflow gate** —— 那就变成又一个审批插件，还会打断评审自己的测试流程
- **不做批量写回** —— 只有一次幂等的留痕，且卡在第 13 项验收之后
- **不用外部 LLM** —— 语义归 Rovo，打分必须可复现
- **不做数据模型多语言 / 多租户 / 计费包装** —— 买不到分的工程
- **不写"快 X%"** —— 没有样本的数字，任何评审一眼就能拆掉

## 已知边界

- Teamwork Graph 只读；写入走 Jira REST，`write:jira-work` 在 v1 里是关着的
- 页面编辑时间与贡献者集合只有 TWG 有；走 REST 降级时 P2/P6 报 `unknown`，不猜
- `manifest.yml` 的接线由 `npm run manifest` 离线校验（action → function → handler 导出、`mcp.tools` → action key）；`forge lint` 本身要登录和已注册的 app id
- 图访问需要两条已注册的持久化查询（`MANDATE_QK_BUNDLE` / `MANDATE_QK_SCAN`）。没有它们，应用走 Jira REST 并说明原因 —— 它不会失败
