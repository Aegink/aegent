# 分层对比总表

> 基于 `oss/SOURCES.lock` 所记 commit 实测。**未克隆的仓不列，不凭记忆填。**
> 单元格格式：做法一句话 + 仓库内相对路径。
>
> `—` = 本机实测探针未命中该机制（**不等于上游没有**，报告中不作断言）。

---

## A. Agent Loop

| 项目 | 何时调模型 / 停止条件 / steer |
| --- | --- |
| **Pi** | 显式状态机。`agent_start → turn_start → [message_*, tool_execution_*] → turn_end → agent_end`；停止靠 `AgentTurnDecision = {action:"continue" \| "end"}`，而非"无 toolCall 即停"的隐式约定；`QueueMode = "all" \| "one-at-a-time"` 控注入节奏。`packages/agent/src/agent-loop.ts`, `types.ts` |
| **OpenCode** | `session/processor.ts` + `llm.ts` 驱动；`session/run-state.ts`、`status.ts` 独立管运行态；`core/session/run-coordinator.ts` 协调；`retry.ts`、`overflow.ts` 各自成文件。`packages/opencode/src/session/` |
| **DSH** | 三入口共用同一 program：`runTui(config,resume)` / `runHeadless(task)` / `runWeb(host,port,dev,workspaceRoot)`，模式在 CLI 适配层解析后交各自 runner。`packages/boot/app-boot/src/index.ts` |
| **Codex** | Rust。`core/src/session/` 以 turn 为单位；`daemon_recovery.rs` 保证 turn 级恢复。`codex-rs/core/src/session/` |
| **Kimi Code** | `packages/agent-core-v2/src/agent/`；CLI 走 `apps/kimi-code/src/cli/v2/run-v2-print.ts`（**v2 与 legacy 并存**）。 |
| **ZCode** | loop 与**记忆抽取**耦合在同一文件：`memory-agent-loop.ts`。事件契约独立在 `contracts/src/events/session.events.ts`。`apps/zcode-cli/packages/core/src/memory/` |
| **Qwen Code** | `packages/core/src/` + loop 经 ACP 暴露：`packages/cli/src/acp-integration/session`。 |
| **Grok Build** | Rust。agent 操作在 `xai-grok-shell/src/agent/mvp_agent/agent_ops.rs`；采样独立成 crate `xai-grok-sampler/src/stream/messages.rs`。 |
| **Hermes** | Python。模块平铺在 `agent/` 下（`agent_runtime_helpers.py` 等），未按关注点细分。 |
| **PI-Desktop** | `packages/agent-runtime/src/runtime.ts`；`subagent.ts` 同级。 |
| **自研选型** | **抄 Pi 的显式 `AgentTurnDecision`**（停止条件可测可断言）+ **抄 OpenCode 把 run-state 拆独立文件**（运行态不混入 loop）。 |

---

## B. Tools

| 项目 | 最小工具集 / schema / 并行 / 截断 |
| --- | --- |
| **Pi** | `harness/tools/`：`bash` `edit` `edit-diff` `read` `write` `image` `file-mutation-queue` `path-utils` `tool-context`。**`ToolExecutionMode="sequential"\|"parallel"` 是配置项**；`file-mutation-queue` 串行化文件写。 |
| **OpenCode** | 18 个：`read` `write` `edit` `apply_patch` `glob` `grep` `shell` `task` `todo` `webfetch` `lsp` `skill` `question` `plan` `code-mode` `mcp-websearch` `invalid` `external-directory`。**每个工具旁挂同名 `.txt` 存描述**（`plan-enter.txt`/`plan-exit.txt`）→ 提示词与代码分离。 |
| **DSH** | `packages/core/tools`；**工具即包**（`tool-goal`、`tool-jobs`），可独立发布。 |
| **Codex** | `codex-rs/core/src/tools` + `codex-rs/prompts/templates/`。 |
| **ZCode** | `apps/zcode-cli/tools` + `core/src/tool/handlers/`，含**代码生成的** `generated/bash-command-registry.ts`。 |
| **Grok Build** | `xai-grok-shell/src/tools`。 |
| **Hermes** | 仓根 `tools/`（Python）。 |
| **PI-Desktop** | `crates/host-core/src/tools` —— **工具在 Rust host 侧，不在 TS 侧**。 |
| **自研选型** | **抄 OpenCode 的 `.txt` 描述分离**（改提示词不动代码）+ **抄 Pi 的 `file-mutation-queue`**（并发写正确性）+ 并行做成配置项。 |

---

## C. Policy / Permissions

| 项目 | allow/ask/deny / 工作区边界 / HITL |
| --- | --- |
| **Pi** | **无内置审批门**。靠 `BeforeToolCallContext` / `AfterToolCallResult` 钩子把决策权交宿主。`packages/agent/src/types.ts` |
| **OpenCode** | **本层最强参考**。`packages/opencode/src/permission/index.ts`：<br>`rulesets.flat().findLast(r => Wildcard.match(permission, r.permission) && Wildcard.match(pattern, r.pattern)) ?? { action:"ask", permission, pattern:"*" }`<br>① **`findLast` 后匹配优先**（覆盖式，非累积）② **默认落 `ask` 不是 `allow`** ③ **双维度通配**：`permission="bash"` × `pattern="git *"` ④ 审批以 `Deferred` 挂 `pending: Map`，接口 `ask`/`reply`/`list`。 |
| **DSH** | `packages/guard`（策略）+ `packages/interaction/permission-presets`（**权限预设成套可切换**）。 |
| **Codex** | `codex-rs/protocol/src/permissions` + `prompts/templates/permissions/sandbox_mode`（**策略有对应提示词模板**）。 |
| **Kimi Code** | **权限拆四个概念**：`agent/permissionGate`（门）、`permissionMode`（模式）、`permissionPolicy`（策略）、`permissionRules`（规则）。`packages/agent-core-v2/src/agent/` |
| **Qwen Code** | `packages/core/src/permissions` + `packages/core/src/omni/policy`。 |
| **Hermes** | `acp_adapter/edit_approval.py` —— **审批绑在 ACP 适配层**。 |
| **Grok Build** | `xai-grok-workspace/src/permission`。 |
| **自研选型** | **主力抄 OpenCode 的 `evaluate`**（`findLast` + 默认 `ask` + 双维度通配），**学 Kimi 的四概念拆分**避免 gate/mode/policy/rules 混成一坨。 |

---

## D. Sandbox

| 项目 | 进程/容器/微VM / 网络 / FS |
| --- | --- |
| **Pi** | **不做**。`SECURITY.md`：信任边界 = 本地用户账号，"由用户自行负责监视，或用容器/虚拟机关起来"。沙箱只是 `coding-agent/examples/extensions/sandbox`。 |
| **OpenCode** | **不做**。`SECURITY.md` 明写 *No Sandbox*："权限系统是 **UX feature**……**不提供安全隔离**"。 |
| **DSH** | **有真沙箱包且可插后端**：`packages/sandbox/sandbox` + `packages/sandbox/sandbox-local`。 |
| **Codex** | **本层最强参考，全平台五后端**。`codex-rs/sandboxing/src/`：`bwrap.rs` `landlock.rs`(Linux) `seatbelt.rs`(macOS) **`windows.rs` `windows_mxc.rs`(Windows)**。Windows 分两档 `WindowsSandboxLevel={Disabled(默认),RestrictedToken,Elevated}`：非提权后端 `codex-rs/windows-sandbox-rs`(65 个 .rs：ACL 递归拒绝读 / `CapSids` / AppContainer / DPAPI)；提权后端 `mxc-sandbox`+`windows-sandbox-service`。`cli/src/doctor/network.rs`（**网络策略独立诊断**）。 |
| **Qwen Code** | `packages/core/src/sandbox` + `scripts/sandbox-prototype`（**原型阶段**）。 |
| **Grok Build** | — |
| **PI-Desktop** | — （host 在 Rust `crates/host-core`） |
| **自研选型** | **学 Codex，Windows 场景尤其**：抄 `RestrictedToken` 非提权路线（ACL + 能力 SID，**不需提权**）+ `WindowsSandboxFilesystemOverrides` 的策略形状 + 网络策略独立 + 可调试 doctor。**学 DSH 的可插后端**（local 先跑通，容器后补）。**不要指望从 Pi/OpenCode 抄沙箱——它们明确没有。** |

---

## E. Session

| 项目 | 线性 vs 树 vs 事件源 / fork-rewind / 持久化格式 |
| --- | --- |
| **Pi** | **事件源 + 两种 fork**。`harness/session/`：`commit.ts`（`CommittedListAppendWrite` / `CommittedValueSetWrite`）、`mutation-line.ts`、`values.ts`、`jsonl/`。<br>`fork-policy.ts`：`ForkCurrentStatePlan = {scope:"branch"} \| {scope:"tree"}` —— **线性分支与树都支持**，沿父链回溯，`position:"before"\|"after"` 定切点。后端可换 sqlite。 |
| **OpenCode** | **迁移中，两套并存**。(a) 旧：JSON 文件树 `storage/session/message/<sid>/<mid>.json`、`part/<sid>/<mid>/<pid>/*.json`、`session_diff/`；(b) 新：`core/src/session/store.ts` 用 **drizzle ORM + SQL 表**。事件源在 `core/src/session/{event.ts, projector.ts, history.ts, context-epoch.ts}`（**事件 + 投影器**）。回退在 `session/revert.ts`。 |
| **DSH** | `packages/session` + `packages/core/session` + `packages/api/session-controller` + `packages/context/session-reference`（**会话可被其他会话引用**）。 |
| **Codex** | **rollout 模型**。`core/src/session/daemon_recovery.rs`："持久化快照前必须 flush rollout"；`guardian_checkpoint.rs` 管检查点；`thread_rollout_truncation` 管截断。 |
| **Kimi Code** | **事件源**：`packages/transcript`（独立包）+ `agent-core-v2/src/app/{sessionIndex, sessionExport, sessionLegacy}` —— **索引 / 导出 / 兼容三层分开**。`apps/kimi-inspect/src/transcript` 可外部检视。 |
| **ZCode** | `packages/services/src/session` + `contracts/src/events/session.events.ts`（**会话事件有类型化契约**）。 |
| **Grok Build** | session 分散在多个 crate：`xai-grok-shared/src/session`、`xai-grok-shell/src/session`、`xai-grok-telemetry/src/session`、`xai-grok-sampling-types/src/conversation`。 |
| **Hermes** | `apps/desktop/src/app/session` + `apps/desktop/src/app/session-import`（**支持从别处导入会话**）。 |
| **自研选型** | **抄 Pi 的 `ForkCurrentStatePlan`**（一套抽象同时支持分支与树，不写两套）+ **抄 Kimi 的 transcript 独立包与 index/export/legacy 三分**（迁移不炸）+ **抄 Codex 的 flush-before-snapshot 纪律**。 |

---

## F. Context

| 项目 | 系统提示 / AGENTS.md / compaction / cache |
| --- | --- |
| **Pi** | `harness/{system-prompt.ts, prompt-templates.ts, context.ts, messages.ts}` + `harness/compaction/`（独立目录）。 |
| **OpenCode** | `session/{compaction.ts, overflow.ts, summary.ts, reminders.ts, instruction.ts, system.ts}` + `session/prompt/`。**`overflow` 与 `compaction` 分开**（先判溢出再决定压缩）。 |
| **DSH** | `packages/compaction` + `packages/context` + `packages/context/session-reference`。 |
| **Codex** | `core/src/session/context_window.rs`；提示词模板 `codex-rs/prompts/templates/`。 |
| **Grok Build** | 独立 crate `xai-grok-compaction/src/history`。 |
| **Qwen Code** | `docs/design/session-recap.md`、`docs/design/session-title.md`（**摘要与标题有独立设计文档**）。 |
| **自研选型** | **抄 OpenCode：`overflow` 与 `compaction` 分两个模块**（先判溢出，再决定压缩，别混在一起）。 |

---

## G. Planning

| 项目 | Plan/Goal / 审批过期 / 计划落盘 |
| --- | --- |
| **Pi** | — |
| **OpenCode** | **本层最完整**。`tool/plan.ts` + `plan-enter.txt` / `plan-exit.txt`（**进出计划模式的提示词独立成文**）；另有 `session/todo.ts` + `tool/todo.ts`。 |
| **DSH** | **Goal 单独成体系**：`packages/goal/{goal, goal-round-driver, command-goal, tool-goal}` —— `goal-round-driver` 即**跨轮驱动**。 |
| **Codex** | — |
| **自研选型** | **学 DSH 的 goal 四件套**（模型 / 跨轮驱动 / 命令 / 工具分离）+ **抄 OpenCode 的 plan-enter/exit 提示词文件化**。 |

---

## H. Subagents

| 项目 | 隔离 / 权限降级 / 结果汇总 |
| --- | --- |
| **Pi** | 内核外（`packages/agent/docs/` 有 subagent 相关设计稿，未成独立包）。 |
| **OpenCode** | `tool/task.ts` + `task.txt` —— **子代理即一个工具**。 |
| **DSH** | `.agents/notes/archived/architecture/2026-07-05-subagent-provider-lifecycle-events.md`（**有生命周期事件的架构决策记录**）；CLI 测试内有 `subagent-settlement-fence.ts`（**结算栅栏**概念）。 |
| **PI-Desktop** | `packages/agent-runtime/src/subagent.ts` + `subagent-loop-context`；`resources/extensions/pi-deck-subagents.ts`（PiDeck 侧）。 |
| **自研选型** | **抄 OpenCode：子代理做成 `task` 工具**（复用权限/审批/事件全套，无需新抽象）+ **学 DSH 的"结算栅栏"**——子代理结果必须原子并入父会话。 |

---

## I. MCP / Skills / Hooks / Plugins

| 项目 | 机制 |
| --- | --- |
| **Pi** | `harness/hooks.ts` + `harness/skills.ts` + `coding-agent/examples/extensions/`（`sandbox`、`custom-provider-anthropic`、`gondolin`）。**hooks 与 skills 是内核概念**。 |
| **OpenCode** | `packages/plugin/` + `@opencode-ai/plugin` 的 `ToolDefinition`（**插件可注册工具**）+ MCP + `AGENTS.md`；`tool/skill.ts`、`tool/mcp-websearch.ts`。 |
| **DSH** | `packages/hooks` + `packages/extensions` + `packages/acp`。 |
| **ZCode** | `.agents/skills/agent-browser/SKILL.md`、`.agents/skills/electron/SKILL.md`（**skills 以目录形式随仓分发**）。 |
| **PI-Desktop** | `packages/plugin-sdk` + `plugin-devkit` + `apps/desktop/electron/main/plugin-websocket.ts`（**插件跑在独立 websocket 进程**）。 |
| **自研选型** | 双轨：**内核内 hooks/skills**（学 Pi）+ **进程外插件**（学 PI-Desktop 的 websocket）。工具注册向插件开放（学 OpenCode）。 |

---

## J. Models

| 项目 | 多厂商 / 中途换模 / OAuth vs API Key |
| --- | --- |
| **Pi** | 独立 `packages/ai`；扩展示例含 `custom-provider-anthropic`、`custom-provider-gitlab-duo`（**厂商适配可外挂**）。 |
| **OpenCode** | 独立 `packages/llm/`。 |
| **Kimi Code** | `packages/oauth`（**OAuth 独立成包**）+ `packages/klient` + `packages/kap-server`。 |
| **ZCode** | `contracts/src/model/index.ts`（模型有契约层）；**`packages/adapters/src/model/` 是 50+ 文件的独立子系统**（`retry-budget.ts`、`failure-classifier.ts`、`offpeak-retry.ts`、`workflow-model-failure-policy.ts`）。`runner.ts:353` 有硬守卫：`throw new Error("Runtime header refresh changed the bound model identity.")` |
| **自研选型** | 厂商适配独立成包（Pi/OpenCode 一致）+ **OAuth 独立成包**（学 Kimi）+ **运行时换模综合八仓**（见下） |

### J-补 · 运行时换模（跨仓实测，2026-09-23 补充）

早前本表未列此项，是**漏查**。实测 8 个仓全部有运行时换模：

| 仓 | 做法 | 独到之处 |
| --- | --- | --- |
| **pi** | lane 上 `setModel()`；`config_update` 事件 | **`configuredModel` 与 `capturedModel` 分离** —— 运行中换模，在途 turn 仍用启动时捕获的模型。`ModelIdentity={provider,modelId}` 二元组。`activeTools` 也可一起切 |
| **grok** | 换模状态机 | **`DeferredModelSwitch{model_id, effort, prev_model_id}` 带失败回滚目标**；四态 `model_switch_pending`/`deferred_model_switch`/`user_model_preference`/`model_incompatible`；`effort` 随模型一起切 |
| **DSH** | session command | `SessionSelectModelRequest/Value`；**会话级选择与全局默认分开存**，不一致时显式报错（`session/model-unavailable`） |
| **qwen** | 会话级持久化 | `SessionModelRecordPayload` + `SessionRestoreProjection`；**auth type 是模型记录的一部分** |
| **hermes** | ACP 模型选择器 | **每厂商上限 200**（客户端单下拉框渲染）；`custom:<name>` slug 保证 choice id 可回环；**discovery 失败时声明的模型仍存活**（有些端点无 `/models` 路由） |
| **zcode** | 独立模型子系统 | **刷新鉴权头不得改变模型身份**（硬守卫） |
| **kimi** | `/provider` 命令 | provider 与 model 同在 app state |
| **ACP 协议** | 标准 schema | `SessionModelState{available_models, current_model_id}`、`ModelInfo` —— 换模经 ACP 是标准能力 |
| **cc-switch** | **无运行时换模** | 它是配置管理器，`failover` 是「切换写进目标文件的配置」，不是运行时路由。**唯一没有的一家** |

**综合结论（三条最该抄）**

1. **`{provider, modelId}` + configured/captured 分离**（pi）—— **多端并发与换模的交叉点**。
   没有 captured，运行中换模会污染在途 turn；有了它，换模对在途操作**无感**。
2. **换模是事件**（pi 的 `config_update`）—— 天然满足可审计与可回放，不必另做「换模历史」设计。
3. **会话级与全局默认分离且不一致要报错**（DSH）—— 正是 PiDeck 踩过的坑
   （多后端默认值串味、分支不落盘）的正确解法。

**一个细节坑（grok，值得单独记）**：历史回放会**静默覆盖**用户的模型选择，
grok 专门用 `ReconnectState::user_selected_model` 抑制 replay 的静默回退。
多端重连场景必然遇到。

---

## K. Surfaces

| 项目 | TUI / Web / Desktop / IDE ACP / IM |
| --- | --- |
| **Pi** | `packages/{tui, server, protocol, client}` + `coding-agent`。 |
| **OpenCode** | **端最全**：`tui` `app` `web` `desktop` `console` `enterprise` + **`slack/`（IM）** + `session-ui`。 |
| **DSH** | `apps/cli` 三入口（`runTui`/`runHeadless`/`runWeb`）+ `packages/acp`。 |
| **Grok Build** | **`crates/codegen/xai-acp-lib/`**（ACP 抽出为独立 crate）+ `xai-grok-pager`（TUI）。 |
| **Qwen Code** | `packages/cli/src/acp-integration/session`（**ACP 塞在 CLI 包内**）。 |
| **Hermes** | **整个目录做 ACP**：`acp_adapter/{auth,commands,content,edit_approval}.py`。 |
| **PI-Desktop** | `apps/desktop`（Electron）+ `electron/main/{agent-host-bridge.ts, bootstrap/remote-hosts.ts, ipc/remote-host-ipc.ts, plugin-websocket.ts}` —— **远程 host 架构**。 |
| **PiDeck** | `src/main/pi/AgentManager.ts` + `src/main/dsh/dshRuntimeControl.ts` + **`src/main/feishu/FeishuBridge.ts`（飞书 IM）**。 |
| **自研选型** | **ACP 抽独立包**（学 Grok 的 `xai-acp-lib`，别学 Qwen 塞进 CLI）+ **远程 host 架构学 PI-Desktop** + IM 先做**飞书**（PiDeck 的 `FeishuBridge.ts` 是现成参考）。 |

---

## L. Observability

| 项目 | 轨迹 / token / 审计 |
| --- | --- |
| **Pi** | `packages/telemetry` + `harness/telemetry.ts`。 |
| **OpenCode** | `packages/stats` + `session/summary.ts` + `packages/http-recorder/`（**HTTP 级录制**）。 |
| **Codex** | `codex-rs/rollout-trace/`（**rollout trace + reducer**）、`external-agent-migration/`（从别的 agent 导入轨迹）。 |
| **ZCode** | `contracts/src/telemetry/agent-execution.ts`（**遥测有类型契约**）。 |
| **Grok Build** | `xai-grok-telemetry/src/session`；`xai-chat-state/src/usage.rs`（token 用量）。 |
| **自研选型** | **抄 Codex 的 rollout-trace + reducer**：轨迹是事件流的投影，不另存一份。 |

---

## M. 长任务

| 项目 | goal 跨轮 / 后台 job / 崩溃续跑 |
| --- | --- |
| **DSH** | **三层齐全**：`packages/goal/goal-round-driver`（跨轮）+ `packages/jobs/{jobs, jobs-local, tool-jobs}`（后台 job + 本地后端）+ `.agents/notes/.../job-registry-seam.md`（**job 注册表接缝有决策记录**）。 |
| **Codex** | `session/daemon_recovery.rs`（**daemon 级恢复**）+ `guardian_checkpoint.rs` + `cli/src/doctor/`。 |
| **Qwen Code** | **设计文档齐全**：`docs/design/session-crash-recovery.md`、`docs/design/session-idle-reaper.md`（**空闲回收**）。 |
| **OpenCode** | `session/retry.ts`、`status.ts`、`run-state.ts`。 |
| **自研选型** | **主力学 DSH**（goal + jobs 两套，本地后端先跑通）+ **崩溃续跑抄 Codex 的 flush-before-snapshot 纪律** + **回收策略抄 Qwen 的 idle-reaper**。 |

---

## N. 多端同步

| 项目 | session id / 推送 / 审批如何回到同一运行时 |
| --- | --- |
| **OpenCode** | **本层最强**：审批 `Deferred` 挂 `pending: Map`，`ask`/`reply`/`list` 三接口 —— **审批天然可跨端异步回转**（发起端 suspend，任意端 reply 唤醒）。 |
| **PI-Desktop** | `electron/main/ipc/remote-host-ipc.ts` + `bootstrap/remote-hosts.ts`（远程 host 注册）+ `plugin-websocket.ts`。 |
| **DSH** | `packages/acp` + `packages/api/session-controller` + `packages/identity`（**身份独立成包**）。 |
| **Hermes** | `acp_adapter/edit_approval.py`（审批在适配层）。 |
| **自研选型** | **抄 OpenCode 的 Deferred+Map 审批模型** —— 这是"审批回到同一运行时"的最小正确解，无需自创协议。 |
