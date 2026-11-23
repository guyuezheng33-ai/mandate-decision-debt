# Marketplace listing · 文案与截图脚本

上架界面以英文为主，下面英文可直接粘；中文只供核对。

## 1. 基础字段

- **Name**：Mandate — Authority Audit for Jira
- **Tagline（短描述）**：Who approved this — and is that approval still valid?
- **Category**：Productivity；次选 DevOps
- **Support email**：guyuezheng33@gmail.com
- **Privacy policy**：https://telegra.ph/Privacy-Policy--Mandate-11-23
- **Terms of service**：https://telegra.ph/Terms-of-Service--Mandate-11-23
- **Pricing**：Free（收费会带 license，直接和"评审能装"冲突）

## 2. 长描述（英文，直接粘）

```
Every Jira item is supposed to rest on a decision: a page, a goal, a review trace. The
question a delivery lead actually needs answered is narrower and harder: who authorised
this, in which document, when was that document last changed — and does the authorisation
still hold today?

Mandate answers it as an authority receipt, not a dashboard.

Open any issue and the first screen is a verdict: CURRENT, NOT CURRENT, CONTESTED,
NO RECORD, or UNVERIFIABLE. Under it, four facts:

• Authorised by — the owner behind the decision.
• Last changed — the date the decision record was last edited.
• Recorded in — the exact page that authorises the work.
• Still valid — whether anything confirmed the decision after that change.

The reason line states the gap in one sentence ("92 days since last change · no
re-confirmation recorded"), and the score is a small chip in the corner: 28, Decision
Debt, watch. The evidence stays the headline; the number is the footnote.

Expand "6 checks" and the chip can be taken apart. Six criteria, each marked counted,
clear, or not judged, each with its weight. The weights that counted must sum to the
number on screen (20 Change not propagated + 8 Single author, no review = 28). A score
you cannot audit is just an opinion with a font.

The six criteria are facts, not model guesses:

• No mandate — no linked decision page and no goal.
• Change not propagated — the decision page was edited after work started, and nobody
  confirmed since.
• Conflicting mandates — two pages describe the same topic with different owners.
• Goal drift — the linked goal has ended, but the work is still moving.
• Repeated reversal — reopened twice or more with no new evidence.
• Single author, no review — one contributor, no second reviewer trace.

Where it differs from a status report: it distinguishes "absent" from "unknown". If a
permission is missing, a query times out, or a page cannot be parsed, Mandate suppresses
the finding and shows exactly which scope is missing — instead of painting the project
red for data it never saw. Coverage is always displayed, and when nothing is knowable it
refuses to produce a score: UNVERIFIABLE, NO SCORE. Unknown is not clean.

The project page holds the same line. PROJECT AUTHORITY prints coverage before the score
("4/5 countable · 1 unknown"), then one row per item, each carrying its own verdict.
An item with no score names the edges it could not see. If the scan hits a budget, it
prints that too ("8 of 25 scanned · REST caps at 8 per load"). It never averages a
missing half into a comfortable number.

Works as a Jira issue panel, a project page, a Rovo agent, and an MCP server. The same
three read-only actions return the same receipt inside Jira, in chat, and in your IDE.
The agent does not compute a score; it selects an action and restates the engine's rows,
coverage and caveats. One engine, four surfaces.

Mandate is read-only in this release. It never edits, transitions, or deletes anything,
and it never sends your data to an external model — scoring is deterministic and runs
inside Forge. The index is bounded by construction: two criteria are mutually exclusive,
so the top of the scale is 71 rather than 100. Trace stamping exists behind an optional
write:jira-work scope that this release does not request; without it the button is not
rendered at all.
```

## 3. 中文核对（不必提交）

每条工作项都该能回答：谁授权的、在哪份文档、那份文档最后什么时候改的、今天还成不成立。Mandate 首屏是一张授权收据：先给判决（CURRENT / NOT CURRENT / CONTESTED / NO RECORD / UNVERIFIABLE），再给四格事实（授权人 / 最后修改 / 依据页 / 是否仍有效），分数只做右上角小注脚。六条判据可展开、可加总；看不到就抑制并说明缺哪条边，全不可知时拒绝出分。

## 4. Scope 合理性说明（逐条填进控制台）

**read:jira-work**
Needed to read issue keys, summaries, status, links and the timestamps that anchor every
finding (work start, reopen counts, issue completion).

**read:graph:issue:jira**
Needed to resolve issue → decision page and issue → goal edges. Without it the app cannot
distinguish "no mandate" from "mandate unknown".

**read:graph:page:confluence**
Needed for page owner, last-updated time and contributor list. These three fields are the
entire input of the "change not propagated" and "single author" checks.

**read:graph:user:atlassian**
Needed to resolve contributor identity, so the app can count how many distinct people
authored or reviewed a decision page. No profile data is displayed beyond display name.
When the scope is not granted, P6 is suppressed and reported as unknown
(reviewTraces-scope-missing) — the app does not ask for team membership, because no check
needs a roster.

> The app requests no storage scope: the selected lens lives in the UI session only.
> There is nothing to persist, so nothing is claimed.

## 5. 截图脚本（三张必需 + 一张可选）

> 全部用真界面拍。本地可用 `preview/ui-harness.html`（真 UI + fixture 数据，图注写
> `Sample data`）；上线后用 Jira 里的 issue 面板与项目页。不要用旧 `preview/panel.html`。

**图 1（决定性的一张）**
画面：KAN-3 授权收据首屏。
必须出现：`AUTHORITY RECEIPT`、`NOT CURRENT`、`Authorised by Alice Ng`、`Last changed 14 Aug 2026`、`Recorded in Archive policy…`、`Still valid No`、`92 days since last change · no re-confirmation recorded`、右上角 `28 DECISION DEBT WATCH`。
目的：两秒内让 reviewer 看到"谁 / 哪份 / 何时 / 还有效吗"，而不是一张仪表盘。

**图 2（信任）**
画面：KAN 项目页。
必须出现：`PROJECT AUTHORITY`、`24`、`watch`、`4/5 countable · 1 unknown`、`CONTESTED` / `NO` / `NO RECORD` / `UNKNOWN` / `YES` 五种行标签、`KAN-11 – NO SCORE`。
目的：证明它先印覆盖率，再印分数；看不到的条目不装成干净。

**图 3（边界）**
画面：KAN-11。
必须出现：`UNVERIFIABLE`、`NO SCORE`、四格全 `Unknown`、下一步 `Restore access… then recompute`。
目的：证明"未知"不是"没有问题"。

**图 4（入口，可选但建议）**
画面：Rovo agent 回答。
必须出现：先覆盖率、再结论、最后一条下一步；不要出现 agent 自己算分的数字。
目的：证明 agent 调的是同一批 action，不是聊天壳。

**图 5（深色，可选）**
画面：项目页或收据在深色主题下（`?theme=dark`）。
必须出现：与浅色版相同的四格与覆盖率。
目的：Jira 大量用户用深色主题；证明不是贴在深色页面上的一块白板。

## 6. 提交前最后一分钟核对

- 隐私政策 URL 能匿名打开
- 图标 144×144 清晰，48×48 也能看清
- 四条 scope 说明与代码真实使用一致
- listing 里没有"提升效率 X%"这类没有样本的数字
- production 版本装到干净站点后，第一条红能在 10 秒内出现
- 截图里出现的 `28 / 24 / NO SCORE` 与 `docs/evaluation.json` 或 fixture 可以逐一对上

