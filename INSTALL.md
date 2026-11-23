# INSTALL · Mandate

目标：**陌生人 10 分钟内装通，并看到第一条红。**

## 0. 前置

- Node ≥ 20（本项目在 Node **22.23.2** 上验证）
- 一个 Atlassian 站点（免费开发站在 Rovo 上有限制，见第 4 节）
- Forge CLI：**请装 14.2.0**，`npm i -g @forge/cli@14.2.0`

> 实测：最新的 15.1.0 要求 Node `^22.23.4`，本机 22.23.2 会直接被 CLI 拒绝启动。
> 要么把 Node 升到 22.23.4+，要么留在 14.2.0——两者都能部署，14.2.0 已验证 manifest 通过 schema 校验。
>
> 非交互环境（脚本/CI）第一次跑 `forge` 会卡在"是否同意数据收集"：先执行
> `forge settings set usage-analytics false` 再继续。

## 1. 注册并填 app id

本仓库已经完成注册，真实 App ID 已写入 `manifest.yml`：

```text
ari:cloud:ecosystem::app/c3df8fe6-3626-4829-9025-47d55b1bde54
```

所属 Developer Space：`Mandate`（`f2825e6e-0e45-4034-beb1-edcdd176204f`）。
如果要在一个新账号上重做：

```bash
cd decision-debt
forge developer-spaces list
forge register mandate-decision-debt -s <developer-space-id> -y
```

`forge register` 会把真 App ID 写回 `manifest.yml`。注册成功后先跑 `forge lint`，不要手填 app id。

## 2. 本地先跑断言（不依赖站点）

```bash
npm install           # 依赖已锁版本；如只跑验证可加 --ignore-scripts
npm test              # 179 个单元测试
npm run verify        # 179 条离线断言
npm run ui:build      # 打包真正上架的 issue 面板（src/ui/index.js）
npm run seed:dry      # 自检 seed 判定器（虚构样本，应输出"内容冻结"）
npm run preview       # 生成 preview/panel.html，直接双击看面板长什么样
```

看到 `=> PASS` 再往下。这一步失败说明代码或 fixture 有问题，与站点无关。

### 2.1 在没有 Jira 站点的情况下看**真界面**

`preview/ui-harness.html` 把 `src/ui`（真正上架的那套自定义 UI）用 fixture payload 渲染出来：

| 打开方式 | 看到什么 |
|---|---|
| `preview/ui-harness.html` | KAN-3，Delivery 口径，P2 命中 |
| `...?sample=kan11` | 全不可知：不出分、不报问题（信任设计的关键一屏） |
| `...?lang=zh` | 中文 locale |
| 点 `Launch & marketing` / `Portfolio` | 同一份数据换口径，权重与称谓立刻不同 |

改动 `src/ui/` 后要重新打包两样：`npm run ui:build`（上架包）与
`npx esbuild src/ui/src/app.js --bundle --format=iife --alias:@forge/bridge=./preview/dev/shim.js --outfile=preview/ui-harness.js`
（本地预览包）。`node preview/emit.js` 负责把 fixture 结果落成 `preview/dev/payloads.json`。

## 3. 部署

当前已验证的实例：

```text
App:            mandate-decision-debt
Environment:    development
Version:        2.0.0
Demo site:      one-atlas-ngpq.atlassian.net
Installed in:   Jira + Confluence
```

从零重跑：

```bash
forge lint
forge deploy -e development
forge install -p Jira -s <站点>.atlassian.net -e development
forge install -p Confluence -s <站点>.atlassian.net -e development
```

> 应用同时请求 Jira 与 Confluence 的 graph scope，所以必须在同一个站点分别安装 Jira 和 Confluence；只装 Jira 会提示 `requires scopes across multiple Atlassian apps`。
> `forge lint` 分两段：schema 校验不需要登录，资源路径与 rovo 模块的深检查需要登录后才会跑。
> 实测 14.2.0 的 schema **不接受** `app.runtime.memoryMiB` / `app.runtime.storage`，写了会报 `valid-document-required`。

安装时按提示授权 scope。**Teamwork Graph 的 scope 是逐项授予的**，如果管理员只给了一部分，
应用仍会启动，只是那部分边会显示"不可知"——这是设计好的降级，不是 bug。

## 4. 环境差异（评审最可能踩的三个坑）

| 情况 | 现象 | 处理 |
|---|---|---|
| 免费开发站没有 Rovo | agent 面板不出现 | 面板与 MCP 之外的入口不依赖 agent，功能仍完整 |
| 只授权了 Jira scope | 依据链只有链接、没有页面更新时间 | 顶部提示"降级模式"，P2/P6 显示"不可知"而不是报红 |
| 站点没有 Goal 数据 | P4 始终不命中 | 组合治理口径会整体变弱，属预期行为 |

## 5. 三分钟验收（装完就做这三件）

1. 打开任一条有 Confluence 链接的工作项 → 面板应显示依据卡；若显示"不可知"，去看第 4 节的 scope 说明
2. 点开 `KAN-3` 类样本（或用 `node cli.js KAN-3` 对照）→ 漂移卡应给出"变更时间 / 相隔天数 / 未确认"
3. 打开项目概览 → 应看到"本页覆盖 x/y 项，n 项不可知"这一行

## 6. 线上（production）分享给评审

```bash
forge deploy -e production
forge install --upgrade --site <站点> -e production
```

注意：**已提交 Marketplace 上架（或 manifest 里带 license）的 app，不能用安装链接分享**。
若要走评审分享链接，需要一个不带 license 的副本；这条规则在提交前必须再核对一次官方 distribute 页。

## 7. 只跑引擎（给评审复现用）

```bash
node cli.js KAN-7            # 冲突 + 目标漂移 + 反复翻案
node cli.js KAN-11           # 全不可知：不出分、不报问题
node cli.js KAN-20 launch    # 同一份数据换口径
```
