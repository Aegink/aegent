# 仓库卡片 · 第二批

> 格式与 `pi.md`/`opencode.md` 一致（固定动作 10 项）。commit 见 `oss/SOURCES.lock`。

---

# deepseek-harness — deepseek-ai/deepseek-harness

`0010283` · MIT · 162M · Node/TS · 收 PR · 有 clean-room 声明

1. **许可**：MIT (`Copyright (c) 2026 DeepSeek`)。有 AGENTS.md / CLAUDE.md / SAFETY.md / CONTRIBUTING（含中英双语 + `.i18n.yaml`）。
2. **分层**：**按关注点拆包**，粒度最细。`packages/` 含 `acp` `api` `attachment` `boot` `browser-use` `client` `compaction` `computer-use` `context` `core` `credentials` `deliverables` `document` `extensions` `feedback` `fs` `goal` `guard` `hooks` `host` `identity` `interaction` `jobs` …（30+ 包）。**一个关注点一个包。**
3. **Loop**：`apps/cli` 三入口共用同一 Commander program：`runTui(config,resume)` / `runHeadless(task)` / `runWeb(host,port,dev,workspaceRoot)`，模式在 CLI 适配层解析后交各自 runner。`packages/boot/app-boot/src/index.ts`
4. **工具**：`packages/core/tools`；**工具即独立包**（`packages/goal/tool-goal`、`packages/jobs/tool-jobs`）→ 可独立发布与版本化。
5. **会话**：`packages/session` + `packages/core/session` + `packages/api/session-controller` + `packages/context/session-reference`（**会话可被其他会话引用**）。
6. **扩展**：`packages/hooks` + `packages/extensions` + `packages/acp`。
7. **多端**：`packages/acp` + `packages/api/session-controller` + `packages/identity`（**身份独立成包**）。
8. **安全**：`packages/guard`（策略）+ `packages/interaction/permission-presets`（**权限预设成套可切换**）+ **`packages/sandbox/{sandbox,sandbox-local}`（真沙箱，可插后端）**。有 SAFETY.md。
9. **可复用 vs 只学**：可复用（MIT）goal/jobs 的包拆分方式、可插沙箱后端的接口形状。只学行为：30+ 包的依赖编排——**粒度太细，直接搬会背上巨大依赖面**。
10. **评分**：内核 4 · 沙箱参考 **4** · UI 参考 3 · 多端参考 4
    **额外价值**：`.agents/notes/archived/architecture/*.md` 是**大量架构决策记录**（含 `job-registry-seam`、`subagent-provider-lifecycle-events`、`config-plane-boundaries`），设计理由的一手材料，别处没有。

---

# codex — openai/codex

`40eac3c` · Apache-2.0 · 119M · **Rust** · 收 PR · 有 clean-room 声明

1. **许可**：Apache-2.0。有 CONTRIBUTING / SECURITY。
2. **分层**：`codex-rs/` 下按 crate 拆：`core` `cli` `protocol` `app-server` `sandboxing` **`bwrap`** `rollout-trace` `external-agent-migration` `code-mode-runtime` `arg0` `history` …。**Rust workspace，边界由 crate 强制。**
3. **Loop**：`core/src/session/` 以 turn 为单位，逐关注点分文件（`context_window.rs` `daemon_recovery.rs` `guardian_checkpoint.rs` `input_queue.rs` `mcp*.rs` …）。
4. **工具**：`codex-rs/core/src/tools` + **`codex-rs/prompts/templates/`**（提示词模板独立目录，含 `permissions/sandbox_mode`）。
5. **会话**：**rollout 模型**。`core/src/session/daemon_recovery.rs` 注释："持久化快照前必须 flush rollout"；`guardian_checkpoint.rs` 管检查点；`thread_rollout_truncation` 管截断。
6. **扩展**：`app-server` + MCP（`session/mcp*.rs` 有 prewarm/refresh/runtime）。
7. **多端**：`app-server` 对外；`cli` 自带 `debug_sandbox.rs` 可独立调试沙箱。
8. **安全（本层最强）**：`codex-rs/sandboxing/` + `core/src/sandboxing/` + **`codex-rs/bwrap/`（Linux bubblewrap）**；`cli/src/doctor/` 是个完整的自检体系：`network.rs`（**网络策略独立**）、`sandbox.rs`、`security.rs`、`disk.rs`、`git.rs`。
9. **可复用 vs 只学**：**代码基本抄不动**（Rust 且深绑 bubblewrap/Landlock/Seatbelt）。要学的是**纪律**：网络与进程隔离是两个独立维度、沙箱要可独立调试（doctor）、快照前 flush。
   可复用（Apache-2.0，需登记 NOTICE）：`prompts/templates/permissions/sandbox_mode` 的策略文案结构。
10. **评分**：内核 4 · 沙箱参考 **5** · UI 参考 2 · 多端参考 3

---

# kimi-code — MoonshotAI/kimi-code

`32000d0` · MIT · 101M · Node/TS · 收 PR

1. **许可**：MIT (`Copyright (c) 2026 Moonshot AI`)。有 CONTRIBUTING / SECURITY。
2. **分层**：`packages/` 含 `agent-core-v2` `acp-server` `kaos` `kap-server` `klient` `kosong` `minidb` `node-sdk` `oauth` `pi-tui` `remote-control` `telemetry` **`transcript`** `tree-sitter-bash` `migration-legacy`。
   **注意 `pi-tui`** —— 复用了 pi 的 TUI 包。
3. **Loop**：`packages/agent-core-v2/src/agent/`；CLI 走 `apps/kimi-code/src/cli/v2/run-v2-print.ts`（**v2 与 legacy 并存**）。
4. **工具**：`tree-sitter-bash` 独立包（结构化解析 bash 而非字符串匹配）。
5. **会话**：**事件源**。`packages/transcript` 独立包 + `agent-core-v2/src/app/{sessionIndex, sessionExport, sessionLegacy}` —— **索引 / 导出 / 兼容三层分开**。`apps/kimi-inspect/src/transcript` 可外部检视。
6. **扩展**：`node-sdk` + `plugins/`。
7. **多端**：`acp-server`（**ACP 独立成包**）+ `remote-control` + `kap-server` + `klient`。
8. **安全（本层有独特价值）**：**权限拆四个概念** —— `agent/permissionGate`（门）/ `permissionMode`（模式）/ `permissionPolicy`（策略）/ `permissionRules`（规则）。
9. **可复用 vs 只学**：可复用（MIT）`transcript` 的独立包形态、权限四概念命名。只学行为：`migration-legacy` 的兼容层——**那是包袱，不要继承**。
10. **评分**：内核 3 · 沙箱参考 1 · UI 参考 3 · 多端参考 4

---

# qwen-code — QwenLM/qwen-code

`40ef07a` · Apache-2.0 · 279M · Node/TS · 收 PR · 有 clean-room 声明

1. **许可**：Apache-2.0。有 CONTRIBUTING。
2. **分层**：`packages/{core, cli, qwen-live, ...}`。
3. **Loop**：`packages/core/src/`；loop 经 ACP 暴露。
4. **工具**：`packages/core/src/tools`。
5. **会话**：`packages/cli/src/commands/sessions`。
6. **扩展**：ACP 集成内含 `extension-skills.ts`、`skill-management.ts`、`skill-source-download.ts`。
7. **多端**：**`packages/cli/src/acp-integration/`（几十个文件堆在 CLI 包里）** —— **反面例子**。
8. **安全**：`packages/core/src/sandbox` + `scripts/sandbox-prototype`（**原型阶段**）+ `packages/core/src/permissions` + `omni/policy`。
9. **可复用 vs 只学**：**代码不值得抄**（ACP 组织方式是反例）。**唯一高价值的是 `docs/design/`**：
   `session-crash-recovery.md`、`session-idle-reaper.md`、`session-recap.md`、`session-title.md` —— 直接对应 M 层与 F 层，且是**写好的设计文档**，比读代码快得多。
10. **评分**：内核 2 · 沙箱参考 2 · UI 参考 2 · 多端参考 **1（反例）**

---

# grok-build — xai-org/grok-build

`07e35a3` · Apache-2.0 · 103M · **Rust** · 收 PR

1. **许可**：Apache-2.0（LICENSE 首行是 `Copyright 2023-2026 SpaceXAI`）。
2. **分层**：`crates/codegen/` 与 `crates/common/`。codegen 下按 `xai-grok-*` 拆：`shell` `sampler` `pager` `shared` `workspace` `telemetry` `sampling-types` `chat-state` **`acp-lib`**。
3. **Loop**：`xai-grok-shell/src/agent/mvp_agent/agent_ops.rs`；采样独立成 crate `xai-grok-sampler/src/stream/messages.rs`。
4. **工具**：`xai-grok-shell/src/tools`。
5. **会话**：分散在多 crate：`xai-grok-shared/src/session`、`xai-grok-shell/src/session`、`xai-grok-telemetry/src/session`、`xai-grok-sampling-types/src/conversation`、`xai-grok-compaction/src/history`。
6. **扩展**：`xai-grok-shell` plugin 相关。
7. **多端**：**`crates/codegen/xai-acp-lib/`（只有 8 个文件：`channel` `common` `gateway` `lib` `line_reader` `message` `normalize` `stdin_reader`）** —— **正面例子**，协议归协议。
8. **安全**：`xai-grok-workspace/src/permission`。无独立沙箱 crate。
9. **可复用 vs 只学**：可复用（Apache-2.0）`xai-acp-lib` 的接口形状（协议库应当只有 channel/message/normalize 这类原语）。只学行为：crate 边界划分。
10. **评分**：内核 3 · 沙箱参考 1 · UI 参考 4（`xai-grok-pager`） · 多端参考 **4**（ACP 正例）

---

# hermes-agent — NousResearch/hermes-agent

`54c5530` · MIT · 285M · **Python** · 收 PR

1. **许可**：MIT (`Copyright (c) 2025 Nous Research`)。
2. **分层**：**平铺**。`agent/` 下几十个模块（`agent_runtime_helpers.py` `activity_tracking.py` `billing_links.py` `gemini_native_adapter.py` …），未按关注点细分。
3. **Loop**：`agent/agent_runtime_helpers.py` 等。
4. **工具**：仓根 `tools/`。
5. **会话**：`apps/desktop/src/app/session` + `session-import`（**支持从别处导入会话**）。
6. **扩展**：`acp_adapter/` + `evals/`。
7. **多端**：**整个目录做 ACP**：`acp_adapter/{auth, commands, content, edit_approval}.py` —— 职责划分清楚，且 `edit_approval.py` 把**审批绑在适配层**。
8. **安全**：`scripts/sandbox`（脚本级，非内核机制）。285M 体积提示含大量非代码资产。
9. **可复用 vs 只学**：可复用（MIT）`acp_adapter/` 的目录职责划分（auth/commands/content/approval 四分）。只学行为：把审批放适配层是**有争议的**——审批语义属内核，放适配层会导致多端各写一份。
10. **评分**：内核 2 · 沙箱参考 1 · UI 参考 2 · 多端参考 3

---

# pi-desktop — vastsa/PI-Desktop

`a634b68` · **LGPL-3.0** ⚠️ · 78M · Node + Rust · 收 PR

1. **许可**：**LGPL-3.0**（`LICENSE` 首行 `GNU LESSER GENERAL PUBLIC LICENSE Version 3`）。
   **可链接调用；不可把代码整段抄进 `src/`**（修改库本体并分发须回馈）。
2. **分层**：`packages/{agent-host, agent-runtime, host-runtime, plugin-sdk, plugin-devkit, racp, shared}` + **`crates/host-core`（Rust）** + `apps/desktop`（Electron）。
   **注意：工具与会话在 Rust 侧**（`crates/host-core/src/{tools,sessions,session_collaboration}`），TS 侧只有 runtime。
3. **Loop**：`packages/agent-runtime/src/runtime.ts`。
4. **工具**：`crates/host-core/src/tools`。
5. **会话**：`crates/host-core/src/sessions` + `session_collaboration`（**协作会话**）+ `apps/desktop/src/features/sessions`。
6. **扩展**：`plugin-sdk` + `plugin-devkit` + **`electron/main/plugin-websocket.ts`（插件跑独立 websocket 进程）**。
7. **多端（本仓最大价值）**：`electron/main/{agent-host-bridge.ts, bootstrap/remote-hosts.ts, ipc/remote-host-ipc.ts}` —— **远程 host 注册 + IPC 桥**的完整骨架。
8. **安全**：探针未命中独立沙箱/权限模块；隔离靠 Electron 进程模型 + 远程 host。
9. **可复用 vs 只学**：**法律上不宜复用**（LGPL 且你内核大概率闭源）。**只学行为**：远程 host 架构、插件进程外隔离。
10. **评分**：内核 3 · 沙箱参考 2 · UI 参考 4 · 多端参考 **5**

---

# pideck — ayuayue/PiDeck

`d1bd0c9` · MIT · 54M · Node/TS · Electron

1. **许可**：MIT (`Copyright (c) 2026 PiDeck contributors`)。有 CONTRIBUTORS.md。
2. **分层**：Electron 标准三段 `src/main` / `src/renderer` / `src/preload`；插件在 `resources/extensions/`。
3. **Loop**：**不自建 loop——驱动别人的**。`src/main/pi/AgentManager.ts`（驱动 pi）+ `src/main/dsh/dshRuntimeControl.ts`（驱动 DSH）。
4. **工具**：`dsh-tool-pwsh-persistent`（**PowerShell 持久会话工具**，Windows 场景少见）。
5. **会话**：`src/main/sessions` + `src/renderer/src/components/session`。
6. **扩展**：`resources/extensions/pi-deck-subagents.ts`；`docs/dsh-native-plugin-parity-plan.md`（**插件在 pi 与 DSH 两个后端间的能力对齐计划**）。
7. **多端**：**`src/main/feishu/FeishuBridge.ts`（飞书 IM 桥）** —— 你的 IM 需求有现成参考。
8. **安全**：探针未命中。
9. **可复用 vs 只学**：可复用（MIT）`FeishuBridge.ts` 的桥接写法。只学行为：**多后端共存**的设计——PiDeck 同时驱动 pi 和 DSH，说明"内核可替换"在实践上可行，这对你选型是正面信号。
10. **评分**：内核 1 · 沙箱参考 1 · UI 参考 3 · 多端参考 **4**（IM 桥 + 多后端）

## PiDeck 的两条架构教训（来自其 CHANGELOG）
- 「切到 DSH 后选模型失效」由**三个叠加缺陷**造成，其一为 `applyModel` 的 no-record 分支直接 return 不落盘。
  **教训：多后端下"默认值"极易互相串味**（pi 的默认模型漏进 DSH 的 footer）——各后端必须有独立的偏好键。
- pi 与 DSH 的模型来自**不同目录**（`models.json` vs host route names），共享一个 key 会让一方解析另一方。
  **教训：多后端场景下，配置键必须按后端分区。**

---

# zcode — zai-org/ZCode

`872ad96` · Apache-2.0 · 122M · Node/TS · 收 PR

1. **许可**：Apache-2.0。
2. **分层**：`apps/zcode-cli/packages/{bootstrap, contracts, core}` + `packages/{services, ui}`。
3. **Loop**：**`core/src/memory/memory-agent-loop.ts` —— loop 与记忆抽取耦合在同一文件**（值得注意的取舍）。
4. **工具**：`apps/zcode-cli/tools` + `core/src/tool/handlers/`，含**代码生成的** `generated/bash-command-registry.ts`。
5. **会话**：`packages/services/src/session` + **`contracts/src/events/session.events.ts`（会话事件有类型化契约）**。
6. **扩展**：`.agents/skills/` 下以目录形式分发 skills（`agent-browser/SKILL.md`、`electron/SKILL.md`）。
7. **多端**：`contracts/src/events/` 作为端间契约层 + `packages/ui`。
8. **安全**：探针未命中独立沙箱/权限模块。
9. **可复用 vs 只学**：可复用（Apache-2.0）**`contracts/` 契约层**的形态、`contracts/src/telemetry/agent-execution.ts` 的遥测契约。只学行为：loop 与 memory 耦合——**不建议学**，记忆抽取应独立成模块。
10. **评分**：内核 3 · 沙箱参考 1 · UI 参考 3 · 多端参考 3（契约层是亮点）
