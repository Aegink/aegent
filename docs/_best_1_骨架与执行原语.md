# 最优实践评估·第 1 组：骨架与执行原语

> 范围：§1 内核骨架与分层 / §2 依赖治理与边界 / §3 插件系统 / §4 事件与协议 / §5 agent 循环 / §6 工具契约 / §7 工具调度 / §8 上下文与压缩（8/8 覆盖）。
> 判定标准（四条同时权衡）：能力完整、轻、可插可替换、安全/正确性。凡"最全但过重"（codex core 25 万行）在"轻"一票上扣分。
> 锚点：参考仓 `oss/<repo>/...:line`，我方为重构后 `src/core/...`（兼注现状 `src/kernel/...`）。全部结论写前已 Read/Grep 复核；未逐行核实处标 `【未验证】`。
> 输入：`docs/20261010_内核功能对照_重构后.md` §1~§8、`docs/20261010_内核重构总体方案.md`（落点/批次/EP/W 编号）、`docs/_cmp_1_骨架与执行原语.md`。
> 实测校正（与对照文档不一致，以本报告为准）：
> 1. pi-desktop `PLUGIN_PERMISSIONS` **实测 44 项**（`packages/plugin-sdk/src/index.ts:1403-1448` 逐项计数），文档写 48。
> 2. pi-desktop `PluginHostApi` **实测 24 个顶层命名空间**（`packages/plugin-sdk/src/index.ts:1114` 起、共 260 行），文档"~60 方法"是含嵌套口径。
> 3. zcode `SessionEventType` **实测 79 项**（`apps/zcode-cli/packages/contracts/src/events/session.events.ts:83` 起），文档写 80。
> 读法：每节 = 裁定表（3 行）→ 最优设计细节（机制 + 锚点 + 为何四条综合最好）→ 接入我们内核（文件/接口 + 批次/W）→ 成本与风险 → 为什么不选别家（逐仓一句）。

---

## §1 内核骨架与分层

| 项 | 结论 |
|---|---|
| 最优范式来源 | dsh（deepseek-harness） |
| 抄什么 | 内核 = 一组最小服务包：共享 API 住内核、产品装配在外（数据清单）、默认驱动可被第三方实现替换 |
| 不抄谁 | codex（core 单 crate 583 文件，最全但最重） |

### 最优设计细节

- `packages/core/` 是 8 个独立发布的子包：scope / session / system-prompt / tools / agent-tool-presentation / agent / agent-default-model / agent-loop，每个有独立 README 与 `ctx` key（`oss/deepseek-harness/packages/core/README.md:19-31`）。内核是"一组最小服务"而不是一个单体包。
- 分层判据写在 README 里："These packages define the shared APIs used by every composition, while executable product assemblies live under `packages/bundle`"（`packages/core/README.md:14`）；"extension plugins depend on `agent` and the driver stays swappable"（同文件 `:31`）。
- 循环本体就是可替换实现：`export class AgentLoop extends Service implements AgentFactory` + `static inject = ['agents','sessions','llm','tools','systemPrompt','sessionProjections']`（`packages/core/agent-loop/src/index.ts:341-342`）。依赖声明式，第三方可另写 `AgentFactory` 接管。
- 装配是**数据**而非代码顺序：`packages/bundle/base/cordis.patch.yml:1-13`（一次 insert、按 `id` 寻址、last-write-wins per row、"Row order carries no load semantics（activation is service-availability driven）"）；连 HMR 都是一行清单（`:28-29` `id: hmr / name: '@deepseek-ai/dsh-hmr'`）。
- 防伪细节：动态工具用 `DYNAMIC_TOOL` Symbol 打标，`registerTool` 只收带标定义，跨 realm 值一律 `cloneJson` 深拷贝（`packages/extensions/cordis-host-runner/src/guard.ts:24,99,491-496`）。

为什么四条综合最好：① 能力完整——8 个内核包覆盖循环/会话/工具/提示词/作用域/默认模型，每件都有明确 ctx key；② 轻——没有巨型 core，每个包只做一件事（对比 codex 的 583 文件）；③ 可插可替换——唯一把"驱动 stays swappable"写进 README 与类型（`AgentFactory`）的；④ 方向正确——"共享 API 在内、装配在外"与我方 `contracts/primitives ← runtime` 三层同构，且装配数据化让替换不动内核代码。它的物理粒度（340 个 package.json）不抄，我方守单包 `src/core` + 硬架构检查。

### 接入我们内核

- 落点 `src/runtime/registrations/`（总体方案 §1.4:201-207、EP-10）：把 6 个 `register*` 与域接线从"装配期顺序调用"改为**按 id 寻址的注册清单**（一张数据表 + 单一 apply），默认装配与用户/第三方覆盖走同一张表。这正是批 5 的交付面。
- 落点 `src/core/index.ts`：为四件原语（loop / 会话投影 / 工具契约 / 进程模型）各留一个类型化注册槽位，`primitives/` 只提供默认实现——对齐 dsh `AgentFactory` 的可替换语义。现有 `loop.ts:245` 的 `decideTurn: DecideTurn` 注入是雏形，需扩到"驱动本身"。
- 批次对齐：批 0（core 硬约束，已定）+ 批 5（装配搬出 + EP-10）。不学 dsh 的 331 包物理拆分（见 §2 与总体方案 §1.5:210-224 的口径）。

### 成本与风险

- 成本：**中**（registrations 数据化 + 四原语槽位）。
- 风险：装配数据化会触碰启动顺序敏感项（缓存锚/注册序，批 6 红线），须以 `steer.snapshot.test.ts` / `builtin.test.ts` 为闸；前置依赖：批 5 真 host 冒烟（总体方案 §8:459）。

### 为什么不选别家

- pi：内核 6 文件 2,519 行最轻（`oss/pi/packages/agent/src/*.ts` 实测，依赖仅 pi-ai + typebox），但协议/工具契约/会话投影/进程模型全搬 `coding-agent`——"轻"靠削减内核职责换的，不满足能力完整。
- zcode：core/services 二分判据清楚（`oss/zcode/apps/zcode-cli/packages/core/src/index.ts:1-60`），但 core 仍 500 文件/96,116 行，且无"驱动可换"设计。
- pi-desktop：内核=上游 pi 两包（`docs/adr/0002-use-pi-agent-harness.md:5-12`）换来独立版本化，但本地 `host-runtime`（实测 5,378 行含测试）是产品运行时而非可复用内核，内核语义面不可度量。
- opencode：core 即内核，`exports` 里 `"./*": "./src/*.ts"`（`packages/core/package.json:23`）使边界形同不存在，反面教材。
- codex：127 crate 编译期无环是好机制，但 core 自身仍 583 文件，且 `ext/*` 只有 15 个扩展 crate，不解决 core 过重。

---

## §2 依赖治理与边界

| 项 | 结论 |
|---|---|
| 最优范式来源 | zcode |
| 抄什么 | 策略文件 per-module `managed/requires/publicEntrypoints/layers/layerOrder/owner` + 全局体积/环/深导入闸 + `architecture:context` 模块上下文 |
| 不抄谁 | codex（编译期无环但 127 crate 不可移植，且 core 583 文件无大小治理） |

### 最优设计细节

- `architecture-policy.yaml:22-42`（storage 模块）：`managed:true` + `requires:[shared,rpc,services]` 白名单 + `publicEntrypoints:[".../storage/contract.ts"]`（禁深导入）+ `layers:{domain,app,adapters}` + `layerOrder:[domain,app,adapters]` + `owner:desktop-settings`。
- 全局闸（同文件 `:56-62`）：`maxFileLines:400`、`maxContractLines:300`、`maxPublicMethods:12`、`forbidCycles:true`、`forbidDeepImports:true`、`managedOnly:true`。
- 强制挂在 pre-push：`package.json:19` `verify:pre-push = lint && architecture:check -- --changed`；并有 `architecture:check/report/baseline:update/context` 四命令（`:44-47`）。
- `architecture:context`（`:47`）把某模块的允许依赖/公开面输出成给 agent 读的上下文——治理面直接喂给写代码的模型，别家没有这个闭环。
- 补充维度（pi，可选吸收）：`oss/pi/scripts/check-entry-graphs.mjs:1-9` 把入口点当成本契约，"importing a 1-file pure function through a barrel costs ~37 MB of evaluated module graph"，量化扇出。

为什么四条综合最好：① 能力完整——唯一同时具备"方向+层序+公开面+体积+环+深导入+owner+agent 上下文"的；② 轻——一个策略文件 + 4 个脚本，比我方现有 5 类规则只多一个文件；③ 解耦——策略是数据、检查是脚本，加模块不改脚本；④ 硬性——违规即 pre-push 失败，`managedOnly` 防新代码逃逸。

### 接入我们内核

- `architecture-policy.json`（批 0）：`core: {managed:true, requires:[], publicEntrypoints:["src/core/index.ts"], owner:"kernel"}`；新增 `runtime`、`ext-builtin`、`plugins` 三域；存量域先 `requires:[core,...现状]` 再逐域收紧（总体方案 §1.1:90-96）。
- `tools/architecture-check.mjs`（总体方案称"5 类规则不改"，§5:418）：批 0 起补 `maxContractLines`、`maxPublicMethods` 两个零成本维度（现有脚本规则清单未逐行复核【未验证】）；`layers/layerOrder` 暂不启用（我方单包布局，层序收益低）。
- 新增 `tools/architecture-context.mjs`（等价 `architecture:context`）：读 policy 输出"该域可依赖清单 + 公开面"，批 8 后供模型写新插件——这是低成本高回报的一条。
- 可选：批 8 后给 `src/core` 做 `tsconfig.json` project references，让"core 依赖别人"编译期报错（总体方案 §5:420-422 标为默认不做，建议保留为备选）。
- 批次：批 0（W1）+ 批 8 冻结。

### 成本与风险

- 成本：**小**（策略文件 + 两条检查维度 + 一个上下文脚本）。
- 风险：`forbidCycles` 一次性打开会对存量 13 域环报大量 error，需 baseline/`--changed` 灰度（zcode 用 `baseline:update`）；前置：批 0 先修 1 error 与补 `publicEntrypoints`。

### 为什么不选别家

- pi：入口预算思路是独有维度，但只治扇出一个面，无方向/环/公开面。
- pi-desktop：文件大小棘轮 + facade 保护（`scripts/check-architecture.mjs:20-35`）+ ADR 声明方向，无自动环检测、无深导入禁令。
- dsh：`scripts/check-workspace-constraints.ts` + pnpm workspace，方向由 cordis `inject` 运行时决定、编译期不表达、无环检测——强度不足。
- opencode：仅 `AGENTS.md:3` 文字规则且 `exports:"./*"` 开放深导入，等于无治理。
- codex：编译期无环是硬保证，但 127 crate 物理拆分不可移植，core 583 文件说明"能抽就抽"治不了 core 自身。

---

## §3 插件系统

| 项 | 结论 |
|---|---|
| 最优范式来源 | pi-desktop |
| 抄什么 | 权限闭集 + 单一宿主网关（allowlist → assertPermission → audit）+ 热重载"批准快照为上限、变宽即拒" |
| 不抄谁 | opencode（`PluginInput` 直给完整 SDK client + Bun shell，零权限零隔离） |

### 最优设计细节

- 权限闭集：`PLUGIN_PERMISSIONS` 实测 **44 项**（`oss/pi-desktop/packages/plugin-sdk/src/index.ts:1403-1448`：fs.read/write/delete、net.fetch/net.anyHost/net.websocket、bus.publish/subscribe、session.read.own、browser.cdp、agent.tool.register、mcp.server.local/remote 等）。
- 宿主面是命名空间树：`PluginHostApi`（`plugin-sdk/src/index.ts:1114` 起 260 行，24 个顶层命名空间 app/themes/plugin/commands/speech/ui/project/providers/workspace/desktop/audio/keyboard/fs/agent/models/session/usage/services/bus/clipboard…）。
- 单一网关：`HOST_API_ALLOWLIST`（`apps/desktop/electron/main/plugin-runtime.ts:511`）→ 每个宿主调用前 `assertPermission(loaded, "...")`（同文件 40+ 处，如 `:1687,1774,2477,2827`）。
- 进程隔离：默认 `utilityProcess.fork(entry, [], {...})` 每插件一进程（`plugin-runtime.ts:1268-1271`）；ADR 0008 明示独立进程 + RPC 且不得破坏四件事：权限网关、API allowlist、贡献点统一注册、崩溃非致命（`docs/adr/0008-plugin-runtime-isolation-target.md:1-20`）。
- 热重载天花板：开发态插件记录的权限集是"every later reload"的上限（`plugin-runtime.ts:2189`）；reload 声明超出上限即拒绝（`:2286,2299-2300`），fs 范围放宽单独检测（`widenedFsScope`，`:1128-1131`）。
- 常驻服务 + 消息总线：`contributes.services` 声明、宿主可感知/可重启，跨插件用声明式 topic 总线（`docs/adr/0040-plugin-resident-services-and-message-bus.md:1-25`）。

为什么四条综合最好：① 能力完整——权限面/贡献面/生命周期/隔离/热重载/常驻服务六件齐备，是唯一把"不可信代码"当一等公民的；② 可抄的部分很轻——机制本体 = 一张权限表 + 一个网关断言 + 一个上限集合，不必抄 Electron 宿主；③ 可插可替换——贡献点统一注册、崩溃非致命；④ 安全——默认拒绝 + 上限单调（变宽即拒）+ 无审批不装，四条全中。

### 接入我们内核

- 契约：`src/core/contracts/plugins.ts` 的 `PluginHostApi` 从现"3 方法"（`src/mcp/plugin-sdk.ts:74-87`：registerTool / subscribe / pluginSettings）扩成分片能力面（EP-11，总体方案 `:355`）：每片一组权限名 + 网关前置断言；manifest 声明所需权限（`src/kernel/plugin-manifest.ts` → `src/ext-builtin/plugin-runtime/manifest.ts`）。
- 网关：`src/ext-builtin/plugin-runtime/loader.ts` 收口为唯一 `assertPermission` 入口，保留我方已有的 trust 分轨 + 安装期 fail-closed 校验（优于 pi-desktop 的"安装无审批"）。
- 热重载上限：插件装配表记录"批准时权限快照"，reload 时 `declared − ceiling ≠ ∅ → 拒绝`（对齐 `plugin-runtime.ts:2299-2300`）。
- 常驻服务 + 总线（EP-12）：`contracts/plugins.ts` 增可选 `services`/`bus` 两片，实现留 ext-builtin。低成本补强可一并抄 dsh 的 `DYNAMIC_TOOL` 打标 + `cloneJson`（`extensions/cordis-host-runner/src/guard.ts:24,99,491-496`）做插件工具防伪。
- 批次：批 4 只做"外置 + 契约形状"（行为冻结）；权限分片/网关/常驻服务 = **重构后独立批次**（W15，总体方案 §4.1:403）。

### 成本与风险

- 成本：**大**（SDK 能力面分片 + 网关改造 + 权限闭集评审）。
- 风险：权限名是公共契约，一旦发布不可改名（需先冻结闭集）；"热重载上限"与"用户显式重装提权"的交互需定义；前置依赖：批 4（manifest 外置）+ 批 5（EP-10 注册面）。

### 为什么不选别家

- opencode：`Plugin = (input, options) => Promise<Hooks>` + `PluginInput` 直给完整 API client 与 `$: BunShell`（`packages/plugin/src/index.ts:56-74`），Effect Scope 只管生命周期（`packages/core/src/plugin.ts:43,85`）——零权限、零隔离、零审批。
- zcode：插件=静态资源包，contracts 只声明 `hooks?`（`packages/contracts/src/plugins/index.ts:149,251`），无运行期 SDK/生命周期/审批——轻但承载不了 IM/网络/文件类插件。
- codex：插件=编译期 crate（`codex-rs/ext/` 15 个）+ `PluginManifest`（`codex-rs/plugin/src/manifest.rs:8-17`），必须重编译。
- dsh：Service `inject` + YAML 装配是"可替换"最优解（已计入 §1），但零权限声明、零隔离；仅其防伪两件可借。
- pi：`builtInExtensions` 的 `replaceable:true`（`packages/coding-agent/src/extensions/index.ts:7-13`）证明"内置可被第三方接管"可行（我方已采纳），但无隔离、无热加载、重启才装载。

---

## §4 事件与协议

| 项 | 结论 |
|---|---|
| 最优范式来源 | pi |
| 抄什么 | `PROTOCOL_VERSION` 常量 + 首帧强制 hello 握手 + codec/framing 分层成包；事件闭集留内核 |
| 不抄谁 | codex（4 个协议 crate 最全，但无 `PROTOCOL_VERSION` 同名常量，靠 initialize/ClientInfo 隐式协商） |

### 最优设计细节

- `packages/protocol/src/protocol.ts:5` `export const PROTOCOL_VERSION = 8 as const`；`ClientHelloSchema` 注释 "Must be the first frame sent by a client"（同文件 `:31-33`），`version: Type.Integer({minimum:0})`。
- 协议独立成包且分层：`packages/protocol/src/{protocol,codec,framing}.ts` + `cbor/`；所有对象 `additionalProperties:false`（`:11-13`）——wire 编解码与语义分开，可替换 codec。
- 事件是内核闭集：`packages/agent/src/types.ts:516` `AgentEvent` 闭合联合（agent_start/turn_*/message_*/tool_execution_*/agent_end），且注释规定 `agent_end` 是最后事件、监听器属结算范围。
- 轻：协议包 + 内核事件类型不到千行，却同时给出"版本、握手、codec、framing、严格 schema、事件闭集"六件。

为什么四条综合最好：① 能力完整——版本/握手/编解码分层/事件闭集齐备（我方 `PROTOCOL_VERSION` 正是"补齐而非领先"，EP-9 明确对齐 pi）；② 轻——独立包但不堆 crate，无 codex 四协议 crate + 远程压缩级复杂度；③ 可插——codec/framing 与语义分离，"换传输"有替换点；④ 正确性——首帧强制 hello + 严格 schema 拒绝未知字段，是 fail-closed。唯一弱项是事件词汇表治理（不如 dsh），用补强项填。

### 接入我们内核

- `src/core/skeleton/protocol.ts`（←`src/kernel/agent-protocol.ts`，现 1,094 行单文件）：落 EP-9——`PROTOCOL_VERSION` + `ClientHello/ServerHello` + 首帧校验（总体方案 `:353`，批 0/1）；建议按 pi 分层把 framing（stdio 帧边界）与 payload schema 拆成同目录两文件，留传输替换点。
- 事件侧不动：保留 31 类闭集（`src/kernel/events.ts:889-922`）+ C14 `assertJsonSafe`（`:41`）+ C16 穷尽闸门（`:926-929`），整体进 `src/core/skeleton/events.ts`（总体方案 §2.1:236-238）。
- 补强（可选）：抄 dsh 的 `ignorable`——事件信封加 `ignorable?: true`，读路径遇到闭集外类型时"只允许 ignorable → 跳过；否则 fail-closed 拒读"（`oss/deepseek-harness/packages/core/session/src/known-event-types.ts:1-20` 明说拒读理由；`session/src/types.ts:511`）。这条同时服务 §10 的跨版本读日志。
- 批次：EP-9 批 0/1；`ignorable` 动事件信封（数据面），建议批 8 后独立做。

### 成本与风险

- 成本：**小**（EP-9 已在计划内）；`ignorable` **小-中**。
- 风险：协议版本号一旦发出即公共契约，须与"版本不匹配如何拒绝"一起定义（现在无版本 = 无兼容负担，是加版本的最佳窗口）；`ignorable` 判定错会静默丢事件，必须白名单式显式声明而非默认可跳。

### 为什么不选别家

- dsh：事件治理最严（生成式词汇表 + 拒读未知 + `ignorable`，`known-event-types.ts:1-20`），但无版本化 wire 协议层（库/组合定位），故"事件抄 dsh、协议抄 pi"。
- zcode：`SessionEventType` 实测 79 项 + `event-reducer.ts` 投影，但事件表手写无生成事实源、协议无版本常量、承载在 rpc/services 包。
- opencode：`schema/src/event-manifest.ts` 多域 Definitions 汇总 + `core/src/event.ts` EventV2 存储，事件治理尚可，但协议面靠 HTTP/OpenAPI 生成，无 pi 式版本/握手分层。
- codex：`codex-rs/protocol` + `app-server-protocol`（`protocol/common.rs:501,2617-2618` initialize/ClientInfo）+ exec/code-mode 共 4 个协议 crate，最全但协商隐式（grep 无 `PROTOCOL_VERSION`，对照文档已核实）、crate 数量重。
- pi-desktop：RACP 是干净 JSON-RPC 2.0（`packages/racp/src/jsonrpc.ts:1-8`：一帧一消息、无批、错误统一挂 `error.data`），但无版本常量、为产品专用协议。

---

## §5 agent 循环

| 项 | 结论 |
|---|---|
| 最优范式来源 | dsh |
| 抄什么 | 驱动做成可替换单元（`Service` + `inject` 声明依赖）+ abort 时为跳过调用记合成错误结果保 replay + 配置化并发上限 |
| 不抄谁 | codex（`CancellationToken` 树 + `AbortOnDropHandle` 好，但循环埋在 583 文件 core 内、不可替换） |

### 最优设计细节

- 驱动可替换：`export class AgentLoop extends Service implements AgentFactory`，`static inject = ['agents','sessions','llm','tools','systemPrompt','sessionProjections']`（`packages/core/agent-loop/src/index.ts:341-342`）；core/README.md:31 "the driver stays swappable"——依赖是声明，实现可被第三方替换。
- 取消语义无损：`packages/core/agent-loop/src/tool-calls.ts:1-14` 头注——"Dispatch may overlap, while policy, results, and result context remain model-ordered. Abort or an internal scheduler failure stops replenishment and drains started calls. **Abort records synthetic error results for skipped calls so replay stays valid.**"
- 上限是配置：`maxParallelToolCalls` 暴露在 Service Config（`agent-loop/src/index.ts:346-348`），默认 `DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10`（`constants.ts:6`）。
- 我方独有的护栏（不删、不换）：显式停止决策 `{action:"end"}`（`src/kernel/loop.ts:178,739-744`）、看门狗（只强制事件流终态、不弃在途 promise）、mutation 预算、输出触顶续跑（`loop.ts:734`）、流恢复；参考仓无一同时具备（对照文档 §5 已判）。

为什么四条综合最好：① 能力完整——回合/步骤生命周期 + 依赖注入 + 批次语义 + abort 恢复；② 轻——循环是一个小包，逻辑集中在 index.ts / tool-calls.ts / constants.ts；③ 可插可替换——唯一把"驱动可换"写成契约的（我方 `runTurn` 现为硬编码单实现）；④ 正确性——取消不是丢结果而是记合成结果，保证事件流 replay 有效，与我方看门狗思想同源。

### 接入我们内核

- `src/core/primitives/loop/loop.ts`：把"驱动本身"设为可注册槽位（`src/core/index.ts` 暴露 `registerLoopImplementation()`），`LoopDeps`（现 `loop.ts:245`）只留端口——对齐 dsh `AgentFactory`。
- `guards.ts` + `watchdog.ts`（W7 拆出，批 3）：abort 路径补 dsh 语义——被跳过/未启动的工具调用补合成错误结果，保证 `turn/end` 与事件流 replay 一致；改动与现有"迟到结果闸门"（`loop.ts:1240-1245`）同一处，集中可控。
- 批次：批 3（W7 拆分 + 槽位）；abort 合成结果属行为增强，需先给 `loop.cancel.test.ts` 加断言（总体方案 §4 批 3:372）。

### 成本与风险

- 成本：**中**（拆文件 + 槽位 + abort 补位）。
- 风险：合成结果会改变工具结果的条数/顺序 → 影响 replay 与投影（`src/session/project.ts`），必须成对验证；前置依赖：W7 拆分先落地，否则改动仍挤在 1,643 行单文件里。

### 为什么不选别家

- pi：`runLoop` 外层 `while(true)`（follow-up 续跑，`packages/agent/src/agent-loop.ts:179`）+ 内层 `while (hasMoreToolCalls || pendingMessages.length)`（`:183`）、每轮前 `getSteeringMessages()`（`:176,205,295`）、`stopReason==="error"/"aborted"` 即收束（`:245`）——最轻最干净，但无看门狗、无预算、取消仅 `AbortSignal` 透传，循环不可替换；只作骨架参照。
- zcode：`TurnMachine` + `getNextPhase()`（`core/src/agent/turn-machine.ts:64,308-316`）+ 每个 await 后 `throwIfTurnAborted`（`core/src/runtime/methods/turn-loop.ts:48,75,103,108`）是我方 W7 拆文件的最佳参照，但循环埋在 96,116 行 core 内、不可替换。
- opencode：`FiberSet` + `Effect.raceFirst(FiberSet.join, awaitEmpty)`（`core/src/session/runner/llm.ts:141-142,184`）结构化并发最可组合，代价是押注 Effect 运行时且没有独立调度器（见 §7）。
- pi-desktop：循环委托上游 pi，本地只做准入/回合队列（`packages/agent-host/src/turn-queue.ts:179`）——"薄运行时"已计入 §1，循环本体无新机制。
- codex：外层 `loop` + 单轮采样循环（`core/src/tasks/regular.rs:104-120`）取消硬，但 Rust 绑定 + 巨型 core，不可移植。

---

## §6 工具契约

| 项 | 结论 |
|---|---|
| 最优范式来源 | zcode |
| 抄什么 | 声明式元数据 + `toContracts()` 单向投影：元数据只写一处，执行/调度/审批三处共读 |
| 不抄谁 | pi（`AgentTool` 6 字段太薄，审批/风险/超时全推给外层，插件工具无法自描述） |

### 最优设计细节

- `ToolMetadata`（`oss/zcode/apps/zcode-cli/packages/core/src/tool/types.ts:68-96`）：name/description/modelInstructions/allowedInPlanMode/**readOnly**/**destructive**/**concurrentSafe**/requiresUserInteraction/timeoutMs/**maxOutputBytes**/**sideEffectScope**/**riskLevel**/**needsApproval**/providerVisible/**stopTurnOnSuccess**/mcpPresentation。
- `toContracts(): ModelToolContract[]`（`tool/registry.ts:19,104`）——声明即契约，消费点三处：执行器、调度器（`tool/scheduler.ts:85-102`）、审批（`tool/types.ts:343` `resolvePermissionRulePolicy?`）。
- `stopTurnOnSuccess` 的注释明确"这是工具的内在能力声明（像 concurrentSafe/destructive），由 executor 读取，而不是在调用点按工具名猜测"（`tool/types.ts:82-88`）——正对我方 `src/policy/gate.ts:73-74`（EDIT_CLASS_TOOLS / WRITE_CLASS_TOOLS 按名硬编码）的病灶。
- `ToolEntry` 另含 aliases/modelContentProtection/maxModelChars/handler/validateInput/resolveInput/prepareApproval/inputSchema/timeout/cancellation（`tool/types.ts:278,327,357`）——声明面与运行时面分离。
- 我方已有优势保留：`deferrable` 延迟 schema 加载（`src/kernel/tools/registry.ts:73,251-259`）优于 zcode 默认；`truncate.ts`（51200B/2000 行）+ `boundOutput` 唯一出口；`contract.ts` 执行态/落盘态分离。

为什么四条综合最好：① 能力完整——唯一把"工具自描述"做全（并发/副作用/风险/审批/终态/展示一条链）；② 轻得有度——全是可选字段 + 一次投影函数，不是新子系统；③ 可插——调度器只读声明、不认识工具名，插件工具天然可参与；④ 安全——审批/计划模式读声明而非按名硬编码，缺声明即从严可 fail-closed。

### 接入我们内核

- `src/core/primitives/tools/registry.ts`（现 `src/kernel/tools/registry.ts:41` 的 `ToolDef` 8 字段）：W5 加 `readOnly/destructive/sideEffectScope/needsApproval/riskLevel/maxOutputBytes` + `concurrentSafe`（供 §7）+ `stopTurnOnSuccess`（终态工具）；缺声明 = 从严，沿用 `runtimeMeta` 快照机制（`registry.ts:220-223`）。
- `src/core/contracts/tools.ts`：`ToolMetadata`/`ModelToolContract` 形状进 contracts（§1.2 清单第 6 行）；`toContracts()` 唯一实现在 `primitives/tools/registry.ts`。
- 消费点改造：`src/policy/gate.ts:73-74` 改为"读声明 + 内置工具按名兜底"；`src/core/primitives/tools/scheduler.ts`（W6）只读声明。审批裁决仍走 `src/policy/chain.ts` fail-closed 链（声明是输入、policy 是裁决，W13 顺延不动，总体方案 §7:450）。
- 批次：批 3（W5）；`contracts/tools.ts` 属批 2。

### 成本与风险

- 成本：**中**（8 个声明点 + 三处消费点 + 测试）。
- 风险：审批语义部分前移到声明后，"声明 vs policy"双路径必须明确唯一事实源，否则 fail-open 风险（`src/policy/chain.ts:20-23` 明令禁止）；前置依赖：批 2 契约下沉。

### 为什么不选别家

- codex：`ToolExecutor` trait + `CoreToolRuntime` 默认实现（`tools/src/tool_executor.rs:106-127`、`core/src/tools/registry.rs:61,66,71,109`）与 `finishes_on_cancellation` 显式化，是"零成本覆写"的漂亮范式，但 Rust 绑定 + 583 文件 core；唯一值得低成本的借鉴是 `ToolExposure` 三态（Direct/Deferred/Hidden，`tools/src/tool_executor.rs:51-60`）比我方 `deferrable` 二值更细，建议 W5 顺手表达。
- opencode：`Definition` 输入输出双向 Effect Schema 校验（`core/src/tool/tool.ts:20,75-82,140`）值得学"出口也校验"，但审批只有 `permission?: string`，无风险/副作用/终态声明。
- dsh：`tools` 包的 pre/guard/around/post/result 执行管线（`packages/core/tools/src/index.ts:1-20`）是中间件最优，但元数据面窄且绑定 cordis。
- pi-desktop：工具声明是编进 agent-runtime 的 fixed-tool-declarations，插件只能经 `contributes.agentExtensions`（`packages/plugin-sdk/src/index.ts:128,1536-1542`）扩展，契约本体无更多可抄。

---

## §7 工具调度

| 项 | 结论 |
|---|---|
| 最优范式来源 | zcode |
| 抄什么 | `ToolScheduler`：拓扑排序 → 并行分组 → 环检测，纯元数据判定 + 并发上限 + generator 逐组产出批次事件 |
| 不抄谁 | pi（无调度器，任一 `executionMode==="sequential"` 即全串行，否则 `Promise.all` 全并行、无上限） |

### 最优设计细节

- `schedule()` 三步：`topologicalSort`（`oss/zcode/apps/zcode-cli/packages/core/src/tool/scheduler.ts:105`）→ `groupByParallel`（`:154`）→ `validateNoCycles`（`:204`），返回 `{items, parallelGroups, executionOrder}`（`:50-103`）。
- 判定链 `canRunInParallel`（`:85-102`）：`destructive → false`；`concurrentSafe` 显式 true/false 优先；`readOnly → true`；否则 `sideEffectScope === "none"`；无声明时按工具名查 `readOnlyTools` 兜底。**调度器不认识工具名，只读声明**。
- `DEFAULT_MAX_CONCURRENCY = 10`（`:48`，构造可注入 `:56`）。
- 执行侧 generator：`executeToolSchedule` 逐组产出，组边界发 `batch_start` / `batch_complete`（`core/src/tool/executor/batch-runner.ts:56`）——批次边界进事件流、可观测。
- 补强（dsh 的正确性要求）："results and result context remain model-ordered" + "abort stops replenishment and drains started calls"（`packages/core/agent-loop/src/tool-calls.ts:1-14`）——把"结果保模型序"写成调度器验收不变量（我方现在靠 `byCallId` Map 回填，`loop.ts:1238`）。

为什么四条综合最好：① 能力完整——拓扑/分组/环检测/上限/批次事件五件齐；② 轻——单文件约 220 行，移植为 ≈150-250 行 TS；③ 可插——判据全来自声明，插件工具声明并发属性即可参与（我方现状 `isParallelTool` 硬编码在 loop，插件无法表达）；④ 安全——`destructive` 永不并行、成环 fail-closed。

### 接入我们内核

- `src/core/primitives/tools/scheduler.ts`（W6 新建，总体方案 §1.3:162、§2.4:285、§4:372）：`scheduler.run(calls, ctx)` 返回保模型序的结果数组；输入 `{toolCallId, toolName, arguments, dependsOn?}` + registry 元数据快照。
- loop 改造：删 `src/core/primitives/loop/loop.ts:1218-1245` 的 `RwLock` + `Promise.all`（现 `src/kernel/loop.ts` `toolLock:1218` / `Promise.all:1230` / 读写在 `:1233`），`runParallelTools` 改调 scheduler；`src/core/skeleton/rw-lock.ts` 保留给其它用途或批 8 清理（总体方案 §2.1:248 已注"r 角色由 scheduler 接管"）。
- 映射：`parallel` → `concurrentSafe`；`dependsOn` 先留可选（内置工具无依赖，插件编译/语言类可用）。
- 批次：批 3（W6，先 W5 再 W6）；出口闸 `steer.snapshot.test.ts` + `builtin.test.ts`（总体方案 §8:465）。

### 成本与风险

- 成本：**小-中**（新文件 ≈150-250 行 + 删旧路径）。
- 风险：调度顺序变化会改工具事件顺序 → 触碰缓存锚/投影（批 6 红线），须先落"保模型序"断言；`maxConcurrency=10` 与后台 shell / 子代理上限（我方后台子代理也是 10）的叠加已存在于现状，仍需确认语义；前置依赖：W5 元数据（同批）。

### 为什么不选别家

- dsh：批次语义比 zcode 更细（独占屏障 + 有界滚动池 + 结果保序 + abort 合成结果），但是 agent-loop 内部实现、非独立可测原语，且无元数据驱动判定——吸收为正确性清单，不作结构来源。
- codex：`RwLock` 读/写二档（`core/src/tools/parallel.rs:51,213-216`）+ `StepContext` 保存"广告该工具的 step"（`:49,128`）与我方现状同构（`loop.ts:936,944`），但无拓扑/分组/上限。
- pi：任一 sequential 即全串行、否则 `Promise.all`（`agent-loop.ts:517,646`），无上限、无批次边界。
- opencode：无调度器（Effect `FiberSet` 代偿），无上限、无拓扑。
- pi-desktop：`turn-queue.ts:179` 管的是回合准入，不是工具调度。

---

## §8 上下文与压缩

| 项 | 结论 |
|---|---|
| 最优范式来源 | dsh |
| 抄什么 | 压缩 = "一族可组合后端包"（basic / image-offload / tool-result-pruner / command），内核零压缩只留挂点 |
| 不抄谁 | codex（6+ `compact*.rs` 含 remote history v2，面最宽但全在 583 文件 core 内，最重） |

### 最优设计细节

- 后端家族：`packages/compaction/` 五个包——`compaction`（核心，含 `tool-pairing.ts` / `checkpoint.ts`）、`compaction-basic`（默认 replay-aware 后端）、`compaction-image-offload`、`compaction-tool-result-pruner`、`command-compact`（`oss/deepseek-harness/packages/compaction/` 目录即清单）。
- 边界显式：`compaction-basic/README.md:8-14`——"condenses the oldest history into a summary while preserving recent messages; after a context-overflow error, it condenses and retries… optionally trim oversized tool outputs first… It cannot reduce the system prompt, tools, or session prefix, or split one indivisible unit such as a single huge tool call."
- 正确性：`tool-pairing.ts` 保"工具调用/结果"成对；`checkpoint.ts` 保回放边界；replay-aware 后端（`compaction-basic/src/index.ts` 头注）。
- 内核侧零压缩：`packages/core/` 无 compaction 包，压缩属顶层同级包组——与我方"内核只留两挂点"同构。
- 我方覆盖面更宽（保留）：downshift / rapid-refill（`src/context/compaction.ts:31,52,70` 的 `RapidRefillError` / `model-downshift`）、result-trim、prefix-anchor，是 zcode/opencode 没有的。

为什么四条综合最好：① 能力完整——基础压缩 + 图像卸载 + 工具结果裁剪 + 命令入口四类都覆盖；② 轻——内核零压缩、每包单一职责；③ 可插可替换——唯一把压缩做成"后端家族"的，换一个后端不动其它；④ 正确性——replay-aware、工具配对不切断、溢出重试一次、不可压缩区显式声明。

### 接入我们内核

- 核内挂点（不动）：`src/core/primitives/loop/loop.ts` turn 首个模型请求前的 `beforeFirstModelRequest`（现 `src/kernel/loop.ts:331,704-705`）+ `src/runtime/assembly.ts` turnEnd 层（现 `src/kernel/assembly.ts:925-934`）+ 批 3 下沉的 `primitives/session/{result-trim,prefix-anchor}.ts`。
- 契约：`src/core/contracts/` 增 `CompactionBackend` 形状（`{shouldCompact, compact, protectedRegions, toolPairing}`），`src/context/` 引擎实现它；批 7 之后由 context 插件按 dsh 粒度拆成独立可替换单元（basic / image-offload / tool-result-pruner / command）。
- 与总体方案对齐：W11 已定"批 3 只下沉循环必需件，引擎留 `src/context/`，批 7 后作 context 插件接管"（总体方案 §7:449）——本节给该路径补上 dsh 的"后端家族 + 边界声明"形状。
- 批次：批 3（下沉两件）+ 批 7 之后（后端家族化）。

### 成本与风险

- 成本：**中-大**（引擎家族化 + 契约冻结 + 回落路径）。
- 风险：`assembly.compaction.test.ts` 是唯一护栏（总体方案 §7:449），装载方式一换即高风险；必须保证"插件接管失败 → 回落原行为"（总体方案 §4 批 7:376）；前置依赖：批 3 挂点下沉 + 批 5 装配外置。

### 为什么不选别家

- pi：`packages/agent` 无任何 compaction 引用（内核零压缩的存在性证明），引擎在 `coding-agent/src/core/compaction/compaction.ts`（`shouldCompact:267` / `findCutPoint:446` / `estimateContextTokens:196` / `compact:965`）是纯函数 + session manager 管 IO——分层干净但无后端抽象、不可替换。
- zcode：microcompact（保最近 5 条、比例 0.9 + 缓冲 2K + 最小省 256 token）+ autoCompact 双源 + 3 次失败熔断（`core/src/compact/policy.ts:10,28,86,90`、`microcompact.ts:14-19,78-79`）参数最讲究，但单一实现、不可插拔、全在 core。
- opencode：`compactAfterOverflow` 溢出只恢复一次（`core/src/session/compaction.ts:176,178,242`）语义保守可借鉴，但在 core 内、不可插拔。
- codex：多级 + 远程压缩（`compact.rs` / `compact_token_budget.rs` / `compact_model_fallback.rs` / `compact_remote_history.rs` / `compact_remote_v2*.rs`）面最宽，也最重。
- pi-desktop：压缩委托上游，本地只做 TurnPersistence / checkpoint / result-summary（`packages/host-runtime/src/index.ts:7,9,20`）——"持久化与压缩分离"已体现在我方 runtime/context 分离。

---

## 收尾：采纳优先级（按 成本 × 收益）

| 序 | 项 | 来源 | 成本 | 批次 |
|---|---|---|---|---|
| 1 | 治理补维（`maxContractLines`/`maxPublicMethods`/`architecture:context`） | zcode | 小 | 批 0（W1） |
| 2 | `PROTOCOL_VERSION` + hello 首帧（+ 可选 framing 拆分） | pi | 小 | 批 0/1（EP-9） |
| 3 | `ToolScheduler`（拓扑/分组/环检测/上限/批次事件） | zcode | 小-中 | 批 3（W6） |
| 4 | 装配数据化 + 驱动可替换槽位 | dsh | 中 | 批 5（EP-10） |
| 5 | 工具契约元数据 + `toContracts()` 单向投影 | zcode | 中 | 批 3（W5） |
| 6 | abort 合成结果（replay 无损）+ 循环可替换 | dsh | 中 | 批 3（W7） |
| 7 | 压缩后端家族化 + 边界声明 | dsh | 中-大 | 批 3 下沉 / 批 7 后（W11） |
| 8 | 插件权限闭集 + 单一网关 + 热重载上限 | pi-desktop | 大 | 重构后（W15，EP-11/12） |

覆盖说明：本组 8 个功能全部覆盖。未逐行复核项：`tools/architecture-check.mjs` 现有规则清单（§2 接入建议以"若已有则只补两条"表述）；codex `registry.rs:970`/`orchestrator.rs` 行数（§6/§7 未依赖该锚点）。参考仓源码只读，未修改 `oss/` 或 `src/` 任何文件。
