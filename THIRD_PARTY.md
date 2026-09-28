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
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | markedjs/marked（npm `marked@16.4.2`） | v16.4.2 | MIT | `lib/marked.esm.js`、`LICENSE.md` | `ui/vendor/marked.esm.js`、`ui/vendor/LICENSE.marked.md`（U4 渲染管线——模型产出 markdown 渲染） | 否（原样复制） | 2026-09-29 |
| 2 | highlightjs/highlight.js（npm `highlight.js@11.12.0`） | v11.12.0 | BSD-3-Clause | `lib/common.js`、`LICENSE` | `ui/vendor/highlight.esm.js`（esbuild bundle 成浏览器 ESM——含 36 common 语言）、`ui/vendor/LICENSE.highlight.js`（U4 代码块高亮） | 是（仅打包形态：CJS → ESM bundle，库本体零修改） | 2026-09-29 |

## 许可分级实况（2026-09-23 实测）

### 可参考实现（MIT / Apache-2.0）
| 仓库 | 许可 |
| --- | --- |
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
| --- | --- | --- |
| vastsa/PI-Desktop | **LGPL-3.0** | 可链接调用；若修改库本体并分发须回馈。**不要**把其代码整段复制进 `src/` |
| anthropics/claude-code | **PROPRIETARY** | `© Anthropic PBC. All rights reserved. Use is subject to Anthropic's Commercial Terms of Service`。**只能读官方文档与公开产品行为，一行代码都不能摘** |

### ⚠️ 授权矛盾 —— 需人工确认，暂按最保守处理

`anthropics/claude-code` 仓内两个插件的 README 自称 MIT，但仓根 `LICENSE.md`
是全球保留权利 + 商业条款，且 `plugin-dev/README.md` 的 "MIT License - See repository
for details" 正好指回那份专有许可：

| 路径 | README 声明 | 冲突点 |
| --- | --- | --- |
| `plugins/hookify/README.md` | "MIT License" | 仓根 LICENSE.md 为专有 |
| `plugins/plugin-dev/README.md` | "MIT License - See repository for details" | "details" 指向专有许可 |

**当前处理：只读行为，不复制代码。** 若日后确实要复用 hookify 的 hook 设计，
应联系作者（`plugin-dev` 署名为 Daisy Hollman, daisy@anthropic.com）取得书面澄清。

## 排除清单（禁止阅读/引用）

**2026-09-23 扫描结果：无仓库需要排除。**

16 个仓（`oss/` 15 + `refs/` 1）全部通过：

| 检查项 | 结果 |
| --- | --- |
| 泄露镜像 / 自述源自 leaked Claude Code | 0 命中 |
| 缺少 LICENSE 文件 | 0（16/16 有许可文件） |
| 专有 sourcemap（非 node_modules） | 0 |
| 明确 clean-room 声明 | 7 个：codex、deepseek-harness、mini-swe-agent、pi、pi-mono、pideck、qwen-code |

初版检测正则含裸词 `leaked`，曾命中 8 个仓十余处。**逐条查证全是普通技术用语**，
与泄露源码无关，例如：

- `deepseek-harness`：`a leaked --config/-p/--resume`（CLI 参数在子命令间串味）
- `hermes-agent/compat`：`leaked loop variables`；`gateway/AGENTS.md`：`a leaked allowlist`
- `pi/packages/agent/docs/harness.md`：`values leaked by outcome/terminal cleanup`
- `zcode/.agents/skills/agent-browser/SKILL.md`：`avoid leaked processes`
- `claude-official/CHANGELOG.md`：`leaked agent worktree registrations`

正则已收紧为**必须与 `claude`/`anthropic` 同现**，复扫 16 仓 0 命中。

> 注意：`claude-official` 无 clean-room 声明且为专有许可 —— 这是**正常**的，
> 它是 Anthropic 官方仓而非第三方复刻品，但约束仍是「只读行为，不摘代码」。

排除标准（供后续新增仓库时复用）：泄露镜像 / 无许可证 /
README 自述源自 leaked Claude Code 且含专有源码。
