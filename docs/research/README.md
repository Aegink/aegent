# 调研产出索引

> 快照日期 **2026-09-23**，对应 `oss/SOURCES.lock`。上游在活跃演进
> （本次快照 15/16 的仓提交日在 2026-09-21~23），**引用前先核对 commit**。

| 文件 | 内容 |
|---|---|
| [`01-conclusion.md`](01-conclusion.md) | **结论（1 页）** + 排除清单 + 建议 star 不 fork 的仓 + 验证命令 |
| [`02-comparison.md`](02-comparison.md) | **分层对比总表** A–N × 10 个仓 + 自研默认选型列 |
| [`03-conflicts.md`](03-conflicts.md) | **9 处冲突与决策**（含推翻条件） |
| [`04-module-map.md`](04-module-map.md) | **自研模块映射**：P0 17 个文件 + P1/P2 + 接口草稿 + 不变量 |
| [`00-inventory.md`](00-inventory.md) | 本机仓库盘点（由 `tools/inventory.sh` 生成） |
| [`cards/pi.md`](cards/pi.md) | 仓库卡片 · pi（内核候选） |
| [`cards/opencode.md`](cards/opencode.md) | 仓库卡片 · opencode |
| [`cards/batch-2.md`](cards/batch-2.md) | 仓库卡片 · DSH / codex / kimi / qwen / grok / hermes / pi-desktop / pideck / zcode |

## 复现方式

```bash
bash tools/snapshot.sh        # 刷新上游 commit 快照
bash tools/license-audit.sh   # 复查许可与泄露
bash tools/inventory.sh       # 重新盘点
bash tools/probe-repo.sh oss/pi   # 单仓结构探针
```

## 未克隆的仓（报告中不得分析）

`earendil-works/pi-subagents`、`earendil-works/pi-mcp-adapter`、`QwenLM/qwen-paw` —— 三个均 `ls-remote` 验证**不存在**。
另克隆了 4 个补充仓：`pi-mono`、`mini-agent`、`mini-swe-agent`、`agentscope`（未出卡片，需时再补）。
