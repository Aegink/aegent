# ZCode（zai-org/ZCode）—— 形态最接近我方的一个仓

> 用户指令："继续读然后记录，好好读，**多看一些仓库**"。
> **本仓是我前几轮的完全空白** —— `oss/SOURCES.lock` 里有它（`872ad96`，Apache-2.0，122M），
> 但我此前一行未读。**这是本轮最大的补漏。**
> 所有引用本机实测，路径可复现。

---

## 0. 为什么这个仓最该看

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

## 1. 架构即代码：`architecture-policy.yaml`（**可直接采用**）

`oss/zcode/architecture-policy.yaml`（67 行）是一份**可执行的架构策略**：

```yaml
version: 1

# 存量模块先标记为 legacy；新模块或完成迁移的模块设置 managed: true。
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

### 1.1 最聪明的一点：`managed: false/true` 的渐进采用

存量代码不可能一次性满足架构约束。它的做法是：
**每个模块标 `managed`，全局 `managedOnly: true` —— 只对已完成迁移的模块执行检查。**

**这是"如何在一个既有代码库里采用一条新架构规则"的答案。**
注意 `storage` 是 `managed: true` 而 `session` 还是 `false` —— **迁移是一个模块一个模块进行的，且状态在文件里可见。**

### 1.2 配套的三个命令（`AGENTS.md` 实测）

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

## 2. `CONTEXT.md`：带"禁用词"的领域词汇表

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
我方 `docs/requirements.md` 有 169 项功能跨 18 层，**没有词汇表**。

**另一个要点**：它是**每个限界上下文一份**（这里只讲插件商店），不是一份巨型词表。

> **建议**：为我方核心域建 `docs/glossary.md`，**每个词条必须带 `_Avoid_` 行**。
> → **建议 ID：T2，P1**。

配套还有两条产品状态定义值得记（我方 I 层会遇到）：
- **Restorable Builtin**：被用户卸载的内置插件，**"应用重启不得自动重新播种"**
  —— 卸载必须持久化为抑制状态，否则每次重启都复活
- **Orphaned Installed Plugin**：来源已删除但安装目录与用户数据保留；**仍可用/可配置/可卸载，来源重新添加前不能更新**

---

## 3. N 层：owner + lease + 类型化 owner 命令（比 OpenCode 更完整的答案）

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

### 3.1 与 OpenCode 的 `Deferred` + `Map` 对比

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

### 3.2 `zcodeSessionEventCoalescer.ts`

事件**合并器**。我方 §6 有"1 万事件投影 < 200ms"的指标，**合并是达到它的手段之一** ——
本仓把它做成了一个独立模块。

---

## 4. Agent 是一个独立子进程

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

## 5. 两个我方没有的产品机制

### 5.1 闲时任务（`offPeakTask`）—— 把长任务排到便宜的时段

`packages/services/src/session/offPeak*`（5 个文件）。中文注释原文：

> 闲时任务管理服务通道（与 automation 服务面互不复用）。
> renderer 经 ProxyChannel 直连（codingPlanSubscription 同款范式）；
> **轮询/取号/核销由服务内部驱动，不暴露给 renderer**。

**"取号 / 核销"** —— 用户为长任务**取一个号**，闲时窗口开启时**核销**执行。
即：**把"现在就想跑但要花钱"的任务，排队到便宜的时段执行。**

我方 M 层（长任务）有 idle 回收、目标续跑，**没有"择时执行"**。
对 Q2（只有我自己）+ Q8（所有生产开销都要高效）而言，**这是一个直接省钱的机制**。
注意它的边界写得很清楚：**与 automation 服务面互不复用**，且**轮询/取号/核销不暴露给 renderer**。

### 5.2 CUA 的 Windows 原生 helper 与画中画（`cua-permission-broker`，1,928 行）

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

## 6. `AGENTS.md` 里四条可取的工程实践

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

## 7. 对我方的净影响

### 7.1 建议新增（**未写入需求文档，待你确认**）

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

### 7.2 两处需与既有条目合并

- **N5/N6 与 N 层现有条目**：我方 N 层原本学 OpenCode 的 `Deferred + Map`。
  **ZCode 的方案是它的严格超集**（有 owner、有 lease、有结果回传、命令是闭集）。
  **建议 N 层以 ZCode 为蓝本，OpenCode 的 `Deferred` 降为实现细节。**
- **T1 与 AGENTS.md §8**：我方 §8 只说"按变更风险选择静态检查"，**没有具体的架构约束**。
  T1 是给它一个可执行的落点。

### 7.3 新增待定

**待定7：agent 运行时是否出进程？**
ZCode 把**整个 agent** 放在独立子进程（协议 + stdio）；
我方 Q7 目前是**内核在进程内，只有 Windows 原生 helper 出进程**。
两种都成立，但影响 P0 的模块边界（进程边界决定了哪些状态可以共享、哪些必须序列化）。
**这与待定5（hook 洋葱链）同级：都是 P0 的边界决定。**

---

## 8. 诚实声明（**证据强度分级**）

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
