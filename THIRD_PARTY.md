# 第三方许可与引用登记

本文件登记**我方代码/文档中实际引用的**第三方实现或代码片段。

> 仅克隆阅读**不产生**登记义务 —— 阅读参考不等于再分发。
> 一旦把上游代码复制进 `src/` 或报告，**必须**在此登记。
>
> 完整许可快照见 `oss/SOURCES.lock`（由 `tools/snapshot.sh` 生成）。

## 登记规则

1. 复制代码前先确认上游许可证允许。
   - MIT / Apache-2.0 / BSD → 可复制，保留版权头
   - LGPL → 可动态链接调用；**修改库本身**并分发才需回馈修改
   - GPL / AGPL / PROPRIETARY / 无许可 → **只学行为，不复制代码**
2. 复制时必须**保留原始版权头**，不得删除或改写。
3. 在下表登记：上游仓库、commit SHA、许可证、被引用文件、我方使用位置。
4. 修改过的代码注明「已修改」。

## 引用清单

| # | 上游仓库 | Commit | 许可证 | 引用文件 | 我方位置 | 是否修改 | 日期 |
|---|---------|--------|--------|---------|---------|---------|------|
| — | *(暂无)* | | | | | | |

## 许可分级实况（2026-09-23 实测）

### 可参考实现（MIT / Apache-2.0）
| 仓库 | 许可 |
|------|------|
| earendil-works/pi | MIT |
| anomalyco/opencode | MIT |
| deepseek-ai/deepseek-harness | MIT |
| MoonshotAI/kimi-code | MIT |
| NousResearch/hermes-agent | MIT |
| lue-labs/pi-mono | MIT |
| ayuayue/PiDeck | MIT |
| MiniMax-AI/Mini-Agent | MIT |
| SWE-agent/mini-swe-agent | MIT |
| openai/codex | Apache-2.0 |
| QwenLM/qwen-code | Apache-2.0 |
| zai-org/ZCode | Apache-2.0 |
| xai-org/grok-build | Apache-2.0 |
| modelscope/agentscope | Apache-2.0 |

### ⚠️ 受限：需谨慎处理

| 仓库 | 许可 | 约束 |
|------|------|------|
| vastsa/PI-Desktop | **LGPL-3.0** | 可链接调用；若修改库本体并分发须回馈。**不要**把其代码整段复制进 `src/` |
| anthropics/claude-code | **PROPRIETARY** | `© Anthropic PBC. All rights reserved. Use is subject to Anthropic's Commercial Terms of Service`。**只能读官方文档与公开产品行为，一行代码都不能摘** |

### ⚠️ 授权矛盾 —— 需人工确认，暂按最保守处理

`anthropics/claude-code` 仓内两个插件的 README 自称 MIT，但仓根 `LICENSE.md`
是全球保留权利 + 商业条款，且 `plugin-dev/README.md` 的 "MIT License - See repository
for details" 正好指回那份专有许可：

| 路径 | README 声明 | 冲突点 |
|------|-----------|--------|
| `plugins/hookify/README.md` | "MIT License" | 仓根 LICENSE.md 为专有 |
| `plugins/plugin-dev/README.md` | "MIT License - See repository for details" | "details" 指向专有许可 |

**当前处理：只读行为，不复制代码。** 若日后确实要复用 hookify 的 hook 设计，
应联系作者（`plugin-dev` 署名为 Daisy Hollman, daisy@anthropic.com）取得书面澄清。

## 排除清单（禁止阅读/引用）

| 仓库 | 排除原因 | 日期 |
|------|---------|------|
| *(由 `tools/license-audit.sh` 扫描后填写)* | | |

排除标准：泄露镜像 / 无许可证 / README 自述源自 leaked Claude Code 且含专有源码。
