# 功能对照·第 1 组：内核骨架与执行原语

> 锚点规则：参考仓为 `oss/<repo>/...:line`（相对 `F:\aegent`），我方为重构后路径 `src/core/...` 或现路径 `src/kernel/...`。
> 参考快照 2026-10-09（`oss/SOURCES.lock`）。pi-desktop 为 LGPL，只记行为与接口形状，不摘代码。
> 本组负责仓固定行序：**pi-desktop → zcode → deepseek-harness(dsh) → opencode → codex → pi → 我方**。
> 我方基线取自 `docs/20261010_内核重构总体方案.md`（§1.3 目录设计、§2 逐文件归属），非现状代码。
> 未逐行核实的锚点标 `【未验证】`；行数一律标注来源（实测 / 据路A、路B）。

---

## 功能 1：内核骨架与分层

**我们的重构后内核**：`src/core/`（≈11,200 行）物理分三层——`skeleton/`（0 骨架：事件/协议/链/队列/预算/准入/不变量）、`primitives/`（一 原语：loop / session 投影 / tools / process）、`contracts/`（端口与 wire 形状）。语义面 = **0 骨架 + 一 原语**，零跨域出边（架构检查硬失败）。装配与进程编排整体移出内核到 `src/runtime/`（assembly + agent-process + registrations），三个内置扩展包与 39 工具移出到 `src/ext-builtin/`、`plugins/tools-builtin/`。依据：`docs/20261010_内核重构总体方案.md` §1.3、§1.4、§2。

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 |
|---|---|---|---|
| pi-desktop | 内核是**上游别人的包**（`pi-ai`/`pi-agent-core`，ADR 0002）；本地只写无传输语义核 `agent-host`（准入/回合队列/审批/事件日志/快照）+ 无 Electron 运行时 `host-runtime`（HostProcess/AgentSidecar/RuntimeSupervisor/TurnPersistence） | 内核 = 上游两包；本地薄运行时=包 | `oss/pi-desktop/packages/agent-host/src/index.ts:1-6`；`oss/pi-desktop/packages/host-runtime/src/index.ts:1-20`；`oss/pi-desktop/docs/adr/0002-use-pi-agent-harness.md`；`oss/pi-desktop/docs/adr/0284-headless-runtime-boundary.md` |
| zcode | 执行层/管控层二分：`@zcode/core`（工具注册/调度/执行 + agent + context + compact + hooks + mcp + workflow）与 `@zcode/services`（session/storage/plugins/skills/git…）；core 的 dependencies 里没有 services | 内核=core 包（500 文件，实测 96,116 行非测试）；管控=services 包 | `oss/zcode/apps/zcode-cli/packages/core/src/index.ts:1-60`；`oss/zcode/packages/services/src/`（目录即清单） |
| dsh | **没有单一内核包**：`packages/core/*` 8 个子包（agent / agent-loop / session / system-prompt / tools / scope / agent-default-model / agent-tool-presentation），每个独立发布；`agent-loop` 自身就是 cordis 插件（Service + apply） | 内核=一组 Service 包；默认组合是数据（YAML） | `oss/deepseek-harness/packages/core/agent-loop/src/index.ts:341-342`；`oss/deepseek-harness/packages/core/tools/src/index.ts:1-3`；`oss/deepseek-harness/packages/bundle/base/cordis.patch.yml:1-6` |
| opencode | 判据="core 是引擎、app 是壳"：agent/session/tool/plugin/mcp/lsp/pty/permission/provider/skill/snapshot 全塞进 `packages/core/src`（317 文件非测试）；app 在 `packages/opencode/src` | 几乎不划边界（core 即内核） | `oss/opencode/packages/core/src/`（目录即清单）；`oss/opencode/packages/core/package.json:18-23`（exports 含 `"./*": "./src/*.ts"`，允许任意深导入） |
| codex | 判据="能抽成 crate 就抽"：工具原语已抽到 `codex-rs/tools`，扩展抽到 `codex-rs/ext/*`（15 个），但 `codex-rs/core` 仍 583 文件（据路A 250,171 行）；`core/Cargo.toml` 约 80 条 `codex-*` 依赖 | 内核=巨型 core crate；工具/扩展=crate | `oss/codex/codex-rs/core/src/`（目录即清单）；`oss/codex/codex-rs/tools/src/`；`oss/codex/codex-rs/ext/`；`grep -c "codex-" oss/codex/codex-rs/core/Cargo.toml` = 80 |
| pi | 把内核压到极限：`packages/agent` 仅 6 文件 **2,519 行**（实测），只有 agent 循环 + 事件类型 + StreamFn 契约 + 并行/队列模式；依赖只有 pi-ai + typebox；连 `/mcp`、codemode、tool-search 都是**与第三方同接口的内置扩展** | 内核=agent 包；其余全在 coding-agent 包 | `oss/pi/packages/agent/src/index.ts:1-5`；`wc -l oss/pi/packages/agent/src/*.ts` = 2519 |
| **我方（重构后）** | `src/core/` ≈11,200 行 = `skeleton/`（4,055）+ `primitives/`（6,844）+ `contracts/`（~550）；`src/ext-builtin/`（3,691，插件运行时/提示词/子代理）+ `plugins/tools-builtin/`（5,254，39 工具）+ `src/runtime/`（assembly+agent-process+registrations）全部核外 | 内核=core；其余=包/插件 | `docs/20261010_内核重构总体方案.md` §1.3:117-172；§1.4:177-208；§2.1-2.9:233-336 |

**差异 / 我方优势 / 我方差距**
- **我方是唯一"内核语义面可度量"的设计**：`skeleton/`=0、`primitives/`=一，目录名即语义层，验收可读（总体方案 §1.3:132-143、§9:480）。参考仓只有 zcode 的 core/services 二分与 pi 的 6 文件小包接近这个清晰度。
- **内核÷全仓占比我方 17%**，介于 pi（≈1.8%，但 pi 把功能全搬别的包）与 codex（core 单 crate 250K）之间；重构方案明确不追 pi 绝对行数，而是守"零跨域依赖"（总体方案 §1.5:210-224）。
- **装配外置这一点我方对齐 pi-desktop/dsh**：`src/runtime/registrations/` 承接 6 个 `register*`（总体方案 §1.4:201-207），dsh 用 YAML 达到同一效果（`cordis.patch.yml:1-6`）。
- **差距：我方仍是单包 `src/` 布局**，无 workspace 包边界；pi（14 包）、dsh（331 子包）、codex（127 crate）都有物理包边界。我方仅靠架构检查（运行期脚本）而非包解析强制。
- **差距：pi-desktop 的"上游内核 + 本地薄运行时"给了内核独立版本化能力**（`docs/adr/0002`），我方内核与产品同仓同版本，无法独立演进。

---

## 功能 2：依赖治理与边界

**我们的重构后内核**：`core` 从现 `managed:false` 升为 `managed:true` + `requires:[]` + `publicEntrypoints:["src/core/index.ts"]`，违规**硬失败**；依赖铁律单向 `core ← 各域 ← runtime ← host`。落地在 `architecture-policy.json` + `tools/architecture-check.mjs`（5 类规则，与 zcode 同源）。依据：总体方案 §1.1:90-96、§5:417-418、§9:479。

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 |
|---|---|---|---|
| pi-desktop | `scripts/check-architecture.mjs`：**文件大小棘轮 + facade 保护**（mainIndex≤1500、appStore≤1000、新 TS≤800、Rust≤1000），CI gate；方向靠 ADR 显式声明（`packages/*` 不得依赖 `apps/desktop`），无自动环检测 | 治理=脚本（仓根） | `oss/pi-desktop/scripts/check-architecture.mjs:20-35`；`oss/pi-desktop/docs/adr/0284-headless-runtime-boundary.md`；`oss/pi-desktop/docs/adr/0235-domain-facades-and-architecture-budgets.md` |
| zcode | `architecture-policy.yaml`：每模块 `managed` / `requires` 白名单 / `publicEntrypoints`（禁深导入）/ `layers+layerOrder` / `owner`；全局 `maxFileLines:400`、`maxContractLines:300`、`maxPublicMethods:12`、`forbidCycles:true`、`forbidDeepImports:true`、`managedOnly:true`；`verify:pre-push` 挂 `architecture:check --changed` | 治理=策略文件+脚本（与 core 同仓） | `oss/zcode/architecture-policy.yaml:1-66`；`oss/zcode/scripts/architecture/policy.mjs:64`；`oss/zcode/package.json:19,44` |
| dsh | `scripts/check-workspace-constraints.ts` + pnpm workspace 约束；依赖方向由 cordis `inject` 在**运行时**决定（服务可用性驱动），编译期不表达，无环检测 | 治理=脚本+包管理器 | `oss/deepseek-harness/scripts/check-workspace-constraints.ts`；`oss/deepseek-harness/pnpm-workspace.yaml:1-3` |
| opencode | **仅 `AGENTS.md` 文字规则**（Schema→Core/Protocol→Server；Client 不得依赖 Core/Server），无 gate；`package.json` 还开 `"./*"` 任意深导入 | 治理=文档（无强制） | `oss/opencode/AGENTS.md:3`；`oss/opencode/packages/core/package.json:23` |
| codex | 靠 Cargo 编译依赖：127 个 crate 目录的依赖图**编译期天然无环**；但 core 自身 583 文件无大小治理 | 治理=编译器 | `oss/codex/codex-rs/*/Cargo.toml`；`ls -d oss/codex/codex-rs/*/`（127） |
| pi | 治理最"经济"：`check-entry-graphs.mjs` 把**入口点当成本契约**（每入口最大文件数 + forbid 清单），`check` 串联 pinned-deps/runtime-deps/ts-imports/entry-graphs/tsc | 治理=脚本（仓根） | `oss/pi/scripts/check-entry-graphs.mjs:1-8`（"Entry points are cost contracts"）；`oss/pi/package.json:20-27` |
| **我方（重构后）** | `core` 硬约束（`managed:true, requires:[], publicEntrypoints`）；`maxFileLines` 对 core 生效（loop 拆分后达标）；`kernel` 过渡期保留 `requires:[]`；批 8 冻结 | 治理=策略文件+脚本（与 core 同仓，同 zcode 语义） | `docs/20261010_内核重构总体方案.md` §1.1:90-96；§5:417-418；`architecture-policy.json`（批 0 改） |

**差异 / 我方优势 / 我方差距**
- **我方与 zcode 同源且是唯一把"内核域"钉成硬约束的**：现 `kernel` 是依赖环上节点却 `managed:false`（只 warn）——路A §5.5 记当前 1 error/42 warning 与一条贯穿 13 域的环；重构后 `core.requires=[]` 硬失败，比 zcode 的逐模块 managed 更聚焦"内核零出边"。
- **zcode 的治理面比我方宽**：多出 `layers/layerOrder`、`owner`、`maxContractLines`、`maxPublicMethods`、`architecture:context <module>`（给 agent 读的上下文）。我方仅 5 类规则（总体方案 §5:418）。
- **pi 的"入口预算"思路我方没有**：pi 用"import 一个纯函数经过 barrel 会拉 37MB 模块图"量化扇出（`check-entry-graphs.mjs:6`），这是为 0 底座服务的治理；我方靠 `maxFileLines` + 深导入禁令，维度不同。
- **差距：opencode 的反面教材正是我方要避的**——`exports:"./*"` 让架构边界形同不存在；我方批 8 用 `forbidDeepImports` 激活深导入禁令（总体方案 §8:463）。
- **差距：codex 靠编译器强制无环，我方靠运行期脚本**；可选加强是给 `src/core/tsconfig.json` 做 project references 让"core 依赖别人"编译期报错，方案默认不做（总体方案 §5:420-422）。

---

## 功能 3：插件系统

**我们的重构后内核**：核内只留 `contracts/plugins.ts`（manifest 形状 + `PluginHostApi` 契约）与装配点；插件运行时（manifest/加载/贡献/兼容/脚手架，1,936 行）外置到 `src/ext-builtin/plugin-runtime/`，默认内置、可裁剪、可被第三方替换。现状 SDK 能力面只有 `subscribe` + `pluginSettings`（最窄宿主 token），loader 支持 inprocess/ws 双传输、never-fail 装配。依据：总体方案 §1.4:180-186、§2.7:311-324；路A §3。

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 |
|---|---|---|---|
| pi-desktop | 最完整的插件体系：**48 项权限闭集**（`PLUGIN_PERMISSIONS`）+ 15 类 contributes + `onLoad/onUnload/onProviderOAuth/onPanelInvoke/...` 生命周期；**进程级隔离**（每插件 `utilityProcess.fork`，最小 env）；每个 `pi.*` 调用过 `HOST_API_ALLOWLIST` → `assertPermission` → host service → audit；**热重载天花板**（批准时快照为上限，变宽即拒）；常驻服务 + 消息总线（ADR 0040） | 插件运行时=app 内 `electron/main`（LGPL，只学行为） | `oss/pi-desktop/packages/plugin-sdk/src/index.ts:1377-1378,1403`；`oss/pi-desktop/apps/desktop/electron/main/plugin-runtime.ts:511,1268-1271,2189,2299`；`oss/pi-desktop/docs/adr/0008-plugin-runtime-isolation-target.md`；`.../adr/0040-plugin-resident-services-and-message-bus.md` |
| zcode | 插件=**静态资源包**（无运行期 SDK/生命周期）：contracts 只声明 `hooks?` 形状；安装无审批，plugin hooks 恒放行；管理在 `services/src/plugins/` | 插件=声明式资源包（core 只认 contracts） | `oss/zcode/apps/zcode-cli/packages/contracts/src/plugins/index.ts:149,251`；`oss/zcode/packages/services/src/plugins/pluginManagementService.ts` |
| dsh | 插件=cordis Service，`inject` 声明即用；装载是 `cordis.patch.yml` 数据（517 行/94 insert，id 寻址、last-write-wins）；动态插件用 `DYNAMIC_TOOL` Symbol 打标 + `cloneJson` 跨 realm 深拷贝防伪造；`dsh-hmr` 默认热重载 | 插件=包（Service），装配=YAML | `oss/deepseek-harness/packages/bundle/base/cordis.patch.yml:1-25`；`oss/deepseek-harness/packages/extensions/cordis-host-runner/src/guard.ts:24,99,491` |
| opencode | 插件=函数 + Effect Scope：`Plugin = (input, options) => Promise<Hooks>`；`PluginInput` 直接把完整 SDK client + Bun shell 交给插件；**零权限声明、零隔离**；`Plugin.add` 用 Scope 管生命周期、`remove` 可卸载 | 插件=包（同进程，仅生命周期） | `oss/opencode/packages/plugin/src/index.ts:56-74,222`；`oss/opencode/packages/core/src/plugin.ts:43,85` |
| codex | "插件"=**编译期扩展 crate**（`codex-rs/ext/*` 15 个）+ 声明式资源包（`codex-rs/plugin` 的 `PluginManifest`）；运行期贡献面窄 | 插件=编译期 crate（须重编译） | `oss/codex/codex-rs/plugin/src/manifest.rs:8-17`；`oss/codex/codex-rs/ext/`（15 目录）；`oss/codex/codex-rs/core-plugins/src/` |
| pi | 内置扩展与第三方**同数组同接口**：`builtInExtensions` 每项可标 `replaceable:true`（第三方 MCP 扩展可"接管"内置 mcp）；jiti 动态加载单文件；无隔离、无热加载（重启加载） | 扩展=包（coding-agent 内） | `oss/pi/packages/coding-agent/src/extensions/index.ts:7-13`；`oss/pi/packages/coding-agent/src/core/extensions/jiti-loader.ts`；`.../extensions/runner.ts` |
| **我方（重构后）** | 核内只留 `contracts/plugins.ts`；运行时外置 `src/ext-builtin/plugin-runtime/`（manifest/contributes/compat/scaffold/loader）；默认内置可裁剪；SDK 现为 `subscribe`+`pluginSettings`（最窄） | 插件=包（`ext-builtin` 默认内置）；契约=核内 | `docs/20261010_内核重构总体方案.md` §1.4:180-186；§2.7:311-318；`src/mcp/plugin-sdk.ts:74-87`（现）；`src/kernel/plugin-manifest-contributes.ts:114-121`（现） |

**差异 / 我方优势 / 我方差距**
- **我方安全姿态优于 opencode/zcode/codex**：trust 分轨（trusted/untrusted）+ 安装期 fail-closed 校验 + 最窄宿主 token（`plugin-sdk.ts:74-87`）；opencode 零权限零隔离、zcode 无运行期面、codex 只有编译期扩展。
- **我方与 pi 同构的"默认内置可替换"路线已写进方案**（总体方案 §0.4:70-71，对齐 pi `replaceable:true`）；pi 是最干净的"0 特权内置"表达（`extensions/index.ts:7-13`）。
- **差距（最大）：SDK 能力面过窄**——只有 subscribe + pluginSettings，导致 IM/渠道、网络、文件、模型、UI 全部无法插件化（路A §5.4）；pi-desktop 有 ~60 方法的 `PluginHostApi`，dsh 用 `inject` 开放式。
- **差距：无进程隔离与热加载**——pi-desktop 每插件 utilityProcess + 权限网关 + 热重载天花板（`plugin-runtime.ts:1268-1271,2299`）；dsh 有 `dsh-hmr`；我方仅 `disposeAll`/`unregisterTool` 在位但装配期一次性装载（路A §5.4）。
- **差距：无常驻服务与跨插件消息总线**——pi-desktop ADR 0040 已实现（`contributes.services` + 声明式 topic 总线限流）；我方插件只能订阅宿主 SessionEvent（路A §5.4）。

---

## 功能 4：事件与协议

**我们的重构后内核**：`skeleton/events.ts`（31 类事件闭集 + C14 `assertJsonSafe` + C16 穷尽闸门）与 `skeleton/protocol.ts`（←`agent-protocol.ts`，跨进程 stdio JSON-RPC，**新增 `PROTOCOL_VERSION` + 握手协商**，EP-9）是内核保留的公共语言；事件类型下沉 `contracts/`，插件只能消费不能扩词汇表。依据：总体方案 §1.3:133-134、§2.1:236-238；路B §0。

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 |
|---|---|---|---|
| pi-desktop | RACP 协议独立成包：`racp/src/jsonrpc.ts` 是 JSON-RPC 2.0 framing（一帧一消息、无批、错误统一挂 `error.data`）；`operations.ts` 建 handler map；host 侧委托 `host-operations.ts`，server 不碰 host-core/fs/pty | 协议=独立包 `racp` | `oss/pi-desktop/packages/racp/src/jsonrpc.ts:1-25`；`oss/pi-desktop/packages/racp/src/operations.ts:126`；`.../racp/src/host-operations.ts:1-14` |
| zcode | 事件在 `@zcode/contracts/src/events/`：`SessionEventType` 常量表（**80 个**，实测 `:83-176`）+ `event-reducer.ts` 投影 + retention；`MicrocompactBoundary`/`StreamRecovery` 等专用事件 | 事件=contracts 包（core 依赖） | `oss/zcode/apps/zcode-cli/packages/contracts/src/events/session.events.ts:72,83-176`；`.../events/event-reducer.ts`；`.../events/stream-recovery.events.ts` |
| dsh | `KNOWN_SESSION_EVENT_TYPES` **由脚本生成**（`gen-persistence-catalog.ts`）；读路径**拒读**词汇表外的类型，除非事件带 `ignorable` 标记（兼容机制：比"按名注册"更安全，因注册不区分省略安全性）；跨包事件构造上就在名单外 | 事件=session 包（生成式事实源） | `oss/deepseek-harness/packages/core/session/src/known-event-types.ts:1-20`；`.../session/src/types.ts:75,511`（`ignorable`） |
| opencode | 事件双轨：`packages/schema/src/event-manifest.ts` 汇总各域 `Definitions`（Server/durable 分离）；`core/src/event.ts` 是 EventV2 存储（DB 持久化 + seq + PubSub）；`public-event-manifest.ts` 是外发面 | 事件=schema 包；存储=core | `oss/opencode/packages/schema/src/event-manifest.ts:1-40`；`oss/opencode/packages/core/src/event.ts:1-40`；`.../core/src/public-event-manifest.ts` |
| codex | 协议拆多 crate：`codex-rs/protocol`（类型词汇）+ `app-server-protocol`（initialize 握手，`ClientInfo` 带 client version）+ `exec-server-protocol` / `code-mode-protocol`；**无独立 `PROTOCOL_VERSION` 常量**，用 initialize/ClientInfo 协商 | 协议=crate | `oss/codex/codex-rs/protocol/src/lib.rs:1-30`；`oss/codex/codex-rs/app-server-protocol/src/protocol/common.rs:501,2617-2618`（`InitializeParams`/`ClientInfo`）；`grep -rn "PROTOCOL_VERSION" codex-rs/app-server-protocol/src` 无命中【已核实】 |
| pi | 协议是**独立包**：`packages/protocol/src/protocol.ts:5` `PROTOCOL_VERSION = 8`；首帧必须是 `hello`（`ClientHelloSchema`，含 version）；CBOR codec + framing 分层 | 协议=独立包；事件类型在内核 agent 包 | `oss/pi/packages/protocol/src/protocol.ts:1-40`；`oss/pi/packages/agent/src/types.ts:516`（`AgentEvent` 闭集） |
| **我方（重构后）** | `skeleton/events.ts` 31 类闭集 + `assertJsonSafe`（C14）+ 穷尽闸门（C16）；`skeleton/protocol.ts` + **新增 `PROTOCOL_VERSION`/握手**（EP-9，对齐 pi）；事件类型下沉 `contracts/`，跨进程 stdio JSON-RPC | 事件/协议=内核 skeleton | `docs/20261010_内核重构总体方案.md` §1.3:133-134；§2.1:236-238；§3:353（EP-9）；`src/kernel/events.ts:41,890`（现）；`src/host/protocol.ts:1`（现） |

**差异 / 我方优势 / 我方差距**
- **我方 JSON 安全 + 穷尽闸门是参考仓少有的**：`assertJsonSafe`（C14）+ C16 穷尽检查把"事件必须可跨进程/可持久化"钉成编译期/运行期不变量；pi 靠 TypeBox schema 校验（`protocol.ts:4-8`），dsh 靠生成式词汇表 + `ignorable`，都没同时做 JSON 安全闸门。
- **我方的 `PROTOCOL_VERSION` 是"补齐"而非"领先"**：pi 已有 `=8`（`protocol.ts:5`）与 hello 握手；我方现无版本常量，重构批 0/1 才加（EP-9）。codex 用 initialize/ClientInfo 协商，无同名常量。
- **dsh 的"拒读未知事件 + `ignorable` 标记"比我方更严**（`known-event-types.ts:6-19`）：它区分了"省略是否安全"，我方闭集只有穷尽检查，无"可安全跳过"语义。
- **差距：事件词汇表规模与治理**——zcode 80 个事件常量表、dsh 生成式清单、opencode 多域 Definitions 汇总，均有单一事实源生成；我方 31 类闭集手写，扩词汇表要走代码（路B §7#1）。
- **差距：协议层数**——pi（protocol 包 + CBOR + framing）、codex（4 个协议 crate）都把 wire 编解码独立成层；我方 `protocol.ts` 单文件 1,094 行承载全部（总体方案 §2.1:238）。

---

## 功能 5：agent 循环

**我们的重构后内核**：`primitives/loop/loop.ts`（1,643 行，W7 拆为 `loop.ts` + `guards.ts` + `watchdog.ts`）承载 `runTurn`（驱动+决策）→ `step` → `decideTurn` 三级；**循环绝不自行推断"无 toolCall 就停"**（显式 `{action:"end"}`）。护栏含 maxSteps、双轴预算、mutation 预算、看门狗（只强制事件流终态、不弃在途 promise）、输出触顶续跑、流恢复；另 `stream-recovery.ts`/`model-switch.ts`/`side-query.ts`/`prompt-gate.ts`/`prompt-args.ts` 同目录。依据：总体方案 §2.2:253-263；路B §1、§7。

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 |
|---|---|---|---|
| pi-desktop | 循环在上游 pi；本地 `agent-host` 提供准入 + 回合队列 + 审批 + 事件日志 + 快照，`host-runtime` 提供 HostProcess/AgentSidecar/RuntimeSupervisor/TurnPersistence；`turn-queue.ts` 管回合准入 | 循环=上游包；回合编排=本地包 | `oss/pi-desktop/packages/agent-host/src/turn-queue.ts:179`；`oss/pi-desktop/packages/host-runtime/src/index.ts:1-12`；`oss/pi-desktop/docs/adr/0002-use-pi-agent-harness.md` |
| zcode | `runRegularTurnLoop`（`while(true)`）+ 状态机 `TurnMachine`；每轮 = microcompact → autoCompact → 装配 → `runModelBackedTurnStep`；`getNextPhase()` 决定 Streaming→Completing；每个 await 后 `throwIfTurnAborted` | 循环=core 包内（多文件） | `oss/zcode/apps/zcode-cli/packages/core/src/runtime/methods/turn-loop.ts:43-108`；`.../core/src/agent/turn-machine.ts:308-316`；`.../core/src/runtime/command-queue.ts:121` |
| dsh | `AgentLoop extends Service`（`inject=['agents','sessions','llm','tools','systemPrompt','sessionProjections']`）；工具批次在 `tool-calls.ts`：**独占调用成屏障，并行调用用有界滚动池**，dispatch 可重叠但 policy/结果/结果上下文保持模型序；abort 时为跳过调用记合成错误结果以保 replay 有效 | 循环=插件（Service 包） | `oss/deepseek-harness/packages/core/agent-loop/src/index.ts:341-342`；`.../agent-loop/src/tool-calls.ts:1-14`；`.../agent-loop/src/constants.ts:6` |
| opencode | `session/runner/llm.ts`：外层 `while (shouldRun)` + 内层 `while (needsContinuation)`，step 显式编号；`FiberSet` 结构化并发；`promoteSteers/promoteNextQueued` 提升排队输入；`PermissionV2.DeclinedError` 直接中止循环；`isLastStep` 上限 | 循环=core 包内 | `oss/opencode/packages/core/src/session/runner/llm.ts:141-142,184,190-193,202-203,402-413` |
| codex | `tasks/regular.rs`：外层 `loop`（pending input 续跑）+ 单轮内采样循环；`terminal_error` 或队列无 pending 收束；取消靠 `CancellationToken` 树 + `AbortOnDropHandle` | 循环=core crate | `oss/codex/codex-rs/core/src/tasks/regular.rs:104-120`；`oss/codex/codex-rs/core/src/tools/parallel.rs:6-10,202` |
| pi | `runLoop`：外层 `while(true)`（follow-up 续跑）+ 内层 `while (hasMoreToolCalls \|\| pendingMessages.length)`；每轮前 `getSteeringMessages()`；`stopReason==="error"/"aborted"` 直接收束；无看门狗，`AbortSignal` 透传 | 循环=内核 agent 包 | `oss/pi/packages/agent/src/agent-loop.ts:163,176,179,183,205,245,295` |
| **我方（重构后）** | `primitives/loop/`：loop + guards（W7 拆出 maxSteps/mutationBudget/outputContinuation）+ watchdog（armAbortWatchdog/forceCloseTurn/迟到结果闸门）+ stream-recovery + model-switch + side-query | 循环=内核 primitives | `docs/20261010_内核重构总体方案.md` §1.3:144-151；§2.2:253-263；`src/kernel/loop.ts:624,713,739,744`（现） |

**差异 / 我方优势 / 我方差距**
- **我方循环护栏最全且最严**：显式停止决策（`loop.ts:744`，不推断）、看门狗"只强制事件流终态、不弃在途 promise"（路B §1 关键差异 2）、mutation 预算（zcode 无同类）、流中断恢复、输出触顶续跑。参考仓无一同时具备。
- **dsh 的工具批次语义与我方最接近但更细**：dsh 用"独占屏障 + 有界滚动池"并保模型序（`tool-calls.ts:1-14`），还规定 abort 时记合成结果保 replay；我方是 RwLock 读/写二档（`loop.ts:1218`）。
- **steer 语义 zcode 最完整**：优先级队列（now/next/later）+ 批次合并 + 大量 steer 事件（`command-queue.ts:10-11,121`；`session.events.ts` 有 6 个 TurnSteer* 事件）；我方 `queue.drain()` + promptGate 较简。
- **差距（结构性）：护栏全挤在 loop.ts 单文件**——1,643 行同时承载驱动/7 种护栏/并行锁/流恢复/预算/图片注入/缓存锚/事件配对；zcode 已拆 turn-loop-state/turn-loop/turn-model-step 多文件。W7 拆分正是为此（总体方案 §2.2:257）。
- **差距：opencode 的 Effect 结构化并发（`FiberSet.raceFirst(join, awaitEmpty)`，llm.ts:141-142）比我方 Promise.all 更可组合**；但 opencode 因此无独立调度器（见功能 7）。

---

## 功能 6：工具契约

**我们的重构后内核**：`primitives/tools/registry.ts` 的 `ToolDef` 现 8 字段（execute/parallel/deferrable/timeoutMs/descriptionText…），**W5 加元数据扩展位**（readOnly/destructive/sideEffectScope/needsApproval/riskLevel/maxOutputBytes，可选声明、fail-closed 双读）；`contract.ts` 提供执行态≠落盘态的富值投影，`truncate.ts` 统一输出截断（51200B/2000 行），`registry.boundOutput` 是唯一出口。依据：总体方案 §2.4:280-296、§4 批 3:372；路B §2.3、§8.3。

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 |
|---|---|---|---|
| pi-desktop | 工具声明是 **fixed-tool-declarations**（编进 agent-runtime）；插件可经 `contributes.agentExtensions` 扩展（须 `agent.extension` 权限）；Files/Browser 是**捆绑插件**走公共通道 | 契约=上游 pi；扩展=插件贡献面 | `oss/pi-desktop/packages/plugin-sdk/src/index.ts:128,1536-1542`；`oss/pi-desktop/docs/adr/0105-files-as-a-bundled-plugin.md`；`.../adr/0241-vendored-updatable-file-view-plugin.md` |
| zcode | **声明式厚契约的极参照**：`ToolMetadata` 14 字段（name/description/modelInstructions/allowedInPlanMode/readOnly/destructive/concurrentSafe/requiresUserInteraction/timeoutMs/maxOutputBytes/sideEffectScope/riskLevel/needsApproval/providerVisible/stopTurnOnSuccess/mcpPresentation）+ `ToolEntry`（aliases/modelContentProtection/maxModelChars/handler/resolveModelContract/validateInput/resolveInput/prepareApproval/inputSchema/timeout/cancellation）；`toContracts()` 把元数据投影成 provider 契约——**声明即契约**，执行/调度/审批三处共读 | 契约=core 包（最厚） | `oss/zcode/apps/zcode-cli/packages/core/src/tool/types.ts:68-96,278,327,357`；`.../core/src/tool/registry.ts:104` |
| dsh | `@deepseek-ai/dsh-tools` 提供工具注册表 + 展示模式 + **pre/guard/around/post/result 执行管线**；动态工具用 `DYNAMIC_TOOL` Symbol 打标，`registerTool` 只收带标定义；输出经 `cloneJson` 深拷贝 | 契约=包（Service） | `oss/deepseek-harness/packages/core/tools/src/index.ts:1-20`；`oss/deepseek-harness/packages/extensions/cordis-host-runner/src/guard.ts:24,491-496` |
| opencode | `Tool.Definition`（`tool/tool.ts:20`）：description + input(Effect Schema) + output + structured + toStructuredOutput + execute + toModelOutput；**输入输出双向 schema 校验**；runtime 附 `permission?: string`；`ToolRegistry.materialize(permissions)` 注入 Ruleset | 契约=core 包 | `oss/opencode/packages/core/src/tool/tool.ts:20,75-82,140`；`.../core/src/tool/registry.ts:24,106` |
| codex | `ToolExecutor` trait（`tool_executor.rs:106`）：tool_name/spec/supports_parallel_tool_calls/handle；`CoreToolRuntime` trait 追加 `finishes_on_cancellation`/`is_builtin_control_tool`/`immutable_spec`/`telemetry_tags`/`mcp_server_name` 等（Rust 默认实现=零成本覆写）；`ToolExposure` 枚举 Direct/Deferred/Hidden | 契约=tools crate | `oss/codex/codex-rs/tools/src/tool_executor.rs:106-127`；`oss/codex/codex-rs/core/src/tools/registry.rs:61,66,109`；`oss/codex/codex-rs/tools/src/tool_spec.rs:26` |
| pi | `AgentTool`（`types.ts:466`）薄契约 6 字段：label/parameters(TSchema)/prepareArguments/outputSchema/execute/replay/`executionMode`（默认 parallel）；无审批/风险/超时声明（交外层） | 契约=内核 agent 包 | `oss/pi/packages/agent/src/types.ts:466,498`；`.../types.ts:47`（`ToolExecutionMode`） |
| **我方（重构后）** | `primitives/tools/registry.ts`：现 8 字段，**W5 加 6 项元数据**（可选、fail-closed 双读）；`contract.ts`（富值投影）+ `truncate.ts`（51200B/2000 行）+ `mutation-budget.ts`/`write-queue.ts`/`spill-gc.ts`/`env.ts`（ExecutionEnv）同目录 | 契约=内核 primitives | `docs/20261010_内核重构总体方案.md` §2.4:280-296；§4 批 3:372；`src/kernel/tools/registry.ts:41-110`（现）；`src/kernel/tools/contract.ts:24,52`（现）；`src/kernel/tools/truncate.ts:22,24`（现） |

**差异 / 我方优势 / 我方差距**
- **zcode 契约面是唯一"声明即契约"的完整自洽体**（20+ 字段 + capability/resolve 回调族，`types.ts:68-96`）；我方现 8 字段、审批/只读分类散在 policy 按工具名硬编码（`src/policy/gate.ts:73-74`），W5 才补元数据——**这是本组最大"增重"项**（路B §8.3）。
- **我方 `deferrable` 延迟 schema 加载优于 zcode 默认**（`registry.ts:73`；路B §7#17），且 `contract.ts` 执行态/落盘态分离对齐 dsh 形（路B §7#20）。
- **codex 的 trait 默认实现 + `ToolExposure`（Direct/Deferred/Hidden）比我方 `deferrable` 二值更细**，且把"取消时是否已完成"做成显式方法 `finishes_on_cancellation`（`registry.rs:61`），我方靠 ToolContext.signal 协作。
- **差距：无工具资源访问表达**——kimi（非本组）有 `ToolAccesses.conflict` 细粒度读写/前缀冲突模型；我方只有 `parallel` 二值，第三方插件工具无法自报冲突（路B §3 判定、§8.3）。
- **差距：审批声明不在契约里**——zcode `needsApproval`+`resolvePermissionRulePolicy`、opencode `permission` 字符串、codex `approvals.rs` 都在工具声明面；我方审批靠 policy 链求值（`src/policy/chain.ts:28`），工具自身不声明。

---

## 功能 7：工具调度

**我们的重构后内核**：**W6 新建 `primitives/tools/scheduler.ts`**——拓扑排序 + 并行分组 + 并发上限，取代现 loop 内 `RwLock` + `Promise.all`（`loop.ts:1218-1230`）；loop 只调 `scheduler.run(calls)`；`parallel` 二值先映射为 `concurrentSafe`。这是内核唯一"从无到有"的新原语（≈150 行）。依据：总体方案 §1.3:162、§2.4:285、§4 批 3:372；路B §3、§9 B2。

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 |
|---|---|---|---|
| pi-desktop | 无独立调度器；回合准入/排队在 `agent-host/turn-queue.ts`（管的是回合不是工具）；工具声明 fixed | 无工具调度器 | `oss/pi-desktop/packages/agent-host/src/turn-queue.ts:179`；`oss/pi-desktop/packages/agent-host/src/index.ts:4` |
| zcode | `ToolScheduler`：**拓扑排序 → 并行分组 → 环检测**；`canRunInParallel`：destructive→false、concurrentSafe→判定、readOnly→true、否则 `sideEffectScope==="none"`；`DEFAULT_MAX_CONCURRENCY = 10`；执行走 generator 逐组产出 batch_start/batch_complete | 调度=core 包（元数据驱动） | `oss/zcode/apps/zcode-cli/packages/core/src/tool/scheduler.ts:48,50,60,85,105,187`；`.../core/src/tool/executor/batch-runner.ts:56` |
| dsh | `tool-calls.ts`：**独占调用成屏障 + 并行调用有界滚动池**（`DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10`）；dispatch 可重叠，policy/结果/上下文保模型序；abort 停补并 drain 已启动 | 调度=agent-loop 包 | `oss/deepseek-harness/packages/core/agent-loop/src/tool-calls.ts:1-14`；`.../agent-loop/src/constants.ts:6`；`.../agent-loop/src/index.ts:346` |
| opencode | **无独立调度器**：`FiberSet` + `Effect.raceFirst(FiberSet.join, awaitEmpty)` 结构化并发；无并发上限、无拓扑 | 无调度器（Effect 并发原语） | `oss/opencode/packages/core/src/session/runner/llm.ts:141-142,184` |
| codex | `parallel.rs`：`supports_parallel` → `RwLock` 读/写（读=并发、写=排他，`:213 Either::Left(read)/Right(write)`）；`StepContext` 保存"广告该工具的那一步"；`AbortOnDropHandle` 管取消 | 调度=core crate | `oss/codex/codex-rs/core/src/tools/parallel.rs:49-64,141,202-216`；`.../core/src/tools/orchestrator.rs`；`.../core/src/tools/registry.rs:970`【行数据路B】 |
| pi | **无独立调度器**：任一工具 `executionMode==="sequential"` → 全串行（`:517`），否则 `Promise.all` 并行（`:586 orderedFinalizedCalls`）；无上限 | 无调度器 | `oss/pi/packages/agent/src/agent-loop.ts:508,517,530,586,646` |
| **我方（重构后）** | **新建 `primitives/tools/scheduler.ts`**：拓扑/并行组/上限，`scheduler.run(calls)`；`parallel` → `concurrentSafe` 映射 | 调度=内核 primitives（新建） | `docs/20261010_内核重构总体方案.md` §1.3:162；§2.4:285；§4:372；`src/kernel/loop.ts:1218,1223,1230`（现，将拆） |

**差异 / 我方优势 / 我方差距**
- **zcode 是"元数据驱动调度"的完整范本**：调度器只读声明、不认识工具名（`scheduler.ts:85-102`）；我方现是循环内硬编码 `isParallelTool`，编排在 loop.ts——插件工具无法表达并发/依赖需求（路B §3 判定）。
- **dsh 的"独占屏障 + 有界滚动池 + 保模型序"比我方将建的 scheduler 更细**：它区分 dispatch 重叠与结果保序（`tool-calls.ts:1-14`），我方方案只提拓扑/并行组/上限（总体方案 §1.3:162）。
- **codex 的 RwLock 读/写二档与我方现状同构**（`parallel.rs:213` vs `loop.ts:1218`），但 codex 把"广告该工具的 step"存进 `StepContext`，支持 step 内声明快照一致性——我方有 `stepToolMeta` 快照（`loop.ts:936`）对应（路B §7#16）。
- **我方优势：只有我方与 zcode 把调度做成独立可测原语**；pi/opencode 无调度器（pi 二值串行化、opencode 靠 Effect），pi-desktop 无工具级调度。
- **差距：并发上限我方现无**（`Promise.all` 全量，路B §7#14）；zcode/dsh 默认 10。W6 新建即补此项。

---

## 功能 8：上下文与压缩

**我们的重构后内核**：内核只保留**两个挂点 + 压力记录 + 最小投影件**——turn 首挂点（`loop.ts:704 beforeFirstModelRequest`）、turnEnd 压缩层（`assembly.ts:926`，随装配移入 `runtime/`）、`primitives/session/{result-trim,prefix-anchor}.ts`；**压缩引擎（compaction/llm-summarizer/new-window/downshift/rapid-refill/tool-pairing）留在 `src/context/` 域**，批 7 之后作为 context 插件接管（W11 顺延，见总体方案 §7:449）。依据：总体方案 §2.3:265-278、§7:449；路B §4。

| 仓 | 这条能力怎么做 | 放内核还是包/插件 | 锚点 |
|---|---|---|---|
| pi-desktop | 压缩委托上游 pi；本地 `host-runtime` 管 TurnPersistence / inflight-checkpoint / result-summary（回合持久化与检查点，不实现压缩引擎） | 压缩=上游包；持久化=本地包 | `oss/pi-desktop/packages/host-runtime/src/index.ts:7,9,20`；`.../host-runtime/src/live-work/result-summary.ts` |
| zcode | 每 model roundtrip 前 microcompact（清旧 tool result，**保留最近 5 条**，比例 0.9 + 缓冲 2K + 最小节省 256 token）+ autoCompact；`shouldAutoCompact` 双源（estimate vs provider usage）；有效窗口 = contextWindow − min(maxOutput, 21K)，buffer 13K，连续失败 3 次熔断；microcompact 有可压缩工具白名单 | 压缩=core 包内（core/compact ~883 行） | `oss/zcode/apps/zcode-cli/packages/core/src/compact/policy.ts:10,28,86,90`；`.../core/src/compact/microcompact.ts:14-19,78-79,123-126`；`.../runtime/methods/turn-loop.ts:69,78` |
| dsh | 压缩是**一族可组合包**：`packages/compaction/`（compaction 核心 + compaction-basic + compaction-image-offload + compaction-tool-result-pruner + command-compact）；`compaction-basic` 是 replay-aware 后端，含 `region.ts`/`summarizer.ts`；`compaction` 包内含 `tool-pairing.ts`/`checkpoint.ts` | 压缩=一组包（可插拔后端） | `oss/deepseek-harness/packages/compaction/compaction-basic/src/index.ts:1-20`；`oss/deepseek-harness/packages/compaction/compaction/src/tool-pairing.ts`；`.../compaction/compaction-tool-result-pruner/` |
| opencode | `session/compaction.ts`：`make(deps)` + `compactAfterOverflow`（溢出后恢复一次，再溢出不再恢复）；runner 用 `ContinueAfterCompaction`/`ContinueAfterOverflowCompaction` 转场；`session/context-epoch.ts`/`history.ts`/`projector.ts` 配套 | 压缩=core 包内 | `oss/opencode/packages/core/src/session/compaction.ts:176,178,242`；`.../session/runner/llm.ts:154,164` |
| codex | **多级压缩**：`compact.rs` + `compact_token_budget.rs` + `compact_model_fallback.rs` + `compact_remote_history.rs` + `compact_remote_v2*.rs`（6+ 文件）；`CompactionReason` 枚举（context_limit/model_downshift/comp_hash_changed）【枚举名据路B】 | 压缩=core crate（多文件） | `oss/codex/codex-rs/core/src/compact.rs`；`.../core/src/compact_token_budget.rs`；`.../core/src/compact_remote_history.rs`；`ls oss/codex/codex-rs/core/src/compact*`（6+） |
| pi | **内核零压缩**：`packages/agent` 无 compaction 引用；压缩整体在 coding-agent：`core/compaction/compaction.ts`（`shouldCompact`/`findCutPoint`/`estimateContextTokens`）+ branch-summarization + utils，纯函数 + session manager 负责 IO | 压缩=包（内核零压缩） | `oss/pi/packages/coding-agent/src/core/compaction/compaction.ts:126,267,446`；`.../core/compaction/branch-summarization.ts`；`oss/pi/packages/agent/src/`（无 compaction） |
| **我方（重构后）** | 内核留**两挂点 + 压力记录 + `primitives/session/{result-trim,prefix-anchor}`**；引擎（compaction/llm-summarizer/new-window/downshift/rapid-refill/tool-pairing）留 `src/context/` 域，批 7 后作 context 插件接管 | 挂点/最小投影=内核；引擎=context 域（后插件） | `docs/20261010_内核重构总体方案.md` §2.3:265-278；§7:449；`src/context/compaction.ts:37,338`（现）；`src/kernel/loop.ts:704`（现）；`src/kernel/assembly.ts:926`（现） |

**差异 / 我方优势 / 我方差距**
- **我方压缩覆盖面比 zcode 更宽**：多出 downshift / tool-pairing / result-trim / rapid-refill（抖动断路器，zcode 独家已被我方采纳）；zcode 只有 microcompact + autoCompact + manual（路B §4 判定、§7#23/#26）。
- **pi 证明"内核零压缩"可行**：`packages/agent` 无 compaction，引擎整体在 coding-agent（`compaction.ts:267 shouldCompact`）；我方方案对齐——内核只留挂点（总体方案 §7:449）。
- **dsh 的"压缩后端可插拔"（一族包）比我方"引擎留域、后插件接管"更彻底**：它把 image-offload / tool-result-pruner 都做成独立包，且 `compaction-basic` 是 replay-aware 后端（`compaction-basic/src/index.ts:1-20`）。
- **codex 的多级/远程压缩面最宽**（6+ 文件含 remote history v2），但也最重（core crate 内）；我方选"挂点 + 域实现"更轻。
- **我方差距：`assembly.ts:926` 压缩层随装配移入 `runtime/`**——挂点与实现分离后，若插件接管失败需保证"回落原行为"（总体方案 §4 批 7:376）；pi 的"纯函数 + session manager 管 IO"分层（`compaction.ts` + branch-summarization）可借鉴做接口冻结。

---

## 未覆盖 / 说明

- 本组 8 个功能**全部覆盖**。
- 以下锚点为**据路A/路B 转引、本组未逐行复核**：codex `orchestrator.rs:626`/`router.rs:440`/`registry.rs:970` 行数；codex `CompactionReason` 枚举成员名；pi-desktop `agent-host` 2,459 行 / `host-runtime` 6,104 行（本组实测含测试文件为 3,837 / 5,378，未剔除测试）。
- 参考仓源码只读，未修改 `oss/` 或 `src/` 任何文件。
