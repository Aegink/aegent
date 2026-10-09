# 最优实践评估·第 3 组：模型·审批·进程·交互

> 口径：参考仓 `oss/<name>/...:line`（2026-10-09 快照）；我方用重构后 `src/core/...` 或现路径 `src/kernel/...`。
> 本报告在 `docs/20261010_内核功能对照_重构后.md` §16~§23 逐仓对照的基础上，**裁定每个功能"抄谁、抄什么、不抄谁、接到哪"**。
> 所有行号已用 Read/Grep 核实；未核实标 `【未验证】`。只读调研，未改 `oss/` 与 `src/`。
> 一处勘误：对照文档 §21 称 pi-desktop 权限闭集 48 项，实测 `PLUGIN_PERMISSIONS` 为 **44 项**（`oss/pi-desktop/packages/plugin-sdk/src/index.ts:1403-1455`）。

---

## §16 模型适配层

**裁定表**

| 项 | 结论 |
|---|---|
| 最优范式来源 | pi `packages/ai`：单方法 `StreamFunction` 契约 + 思考档声明式映射 + 重试是 provider 选项 |
| 抄什么 | ① provider 画像里的思考档声明表（`thinkingLevelMap` + `samplingParamsByThinkingLevel`）；② `maxRetryDelayMs` 的"服务端要长等待即失败上抛"语义 |
| 不抄谁 | 不抄 opencode 三层（Definition/protocols/providers）、codex 双 crate、qwen 编进 core、zcode 独立包（W8 已裁决不采用） |

**最优设计细节**

- pi 的 `StreamFunction` 契约（`oss/pi/packages/ai/src/types.ts:390`）与我方 `ModelProvider.streamChat` 同级——**接口面同样最薄**，说明我方抽象已是第一梯队，无需再"抄接口"。
- 真正的差距在**思考档的表达**：pi 把思考档做成 provider 画像上的声明式数据 `SamplingParamsByThinkingLevel = Partial<Record<ModelThinkingLevel, SamplingParams>>`（`types.ts:134`）+ `thinkingLevelMap`（`types.ts:846`）+ `samplingParamsByThinkingLevel`（`types.ts:854`），并用 `ThinkingBudgets{minimal/low/medium/high}`（`types.ts:135-140`）给 token 型 provider 配预算；我方思考档只在 turn 启动注入 override（`src/kernel/loop.ts:665` `deps.thinkingOverrideForTurn`），**没有 per-provider 的声明表**。
- 重试上 pi 把 `maxRetries`/`maxRetryDelayMs`（`types.ts:189-205`）作为 provider 选项：**服务端请求的等待超过上限就立即失败上抛**，让上层可见重试——比我方"流产出后不重试"多一档可观测的退避上限语义（`src/models/retry.ts:98-102` 只认 status 枚举 + Retry-After）。
- 四条权衡：能力上补齐思考档声明；轻（只加两个可选字段，provider 画像已有）；可替换（provider 画像本就是数据）；安全/正确性（重试上限防无限挂起）。

**接入我们内核**

- 落 `src/core/contracts/models.ts`（批 2 契约下沉）：给 `ModelIdentity`/provider 画像加可选 `thinkingLevelMap?: Partial<Record<ThinkingLevel, string>>` 与 `samplingParamsByThinkingLevel?`；`src/models/provider.ts` 的 wire 实现域负责填充。
- 重试：`src/models/retry.ts` 增 `maxRetryDelayMs`，保留"已产出流不重试"不变量（`src/models/retry.ts:16-19` 语义）。
- 对齐：批 2（只加类型不新增行为）；实现域随 A8/EP-11 可选外置。

**成本与风险**

- 成本低（两字段 + 一个上限）。风险：思考档声明表与现有 turn 注入 override 并存，需明确优先级（建议 turn 注入 > provider 画像默认）。前置：无。

**为什么不选别家**

- opencode：`Definition`/`ModelFactory`（`oss/opencode/packages/llm/src/provider.ts:11/18`）+ protocols + providers 三层，概念比 pi 多一层。
- codex：`models-manager` + `model-provider-info` 双 crate（`manager.rs:287/298`、`capabilities.rs:1`），编译期边界重。
- qwen：`contentGenerator` 编进 core 无包边界（`contentGenerator.ts:105`）。
- kimi-code：`llm-adapter/` 域内目录 + 独立 `kosong` 包两份（`provider.ts:41`、`kosong/src/provider.ts:1`），重复。
- zcode：provider 独立成包（`registry.ts:1`），W8 已裁决"不抽包"。
- pi-desktop：不自研 wire（上游 pi-ai），无自有可抄物。

---

## §17 审批与权限

**裁定表**

| 项 | 结论 |
|---|---|
| 最优范式来源 | zcode：单串决策 + hook/broker 竞速收口 + 规则持久化写回 + 工具级审批元数据；规则族丰富度参照 qwen |
| 抄什么 | ① 竞速收口语义（broker 先启动同步注册应答、先到者胜、先兑现后 abort 败者）；② 批准写回项目规则；③ 工具级 `needsApproval/riskLevel/prepareApproval`（只可收窄） |
| 不抄谁 | 不抄 pi（内核零审批）、codex 三出口+缓存键（重）、opencode 单模块（无竞速/写回）、kimi 决策枚举（无写回）、pi-desktop broker（无工具元数据） |

**最优设计细节**

- 我方决策面已是全表最厚（四层链 `POLICY_LAYERS` `src/policy/chain.ts:28` + 6 道硬闸 + 危险库/judge/项目信任 + fail-closed `chain.ts:20-23`），所以本节是**补两块，不是换范式**。
- **竞速**：zcode `racePermissionResponders`（`oss/zcode/apps/zcode-cli/packages/core/src/tool/executor/permission-responder-race.ts:38`）的关键不是"赛跑"，而是收口纪律——broker 先启动、`requestPermission` 内**同步注册应答 deferred**，保证确认窗一可见用户点击就有归宿，不给 hook 独占窗口；胜者**先兑现结果再 abort 败者**（注释 `:47-52`），因为"挂死的就是败者本身"。这解决我方单 broker 出口在 hook 慢/挂时的等待问题。
- **写回**：zcode `persistProjectPermissionUpdates`（`permission-flow.ts:361`）把批准落回项目规则；qwen 也把规则分 `system/user/workspace/session` 四 scope（`oss/qwen-code/packages/core/src/permissions/types.ts:20`，`permission-manager.ts:223`）——写回目标应限定 project 层。
- **工具元数据**：zcode 每个 `ToolEntry` 带 `riskLevel`/`needsApproval`（`oss/zcode/.../tool/types.ts:80-81`）与 `prepareApproval?: (input) => ToolApprovalGate`（`types.ts:357`，注释 `:350-356` 明确"只能收窄 allow→ask，绝不放宽"）。我方审批完全由 policy 按名分类（`src/policy/gate.ts:73-74`），工具无法声明自身风险。
- 四条权衡：能力（补齐挂死韧性 + 持久化 + 工具声明）；轻（竞速只在既有 broker 旁加一个 hook 出口，不新增层）；可替换（写回通道独立）；安全（"只可收窄"+ 项目层限定 + 链底无人应答抛错保持）。

**接入我们内核**

- W13（重构后独立批次，安全评审）。内核留 `src/core/skeleton/chain.ts` + `contracts/policy.ts` 端口不变；新增 `ApprovalResponderPort`（第二个出口形状，竞速用）。
- 写回通道落 `src/policy/rule-loader.ts` 的写侧对偶（只写 project 层、原子写、schema 校验）。
- 工具元数据落批 3 W5 `primitives/tools/registry.ts` 的 ToolDef 扩展位。前置：W5（B1 契约补元数据）。

**成本与风险**

- 成本中。风险：竞速引入"双出口"复杂度，必须保持链底无人应答抛错与 fail-closed；写回有越权/破坏用户文件风险，需限层 + 原子 + 校验。

**为什么不选别家**

- pi：内核零审批，只给 `beforeToolCall` 钩子（`oss/pi/packages/agent/src/types.ts:62`），无可抄。
- codex：`approvals.rs` 三出口 reviewer/guardian/user + 审批缓存键（`approvals.rs:65/439/512`），Rust 专属且重。
- opencode：`PermissionV2.evaluate` 单模块（`oss/opencode/packages/core/src/permission.ts:76`），无竞速无写回。
- kimi-code：`approval.ts` 只定义决策枚举形状（`approval.ts:3/5`），无写回。
- qwen：`PermissionManager` 单管道四 scope + auto 分类器（`permission-manager.ts:312`），规则族可比但无竞速/无工具元数据。
- pi-desktop：broker 在 `agent-host`（`approvals.ts:1`），无写回、无工具级声明。

---

## §18 进程模型

**裁定表**

| 项 | 结论 |
|---|---|
| 最优范式来源 | 保留我方"1 会话 1 child"；吸收 zcode 的 stdio 纪律 + 握手、pi-desktop 的 stderr 尾部归因 |
| 抄什么 | ① 入口层"console 全重定向 stderr"纪律；② hello/hello-ack 握手；③ sidecar stderr 尾 40 行退出归因 + supervisor 重启 |
| 不抄谁 | 不抄 pi/opencode/kimi/codex 的多路复用服务端（改架构、与隔离目标冲突）、qwen managed-runtime（无会话绑定） |

**最优设计细节**

- 我方"1 会话 1 child"是**全表唯一把会话↔进程一一绑定钉在内核**的做法（`src/kernel/agent-process.ts:13` 冷启动纪律 Q16 注释；`agent-protocol.ts:369` `MAX_LINE_BYTES=4MB`），换来崩溃隔离 + 冷启动纪律，属已接受设计，**应保留**。
- zcode 的 stdio 纪律更彻底：不只把 logger 走 stderr，而是在**入口层统一改写** `console.log/info/warn/debug = console.error`（`oss/zcode/packages/server/src/entry-stdio.ts:14-31`，注释明确"普通文本进 stdout 会污染协议流，表现成 RPC 一直 pending"）。我方靠 logger 单出口，但第三方库/依赖的 `console.log` 仍可能污染——这是可抄的**防线**。
- zcode 还有 hello/hello-ack 握手（`entry-stdio.ts:2` 导入 `helloAckMessageSchema`，`:40` "Phase 1: Send hello message"）与进程生命周期注册（`stdio-lifecycle.ts`）；我方已规划 EP-9 `PROTOCOL_VERSION`，zcode 是唯一现成实现参考。
- pi-desktop 的退出归因：`SIDECAR_STDERR_TAIL_LINES = 40`（`oss/pi-desktop/packages/host-runtime/src/agent-sidecar.ts:6-8`），环形缓冲最后 40 行 stderr（`:193-195`），退出时把快照附到 exit info（`:232-235` 注释"the dying process emits no [more]"）——**不依赖子进程死前输出**。我方 child 退出归因属 `src/runtime/` 装配面（批 5），内核无此机制。
- 四条权衡：能力（补退出可诊断 + 协议防污染 + 版本协商）；轻（环形缓冲 + 入口重定向，几行）；可替换（归因/重启在 runtime 装配面）；正确性（握手失败 fail-closed）。

**接入我们内核**

- 批 5 `src/runtime/` 装配面：`primitives/process/child.ts` 加 stderr 尾部环形缓冲；子进程入口 `agent-child.ts` 加 console 重定向；`core/skeleton/protocol.ts` EP-9 加握手协商。
- 多客户端 attach（pi `SessionRouter.attachClient` `oss/pi/packages/server/src/session-router.ts:60`）**暂不做**——协议需加 attach 语义，属未来 EP。

**成本与风险**

- 成本低-中。风险：重定向 console 可能吞掉第三方库 stdout 诊断（需保留 `process.stdout.write` 的 RPC 专用通道）；握手引入版本不匹配路径，须 fail-closed。前置：EP-9（握手）。

**为什么不选别家**

- pi：多会话 `SessionRouter` + unix socket（`session-router.ts:34`），改架构。
- opencode：HTTP+WS 多路复用 server/client 分离（`serve.ts:1`/`tui.ts:1`），重。
- kimi-code：`kap-server` + `klient` + `acp-server` 多包（`start.ts:99`），重。
- codex：`app-server` + 协议 crate + `exec-server` 三件（`app-server-protocol/src/rpc.rs:1`），重。
- qwen：`ipc/` UDS 多进程互信 + `managed-runtime` 每次 run spawn（`managed-child-run-supervisor.ts:129`），无会话绑定。

---

## §19 会话配置与热刷新

**裁定表**

| 项 | 结论 |
|---|---|
| 最优范式来源 | codex（白名单热刷 `refresh_runtime_config`）我方已同语义；**补** kimi 的行级写回 + codex 的层栈形状 |
| 抄什么 | ① kimi `tomlWriteback` 行级编辑写回（保留格式/注释）；② codex `ConfigLayerStack` 层栈按序合并 |
| 不抄谁 | 不抄 zcode overlay（provider 包内另一套）、qwen 单 config（无写回）、opencode md 声明（无写回） |

**最优设计细节**

- 我方"热刷新白名单 + 静态键整包类型化拒绝"（`src/kernel/session-config.ts:86-96` `REFRESHABLE_CONFIG_KEYS`、`:109` `StaticConfigImmutableError`）已与 codex `resolve_runtime_refresh` 逐字段判可刷性（`oss/codex/codex-rs/core/src/session/config_refresh.rs:31/49/56`）同语义，且提炼成闭集 + 类型化错误，**比 codex 更小**，无需换。
- 缺口是**写回**：kimi `tomlWriteback.ts` 用 `LineEdit`（`replace{startLine,endLine,text}` / `insert{afterLine,text}`）+ `sectionDiff`（`oss/kimi-code/.../app/config/sectionDiff.ts:5` `diffRecords` added/removed/changed）**只改动的行、保留原文件其余部分与注释**——比我方"进程内 store 只读加载"多一条持久化通道。
- 层栈形状：codex `ConfigLayer`/`ConfigLayerStack`（`config_layer_source.rs:71`、`cloud_config_layers.rs:117`）按栈序合并企业云层 + 本地层；我方 `session/settings.ts` 是 2,081 行单文件大表（arch warn），分层只有"会话 store vs 构造捕获"。
- 四条权衡：能力（补写回 + 分层）；轻（行级写回可只做 JSON 子集，层栈批 2 只放类型）；可替换（写回独立模块）；正确性（原子写 + schema 校验 + 注释保留）。

**接入我们内核**

- 写回与 W13"规则持久化写回"**同源**，一并做：落 `src/kernel/session-config.ts` 写侧或独立 `writeback.ts`。
- 层栈形状批 2 只放类型（`contracts/policy.ts` 或 settings 域），批 7 后再接线。

**成本与风险**

- 成本中（TOML 行级写回实现量大；若先只做 JSON 配置可大幅简化）。风险：写回破坏用户文件/注释；并发写需锁。前置：无（独立）。

**为什么不选别家**

- zcode：`ConfigOverlay` "缺省继承/递归覆盖/整体替换"（`oss/zcode/packages/provider/src/config-overlay.ts:19/26`），语义绑在 provider 包内，另一套抽象。
- qwen：`config/config.ts` 单点 + `approval-modes.json` 模式档数据化（`config/approval-mode.ts:1`），无写回。
- opencode：`ConfigMarkdown`（md 里声明 agent/skill，`config/markdown.ts:1`），无写回。
- pi：单文件 config，agent 内核不持配置仓库（`coding-agent/src/config.ts:1`），无写回。
- pi-desktop：全局+会话双层权限/模型设置【未验证具体文件】，无写回。

---

## §20 交互控制

**裁定表**

| 项 | 结论 |
|---|---|
| 最优范式来源 | 我方护栏为底；**补** zcode 三档优先级队列 + kimi 定向 steer |
| 抄什么 | ① zcode `now/next/later` 三档优先级 + `dequeueNextBatch`/`getByMaxPriority`；② kimi `MachineEngine.steer(id)` 定向 steer |
| 不抄谁 | 不抄 pi `QueueMode`（只定节奏无上限，我方已有且更强）、codex CancellationToken 树（Rust 专属）、pi-desktop approval lifetime（属审批非队列） |

**最优设计细节**

- 我方护栏种类全表最多（maxSteps/双轴预算/mutation 预算/turn 级看门狗/输出触顶/流恢复），`QueueFullError` 类型化拒绝（`src/kernel/queue.ts:60-64`）+ 有界缺省 64（`queue.ts:74-80` 注释引 pi-desktop ADR 0041"the queue is finite"），**应保留**。
- 缺"优先级维度"：zcode `RuntimeCommandPriority = "now" | "next" | "later"` + `RUNTIME_COMMAND_PRIORITY_ORDER{now:0,next:1,later:2}` + `dequeueNextBatch()`/`getByMaxPriority(maxPriority)`（`oss/zcode/.../runtime/command-queue.ts:10/121-125/130-134`）。我方 FIFO 无优先级——紧急打断只能 cancel 不能插队。
- 缺"定向 steer"：kimi `MachineEngine.steer(id: string | readonly string[])`（`oss/kimi-code/.../agent/loop/machine/engine.ts:177`，实现 `:509-511` 发 `input.steer` 事件）+ `steerSignal`（`:131`）；我方 steer 是队列级（`queue.ts:108`），无法定向到具体 prompt id。
- 四条权衡：能力（补优先级 + 定向）；轻（优先级只是一个字段 + 比较器）；可替换（队列是内核 skeleton）；正确性（保留 `QueueFullError` fail-closed，优先级不能绕过上限）。

**接入我们内核**

- 队列优先级：`src/core/skeleton/queue.ts` 加 `priority` 字段 + 三档常量 + `dequeueNextBatch`/`getByMaxPriority`；可随批 1/3 下沉时加（需补老化/配额测试防饿死）。
- 定向 steer：属 W9（子代理 resume + `task_send`）。

**成本与风险**

- 成本低。风险：优先级可能饿死 `later`（需老化或配额）；前置：无（队列）/ W9（定向 steer）。

**为什么不选别家**

- pi：`QueueMode` 枚举只控制一次排空几条（`oss/pi/packages/agent/src/types.ts:55`），无上限无优先级。
- codex：`CancellationToken` 树 + `AbortOnDropHandle`（`parallel.rs:141/203`），Rust 专属，我方协作式取消等价。
- pi-desktop：`localApprovalLifetimeMs` 是审批寿命（`agent-host.ts:190/212`），非队列语义。
- opencode：`promoteSteers`/`promoteNextQueued`（`llm.ts:190/192`）是队列提升，无优先级分档。

---

## §21 插件 SDK 能力面

**裁定表**

| 项 | 结论 |
|---|---|
| 最优范式来源 | **组合**：pi-desktop 的权限闭集形状（44 项 flat + 贡献↔权限绑定校验）+ dsh 的 cordis `inject` 装配即数据 |
| 抄什么 | ① 权限 = flat 字符串闭集 + `contributes` 声明与权限一一绑定、装载期校验；② `inject: [服务名]` 数据化依赖声明（服务变化自动卸载/重跑）；③ `contributes.services` 常驻 + `bus` 声明式总线（限流/上限参数化） |
| 不抄谁 | 不抄 opencode（零权限零隔离）、pi（能力面绑 coding-agent）、codex（编译期 crate）、zcode（无运行期插件 SDK） |

**最优设计细节**

- **权限闭集形状**（pi-desktop）：`PLUGIN_PERMISSIONS` 是 flat 字符串数组（实测 **44 项**，`oss/pi-desktop/packages/plugin-sdk/src/index.ts:1403-1455`），`contributes` 每类贡献与权限**绑定校验**——如 `contributes.providers` 必须带 `provider.register`、`agentExtensions` 必须带 `agent.extension`（`index.ts:1536-1581` `validateManifest` 内）。我方 `PLUGIN_RUNTIME_CAPABILITIES` 只有 3 项（`src/kernel/plugin-loader.ts:47`）且无"贡献↔权限绑定"校验（`validateManifest` 只查能力是否在闭集，`plugin-loader.ts:130`）。
- **装配即数据**（dsh cordis）：插件是纯对象 `{ name, inject: ['agents','sessions','workspaceRegistry'], apply(ctx) }`（`oss/deepseek-harness/packages/api/session-controller/src/archived-session-gate.ts:24-32`），`ctx.inject(deps, cb)` 在所需服务可用后运行、服务变化时**自动卸载并重跑**（`docs/cordis-api/registry.zh.md:10-30`）。这比我方"onActivate 拿宿主 token 三方法"更轻也更可替换——插件不持 token，只声明依赖。
- **常驻 + 总线**（pi-desktop）：`contributes.services`（`index.ts:174`，`host.services.register` 只做本地登记、由宿主决定 start，`index.ts:1311-1320`）+ `bus.publish/subscribe`（`:1320-1327`）+ 权限 `background.service`/`bus.publish`/`bus.subscribe`（`:1446-1449`）。我方无常驻服务、无总线（EP-12 缺口）。
- 四条权衡：能力（3→可扩展）；轻（dsh 的 inject 是数据，不加宿主方法面；比 pi-desktop ~60 方法 token 轻）；可替换（服务名注入即替换点）；安全（服务名仍闭集 + 贡献↔权限绑定校验，避免 pi-desktop "声明即授予"的边界）。

**接入我们内核**

- W15（批 4 铺路 + 重构后独立批次）。内核 `src/core/contracts/plugins.ts`：把 `PluginCapabilities` 三方法 token（`src/mcp/plugin-sdk.ts:80-90`）改为"声明 `inject: 服务名[]` + 贡献↔权限绑定校验"（EP-11）；服务名闭集 + 权限闭集（借 pi-desktop 形状）。
- 常驻服务 + 总线落 `ext-builtin/plugin-runtime`（EP-12）。前置：EP-10 六个 `register*` 就绪（否则无可注入服务）。

**成本与风险**

- 成本高（最大待补面）。风险：`inject` 开放式与权限闭集存在张力——建议折中"服务名闭集 + inject 数据化"，服务名仍受 manifest 校验；前置：EP-10。

**为什么不选别家**

- opencode：`Plugin = (input, options) => Promise<Hooks>`，`PluginInput` 直接给完整 SDK client + Bun shell（`oss/opencode/packages/plugin/src/index.ts:62/74`），零权限零隔离。
- pi：扩展与内置同数组、`replaceable: true`（`oss/pi/packages/coding-agent/src/core/extensions/index.ts:6-13`），能力面绑在 coding-agent，非内核。
- codex：编译期 crate（`plugin/src/manifest.rs:1`、`core-plugins` 93 文件），无法运行期装载。
- zcode：插件=静态资源包，唯一执行通道是 hooks/MCP（`contracts/src/plugins/index.ts:141`），无运行期 SDK。
- kimi-code：`app/plugin/` 按 app service 注入（`app/plugin/` 目录），无权限闭集。

---

## §22 日志与诊断

**裁定表**

| 项 | 结论 |
|---|---|
| 最优范式来源 | pi `packages/telemetry`（三实现同接口的可替换 sink 形状）+ zcode `traceContextToLogContext`（trace 关联） |
| 抄什么 | ① `TelemetryContext`/`TelemetrySpan` 最小 span 契约 + noop 缺省 + memory 测试实现；② logger 加可选 trace/span 字段 |
| 不抄谁 | 不抄 codex otel crate（重）、qwen 编进 core telemetry（含 lag 指标，重）、opencode Effect+动态 import OTLP（依赖 Effect）、pi-desktop 审计日志（面向插件审计） |

**最优设计细节**

- 我方 `skeleton/logger.ts` 的"保留清理写路径顺带做"（`cleanExpiredLogs` `src/kernel/logger.ts:115/162`）+ "双 redact 缺省开"（`redactSecrets` `:92`、`redactUserContent` 缺省 true `:202/215`）已是参考仓少见的内建能力，**保留**。
- 缺口是 **OTLP/span 导出通道**。pi 的范式最轻：`TelemetryContext.startSpan(options, cb)` + `TelemetrySpan`（`oss/pi/packages/ai` 引、定义在 `oss/pi/packages/telemetry/src/index.ts:10-22`），**同一接口三实现**——`NOOP_TELEMETRY_CONTEXT`（`noop.ts:1`，缺省）、`InMemoryTelemetryContext`（`memory.ts`，测试/内存），真实 exporter 可替换；快照里没有真实 exporter，正说明它是**纯可替换端口**。
- trace 关联：zcode `formatLogPrefix(source, pid)`（`oss/zcode/packages/shared/src/log-format.ts:29`）统一前缀，并在工具权限日志带 `traceContextToLogContext(...)`（`hooks/runner.ts:140/235/318`、`memory/directory.ts:2`）；我方 logger 无内建 trace/span 字段（事件流承担部分）。
- 四条权衡：能力（补导出 + 关联）；轻（端口 + 可选字段，OTLP 实现外置插件）；可替换（三实现同接口正是"可替换"范式）；正确性（noop 缺省 = 零行为变化，脱敏保持）。

**接入我们内核**

- 内核 `src/core/skeleton/logger.ts` 加可选 `traceContext` 字段（对齐 `formatLogPrefix` 形状）；批 2 在 `contracts/` 放 `TelemetrySink` 端口（类型 only）。
- OTLP 实现落插件（EP-11），配合批 8 删 `raw-chunk-log.ts` 时保留"可插诊断口"，确保不降低可诊断性。

**成本与风险**

- 成本低（端口 + 字段）。风险：OTLP 若放内核会违背"轻"，**必须外置**；trace 字段需与事件流去重。前置：无（端口）/ EP-11（OTLP 实现）。

**为什么不选别家**

- codex：`otel` crate 全栈（OTLP exporter/trace_context/metrics）+ `diagnostics` crate（`otlp.rs:1`），编译期重。
- qwen：telemetry 编进 core，含 event-loop-lag 指标 + daemon tracing + file-exporters（`telemetry/config.ts:1`、`event-loop-lag-metrics.ts:1`），重。
- opencode：Effect 原生 logger + 动态 `import("@effect/opentelemetry/NodeSdk")`（`observability/otlp.ts:50-60`），依赖 Effect 运行时。
- pi-desktop：`event-log.ts` + 插件审计（每个 `pi.*` 过 allowlist→permission→audit，ADR 0008），面向插件审计，非通用诊断。
- zcode：log-format 是工具函数 + 调用方注入（`log-format.ts:29`），可抄的只有 trace 前缀这一小块（已采纳）。

---

## §23 技能与提示词

**裁定表**

| 项 | 结论 |
|---|---|
| 最优范式来源 | zcode（`buildSkillsContent` 预算裁剪 + `plan-mode-policy` 收进权限管线）；能力面参照 codex 隐式调用 |
| 抄什么 | ① 技能预算裁剪 + names-only 降级；② plan 进入/退出作为带 ruleId 的权限规则；③（可选）codex 隐式调用检测/mentions |
| 不抄谁 | 不抄 kimi 多份注入 md（重）、opencode 三源+plan agent（无重建，源扩展属 W15）、qwen curator（状态机重）、codex skills crate（编译期+快照缓存重） |

**最优设计细节**

- 我方提示词模板是"可加载资产"（frontmatter 校验 + 128KB 上限 + 诊断 `src/kernel/prompts.ts:167`），且计划模式有**流重建恢复**（`planModeFromEvents` `src/kernel/plan-mode.ts:55`）——这是 opencode/kimi 都没有的，保留。
- 缺口 1 **技能预算裁剪**：zcode `buildSkillsContent(skills, budget)`（`oss/zcode/.../context/sections/skills.ts:39`）先按显示名排序、超预算则**降级为 names-only**（`:53-60`），描述按 `MAX_DESCRIPTION_CHARS` 截断（`:64-72`）。我方 `skills.ts` 只有 frontmatter 解析 + 调用格式化（`src/kernel/skills.ts:27/201`），无预算裁剪。
- 缺口 2 **plan 与权限收口**：zcode `resolvePlanModeTransitionPermission`（`oss/zcode/.../permission/plan-mode-policy.ts:19`）把进入映射为 `allow`（ruleId `tool.plan.enter`）、非法退出映射为 `deny`（ruleId `mode.plan.exitOnly`），**plan 转换是权限管线的一等规则**；我方 `plan-mode.ts` 是状态服务、消费在 `src/policy/plan-guard.ts`，面在但散。
- 能力面参照：codex `skills` crate 的 `ImplicitSkillLookup`/`detect_implicit_skill_invocation_for_command`/mentions（`oss/codex/codex-rs/skills/src/lib.rs:1-34` re-exports）——技能隐式触发与 @mention；qwen `skill-curator`（回滚/重读，`oss/qwen-code/.../skills/skill-curator.ts`）。二者均重，**只作为 W15 可选**。
- 四条权衡：能力（补预算 + plan 收口）；轻（预算裁剪十几行；plan 收口复用既有策略管线）；可替换（技能内容已外置 `prompt-defaults`）；正确性（plan 收口保留"退出需批准"不变量）。

**接入我们内核**

- 预算裁剪：批 4 外置的 `src/ext-builtin/prompt-defaults/skills.ts` 加 `buildSkillsContent(skills, budget)` + names-only 降级。
- plan 收口：并入 W13（`src/policy/` 加 `plan-mode-policy` 规则，进入 allow / 退出 deny 带 ruleId）。
- 技能隐式触发/mentions/远程源：W15（可选用 codex 形状）。

**成本与风险**

- 成本低（预算裁剪）/ 中（plan 收口）。风险：预算裁剪改变注入提示内容，需回归测试；plan 收口须保持 `planModeFromEvents` 流重建 + 退出批准语义不丢。前置：W13（plan 收口）。

**为什么不选别家**

- kimi-code：plan 是多份注入 md（full/sparse/reentry/inline，`features/plan/injection/planModeInjection.ts:1`），重且无重建。
- opencode：`SkillV2` 支持目录/URL/嵌入三源（`core/src/skill.ts:16-22`），但 plan agent 只有配置面、无重建（`agent/agent.ts:127/156`）。
- qwen-code：`skill-curator` 带状态机/锁/回滚/重读（`skills/skill-curator.ts`），对内核过重；prompt registry 可参考但非必需。
- codex：`skills` 独立 crate 编译期 + `SkillRootSnapshotCache` 快照缓存（`lib.rs`），重。
- pi-desktop：`contributes.skills` 路径数组（`plugin-sdk/index.ts:150`）已在我方 contributes 六类中，无新增。
- zcode：技能内容独立包 `bundled-skills` 值得对位（我方已外置），但预算裁剪与 plan 权限是本节真正可抄的两点。

---

## 附：未覆盖与勘误

- 8 个功能全部覆盖；§16 我方已近最优（抄点最小），§21 缺口最大（成本最高）。
- 勘误：pi-desktop 权限闭集实测 **44 项**（对照文档 §21 写 48）；`PluginHostApi`（`plugin-sdk/src/index.ts:1114`）是嵌套命名空间对象（app/themes/ui/fs/agent/session/services/bus/net…），方法数约 60+，与文档"~60 方法"一致。
- 仍标 `【未验证】`：pi `agent/src/types.ts:33` 的 loop 配置字段行；pi-desktop 全局+会话双层配置的具体文件。
- 我方锚点行号以现路径 `src/kernel|policy|models` 核实；实施时以重构后 `src/core/{skeleton,contracts,primitives}` 为准。
