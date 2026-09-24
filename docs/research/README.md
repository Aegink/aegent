# 调研文档地图

> **先读 `docs/requirements.md`**（要做什么）与 `docs/reference-cases.md`（照着谁做）。
> 本目录是**"为什么"**——做某条需求时如果想知道背后的论证、事故与取舍，来这里按主题找。
>
> 快照 **2026-09-23**，对应 `oss/SOURCES.lock`。上游活跃演进，**引用前先核对 commit**。

## 按主题（整理后：同一主题只有一份文件）

| 文件 | 覆盖 | 主要喂给 |
| --- | --- | --- |
| [`00-inventory.md`](00-inventory.md) | 本机仓库盘点（`tools/inventory.sh` 生成） | — |
| [`01-conclusion.md`](01-conclusion.md) | 结论（1 页）+ 排除清单 + 验证命令 | 全局 |
| [`02-comparison.md`](02-comparison.md) | **分层对比总表** A–N × 10 仓（早期轮次，O–T 四层是后加的） | 全局选型 |
| [`03-conflicts.md`](03-conflicts.md) | **9 处冲突与决策**（含推翻条件） | 全局 |
| [`04-module-map.md`](04-module-map.md) | **自研模块映射**：P0 文件 + 接口草稿 + **不变量** | 全局 |
| [`05-architecture-principles.md`](05-architecture-principles.md) | **★ 决策记录精读所得**（DSH 1177 篇 + pi-desktop 321 篇 ADR）—— **密度最高的一份** | A B C D E F L M Q |
| [`06-claude-code-official.md`](06-claude-code-official.md) | Claude Code **官方可参考部分**（hook 词汇表 90 个 / turn 契约 / 权限判定 / 洋葱链 / surface roster）。**法律边界见文首** | A C F K L N |
| [`07-permission.md`](07-permission.md) | **★ 权限域深读**（三轮合并）：kimi 8 模块 / 第四值 / qwen 权限词汇表 / LLM 判官 / pi-desktop 严格分层 / DSH 两根正交旋钮 | **C 层全部** |
| [`08-kernel-deep-read.md`](08-kernel-deep-read.md) | 最小实现（190 行）/ **qwen shell 语义** / hermes 审批两处工程细节 / pi-mono 分叉 | A C H |
| [`10-zcode.md`](10-zcode.md) | **ZCode 深读**（三轮合并）：形态最接近我方的仓。架构即代码 / CONTEXT.md / owner+lease / turn 状态机 10 相位 / 压缩抖动 / 执行点重算 | A E N T |
| [`11-codex.md`](11-codex.md) | **★ Codex 深读**（两轮合并）：`max()` 权限聚合 / execpolicy / guardian / RwLock 准入 / **Windows 双账户+WFP** / **压缩是生命周期 + 编号窗口 + 预算送达 + 日志 zstd** | **C D F M Q** |
| [`13-kimi-code.md`](13-kimi-code.md) | **kimi-code 深读**（两轮合并）：自研 tree-sitter-bash / 权限 11 目录 / 四层 AND / 配置 linter / 三台状态图 / 重试分类 | A B C J |
| [`14-dsh.md`](14-dsh.md) | **DSH 代码深读**：38 个 `invariant.ts` / 超时独立库 / 工具配对切点 / `escalation.ts` | B D E J M |
| [`15-pi-desktop.md`](15-pi-desktop.md) | **PI-Desktop 代码深读**（**LGPL，只学行为**）：启动期对账 / `config_sync/` / 插件安装期校验 | D I K M Q |
| [`20-testing.md`](20-testing.md) | **★ 测试深读**（三轮合并）：网络边界 mock / 归一化实现 / 真实快照长相 / 事件序列不变量 / 序列化时差分 / 全局态隔离 | **O 层全部** |
| [`30-round-log.md`](30-round-log.md) | 第 5–9 轮**原始记录**（从需求文档搬出，备查） | 过程追溯 |
| [`cards/`](cards/) | 仓库卡片 · [pi](cards/pi.md) · [opencode](cards/opencode.md) · [cc-switch](cards/cc-switch.md) · [batch-2](cards/batch-2.md) | 快速概览 |

## 整理说明（2026-09-24）

原先按**轮次**编号，同一主题散在多份文件里（找东西要先知道"哪一轮读过"）。
现按**主题/仓**合并，**内容未改写，仅合并标题层级**：

| 合并后 | 由哪些文件合并 |
| --- | --- |
| `07-permission.md` | `07-kernel-permission-models` + `09-permission-vocabulary-deep` + `16-permission-domain-deep` |
| `10-zcode.md` | `10-zcode` + `12-zcode-agent-loop` + `19-zcode-execution` |
| `11-codex.md` | `11-codex` + `17-codex-compact-persistence` |
| `13-kimi-code.md` | `13-kimi-code` + `18-kimi-loop` |
| `20-testing.md` | `20-testing` + `21-test-assertions-deep` + `22-test-impl-three` |

被合并掉的编号（`09` `12` `16` `17` `18` `19` `21` `22`）成为空号；git 历史仍可追溯。

## 复现方式

```bash
bash tools/snapshot.sh        # 刷新上游 commit 快照
bash tools/license-audit.sh   # 复查许可与泄露
bash tools/check-doc-links.sh # 校验文档里所有链接
bash tools/count-features.sh  # 按层统计功能项数
bash tools/inventory.sh       # 重新盘点
bash tools/probe-repo.sh oss/pi   # 单仓结构探针
```

## 未克隆的仓（报告中不得分析）

`earendil-works/pi-subagents`、`earendil-works/pi-mcp-adapter`、`QwenLM/qwen-paw` —— 三个均 `ls-remote` 验证**不存在**。
另克隆了 4 个补充仓：`pi-mono`、`mini-agent`、`mini-swe-agent`、`agentscope`（未出卡片，需时再补）。
