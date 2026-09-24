# ZCode 深读（zai-org/ZCode，Apache-2.0）

> 形态与我方最接近的仓：桌面 + 浏览器 + 终端 + Agent 运行时

> **本文件由以下轮次产出合并而成** —— 内容按原顺序保留，未改写，仅合并标题层级：
>
> - `10-zcode.md` —— 第一轮：架构即代码 / CONTEXT.md / owner+lease / 子进程 agent
> - `12-zcode-agent-loop.md` —— 第二轮：turn 状态机 10 相位 / 审批改参数 / 79 事件 / 权限 broker
> - `19-zcode-execution.md` —— 第三轮：CompactPhase / 压缩抖动硬失败 / 执行点重算 / steer 排空点
>
> 合并前的独立文件已删除（成为空号）；git 历史仍可追溯。

---

<!-- merged from 10-zcode.md -->

## ZCode（zai-org/ZCode）—— 形态最接近我方的一个仓

> 用户指令："继续读然后记录，好好读，**多看一些仓库**"。
> **本仓是我前几轮的完全空白** —— `oss/SOURCES.lock` 里有它（`872ad96`，Apache-2.0，122M），
> 但我此前一行未读。**这是本轮最大的补漏。**
> 所有引用本机实测，路径可复现。

---

### 0. 为什么这个仓最该看

`README.md` 原文：

> ZCode 是 AI 编程工作台，提供**桌面应用、浏览器界面和终端 Agent**。本仓库包含客户端、后端服务、
> 共享 UI，以及 **Agent CLI 与运行时源码**。
>
> | Desktop | **Electron** 桌面应用 |
> | Web / ZCode 命令行版 | 终端与浏览器工作台；将 TUI、Web、后端和 Agent 组装为独立运行包 |
> | Agent CLI | 在终端中使用 `zcode`，也为 Desktop 和 Web 提供 Agent 运行时 |

**一个仓同时有：桌面端 + 浏览器端 + 终端 + Agent 运行时。**
对照我方：Q4 桌面端、Q6 可多端、Q1 Windows 本地、Q3 飞书。
且它 **Apache-2.0**（可参考实现），还有**飞书社群**入口 —— 它的用户群与我方 Q3 的选择同源。

**这是我读到现在，产品形态与我方最接近的仓。**

---

### 1. 架构即代码：`architecture-policy.yaml`（**可直接采用**）

`oss/zcode/architecture-policy.yaml`（67 行）是一份**可执行的架构策略**：

```yaml
version: 1

## 存量模块先标记为 legacy；新模块或完成迁移的模块设置 managed: true。
modules:
  - id: session
    roots: [packages/services/src/session]
    managed: false
    requires: [shared]
    publicEntrypoints: [packages/services/src/session/contract.ts]
    owner: conversation
  - id: storage
    roots: [packages/services/src/storage]
    managed: true
    requires: [shared, rpc, services]
    publicEntrypoints: [packages/services/src/storage/contract.ts]
    layers: { domain: domain, app: app, adapters: adapters }
    layerOrder: [domain, app, adapters]
    owner: desktop-settings

global:
  maxFileLines: 400
  maxContractLines: 300
  maxPublicMethods: 12
  forbidCycles: true
  forbidDeepImports: true
  managedOnly: true

exceptions: []
```

**六个要素值得逐条看：**

1. **硬上限**：`maxFileLines: 400`、`maxContractLines: 300`、`maxPublicMethods: 12`
   —— **文件长度是可执行的规则，不是风格建议**。
2. **`forbidCycles: true` / `forbidDeepImports: true`** —— 依赖方向与深导入由策略强制。
3. **`requires:`** —— 每个模块**声明它允许依赖谁**，未声明即禁止。
4. **`publicEntrypoints:`** —— **模块的公开面是一个文件清单**。这与我方模块映射的思路一致，但它是**强制的**。
5. **`layers` + `layerOrder`** —— 模块内部还可再分层并规定层序。
6. **`owner:`** —— **代码归属写在策略里**。

#### 1.1 最聪明的一点：`managed: false/true` 的渐进采用

存量代码不可能一次性满足架构约束。它的做法是：
**每个模块标 `managed`，全局 `managedOnly: true` —— 只对已完成迁移的模块执行检查。**

**这是"如何在一个既有代码库里采用一条新架构规则"的答案。**
注意 `storage` 是 `managed: true` 而 `session` 还是 `false` —— **迁移是一个模块一个模块进行的，且状态在文件里可见。**

#### 1.2 配套的三个命令（`AGENTS.md` 实测）

| 用途 | 命令 |
| --- | --- |
| 架构检查 | `pnpm architecture:check --changed` ← **只查改动** |
| **模块阅读包** | `pnpm architecture:context <module-id>` |
| 未使用依赖与导出 | `pnpm knip` |
| 导出引用查询 | `pnpm dep:refs --list-exports <file>` |

**`architecture:context <module-id>`（"模块阅读包"）是我完全没想到的东西**：
给定模块 id，产出一份**读这个模块所需的上下文包**。
它对人有用，**对 agent 尤其有用** —— 这正是"给 agent 喂对的上下文"的工程化解法。

> **对我方的建议**：我方目前只有 `AGENTS.md`（规范）与 `docs/`（文档），
> **没有任何机器可校验的架构约束**。`tools/` 下全是调研脚本（clone-all / license-detect / count-features），
> 没有一条约束代码形状的。→ **建议 ID：T1，P1**（详见 §7）。

---

### 2. `CONTEXT.md`：带"禁用词"的领域词汇表

`oss/zcode/CONTEXT.md`（81 行）是**插件商店**这个限界上下文的词汇表。
**每个词条除了定义，还有一行 `_Avoid_:` 列出被禁用的说法**：

```
**Official Marketplace（官方市场）**:
ZCode 官方运营的唯一分发渠道，市场 id 为 `zcode-plugins-official`…
是"分发渠道"而非"作者归属"——其中可以收录社区作者的插件。
_Avoid_: "官方"泛指一切受信市场

**Manual Refresh（手动刷新）**:
商店页顶栏刷新按钮触发的全市场刷新，不受自动刷新节流影响。
_Avoid_: 刷新、检查更新（口语可用，文档统一"手动刷新"）
```

文件头：**"本文件统一定义商店相关术语，供页面、服务和文档使用。"**

**为什么这对我方特别重要**：我前几轮**最大的一个发现就是术语冲突** ——
pi 的 `turn` 指"一次模型回复+其工具调用"，DSH 的 `turn` 指"用户轮"，
**同一个词在两家指不同东西，我据此改了 L0 的整个生命周期层数**。

**如果我们有一份带 `_Avoid_` 的词汇表，这个冲突在第一次写下来时就会暴露。**
我方 `docs/requirements.md` 有 303 项功能跨 19 层，**没有词汇表**。

**另一个要点**：它是**每个限界上下文一份**（这里只讲插件商店），不是一份巨型词表。

> **建议**：为我方核心域建 `docs/glossary.md`，**每个词条必须带 `_Avoid_` 行**。
> → **建议 ID：T2，P1**。

配套还有两条产品状态定义值得记（我方 I 层会遇到）：
- **Restorable Builtin**：被用户卸载的内置插件，**"应用重启不得自动重新播种"**
  —— 卸载必须持久化为抑制状态，否则每次重启都复活
- **Orphaned Installed Plugin**：来源已删除但安装目录与用户数据保留；**仍可用/可配置/可卸载，来源重新添加前不能更新**

---

### 3. N 层：owner + lease + 类型化 owner 命令（比 OpenCode 更完整的答案）

`packages/services/src/session/sessionRealtimePort.ts`（45 行）是我目前读到**最完整的多端契约**：

```ts
export interface SessionRealtimePort {
  readonly hostId: string;
  readonly deliveryKind?: TaskRealtimeHostDeliveryKind;
  publish(event: TaskRealtimeEvent): void;
  acquireTaskRunLease(request): Promise<TaskRunLeaseResult>;
  releaseTaskRunLease(target: TaskRunLeaseTarget): void;
  publishStreamOp(target: TaskStreamMirrorTarget, op: TaskStreamMirrorPublishOp): void;
  requestOwnerCommand(command: ...): Promise<TaskOwnerCommandResult>;
  onDidReceiveEvent(listener): { dispose(): void };
  onDidReceiveOwnerCommand(listener): { dispose(): void };
  publishOwnerCommandResult(result: TaskOwnerCommandResult): void;
  dispose(): void;
}
```

**`requestOwnerCommand` 的命令是闭集**（原文展开）：

```
stop_generation | respond_permission | respond_elicitation
respond_workspace_hook_review | enqueue_task_command
promote_task_command | cancel_task_command
```

#### 3.1 与 OpenCode 的 `Deferred` + `Map` 对比

| | OpenCode（我方现学） | ZCode |
| --- | --- | --- |
| 审批如何从别的端回来 | 任意端调 `reply(id, decision)`，唤醒 `Deferred` | **`respond_permission` 作为命令发给该 run 的 owner** |
| 有没有"归属" | 无 —— 请求进 `pending: Map` | **有 owner**（`hostId` + lease） |
| 发起端能否知道结果 | `reply` 返回 void | **`publishOwnerCommandResult` 回传结果** |
| 并发保护 | 无 | **`acquireTaskRunLease` / `releaseTaskRunLease`** |
| 可请求的动作 | 只有"回答审批" | **闭集 7 条命令**（停止生成、回答权限、回答 elicitation、hook 复核、入队/提升/取消任务） |

**四条差距都是实质的**：
1. **owner 是显式的** —— 命令有去处、结果有来处；`reply` 是往 Map 里投币
2. **结果会回传** —— 发起端知道成没成
3. **lease 保护 run** —— 这正是我方 Q6"会话级互斥"要的东西，但它是**租约**（可从 owner 申请/释放），不是一个本地锁
4. **命令是类型化闭集** —— "远端能请求什么"是被枚举的，而不是开放的

**另外**：`respond_elicitation` 说明他们把 **MCP elicitation**（MCP 向用户提问）也走同一条命令通道 ——
**审批、elicitation、hook 复核三种"需要人回答"的东西共用一套路由**。这比我方"审批走一条路、别的另说"更统一。

`DELIVERY_KIND` + `hostId` 说明**每个界面是一个 host**，且有投递方式之分（TUI / 桌面 / Web / 移动）。

#### 3.2 `zcodeSessionEventCoalescer.ts`

事件**合并器**。我方 §6 有"1 万事件投影 < 200ms"的指标，**合并是达到它的手段之一** ——
本仓把它做成了一个独立模块。

---

### 4. Agent 是一个独立子进程

`packages/services/src/zcode-agent/`（29 个文件）实测，其中：

```
zcodeAgentProcessManager.ts      ← 子进程启动、复用、超时回收、runtime identity
zcodeStdioTransport.ts           ← stdio 传输
zcodeProtocolTransport.ts / zcodeProtocolClient.ts
agentStderrCollector.ts          ← 收集子进程 stderr
zcodeAgentConnectionScope.ts
```

`zcodeAgentProcessManager.ts` 顶部有一条**带理由的架构豁免**（原文）：

```ts
/* eslint-disable max-lines -- zcodeAgentProcessManager 集中维护 agent 子进程启动、复用、
   超时回收和 runtime identity，拆分会扩大进程生命周期状态同步面 */
```

**这条注释本身就是一个可学的做法**：架构策略规定 `maxFileLines: 400`，
而**违反它的地方必须在同一文件、同一条抑制语句上写明理由**。
（对照 `architecture-policy.yaml` 里还有一个顶层 `exceptions: []` 空列表 —— 全局例外目前为零。）

**架构含义**：**界面（Electron / Web / CLI）↔ 协议 ↔ 独立 agent 进程**。
`findZCodeAgentRuntimeBinary` / `findZCodeAgentRuntimeNodeBundle` 说明运行时**可以是原生二进制或 Node bundle**。

对照我方 **Q7**（内核 TS + P1 Windows 原生 helper 用 Rust，"语言边界即进程边界"）：
**ZCode 把整个 agent 都放在了进程边界之外**，我方目前的设计是内核在进程内、只有 helper 出进程。
**这是一条需要明确的架构分歧**（见 §7 待定7）。

另外两处细节：
- `sanitizeZCodeRuntimeEnv` —— **传给子进程的环境变量要清洗**
- `parseZCodeProcessDiagnostic` 对 name / message / stack **各设长度上限**
  （`*_MAX_CHARS`）—— 边界校验落在诊断数据上，符合我方 AGENTS.md §6

---

### 5. 两个我方没有的产品机制

#### 5.1 闲时任务（`offPeakTask`）—— 把长任务排到便宜的时段

`packages/services/src/session/offPeak*`（5 个文件）。中文注释原文：

> 闲时任务管理服务通道（与 automation 服务面互不复用）。
> renderer 经 ProxyChannel 直连（codingPlanSubscription 同款范式）；
> **轮询/取号/核销由服务内部驱动，不暴露给 renderer**。

**"取号 / 核销"** —— 用户为长任务**取一个号**，闲时窗口开启时**核销**执行。
即：**把"现在就想跑但要花钱"的任务，排队到便宜的时段执行。**

我方 M 层（长任务）有 idle 回收、目标续跑，**没有"择时执行"**。
对 Q2（只有我自己）+ Q8（所有生产开销都要高效）而言，**这是一个直接省钱的机制**。
注意它的边界写得很清楚：**与 automation 服务面互不复用**，且**轮询/取号/核销不暴露给 renderer**。

#### 5.2 CUA 的 Windows 原生 helper 与画中画（`cua-permission-broker`，1,928 行）

```
windowsCuaDevHelperHost.ts       506
windowsCuaDevRuntime.ts          571
windowsCuaHelperHostSupport.ts   239
cuaPermissionService.ts / cuaHelperInstaller.ts
cuaPipSession.ts / cuaPipSessionService.ts
cuaAgentAdmissionGate.ts
```

三件事对我方直接相关：

1. **Windows 上做 GUI 自动化要装一个原生 helper** ——
   这与我方 Q7"Windows 原生隔离 helper 用 Rust"是**同一类问题的同一个答案**：
   **Windows 上的能力必须靠原生组件，且要能安装、托管、回收。**
2. **`cuaPipSession`（画中画）** —— 把 agent 正在操作屏幕的过程显示在一个浮动窗口里。
   **这是"让用户看得见 agent 在做什么"的界面解法**，我方 K 层没有对应物。
3. **`cuaAgentAdmissionGate` 用 epoch/generation 做准入**（`nextEpoch` / `activeEpoch` / waiters），
   且**已弃用**，弃用说明写得极准：
   > 默认 CUA 装配已不再注入该准入屏障，仅为旧调用方保留兼容导出。
   > 当前 Helper recovery 只影响后续 Agent admission，不会阻塞或回收已有 Agent。
   > **这里不持有 workspace/session 状态。**

   **这是 generation/epoch 模式的第四次出现**（DSH ADR 0041、pi-desktop ADR 0053、我方 M8），
   且弃用时**明确说明它不拥有什么** —— 与 hermes-agent 的弃用纪律一致。

---

### 6. `AGENTS.md` 里四条可取的工程实践

`oss/zcode/AGENTS.md` 原文摘录：

1. **spec 先行，且列出 spec 必须包含什么**：
   > 新增或修改行为前，**先更新对应 spec**；目录不存在时按需创建。
   > 先明确**产品规则、状态所有者、接口和验收场景**，再实现代码。

   "**状态所有者**"（state owner）是其中值得单独记的一项 —— 与 §1 的模块 `owner:` 呼应。
2. **文档不得描述已删除的功能**：
   > 说明中只保留当前仓库提供的功能、命令和文件；**删除功能时同步清理指令和技能中的引用**。
3. **区分已确认与未确认**：
   > 结合源码、日志和运行时证据，**区分已确认原因与待验证假设**。
4. **开工前检查基线**：`node scripts/check-workspace-freshness.mjs`

---

### 7. 对我方的净影响

#### 7.1 建议新增（**未写入需求文档，待你确认**）

| 建议 ID | 内容 | 依据 | 优先级 |
| --- | --- | --- | --- |
| **T1** | **架构即代码**：一份可校验的策略文件（文件行数上限、禁止循环依赖与深导入、模块依赖白名单、公开入口清单、模块 owner），配 `architecture:check --changed` 只查改动、以及**渐进采用**（模块级 `managed` 开关） | ZCode `architecture-policy.yaml` | **P1** |
| **T2** | **带禁用词的领域词汇表**（每词条必须有 `_Avoid_` 行），**按限界上下文分文件** | ZCode `CONTEXT.md` | **P1** |
| **T3** | **模块阅读包命令**：给定模块 id，产出读该模块所需的上下文包（对人有用，对 agent 更有用） | ZCode `architecture:context` | P2 |
| **N5** | **owner + lease + 类型化 owner 命令**：审批/elicitation/hook 复核**共用一条命令通道**；命令是闭集；结果回传 | ZCode `SessionRealtimePort` | **P0/P1** |
| **N6** | **每个界面是一个 host**，有投递方式之分；run 由**租约**保护（Q6 需要的会话级互斥） | 同上 | P1 |
| **M9** | **闲时任务**：长任务取号、闲时窗口核销执行（择时省钱） | ZCode `offPeakTask` | P2 |
| **K?** | **画中画**：把 agent 的屏幕操作显示在浮动窗口，让用户看得见 | ZCode `cuaPipSession` | P2 |
| **E15** | **事件合并器**作为独立模块（服务于"1 万事件投影 < 200ms"） | ZCode `zcodeSessionEventCoalescer` | P1 |
| **T4** | **架构豁免必须带理由**，写在同一条抑制语句上 | ZCode 的 `eslint-disable -- 理由` | P2 |

#### 7.2 两处需与既有条目合并

- **N5/N6 与 N 层现有条目**：我方 N 层原本学 OpenCode 的 `Deferred + Map`。
  **ZCode 的方案是它的严格超集**（有 owner、有 lease、有结果回传、命令是闭集）。
  **建议 N 层以 ZCode 为蓝本，OpenCode 的 `Deferred` 降为实现细节。**
- **T1 与 AGENTS.md §8**：我方 §8 只说"按变更风险选择静态检查"，**没有具体的架构约束**。
  T1 是给它一个可执行的落点。

#### 7.3 新增待定

**待定7：agent 运行时是否出进程？**
ZCode 把**整个 agent** 放在独立子进程（协议 + stdio）；
我方 Q7 目前是**内核在进程内，只有 Windows 原生 helper 出进程**。
两种都成立，但影响 P0 的模块边界（进程边界决定了哪些状态可以共享、哪些必须序列化）。
**这与待定5（hook 洋葱链）同级：都是 P0 的边界决定。**

---

### 8. 诚实声明（**证据强度分级**）

| 级别 | 内容 |
| --- | --- |
| **整文件读完** | `architecture-policy.yaml`(67)、`CONTEXT.md`(81)、`sessionMailbox.ts`(16)、`sessionRealtimePort.ts`(45)、`README.md`、`AGENTS.md`(前 25 行) |
| **读了文件头注释 + 导出结构** | `zcodeAgentProcessManager.ts`（前 30 行）、`offPeakTask.ts`（前 18 行）、`cuaAgentAdmissionGate.ts`（前 40 行）、`cuaHelperInstaller.ts`（前 8 行） |
| **只读了文件清单与行数** | `cua-permission-broker/` 其余文件、`zcode-agent/` 其余 28 个文件、`zcode-session/` 5 个文件、`apps/zcode-cli/packages/`（**77,980 行，一行未读**） |
| **未读** | **ZCode 的 agent 主循环本体**（在 `apps/zcode-cli/packages/` 里，其中 `product-projection.ts` 5,459 行、`server-operations.ts` 4,049 行、`v4-gateway.ts` 3,436 行）、`packages/formal-proof/`、`packages/zcode-cua/`、`DESIGN.md`(537，只看了目录) |
| **未验证** | "闲时任务取号/核销"的**具体机制**（仅据中文注释与类型名推断）；`SessionRealtimePort` 的**实际实现**（只读了接口）；lease 的**超时与冲突处理** |

> **本仓是我前几轮的完全空白**，本轮建立了结构认知并读到几件可直接采用的东西
> （架构即代码、带禁用词的词汇表、N 层的 owner/lease 方案）。
> **但 ZCode 的 agent 主循环与权限实现仍未读** —— 它在 `apps/zcode-cli/packages/` 的 77,980 行里。
> **不要把本报告当成对 ZCode 的完整评估。**


---

<!-- merged from 10-zcode.md -->

## ZCode agent 主循环精读（zai-org/ZCode，Apache-2.0，`872ad96`）

> 上一轮 `10-zcode.md` 只做了结构认知，我自己在 §8 写明"**agent 主循环与权限实现仍未读**"。
> 本轮补上。范围：`apps/zcode-cli/packages/core/src/` 与 `contracts/src/`。
> 引用行号均已核验。

---

### 0. 一句话

**ZCode 是我读过的唯一一个有"显式、带守卫、非法转移抛错"的回合状态机的仓。**
它的状态机是**记账层**而非执行层 —— 执行在 `runtime/methods/` 里，状态机同步镜像。
事件词汇表 **79 个**（我方 L0 是 13 个），其中有**一整个 `StreamRecovery*` 家族是我方完全没有的**。

---

### 1. ★ turn 状态机：10 个相位、守卫、非法转移抛错

`core/src/agent/turn-state.ts:26-36` 定义 10 个相位：

```
idle → processing_input → awaiting_model_response → streaming
     → scheduling_tools → [awaiting_permission] → executing_tools
     → aggregating_results → completing | error
```

转移表在 `turn-state.ts:230-260` `canTransitionTo()`，是**显式白名单**而非"允许一切"：

```ts
[TurnPhase.AwaitingPermission]: [TurnPhase.ExecutingTools, TurnPhase.Error],
[TurnPhase.Completing]:         [TurnPhase.Idle],
[TurnPhase.Error]:              [TurnPhase.Idle],
```

实现 `core/src/agent/turn-machine.ts:89` `transition()` **非法转移直接抛**：

```ts
if (!canTransitionTo(this.state.phase, phase)) {
  throw createCoreError(CoreErrorType.InvalidTurnPhase,
    `Cannot transition from ${this.state.phase} to ${phase}`,
    { context: { current: this.state.phase, target: phase }, recoverable: true });
}
```

> **对照**：我读过的其他仓（含我方现设计）都是**隐式**生命周期 —— 相位由代码路径体现，
> 状态错了没有任何东西会报。ZCode 把相位显式化，于是"不可能的状态"变成**启动即炸的断言**。
> `docs/review-prompt.md` §三C 要求补的"各仓 loop 的真实状态机"，这是**唯一一个真有的**。

状态机是**不可变状态 + 纯函数**：每次调用返回新 `TurnState`，调用方用
`state.turnMachine = new TurnMachineImpl(state.turnMachine.xxx())` 整体替换。

#### 1.1 一个"今天不可达、但留给后来人的陷阱"（诚实标注：**我未能证明可达**）

`turn-machine.ts:166` `startToolExecution()` 把**所有非 `waiting_permission` 的工具**标成 `running`：

```ts
status: tc.status === "waiting_permission" ? tc.status : "running",
startedAt: tc.status !== "waiting_permission" ? new Date() : tc.startedAt,
```

若一个工具已是 `permission_denied`，再次调用会把它**复活成 `running`**。
转移表也允许 `AwaitingPermission → ExecutingTools`，所以状态机层面**这条路是通的**。

**但我查了全仓调用点：`startToolExecution` 只在 `runtime/methods/turn-tools.ts:153` 被调用一次，
位置在 `scheduleTools` 之后、任何权限请求之前** —— 因此**当前不可达**。
我把它写下来是因为：这是一个**状态机允许、而语义不该允许**的组合，
下一个改动循环的人很容易踩到。**这是"看起来对但实际有坑"的一例**（review-prompt 第六节第 4 问）。

---

### 2. ★ 审批可以"改参数后再批准"

`turn-machine.ts:251` `resolvePermission(toolCallId, decision, modifiedInput?)`：
被批准的工具，其 `input` 会被 `modifiedInput` **整体替换**（`input: modifiedInput ?? tc.input`）。
`core/src/runtime/methods/tools.ts:274` 的真实链路里，`PermissionBrokerResult` 携带四个字段：

```ts
{ decision: "allow" | "deny", reason?, modifiedInput?, permissionUpdates?, resolvedAt }
```

**`permissionUpdates`** —— 一次审批决定**可以携带对权限配置的更新**。

> **对照 Codex**：Codex 的做法是"引擎算出规则提案，用户接受"（模型不能提案）。
> ZCode 的做法是"审批结果本身携带 `permissionUpdates`"。
> **两者都能达成"改权限"，但 Codex 的多一道结构约束**（提案不由模型产生）。
> 我方若采用 ZCode 式，则必须回答"`permissionUpdates` 由谁填、能否由模型填"——**这正是 C35 的那个缺口**。
> **我的建议仍是 Codex 式**（提案由引擎算），ZCode 式的 `modifiedInput` 则值得单独采纳。

**`modifiedInput` 这一条本身很值钱**：用户不必在"按原样执行"和"拒绝"之间二选一，
可以"改成这样再执行"。我读过的其他仓**都没有**这个能力。

---

### 3. 循环续跑策略：工具失败**结束**本回合（有代价的取舍）

`turn-machine.ts:301` `getNextPhase()` 原文逻辑：

```ts
if (phase === Phase.AggregatingResults) {
  const failedTools = toolCalls.filter(
    (tc) => tc.status === "failed" || tc.status === "permission_denied");
  if (failedTools.length > 0)  return Phase.Completing;      // 有失败 → 收口
  return Phase.AwaitingModelResponse;                        // 全成功 → 回模型再转一圈
}
```

**即：工具失败会把整个回合收口，模型没有机会在同一回合内看到错误并重试。**

`failed` 与 `permission_denied` 被同等对待，但二者的正确处置**不同**：
- `permission_denied` → 收口合理（模型不该重试，用户已说不）
- `failed`（瞬时错误、参数写错、文件暂时锁住）→ **收口会让一个可自愈的失败变成用户可见的中断**

对照：pi-desktop ADR 0207 专门给了 **3 次** 编辑重试预算，理由是
"第一次失败暴露语法/范围修正，第二次可能仍在应用那个修正"。
**ZCode 这条策略与之相反。** 我方 F/B 层的重试预算**不要照抄 ZCode**。

> 标注清楚：这是**读代码得到的推论**，我没有读 ZCode 的设计文档来确认这是有意取舍还是简化。

---

### 4. ★ 事件词汇表 79 个，其中 `StreamRecovery*` 是我方完全空白的维度

`contracts/src/events/session.events.ts:83-174`，`SessionEventType` 共 **79 个事件**（脚本计数）。
按家族分：

| 家族 | 个数 | 备注 |
| --- | --- | --- |
| `Session*` | 7 | created/resumed/forked/compacted/title_updated/mode_changed/ended |
| `Turn*` | 6 | started/input_received/complete/error + steer 系列 |
| **`TurnSteer*`** | **7** | queued / delivery_changed / dispatch_changed / drained / rejected / discarded / reordered |
| **`StreamRecovery*`** | **6** | anchor_created / started / anchor_selected / tail_discarded / retry_started / blocked |
| `Model*` | 8 | request/selected/streaming/complete/error/network_status/anomaly_warning + `StreamingToolLedgerUpdated` |
| `Tool*` | 6 | scheduled/started/progress/result/error/batch_complete |
| `Permission*` | 3 | requested/resolved/denied |
| **`WorkspaceHookReview*`** | **4** | requested / settled / **superseded** / admission_updated |
| `HookRun*` | 5 | started/progress/completed/failed/blocked |
| `Compact*` | 4 | started/completed/failed + **boundary**；另有 **`MicrocompactBoundary`** |
| `Subagent*` | 3 | spawned/message/stopped |
| `BackgroundTask*` | 3 | started/updated/completed |
| 其他 | ~15 | rewind_triggered / checkpoint_created / target_changed / target_completion_verification / interrupt / cancel / resume / error … |

#### 4.1 ★ `StreamRecovery*`（6 个）—— 我方 F/J 层的空白

**模型流在响应中途断掉怎么办？** 我方需求文档里**没有这一项**。
ZCode 把它做成了一个**持久化的、多步可观测的过程**：

```
StreamRecoveryAnchorCreated   → 建锚点
StreamRecoveryStarted         → 开始恢复
StreamRecoveryAnchorSelected  → 选中了哪个锚点
StreamRecoveryTailDiscarded   → 丢弃了哪些尾部
StreamRecoveryRetryStarted    → 重试
StreamRecoveryBlocked         → 恢复不了（终态）
```

配套 `StreamRecoveryAnchorCreated` 说明**锚点是先于故障就记下的**（不是事后补）。
`StreamRecoveryBlocked` 是一个**独立的终态**，不是"重试到底"。

> **建议（新增 F 层条目，P1）**：模型流中断的恢复必须是**有锚点、有界、可观测、有终态**的过程：
> ①锚点在流开始时即持久化；②明确"丢弃到哪个锚点"；③重试有界；
> ④恢复不了要有**显式终态**（`blocked`），不是无限重试也不是静默失败。
> **这条同时影响 J 层（重试）与 L 层（可观测）。**

#### 4.2 ★ `TurnSteer*`（7 个）—— 我读到的最成熟的 steer 模型

对照 DSH 的结论（`2026-07-30-followup-enqueue-and-owned-runs.md` "`MessageId` 能证明入队，
但无法标识哪条 assistant 消息是它的结果"）—— ZCode 走得更远，
把 steer 的**每一步状态变化都变成事件**，且注释明确要求**投影不得本地猜测**：

> `// sendQueuedNow 原子提升：reservation/promoting/rollback 均进入事件流，投影不本地猜测。`
> `// guide 未遇到可用 tool batch 即收口时，原 intent 原地改投普通 queue。`

`TurnSteerReordered` 对应 `// v4 queue 重排：queue 项顺序变化（reducer 按 orderedPendingInputIds 重排 queue rows）`。

**"原子提升的三个中间态（reservation / promoting / rollback）都进事件流"** 是一条很强的纪律：
**投影层永远不需要推断，只需要折叠事件。** 我方 E/N 层可直接采用。

#### 4.3 `WorkspaceHookReviewSuperseded` —— hook 决定可以被推翻

`WorkspaceHookReview*` 四个事件里，`Superseded` 值得单独记：
**一次 hook 复核的结论可以被后来的事件取代，且这个"取代"本身是持久事实。**
配套 `WorkspaceHookAdmissionUpdated`（准入状态变更）。
我方 I 层（扩展/hook）现在只有"问/答"，**没有"已答的可以作废"**。

#### 4.4 两级压缩边界都是事件

`CompactBoundary` 与 **`MicrocompactBoundary`** 并存 —— **微压缩与整压缩各有自己的边界事件**。
`core/src/compact/` 下有 `manual.ts` / `microcompact.ts` / `policy.ts` / `prompt.ts` / `rounds.ts`。
**压缩不是一件事，是两件（或更多）。** 我方 F 层现在只写了一个"压缩"。

---

### 5. 权限 broker：端口 + 默认拒绝 + 超时是带类型的失败

`core/src/permission/broker.ts`。

1. **`PermissionBrokerPort` 是端口（六边形架构）** —— core 依赖接口，各 surface（CLI/桌面/浏览器）各实现。
   与我方 N 层"owner + 租约 + 闭集命令"是同一个方向。

2. **默认实现是 `DenyPermissionBroker`**（`broker.ts:26`），
   工厂函数 `createDenyPermissionBroker()` 明示这是默认：

   > `reason: \`No permission client configured for ${request.toolName}\``

   **没配权限客户端 = 拒绝。** fail-closed 的正确默认。

3. **★ 超时是 `reject`，带类型，不是静默 `resolve`**（`broker.ts:110-125`）：

   ```ts
   timeout = setTimeout(() => {
     fail(createCoreError(CoreErrorType.PermissionTimeout,
       `Permission request timed out after ${options.timeoutMs}ms`,
       { context: {...}, recoverable: true }));
   }, options.timeoutMs);
   ```

   且 **abort → `ToolCancelled`**，与超时**分开**。

   > **这正是 hermes-agent 那个 bug 的正解。** 我在 `08-kernel-deep-read.md` 记过
   > `hermes-agent/gateway/run_turn_runner_approval_settle.py` 的静默超时（审批超时后
   > 无声地把结果当默认值）。ZCode 与 Codex 都是**显式带类型地失败**。**两个独立实现给出同一答案，
   > 这条应当进我方 C 层的硬要求。**

4. `ManualPermissionBroker` 用 `settled` 标志防重复结算，`cleanup()` 同时清 timer 与 listener
   （不泄漏）；`resolvePermission` **按 requestId 或 toolCallId 都能查**（容错查找）；
   重复 requestId 直接 `reject`（`InvalidStateTransition`）。

---

### 6. 重要限定：turn-machine 是**记账层**，不是执行层

`startToolExecution` 全仓只被调用一次（`runtime/methods/turn-tools.ts:153`），
`resolvePermission` 的真实实现在 `runtime/methods/tools.ts:274`（走 broker），
而不是 `turn-machine.ts:251`。

**真实执行流程住在 `core/src/runtime/methods/` 里** ——
`turn-tools.ts`、`tools.ts`、`internal-turn-methods.ts`、`agent-runtime.ts`(584 行接口) 等。
这一层才是那 77,980 行的主体。**我本轮读的是它的状态镜像，不是它的主体。**

所以严格说：**我现在能描述 ZCode 回合的"合法相位序列"，但还不能描述它的"实际控制流"。**
两者在正常情况下应当一致，但我**没有验证**这一点。

---

### 7. 本轮对需求文档的净影响（ZCode agent loop 部分）

| 层 | 建议 | 优先级 |
| --- | --- | --- |
| A | **区间状态机显式化**：相位枚举 + 转移白名单 + 非法转移抛错 | **P1** |
| C | **审批支持 `modifiedInput`**（改成这样再执行） | **P1** |
| C | **审批超时/取消必须带类型地失败**，禁止静默默认（与 Codex 独立同证） | **P0** |
| C | **默认权限实现是拒绝**（没配客户端 = deny） | **P0** |
| E | **事件家族化**：79 个事件的规模参照；我方 L0 是 13 个并且应当保持小 | 参照 |
| E/L | **原子操作的中间态（reservation/promoting/rollback）也要进事件流**，投影不猜 | **P1** |
| F | **新增：模型流中断恢复**（锚点/有界重试/显式终态 `blocked`） | **P1** |
| F | **压缩分两级**（microcompact 与 compact 各有边界事件） | **P2** |
| I | **hook 复核结论可被 `superseded`**，且取代本身是持久事实 | P2 |
| N | **权限走端口（Port）**，各 surface 独立实现 | P1 |
| B | **不要照抄 ZCode 的"工具失败即收口"**（与 pi-desktop 3 次重试预算冲突） | **警示** |

**新增待定9：`permissionUpdates` 由谁产生？**
ZCode 允许审批结果携带权限配置更新。**若允许模型填，就是 C35 那个缺口**；
Codex 的做法是引擎算提案、用户接受。**我方要选边。**

---

### 8. 诚实声明：未读

- `core/src/runtime/methods/` 的**主体**（`agent-runtime.ts` 584 行接口背后的实现、
  `turn-tools.ts` 全文、`internal-turn-methods.ts`）—— **只读了片段**
- `core/src/compact/*`（6 个文件）—— **只看了文件名与一个边界事件**
- `core/src/context/builder.ts` 起的上下文体系 —— **未读**
- `bootstrap/src/app/dynamic-workflow-run-*`（**30+ 个文件**）—— **只看了文件名**，
  这是 ZCode 的动态工作流/子 agent 编排，**完全没读**
- `packages/adapters/`、`tui/`、`browser-use-plugin/`、`superpowers-plugin/`、
  `node-repl-host/`、`swift-bridge/` —— **未读**
- 全部测试文件 —— **未读**（"怎么 mock LLM、怎么断言事件序列"仍未回答）

**本报告是"ZCode agent 回合状态机 + 事件词汇表 + 权限 broker"的精读，不是 ZCode 的精读。**


---

<!-- merged from 10-zcode.md -->

## ZCode 执行层精读（第六轮，用户指定）

> 上一轮我写明：**`runtime/methods/` 的主体（那 7.8 万行的核心控制流）—— 只读了片段**。本轮补。
> 真正的回合循环在 `core/src/runtime/methods/turn-loop.ts:43` `runRegularTurnLoop`。
> `methods/` 合计 **25,587 行**。引用行号均已核验。

---

### 0. 一句话

**ZCode 的循环里有两个我此前完全没想到的机制**：
**①压缩相位 `PreRequest / MidTurn`（与 Codex 独立同证）；②"压缩抖动"的硬失败保护。**

---

### 1. ★ `CompactPhase.PreRequest | MidTurn` —— 与 Codex 独立同证

`turn-loop.ts:60`：

```ts
const compactPhase = state.modelStepCount === 0 ? CompactPhase.PreRequest : CompactPhase.MidTurn;
```

**这正是我本轮在 Codex `analytics/src/facts.rs:467` 读到的 `CompactionPhase:
StandaloneTurn | PreTurn | MidTurn | PostTurn`。**
两个独立团队、两种语言、同一个结论：**压缩有"发生在回合的哪个位置"这个维度，
且 `MidTurn`（回合内部）是一等的。**

这把我记的 **F15（压缩相位，MidTurn 必须支持）从"一个仓的好设计"升级为"两仓独立同证"** ——
再加上我早已记过的 pi-desktop ADR 0030（"只在回合边界压缩无法保护循环内的下一次 provider 请求"，
附 `1,077,172 vs 1,000,000` 的真实事故），**这是三份独立证据指向同一条**。

#### 1.1 循环里压缩被查**两次，在不同粒度**

```ts
await this.microcompactIfNeeded(…);          // 每一轮都查（微压缩）
const autoCompactOutcome = await this.autoCompactIfNeeded(…);   // 全量压缩
```

**微压缩每步都查、全量压缩是独立一步** —— 与 Codex 的 `compact_token_budget`（换窗）
和 `compact.rs`（摘要）分层同构。

---

### 2. ★★ 压缩抖动（rapid refill）的硬失败保护 —— 我此前完全没想到的故障模式

`turn-loop.ts:70-83`：

```ts
const rapidRefill = evaluateRapidRefill(state.compactTracking);
const autoCompactOutcome = await this.autoCompactIfNeeded(…, { rapidRefill, … });
if (autoCompactOutcome === "rapid_refill_blocked") {
  throw createCompactRapidRefillError({
    consecutiveRapidRefills: rapidRefill.consecutiveRapidRefills,
    maxConsecutiveRapidRefills: MAX_CONSECUTIVE_RAPID_REFILLS,
    toolTurnThreshold: RAPID_REFILL_TOOL_TURN_THRESHOLD,
    toolTurnsSinceCompact: rapidRefill.toolTurnsSinceCompact,
  });
}
if (autoCompactOutcome === "compacted") {
  recordCompactSuccess(state, rapidRefill);
  recordCompactHistoryRound(state);
}
```

常量：`MAX_CONSECUTIVE_RAPID_REFILLS`、`RAPID_REFILL_TOOL_TURN_THRESHOLD`。

#### 2.1 这个故障模式是什么

**压缩 → 上下文立刻又被填满 → 再压缩 → ……** 一个**烧钱且不收敛**的循环。
触发条件很现实：上下文里有大量**不可压缩的内容**（超大的系统提示、巨大的工具定义、
某个工具每次都返回巨量输出），于是每次压缩后**立刻**回到阈值以上。

**ZCode 的处置：连续发生超过 N 次就抛错终止回合**，且**错误里带上全部计数**
（连续次数、阈值、自上次压缩以来的工具回合数）—— **可诊断，不是一句"压缩失败"。**

> **建议（F 层新增，P0）**：**压缩必须有"抖动检测"**：
> 记录"自上次压缩以来的工作量"，若**连续多次在极小工作量后再次触发压缩**，则**硬失败**，
> 且错误须携带计数。**否则线上表现是"账单暴涨且看不到尽头"。**
> 这是我读五个仓至今**唯一一个只有 ZCode 有的**故障保护。

---

### 3. `CompactReason.ContextLimit` —— 又一个跨仓同名

与 Codex `CompactionReason::ContextLimit` **同名同义**。两个独立实现的词汇表自发收敛到同一个词，
说明这个分类是**领域固有的**，不是我方的臆造。

---

### 4. ★ 闸门必须在**执行点**用**权威标识**重新推导，不能信被传递的元数据

`turn-loop.ts:99-107`，注释原文（中文）：

> automation 派发到已 active 会话或重试恢复时，**入口 metadata 可能没有带到 loop state**；
> 但 queryId 仍是 `automation-*`。**provider 请求边界必须按 queryId 再硬过滤 automation 写工具**，
> 否则模型会**先看到**并创建、修改或删除任务定义。

```ts
const turnDisallowedTools = buildTurnDisallowedTools(state);
const tools = state.automationCreateLimitReached
  ? []
  : turnDisallowedTools
    ? this.getTools(state.model).filter((tool) => !turnDisallowedTools.has(tool.name))
    : this.getTools(state.model);
```

**这是一条真实修过的 bug 留下的注释**，且结论非常一般：

> **限制性的判定必须从"权威标识"在执行点重新推导，不能依赖一路传递下来的元数据。**
> 因为元数据会在恢复/重试/派发路径上丢失，而**标识仍在**。

对照我记过的 DSH `escalation.ts`（"每次调用不同的约束不得进工具 schema"）——
**同一族原则**：**执行点的真相要现算，不要信更早的信封。**

> **建议（C/B 层，P0）**：**权限与工具可见性的最终判定，必须能仅凭"持久标识"重算**；
> 任何"靠上下文对象携带的布尔标志"来限制的做法都应当被审查掉。
> 这条对**多端与恢复**尤其关键 —— 恢复路径上丢失的元数据就是一个绕过口。

---

### 5. steer 的排空点被逐一区分（正面回答 DSH 那个问题）

`turn-loop.ts:47-53`，注释原文：

> `guide` 只允许由**完整 tool result batch** 设置这个一次性诊断；**普通 queue 不在 model
> roundtrip 起点消费**，避免**把未来 turn 错并入当前 product turn**。

```ts
const drainedSteerForNextRequest = state.drainedSteerForNextRequest;
state.drainedSteerForNextRequest = undefined;
if (state.modelStepCount > 0 && !outputTokenRecoveryActive) {
  const drainedRuntimeCommands = await this.drainPendingRuntimeCommandsForActiveLoop();
  state.backgroundSubagentResultConsumed ||= drainedRuntimeCommands.backgroundSubagentResultConsumed;
  state.workflowResultConsumed ||= drainedRuntimeCommands.workflowResultConsumed;
  …
}
```

**三类输入各有各的排空点**：①一次性 `guide`（由完整 tool result batch 设置）
②普通 queue（**不在** model roundtrip 起点消费）③runtime commands（子 agent 结果、
workflow 结果，`modelStepCount > 0` 时才排空）。

我记过的 DSH 结论是"**`MessageId` 能证明入队，但无法标识哪条 assistant 消息是它的结果**"。
**ZCode 的解法是：干脆不让所有输入在同一个点排空** ——
**来源不同 → 排空点不同 → 归属就确定了**，不需要事后反推。

且排空后**重置重复工具调用签名**（`repeatedToolCallSignature = undefined; repeatedToolCallStreakCount = 0`）
—— 新输入意味着"局面变了"，重复检测的计数应当归零。

> **建议（A/E 层）**：**不同来源的输入在不同边界排空**，并在排空时**重置相关的启发式计数**。

---

### 6. 其他值得记的

**(a) `throwIfTurnAborted(state.turnAbortSignal)` 在每个 await 点之后调用** ——
整个循环里出现十余次。**协作式取消在所有边界上被检查**，不是只在循环头检查一次。

**(b) 输出 token 续跑是一等机制**（`turn-output-token-continuation.ts`）：
`appendTurnRequestEntries` / `commitTurnRequestEntries` / `filterOutputTokenContinuationEntries`，
状态里有 `outputTokenContinuationCount` 与 `outputTokenRecoveryActive`。
**模型撞到输出上限时，循环靠"追加续跑条目"继续，而不是结束回合。**
这与我在 `l0-events.md` 里把 `max-tokens` 列为一种 `TurnEndReason` **不冲突但更细** ——
**ZCode 把它当作"可续跑的中途事件"，不是终态。** 我方应当重新考虑 `max-tokens` 的归属。

**(c) 提醒（reminder）是注入的附件**：`buildTodoReminderBody` / `shouldBuildTodoReminder` /
`needsPlanModeExitReminder` / `buildRuntimeModeReminderBody` / `buildRuntimeOutputStyleReminderBody`，
经 `systemReminderAttachmentEntry` + `todoReminderRuntimeMetadata` 注入。
**与 pi-desktop 的 `RolloutBudget` 提醒同族**（提醒是要送达模型的事实）。

**(d) `beginLocalTurnPreparation(ctx, "mcp"|"tools")`** —— 循环内为每个阶段打点，
做**局部分段计时**（`finishMcp()` / `finishTools()`）。

**(e) `methods/` 的规模分布**：`session-fork.ts`(1,487)、`steering.ts`(1,403)、
`subagent.ts`(915)、`turn.ts`(872)、`turn-model-step.ts`(803)、`rewind-message.ts`(740)、
`compact-active.ts`(725)、`file-rewind.ts`(717)、`compact-persistence.ts`(489)、
`compact.ts`(462)、`resume.ts`(453)。
**"压缩"占了 5 个文件近 2,100 行；"回溯/撤销"占了 3 个文件近 2,200 行。**

---

### 7. 对需求文档的净影响

| 编号 | 条目 | 优先级 |
| --- | --- | --- |
| **F22** | **压缩抖动检测**：连续多次"极小工作量后再次触发压缩"→ **硬失败**，错误带全部计数 | **P0** |
| **C63** | **限制性判定必须在执行点用"权威标识"重算**，不得依赖传递下来的元数据 | **P0** |
| **A13** | **不同来源的输入在不同边界排空**（guide / queue / runtime commands 各一个点） | P1 |
| **A14** | 输入排空后**重置相关的启发式计数**（如重复工具调用streak） | P2 |
| **A15** | **协作式取消在每个 await 点后检查**，不只循环头 | P1 |
| **F15** | ✅ **升级为三份独立证据**（Codex 四相位 + ZCode `PreRequest/MidTurn` + pi-desktop ADR 0030 事故） | **P0** |
| **B21** | **输出 token 上限应作为"可续跑事件"**处理，不是回合终态 —— 重新考虑 `l0-events.md` 的 `max-tokens` | P1 |
| **L9** | 循环内**分段计时**（mcp / tools 各自打点） | P2 |

---

### 8. 诚实声明：未读

- `methods/turn-model-step.ts`(803)、`turn-tools.ts`(527) 的**主体** —— 只读了函数签名与调用点
- `methods/steering.ts`(**1,403，steer 主战场**) —— **只读了函数表**
- `methods/session-fork.ts`(1,487)、`subagent.ts`(915)、`rewind-message.ts`(740)、
  `file-rewind.ts`(717)、`resume.ts`(453) —— **未读**
- `compact-active.ts`(725)、`compact-persistence.ts`(489)、`compact.ts`(462)、
  `compact-summary-model-request.ts`(429) —— **只读了 `while(true)` 的位置**
- `runtime/internal-turn-methods.ts`、`internal-hook-methods.ts`、`execution-state.ts`、
  `command-queue.ts`、`permission-grant-recovery.ts` —— **未读**
- `methods/` 之外的 `bootstrap/src/app/dynamic-workflow-run-*`（30+ 文件）—— **两轮都没读**
- `packages/tui/`、`adapters/` —— **未读**
- 全部测试 —— **未读**

**本报告是"回合循环 + 压缩相位与抖动保护 + 权威标识重算 + 排空点区分"四点。**
**`methods/` 25,587 行里我实际逐行读过的不超过 300 行。**
