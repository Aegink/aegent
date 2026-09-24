# 参考案例索引 —— 「做到哪一条，点开哪里」

**配套** `docs/requirements.md`（唯一权威的需求文档）。
**用法**：需求文档里定了"做什么"，本文件说"照着谁做、点开看哪一段、抄什么、别抄什么"。
**按功能 ID 查**（§1）· **按仓查**（§2，优点清单原文）· **排除清单与未细读**（§3）· **调研文档对应**（§4）。

> **Q10–Q21 的 12 项决策已定**（`docs/requirements.md` §3），本文件已按决策更新首选与警告。
>
> **锚定**：所有路径指向 `oss/<仓>/…`，对应 `oss/SOURCES.lock` 的 commit。
> 跑 `bash tools/snapshot.sh` 可确认上游未变；跑 `bash tools/check-doc-links.sh` 可校验链接。
> **本项目不追求读完上游** —— 只在你真正开始做某一条时才点开它对应的位置。

---

## 0. 复用性图例与许可

| 标记 | 含义 | 法律边界 |
| --- | --- | --- |
| 🟢 | **可摘代码** | MIT / Apache-2.0：可参考实现，摘代码须**保留版权头**并登记 `THIRD_PARTY.md` |
| 🟡 | **只学形状** | 抄抽象/接口/协议形状，**不抄实现** |
| 🔴 | **只学行为** | LGPL / 专有：**代码一行不可摘**，只学行为与设计 |

**本工作区涉及的仓与许可**（全量见 `oss/SOURCES.lock`）：

| 仓 | 许可 | 用途 | 标记 |
| --- | --- | --- | --- |
| `pi`（earendil-works/pi） | MIT | **内核首选蓝本** | 🟢 |
| `opencode`（anomalyco/opencode） | MIT | **策略与工具**首选 | 🟢 |
| `deepseek-harness`（dsh） | MIT | **长任务、事件源、测试**首选 | 🟢 |
| `codex`（openai/codex） | Apache-2.0 | **沙箱、权限聚合、压缩持久化**首选 | 🟢 |
| `kimi-code` | MIT | **权限分析、shell 解析、测试快照** | 🟢 |
| `qwen-code` | Apache-2.0 | **权限词汇表、shell 语义**（只读文档为主） | 🟢 |
| `grok-build` | Apache-2.0 | ACP、熔断、换模事务 | 🟢 |
| `hermes-agent` | MIT | 审批播报、限流、模型目录 | 🟢 |
| `cc-switch` | MIT | **J 层配置与故障转移** | 🟢 |
| `pideck` | MIT | 飞书桥、多后端教训 | 🟢 |
| `pi-mono` | MIT | **提示缓存前缀**（唯一来源） | 🟢 |
| `agentscope` / `mini-agent` / `mini-swe-agent` | — | 未细读，不作优点断言 | — |
| `pi-desktop`（vastsa/PI-Desktop） | **LGPL-3.0** | 只在 D/K/M 层学行为 | 🔴 |
| `claude-official`（anthropics/claude-code） | **PROPRIETARY** | **只读公开行为与官方类型声明** | 🔴 |

**三条硬约束**（`THIRD_PARTY.md`）：
① 不得复制 LGPL / 专有代码；② MIT/Apache 摘代码须登记 + 保留版权头；
③ 上游结论须锚定 `oss/SOURCES.lock` 的 commit，否则不可复现。

---

## 1. 按功能查

> 「取什么」= 点开首选位置后**具体要拿走的东西**；「别抄 / 备选」= 该仓在这条上的坑或另一条路。
> 首选位置见 `docs/requirements.md` §4 同名 ID 行（可点击）。

### A. Agent Loop

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| A1 | [pi·types.ts:143](../oss/pi/packages/agent/src/types.ts#L143) | `AgentTurnDecision` 的**显式联合**（continue/end 各是一个具名变体），以及"停止是返回的决策，不是循环推断出来的" | 对照 opencode 的隐式约定 | 🟡 |
| A2 | [pi·types.ts:55](../oss/pi/packages/agent/src/types.ts#L55) | 注入节奏做成**枚举**（`"all"` / `"one-at-a-time"`）而不是布尔开关 | — | 🟡 |
| A3 | [opencode·run-state.ts](../oss/opencode/packages/opencode/src/session/run-state.ts) | 运行态的**字段清单**：哪些状态必须能脱离 loop 判定 | — | 🟡 |
| A4 | [codex·compact_token_budget.rs](../oss/codex/codex-rs/core/src/compact_token_budget.rs) | overflow 判定与 compaction **分属两个模块**，且前者的输出是后者的输入 | 别把"超了"与"压了"写成一个函数 | 🟡 |
| A5 | [kimi·retry.ts](../oss/kimi-code/packages/agent-core-v2/src/human/llm/requester/retry.ts) | `RETRYABLE_STATUS_CODES` 的**显式枚举** + `isRetryableError` 里 `unknown` **不重试**的分支 | — | 🟢 |
| A6 | [pi·types.ts:485](../oss/pi/packages/agent/src/types.ts#L485) | `AgentEvent` 联合体：turn 级与 agent 级事件的分层，**封闭联合**的写法 | — | 🟢 |
| A7 | [dsh·explicit-turn-cancellation.md](../oss/deepseek-harness/.agents/notes/implemented/architecture/2026-07-16-explicit-turn-cancellation.md) | `AgentCancelCause` 四变体；**"不可冻结 cancel cause"**那段（undici 会赋 `stack`，冻结致 `fetch` 抛 `TypeError` 取代真因） | — | 🟡 |
| A8 | [grok·agent.rs](../oss/grok-build/crates/codegen/xai-grok-pager/src/app/agent.rs) | `in_flight_prompt` 的**保存与回填**：取消时把 prompt 放回输入框 | — | 🟡 |
| A9 | [dsh·followup-enqueue.md](../oss/deepseek-harness/.agents/notes/implemented/architecture/2026-07-30-followup-enqueue-and-owned-runs.md) | **为什么否决 per-send 完成句柄**（steering/注入/续跑/恢复都会贡献内容）；`whenIdle()` 是整 agent 观察 | 别做 `session.finished` | 🟡 |
| A10 A11 | [pi-desktop·active-turn-steering.md](../oss/pi-desktop/docs/adr/active-turn-steering.md) | `expectedTurnId` 的准入校验；**"已启动的工具先跑完，下一次模型请求才消费"** | 🔴 只学行为 | 🔴 |
| A12 |  [claude-official·claude-code.d.ts:588](../refs/claude-official/mods/types/claude-code.d.ts#L588) | `prompt.id` 的**声明形状**（关联该输入之后、下一次输入之前的所有事件） | 🔴 专有，**只读声明不抄实现** | 🔴 |
| A13 | [kimi·machine.ts:57](../oss/kimi-code/packages/agent-core-v2/src/human/agent/machine.ts#L57) | `PromptGateVerdict = boolean \| {block, message?}` —— **第三态"改写消息"** | — | 🟢 |
| A14 | [kimi·engine.ts:303](../oss/kimi-code/packages/agent-core-v2/src/agent/loop/machine/engine.ts#L303) | `createAgentMachine({abortTimeoutMs, maxStepsPerTurn, …})` 的**参数命名与默认值** | — | 🟡 |
| A15 A16 | [zcode·turn-loop.ts](../oss/zcode/apps/zcode-cli/packages/core/src/runtime/methods/turn-loop.ts) | 三个排空点（guide / queue / runtime commands）**分别在哪一行**；排空后重置了哪些计数 | — | 🟡 |
| A17 | 同上 | `throwIfTurnAborted` 的**调用密度** —— 每个 await 之后都有 | 只查循环头是常见错 | 🟡 |

### B. Tools

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| B1 B8 | [opencode·tool/](../oss/opencode/packages/opencode/src/tool) | `ToolDefinition` 的注册形状 + 18 个工具的分工边界 | — | 🟡 |
| B2 | [opencode·tool/](../oss/opencode/packages/opencode/src/tool) | 描述文件与 `.ts` 的**同目录同名**约定，加载时按名拼 | — | 🟢 |
| B3 B4 | [pi·harness/tools/](../oss/pi/packages/agent/src/harness/tools) | 最小工具集划分；`file-mutation-queue` 的**串行化粒度**（按路径还是全局） | — | 🟡 |
| B5 B10 B11 | [pi·truncated-tool.ts](../oss/pi/packages/coding-agent/examples/extensions/truncated-tool.ts) | **截断 → 落盘 → 把路径告诉模型**的完整流程；50KB/2000 行"先到先算"的写法 | — | 🟢 |
| B6 | [pi·types.ts:47](../oss/pi/packages/agent/src/types.ts#L47) | `ToolExecutionMode` 枚举与它如何影响调度 | — | 🟡 |
| B7 B9 | [pi·types.ts:485](../oss/pi/packages/agent/src/types.ts#L485) | `tool_execution_update` 的事件载荷；`toolCallId` 在 start/update/end 三处的贯穿 | — | 🟢 |
| B12 | [dsh·canonical-tool-output.md](../oss/deepseek-harness/.agents/notes/implemented/architecture/2026-07-20-canonical-tool-output-contract.md) | **"执行期类型值 ≠ 会话格式"**的论证：直接持久化富中间值会膨胀日志、把实现数据暴露给压缩与迁移 | 别把 `ContentBlock[]` 当域值 | 🟡 |
| B13 | [pi-desktop·ADR 0207](../oss/pi-desktop/docs/adr/0207-three-mutation-recovery-failures.md) | **为何是 3 次不是 2 次**的论证；计数器按 `prompt × path` 双作用域；成功即清空 | 对照 ZCode「失败即收口」，**我方选 pi-desktop** | 🔴 |
| B14 | [kimi·budget.ts](../oss/kimi-code/packages/tree-sitter-bash/src/budget.ts) | `tick()`（计数+查截止）与 `progress()`（只查截止、不计数）的**分工**；为什么要两个 | 别只设数量轴 | 🟢 |
| B15 | [dsh·escalation.ts](../oss/deepseek-harness/packages/sandbox/sandbox/src/escalation.ts) | `WIDER_MODES` 阶梯 + **"限制在执行期算，绝不烘进全局 schema"** | 别把每调用约束写进工具 schema | 🟡 |
| B16 B17 | [codex·parallel.rs:191](../oss/codex/codex-rs/core/src/tools/parallel.rs#L191) | 一把 `RwLock` 做准入（读=并行/写=排他）；**元数据按 step 快照保留**；未声明即不可并行 | — | 🟡 |
| B18 | [dsh·util/timeout](../oss/deepseek-harness/packages/util/timeout/src/index.ts) | `clampTimeout` 的**三档合并**（提示/默认/上限）+ 非法值抛错 + 上限不可关闭 | — | 🟢 |
| B19 | [kimi·engine.ts](../oss/kimi-code/packages/agent-core-v2/src/agent/loop/machine/engine.ts) | 每步 `timing` / `traceId` 的上报点 | — | 🟡 |
| B20 | [zcode·turn-output-token-continuation.ts](../oss/zcode/apps/zcode-cli/packages/core/src/runtime/methods/turn-output-token-continuation.ts) | 把"输出触顶"做成**可续跑事件**而非回合终态 —— 这决定了 `l0-events.md` 的 `max-tokens` 怎么定 | — | 🟡 |
| B21 | [codex·session/tests.rs](../oss/codex/codex-rs/core/src/session/tests.rs) | 读测试名即可：`…runtime_refreshable_fields_and_keeps_session_static_settings` | — | 🟡 |

### C. Policy / Permissions（本层是整个调研里参考最密集的一层）

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| C1 C3 C4 | [opencode·permission/](../oss/opencode/packages/opencode/src/permission) | 三维求值 + `permission × pattern` 双维度通配的**形状** | **Q15 已定：不抄它的 `findLast`** —— 我方是**前匹配胜**（见 C2） | 🟡 |
| C2 | [kimi·permissionRules](../oss/kimi-code/packages/agent-core-v2/src/agent/permissionRules) | **前匹配胜**的求值顺序；规则集作为**链中一环**而不是权威 | OpenCode 的 `findLast` **只作对照**，用来写"行为相反"的测试 | 🟢 |
| C5 C6 L2 N2 | 同上 | `Deferred` + `pending: Map` + `reply` 唤醒；**发起端与审批人记在哪** | — | 🟡 |
| C7 | [codex·sandboxing/windows.rs](../oss/codex/codex-rs/sandboxing/src/windows.rs) | `WindowsSandboxFilesystemOverrides` 的**策略形状**（怎么表达"工作区内 + 白名单"） | — | 🟢 |
| C8 | [dsh·permission-presets](../oss/deepseek-harness/packages/interaction/permission-presets/src/index.ts) | **两根正交旋钮**（`sandboxMode` × `approvalPolicy`）；预设是**命名捆包**；`permission/preset` 是 **log-only 意图事件**；`CUSTOM_PRESET` 是**派生值、从不作为载荷**；`AUTO_PRESET_SPEC` 只对当前会话 | — | 🟡 |
| C10 | [pi·permission-gate.ts](../oss/pi/packages/coding-agent/examples/extensions/permission-gate.ts) | 危险命令模式库的**具体正则/写法** | — | 🟢 |
| C11 | [pi·project-trust.ts](../oss/pi/packages/coding-agent/examples/extensions/project-trust.ts) | `project_trust` 事件的形状；未信任时**降权的是哪几项** | 补 C34 解决"信任反复变化" | 🟢 |
| C12 C13 | [dsh·file-context-as-event-gate.md](../oss/deepseek-harness/.agents/notes/implemented/architecture/2026-06-26-file-context-as-event-gate.md) | 三件事解耦（工具做什么 / 新鲜度策略 / 已观察状态记录）；**为何 in-path 强制不可接受**（不经 `fileContext` 就到不了 `ctx.fs` → 无法整体丢弃） | 别做成 in-path | 🟡 |
| C14 | [dsh·explicit-turn-cancellation.md](../oss/deepseek-harness/.agents/notes/implemented/architecture/2026-07-16-explicit-turn-cancellation.md) | 终态只记**粗粒度** `{kind:'aborted'}`；**加载时拒绝**带 reason 的旧记录（防 replay 重新引入 caller 细节） | — | 🟡 |
| C15 C16 C17 | [dsh·rejected/typed-event-schemas.md](../oss/deepseek-harness/.agents/notes/rejected/architecture/2026-06-16-typed-event-schemas.md) | **为什么事后 Zodic 化不可能**：插件无法 declaration-merge Zod schema；影响面 6 map / ~10 declare module / 16 append 点 / ~7 switch 消费者 | 逃生舱形状看 [pi·session/types.ts:52](../oss/pi/packages/agent/src/harness/session/types.ts#L52) `CustomEntry` | 🟡 |
| C18 C19 |  [claude-official·claude-code.d.ts:588](../refs/claude-official/mods/types/claude-code.d.ts#L588) | `ToolCheckResult` 的 **`rule`（规则原文）+ `reason`** 字段；`$.tool.check` 的 dry-run 语义（"runs the same chain and executes nothing"） | 🔴 只读声明 | 🔴 |
| C20 C21 | [kimi·permissionPolicyService.ts](../oss/kimi-code/packages/agent-core-v2/src/agent/permissionPolicy/permissionPolicyService.ts) | 策略**模块数组** + "首个非 undefined 者胜"；`argPattern` **委托给工具自己解释** | — | 🟢 |
| C22 | [kimi·permissionRules](../oss/kimi-code/packages/agent-core-v2/src/agent/permissionRules) | 四种作用域（project / user / turn-override / session-runtime）如何隔离 | — | 🟡 |
| C23 C41 C45 | [kimi·evaluate.ts:85](../oss/kimi-code/packages/agent-core-v2/src/agent/toolPolicy/evaluate.ts#L85) | `findInactiveToolPatterns` 检出的**四类问题**（通配符用错 / MCP 名不完整 / 未知工具名 / …） | 与 C44 是同一洞察的两种实现 | 🟢 |
| C24 | [kimi·permissionRules](../oss/kimi-code/packages/agent-core-v2/src/agent/permissionRules) | `ApprovalResponse` 的 `scope` / `feedback` / 选项标签 | — | 🟡 |
| C25 C49 | [kimi·evaluate.ts:43](../oss/kimi-code/packages/agent-core-v2/src/agent/toolPolicy/evaluate.ts#L43) | `isToolActiveComposed` = **四层纯 AND**；对照 codex `permission_profile_intersection.rs`（无交集则**拒绝启动**） | — | 🟢 |
| C27 C28 C29 | [qwen·shell-semantics.ts](../oss/qwen-code/packages/core/src/permissions/shell-semantics.ts) | ① shell 命令 → **虚拟工具操作**的映射表 ② `cwdUnknown` / `pathMayDependOnCwd` 不确定字段 ③ **"静态分析做不到"清单** | **先定待定10**（三档选一）再动手 | 🟢 |
| C30 | [hermes·terminal_approval_batch.py](../oss/hermes-agent/agent/terminal_approval_batch.py) | 审批**提前收集**、**执行仍按原顺序**、**执行时守卫重跑** | — | 🟡 |
| C31 | [hermes·approval_settle.py](../oss/hermes-agent/gateway/run_turn_runner_approval_settle.py) | **真实事故**：超时静默结算 → 必须在每个能显示它的界面**主动宣告**；迟到通知要检查"这一轮是否仍是当前轮" | — | 🟡 |
| C32 | [qwen·permissions](../oss/qwen-code/packages/core/src/permissions) + [agentscope·permission](../oss/agentscope/src/agentscope/permission) | **第四值**：`'default'`(qwen) 与 `PASSTHROUGH`(agentscope) 各自的语义 —— 把"没意见，往下走"与"我要 ask"分开 | 三家独立同证（外加 pi-desktop/DSH） | 🟡 |
| C33 | [agentscope·permission](../oss/agentscope/src/agentscope/permission) | `DONT_ASK`：把**每一个 ASK 转为 DENY**（不是卸掉策略） | 对照 kimi「装不了就别装」 | 🟡 |
| C34 | [qwen·permissions](../oss/qwen-code/packages/core/src/permissions) | `trustGated`：信任变化时**不移除规则，而读当前信任** | — | 🟡 |
| C35 C36 C37 C38 C39 C40 | 同上 | `BUILTIN_SOFT_DENY` 的**四类软拒绝**清单（含"即使这次编辑是用户要求的，也不得顺带加入用户没要求的 allow"）；`Replace-mode is not supported`；`MAX_USER_HINT_LENGTH=200`；`PermissionRule.raw`；`SpecifierKind` 分型；`toolParamMatchers` | **C35 是本项目最高严重度的 P0 缺口** | 🟡 |
| C42 | [qwen·classifier.ts](../oss/qwen-code/packages/core/src/permissions/classifier.ts) | **两阶段**判官（贵路径修便宜路径的假阳性）+ fail-closed + `unavailable` 标记 + **abort 不算失败** | 与 codex `guardian/` 对照 | 🟡 |
| C43 | [codex·policy.rs:403](../oss/codex/codex-rs/execpolicy/src/policy.rs#L403) | **`matched_rules.iter().map(RuleMatch::decision).max()`**，配 `decision.rs` 里 `Ord` 派生（`Allow < Prompt < Forbidden`）→ **加规则在数学上不可能放宽策略** | **这是 C35 的结构解，优先实现** | 🟢 |
| C44 C55 | [codex·execpolicy/](../oss/codex/codex-rs/execpolicy) | `prefix_rule(pattern, decision, justification, match, not_match)` + **加载期校验**（`match`/`not_match` 自测样例）；`justification` 必填、`forbidden` 须给替代做法 | — | 🟢 |
| C46 | [codex·permissions.rs:36](../oss/codex/codex-rs/protocol/src/permissions.rs#L36) | **保留元数据路径**清单（`.git` / `.agents` / `.codex`）**硬拦，规则不得授权** | — | 🟢 |
| C47 C48 | [codex·protocol.rs](../oss/codex/codex-rs/protocol/src/protocol.rs) | `ReviewDecision` **7 变体** × **4 个持久化作用域**；`ApprovedExecpolicyAmendment` —— **提案由引擎算，模型只能发命令** | 直接回答**待定9** | 🟢 |
| C50 C51 | [zcode·broker.ts:105](../oss/zcode/apps/zcode-cli/packages/core/src/permission/broker.ts#L105) | `DenyPermissionBroker` 作默认；超时 **reject with `PermissionTimeout`**（不是 silent resolve） | 对照 hermes 的静默超时 bug | 🟢 |
| C52 | [zcode·turn-machine.ts:251](../oss/zcode/apps/zcode-cli/packages/core/src/agent/turn-machine.ts#L251) | `resolvePermission(toolCallId, decision, modifiedInput?)` —— 批准**可携带修改后的参数** | — | 🟢 |
| C53 C54 | [codex·execpolicy/](../oss/codex/codex-rs/execpolicy) + [codex·protocol.rs](../oss/codex/codex-rs/protocol/src/protocol.rs) | `host_executable(name, paths)` 把 basename 规则绑到**绝对路径清单**；`GranularApprovalConfig` **关闭某类 ≠ 放行 = 硬拒绝** | — | 🟡 |
| C56 | [codex·guardian/](../oss/codex/codex-rs/core/src/guardian) | `GuardianAssessmentOutcome`/`Status`；**"`None` requests the existing user flow. No contributor is never an implicit allow."** | — | 🟡 |
| C57 | [zcode·turn-loop.ts](../oss/zcode/apps/zcode-cli/packages/core/src/runtime/methods/turn-loop.ts) | 那条**修过 bug 的注释**：automation 写工具必须在 provider 请求边界**按 `queryId` 再硬过滤** | 与 B15 同源 | 🟢 |
| C58 | [claude-official·claude-code.d.ts](../refs/claude-official/mods/types/claude-code.d.ts) | **链位置决定优先级**（`tier`：托管 > 用户 > 项目 > 核心）；规则匹配只产出 `rule` 证据 | 🔴 专有，只读声明；配套 I12 | 🔴 |

### D. Sandbox

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| D1 | [codex·sandboxing/windows.rs](../oss/codex/codex-rs/sandboxing/src/windows.rs) + [deny_read_acl.rs](../oss/codex/codex-rs/windows-sandbox-rs/src/deny_read_acl.rs) | 工作区边界**单一入口**的形状；ACL **递归拒绝读** + 能力 SID 的实现（65 个 `.rs`） | — | 🟡 |
| D2 | [codex·prompts/templates/permissions](../oss/codex/codex-rs/prompts/templates/permissions) | 危险命令的**策略提示词模板**（如何向模型解释"这个要问"） | 模式库本身看 C10 | 🟢 |
| D3 | [codex·doctor/network.rs](../oss/codex/codex-rs/cli/src/doctor/network.rs) | 网络策略**单列成一档**，与进程策略分开 | — | 🟡 |
| D4 | [pi·types.ts](../oss/pi/packages/agent/src/types.ts) | `ToolContext` 的接口形态 —— **工具根本拿不到裸进程 API**（编译期保证，不是约定） | — | 🟡 |
| D5 | [dsh·packages/sandbox/](../oss/deepseek-harness/packages/sandbox) | 可插后端的**接口边界**（`sandbox` / `sandbox-local` / `sandbox-policy` / `sandbox-windows-acl`） | — | 🟡 |
| D6 D16 | [codex·setup.rs](../oss/codex/codex-rs/windows-sandbox-rs/src/setup.rs) | `WindowsSandboxLevel={Disabled,RestrictedToken,Elevated}` 三档；`:740` `SandboxNetworkIdentity` —— **两个真实 OS 账户 + WFP** | **先定待定8**（是否接受建账户） | 🟡 |
| D7 O18 | [codex·cli/src/doctor/](../oss/codex/codex-rs/cli/src/doctor) | 自检体系的组织方式（可独立运行、按子系统分文件） | — | 🟡 |
| D8 | [codex·dpapi.rs](../oss/codex/codex-rs/windows-sandbox-rs/src/dpapi.rs) | `CryptProtectData` 的**极简封装**（这段可以直接照写） | — | 🟢 |
| D10 | [dsh·sandbox-windows-acl](../oss/deepseek-harness/packages/sandbox/sandbox-windows-acl) | **另一条** Windows ACL 路线，与 Codex 独立 | 与 D6 二选一或互补 | 🟡 |
| D11 | [dsh·packages/shell/](../oss/deepseek-harness/packages/shell) | `pwsh-local` / `pwsh-sandbox` 的**两态拆分**；持久 PTY 的做法 | — | 🟡 |
| D12 | [dsh·packages/ssh/](../oss/deepseek-harness/packages/ssh) | `fs-ssh` / `sandbox-ssh` / `subprocess-ssh` **三层**的边界 | — | 🟡 |
| D13 D14 | [dsh·subprocess-native-containment.md](../oss/deepseek-harness/.agents/notes/implemented/architecture/2026-08-28-subprocess-native-containment.md) | **Windows kill-on-close Job** 作"管辖范围所有者"；正确性论证（子进程可 `setsid`/重挂父/活过父）；**不可靠兜底必须显式告警** | 别只做父进程遍历 | 🟡 |
| D15 M8 M9 | [pi-desktop·ADR 0041](../oss/pi-desktop/docs/adr/0041-bounded-host-runtime-and-persistence-outbox.md) | 有界准入 + 每会话上限 + **超时子进程先回收再释放许可** + file-backed outbox + **握手 await 排空后才 ready** + 追加按 id 幂等 | 🔴 只学行为；配套 [ADR 0053](../oss/pi-desktop/docs/adr/0053-plan-checkpoint-artifact-and-execution-epoch.md) 的 execution epoch | 🔴 |

### E. Session

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| E1 | [pi·commit.ts](../oss/pi/packages/agent/src/harness/session/commit.ts) | `CommittedListAppendWrite` —— **append-only 的写入形状** | — | 🟡 |
| E2 | [cc-switch·database/](../oss/cc-switch/src-tauri/src/database) | SQLite + DAO 分层（`dao/providers.rs` vs `dao/universal_providers.rs`） | 反面：OpenCode 的 JSON 文件树（R2-20） | 🟡 |
| E3 E15 | [zcode·zcodeSessionEventCoalescer.ts](../oss/zcode/packages/services/src/zcode-agent/zcodeSessionEventCoalescer.ts) | **事件合并器**作独立模块 —— 直接服务"1 万事件 < 200ms" | 别全量重放 | 🟢 |
| E4 | [opencode·revert.ts](../oss/opencode/packages/opencode/src/session/revert.ts) | revert 到任意事件点的实现 | 真正的回退还要 E11 | 🟡 |
| E5 E6 | [pi·fork-policy.ts](../oss/pi/packages/agent/src/harness/session/fork-policy.ts) + [pi-desktop·ADR 0023](../oss/pi-desktop/docs/adr/0023-independent-conversation-session-fork.md) | `ForkCurrentStatePlan={branch\|tree}` **一套抽象两用**；fork 由 host 拥有为单次快照操作、**重映射消息与 tool-call 标识**、**未知边界返回 `NOT_FOUND` 而非创建子会话** | 🔴 ADR 只学行为 | 🟡 |
| E7 | [kimi·transcript/](../oss/kimi-code/packages/transcript) | 会话记录**独立成包**，可脱离内核检视 | — | 🟡 |
| E8 | [kimi·sessionIndex](../oss/kimi-code/packages/agent-core-v2/src/app/sessionIndex) + [sessionExport](../oss/kimi-code/packages/agent-core-v2/src/app/sessionExport) | 索引 / 导出**分开**，迁移不互相污染 | 反面：`migration-legacy` 兼容层是包袱，**不要继承** | 🟡 |
| E9 | [dsh·session-reference](../oss/deepseek-harness/packages/context/session-reference) | 会话被其他会话引用的形状 | — | 🟡 |
| E10 M3 | [codex·daemon_recovery.rs](../oss/codex/codex-rs/core/src/session/daemon_recovery.rs) | **"持久化快照前必须 flush"** 的纪律 | 与 Q5 启动期对账配套 | 🟡 |
| E11 | [pi·git-checkpoint.ts](../oss/pi/packages/coding-agent/examples/extensions/git-checkpoint.ts) | 每 turn 打 git stash，`/fork` 时把**代码**恢复到对应历史点 | **这是场景① 的真正要求** | 🟢 |
| E12 | [dsh·session-projection-and-command-log.md](../oss/deepseek-harness/.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md) | **整值事件规则**的四条理由（转换极简 / 值自描述 / 按 seq 免疫乱序 / 丢一次会自愈） | — | 🟡 |
| E13 E14 | [dsh·event-sourced-sessions.md](../oss/deepseek-harness/.agents/notes/implemented/architecture/2026-06-11-event-sourced-sessions.md) | **同步 append + write-behind + turn 末 flush**；**原始分片与组装消息都留**、派生以组装为准；append **同步、热路径绝不阻塞 I/O** | — | 🟡 |
| E16 O12 | [dsh·invariant.ts](../oss/deepseek-harness/packages/schedule/schedule/src/invariant.ts) | **一个 `fold` 同时当投影与校验器**；校验在 **append 之前**跑（`ctx.on('internal/dispatch', …)` + `validate([...session.ownEvents(), event], fail)`） | 全仓 38 处同构，可挑 2–3 处对照 | 🟢 |
| E17 | [zcode·session.events.ts](../oss/zcode/apps/zcode-cli/packages/contracts/src/events/session.events.ts) | 原子操作的**中间态**（reservation / promoting / rollback）如何进事件流 | — | 🟢 |
| E18 | [kimi·engine.ts](../oss/kimi-code/packages/agent-core-v2/src/agent/loop/machine/engine.ts) | 回合结局与 `produced[]` **一起结算**（机器自报，优于事后反推） | — | 🟡 |

### F. Context

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| F1 J1 J2 | [pi·packages/ai/](../oss/pi/packages/ai) | 厂商适配独立成包；流式响应的适配边界 | — | 🟡 |
| F2 | [opencode·AGENTS.md](../oss/opencode/AGENTS.md) | 项目指令**文件实例**（内容是 opencode 自己的开发规范）。**加载逻辑我方自研**（2026-09-25 裁决）：CWD 向上收集 + 就近覆盖 —— 上游的加载器实现未定位，执行时可在 `packages/opencode/src/` 深入找，找到则回填本行 | 就近生效的"怎么加载"不能从该文件实例推出 | 🟢 |
| F3 F4 F20 F21 F24 F26 F27 J25 | [codex·compact_token_budget.rs](../oss/codex/codex-rs/core/src/compact_token_budget.rs) | **本文件是压缩域的权威参考**。取：模块注释那段"token 预算式压缩跳过模型摘要、直接装一个新窗口，**但仍建模为 compaction，以便 compact hook 与 `ContextCompaction` turn item 观察到同一生命周期**"；`CompactionPhase` 四值；`CompactionReason`（含 `ModelDownshift` / `CompHashChanged`）；`CompactionStrategy{Memento,PrefixCompaction}` | **优先级最高的一条**（用户指定"最好用"） | 🟢 |
| F5 | [qwen·docs/design/session-recap/](../oss/qwen-code/docs/design/session-recap) | 会话摘要/标题的**设计文档**（读文档，不读代码） | 同目录另有 `session-title/` | 🟢 |
| F6 F13 F14 F15 F16 | [pi-mono·anthropic-cache-split.ts](../oss/pi-mono/packages/ai/src/api/anthropic-cache-split.ts) | **提示缓存前缀稳定性的唯一来源**。取：前缀切分策略；再读 [cache-marker-telemetry-scar.md](../oss/pi-mono/docs/claude-bridge-cache-marker-telemetry-scar.md)（**这是一篇"疤"文档** —— 别人踩过的坑）与 [cache-retention.ts](../oss/pi-mono/packages/ai/src/utils/cache-retention.ts) | 我方效率要求里此前**完全没有这一维** | 🟢 |
| F7 | [codex·current_time_reminder.rs](../oss/codex/codex-rs/core/src/context/current_time_reminder.rs) | 当前时间如何注入、长会话中如何不漂移 | — | 🟢 |
| F8 | [opencode·truncate.ts](../oss/opencode/packages/opencode/src/tool/truncate.ts) | 工具结果裁剪器**独立成模块**（另有专门的 `truncation-dir.ts`） | — | 🟡 |
| F9 | [pi-desktop·ADR 0030](../oss/pi-desktop/docs/adr/0030-turn-boundary-context-checkpoint-compaction.md) | **用真实事故换来的论证**：Bedrock 达 1,077,172 tokens 而上限 1,000,000，provider 在有任何恢复点前即拒绝；以及"pi-agent-core 提供什么、**不定义什么**"的划界 | 🔴 只学行为 | 🔴 |
| F10 | [dsh·after-call-compaction-pressure.md](../oss/deepseek-harness/.agents/notes/implemented/architecture/2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md) | **压力信号不能只看成功调用**：provider 可能在返回 usage 前拒绝；有些成功调用不返回 usage；恢复**在压缩无法证明进展时必须保留 provider 原始错误** | — | 🟡 |
| F11 | [pi-desktop·ADR 0049](../oss/pi-desktop/docs/adr/0049-context-compaction-failure-recovery.md) → [0282](../oss/pi-desktop/docs/adr/0282-compaction-summary-retry-and-sizing.md) → [0302](../oss/pi-desktop/docs/adr/0302-compaction-fallback-recent-window-and-chunked-summary.md) | 三级兜底：**摘要重试与尺寸控制 → 回退近期窗口 → 分块摘要** | 🔴 只学行为 | 🔴 |
| F12 |  [claude-official·claude-code.d.ts:588](../refs/claude-official/mods/types/claude-code.d.ts#L588) | `ToolDeferral` 的**声明形状**：工具藏在检索后，模型按名索要才加载 schema | 与 F13/F14 相互约束（延迟加载会破坏前缀 → 必须"首次请求即声明"） | 🔴 |
| F17 | [dsh·tool-pairing.ts](../oss/deepseek-harness/packages/compaction/compaction/src/tool-pairing.ts) | 压缩切点必须**工具调用-结果配平**，且**从内容现算**（不依赖可能被重写的 step 标记） | — | 🟢 |
| F18 F19 | [zcode·session.events.ts](../oss/zcode/apps/zcode-cli/packages/contracts/src/events/session.events.ts) | `StreamRecovery*` **6 个事件** —— 我方完全空白的维度：锚点先于故障持久化 / 有界重试 / **显式终态 `blocked`** | — | 🟢 |
| F22 F23 F25 | [codex·session/mod.rs:4530](../oss/codex/codex-rs/core/src/session/mod.rs#L4530) | `start_new_context_window(step_context, world_state) -> u64` 返回 `(window_number, window_ids)`；`:4536` **保留客户端 developer 消息** | — | 🟢 |
| F28 | [zcode·compact.ts](../oss/zcode/apps/zcode-cli/packages/core/src/runtime/methods/compact.ts) | `evaluateRapidRefill` + `MAX_CONSECUTIVE_RAPID_REFILLS` —— **压缩抖动的硬失败保护**。症状："账单暴涨且看不到尽头" | **只有 ZCode 一家有，建议无条件采纳** | 🟢 |
| F29 O9 O20 O21 O22 O29 | [codex·compact.rs:423](../oss/codex/codex-rs/core/tests/suite/compact.rs#L423) | `assert_pre_sampling_switch_compaction_requests`：**压缩跑在旧模型、后续跑在新模型**；以及"先断言模型调用次数 + 少数关键语义用 `assert` + 一句人话 + 其余交给快照"的**配对模式** | 快照真实长相见 `docs/research/20-testing.md` | 🟢 |
| F30 B21 | [codex·session/tests.rs](../oss/codex/codex-rs/core/src/session/tests.rs) | 读测试名：`reload_user_config_layer_keeps_previous_config_for_malformed_shell_policy`（**保留上一份配置而非回退默认**）、`…runtime_refreshable_fields_and_keeps_session_static_settings` | — | 🟡 |

### G. Planning

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| G1 | [opencode·plan.ts](../oss/opencode/packages/opencode/src/tool/plan.ts) | `plan-enter`/`plan-exit` **提示词独立成文件** + 模式进出的实现 | 与 G7 的另一种做法（Plan 是同 Agent 的一个状态）二选一 | 🟢 |
| G2 | [opencode·todo.ts](../oss/opencode/packages/opencode/src/session/todo.ts) | todo 的存储与暴露方式 | — | 🟡 |
| G3 G4 M5 | [dsh·packages/goal/](../oss/deepseek-harness/packages/goal) | **goal 四件套**：`goal` / `goal-round-driver`（跨轮）/ `command-goal` / `tool-goal` —— "工具即包、可独立版本化"的范例 | — | 🟡 |
| G6 | [kimi·goalDeadlineScheduler.ts](../oss/kimi-code/packages/agent-core-v2/src/features/goal/goalDeadlineScheduler.ts) | deadline 调度器 + 到期行为 | — | 🟡 |

### H. Subagents

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| H1 H4 | [opencode·task.ts](../oss/opencode/packages/opencode/src/tool/task.ts) | **子代理就是一个工具** —— 自动继承权限/审批/事件，无需新抽象 | — | 🟢 |
| H2 H3 H6 | [dsh·subagent](../oss/deepseek-harness/packages/subagent) | **结算栅栏**（原子并入父会话）；五种执行后端（ACP / CC / Codex / DSH-SDK / 进程内 fork） | — | 🟡 |
| H5 | [opencode·subagent-permissions.ts](../oss/opencode/packages/opencode/src/agent/subagent-permissions.ts) | `deriveSubagentSessionPermission`：**只继承 `deny` 与 `external_directory`，不继承授权**；默认禁用 `task`（不可再分）与 `todowrite` | — | 🟢 |

### I. MCP / Skills / Hooks / Plugins

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| I1 I2 I6 | [pi·hooks.ts](../oss/pi/packages/agent/src/harness/hooks.ts) + [skills.ts](../oss/pi/packages/agent/src/harness/skills.ts) | hooks 与 skills 是**内核概念**（不是插件）；权限双轨的接口形态 | — | 🟡 |
| I3 | [opencode·mcp.ts](../oss/opencode/packages/app/src/context/mcp.ts) | MCP 工具如何自动注册进工具注册表 | — | 🟡 |
| I4 | [pi-desktop·plugin-websocket.ts](../oss/pi-desktop/apps/desktop/electron/main/plugin-websocket.ts) | 不可信插件跑**独立 websocket 进程** | 🔴 只学行为 | 🔴 |
| I5 | [opencode·plugin/](../oss/opencode/packages/plugin) | `@opencode-ai/plugin` 的 `ToolDefinition` 与 SDK 边界 | — | 🟡 |
| I7 | [dsh·packages/hooks/](../oss/deepseek-harness/packages/hooks) | **同时提供 `hooks-claude-code` 与 `hooks-codex`** —— 兼容既有生态的做法 | — | 🟡 |
| I8 | [codex·templates/personalities](../oss/codex/codex-rs/core/templates/personalities) | 人格模板**独立成目录**（`gpt-5.2-codex_friendly.md` / `_pragmatic.md`） | — | 🟢 |
| I9 | [pi-desktop·plugins/validation.rs](../oss/pi-desktop/crates/host-core/src/plugins/validation.rs) | **安装期全量校验、闭集枚举、未实现的能力直接 `bail!` 拒绝声明**（不是忽略、不是警告） | 🔴 只学行为 | 🔴 |
| I10 | [zcode·session.events.ts](../oss/zcode/apps/zcode-cli/packages/contracts/src/events/session.events.ts) | hook 复核结论**可被 `superseded`**，且取代本身是持久事实 | — | 🟢 |
| I11 | [dsh·packages/guard/](../oss/deepseek-harness/packages/guard) | 治理逻辑做成可插拔包（`repeat-tool-reminder` / `timeout-policy`） | — | 🟡 |
| **I12** | [claude-official·mods/README.md](../refs/claude-official/mods/README.md) | **洋葱链 `($, e, next)` 的形态**：每层可"进去前 / 出来后"、可截断不往下传。**Q14 已定要它** —— 这决定 P0 的 loop 与 tools 怎么组织 | 🔴 只读行为；**P0 只挂 3 个点**控制额度 | 🔴 |
| I13 | 同上 | `next.trace` / `next.budget`：每层可观测、可预算 | 链的附带收益，P1 再做 | 🔴 |
| I14 | 同上 | `next.to(e, tier)` 跨层跳 | 托管层直达，P2 | 🔴 |

### J. Models

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| J3 J15 J16 | [cc-switch·schemas/provider.ts](../oss/cc-switch/src/lib/schemas/provider.ts) | `settingsConfig: z.string().superRefine(JSON.parse)` —— **存不透明字符串、只校验语法**，不为 N 个异构厂商建模；故障转移见 [failover.rs](../oss/cc-switch/src-tauri/src/database/dao/failover.rs)（**队列**非开关，按后端分区） | 反面：`failover` 是"切换配置"**非**"运行时路由"（J5 需自研） | 🟢 |
| J4 J6 J7 J9 | [pi·agent-harness.ts:142](../oss/pi/packages/agent/src/harness/agent-harness.ts#L142) | **本层最重要的一处**：`ModelIdentity = {provider, modelId}`；`configuredModel`（当前配置）与 `capturedModel`（在途操作启动时捕获）**分离**；`:574` `setModel()`；`:375` 换模是 `config_update` 事件且按作用域分（lane 级可切 model/thinkingLevel/activeTools） | **R14-1 是 Q6 多端并发与换模的交叉点** | 🟢 |
| J5 J1 J2 K1 K5 | [pi·packages/](../oss/pi/packages) | 厂商适配独立成包；kernel/host/ui 彻底分离（11 workspace，**构建序即依赖序**） | — | 🟡 |
| J8 J11 J13 J14 | [grok·agent.rs:647](../oss/grok-build/crates/codegen/xai-grok-pager/src/app/agent.rs#L647) | `DeferredModelSwitch{model_id, effort, prev_model_id}`（**`prev_model_id` 即回滚目标**）；四态 `model_switch_pending` / `user_model_preference` / `model_incompatible`；`:746` `ReconnectState::user_selected_model` **抑制 replay 的静默回退**；配套 [zcode·runner.ts:353](../oss/zcode/apps/zcode-cli/packages/adapters/src/model/runner.ts#L353) 的硬守卫 `"Runtime header refresh changed the bound model identity."` | J13 是"刷新鉴权头不得改模型身份"的**可执行**保证 | 🟢 |
| J10 | [dsh·session-controller/commands.ts](../oss/deepseek-harness/packages/api/session-controller/src/commands.ts) | `SessionSelectModelRequest/Value`、`selectModel()`、`agentDefaultModel.saveSelection()`、错误码 `session/model-unavailable` —— **会话级与全局默认分开存且不一致要显式报错** | 这正是 PiDeck 踩的坑（R10-5/R10-6）的解法 | 🟡 |
| J12 | [hermes·model_catalog.py](../oss/hermes-agent/acp_adapter/model_catalog.py) | 选择器工程化：按 `provider:model` 去重、**每厂商上限 200**（单下拉框渲染）、`custom:<name>` slug 保证 choice id 可回环、**discovery 失败时声明的模型仍存活** | — | 🟢 |
| J17 | [kimi·packages/oauth/](../oss/kimi-code/packages/oauth) | OAuth 独立成包，不侵入内核 | — | 🟡 |
| J18 J21 | [hermes·rate_limit_tracker.py](../oss/hermes-agent/agent/rate_limit_tracker.py) + [billing_usage.py](../oss/hermes-agent/agent/billing_usage.py) | 按 provider 的限流追踪与成本核算分开成模块 | 另有 `rate_limit_credits` / `billing_links` / `aux_accounting` | 🟡 |
| J19 | [grok·xai-circuit-breaker](../oss/grok-build/crates/common/xai-circuit-breaker/src/retry_policy.rs) | 熔断器独立成 crate + `retry_policy.rs` | — | 🟢 |
| J20 | [codex·turn_admission.rs](../oss/codex/codex-rs/app-server/src/turn_admission.rs) | turn 级**准入闸门**（超限排队而非无限并发） | 与 M9 同源 | 🟡 |
| J22 M6 M7 | [dsh·timeout-policy](../oss/deepseek-harness/packages/guard/timeout-policy/src/index.ts) + [util/timeout](../oss/deepseek-harness/packages/util/timeout/src/index.ts) | **超时是一个独立库**，不是散落的 `setTimeout`。取：`TimeoutReason{code, timeoutMs}` 的**错误码作用域**、signal 换回/恢复、"without racing or abandoning the tool promise" | 别用 signal 判定"谁超时" | 🟢 |
| J23 J24 | [dsh·util/timeout](../oss/deepseek-harness/packages/util/timeout/src/index.ts) | `IdleWatchdog` + `pulse()`（**可重臂空闲**）；`MAX_TIMER_DELAY_MS = 2_147_483_647`（超出被静默钳到 1ms） | — | 🟢 |
| J26 J27 A5 B19 E18 | [kimi·retry.ts](../oss/kimi-code/packages/agent-core-v2/src/human/llm/requester/retry.ts) + [engine.ts](../oss/kimi-code/packages/agent-core-v2/src/agent/loop/machine/engine.ts) | `DEFAULT_MAX_RETRY_ATTEMPTS = 10`、`RETRYABLE_STATUS_CODES = [408,409,429,500,502,503,504,529]`、`unknown` **不重试**、`empty_response` 仅在 `finishReason !== 'filtered'` 时可重试；`retrying` 是一等事件 | — | 🟢 |

### K. Surfaces

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| K2 | [cc-switch·src-tauri/](../oss/cc-switch/src-tauri) | **Tauri 2 在同类场景的实测先例**（33MB，桌面 + 读写本地配置） | — | 🟡 |
| K3 | [pi-desktop·agent-host-bridge.ts](../oss/pi-desktop/apps/desktop/electron/main/agent-host-bridge.ts) | 多 host 注册 + IPC 桥的**行为**（架构与壳框架无关，改 Tauri 仍可照搬） | 🔴 只学行为 | 🔴 |
| K4 | [grok·xai-acp-lib](../oss/grok-build/crates/codegen/xai-acp-lib) | ACP 独立成 crate，**仅 8 个文件**（`channel`/`message`/`normalize`/`gateway`…） | **反面**：[qwen·acp-integration](../oss/qwen-code/packages/cli/src/acp-integration) 把 ACP 塞进 CLI 包 | 🟢 |
| K6 | [pideck·FeishuBridge.ts](../oss/pideck/src/main/feishu/FeishuBridge.ts) | 飞书桥的现成参考（场景③ 的 IM 端） | — | 🟢 |
| K7 | [opencode·packages/slack/](../oss/opencode/packages/slack) | Slack 适配器 | — | 🟡 |
| K8 | [pi·packages/protocol](../oss/pi/packages/protocol) | `protocol` + `client` + `server` **三层分离** | — | 🟡 |
| K9 | [zcode·cuaPipSession.ts](../oss/zcode/packages/services/src/cua-permission-broker/cuaPipSession.ts) | 画中画：把 agent 的屏幕操作显示在浮动窗口 | — | 🟡 |

### L. Observability

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| L1 A6 | [pi·types.ts:485](../oss/pi/packages/agent/src/types.ts#L485) | 事件即轨迹：**不另存一份日志** | — | 🟢 |
| L3 | [cc-switch·stream_check.rs](../oss/cc-switch/src-tauri/src/database/dao/stream_check.rs) | token 统计 + 日志**保留期清理** | — | 🟡 |
| L4 | [codex·rollout-trace/](../oss/codex/codex-rs/rollout-trace) | 轨迹 + reducer：从事件流**重放**一次真实会话 | — | 🟡 |
| L5 | [opencode·http-recorder](../oss/opencode/packages/http-recorder) | HTTP 级录制（`cassette.ts`）—— 调试模型交互 | 同时是 O15 的参考 | 🟡 |
| L6 | [hermes·gateway/](../oss/hermes-agent/gateway) | 网关层：汇总危险操作与审批做审计报表 | — | 🟡 |
| L7 | [dsh·session-projection-and-command-log.md](../oss/deepseek-harness/.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md) | **命令的调用与裁决是独立的持久化对象**：域状态持久、但 `/goal`/`/plan` 的结果原先只在 RPC 响应里 → 刷新/换端/fork 后"执行过"即丢失 | — | 🟡 |
| L8 | [codex·analytics/facts.rs](../oss/codex/codex-rs/analytics/src/facts.rs) | 压缩作为结构化度量事件的 **6 维分类**（trigger / reason / implementation / phase / strategy / status） | — | 🟢 |
| L9 | [zcode·turn-loop.ts](../oss/zcode/apps/zcode-cli/packages/core/src/runtime/methods/turn-loop.ts) | 循环内分段计时（mcp / tools 各自打点） | — | 🟡 |
| L10 | [claude-official·mods/README.md](../refs/claude-official/mods/README.md) | 链底"**无人应答的调用抛错并点名事件**" | 🔴 只读行为 | 🔴 |

### M. 长任务

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| M1 M2 | [dsh·packages/jobs/](../oss/deepseek-harness/packages/jobs) | **jobs 三件套**：`jobs` / `jobs-local` / `tool-jobs` —— 后台任务即工具，状态可查可取消 | — | 🟡 |
| M3 E10 Q5 | [codex·daemon_recovery.rs](../oss/codex/codex-rs/core/src/session/daemon_recovery.rs) + [pi-desktop·migrations.rs](../oss/pi-desktop/crates/host-core/src/db/migrations.rs) | **"快照前必须 flush"**（Codex）与**启动期对账**（pi-desktop `boot_maintenance`：把 `running` 全改 `aborted`，给 `PLAN_APPROVAL_INTERRUPTED` / `PLAN_EXECUTION_INTERRUPTED` 细分码） | 两边配套用 | 🟡 |
| M4 | [qwen·session-idle-reaper](../oss/qwen-code/docs/design/session-idle-reaper) | 空闲回收的设计文档 | 同目录另有 `session-crash-recovery/` | 🟢 |
| M10 | [codex·rollout_budget.rs](../oss/codex/codex-rs/core/src/rollout_budget.rs) | **预算是"要送达的事实"**：分级阈值 + **送达记账**（写进历史后才算送达，取消则重试）+ 换窗重置 | 别把预算当"限制" | 🟢 |
| M11 | [zcode·offPeakDispatchSettlement.ts](../oss/zcode/packages/desktop/src/scheduler/offPeakDispatchSettlement.ts) | 闲时任务：长任务取号、闲时窗口核销执行 | 另见 `bootstrap/src/zcode-protocol/offpeak-port.ts` | 🟡 |

### N. 多端同步

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| N3 N4 N6 N7 | [zcode·sessionRealtimePort.ts](../oss/zcode/packages/services/src/session/sessionRealtimePort.ts) | **N 层的蓝本**：`owner + lease + 类型化 owner 命令`；**审批 / elicitation / hook 复核共用一条命令通道**；命令是**闭集**；结果**回传**；每个界面是一个 **host**（有投递方式之分） | OpenCode 的 `Deferred + Map` 降为实现细节 | 🟡 |
| N8 A12 |  [claude-official·claude-code.d.ts:588](../refs/claude-official/mods/types/claude-code.d.ts#L588) | 多端 = **surface roster**，attach/detach 由事件维护（`session.attach`） | 🔴 只读声明 | 🔴 |
| N1 N5 | — | **自研**：统一会话 ID 与推送没有值得抄的上游 | 注意 A9：**协议层不提供 per-prompt 完成语义** | — |
| **N9 N10** | [pi-desktop·config_sync/](../oss/pi-desktop/crates/host-core/src/config_sync) | **Q20 已定要做**：加密 vault + 远端存储 + **三方合并** + 导入日志可崩溃恢复。**这是一整个子系统的量**（13 个文件），不是"配置放哪儿" | 🔴 只学行为；**里面有 API key，加密不是可选项** | 🔴 |

### O. 测试与诊断

> **本层的三个核心答案是跨仓收敛出来的**，不是某一家：
> 不要在内部状态上断言 → 断言"模型实际看到 / 产生的那个东西" → 归一化后做成快照。

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| O1 O13 O14 O20 O27 | [codex·context_snapshot.rs](../oss/codex/codex-rs/core/tests/common/context_snapshot.rs) | **主断言面**：`ContextSnapshotOptions::rewrite_known_segments()` / `include_request_settings()`；**窗口内差分**（首条全量、后续只留后缀）；`MAX_SNAPSHOT_LINE_CHARS = 160`；长指引折成一行标签 | — | 🟢 |
| O2 | [codex·responses.rs:1426](../oss/codex/codex-rs/core/tests/common/responses.rs#L1426) | `mount_sse_sequence(server, Vec<String>)` —— **按模型调用次数挂脚本 SSE**；`mount_sse_once` 在 `:1108`、`start_mock_server` 在 `:1167`。跑真实的 HTTP 路径 / SSE 解析 / 会话循环，只有"对面的模型"是假的 | — | 🟢 |
| O3 O4 O6 O17 O28 | [dsh·normalize.ts](../oss/deepseek-harness/packages/test-support/session-snapshot/src/normalize.ts) | **归一化的权威实现（625 行）**：易变值换成**具名占位符**（`{{sessionId}}` `{{cwd}}` `{{system}}` `{{tools}}` `{{eventTime}}` `{{eventOmittedBytes}}`…）；路径归一化是真正的工作量（`cwdSpellings` / `<path>` 标签 / `file:///` 前缀 / 词边界）。**测试在 `tests/`（1,259 行）—— 测试比实现多** | 别用通用 `<redacted>`（会丢结构信息） | 🟢 |
| O5 O11 O23 O24 | [kimi·snapshots.ts](../oss/kimi-code/packages/agent-core-v2/test/harness/snapshots.ts) | **Symbol 标记 + `expect.addSnapshotSerializer`**（输出格式是 harness 的职责）；`SnapshotLabels{uuidLabels,msgLabels,interactionLabels}` —— **稳定标签保留身份**；`GenerateInputSnapshot{input, previous}` —— **快照自带前一次调用，差分在序列化时算**；system prompt **等于默认值就折叠成 `<system-prompt>`**（**使 F13 缓存前缀稳定性可测**）；事件快照 `[wire]`/`[emit]` 前缀 + `padEnd` 对齐 + 单行 JSON | **别抄**：它的 tools 快照**只打工具名不打 schema** —— 用 Codex 的 `portable_tool_schema` | 🟢 |
| O7 O10 O29 | [codex·compact.rs:450](../oss/codex/codex-rs/core/tests/suite/compact.rs#L450) | `assert_compaction_uses_turn_lifecycle_id` —— **断言流上的不变量，不写事件列表**：消费真实事件流，断言"同一回合内所有条目携带该回合的事件 id"；模式匹配钉住类型与载荷形状（编译期即炸）；不期望的事件**直接 panic** | 快照真实长相见 `docs/research/20-testing.md` | 🟢 |
| O8 O26 | [codex·session/tests.rs:761](../oss/codex/codex-rs/core/src/session/tests.rs#L761) | **每次 recv 都套 `tokio::time::timeout` + 具名 `expect`**（事件驱动测试最坏的失败是"挂住"）；**测试名就是完整的行为规格** | — | 🟢 |
| O9 O15 O16 | [dsh·test-support](../oss/deepseek-harness/packages/test-support) | **测试基础设施做成包组**（7 包、22,817 行）；`llm-replay`（录制/回放真实流）+ `llm-mock-server`（**故障注入服务器** —— 把"注入故障"当一等测试能力） | 我读过的其他仓都只 mock happy path | 🟡 |
| O12 | [dsh·invariant.ts](../oss/deepseek-harness/packages/schedule/schedule/src/invariant.ts) | 包自己拥有不变量，可自动断言防回归 | 同 E16 | 🟢 |
| O19 | [kimi·migration-legacy](../oss/kimi-code/packages/migration-legacy) | 迁移断言：旧字段不再被读 / 旧入口已退役 / 迁移后可恢复 | ZCode 全仓唯一一类测试，但它本身是六个仓里测试覆盖最弱的，**不作正面示范** | 🟢 |
| O25 O30 | [pi-desktop·plugins/tests.rs](../oss/pi-desktop/crates/host-core/src/plugins/tests.rs) | **进程全局状态的隔离**：`MARKET_ENV_LOCK: Mutex<()>` 且注释写明**故障机制**（不只写"要加锁"）；`with_local_market(f)` RAII 守卫；处理中毒；用"指向不存在的 URL"**强制走离线回退** | 🔴 只学行为 | 🔴 |
| O18 | [codex·cli/src/doctor/](../oss/codex/codex-rs/cli/src/doctor) | 自检体系可独立运行、按子系统分文件 | 与 D7 同源 | 🟡 |

### P. 多模态与附件

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| P1 | [kimi·transcript/model/attachment.ts](../oss/kimi-code/packages/transcript/src/model/attachment.ts) | 类型化附件协议 + 存储抽象 | codex 另有 `ThreadAttachment.ts` | 🟡 |
| P2 | [dsh·durable-image-offload.md](../oss/deepseek-harness/.agents/notes/archived/architecture/2026-09-02-durable-image-offload.md) + [image-offload-events.md](../oss/deepseek-harness/.agents/notes/implemented/architecture/2026-09-10-image-offload-events.md) | 图片**移出上下文并可回取**的事件设计 | — | 🟡 |
| P3 | [pi-desktop·attachment-limits.ts](../oss/pi-desktop/packages/shared/src/attachment-limits.ts) | 限额独立模块（类型 / 大小 / 数量） | 🔴 只学行为 | 🔴 |
| P4 | [dsh·api-speech-to-text](../oss/deepseek-harness/packages/experimental/api-speech-to-text) | 语音转文字 | 非必需 | 🟡 |

### Q. 会话数据运维

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| Q1 | [dsh·session-format-v0-to-v1](../oss/deepseek-harness/packages/session/session-format-v0-to-v1) + [版本机制 ADR](../oss/deepseek-harness/.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md) | **逐版本迁移链**（v0→v1→v2→v3→v4 各一个包，**不是两套格式并存**）；ADR 的五条规则：单调整数不搞 major/minor · **写入方决定 bump** · 判据是"旧运行时能否保持完整语义正确"（**"能解析不报错"不是标准**）· 只有结构性变更才算 · **拿不准就 bump**。**真实 bug**：未知事件类型被原样透传 → 重建静默跳过 → **恢复出被掏空的会话且无诊断** | Q1 整条的依据 | 🟢 |
| Q2 | [dsh·session-query](../oss/deepseek-harness/packages/session-query) | 会话查询服务 + 工具化（`tool-session-query`）；走 SQL 而非全量加载 | — | 🟡 |
| Q3 | [dsh·packages/spill/](../oss/deepseek-harness/packages/spill) | 落盘文件的**独立生命周期策略包**（不是随手 write temp） | codex `hooks/src/output_spill.rs`、hermes `tools/spill_safety.py` 同类 | 🟡 |
| Q4 Q5 Q6 | [pi-desktop·db/migrations.rs](../oss/pi-desktop/crates/host-core/src/db/migrations.rs) | `boot_maintenance`：启动期 SQL 对账关掉崩溃孤儿；`AUDIT_RETENTION_MS = 90 天`、`TASK_RUNS_KEEP = 100` | 🔴 只学行为 | 🔴 |
| Q7 Q8 | [codex·rollout/compression.rs](../oss/codex/codex-rs/rollout/src/compression.rs) | 冷热分离 + 后台 zstd：`COMPRESSED_SUFFIX = ".zst"`、`MAX_NOT_FOUND_RETRIES = 3`、`OPEN_ROLLOUT_LINE_READER_RETRY_DELAY = 50ms`、`RolloutCompressionTrigger{Startup,Rpc}`；**表示形态对上层透明** | 别抄 `rollout/src/list.rs` 无理由的 `#![allow(warnings, clippy::all)]` | 🟡 |

### S. 调度与集成

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| S1 | [codex·ScheduledTaskWeekday.ts](../oss/codex/codex-rs/app-server-protocol/schema/typescript/v2/ScheduledTaskWeekday.ts) + [kimi·cron-store.ts](../oss/kimi-code/apps/vis/server/src/lib/cron-store.ts) | 定时定义的类型化形状 + cron 存储 | 与 M 层 job 复用调度器 | 🟡 |
| S2 | [dsh·packages/webhook/](../oss/deepseek-harness/packages/webhook) | `webhook` + `webhook-github` —— fire-and-forget 型会话 | qwen `ChannelWebhookTask.ts` 同类 | 🟡 |
| S3 | [qwen·packages/browser-use](../oss/qwen-code/packages/browser-use) | 浏览器使用独立成包（含 NOTICE） | **需单独沙箱与网络策略** | 🟢 |
| S4 | [codex·computer_use_config.rs](../oss/codex/codex-rs/app-server-protocol/src/protocol/v2/computer_use_config.rs) | 计算机使用的配置形状 | **风险最高，需最强审批** | 🟡 |
| S5 | [codex·feedback_processor.rs](../oss/codex/codex-rs/app-server/src/request_processors/feedback_processor.rs) | 反馈机制；doctor 报告随反馈一起上报（`feedback_doctor_report.rs`） | — | 🟡 |

### T. 工程实践与架构约束

| ID | 首选（点击） | 取什么 | 别抄 / 备选 | 复用 |
| --- | --- | --- | --- | --- |
| T1 T3 T4 | [zcode·architecture-policy.yaml](../oss/zcode/architecture-policy.yaml) | **架构即代码**：文件行数上限、禁止循环依赖与深导入、模块依赖白名单、公开入口清单、模块 owner；配 `architecture:check --changed` **只查改动** + **模块级 `managed` 开关做渐进采用** | **这是 `AGENTS.md` §8 的落点**（我方 §8 只有一句"按变更风险选择静态检查"） | 🟡 |
| T2 | [zcode·CONTEXT.md](../oss/zcode/CONTEXT.md) | 带**禁用词**的领域词汇表：每词条必须有 `_Avoid_` 行，按限界上下文分文件 | — | 🟡 |
| T5 T6 T7 | [kimi·tree-sitter-bash/README.md](../oss/kimi-code/packages/tree-sitter-bash/README.md) | **上限要写实测溢出点与余量倍数**（`MAX_SUBSTITUTION_DEPTH = 150`，实测溢出在 ~380–500）；**畸形输入永不抛异常、降级返回 + 显式错误标志**；**性能断言防复杂度退化**（不是防慢） | — | 🟢 |
| T8 | [kimi·known-diffs.txt](../oss/kimi-code/packages/tree-sitter-bash/test/fixtures/corpus/known-diffs.txt) | **以某上游为蓝本须产出 known-diffs 清单**：30+ 条有据可查的偏差，带 pin | — | 🟢 |
| **T9** | [zcode·architecture-policy.yaml](../oss/zcode/architecture-policy.yaml) | 用可校验的策略文件把"跨进程接口只传可序列化值"**变成机器能查的约束**（Q16 已定出进程） | 别只写在文档里 —— 这条纪律违反一次就难回头 | 🟡 |

---

## 2. 按仓查（优点清单原文）

> 下表是九轮调研累积的**按仓优点清单**，原文保留（编号 R1–R16 稳定，`docs/requirements.md` 的新表已不再引用它们）。
> **喂给**列指向 `docs/requirements.md` §4 的功能 ID。
> **注意**：整理时已把冲突的编号消除，若某行「喂给」的 ID 与正文语义不符，**以 §4 为准**。

#### 优点清单正文（R1–R16，原文保留）

**每条标注**：优点 · 证据路径（仓根相对） · 喂给 §5 的哪个功能 · 可复用性

##### 可复用性图例

- 🟢 **可摘代码**（MIT / Apache-2.0，须保留版权头 + 登记 `THIRD_PARTY.md`）
- 🟡 **只学形状**（抄抽象/接口，不抄实现）
- 🔴 **只学行为**（LGPL / 专有，代码一行不可摘）

#### R1 · pi（earendil-works/pi）· MIT · 内核首选参考

| # | 优点 | 证据路径 | 喂给 | 复用性 |
| --- | --- | --- | --- | --- |
| R1-1 | `AgentEvent` 事件联合体：turn/agent 两级生命周期 | `packages/agent/src/types.ts:485` | A1 A6 B7 B9 J1 L1 | 🟢 |
| R1-2 | `AgentTurnDecision` 显式停止条件（非隐式约定） | `packages/agent/src/types.ts:143` | A1 | 🟢 |
| R1-3 | `QueueMode="all"\|"one-at-a-time"` 控注入节奏 | `packages/agent/src/types.ts:55` | A2 | 🟢 |
| R1-4 | `ToolExecutionMode="sequential"\|"parallel"` 可配 | `packages/agent/src/types.ts:47` | B6 | 🟢 |
| R1-5 | `file-mutation-queue` 文件写串行化 | `packages/agent/src/harness/tools/` | B4 | 🟡 |
| R1-6 | 最小工具集划分 | 同上 | B3 | 🟡 |
| R1-7 | 工具经 `ToolContext` 拿沙箱，无裸进程 | `packages/agent/src/types.ts` | D4 | 🟡 |
| R1-8 | 事件源 `commit.ts`（`CommittedListAppendWrite`） | `packages/agent/src/harness/session/commit.ts` | E1 | 🟡 |
| R1-9 | `ForkCurrentStatePlan={branch\|tree}` 一套抽象两用 | `packages/agent/src/harness/session/fork-policy.ts` | E5 E6 | 🟢 |
| R1-10 | `packages/ai` 厂商适配独立包 | `packages/ai/` | F1 J2 | 🟡 |
| R1-11 | hooks 与 skills 是**内核概念** | `packages/agent/src/harness/{hooks,skills}.ts` | I1 I2 I6 | 🟡 |
| R1-12 | kernel/host/ui 彻底分离（11 workspace，构建序即依赖序） | `packages/*` | K1 K5 K8 | 🟡 |
| R1-13 | `protocol` + `client` + `server` 三层 | `packages/{protocol,client,server}` | K8 | 🟡 |
| R1-14 | **反面**：明确不自带沙箱，隔离责任推给用户 | `SECURITY.md` | D 层全部 | 🔴 只作论证 |

#### R2 · opencode（anomalyco/opencode）· MIT · 策略与工具首选参考

| # | 优点 | 证据路径 | 喂给 | 复用性 |
| --- | --- | --- | --- | --- |
| R2-1 | 18 个工具的分工（含 `apply_patch` `lsp` `code-mode`） | `packages/opencode/src/tool/` | B8 | 🟡 |
| R2-2 | **工具描述拆 `.txt`**，与代码分离 | `packages/opencode/src/tool/*.txt` | B2 G1 | 🟢 |
| R2-3 | `run-state.ts` / `status.ts` 运行态独立 | `packages/opencode/src/session/` | A3 | 🟢 |
| R2-4 | `overflow.ts` 与 `compaction.ts` **分开** | 同上 | A4 F3 F4 | 🟢 |
| R2-5 | `retry.ts` 独立重试 | 同上 | A5 | 🟡 |
| R2-6 | **`evaluate` 三点：`findLast` + 默认 `ask` + 双维度通配** | `packages/opencode/src/permission/index.ts` | C1 C2 C3 C4 | 🟢 |
| R2-7 | **`Deferred` + `pending: Map` + `ask`/`reply`/`list`** 审批跨端回转 | 同上 | C5 C6 L2 N2 | 🟢 |
| R2-8 | 新存储用 drizzle + SQL 表 | `packages/core/src/session/store.ts` | E2 | 🟡 |
| R2-9 | `event.ts` + `projector.ts` 事件与投影分离 | `packages/core/src/session/` | E3 N4 | 🟢 |
| R2-10 | `@opencode-ai/plugin` 的 `ToolDefinition`，插件可注册工具 | `packages/plugin/` | B1 | 🟡 |
| R2-11 | `session/revert.ts` 回退 | `packages/opencode/src/session/revert.ts` | E4 | 🟡 |
| R2-12 | `AGENTS.md` 项目指令 | 仓根 `AGENTS.md` | F2 | 🟢 |
| R2-13 | `plan.ts` + `plan-enter/exit.txt` 计划模式 | `packages/opencode/src/tool/plan.ts` | G1 | 🟢 |
| R2-14 | `todo.ts` 任务清单 | `packages/opencode/src/session/todo.ts` | G2 | 🟡 |
| R2-15 | 子代理即 `task` 工具 | `packages/opencode/src/tool/task.ts` | H1 H4 | 🟢 |
| R2-16 | MCP 集成（含 websearch） | `packages/opencode/src/tool/mcp-websearch.ts` | I3 | 🟡 |
| R2-17 | `packages/llm/` 厂商抽象 | `packages/llm/` | J4 | 🟡 |
| R2-18 | `packages/slack/` IM 适配器 | `packages/slack/` | K7 | 🟡 |
| R2-19 | `http-recorder` HTTP 级录制 | `packages/http-recorder/` | L5 | 🟡 |
| R2-20 | **反面**：会话存储正处 JSON→SQL 迁移中间态，两套并存 | `packages/opencode/src/storage/` vs `packages/core/src/session/store.ts` | E2（避坑） | 🔴 只作论证 |

#### R3 · deepseek-harness · MIT · 长任务首选参考

| # | 优点 | 证据路径 | 喂给 | 复用性 |
| --- | --- | --- | --- | --- |
| R3-1 | **goal 四件套**：`goal` / `goal-round-driver`(跨轮) / `command-goal` / `tool-goal` | `packages/goal/` | G3 G4 M5 | 🟡 |
| R3-2 | **"结算栅栏"**：子代理产出原子并入父会话 | `apps/cli/tests/.../subagent-settlement-fence.ts`；`.agents/notes/archived/architecture/2026-07-05-subagent-provider-lifecycle-events.md` | H2 H3 | 🟡 |
| R3-3 | **jobs 三件套**：`jobs` / `jobs-local` / `tool-jobs` | `packages/jobs/` | M1 M2 | 🟡 |
| R3-4 | `permission-presets` 权限预设成套切换 | `packages/interaction/permission-presets/` | C8 | 🟡 |
| R3-5 | `sandbox` + `sandbox-local` **可插后端** | `packages/sandbox/` | D5 | 🟡 |
| R3-6 | `packages/guard` 独立策略包 | `packages/guard/` | C 层 | 🟡 |
| R3-7 | `session-reference` 会话可被其他会话引用 | `packages/context/session-reference/` | E9 | 🟡 |
| R3-8 | `identity` 身份独立成包 | `packages/identity/` | N 层 | 🟡 |
| R3-9 | **`.agents/notes/archived/architecture/*.md` 架构决策记录归档** | 该目录 | 全部（设计理由一手材料） | 🟢 |
| R3-10 | 工具即包，可独立发布版本化 | `packages/goal/tool-goal/` 等 | B1 | 🟡 |
| R3-11 | 三入口共用同一 program（`runTui`/`runHeadless`/`runWeb`） | `packages/boot/app-boot/src/index.ts` | K1 K5 | 🟡 |
| R3-12 | **注意**：30+ 包粒度太细，直接搬会背上巨大依赖面 | `packages/` | 全局（避坑） | — |

#### R4 · codex（openai/codex）· Apache-2.0 · 沙箱首选参考

| # | 优点 | 证据路径 | 喂给 | 复用性 |
| --- | --- | --- | --- | --- |
| R4-1 | **Windows 双后端**：`WindowsSandboxLevel={Disabled(默认),RestrictedToken,Elevated}` | `codex-rs/protocol/src/config_types.rs:297` | D6 | 🟡 |
| R4-2 | **flush-before-snapshot 纪律**："持久化快照前必须 flush rollout" | `codex-rs/core/src/session/daemon_recovery.rs` | E10 M3 | 🟡 |
| R4-3 | **`dpapi.rs` 用 `CryptProtectData` 加密凭据** | `codex-rs/windows-sandbox-rs/src/dpapi.rs` | D8 | 🟢 |
| R4-4 | `cli/src/doctor/` 完整自检体系 | `codex-rs/cli/src/doctor/` | D7 | 🟡 |
| R4-5 | **网络策略独立**（`doctor/network.rs` 单列） | 同上 | D3 | 🟡 |
| R4-6 | `prompts/templates/permissions/sandbox_mode` 策略提示词模板 | `codex-rs/prompts/templates/` | D2 | 🟢 |
| R4-7 | `rollout-trace/` 轨迹 + reducer | `codex-rs/rollout-trace/` | L4 | 🟡 |
| R4-8 | **ACL 递归拒绝读 + 能力 SID**（65 个 `.rs` 的 Windows 实现） | `codex-rs/windows-sandbox-rs/src/{deny_read_acl,deny_read_walker,cap}.rs` | D1 D6 | 🟡 |
| R4-9 | `WindowsSandboxFilesystemOverrides` 策略形状 | `codex-rs/sandboxing/src/windows.rs` | D1 | 🟢 |
| R4-10 | `external-agent-migration/` 从其他 agent 导入会话 | `codex-rs/external-agent-migration/` | E8 | 🟡 |
| R4-11 | `debug_sandbox.rs` 沙箱可独立调试 | `codex-rs/cli/src/debug_sandbox.rs` | D7 | 🟡 |
| R4-12 | AppContainer 支持 | `codex-rs/windows-sandbox-rs/src/app_package.rs` | P2 才用 | 🟡 |

#### R5 · kimi-code（MoonshotAI/kimi-code）· MIT

| # | 优点 | 证据路径 | 喂给 | 复用性 |
| --- | --- | --- | --- | --- |
| R5-1 | **`packages/transcript` 会话记录独立成包** | `packages/transcript/` | E7 | 🟡 |
| R5-2 | **索引 / 导出 / 兼容三层分开** | `packages/agent-core-v2/src/app/{sessionIndex,sessionExport,sessionLegacy}` | E8 | 🟡 |
| R5-3 | `packages/oauth` OAuth 独立成包 | `packages/oauth/` | J8 | 🟡 |
| R5-4 | **权限拆四个概念**：`permissionGate`/`permissionMode`/`permissionPolicy`/`permissionRules` | `packages/agent-core-v2/src/agent/` | C 层命名 | 🟡 |
| R5-5 | `tree-sitter-bash` 结构化解析 shell | `packages/tree-sitter-bash/` | D2（命令分析） | 🟢 |
| R5-6 | `acp-server` + `remote-control` 独立成包 | `packages/{acp-server,remote-control}/` | K4 K3 | 🟡 |
| R5-7 | `apps/kimi-inspect` 外部检视会话 | `apps/kimi-inspect/src/transcript` | L4 | 🟡 |
| R5-8 | 复用 pi 的 TUI（`packages/pi-tui`） | `packages/pi-tui/` | 生态互操作证据 | — |
| R5-9 | **注意**：`migration-legacy` 兼容层是包袱，不要继承 | `packages/migration-legacy/` | E8（避坑） | — |

#### R6 · qwen-code（QwenLM/qwen-code）· Apache-2.0 · **只读文档**

| # | 优点 | 证据路径 | 喂给 | 复用性 |
| --- | --- | --- | --- | --- |
| R6-1 | `session-recap.md` 会话摘要设计 | `docs/design/` | F5 | 🟢 读文档 |
| R6-2 | `session-idle-reaper.md` 空闲回收设计 | 同上 | M4 | 🟢 读文档 |
| R6-3 | `session-crash-recovery.md` 崩溃恢复设计 | 同上 | M3 | 🟢 读文档 |
| R6-4 | `session-title.md` 标题生成设计 | 同上 | F5 | 🟢 读文档 |
| R6-5 | **反面**：ACP 集成几十个文件堆在 CLI 包内 | `packages/cli/src/acp-integration/` | K4（避坑） | 🔴 |

#### R7 · grok-build（xai-org/grok-build）· Apache-2.0

| # | 优点 | 证据路径 | 喂给 | 复用性 |
| --- | --- | --- | --- | --- |
| R7-1 | **`xai-acp-lib` 协议独立成 crate，仅 8 个文件** | `crates/codegen/xai-acp-lib/src/`（`channel`/`message`/`normalize`/`gateway`…） | K4 | 🟢 |
| R7-2 | crate 边界即架构边界（Rust workspace 强制） | `crates/` | 全局分层 | 🟡 |
| R7-3 | `xai-grok-compaction` 压缩独立成 crate | `crates/common/xai-grok-compaction/` | F3 | 🟡 |
| R7-4 | `xai-grok-pager` TUI 独立 | `crates/codegen/xai-grok-pager/` | K1 | 🟡 |

#### R8 · hermes-agent（NousResearch/hermes-agent）· MIT

| # | 优点 | 证据路径 | 喂给 | 复用性 |
| --- | --- | --- | --- | --- |
| R8-1 | **`acp_adapter/` 整目录做 ACP，职责四分**：`auth` / `commands` / `content` / `edit_approval` | `acp_adapter/` | K4 | 🟡 |
| R8-2 | `gateway/` 网关层 | `gateway/` | L6 | 🟡 |
| R8-3 | `session-import` 从别处导入会话 | `apps/desktop/src/app/session-import` | E8 | 🟡 |
| R8-4 | **注意**：模块平铺在 `agent/` 下未按关注点细分；审批绑在适配层导致多端各写一份 | `agent/`、`acp_adapter/edit_approval.py` | C 层（避坑） | — |

#### R9 · pi-desktop（vastsa/PI-Desktop）· **LGPL-3.0** · 只学行为

| # | 优点 | 证据路径 | 喂给 | 复用性 |
| --- | --- | --- | --- | --- |
| R9-1 | **远程 host 架构**：host 注册 + IPC 桥 | `electron/main/{agent-host-bridge,bootstrap/remote-hosts,ipc/remote-host-ipc}.ts` | K2 K3 | 🔴 |
| R9-2 | **进程外插件**：插件跑独立 websocket 进程 | `electron/main/plugin-websocket.ts` | I4 I6 | 🔴 |
| R9-3 | 工具与会话在 Rust host 侧（`crates/host-core`） | `crates/host-core/src/{tools,sessions,session_collaboration}` | D6 语言边界先例 | 🔴 |
| R9-4 | `packages/{plugin-sdk,plugin-devkit,racp}` 扩展分层 | `packages/` | I5 | 🔴 |

> **法律约束**：LGPL-3.0，**代码一行不可摘**（见 `THIRD_PARTY.md`）。上表全部只学行为。

#### R10 · pideck（ayuayue/PiDeck）· MIT

| # | 优点 | 证据路径 | 喂给 | 复用性 |
| --- | --- | --- | --- | --- |
| R10-1 | **`FeishuBridge.ts` 飞书 IM 桥**——IM 需求有现成参考 | `src/main/feishu/FeishuBridge.ts` | K6 | 🟢 |
| R10-2 | **多后端共存**：同时驱动 pi 与 DSH，证明内核可替换 | `src/main/pi/AgentManager.ts` + `src/main/dsh/dshRuntimeControl.ts` | 选型信心 | 🟡 |
| R10-3 | `resources/extensions/pi-deck-subagents.ts` 子代理扩展 | `resources/extensions/` | I5 H1 | 🟡 |
| R10-4 | `dsh-tool-pwsh-persistent` PowerShell 持久会话工具 | 该包 | B8（Windows 场景） | 🟡 |
| R10-5 | **教训**：多后端下默认值互相串味（pi 默认模型漏进 DSH footer）；两后端模型来自不同目录，共享 key 会互相解析 | `CHANGELOG.md` | J4 J5 | 🟡 |
| R10-6 | **教训**：切后端时 `applyModel` 的 no-record 分支直接 return 不落盘 | 同上 | J5 | 🟡 |

#### R11 · zcode（zai-org/ZCode）· Apache-2.0

| # | 优点 | 证据路径 | 喂给 | 复用性 |
| --- | --- | --- | --- | --- |
| R11-1 | **`contracts/` 契约层**：会话事件与遥测有类型化契约 | `apps/zcode-cli/packages/contracts/src/events/session.events.ts`、`contracts/src/telemetry/agent-execution.ts` | E1 L3 N4 | 🟢 |
| R11-2 | 代码生成的 bash 命令注册表 | `core/src/tool/handlers/generated/bash-command-registry.ts` | D2 | 🟡 |
| R11-3 | `.agents/skills/` 以目录形式分发 skills | `.agents/skills/` | I2 | 🟡 |
| R11-4 | **注意**：loop 与记忆抽取耦合在同一文件 | `core/src/memory/memory-agent-loop.ts` | A 层（避坑） | — |

#### R12 · cc-switch（farion1231/cc-switch）· MIT · J 层首选参考

| # | 优点 | 证据路径 | 喂给 | 复用性 |
| --- | --- | --- | --- | --- |
| R12-1 | **配置存不透明字符串 + 只校验语法**，不为 N 个异构厂商建模 | `src/lib/schemas/provider.ts` 的 `settingsConfig: z.string().superRefine(JSON.parse)` | J3 | 🟢 |
| R12-2 | **故障转移是队列**（`FailoverQueueItem`），按后端分区 | `src-tauri/src/database/dao/failover.rs` | J6 | 🟡 |
| R12-3 | 健康检查日志带**保留期清理** | `src-tauri/src/database/dao/stream_check.rs` | J7 L3 | 🟡 |
| R12-4 | `AppType` 枚举统一八个受管应用 | `src-tauri/src/app_config.rs:396` | J4 | 🟢 |
| R12-5 | 两层 provider：应用专属 vs 跨应用共享 | `dao/providers.rs` vs `dao/universal_providers.rs` | J3 | 🟡 |
| R12-6 | SQLite（`rusqlite`）做配置存储 + DAO 分层 | `src-tauri/src/database/` | E2 | 🟡 |
| R12-7 | **边界**：它是配置管理器，不是 provider 抽象层；`failover` 是"切换配置"非"运行时路由" | 全部 | J5（**需自研**） | — |

#### R14 · 运行时换模 —— **跨仓综合**（你指出其他仓有，实测确认）

> **修正**：早前 J5 写"cc-switch 无此能力，需自研"，**只查了 cc-switch 就下结论，是错的**。
> 实测 8 个仓**全部有**运行时换模实现。下表是综合后的设计，不是某一家。

| # | 综合要点 | 来源仓与证据路径 | 喂给 | 复用性 |
| --- | --- | --- | --- | --- |
| R14-1 | **`ModelIdentity = {provider, modelId}` 二元组**；`configuredModel`（lane 当前配置）与 `capturedModel`（在途操作启动时捕获）**分离** | pi `packages/agent/src/harness/agent-harness.ts:142,154,160`；`setModel()` 在 `agent-harness.ts:574` 与 `runtime/lane.ts:1653` | J4 J6 J7 | 🟢 |
| R14-2 | **换模是带回滚的事务**：`DeferredModelSwitch{model_id, effort, prev_model_id}`，`prev_model_id` 即失败回滚目标；另有 `model_switch_pending`/`user_model_preference`/`model_incompatible` | grok `crates/codegen/xai-grok-pager/src/app/agent.rs:647-655,746-749` | J8 J11 | 🟡 |
| R14-3 | **换模是事件**：`config_update` 且按作用域分 —— lane 级可切 `model`/`thinkingLevel`/`activeTools`，另有 global 级 | pi `agent-harness.ts:375-410` | J9 | 🟢 |
| R14-4 | **会话级选择与全局默认分开存**，且不一致时**显式报错**而非静默 | DSH `packages/api/session-controller/src/commands.ts` 的 `SessionSelectModelRequest/Value`、`selectModel()`、`agentDefaultModel.saveSelection()`、错误码 `session/model-unavailable` | J10 | 🟡 |
| R14-5 | **每会话持久化 + 恢复投影**：`SessionModelRecordPayload` / `SessionRestoreProjection`；**auth type 是模型记录的一部分** | qwen `packages/cli/src/acp-integration/session-model-persistence.ts` | J6 J10 | 🟡 |
| R14-6 | **选择器要工程化**：按 `provider:model` 去重、**每厂商上限 200**（客户端单下拉框渲染）、`custom:<name>` slug 保证 choice id 可回环、**discovery 失败时声明的模型仍存活**（有些端点无 `/models` 路由） | hermes `acp_adapter/model_catalog.py`（`ACP_MAX_MODELS_PER_PROVIDER`、`_named_custom_provider_catalogs`） | J12 | 🟢 |
| R14-7 | **刷新鉴权头不得改变模型身份** —— 有硬守卫 | zcode `packages/adapters/src/model/runner.ts:353`：`throw new Error("Runtime header refresh changed the bound model identity.")` | J13 | 🟡 |
| R14-8 | **历史回放会静默覆盖用户模型选择** —— grok 专门加了防护：`ReconnectState::user_selected_model` 抑制 replay 的静默回退 | grok `agent.rs:746` 注释 | J14 | 🟡 |
| R14-9 | **模型切换经 ACP 是标准能力**：`SessionModelState{available_models, current_model_id}`、`ModelInfo` | hermes `acp_adapter/model_catalog.py:238` 用 `from acp.schema import ModelInfo, SessionModelState`；grok 用 `acp::ModelId` | J6 K4 | 🟢 |
| R14-10 | **模型子系统值得独立成层**：50+ 文件覆盖重试/失败分类/限流/离峰重试/失败策略 | zcode `apps/zcode-cli/packages/adapters/src/model/`（`retry-budget.ts`、`failure-classifier.ts`、`offpeak-retry.ts`、`workflow-model-failure-policy.ts`） | J15 J16 | 🟡 |
| R14-11 | 换模命令 `provider-manager` 对话框；provider 与 model 同在 app state | kimi `apps/kimi-code/src/tui/commands/provider.ts` | J6 K1 | 🟡 |

**综合后的默认设计（三条最该抄的）**

1. **`{provider, modelId}` + configured/captured 分离**（R14-1）—— 这是**多端并发（Q6）与换模的交叉点**。
   没有 captured，运行中换模会污染在途 turn；有了它，换模对在途操作**无感**。
2. **换模是事件**（R14-3）—— 换模进事件流，天然满足 L2（可审计）与 L4（可回放），
   不需要为"记录换模历史"另做设计。
3. **会话级与全局默认分离且不一致要报错**（R14-4）—— 这正是 R10-5/R10-6 里 PiDeck 踩的坑
   （多后端默认值互相串味、分支不落盘），DSH 给出了正确解法。

#### R15 · 系统性补漏（第二轮全仓扫描所得）

> 第一轮按记忆挑维度，漏了下面这些。第二轮改为**先枚举关注点再全仓扫**，
> 并把 DSH 的包结构当作"关注点地图"，才找出来。**每条都标来源仓与证据路径。**

| # | 优点 | 来源与证据路径 | 喂给 | 复用性 |
| --- | --- | --- | --- | --- |
| R15-1 | **取消当前 turn；响应到达前取消可把 prompt 退回输入框** | grok `xai-grok-pager/src/app/agent.rs`（`do_cancel_turn`、`in_flight_prompt`）；pi 用 `AbortSignal` | A7 A8 | 🟡 |
| R15-2 | **输出截断参数与落盘指引**：上限 **50KB（约 10k token）或 2000 行，先到先算**；**截断时写临时文件并把路径告诉模型** | pi `coding-agent/examples/extensions/truncated-tool.ts` | B5 B10 B11 Q3 | 🟢 |
| R15-3 | **危险命令模式库**：`rm -rf`、`sudo`、`chmod/chown 777` | pi `examples/extensions/permission-gate.ts` | C10 | 🟢 |
| R15-4 | **项目信任**：`project_trust` 事件；未信任项目降权 | pi `examples/extensions/project-trust.ts` | C11 | 🟢 |
| R15-5 | **Windows ACL 沙箱（独立于 Codex 的另一实现）** | DSH `packages/sandbox/sandbox-windows-acl` | D10 | 🟡 |
| R15-6 | **PowerShell 作为一等 shell**，local/sandbox 两态分开 | DSH `packages/shell/{pwsh-local,pwsh-sandbox}`；ADR `2026-08-11-pwsh-persistent-pty` | D11 | 🟡 |
| R15-7 | **SSH 远程执行三层**：`fs-ssh` / `sandbox-ssh` / `subprocess-ssh` | DSH `packages/ssh` + `docs/subsystems/ssh.md` | D12 | 🟡 |
| R15-8 | **代码状态检查点**：每 turn 打 git stash，`/fork` 时可恢复代码到对应历史点 | pi `examples/extensions/git-checkpoint.ts` | **E11** | 🟢 |
| R15-9 | **当前时间提醒**注入 context | codex `core/src/context/current_time_reminder.rs` | F7 | 🟢 |
| R15-10 | **工具结果裁剪器**独立成模块（含专门目录） | opencode `tool/truncate.ts` + `tool/truncation-dir.ts`；kimi `agent/toolResultTruncation/` | F8 | 🟡 |
| R15-11 | **goal 截止时间调度器** | kimi `agent-core-v2/src/features/goal/goalDeadlineScheduler.ts` | G6 | 🟡 |
| R15-12 | **子代理权限降级算法**：只继承父会话的 **`deny` 与 `external_directory`** 规则，**不继承授权**；子代理默认禁用 `task`（不可再分子代理）与 `todowrite` | opencode `packages/opencode/src/agent/subagent-permissions.ts` 的 `deriveSubagentSessionPermission` | **H5** | 🟢 |
| R15-13 | **子代理执行后端可插**（五种：ACP / CC / Codex / DSH-SDK / 进程内 fork） | DSH `packages/subagent/subagent-*` | H6 | 🟡 |
| R15-14 | **hook 协议可兼容既有生态**（同时提供 CC 与 Codex 两套） | DSH `packages/hooks/{hook-protocol,hooks-claude-code,hooks-codex}` | I7 | 🟡 |
| R15-15 | **人格 / 预设模板**独立成目录 | codex `core/templates/personalities` + `Personality.ts`；hermes `hermes_cli/personality.py` | I8 | 🟢 |
| R15-16 | **工具调用超时策略**独立成包，超时是**可观测事件**（`TOOL_TIMEOUT`）非静默失败 | DSH `packages/guard/timeout-policy` + 两份 ADR | M6 M7 | 🟡 |
| R15-17 | **LLM 回放测试**（cassette 模式） | DSH `packages/test-support/llm-replay`；opencode `packages/http-recorder/src/cassette.ts` | O2 | 🟡 |
| R15-18 | **不变量检查服务**（包自己拥有不变量） | DSH ADR `package-owned-invariant-service`；grok `.../scroll_matrix/invariants.rs` | O3 | 🟡 |
| R15-19 | **附件**：类型化协议 + 存储抽象 | codex `.../ThreadAttachment.ts`；kimi `packages/transcript/src/model/attachment.ts` | P1 | 🟡 |
| R15-20 | **图片从上下文卸载且可回取** | DSH ADR `durable-image-offload`、`image-offload-events` | P2 | 🟡 |
| R15-21 | 语音转文字 | DSH `packages/experimental/api-speech-to-text` | P4 | 🟡 |
| R15-22 | **会话格式单向迁移链**：`v0→v1→v2→v3` 逐版本迁移，**而非两套格式并存** | DSH `packages/session/session-format*` + ADR `released-session-format-migrations` | **Q1** | 🟡 |
| R15-23 | **会话查询服务**（含工具化，agent 可查历史） | DSH `packages/session-query/{session-query,session-query-sqlite,tool-session-query}` | Q2 | 🟡 |
| R15-24 | **落盘文件的生命周期策略**（不是随手写临时文件） | DSH `packages/spill/*`；codex `hooks/src/output_spill.rs`；hermes `tools/spill_safety.py` | Q3 B10 | 🟡 |
| R15-25 | **限流追踪与配额** | hermes `agent/{rate_limit_credits,rate_limit_tracker}.py`；opencode `console/core/src/quota.ts` | J18 | 🟡 |
| R15-26 | **熔断器**（连续失败后熔断，避免重试风暴） | grok `crates/common/xai-circuit-breaker/src/retry_policy.rs` | J19 | 🟢 |
| R15-27 | **turn 准入控制**（并发 turn 有闸门） | codex `app-server/src/turn_admission.rs` | J20 | 🟡 |
| R15-28 | **成本核算** | hermes `agent/{aux_accounting,billing_usage,billing_links}.py`；opencode `console/core/src/{billing.ts,schema/billing.sql.ts}` | J21 | 🟡 |
| R15-29 | **附件限额**独立模块（类型/大小/数量上限） | pi-desktop `packages/shared/src/attachment-limits.ts` | P3 | 🔴 LGPL |
| R15-30 | **定时任务**（按星期等定义） | codex `.../ScheduledTaskWeekday.ts`；kimi `apps/vis/server/src/lib/cron-store.ts` | S1 | 🟡 |
| R15-31 | **webhook 触发会话**（fire-and-forget 型，如 GitHub 事件） | DSH `packages/webhook/{webhook,webhook-github}`；qwen `channels/base/src/ChannelWebhookTask.ts` | S2 | 🟡 |
| R15-32 | **浏览器使用独立成包** | qwen `packages/browser-use`（含 NOTICE）；codex `browser_use_config.rs` | S3 | 🟢 |
| R15-33 | **计算机使用** | codex `computer_use_config.rs`；hermes `computer-use-panel.tsx` | S4 | 🟡 |
| R15-34 | **反馈机制**（含 doctor 报告随反馈一起报） | codex `request_processors/{feedback_processor,feedback_doctor_report}.rs`；grok `xai-grok-feedback` crate | S5 | 🟡 |

#### R16 · 深度架构原理（第三轮：精读决策记录所得）

> 来源：`dsh/.agents/notes/`（**1177 篇**，含 14 篇 rejected）+ `pi-desktop/docs/adr/`（**321 篇**）。
> 详见 `docs/research/05-architecture-principles.md`。这些是别人用真实故障换来的结论。

| # | 优点 / 教训 | 来源与证据路径 | 喂给 | 复用性 |
| --- | --- | --- | --- | --- |
| R16-1 | **消息与 turn 不能一一对应**：`MessageId` 能证明入队，但**无法标识哪条 assistant 消息或 `turn/end` 是它的结果** —— steering/注入/续跑/恢复/后续排队都会贡献内容。故 `followup()` 仅入队，`whenIdle` 是整 agent 观察，SDK **无 `session.finished`** | DSH `implemented/architecture/2026-07-30-followup-enqueue-and-owned-runs.md` | **A9 N1** | 🟡 |
| R16-2 | **steering 带 `expectedTurnId` 准入**；保持当前配置与同一持久 turn；**已启动工具先跑完，下一次模型请求才消费输入** | pi-desktop `docs/adr/active-turn-steering.md`（参照 Codex turn/steer） | A10 A11 | 🟡 |
| R16-3 | **声明式输出契约**：每个工具声明强制的 canonical output，只返回该契约描述的值。**执行期类型值 ≠ 会话格式，需显式投影** —— 否则膨胀日志、把实现数据暴露给压缩与迁移 | DSH `implemented/architecture/2026-07-20-canonical-tool-output-contract.md` | **B12 E** | 🟡 |
| R16-4 | **重试预算 3 次而非 2 次**：第一次失败常暴露语法/范围/来源修正，**第二次可能仍是在应用那个修正**。第 3 次 `terminate`；可恢复错误码每码一次宽限；**计数器按 prompt×path 作用域**；成功即清空该路径历史 | pi-desktop `docs/adr/0207-three-mutation-recovery-failures.md` | B13 | 🟡 |
| R16-5 | **fs 观察策略应可丢弃**：解耦"工具做什么"/"新鲜度策略"/"已观察状态记录"。原做法做成 **in-path 强制**（不经 `fileContext` 就到不了 `ctx.fs`），导致不想要该策略的部署**无法简单丢弃**。策略含"编辑前必须先读"、"写入必须基于已读版本" | DSH `implemented/architecture/2026-06-26-file-context-as-event-gate.md` | C12 C13 | 🟡 |
| R16-6 | **持久化事件不含 stack / signal / error 对象 / 自由文本 / 后端私有细节**。终态只记粗粒度 `{kind:'aborted'}`，运行时信号才记谁请求；**不把 caller 身份复制进 replay**；加载时**拒绝**带 reason 的旧记录。另：**不可冻结 cancel cause**（undici 会赋 `stack`，冻结致 `fetch` 抛 `TypeError` 取代 abort reason） | DSH `implemented/architecture/2026-07-16-explicit-turn-cancellation.md` | C14 A7 | 🟡 |
| R16-7 | **Windows kill-on-close Job 作为进程管辖范围所有者**。论证：分离进程组/父进程遍历/PTY 扫描只覆盖"通过某一种进程关系仍可观察"的成员；子进程可 `setsid`/重挂父进程/活过父进程而脱离 —— **终止可见树后工作、端口、文件可能仍在活动**。不可靠兜底必须**显式告警** | DSH `implemented/architecture/2026-08-28-subprocess-native-containment.md` | **D13 D14** | 🟡 |
| R16-8 | 协作式取消：signal **必填 readonly**，注册表**不给默认 controller / never-abort 哨兵 / 便利路径**。两条论证：**把工具 promise 与取消赛跑不安全**（被放弃的工作在报告完成后仍在跑）；**单一 `ABORTED` 无法告诉消费者工具主体是否已产生副作用** | DSH `implemented/architecture/2026-07-19-cooperative-tool-cancellation.md` | D15 A7 | 🟡 |
| R16-9 | **整值事件规则**：状态事件必须携带变更后**完整状态**，绝非裸 delta。四理由：转换逻辑极简、值自描述、**按 seq 比较免疫乱序**、**丢一次更新会被下一次自愈** | DSH `proposed/architecture/2026-07-27-session-projection-and-command-log.md` | **E12 N** | 🟡 |
| R16-10 | **同步 append + write-behind + turn 末 flush 检查点**；热路径绝不阻塞 I/O；**原始流分片也入日志**（token 级回放保真），但**派生以组装后 `assistant/message` 为准**；replay/fork = 用已有日志 seed 新会话 | DSH `implemented/architecture/2026-06-11-event-sourced-sessions.md` | E13 E14 | 🟡 |
| R16-11 | **压缩必须在 loop 内的 turn 边界发生**。真实事故：**Bedrock 达 1,077,172 tokens，上限 1,000,000**，provider 在有任何恢复点前即拒绝。且明确划界：pi-agent-core 提供重建/估算/切点/摘要/保留尾部，**不定义** headroom 策略与长循环守卫 | pi-desktop `docs/adr/0030-turn-boundary-context-checkpoint-compaction.md` | **F9** | 🟡 |
| R16-12 | **压力信号不能只看成功调用**：provider 可能**在返回 usage 前**即因超上下文拒绝，有些成功调用**不返回 usage**。故需**可回放的调用后压力**；恢复路径**在压缩无法证明进展时必须保留 provider 原始错误** | DSH `implemented/architecture/2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md` | **F10** | 🟡 |
| R16-13 | 压缩三级兜底：**摘要重试与尺寸控制 → 回退近期窗口 → 分块摘要** | pi-desktop `docs/adr/{0049,0282,0302}-*.md` | F11 | 🟡 |
| R16-14 | **命令的调用与裁决也要持久化**。原设计里 `/goal`、`/plan` 等命令结果**只在 RPC 响应中**，刷新/换端/resume/fork 后"命令执行过"即丢失（域状态持久，命令裁决不持久） | DSH `proposed/architecture/2026-07-27-session-projection-and-command-log.md` | **L7** | 🟡 |
| R16-15 | **持久化权威必须分代**：host 监督**单飞且分代**，**过期的代不能发通知或接受写入**；计划批准**必须持久到能扛渲染层重载，但重启绝不重放旧 host 创建的工作**（execution epoch） | pi-desktop `docs/adr/{0041,0053}-*.md` | **M8** | 🟡 |
| R16-16 | **有界准入 + 有限队列**。真实故障链：无界起任务与进程 → `Resource temporarily unavailable` → 并发 host 重启 + 写已销毁管道 → **持久化错误掩盖了最初的资源故障**。配套：**超时子进程先回收再释放许可**、**已启动命令绝不自动重试**、消息追加走 **file-backed outbox**、**握手 await 排空后才宣告 ready**、追加**按 id 幂等**且冲突时重映射 `{sessionId}:{id}` | pi-desktop `docs/adr/0041-bounded-host-runtime-and-persistence-outbox.md` | **M9 D15 E** | 🟡 |
| R16-17 | **会话日志版本机制**：①**一个单调整数，不搞 major/minor**（"是否可自动升级是那一步的属性，由 upgrader 是否存在表达"）②**写入方决定 bump** ③判据是**旧运行时能否保持完整语义正确**，"能解析不报错"不是标准 ④只有结构性变更才算 ⑤**拿不准就 bump**（恒等 upgrader 几乎无成本，漏 bump 会静默损坏旧读取方）。真实 bug：**未知事件类型被原样透传 → 重建静默跳过 → 恢复出被掏空的会话且无诊断** | DSH `implemented/architecture/2026-08-10-session-log-version-mechanism.md` | **Q1** | 🟡 |
| R16-18 | **session fork 由 host 拥有为单次快照操作**：复制源会话完整 canonical transcript 到新会话并**重映射消息与 tool-call 标识**；可选 `throughMessageId`；**未知边界不创建子会话并返回 `NOT_FOUND`**；子继承 project/provider/model/mode/thinking/permission。另：**加新命令必须升协议版本**，否则旧 host 能通过握手、只在新命令被调用时才失败 | pi-desktop `docs/adr/0023-independent-conversation-session-fork.md` | E4 E5 K3 | 🟡 |

| R16-19 | **事件词汇表的扩展机制必须 P0 定死**：封闭联合 → 运行时校验可能但插件加不了类型；可合并 map → 相反。**DSH 专门留了一篇 rejected 记录说明为何无法事后 Zodic 化**（影响 6 个 map/~10 处 declare module/16 个 append 点/~7 个 switch 消费者） | DSH `rejected/architecture/2026-06-16-typed-event-schemas.md` | **Q9 C15 C16 C17** | 🟡 |

#### R13 · 补充仓（**尚未细读，不作优点断言**）

| 仓 | 已知事实 | 状态 |
| --- | --- | --- |
| `modelscope/agentscope` | Python，存在 `src/agentscope/permission` | 已克隆未细读 |
| `MiniMax-AI/Mini-Agent` | 16M，最小实现，可作 P0 规模对照 | 已克隆未细读 |
| `SWE-agent/mini-swe-agent` | 2.9M，极简 agent loop | 已克隆未细读 |
| `lue-labs/pi-mono` | 与 pi 同作者（Mario Zechner） | 已克隆未细读 |
| `anthropics/claude-code` | **专有许可，只读公开行为**；`plugins/`、`examples/` 的 hook/plugin 形态可看 | 受许可约束 |

> 上表仅为"已克隆"的事实。**这四个仓未细读，因此不列优点** —— 避免凭印象断言。

---

---

## 3. 排除清单与未细读的仓

### 3.1 排除清单（**不得作为任何设计依据**）

| 对象 | 原因 |
| --- | --- |
| `D:\下载\claude-code-source-mirror-main.zip`（10.2 MB，第三方 Claude Code 源码镜像） | 属"泄露源码 / sourcemap / 镜像仓 / 网盘包"类别。按本项目硬性法律边界（`docs/review-prompt.md` §2）**拒绝纳入工作区**：未读、未解压、未引用。**它因此也不能作为任何设计决定的依据或交叉验证来源。** |
| 任何 README 自述"来自 leaked Claude Code"的仓 | 同上。**已扫描确认本工作区无此类仓**（含裸词 `leaked` 的正则命中十余处全是误报，如 `leaked loop variables`）。 |

**合法最大值**是 `refs/claude-official/mods/` —— 官方随插件发布的引擎**类型声明**。
已读并记于 `docs/research/06-claude-code-official.md`；本文件中对它的引用**一律标 🔴**。

### 3.2 已克隆但未细读的仓（**不作优点断言**）

| 仓 | 已知事实 | 判定 |
| --- | --- | --- |
| `agentscope` | Python 多智能体编排，有 `src/agentscope/permission` | 只用到 C32/C33（五档模式 / `DONT_ASK`）；**其余不读** |
| `mini-agent` | 16M，最小实现 | 可作 P0 规模对照；**不作优点来源** |
| `mini-swe-agent` | 2.9M，极简 agent loop（190 行） | 已用于 L0 校准（`docs/research/08-kernel-deep-read.md`）；**其余不读** |
| `pi-mono` | 与 pi 同作者 | 已用于 F6/F13–F16（提示缓存）；**其余不读** |

### 3.3 读了但覆盖很浅的区域（诚实声明）

| 仓 | 未读的量 |
| --- | --- |
| `codex` | 140 个 crate 里打开过不超过 18 个；`compact.rs` 6,577 行读了约 120 行；`session/tests.rs` 12,880 行读了约 90 行；其余 188 个 suite 文件未读 |
| `zcode` | `methods/` 25,587 行读了不到 300 行；`dynamic-workflow-run-*`（30+ 文件）从未打开；全仓仅 4 个测试文件 |
| `kimi-code` | `loopService.ts` 2,285 行主体未读；`#human/xstate2` 自研状态图引擎未读；`harness/agent.ts`(2,909) 未读 |
| `deepseek-harness` | `core/agent-loop`、`core/tools`、`core/session`、`llm/`、`context/`、`client/` 全部未读；测试 7 包 22,817 行**一行实现未读** |
| `pi-desktop` | `rpc/mod.rs`(8,810，全仓最大)、`sessions.rs`(6,779)、`tools/mod.rs`(4,435) 未读；`config_sync/` 13 个文件只读了 `engine.rs` 的 import 区 |
| `qwen-code` | **1,803 篇文档**，只读了权限与 shell 语义相关部分 |

**这些空白按你的工作方式处理**：不预读，**做到对应功能项时再点开 §2 的链接**。

---

## 4. 与调研文档的对应关系

本文件给的是"点开哪里"，**"为什么"在 `docs/research/`**。索引见 `docs/research/README.md`。

| 你要做的层 | 对应的调研文档 |
| --- | --- |
| A Loop / G Planning | `05-architecture-principles.md` §2 §7 · `10-zcode.md` · `13-kimi-code.md` |
| B Tools / D Sandbox | `11-codex.md` · `14-dsh.md` · `08-kernel-deep-read.md` |
| C Policy | **`07-permission.md`**（三轮合并，本层最厚）· `11-codex.md` §2–§5 |
| E Session / F Context | `11-codex.md`（压缩与持久化）· `14-dsh.md` · `05-architecture-principles.md` §1 §3 §6 |
| J Models | `05-architecture-principles.md` · requirements R14 段 |
| M 长任务 / Q 运维 | `15-pi-desktop.md` · `11-codex.md` |
| N 多端 | `10-zcode.md` · `06-claude-code-official.md` |
| O 测试 | **`20-testing.md`**（三轮合并） |
| 跨层决策理由 | `05-architecture-principles.md`（**决策记录精读所得，密度最高**） |
| 轮次原始记录 | `30-round-log.md` |
