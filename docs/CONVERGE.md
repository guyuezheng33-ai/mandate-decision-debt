# Converge 验收口径（已签字）

**签字人**：用户  
**签字时间**：2026-11-22  
**签字内容**：A —— 按 Node/Forge 口径验收，不添加 Python 模块凑数。  
**产品**：Mandate / Decision Debt（`D:\桌面\Codegeist 2026\decision-debt`）

---

## 1. 两个口径，两个结果

| 口径 | 参数 | 结果 | 退出码 |
|---|---|---|---|
| 工具默认（Python 口径） | 无 | 5/6 | 4 |
| 已签字（Node/Forge 口径） | `--params modules=0 --params services=0` | **6/6** | **0** |

默认口径唯一未过项是 `scale.modules`：`0 / 下限 8`。  
原因在工具本体，不在产品：

- `D:\桌面\产品锻造台\soldieros\core\spec.py:161`：`modules = len(scan.py())`，只统计 `.py` 文件。
- Mandate 是 Node/Forge：`src/**/*.js` 实际 **29 个模块**（27 个核心 + 2 个 UI），`.py` 文件 **0 个**。
- `services` 同理按 Python 关键字计数；Mandate 的真实服务入口是 `manifest.yml` 的 **3 个 Forge actions**（`mandate-act-provenance`、`mandate-act-project`、`mandate-act-drift`）。

## 2. 为什么这不是降低标准

签字口径只关掉两个 **生态不匹配** 的计数，不关掉真实体量约束：

| 真实约束 | 实际值 | 状态 |
|---|---|---|
| 代码行数 `loc` | 11,710（下限 2,000） | 过 |
| 测试函数 `tests` | 181（下限 10） | 过 |
| 五层实现 | 数据 / 治理 / 计算 / 服务 / 呈现 全部“真的” | 过 |
| 全链管道 | 离线入库 → 清洗 → 版本化 → 在线查询，全链可跑 | 过 |

**没有新增任何 Python 文件，也没有调低 `loc` / `tests` 下限。**

## 3. 可复现命令

```powershell
cd "D:\桌面\产品锻造台"
& ".\.venv-dev\Scripts\python.exe" -m soldieros converge `
  --project "D:\桌面\Codegeist 2026\decision-debt" `
  --params modules=0 --params services=0 `
  --json "D:\桌面\产品锻造台\runs\decision-debt\converge-signed.json" `
  --md   "D:\桌面\产品锻造台\runs\decision-debt\converge-signed.md"
```

预期：`收敛（6/6 项过）`，退出码 `0`。

## 4. 产物

- 签字口径：`D:\桌面\产品锻造台\runs\decision-debt\converge-signed.json` / `.md`
- 默认口径原始记录：`D:\桌面\产品锻造台\runs\decision-debt\converge.json` / `.md`（保留 5/6，不覆盖）
- Node 口径诊断：`converge-node.json` / `.md`

## 5. 什么会推翻这个签字

- 往产品里加 8 个仅用于凑数的 `.py` 文件；
- 把 `loc` 或 `tests` 下限调低；
- 五层出现“壳”或管道断链；
- 真实 Node 模块数低于 8 或 Forge actions 少于 2。

以上四条，任何一条出现，签字口径作废，回退到默认口径重新验收。
