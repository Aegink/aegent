# 功能对照·第 3 组：模型·审批·进程·交互

> 锚点口径：参考仓 `oss/<name>/...:line`（2026-10-09 快照，相对 `F:\aegent`）；我方用重构后路径
> `src/core/...` 或现路径 `src/kernel/...`。未逐行核实的结论标 `【未验证】`；本次调研已用
> Read/Grep 核实下表锚点。参考材料：`docs/20261010_内核重构总体方案.md`（§1.3/§2）、
> `docs/20261010_内核调研_路A_骨架与插件化.md`、`docs/20261010_内核调研_路B_执行内核.md`。
> 只读调研：未改动 `oss/` 与 `src/` 任何文件。

---

## 1. 模型适配层（provider 抽象 / 流式 / 重试 / 模型切换 / 思考档）

### 1.1 我们的重构后内核

模型适配在内核里只留**接口与循环语义**：`contracts/models.ts`（`ChatTool`/`ChatMessage`/`ModelProvider`/`ModelIdentity`，
自 `src/models/{provider,identity}.ts` 下沉）+ `primitives/loop/model-switch.ts`（换模五态事务）+ `primitives/loop/side-query.ts`
（统一副调用底座）。**wire 实现（anthropic/openai/google/oauth/health）仍在 `src/models/` 域**——`core.requires=[]`
保证内核不依赖它，但 W8"抽独立包"已记档**不采用**（方案 §7）。重试留在实现域（`src/models/retry.ts`），循环只消费
`withRetry` 包出的 provider。

### 1.2 功能对照表

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 file:line |
|---|---|---|---|
| zcode | provider 注册/选择独立成包（registry + resolver + 有效模型选择），运行时按 turn 解析模型契约；流式走 runtime 的 streaming-event 队列 | 抽象在独立包 `@zcode/provider`；wire/流式在 `@zcode/core` 内 | `oss/zcode/packages/provider/src/registry.ts:1`、`oss/zcode/packages/provider/src/effective-model-selection.ts:17`、`oss/zcode/apps/zcode-cli/packages/core/src/runtime/methods/model-streaming-event.ts:1` |
| pi | 最大独立包 `packages/ai`：`StreamFunction` 契约 + 每家 provider 一文件；思考档由 `SamplingParamsByThinkingLevel` 表达；重试上限是 provider 选项 | 独立包（可独立版本化） | `oss/pi/packages/ai/src/types.ts:390`、`oss/pi/packages/ai/src/types.ts:134`、`oss/pi/packages/ai/src/types.ts:198`、`oss/pi/packages/ai/src/providers/anthropic.ts:1` |
| codex | 独立 crate 族：`models-manager`（OpenAi/Static 双管理器 + 缓存）、`model-provider-info`（能力表）；core 消费 model_info | 独立 crates（编译期边界） | `oss/codex/codex-rs/models-manager/src/manager.rs:287`、`oss/codex/codex-rs/models-manager/src/manager.rs:298`、`oss/codex/codex-rs/model-provider-info/src/capabilities.rs:1` |
| kimi-code | `llm-adapter/`（provider 定义 + model-requester + OAuth/凭据恢复）+ 独立 `kosong` 包（provider/generate/使用量）；请求级 trace 契约 | 域内独立目录 + 独立包 | `oss/kimi-code/packages/agent-core-v2/src/llm-adapter/provider/provider.ts:41`、`oss/kimi-code/packages/agent-core-v2/src/llm-adapter/model/model-requester.ts:1`、`oss/kimi-code/packages/agent-core-v2/src/llm-adapter/contract/request-trace.ts:1`、`oss/kimi-code/packages/kosong/src/provider.ts:1` |
| qwen-code | 编进 core：`contentGenerator` 抽象 + `baseLlmClient` 里 `retryWithBackoff` 包整请求（含流中断重试），模型目录/注册表在 `models/` | 编进 core（无包边界） | `oss/qwen-code/packages/core/src/core/contentGenerator.ts:105`、`oss/qwen-code/packages/core/src/core/baseLlmClient.ts:578`、`oss/qwen-code/packages/core/src/models/modelRegistry.ts:1` |
| opencode | 独立包 `packages/llm`：`Definition`/`ModelFactory` 定义层 + `protocols/`（anthropic/openai/gemini 等 wire）+ `providers/`（厂商画像） | 独立包 | `oss/opencode/packages/llm/src/provider.ts:11`、`oss/opencode/packages/llm/src/provider.ts:18`、`oss/opencode/packages/llm/src/llm.ts:45`、`oss/opencode/packages/llm/src/protocols/anthropic-messages.ts:1` |
| pi-desktop | 不自研 wire：内核 = 上游 `pi-ai`（ADR 0002）；本地只做 provider 配置面与 OAuth 回调转发（插件贡献的 providers 也要 provider.register 权限） | 上游包 + 本地配置/权限面 | `oss/pi-desktop/packages/plugin-sdk/src/index.ts:1163`、`oss/pi-desktop/packages/plugin-sdk/src/index.ts:1549`、`oss/pi-desktop/packages/agent-host/src/agent-host.ts:65` |
| **我方** | 单方法 `streamChat(req): AsyncIterable<StreamChunk>` + 8 字段 `ChatRequest`；`withRetry` 显式 status 枚举/指数退避/Retry-After/**流产出后不重试**；换模五态事务；思考档 turn 启动注入 | **接口与循环语义留 `src/core/contracts/models.ts` + `primitives/loop/{model-switch,side-query}.ts`；wire 留 `src/models/` 域（W8 不抽包）** | `src/models/provider.ts:89`、`src/models/provider.ts:91`、`src/models/retry.ts:102`、`src/models/retry.ts:43`、`src/kernel/model-switch.ts:70`、`src/kernel/loop.ts:665`、`src/kernel/loop.ts:676`、`src/kernel/side-query.ts:57` |

### 1.3 差异 / 优势 / 差距

- **优势（接口面最薄且干净）**：我方 `ModelProvider` 只有一个流式方法 + 8 字段请求，与 pi 的 `StreamFunction` 同级，
  比 codex 三 crate 组合、opencode 的 Definition+protocol+provider 三层更少概念。
- **优势（缓存与安全语义在核内）**：`与 provider 无关的"流产出后不重试"`（`src/models/provider.ts:16-19` 注释语义）
  和"换模只影响后续 turn"（`src/kernel/loop.ts:654`）是循环不变量，参考仓中只有 zcode 的 turn-model-step 有等价物。
- **差距（物理边界为 0）**：pi/kimi/opencode/codex 全是"独立包/crate"，我方 `src/models` 与 kernel 平级目录——
  方案已裁决**不抽包**（方案 §7 W8），代价是内核依赖闭包口径上仍含三协议实现，靠 `core.requires=[]` 兜底。
- **差距（重试指纹粗于 qwen）**：qwen 的 `retryWithBackoff` 覆盖"整请求含流中途失败"（`baseLlmClient.ts:706` 注释），
  我方明确"已产出流不重试"，是保守选择但重连能力弱一档（`src/models/retry.ts:102`）。
- **差距（provider 可插件化缺失）**：pi-desktop 允许插件贡献 provider（`plugin-sdk/index.ts:1163`，受 `provider.register`
  权限），我方 contributes 闭集不含 provider（`src/kernel/plugin-manifest-contributes.ts:112`）——A8/EP-11 缺口。

---

## 2. 审批与权限（决策管线 / 审批出口 broker / hook 竞速 / 规则持久化 / 危险命令 / 项目信任 / 准入）

### 2.1 我们的重构后内核

内核留**骨架与端口**：`skeleton/chain.ts`（洋葱链三点位，链底无人应答抛错）、`contracts/policy.ts`
（`ReadGateService` + 工具闸端口，自 `src/policy/read-gate.ts` 下沉）、`skeleton/admission.ts`（有界准入 +
draining 拒绝）。**规则族（dangerous-commands/matchers/rule-loader/rule-match/judge/project-trust）仍在 `src/policy/` 域**——
W13"审批规则插件化 + hook/broker 竞速"已顺延为重构后独立批次（安全评审，方案 §7）。默认姿态是
`abstain→ask` + broker `Deny` 缺省（fail-closed），策略模块抛错原样上抛不 fail-open（`src/policy/chain.ts:20-23`）。

### 2.2 功能对照表

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 file:line |
|---|---|---|---|
| zcode | `resolveToolPermission` 串：项目规则加载→`permissionService.checkPermission`→PreToolUse hook 收窄→内存文件权限→ask 时 `resolveToolApproval`（工具 `prepareApproval` 只能收窄）；**hook 与 broker 竞速取先到者**；审批结果可持久化回项目规则 | core 内（规则匹配/持久化独立文件，未插件化） | `oss/zcode/apps/zcode-cli/packages/core/src/tool/executor/permission-flow.ts:41`、`:86`、`:154`、`:184`、`:361`、`oss/zcode/apps/zcode-cli/packages/core/src/tool/executor/permission-responder-race.ts:38`、`oss/zcode/apps/zcode-cli/packages/core/src/permission/broker.ts:24`、`:34` |
| pi | **内核无审批层**：agent 只提供 `beforeToolCall` 钩子（可 block），审批/沙箱交外层包 | 内核零审批 | `oss/pi/packages/agent/src/types.ts:62`、`oss/pi/packages/coding-agent/src/core/tools/`（工具实现在 coding-agent） |
| codex | `approvals.rs` 三出口（reviewer/guardian/user）+ 审批动作枚举 + 审批缓存键；策略在 `exec_policy` + `sandboxing` + `network_approval` | core 内（Rust 模块，非 crate 边界） | `oss/codex/codex-rs/core/src/tools/approvals.rs:65`、`:147`、`:439`、`:512`、`:530`、`:637`、`oss/codex/codex-rs/core/src/exec_policy.rs:1` |
| kimi-code | `agent/interaction/approval.ts` 定义 approved/rejected/cancelled 决策 + 请求/响应形状；规则匹配在 `tool/rule-match.ts`；会话级批准历史单独策略 | 内核（agent-core-v2）内 | `oss/kimi-code/packages/agent-core-v2/src/agent/interaction/approval.ts:3`、`:5`、`oss/kimi-code/packages/agent-core-v2/src/tool/rule-match.ts:1`、`oss/kimi-code/packages/agent-core-v2/src/agent/permissionPolicy/policies/session-approval-history.ts:1` |
| qwen-code | `PermissionManager` 单管道：规则（system/user/workspace/session 四 scope）+ auto 模式（安全工具白名单→LLM 分类器）+ 危险规则库 + 拒绝追踪 + shell 语义 | 编进 core | `oss/qwen-code/packages/core/src/permissions/permission-manager.ts:223`、`:312`、`oss/qwen-code/packages/core/src/permissions/types.ts:14`、`:20`、`oss/qwen-code/packages/core/src/permissions/autoMode.ts:70`、`oss/qwen-code/packages/core/src/permissions/dangerousRules.ts:1` |
| opencode | `PermissionV2` 模块：`evaluate(action,resource,...rulesets)` + `merge` + 类型化错误；Ruleset 随工具物化注入；`DeclinedError` **直接中止 turn** | core 内 | `oss/opencode/packages/core/src/permission.ts:76`、`:88`、`:60`、`oss/opencode/packages/core/src/session/runner/llm.ts:148` |
| pi-desktop | `agent-host` = 准入 + 每会话 turn 队列 + **审批 broker** + 事件日志 + 快照；插件侧另有 48 项权限闭集（fs 范围 / net.domains） | 语义核在 `agent-host`；插件权限在 `plugin-sdk` | `oss/pi-desktop/packages/agent-host/src/agent-host.ts:174`、`:218`、`:325`、`oss/pi-desktop/packages/agent-host/src/approvals.ts:1`、`oss/pi-desktop/packages/plugin-sdk/src/index.ts:1403` |
| **我方** | `gate.ts:createToolGateLayer` 挂 toolCall 链（剥提案→链求值→protectedPaths→selfGuard→planGuard→ask/abstain→broker）；四层策略 `POLICY_LAYERS=[managed,user,project,core]` 首个非 undefined 者胜；危险库/judge/项目信任齐全；broker `Deny` 缺省 + `PendingApprovals` 挂起；`TurnAdmission` 有界准入 + draining 拒新轮 | **内核留 `skeleton/chain.ts` + `contracts/policy.ts` + `skeleton/admission.ts`；规则族留 `src/policy/` 域（W13 顺延）** | `src/policy/chain.ts:28`、`src/policy/chain.ts:20`、`src/policy/gate.ts:242`、`src/policy/broker.ts:24`、`src/policy/dangerous-commands.ts:1`、`src/policy/project-trust.ts:1`、`src/policy/judge.ts:1`、`src/kernel/admission.ts:40` |

### 2.3 差异 / 优势 / 差距

- **优势（决策面最厚）**：我方四层链 + 6 道硬闸 + 危险命令库 + judge + 项目信任，参考仓只有 qwen 的
  PermissionManager 在"规则族丰富度"上可比（`permissions/` 目录 20+ 文件），zcode/codex 都把这个面拆薄了。
- **优势（fail-closed 显式）**：`chain.ts:20-23` 明确"策略模块抛错不 fail-open"；pi 干脆无审批、
  opencode 用类型化 `DeclinedError` 直接中止（`permission.ts:60`）——我方是唯一把"abstain→ask→Deny 缺省"
  三层默认写死的（`src/policy/broker.ts:24`）。
- **差距 1（hook/broker 竞速缺失）**：zcode 的 `racePermissionResponders` 是挂死事故驱动的设计
  （`permission-responder-race.ts:38`，败者 abort），我方单一 broker 出口——W13 已记档顺延。
- **差距 2（规则持久化缺写入通道）**：zcode `persistProjectPermissionUpdates`（`:361`）+ `permission-suggestions`
  能把批准写回项目规则；我方 `rule-loader.ts` 只读加载（路 B §6 判定）。
- **差距 3（工具级审批声明为 0）**：zcode 每个 `ToolEntry` 带 `needsApproval/riskLevel/prepareApproval`
  （`tool/types.ts:80-82/357`），我方审批完全由 policy 按名分类（`src/policy/gate.ts:73-74`）——
  B1"契约补元数据"是前置。

---

## 3. 进程模型（每会话一进程 vs 多路复用 / stdio 协议 / 子进程生命周期）

### 3.1 我们的重构后内核

内核留 `primitives/process/`（`child.ts` ← `agent-child.ts` + `child-config.ts` ← `agent-child-config.ts`），
语义是 **"1 会话 1 child" + stdio 行分帧 JSON-RPC**（`MAX_LINE_BYTES=4MB`）。装配由父进程
（`src/kernel/agent-process.ts`）负责，重构后子进程入口改为**接收注册表**以去掉 8 条域 import；
宿主装配与进程编排整体搬 `src/runtime/`（批 5）。

### 3.2 功能对照表

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 file:line |
|---|---|---|---|
| zcode | 服务端独立包，**stdio 与 http 双入口**；stdio 模式 stdout 只承载 RPC 帧（普通 console 全重定向 stderr），带 hello/hello-ack 握手与进程生命周期注册 | 独立包 `@zcode/server`（多会话宿主，非 1 会话 1 进程） | `oss/zcode/packages/server/src/stdio.ts:56`、`oss/zcode/packages/server/src/entry-stdio.ts:14`、`:30`、`oss/zcode/packages/server/src/stdio-lifecycle.ts:1` |
| pi | `packages/server` 用 `SessionRouter` 托管多会话，客户端 `attachClient/removeSession` 挂到既有会话（**多客户端复用同一 host 会话**）；transport 用 unix socket | 独立包（server/client 分离） | `oss/pi/packages/server/src/session-router.ts:34`、`:60`、`:262`、`oss/pi/packages/server/src/transports/unix/` |
| codex | `app-server`（JSON-RPC 进程）+ `app-server-protocol`（协议 crate）+ `exec-server`（执行服务）；agent 循环本身在 core 进程内线程跑（`tasks/regular.rs`），app-server 是外层壳 | 协议/壳独立 crates；循环在 core | `oss/codex/codex-rs/app-server-protocol/src/rpc.rs:1`、`oss/codex/codex-rs/app-server/src/app_server_tracing.rs:1`、`oss/codex/codex-rs/core/src/tasks/regular.rs:104` |
| kimi-code | `kap-server`（HTTP server，`startServer` + 持久 token + bind 分类）+ `klient`（client transports: ipc/memory）+ `acp-server`；agent 运行时另有 `localRuntime` 进程内实现 | 服务端/客户端独立包 + 运行时抽象 | `oss/kimi-code/packages/kap-server/src/start.ts:99`、`oss/kimi-code/packages/kap-server/src/index.ts:1`、`oss/kimi-code/packages/klient/src/transports/`、`oss/kimi-code/packages/agent-core-v2/src/runtime/localRuntime.ts:16` |
| qwen-code | 两条路并存：`ipc/`（**每机一个 UDS socket + peer-admission/peer-directory** 的多进程互信）+ `managed-runtime/`（`ManagedChildRunSupervisor` 为每次 managed child run **spawn 一个子进程**并有 acceptance/run record） | 编进 core（managed-runtime 是 core 子目录） | `oss/qwen-code/packages/core/src/ipc/uds-inbox.ts:8`、`:12`、`oss/qwen-code/packages/core/src/ipc/peer-admission.ts:1`、`oss/qwen-code/packages/core/src/managed-runtime/managed-child-run-supervisor.ts:129`、`:170` |
| opencode | server / client 分离：`cli/cmd/serve` 起 server，`cli/cmd/tui` 是客户端；HTTP + WS 多路复用（`packages/server` 路由/中间件） | 独立包（多路复用，非 1 会话 1 进程） | `oss/opencode/packages/opencode/src/cli/cmd/serve.ts:1`、`oss/opencode/packages/opencode/src/cli/cmd/tui.ts:1`、`oss/opencode/packages/server/src/routes.ts:1` |
| pi-desktop | `agent-sidecar.ts` 用 `spawn` 起子进程（NDJSON-RPC，保留 stderr 尾 40 行用于退出归因）+ `host-process` + `runtime-supervisor`；Electron 主进程与 sidecar 分离 | 本地薄运行时（`host-runtime` 包） | `oss/pi-desktop/packages/host-runtime/src/agent-sidecar.ts:1`、`:6`、`oss/pi-desktop/packages/host-runtime/src/host-process.ts:1`、`oss/pi-desktop/packages/host-runtime/src/runtime-supervisor.ts:1` |
| **我方** | **1 会话 1 child**：父进程 `spawn node dist/src/kernel/agent-child.js`（CLI 参数/env 回退装配），child 内 `runAgentChildStdio` 跑 readline 行分帧 JSON-RPC（`MAX_LINE_BYTES=4MB`）；`TurnAdmission` 在 child 内做有界准入 | **内核留 `primitives/process/{child,child-config}.ts`；装配/编排搬 `src/runtime/`** | `src/kernel/agent-child.ts:1`、`src/kernel/agent-process.ts:19`、`src/kernel/agent-process.ts:260`、`src/kernel/agent-protocol.ts:369`、`src/kernel/admission.ts:40` |

### 3.3 差异 / 优势 / 差距

- **我方是唯一"1 会话 = 1 进程"且把语义钉在内核的**：参考仓一侧是多路复用服务端（zcode/pi/opencode/kimi/codex
  app-server 都是一进程宿主多会话），一侧只是"每次 run spawn 子进程"（qwen managed-runtime、pi-desktop sidecar）
  而没有"会话↔进程"一一绑定。我方换来的是崩溃隔离 + 冷启动纪律（`agent-process.ts:13` Q16 注释），
  代价是每会话内存/启动成本（方案 §10 未列为风险，属已接受设计）。
- **优势（协议帧边界显式）**：zcode 需要靠"stdout 只许 RPC"的重定向纪律防污染（`entry-stdio.ts:30`），
  我方把行上限写进协议常量（`agent-protocol.ts:369`），并规划 EP-9 `PROTOCOL_VERSION` + 握手协商——参考仓
  只有 zcode 有 hello/hello-ack，pi 的 protocol 包有版本号【未验证具体行】。
- **差距（生命周期韧性）**：pi-desktop 有 sidecar stderr 尾部归因 + supervisor 重启；我方的 child 退出归因与
  重启策略属 `src/runtime/` 装配面（批 5），内核只保证 stdio 循环，无内建退避重启。
- **差距（多客户端接入能力为零）**：pi 的 `SessionRouter.attachClient`（`:60`）允许 N 客户端挂 1 会话，
  opencode 有 server 层多路复用；我方一 child 一客户端（协议无 attach 语义）——多端/IM 并发观察是缺口。

---

## 4. 会话配置与热刷新（配置分层 / 热更 / 权限模式档）

### 4.1 我们的重构后内核

`primitives/session/session-config.ts`（现 `src/kernel/session-config.ts`）：**可热刷新白名单 vs 会话内静态设置**
两类闭集——`REFRESHABLE_CONFIG_KEYS`（approvalTimeoutMs/queueMaxSize/sandboxMode/unattended/approvalMode）
经 `config/refresh` 通道生效，载荷含非白名单键**整包类型化拒绝**（fail-closed）；五档权限模式
`PERMISSION_MODES_DIRECTORY`（ask/accept-edits/read-only/auto/unattended）+ 三档 `PERMISSION_PRESETS`
（readonly/workspace/yolo）都是"命名 knob 记录"，经同一 refresh 通道逐 knob 写入，不新增第二配置来源。

### 4.2 功能对照表

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 file:line |
|---|---|---|---|
| zcode | `ConfigOverlay` 抽象统一"缺省继承 / Config 递归覆盖 / 其他值整体替换"语义，稀疏层与完整配置同型；provider 配置另有 sources/overlay 分级 | 独立包 `@zcode/provider` 内 | `oss/zcode/packages/provider/src/config-overlay.ts:19`、`:26`、`oss/zcode/packages/provider/src/config-service.ts:1` |
| pi | 单文件 config（coding-agent），会话配置随 `AgentLoopConfig` 传入；agent 内核不持配置仓库 | 编进 coding-agent | `oss/pi/packages/coding-agent/src/config.ts:1`、`oss/pi/packages/agent/src/types.ts:33`（StreamFn 相邻的 loop 配置面）【未验证具体字段行】 |
| codex | `ConfigLayer` + `ConfigLayerStack`（企业云层按栈序合并）+ **会话内 `refresh_runtime_config`**：只刷白名单字段，`resolve_runtime_refresh` 逐字段判可刷性，不可刷字段保持 | core 内（config crate 提供层栈） | `oss/codex/codex-rs/config/src/config_layer_source.rs:71`、`oss/codex/codex-rs/config/src/cloud_config_layers.rs:117`、`oss/codex/codex-rs/core/src/session/config_refresh.rs:31`、`:49`、`:56` |
| kimi-code | `ConfigService` + `ConfigRegistry`（分层 sections）+ overlay 贡献 + `sectionDiff`/`tomlWriteback`（回写 TOML） | 内核 app/config 内 | `oss/kimi-code/packages/agent-core-v2/src/app/config/configService.ts:342`、`:206`、`oss/kimi-code/packages/agent-core-v2/src/app/config/sectionDiff.ts:1`、`oss/kimi-code/packages/agent-core-v2/src/app/config/tomlWriteback.ts:1` |
| qwen-code | `config/config.ts` 单点 + `approval-mode.ts` 与 `approval-modes.json`（模式档数据化）+ 模型配置独立解析器 | 编进 core | `oss/qwen-code/packages/core/src/config/config.ts:1`、`oss/qwen-code/packages/core/src/config/approval-mode.ts:1`、`oss/qwen-code/packages/core/src/models/modelConfigResolver.ts:1` |
| opencode | Config 分层 + `ConfigMarkdown`（md 里的 agent/skill 声明）；权限 Ruleset 属于配置面 | core 内 | `oss/opencode/packages/core/src/config/markdown.ts:1`、`oss/opencode/packages/core/src/permission.ts:88` |
| pi-desktop | 全局 + 会话双层权限/模型设置【未验证具体文件】；会话级 turn 队列与审批寿命是主机侧每会话状态 | agent-host 内核 | `oss/pi-desktop/packages/agent-host/src/agent-host.ts:190`（`localApprovalLifetimeMs`）、`:212` |
| **我方** | **白名单热刷 + 静态键整包拒绝**（codex `refresh_runtime_config` 同语义）；五档权限模式 + 三档预设均为"命名 knob 记录"，`applyPermissionMode`/`applyPreset` 走既有 refresh 通道；五档语义：ask-all / accept-edits / read-only（写类拒绝）/ auto / unattended（ask→deny 最高优先） | **内核 `primitives/session/session-config.ts`** | `src/kernel/session-config.ts:86`、`:96`、`:66`、`:109`、`:133`、`:32` |

### 4.3 差异 / 优势 / 差距

- **优势（两分法最干净）**：我方"热刷新白名单 + 静态键整包拒绝"把 codex 的 `resolve_runtime_refresh`
  语义（`config_refresh.rs:56`）提炼成闭集 + 类型化错误，并显式声明"在途 turn 持旧值"（`session-config.ts:15-17`）——
  比 kimi 的 sectionDiff+writeback、zcode 的 overlay+validateComplete 更小。
- **优势（模式档与预设同轨）**：五档 `PERMISSION_MODES_DIRECTORY`（`:66`）覆盖 unattended（ask→deny）这一
  无人值守档——参考仓中只有 qwen 的 ApprovalMode 与 agentscope 五档有近似面，pi/codex/opencode 都没有
  "无人值守"档。
- **差距（配置面写回缺失）**：kimi 有 `tomlWriteback`（UI 改配置回写文件）、zcode 有 `persistProjectPermissionUpdates`
  ——我方配置是"进程内 store + 只读加载"，**无写回通道**（`rule-loader.ts` 只读，路 B §6）。
- **差距（配置来源分层浅）**：codex 有 `ConfigLayerStack`（企业云层 + 本地层按栈序）、zcode 有 sources/overlay
  多级；我方 `session/settings.ts` 是单文件大表（2,081 行，arch warn 记录在案），分层只有"会话 store vs 构造捕获"。

---

## 5. 交互控制（队列 / steer / 中断 / 取消 / 看门狗）

### 5.1 我们的重构后内核

`primitives/loop/`（`loop.ts` 驱动 + 决策、`guards.ts`、`watchdog.ts`、`stream-recovery.ts`）+
`skeleton/queue.ts`：队列是**有界 FIFO**（`QueueFullError` fail-closed，缺省 64），`QueueMode = all | one-at-a-time`
取自 pi；steer 消息在 step 边界以 `user/message` 落盘后进下一次模型请求；取消是**协作式**（`cancelCause` 置槽 +
每个 await 边界检查，不弃在途 promise）；看门狗只强制**事件流终态**（`forceCloseTurn`）不弃 promise；
`stream-recovery` 负责整 step 重发。

### 5.2 功能对照表

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 file:line |
|---|---|---|---|
| zcode | 运行时命令优先级队列（`now/next/later` 三档 + `dequeueNextBatch` 批取）；循环每轮 `throwIfTurnAborted`；工具级 timeout，**无 turn 级看门狗** | core 内 | `oss/zcode/apps/zcode-cli/packages/core/src/runtime/command-queue.ts:10`、`:121`、`oss/zcode/apps/zcode-cli/packages/core/src/runtime/methods/turn-loop.ts:43`（`throwIfTurnAborted` 在 :47 注释位） |
| pi | 每个注入点 `getSteeringMessages()` 拉 steer（外层 `while(true)` 续跑 + 内层 `while(hasMoreToolCalls \|\| pendingMessages.length)`）；`QueueMode` 枚举控制一次排空几条；`AbortSignal` 透传，无看门狗 | 内核（agent 包） | `oss/pi/packages/agent/src/agent-loop.ts:176`、`:183`、`:205`、`oss/pi/packages/agent/src/types.ts:55` |
| codex | `input_queue.has_pending_input(&active_turn)` 决定外层 loop 是否续跑；`CancellationToken` 树 + `AbortOnDropHandle`，工具须自行观察取消（`finishes_on_cancellation`） | core 内 | `oss/codex/codex-rs/core/src/tasks/regular.rs:120`、`oss/codex/codex-rs/core/src/tools/parallel.rs:141`、`:203` |
| kimi-code | `steerSignal` 独立通道 + `machine/engine.ts:steer(id)` 状态机事件（`input.steer`）+ `LoopSnapshot.queue`；`stepOrdinal > maxStepsPerTurn` → LOOP_MAX_STEPS_EXCEEDED；abortTimeout 兜底 | 内核（agent-core-v2） | `oss/kimi-code/packages/agent-core-v2/src/agent/loop/machine/engine.ts:177`、`:509`、`oss/kimi-code/packages/agent-core-v2/src/agent/loop/loop.ts:210`、`oss/kimi-code/packages/agent-core-v2/src/agent/loop/promptChannel.ts:60` |
| qwen-code | 工具批分区（连续并发安全项合并并行批，保序）+ ApprovalMode（PLAN/AUTO/YOLO）；调度器单文件内含 30min TTL | 编进 core | `oss/qwen-code/packages/core/src/core/coreToolScheduler.ts:1676`（`partitionToolCalls`）、`:1636`（`isConcurrencySafe`）、`:1777`【TTL，行号引自路 B】 |
| opencode | `SessionInput.promoteSteers / promoteNextQueued` 在 runner 内提升队列输入；Effect 结构化并发（`FiberSet` + `raceFirst`）；拒绝即中止循环 | core 内 | `oss/opencode/packages/core/src/session/runner/llm.ts:190`、`:192`、`:141`（`awaitToolFibers` = `raceFirst(join, awaitEmpty)`）、`:148` |
| pi-desktop | `agent-host` 每会话 turn 队列 + 准入 + 审批寿命（无远端订阅者时的 approval lifetime 120s）；Stop 保留已接受输入不独立重放 | agent-host 内核 | `oss/pi-desktop/packages/agent-host/src/turn-queue.ts:1`、`oss/pi-desktop/packages/agent-host/src/agent-host.ts:174`、`:212` |
| **我方** | 有界队列 + `drain()`（all/one-at-a-time）+ `drainAll()` 退回未消费输入；steer 在 step 边界落盘；协作式取消（每 await 边界）+ **turn 级看门狗**（只强制事件流终态）+ maxSteps + 双轴预算 + mutation 预算 + 流恢复 + 输出触顶续跑；`decideTurn` 显式 end，**绝不推断"无 toolCall 就停"** | **内核 `skeleton/queue.ts` + `primitives/loop/`（guards/watchdog/stream-recovery 为批 3 拆出）** | `src/kernel/queue.ts:33`、`:108`、`src/kernel/queue.ts:69`（QueueFullError）、`src/kernel/loop.ts:624`、`:730`、`:555`、`:586`、`src/kernel/loop.ts:488`（cancel）【行号引自路 B】、`src/kernel/stream-recovery.ts:33` |

### 5.3 差异 / 优势 / 差距

- **优势（护栏最全且显式）**：护栏种类（maxSteps/双轴预算/mutation 预算/看门狗/输出触顶/流恢复）为全表最多，
  且 `decideTurn` 显式停止（`src/kernel/loop.ts:744`【路 B】）与"看门狗不弃在途 promise"（`loop.ts:388-390` 注释）
  是参考仓无同款的显式语义。
- **优势（队列语义最完整且 fail-closed）**：`QueueFullError` 类型化拒绝（`queue.ts:69`）+ 无 per-prompt 完成句柄
  （A9 纪律，`queue.ts:1-12`）——pi 的 `QueueMode` 只定节奏、无上限；zcode 有优先级但无"入队即收执"的语义收紧。
- **差距（无优先级/批次队列）**：zcode 命令队列分 now/next/later（`runtime-command-queue.ts`），
  我方 FIFO 无优先级——紧急打断只能走 cancel 不能插队。
- **差距（无 tokens/速率级背压）**：参考仓普遍无队列背压，这一项我方不落后；但 pi-desktop 的 approval
  lifetime 与"Stop 保留输入"（`agent-host.ts:212`）我方只有 `drainAll` 回退，无寿命概念。
- **差距（子代理 steer 面）**：kimi 的 `steer(id)` 可定向到具体 prompt id（`engine.ts:177`），
  我方 steer 是队列级（`queue.ts:108`）——定向 steer 属 W9 范畴。

---

## 6. 插件 SDK 能力面（宿主 API 面 / 权限闭集 / 隔离 / 常驻服务 / 消息总线 / 热加载）

### 6.1 我们的重构后内核

内核只留 `contracts/plugins.ts`（manifest 形状 + `PluginHostApi` 契约）；**插件运行时外置到
`src/ext-builtin/plugin-runtime/`**（默认内置、可裁剪，批 4）。今天的宿主 token 是 `PluginCapabilities`
（`registerTool`/`subscribe`/`pluginSettings` 三方法，`plugin-loader.ts:47` 的运行时能力闭集也是三项）；
contributes 六类闭集（commands/skills/views/mcpServers/settings/subscriptions）。
**能力面分片（EP-11）+ 常驻服务/消息总线（EP-12）属重构后独立批次（W15）**。

### 6.2 功能对照表

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 file:line |
|---|---|---|---|
| zcode | 无运行期插件 SDK：插件 = 静态资源包（skills/commands 等 6 类组件），唯一执行通道是 hooks/MCP；manifest 契约在 contracts 包 | 契约在 contracts 包；运行时不存在 | `oss/zcode/apps/zcode-cli/packages/contracts/src/plugins/index.ts:141`、`oss/zcode/apps/zcode-cli/packages/contracts/src/skills/index.ts:1` |
| pi | 扩展与内置同数组同接口，`builtin: true` + `replaceable: true` 可被第三方接管；`ExtensionContext` 暴露工具/TUI/会话面 | 内核包（agent）+ coding-agent 的 extension 类型 | `oss/pi/packages/coding-agent/src/core/extensions/index.ts:6-13`、`oss/pi/packages/coding-agent/src/core/extensions/types.ts:325`、`:516` |
| codex | 编译期扩展：`plugin` crate（manifest/provider/bundled_hooks/load_outcome）+ `core-plugins`(93 文件) + `ext/*` 15 个 crate；运行期贡献面窄（skills/MCP/hooks 资源包） | crate 级（编译期） | `oss/codex/codex-rs/plugin/src/manifest.rs:1`、`oss/codex/codex-rs/core-plugins/src/catalog.rs:1`、`oss/codex/codex-rs/Cargo.toml`（members） |
| kimi-code | `app/plugin/` 插件域 + `mcpManagement`/`mcpRegistry`；能力面按 app service 注入 | 内核 app 内 | `oss/kimi-code/packages/agent-core-v2/src/app/plugin/`（目录）、`oss/kimi-code/packages/agent-core-v2/src/app/mcpRegistry/mcpRegistryService.ts:1` |
| qwen-code | `core/src/extension/` 扩展域（兼容 Claude 扩展转换器 + archive-safety）+ `mcp/` + hooks；无声明式权限面 | 编进 core | `oss/qwen-code/packages/core/src/extension/extension-converter.ts:32`、`oss/qwen-code/packages/core/src/hooks/hookPlanner.ts:1` |
| opencode | `Plugin = (input, options) => Promise<Hooks>`：`PluginInput` 直接把完整 SDK client + Bun shell + workspace 注册交给插件 | 独立包 `packages/plugin`（**零权限声明、零隔离**） | `oss/opencode/packages/plugin/src/index.ts:74`、`:62`、`oss/opencode/packages/core/src/plugin.ts:40`【行号引自路 A】 |
| pi-desktop | `PluginHostApi` ~60 方法（app/themes/commands/ui/project/providers.oauth/fs/agent/session/usage/services/bus/net…）+ **48 项权限闭集** + fs 范围/net.domains；utilityProcess 进程级隔离；`contributes.services` 常驻服务 + 声明式消息总线；dev 热重载天花板 | `plugin-sdk` 包（契约）+ 宿主实现 | `oss/pi-desktop/packages/plugin-sdk/src/index.ts:1114`（`PluginHostApi`）、`:1403`、`:1376`（`PluginModule` 生命周期）、`:150`、`oss/pi-desktop/docs/adr/0008-plugin-runtime-isolation-target.md` |
| **我方** | 宿主 token 只有 `registerTool`/`subscribe`/`pluginSettings` 三方法（**全表最窄**）；contributes 六类闭集 + 数量上限；装配期一次性装载 + never-fail（单插件失败 warn 跳过）；`disposeAll`/`unregisterTool` 在位但无 dev 重载 IPC；无常驻服务、无总线、无 provider/channel/sandbox-backend 贡献 | **内核只留 `contracts/plugins.ts`；运行时外置 `src/ext-builtin/plugin-runtime/`；能力面/常驻/总线 = W15 独立批次** | `src/mcp/plugin-sdk.ts:80`、`:85`、`:98`、`src/kernel/plugin-loader.ts:47`、`:200`、`src/kernel/plugin-manifest-contributes.ts:112`、`:34` |

### 6.3 差异 / 优势 / 差距

- **优势（安装期 fail-closed 校验是参考仓没有的）**：`validateManifest(rawManifest, PLUGIN_RUNTIME_CAPABILITIES)`
  在装载前把"声明能力 ∉ 运行时闭集"拒掉（`plugin-loader.ts:130`），配合 never-fail 装配
  （`plugin-loader.ts:15`）——opencode 零校验、pi-desktop 声明即授予（ADR 0008 已知边界），我方在三者中纪律最严。
- **优势（契约与实现分离最彻底）**：重构后 manifest 形状 + HostApi 契约在内核 `contracts/plugins.ts`，
  运行时是"默认内置可裁剪"的 `ext-builtin` 包——对应 pi 的 `replaceable: true` 与 pi-desktop 的
  "捆绑插件走公共通道"（ADR 0105/0241）。
- **差距 1（能力面窄 20 倍）**：pi-desktop ~60 方法 + 48 权限 vs 我方 3 方法；后果是 IM/网络/文件/模型/UI
  全部无法插件化（路 A §5.4）——EP-11 是最大待补面。
- **差距 2（无常驻服务 + 无总线）**：pi-desktop `contributes.services`（≤4/插件，broker 管 start/stop/重启）
  + topics 声明式总线（64KB/16 订阅/100 per 10s 限流）；dsh 的 Service 即常驻——我方 onActivate 是同步激活面，
  无生命周期管理（EP-12）。
- **差距 3（无热重载/无崩溃自愈）**：pi-desktop dev 两步加载 + 热重载天花板（批准时快照为上限）+ 崩溃指数退避
  重启 ≤5 次；我方装配期一次装载，`disposeAll` 只用于进程退出（`plugin-loader.ts:272`）。

---

## 7. 日志与诊断（日志通道 / 级别 / 保留 / 原始分片诊断）

### 7.1 我们的重构后内核

`skeleton/logger.ts` 留核：单出口 logger，四档级别（debug/info/warn/error）、`redactSecrets`（`sk-` 正则）
+ `redactUserContent`（约定字段 `userContent`，缺省 true）、通道（channel）→ 文件名 `<channel>-YYYYMMDD.log`
（host/agent/ui/raw 四通道）、`retentionDays`（缺省 14，写路径顺带清理不阻塞）、单日 64MB 软上限告警。
`raw-chunk-log.ts` 是原始分片诊断旁路，**批 8 删除**（诊断改由插件提供）。

### 7.2 功能对照表

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 file:line |
|---|---|---|---|
| zcode | 统一 log 格式工具（`formatLogPrefix(source,pid)`）+ logger factory（`createNodeLoggerFactory`）注入各域；stdio 模式强制普通 console 全部重定向 stderr 防污染 RPC；日志保留清理策略 | 共享包提供格式/工厂，调用方在 core/CLI | `oss/zcode/packages/shared/src/log-format.ts:29`、`oss/zcode/apps/zcode-cli/packages/bootstrap/src/zcode-protocol-entrypoint.ts:104`、`oss/zcode/apps/zcode-cli/packages/cli/src/run.ts:490`、`oss/zcode/packages/server/src/entry-stdio.ts:30` |
| pi | `packages/telemetry` 三实现（noop/memory/真实 exporter）——telemetry 是可替换包 | 独立包 | `oss/pi/packages/telemetry/src/index.ts:1`、`oss/pi/packages/telemetry/src/noop.ts:1`、`oss/pi/packages/telemetry/src/memory.ts:1` |
| codex | `otel` crate（OTLP exporter/trace_context/targets/metrics）+ `diagnostics` crate；另有 rollout 事件持久化 | 独立 crates | `oss/codex/codex-rs/otel/src/otlp.rs:1`、`oss/codex/codex-rs/otel/src/trace_context.rs:1`、`oss/codex/codex-rs/diagnostics/src/lib.rs:1` |
| kimi-code | 请求级 `LLMRequestTrace` 契约 + `human/kimi/trace.ts`；server 侧 pino logger service | 内核内 | `oss/kimi-code/packages/agent-core-v2/src/llm-adapter/contract/request-trace.ts:1`、`oss/kimi-code/packages/agent-core-v2/src/human/kimi/trace.ts:1`、`oss/kimi-code/packages/kap-server/src/services/pinoLoggerService.ts:1` |
| qwen-code | 编进 core 的 telemetry 域：配置/事件循环滞后指标/daemon tracing/文件 exporter/内容日志 | 编进 core | `oss/qwen-code/packages/core/src/telemetry/config.ts:1`、`oss/qwen-code/packages/core/src/telemetry/event-loop-lag-metrics.ts:1`、`oss/qwen-code/packages/core/src/telemetry/file-exporters.ts:1` |
| opencode | Effect 原生日志：`minimumLogLevel()` 从环境取级别，`loggers()` 组装多 sink；OTLP 另开 | 独立包 `core/src/observability` | `oss/opencode/packages/core/src/observability/logging.ts:56`、`:67`、`oss/opencode/packages/core/src/observability/otlp.ts:50` |
| pi-desktop | agent-host `event-log.ts`（回合事件日志）+ 插件审计日志（每个 `pi.*` 调用过 allowlist→permission→host service→audit） | agent-host 内核 + 插件运行时 | `oss/pi-desktop/packages/agent-host/src/event-log.ts:1`、`oss/pi-desktop/docs/adr/0008-plugin-runtime-isolation-target.md` |
| **我方** | 单出口 logger：四档级别 + setLevel 热更 + 通道分文件 + 保留清理（zcode logRetention 锚）+ 64MB 软上限 + 密钥/用户原文双 redact；原始分片诊断（`RawChunkLog`，可选开） | **内核 `skeleton/logger.ts`；raw-chunk-log 批 8 删（诊断改插件）** | `src/kernel/logger.ts:33`、`:115`、`:192`、`:197`、`src/kernel/raw-chunk-log.ts:40`、`src/kernel/logger.ts:1-28`（通道/保留/软上限头注） |

### 7.3 差异 / 优势 / 差距

- **优势（保留策略是写路径顺带做）**：`cleanExpiredLogs` 在每自然日首次写入时清理且失败只告警
  （`logger.ts:115` + 头注 `:25-27`），不阻塞调用方——参考仓未见等价"保留+软上限"内建（zcode 的 retention
  在服务层，非 logger 自身）。
- **优势（脱敏双管道是内核默认）**：密钥正则 + `userContent` 约定字段双 redact（`logger.ts:92/97`）且缺省开——
  pi/qwen 的日志无此内建管道，参考仓只有 pi-desktop 的审计日志承担类似职责。
- **差距（无 OTLP/span 导出）**：codex（otel crate）、qwen（daemon tracing/file-exporters）、opencode（otlp.ts）
  都有 OTLP 导出；我方是文件日志 + 事件流，**无 trace 导出通道**——插件可补但今天没有。
- **差距（无 trace 关联 ID 贯穿）**：zcode 每个工具权限日志带 `traceContextToLogContext`（`permission-flow.ts:102-121`），
  kimi 有 `LLMRequestTrace`；我方 logger 无内建 trace/span 字段（事件流承担部分）。
- **差距（原始分片诊断降级）**：`raw-chunk-log.ts` 批 8 删除后，原始流分片诊断要靠插件提供——
  参考仓中 zcode 的 streaming-event 队列持久化是 core 能力（`cancelled-stream-persistence.ts`），
  我方删除后需要确认插件方案不降低可诊断性（方案 §1.3 已记）。

---

## 8. 技能与提示词（技能目录 / 提示词模板 / 计划模式）

### 8.1 我们的重构后内核

**全部外置到 `src/ext-builtin/prompt-defaults/`**（prompts.ts / prompt-polish.ts / skills.ts / plan-mode.ts，
批 4），核内只留装配点（提示段装配 + 技能目录贡献面 + 计划模式端口）。现状：提示词模板从
`PROMPTS_DIR=.zcode/prompts` / `USER_PROMPTS_DIR=.aegent/prompts` 加载（128KB 上限 + frontmatter 校验）；
技能从 `.zcode/skills` 的 `SKILL.md` 加载；计划模式是同一 agent 的显式状态（plan_enter/plan_exit 双工具 +
流重建恢复 + 退出需批准）。

### 8.2 功能对照表

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 file:line |
|---|---|---|---|
| zcode | 技能 = 契约 + context section（`buildSkillsContent` 带预算裁剪）+ `bundled-skills` 独立包；计划模式 = `plan-mode-policy.ts`（进入 allow/退出 deny 的转换权限）+ 专用 prompts 文件 | 契约/权限在 core，技能内容独立包 | `oss/zcode/apps/zcode-cli/packages/contracts/src/skills/index.ts:1`、`oss/zcode/apps/zcode-cli/packages/core/src/context/sections/skills.ts:39`、`oss/zcode/apps/zcode-cli/packages/bundled-skills/skills/`（目录）、`oss/zcode/apps/zcode-cli/packages/core/src/permission/plan-mode-policy.ts:19` |
| pi | 技能在 coding-agent `core/skills.ts`；系统提示词由 `BuildSystemPromptOptions` 驱动；无独立 plan 工具（交互模式区分） | 编进 coding-agent | `oss/pi/packages/coding-agent/src/core/skills.ts:1`、`oss/pi/packages/coding-agent/src/core/extensions/types.ts:105`、`:323`（ExtensionMode） |
| codex | 技能独立 crate（SkillRootLoader/快照缓存/隐式调用检测/mentions/接口资产策略）；计划模式 = `collaboration-mode-templates` crate 的 PLAN/DEFAULT 模板常量 | 独立 crates | `oss/codex/codex-rs/skills/src/lib.rs:1`（re-exports）、`oss/codex/codex-rs/skills/src/loading.rs:1`、`oss/codex/codex-rs/collaboration-mode-templates/src/lib.rs:1` |
| kimi-code | 技能是 feature 域（catalog/session/workspace 三级 + prompt.ts）；计划模式是 feature/plan（多份注入 md：full/sparse/reentry/inline 变体 + `planModeInjection.ts`） | 内核 feature 内 | `oss/kimi-code/packages/agent-core-v2/src/features/skill/skillService.ts:1`、`oss/kimi-code/packages/agent-core-v2/src/features/plan/injection/planModeInjection.ts:1` |
| qwen-code | 技能内建 `skills/bundled/` + skill-activation/curator（含回滚/重读测试）；提示词 registry 化；计划模式 = enterPlanMode/exitPlanMode 工具 + entry/shell 两条策略 | 编进 core | `oss/qwen-code/packages/core/src/skills/bundled/`（目录）、`oss/qwen-code/packages/core/src/skills/skill-activation.ts:1`、`oss/qwen-code/packages/core/src/prompts/prompt-registry.ts:1`、`oss/qwen-code/packages/core/src/tools/enterPlanMode.ts:1`、`oss/qwen-code/packages/core/src/core/plan-mode-entry-policy.ts:1` |
| opencode | 技能 = core/skill.ts（SkillV2，带 discovery/目录源/URL 源/嵌入源 + 权限联动）；计划模式 = agent 级配置（plan_enter/plan_exit deny→allow + 独立 plan agent + plans 路径白名单） | core 内 | `oss/opencode/packages/core/src/skill.ts:1`、`oss/opencode/packages/core/src/skill/discovery.ts:1`、`oss/opencode/packages/opencode/src/agent/agent.ts:127`、`:156` |
| pi-desktop | 技能作为插件贡献面：`contributes.skills`（路径数组）+ 装载期路径校验；内置工作面板等同第三方通道 | plugin-sdk 契约 + 插件 | `oss/pi-desktop/packages/plugin-sdk/src/index.ts:150`、`:1781`、`:1784` |
| **我方** | 提示词模板：目录加载（`.zcode/prompts` / `.aegent/prompts`，128KB 上限 + frontmatter 校验 + 诊断）；技能：`.zcode/skills` 的 `SKILL.md`（frontmatter 解析 + 调用格式化 + 根目录枚举）；计划模式：plan_enter/plan_exit 双工具 + 流重建 + 退出批准（opencode 同款语义） | **全部外置 `src/ext-builtin/prompt-defaults/`；核内只留装配点** | `src/kernel/prompts.ts:22`、`:167`、`:250`、`src/kernel/skills.ts:27`、`:201`、`src/kernel/plan-mode.ts:23`、`src/kernel/plan-mode.ts:6` |

### 8.3 差异 / 优势 / 差距

- **优势（提示词模板是"可加载资产"而非硬编码）**：我方 prompts 是带 frontmatter 校验 + 大小上限 + 诊断的
  目录加载（`prompts.ts:167`），qwen 是 registry、codex 是 crate 常量、kimi 是 md 注入——我方与 pi 的
  `BuildSystemPromptOptions` 同级，但多了资产校验面。
- **优势（计划模式有"流重建恢复"）**：`planModeFromEvents` 按流重建 + 退出需批准（`plan-mode.ts:9-14`），
  opencode 的 plan agent 只有配置面、无重建；kimi 的注入 md 也无重建语义。
- **差距（技能能力弱于 qwen/codex）**：qwen 有 skill curator（回滚/重读）、codex 有隐式调用检测 + mentions +
  快照缓存（`skills/src/lib.rs:1` re-exports 含 `ImplicitSkillLookup`）；我方只有 frontmatter 解析 + 调用格式化
  （`skills.ts:64/87`），无隐式触发/预算裁剪的独立实现（zcode 有 `buildSkillsContent` 预算）。
- **差距（计划模式与权限的耦合）**：zcode 把 plan 转换权限收进 permission 管线（`plan-mode-policy.ts:19`，
  进入 allow/退出 deny 都有 ruleId），qwen 有 entry/shell 两策略；我方 `plan-mode.ts` 是状态服务，
  消费在 `src/policy/plan-guard.ts`——面在但散，且重构后策略族仍留 policy 域（W13 顺延）。
- **差距（技能供应面单一）**：pi-desktop 允许插件贡献 skills（`plugin-sdk/index.ts:150`）、opencode 支持
  目录/URL/嵌入三源（`skill.ts:1` 的 Source 联合）；我方技能只从工作区目录加载（`skills.ts:201`），
  无插件/远程源——属 W15 能力面缺口。

---

## 附：本组未覆盖 / 待补

- 本报告不覆盖路由 A/B 未要求的功能面（如压缩引擎、工具调度细节、子代理引擎），它们分别属第 1/2 组的功能清单。
- 本次已逐行复核的"路 B 引用锚点"：zcode `turn-loop.ts:43`、zcode `runtime/command-queue.ts:10/121`、
  codex `parallel.rs:141/203`、opencode `llm.ts:141`、qwen `coreToolScheduler.ts:1676/1636`、
  pi-desktop `plugin-sdk/index.ts:1114/1376`。
- 仍标 `【未验证】` 的少数点：codex `coreToolScheduler.ts:1777`（TTL）、pi `agent/src/types.ts:33`
  （loop 配置字段行）、pi-desktop 全局+会话双层配置的具体文件（§4.2）。
- `src/kernel/thinking-set.ts`：路 B §7 #30 引用的文件当前不存在；思考档现落点为
  `src/kernel/loop.ts:665-676`（`deps.thinkingOverrideForTurn`）。
- 我方锚点行号凡标"引自路 B"者，本次抽查未逐条复核（`src/kernel/loop.ts` 的 cancel/watchdog 私有方法行号），
  实施时以重构后 `primitives/loop/{loop,guards,watchdog}.ts` 为准。
