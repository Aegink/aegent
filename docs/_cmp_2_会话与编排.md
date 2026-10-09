# 功能对照·第 2 组：会话与编排

> 锚点口径：参考仓相对 `F:\aegent`（如 `oss/pi/...`）；我方用**现路径**（`src/core/` 尚未落地，逐功能给出重构后落点映射）。
> 快照：`oss/SOURCES.lock`（2026-10-09）。本报告只做对照，未改动 `oss/` 与 `src/` 任何文件。
> 判定框架：**0 骨架**（进程/事件/协议）｜**一 原语**（循环 + 会话投影 + 工具契约 + 进程模型）｜**二 派生原语**（工具/子代理/编排/渠道）｜**三 万物**（插件）。
> 行序固定：pi → pi-desktop → dsh → zcode → hermes → agentscope → 我方。标 `【未验证】` 者为按目录/文件名判定、未逐行核实。

---

## 1. 会话模型与存储

**我们的重构后内核**：会话 = 会话 id + 事件流（无"会话类型"概念）。存储实现留在 `src/session/` 域（SQLite 事件源、`user_version` 单调整数迁移链 v0→v9、store 投影、fork-tree）；**投影原语**（`project.ts`/`messages.ts`/`reference.ts`/`coalescer.ts`）下沉到 `src/core/primitives/session/`，因为"事件→模型历史"是循环直接消费的唯一转换点。`src/core/contracts/session.ts` 只留 `SessionStore` 接口，session 域反向实现它。

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 |
|---|---|---|---|
| **pi** | 通用持久内核三件套：`conversation`（entry 序列 + 内建 document：pi.agent/inbox/live/generation/usage/provider/tool）+ `task`（持久状态机）+ `submission`（入队/去重/幂等）；**全程不出现 agent/LLM 词汇**；conversation 有 ownership（session/task）与 parent/head 指针 | 内核包 `packages/durable`（独立包，Storage 后端可换 jsonl/memory/sqlite） | `oss/pi/packages/durable/src/types.ts:55-60`（ownership）、`:286-360`（Conversation/Entry）、`:1015-1107`（Storage 接口）；`storage/jsonl/storage.ts:28`（FORMAT_VERSION=1） |
| **pi-desktop** | host-core（Rust）拥有 durable session；`sessionId` 是唯一身份，消息 id 只作投递与幂等键；会话列表 + 项目归属；会话通信账本（messageId → source/target sessionId，绑定真实 turn） | host-core（Rust）持久化 + 共享投影类型在 `packages/shared` | `oss/pi-desktop/docs/adr/0239-...md`（host owns ledger）；`packages/shared/src/session-collaboration.ts:1-30`（SessionMessageOrigin/status 闭集） |
| **dsh** | `Session` = 事件溯源 append-only log（内存实例）+ 子会话树；持久化是可选插件，jsonl 后端 = "每会话不可变 canonical generation 文件名 + 独占后继发布"（可 zstd）；恢复=纯相邻格式链 | 服务在 `packages/session/`（`ctx.sessionPersistence`）；后端独立包 | `oss/deepseek-harness/packages/session/README.md`（Persistence 表）、`session/session-persistence/README.md:20-30`、`session/session-persistence-jsonl/README.md:10-20` |
| **zcode** | 会话 = task，有 **7 类闭集** `SESSION_TASK_TYPES`（interactive/fork/selection_side_chat/workflow_parent/workflow_child/subagent_child/nested_workflow_child）+ 索引 SQLite；CLI 侧事件源 sqlite + services 侧 task 索引 DB，各有独立 migration | 执行层 core + adapters（存储）；类型在 contracts 包 | `oss/zcode/apps/zcode-cli/packages/contracts/src/interfaces/session-store.port.ts:34-43`（7 类闭集）、`adapters/src/storage/session-store/migrations.ts:11`（SQLITE_MIGRATIONS）、`migration-runner.ts:49/162`（schema_migration + checksum） |
| **hermes** | session 行（`sessions` 表）+ `parent_session_id` 血统 + 三种创建标记（`_delegate_from`/`_branched_from`/`_reset_from`）；单一大 SQLite（SessionDB，100+ `hermes_state_*.py` mixin）+ FTS5（CJK trigram） | 核心状态层（`hermes_state_*.py`），非插件 | `oss/hermes-agent/hermes_state_common.py:283`（SCHEMA_VERSION=31）、`:306`（FTS_STORAGE_VERSION=3）、`:382`（CREATE TABLE sessions）、`:398`（parent_session_id）、`:229`（三标记）；`hermes_state_schema.py:990` |
| **agentscope** | `AgentState`（pydantic，含 `session_id`）+ app 层 workspace/session（hub/channel）；状态是**可序列化快照**；app 层 storage（redis / sql） | 库级 state + app 层服务（`app/_service`、`app/storage`） | `oss/agentscope/src/agentscope/state/_state.py:209`（AgentState）、`:212`（session_id）、`:228`（_migrate_legacy_reply_fields）；`app/_service/_session.py:61/98`（SessionStatus/SessionService） |
| **我方** | 会话 = 会话 id + 事件流（**无会话类型**）；SQLite 事件源，`events(session_id,seq,type,payload,ts)` PK=(session_id,seq)，payload 存整事件 JSON；内存序 + write-behind buffer；`user_version` 单调整数，相邻迁移注册表 v0→v9，**库比代码新 → 拒开（fail-closed）** | 存储实现 `src/session/`（域）；投影原语重构后 `src/core/primitives/session/` | `src/session/schema.sql:7-23`；`src/session/db.ts:75-95`（user_version 拒开）、`:112`（createSession）；`src/session/migrate.ts:177`（MIGRATIONS）；`src/session/project.ts:149`（KNOWN_TYPES） |

**差异 / 我方优势 / 我方差距**

- **优势（不要动）**：我方迁移链的 fail-closed 纪律对齐 dsh（相邻链 + 库新拒开），且**会话类型虽无闭集，但用 fork 事件 + 子会话 id 约定 + `session_origins` 表分散表达**（`src/session/db.ts:254`（setSessionOrigin）、`src/session/migrate.ts:177`（MIGRATIONS 数组））；zcode 的 7 类闭集是唯一"会话种类"统一枚举，我方缺（属 P3 可选补强，见路C §9 C-8）。
- **差距**：我方迁移函数与代码同仓演进、**未冻结旧版本**（真实回填示例：v1→v2 从既有 sessions/events 聚合，`src/session/migrate.ts:180-198`）；dsh 是"每级冻结包 + catalog"（`oss/deepseek-harness/packages/session/session-format-v0-to-v1/...`），pi 是"文档级 version 冷载不迁移数据"（`oss/pi/packages/durable/src/session/session.ts:503-528`）。
- **差距**：会话库承载 5 张运维表（`audit_log`/`task_runs`/`cron_tasks`/`titles`/`projects`，`src/session/migrate.ts:83-175`），域混杂；hermes 用单一大库但以 mixin 分文件，dsh 把持久化/投影/标题/遥测拆成独立包。
- **优势**：hermes 的 SCHEMA_VERSION=31 靠"列对账 ADD COLUMN + 数据迁移 + FTS 存储版本"三件套（`hermes_state_schema.py:1017-1111`）；我方 9 级链更轻但机制等价（头注释直接引 dsh `session-format/src/chain.ts`）。
- **重构落点**：存储留域、投影进核，与 dsh "持久化是插件、投影是独立包"的分层一致，但**我方把投影收进核**（`src/core/primitives/session/`）——理由是循环直接消费 wire 形状，避免每插件重做一遍。

---

## 2. 事件存储与投影（append/flush/restore/snapshot/fork/lineage）

**我们的重构后内核**：`project.ts`（事件→模型历史投影）、`messages.ts`（`buildChatMessages`/`effectiveEvents`）、`coalescer.ts`（投影前置合并）、`reference.ts` 进 `src/core/primitives/session/`；存储原语（append/flush/restore/snapshot/fork）仍在 `src/session/store.ts` 与 `fork-tree.ts`。append 同步入内存序、持久化 write-behind、快照前必 flush、崩溃恢复三级降级——这些是"一 原语"的会话侧最小面。

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 |
|---|---|---|---|
| **pi** | `appendEntry`（不可变记录，commit 标记批量原子）；`commit()` 先 flush sidecar 再 append main marker；`snapshot`/`snapshotAsOf`（按文档 version 物化，旧版冷载）；`forkConversation(parent, at, ownership)` 在某个可见 entry 处做 fork-aware 历史复制 | 内核包 `durable`（Storage 接口 + jsonl/sqlite 实现） | `oss/pi/packages/durable/src/types.ts:791`（forkConversation）、`:797`（appendEntry）、`:931/992`（snapshot/snapshotAsOf）；`session/forks.ts:26`（prepareForkDocumentCopies）；`storage/jsonl/storage.ts:277`（commit）、`:300`（main marker）、`:507`（reclaimSidecars） |
| **pi-desktop** | host-owned durable transcript；账本按 messageId 记源/目标 sessionId、绑定真实 turn、状态机（queued/running/completed/failed/cancelled/interrupted）；additive migration（ADR 0239 明示既有会话/插件数据不动） | host-core（账本持久、不可伪造）；投影类型在 shared | `oss/pi-desktop/packages/shared/src/session-collaboration.ts:2-3`（kind/status 闭集）、`:19-38`（permissionCeiling 快照注释） |
| **dsh** | `sessionPersistence` seam 六方法：create/open/inspect/list/append/read/flush/close；**完成的 flush 即 durability barrier**；单会话单写者；torn-tail 崩溃恢复；不可变 generation 文件名 + 独占后继发布 | 服务契约在 `session-persistence` 包；jsonl 是 shipped 后端 | `oss/deepseek-harness/packages/session/session-persistence/src/index.ts:152/167/180`（create/open/flush）；`handle.ts:83/97/109/116`（read/append/flush/close）；`session-persistence/README.md:20-30` |
| **zcode** | 事件源 sqlite（CLI store）+ 索引 DB 各自 migration；迁移有 **checksum 记账**（`schema_migration` 表）；fork 不是独立原语，而是会话类型列值（`SESSION_TASK_TYPES` 含 fork） | adapters 存储层（core 消费） | `oss/zcode/.../adapters/src/storage/session-store/migration-runner.ts:49/162`（runSqliteSessionMigrations / schema_migration 表）、`migrations.ts:11`；`session-store.port.ts:34-43` |
| **hermes** | 单 SQLite 上做 FTS5（CJK trigram）+ rewind（会话回退）+ legacy 表 RENAME 保留；`display_kind` 等列 + JSON 列承载消息 | 核心状态层 | `oss/hermes-agent/hermes_state_rewind.py`（存在）、`hermes_state_search.py`（存在）、`hermes_state_schema.py:1017-1111`（列对账/迁移/FTS 版本推进） |
| **agentscope** | **无事件日志**：状态=可序列化快照；app 层 storage（redis/sql）持久化；迁移=字段级 pydantic validator | 库级 state + app storage | `oss/agentscope/src/agentscope/state/_state.py:209-228`；`app/storage/_base.py`、`_redis_storage.py`、`_sql/` |
| **我方** | append 同步入内存序（热路径不 await I/O）；flush 按会话 promise 链串行 + `seq 必须前进`校验；snapshot 内部先 flush；崩溃恢复三级（strict/lenient/discard）；fork = 切点 copy + lineage 事件 + fail-closed 五错误码；fork-tree 只读谱系不建第二套 | 存储原语 `src/session/store.ts`；投影原语重构后 `src/core/primitives/session/` | `src/session/store.ts:5-25`（append/write-behind 头注）、`:77-105`（append）、`:139-160`（flush 串行 + seq 检查）、`:163-177`（turn 末 flush 检查点）、`:183-191`（快照前 flush）、`:204-238`（三级恢复）、`:256-321`（fork）；`src/session/fork-tree.ts:38-77`；`src/session/coalescer.ts:20-64` |

**差异 / 我方优势 / 我方差距**

- **优势（我方最显式）**：flush 语义比参考仓更硬——**每会话 flush 串行 + seq 必须前进断言**（`src/session/store.ts:139-160`），dsh 只承诺"完成的 flush 是 durability barrier"（`session-persistence/README.md`），未在 API 层做 seq 前进断言。
- **优势**：崩溃恢复三级降级（strict/lenient/discard，`store.ts:204-238`）在参考仓中只有 hermes 级复杂度可比；dsh 靠"torn-tail 恢复"（`session-persistence-jsonl/README.md`），粒度更粗。
- **差距**：**版本化层级**——我方是库级 `user_version`（`src/session/db.ts:81`），事件本身无版本字段；pi 是**文档级 version**（`types.ts:55-60` + `session.ts:503-528` 版本不匹配冷载），dsh 是格式级冻结链。后果：插件无法注册自己的事件类型/文档类型，只能塞 `plugin.payload`。
- **差异**：fork 的形态——pi 是通用 `forkConversation(parent, at, ownership)`（`types.ts:791`），zcode 是会话类型列值（`session-store.port.ts:34-43`），我方是"切点 copy + lineage 事件 + 五错误码"的专用原语（`store.ts:256-321`），接近 pi 但不含"任意 entry 处 fork"的通用性。
- **重构落点**：投影进核后，`src/core/primitives/session/` 成为唯一"事件→wire"转换点；存储仍留域（`src/session/`），符合 dsh 的"持久化是插件"分层。

---

## 3. 子代理

**我们的重构后内核**：子代理**引擎**外置到 `src/ext-builtin/subagent-engine/`（`subagent.ts` + `jobs.ts`，默认内置可裁剪）；子代理**工具**（`task`/`task-lifecycle`/`task-output`）在 `plugins/tools-builtin/`。内核只留"能创建子会话 + 能投递 prompt + 能观察 turn 终态 + 子会话注册/发现"四原语（EP-1~EP-4 落在 `src/runtime/registrations/`）。子会话仍落同一 store（id 约定 `${parent}::task-N-ts`）。

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 |
|---|---|---|---|
| **pi** | `subagent` 工具是**扩展/插件**（`defineTool`）；子 conversation ownership=task；**结构性不可递归**（子会话 `extensions.remove:[Subagent]`）；后台 task 用 `report` phase 把报告作为新消息 submit 回主会话 | 插件（extension）；内核只给 conversation/task/submission 原语 | `oss/pi/packages/coding-agent/src/experimental/durable/subagent.ts:25-40`；`experimental/vacation/vacation.ts:60-118`（Research task + 报告回投）；`durable/src/types.ts:57`（ownership） |
| **pi-desktop** | `Task` 工具在核心工具集；后台委托并发上限 10（ADR 0089）；**ADR 0279 加 opt-in `resume` 参数**（链 = delegateSessionId，播种上次 delegation 重建的上下文）；TaskWait 收敛（mode:any + minCompleted） | Task 家族在 core 工具集；**编排类 SessionTask 在官方市场插件**（ADR 0237） | `oss/pi-desktop/docs/adr/0279-...md:1-40`（resume 动机 + 决策）；`adr/0089-...md`（后台委托）；`adr/0237-...md:35-70`（SessionTask 插件 + 每父 4 / 全插件 16 上限） |
| **dsh** | `ctx.subagents` 服务契约在核内 + **6 个 provider 包**（spawn/fork/acp/codex/claude-code/dsh-sdk）；**continuable** 子会话保留 durable session 供后续消息；`send_message`/`interrupt_agent`/`list_agents` 在独立控制插件；子结算通知父 | 服务契约在 `subagent` 包；provider 与工具在独立包（可裁） | `oss/deepseek-harness/packages/subagent/README.md:10-30`、`subagent/subagent/README.md:10-25`、`subagent/subagent/src/continuation-messages.ts:56-106`（相邻 Agent 消息的 durable 归因）、`subagent/tool-subagent-control/README.md:10-20` |
| **zcode** | `Agent` 工具（别名 `Task`）；`SendMessage` → `subagentPort.sendMessage`（运行中投递/入队；终态后台**重启续跑**）；`runner.ts` 有 `resumeFromStore` 与 `resumeTerminalAgentInBackground`（`resumed:true`）；`TaskOutput` 有 claim 语义 | 执行层 core（tools + subagent runner） | `oss/zcode/.../core/src/tool/handlers/agent.ts:227`（name:"Agent"）、`:302-344`（Task 别名）；`send-message.ts:48-69`；`core/src/subagent/runner.ts:85`（resumeFromStore）、`:955`（resumeTerminalAgentInBackground）、`:866/883`（resumed:true）；`handlers/task-output.ts:60`（claim 注释） |
| **hermes** | `delegate` 工具：派生子 AIAgent（fresh conversation、独立 task_id、父 toolsets 减子禁用集、聚焦系统提示）；单任务 + 批量并行；`steer_subagent`/`interrupt_subagent`/`list_active_subagents`；git worktree 隔离；`max_spawn_depth` 配置 | 工具层（`tools/delegate_tool*.py` 9 文件），非内核 | `oss/hermes-agent/tools/delegate_tool.py:1-11`（架构头注）；`tools/delegate_tool_registry.py:92`（interrupt）、`:124`（steer）、`:173`（list） |
| **agentscope** | **无通用子代理**；`TeamPipeline` 用 `_TeamAssign` 工具（member 名 enum + prompt）把任务派给具名成员，成员之间不互谈；`GoalPipeline` = executor + verifier 循环 | 库级 Pipeline（`pipeline/`），非内核 | `oss/agentscope/src/agentscope/pipeline/_team_pipeline.py:37-110`（TeamMember/_TeamAssign/TeamPipeline）、`:284-339`；`_goal_pipeline.py:22-93` |
| **我方** | `task` 工具（description/prompt/backend/subagent_type/run_in_background）；子会话 `${parent}::task-N-ts` 落同 store；深度入口拒绝 + 子规则集 deny 双保险；后台注册表 + 并发上限 10 + 报告截断 12k（直接对齐 pi-desktop 常量）；`onSettle` 注入父队列；`task_wait/list/stop/output`；写隔离 `.aegent/isolated/<childId>/`；`SubagentBackend` 接口 + 注册表（in-process + acp 实落） | 引擎重构后 `src/ext-builtin/subagent-engine/`；工具 `plugins/tools-builtin/`；原语 EP-4 在 `src/runtime/registrations/` | `src/kernel/subagent.ts:223-240`（上限 10 + 报告 12k + 注册表 Map）、`:373-374`（子会话 id）、`:385-416`（隔离 + 权限收窄）、`:513-559`（后台结算 + flush）；`task.ts:60`；`task-lifecycle.ts:58/114/133`；`task-output.ts:78`；`src/session/subagent-backend.ts:39-125/180` |

**差异 / 我方优势 / 我方差距**

- **差距（P1）**：**无 resume、无 send_message**。参考仓全部具备——pi-desktop ADR 0279 opt-in `resume`（`adr/0279:1-40`）、dsh continuable + `send_message`（`tool-subagent-control/README.md:10-20`）、zcode `resumeTerminalAgentInBackground`（`runner.ts:955`）、hermes `steer_subagent`（`delegate_tool_registry.py:124`）。我方每次冷启动，重复委派重复付费。
- **差距（P2）**：**可发现性弱**——我方仅进程内 `delegations` Map 按 delegationId（`subagent.ts:240`），不可跨进程/重启；dsh `list_agents` 按 durable id + label 递归列子，pi conversationId 持久可寻址（`durable/src/types.ts:777` scanEntries）。
- **优势**：深度双保险（入口类型化拒绝 + 子规则集 deny，`subagent.ts:309-312`/`task.ts:131-138`）比 dsh 的 maxDepth 默认 1 更显式；写隔离 `.aegent/isolated/` 比 dsh "继承 cwd" 严、比 hermes worktree 松（可记档）。
- **优势**：`SubagentBackend` 接口 + 注册表（`subagent-backend.ts:39-125`）与 dsh 的 provider 注册表同构，且接口已对齐 dsh `subagent-*` 行为（文件头注 `:14`）；实落 2/5（YAGNI 可接受）。
- **差异**：完成回投——我方 `onSettle` 注入父队列 + task_wait（`subagent.ts:583-607`）与 pi 的 `report` phase submit 回主会话（`vacation.ts:94-97`）语义等价；pi-desktop 走 TaskWait 收敛。三家一致。

---

## 4. 多会话编排

**我们的重构后内核**：**账本**（`session/collab` 双流四向事件 + 状态机）、**权限上限快照**（dispatch 时固化 `permissionCeiling`，双向不变）、**环检测**（活动派发图必须 DAG）留在 `src/session/collaboration.ts`；**原语**（`sessionCreate`/`sessionOpen`/会话投递/跨会话只读投影，EP-1~EP-3）落在 `src/runtime/registrations/session.ts`。**编排工具尚未有**（W2 属重构后独立批次）——这正是参考仓一致判定"应外置成插件"的那一层。

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 |
|---|---|---|---|
| **pi** | 模型**能**发起（但只在扩展层）：`subagent`（前台）、`research`（后台 + 报告回投）；内核只给 conversation/task/submission 原语，无编排逻辑 | **扩展/插件**；内核零编排 | `oss/pi/packages/coding-agent/src/experimental/durable/subagent.ts:26`；`experimental/vacation/vacation.ts:83-142` |
| **pi-desktop** | 模型**能**（**官方市场插件** `pi.session-orchestrator`）：`SessionTask` 工具（spawn/send/supervise/status/wait/result/accept/cancel/list）；host-core 只加两原语 `session/create`（含 `inheritPermissionFromSessionId`）+ `session/open`；host 拥有账本、认证发送方 sessionId、权限 host-owned、每父 4 / 全插件 16 上限 | **编排在普通市场插件**；原语 + 账本在 host-core | `oss/pi-desktop/docs/adr/0237-...md:35-70`（Decision + 两原语 + 上限）；`adr/0239-...md`（host owns ledger / sender authenticated / ceiling host-owned）；`crates/host-core/src/rpc/mod.rs:711`（inheritPermissionFromSessionId）；`packages/shared/src/session-collaboration.ts:19-38` |
| **dsh** | 模型**能（两种）**：① `subagent` + `send_message`/`interrupt_agent`/`list_agents`（独立插件）；② `workflow`——模型写 JS 脚本 fan-out（`agent()/parallel()/pipeline()/phase()/log()`），跑在 PTC 沙箱子进程 | `ctx.subagents` 契约在核内，工具与 provider 在独立包；`ctx.workflowEngine` + tool-workflow 插件 | `oss/deepseek-harness/packages/subagent/README.md:10-30`、`subagent/tool-subagent-control/README.md`；`workflow/README.md:10-25`（`ctx.workflowEngine` + workflow-ptc + tool-workflow） |
| **zcode** | 模型**能**：`Agent`（别名 `Task`）、`SendMessage`、`TaskOutput`/`TaskStop`、`ReadSessionContext`、`RespondToCoordinator`、`CreateWorkflow`；执行层 core（tools + subagent runner + workflow runtime 子进程） | 执行层 core（工具 + runner + workflow runtime） | `oss/zcode/.../core/src/tool/handlers/agent.ts:227`、`send-message.ts:48`、`read-session-context.ts:146`、`respond-to-coordinator.ts:52`、`task-output.ts:82` |
| **hermes** | 模型**能**：`delegate`（单任务/批量并行）+ `steer`/`interrupt`/`list` 控制动作 | 工具层（`tools/delegate_tool*.py`） | `oss/hermes-agent/tools/delegate_tool.py:1-11`；`tools/delegate_tool_registry.py` |
| **agentscope** | 模型**能**：`_TeamAssign`（leader 把任务指派给具名 member，可并行分组） | **库级 Pipeline**（`TeamPipeline`/`GoalPipeline`） | `oss/agentscope/src/agentscope/pipeline/_team_pipeline.py:51-110`；`_goal_pipeline.py:55` |
| **我方** | 模型**不能**：唯一入口是 settings op `collab-dispatch`/`collab-cancel`（UI 按钮触发）。但**引擎齐备**：账本双流四向事件 + 状态机、权限上限快照（双向不变）、环检测（DAG）、`createNew` 建真实新会话（落库+项目继承+血统+标题）、executor 跨会话投递 + 等 turn/end 结算 + 超时 | 账本/原语/权限快照/环检测在 `src/session/` + `src/host/`；**编排工具缺**（W2 重构后批次） | `src/session/collaboration.ts:8-16`（账本 + 权限快照语义）、`:146-221`（dispatch）、`:122-144`（环检测）、`:339-378`（事件投影）；`src/host/collab-runtime.ts:32`（permissionModeToCeiling）、`:65/161-168`（createNew + 快照）、`:94-106`（监听先于投递）；入口 `src/host/protocol-settings.ts:109-110`、`src/host/settings-call-domains.ts:372-384`、`ui/views/work.js:330-343` |

**差异 / 我方优势 / 我方差距**

- **差距（P0，唯一）**：**"有引擎无方向盘"**——参考仓全部把编排接到模型手上（zcode `Agent`/`SendMessage`、dsh `workflow`、pi-desktop `SessionTask`、agentscope `_TeamAssign`），我方只有 UI settings op。这是"缺口径"而非"缺引擎"：`collab-runtime.dispatch` + `createNew` + 回投全在（`collab-runtime.ts:157-173`）。
- **关键边界（参考仓共识）**：**"模型可发起" ≠ "编排要在内核里"**——pi-desktop ADR 0237 明确把 `pi.session-orchestrator` 做成**普通市场插件**，host-core 只留 `session/create` + `session/open` 两个原语（`adr/0237:35-70`）。我方重构后应照此：工具外置，原语/账本/权限留 host。
- **优势（安全语义已对齐）**：权限上限快照"提交时定死、双向不变"（`collaboration.ts:12-16`）与 ADR 0239 "session messaging cannot raise a target's effective permission above the initiating operation's authorized ceiling" 同构；环检测 DAG（`collaboration.ts:122-144`）是 pi-desktop 未显式声明的能力。
- **优势**：账本做成**事件双流四向**（`collaboration.ts:8`，源流 dispatch/report + 目标流 receive/update）比 pi-desktop 的"host 私有账本"更可观测（进会话事件流，可投影/可审计）。
- **差距（P2）**：无对等会话 mailbox、无 fan-out 脚本编排（zcode `CreateWorkflow`、dsh `workflow`）；后者成本大，建议先不做（路C §9 C-9）。
- **重构落点**：`src/runtime/registrations/session.ts` 落 EP-1/EP-2/EP-3；`src/session/collaboration.ts` 的账本 + 权限快照 + 环检测留核/host（**不得下沉为插件**，否则复制 ADR 0237 之前的老问题）。

---

## 5. 无人值守

**我们的重构后内核**：内核只留 `contracts/schedule.ts`（EP-7 `scheduleApi`）；**cron 引擎**在 `src/scheduler/` 域（`cron.ts` 游标 fire 前推进防重入 + `SqliteCronStore`）；off-peak 队列、webhook 入站同域。IM 实现（飞书/Slack）在 `src/host/`（W12 外置，属重构后批次）；调度**工具**外置成插件（批 7）。无人值守自主续跑**缺驱动**（只有 `goal/set` 状态事件）。

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 |
|---|---|---|---|
| **pi** | 内核无 cron；extension 自发；durable `task` 有 `background` flag + checkpoint + phase 驱动 | 内核零调度；task 是 durable 原语 | `oss/pi/packages/durable/src/harness/task-graph.ts:36`（background）、`:18-23`（status/phase）；`experimental/vacation/vacation.ts` |
| **pi-desktop** | 无 cron；后台委托 ADR 0089 明确把"跨轮后台"列为 alternative **未采纳**（轮末必须收敛）；无自主续跑 | host-core（无 cron）；后台委托在 Task 家族 | `oss/pi-desktop/docs/adr/0089-...md`（背景委托 + 未采纳项） |
| **dsh** | ① Host `ctx.schedule`：one-shot/fixed-rate/daily/weekly/**cron(五段 Vixie, IANA tz)**；模型工具 `schedule_create/list/update/delete` 在 `tool-schedule` 独立插件；投递=原会话 follow-up，**需等 `session/flush` 确认**，重启恢复冷会话，错过只补最近一次；② `ctx.jobs` **按 owner 会话隔离** + 完成通知在会话内；③ `goal-round-driver` **自主续跑**（agent 空闲 + goal 存在 + 配额未尽 → 自动再起一轮） | 服务在 host；工具在独立插件；goal-driver 是独立包 | `oss/deepseek-harness/packages/schedule/README.md:10-30`、`schedule/tool-schedule/README.md`；`jobs/README.md:10-25`；`goal/goal-round-driver/README.md:10-30` |
| **zcode** | `automationService.create`（cron + relativeDelay 归一化，**禁止信任模型换算绝对时刻**）；bots 入站 → **建真实 task + sendPrompt**；off-peak（`assertNotOffPeakTurn` 用于 SendMessage） | services 层（bots/automation）；off-peak 在 adapters/model | `oss/zcode/apps/zcode-cli/packages/contracts/src/interfaces/automation.port.ts:44`（create）；`bootstrap/src/zcode-protocol/automation-port.ts:117-121`（相对时间不信任模型）；`packages/services/src/bots/botsService.ts:4752`（sendPromptInBackground）、`:4868`（createTask）；`adapters/src/model/offpeak-retry.ts` |
| **hermes** | `cron/` 30+ 文件（scheduler/tick/delivery_queue/quota_hold/detached_worker/incidents/liveness）；cron 工具 + blueprint catalog；`delivery_queue` durable handoff（**claim-at-most-once，unknown never retried**）；gateway/platforms 多平台 + **access_policy_mixin allowlist/pairing**；goal/heartbeat 续跑 | cron 是 host 服务；platforms 是插件层；access policy 在 gateway | `oss/hermes-agent/cron/scheduler.py:1-4`、`cron/delivery_queue.py:1-10`、`tools/cronjob_tools.py`；`gateway/platforms/access_policy_mixin.py:5-7/51-67`；`gateway/run_goals.py:1-4` |
| **agentscope** | app 层 schedule（`_service/_session.py` 有 delete_schedule）；`app/channel`（feishu/dingtalk/discord）+ `message_bus`（redis/in-memory）+ `workspace_manager`（per-session/per-agent 隔离，多后端） | app 层服务/插件 | `oss/agentscope/src/agentscope/app/_service/_session.py:32`（delete_schedule）、`:98`（SessionService）；`app/channel/_feishu/`、`app/message_bus/`、`app/workspace_manager/_base.py:18-28` |
| **我方** | `CronScheduler.tick()`（游标 fire 前推进防重入）+ `SqliteCronStore`（`cron_tasks` 表 v5）；`OffPeakQueue` + 默认窗口；`WebhookEndpoint`（token + HMAC + 大小上限 + job 记账）；IM 飞书/Slack（HTTP 直调零依赖）→ **派发到固定 sessionId**；`JobRegistry` 253 行（进程级，epoch 作用域）；**cron 只有 UI op**（cron-list/add/remove） | cron 引擎 `src/scheduler/`；IM 在 `src/host/`（W12 外置）；工具外置批 7；内核留 `contracts/schedule.ts` | `src/scheduler/cron.ts:15-17`（触发语义头注）、`:88/122`（parse/match）、`:137-170`（CronTaskRecord + SqliteCronStore）；`src/scheduler/offpeak.ts`；`src/scheduler/webhook.ts:26/89/97`；`src/host/im-surface.ts:20-83`（dispatchPrompt → 固定 sessionId）、`src/host/im-feishu.ts:41`、`src/host/im-slack.ts:33`；`src/kernel/jobs.ts:80-110`（epoch）、`:239`；`src/host/scheduler-ops.ts:111-131`；`src/host/automation-runtime.ts:41-48` |

**差异 / 我方优势 / 我方差距**

- **差距（P1）**：**cron 模型入口缺**——只有 UI op（`scheduler-ops.ts:111-131`），dsh 把它做成独立插件 `tool-schedule`（`schedule/tool-schedule/README.md`），zcode/hermes 也有模型侧或 catalog 入口。
- **差距（P1）**：**cron 投递过轻**——我方 fire-and-forget `sendSystemPrompt`（`automation-runtime.ts:41-48`），目标会话不存在时无恢复语义；dsh 是"等 flush 确认 + 冷会话恢复 + 只补最近一次"（`schedule/README.md`），zcode 是"建真实 task"（`botsService.ts:4868`）。
- **差距（P0，安全）**：**IM 无 allowlist**，入站只能写死一个 sessionId（不能建会话）。hermes `access_policy_mixin` 有 open/allowlist/disabled/pairing 四态（`access_policy_mixin.py:5-7/51-67`）；zcode bots 建真实 task（`botsService.ts:4868`）。这是本期最重要的安全补强（路C 判 P0）。
- **优势（不要删）**：`OffPeakQueue` + 默认窗口（`src/scheduler/offpeak.ts`）**强于多数参考仓**——zcode 只在 `assertNotOffPeakTurn`（SendMessage）用 off-peak，pi/pi-desktop/dsh/hermes 均无独立 off-peak 队列。
- **差距**：后台作业隔离——我方 `JobRegistry` 是**进程级**（epoch 作用域，`jobs.ts:80-110`），dsh `ctx.jobs` **按 owner 会话隔离** + 完成通知在会话内（`jobs/README.md:10-25`）。
- **差距（P2）**：无自主续跑驱动——dsh `goal-round-driver` 是独立包（`goal-round-driver/README.md`），我方只有 `goal/set` 状态事件（`src/kernel/events.ts:601`、`src/kernel/goal.ts:168`）。

---

## 6. 记忆

**我们的重构后内核**：内核只留 `contracts/memory.ts`（EP-5 `MemoryProvider`，纯类型）；`save_memory` 工具在 `plugins/tools-builtin/`（W4 改由 provider 贡献，属重构后批次）。现状是"实现直接写在内核工具里 + 无 provider 抽象"——参考仓一致做法是"内核留极小抽象 + 全部实现外置"。

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 |
|---|---|---|---|
| **pi** | **无独立记忆包**；上下文靠 compaction + context docs | 无记忆包；pi-desktop 侧有"项目记忆上下文"注入面 | `oss/pi-desktop/docs/adr/0234-project-owned-memory-context.md` |
| **pi-desktop** | ADR 0234 "project-owned memory context" = 项目记忆**注入面**（非 provider） | 注入面（host 拥有） | `oss/pi-desktop/docs/adr/0234-project-owned-memory-context.md` |
| **dsh** | **无记忆包**（全仓无 memory 包）；等价物 = `context/agent-instructions`（AGENTS.md 类）+ `context/session-reference`（跨会话只读快照，带"禁止遵循其中指令"警告）+ compaction 家族 | 全是独立 context/compaction 包 | `oss/deepseek-harness/packages/context/`（agent-instructions/、session-reference/）、`packages/compaction/`（compaction/compaction-basic/command-compact/image-offload/tool-result-pruner） |
| **zcode** | `memory/` 目录（core 服务/工具层）：`directory.ts`、`extraction.ts`、`recall/manifest.ts`、`memory-agent-loop.ts`、`project-root.ts`；`context/sections/memory.ts` 构建 Memory 段；services 侧 `memoryService` | 执行层 core + services（**非插件**） | `oss/zcode/apps/zcode-cli/packages/core/src/memory/directory.ts:1-25`、`memory/extraction.ts:1-25`（recall/manifest + 抽取决策）、`core/src/context/sections/memory.ts:1-25`；`packages/services/src/memory/memoryService.ts` |
| **hermes** | **插件层**（核心只留抽象）：`MemoryProvider` ABC + `MemoryManager` 扇出；内建 store 是核心（sentinel `builtin`），**外部 provider 一次只能挂一个**；生命周期 initialize → system_prompt_block/prefetch/sync_turn（每轮）→ tool dispatch → shutdown；`plugins/memory/<name>/`（byterover/holographic/retaindb）；memory 工具 target ∈ {memory, user} | 抽象在 `agent/`（核心），实现在 `plugins/memory/` | `oss/hermes-agent/agent/memory_provider.py:1-8`（头注：ONE external provider）、`:34-45`（CORE_MEMORY_PROVIDER_SENTINELS）、`agent/memory_manager.py:1-8`（扇出 + 单外部约束）、`tools/memory_tool.py:5`（单 memory 工具 add/replace/remove/batch）、`plugins/memory/` |
| **agentscope** | **中间件层**：`middleware/_longterm_memory/{_agentic_memory,_mem0,_reme}`（长时记忆中间件）+ `rag/` + `app/rag` | 库级 middleware | `oss/agentscope/src/agentscope/middleware/_longterm_memory/__init__.py:1-9`；`middleware/_rag.py`；`app/rag/` |
| **我方** | `save_memory` 工具 → 追加 `~/.aegent/memory/MEMORY.md`（2000 字符/条，换行折叠）；系统提示装配时读为「## 持久记忆」独立段（不参与小节合并）；**无 provider 抽象**，插件无法贡献后端 | 内核工具（**位置错**）；重构后 `contracts/memory.ts` + `plugins/tools-builtin/save-memory.ts` | `src/kernel/tools/builtin/save-memory.ts:4`（MEMORY.md 头注）、`:20`（MAX_MEMORY_FACT_CHARS=2000）、`:33`（name:"save_memory"）；`src/context/system-prompt.ts:140-145`（memoryPath）、`:208-214`（独立段） |

**差异 / 我方优势 / 我方差距**

- **判定（过轻 + 位置错）**：我方是**唯一把记忆实现直接写进内核工具**的（`save-memory.ts` 在 `src/kernel/tools/builtin/`），且**无 provider 抽象**——对照 hermes `plugins/memory/<name>/` + `MemoryProvider` ABC（`memory_provider.py:1-8`）、agentscope middleware（`_longterm_memory/__init__.py`）。
- **差距**：**无检索/召回**——我方只追加不检索；hermes 有 prefetch + RecallStatus + recall indicator（`memory_provider.py:34-45`），zcode 有 `recall/manifest.ts`（`memory/extraction.ts:1-25`），dsh 有 FTS5 session-reference。
- **优势（对齐 hermes 双约束）**：重构方案 EP-5 明确"同时只允许 1 个外部 provider"（hermes 的 tool-schema bloat / 冲突后端约束），且内置 provider = 现有 MEMORY.md 追加实现（行为零变化）。
- **优势**：系统提示的「持久记忆」**独立段不参与小节合并**（`system-prompt.ts:208-214`，注释引 gemini user_project_memory 同构）——这是干净的注入点，参考仓中 dsh `session-reference` 也有"独立段 + 禁止遵循指令警告"的同款纪律。
- **重构落点**：EP-5 `MemoryProvider{initialize, systemPromptBlock, prefetch, syncTurn, tools, shutdown}` 落 `core/contracts/memory.ts` + 注册面；`save_memory` 随内置 provider 迁出（批 7）。

---

## 7. 跨会话查询

**我们的重构后内核**：`session_query`/`session_get` 工具（现 `src/kernel/tools/builtin/session-query.ts`）重构后进 `plugins/tools-builtin/`；**服务**（`src/session/query.ts`，SQL 条件 + 分页）留域；**跨会话只读投影接口**（EP-3）落在 `src/runtime/registrations/session.ts`，供 session-query 插件与记忆召回共用。

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 |
|---|---|---|---|
| **pi** | `scanEntries(query, limit, cursor)` 分页扫任意 conversation 的 entry；conversationId 持久可寻址（可切过去继续聊） | 内核包 `durable`（原语） | `oss/pi/packages/durable/src/types.ts:777`（scanEntries）、`:791`（forkConversation） |
| **pi-desktop** | `session/open` 校验并选中已存在 durable session（唯一导航动作）；Agents 面板列 worker；`SessionCollaborationSummary` 有 `createdBySession`/`createdSessions` 投影 | host-core 原语 + shared 投影类型 | `oss/pi-desktop/docs/adr/0237-...md:60-64`（session/open）；`packages/shared/src/session-collaboration.ts:47-56`（createdBySession/createdSessions） |
| **dsh** | `session-query` 组统一查询服务（`ctx.sessionQuery`：精确读/过滤列表/关系 trace/FTS5 搜索）；模型侧 `tool-session-query`（experimental）**5 个只读工具**（session_search/session_event_search/session_trace/session_event_trace/session_event_read）；**仅当目标 session 的 cwd 与调用者完全一致才授权跨会话**，搜索排除调用者自身 | 服务在 `session-query` 包；模型工具是独立 experimental 插件 | `oss/deepseek-harness/packages/session-query/README.md:10-25`；`experimental/tool-session-query/README.md:10-20`、`experimental/tool-session-query/src/index.ts:66-109`（5 工具名）；`session-query/session-query-sqlite/README.md`（FTS5 独立派生库） |
| **zcode** | `ReadSessionContext` 工具（模型读任意会话）；`SessionTask` 面板 | 执行层 core（工具） | `oss/zcode/.../core/src/tool/handlers/read-session-context.ts:146`（name） |
| **hermes** | 血统 SQL（`parent_session_id` + `_LISTABLE_CHILD_SQL` 区分 listable child）+ FTS5 搜索（`hermes_state_search.py`）；api_server 会话读路由 | 核心状态层 + gateway api_server | `oss/hermes-agent/hermes_state_common.py:229-245`（三标记 + listable child SQL）、`hermes_state_search.py`、`gateway/platforms/api_server*.py` |
| **agentscope** | `SessionService.get_session_status`（含 storage 往返优化）；app/hub + storage；workspace_manager per-session 隔离 | app 层服务 | `oss/agentscope/src/agentscope/app/_service/_session.py:98/146/201`（SessionService/get_session_status/get_session）；`app/hub/`、`app/storage/` |
| **我方** | `session_query`（SQL 条件 + 事件类型闭集过滤 + 分页，无 FTS）/`session_get`（读某会话事件），模型可用；服务 `src/session/query.ts`；归档会话读面 fail-closed | 工具 `src/kernel/tools/builtin/session-query.ts`（重构后 plugins）；服务 `src/session/query.ts`；EP-3 在 runtime | `src/kernel/tools/builtin/session-query.ts:67/70`（createSessionQueryTool/name）、`:129/132`（createSessionGetTool/name）；`src/session/query.ts:34-96`（DEFAULT_QUERY_LIMIT/MAX_QUERY_LIMIT/SessionQueryCriteria/SessionQueryRow/SessionEventsRead） |

**差异 / 我方优势 / 我方差距**

- **优势**：我方是**少数模型可直接读任意会话**的仓之一（`session-query.ts:70/132`）——pi 只能对 conversation 发 input、hermes 主要是 UI/服务侧、agentscope 是 app 服务。zcode `ReadSessionContext` 与我方同级。
- **差距**：**无 FTS/全文检索**——我方仅 SQL 条件 + `content like`（`src/session/query.ts:40` `MAX_CONTENT_LIKE_CHARS=256`）；dsh 有 SQLite FTS5 独立派生库（`session-query-sqlite/README.md`），hermes 有 FTS5 + CJK trigram（`hermes_state_common.py:306`），zcode 有 recall manifest。
- **差距（授权模型）**：我方**无跨会话授权边界**——只要工具可用即可查全库；dsh `tool-session-query` 只在"目标 session 的 cwd 与调用者完全一致"时授权（`tool-session-query/README.md:10-20`）。重构 EP-3 应把"只读投影接口"设计成**带授权边界**的 host API，而非无差别全库读。
- **差异**：pi-desktop 的 `createdBySession`/`createdSessions` 是**编排投影**（谁建的/建了谁，`session-collaboration.ts:47-56`）；我方对应物分散在 `session_origins` 表 + 清单 badge（`src/session/db.ts:254`、`src/host/query-gateway.ts:84`），无统一投影。
- **重构落点**：服务留域（`src/session/query.ts`），工具外置（`plugins/tools-builtin/session-query.ts`），EP-3 接口落 `src/runtime/registrations/session.ts`——与 dsh "服务 + 独立 tool 插件"分层一致。

---

## 附：本组 7 功能一句话总览

| # | 功能 | 我方判定 | 最该动 |
|---|---|---|---|
| 1 | 会话模型与存储 | 对齐（事件源 + fail-closed 迁移链） | 无（可选补会话类型闭集 C-8） |
| 2 | 事件存储与投影 | 对齐/略强（flush seq 断言 + 三级恢复） | 无（投影进核是刻意设计） |
| 3 | 子代理 | 缺 resume + send_message | **P1**（引擎已备，差装配路径 + 注册表上提） |
| 4 | 多会话编排 | **有引擎无方向盘** | **P0**（工具壳 + EP-1~EP-4） |
| 5 | 无人值守 | 有渠道无模型入口 + IM 无 allowlist | **P0 安全**（allowlist）+ P1（调度工具/投递语义） |
| 6 | 记忆 | 过轻 + 位置错 + 无抽象 | **P2**（EP-5 provider，成本最小） |
| 7 | 跨会话查询 | 对齐（模型可读任意会话） | P2（补授权边界 + FTS） |

> **一句话**：本组 7 功能里，**我方真正缺的不是引擎，而是"方向盘与可裁剪性"**——编排/子代理/调度/记忆的引擎与账本都已具备（部分甚至强于参考仓），缺的是"把工具交给模型"与"把实现外置成插件"这两步；唯一的安全硬缺口是 **IM 渠道无 allowlist**。
