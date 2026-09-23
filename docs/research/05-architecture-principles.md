# 深度架构原理（第三轮：精读决策记录）

> 前两轮是**扫文件名与关键词**，第三轮改为**读决策记录**。
> 主要来源：`oss/deepseek-harness/.agents/notes/`（**1177 篇**，含 14 篇 rejected）、
> `oss/pi-desktop/docs/adr/`（**321 篇**）。
> 这些是别人用真实故障换来的结论，比读代码高效得多，也比读 README 深得多。
>
> **每条都标来源路径。所有引用均为实测原文摘意，非推测。**

---

## 0. 这轮最重要的发现：kernel 选型已被验证

`oss/pi-desktop/docs/adr/0002-use-pi-agent-harness.md`，标题即结论，**Status: Accepted**（2026-07-25）：

> **Decision**：用 `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core` 作为内核
> **Rationale**：① 统一 LLM provider 接口 ② **清晰的事件模型，适合桌面 UI**
> ③ 跨工具调用/会话/skills 生态的可扩展性 ④ **LiveAgent 等项目已验证它可作为桌面产品的内核**

**这不是假想验证。** PI-Desktop 是一个已发布产品，它是就此写 ADR 做的决定。
你"Kernel 用 Pi agent-core"的倾向，至少有一个同类产品走过同一条路。

---

## 1. 事件与日志（E / L 层）

### 1.1 事件源的精确形态

`dsh/implemented/architecture/2026-06-11-event-sourced-sessions.md`：

- `Session` = **append-only 的 typed `SessionEvent` 日志，唯一真相**；消息历史由 `deriveMessages()` **派生**
- **原始流分片也记入日志**（token 级回放保真），但**派生时以组装后的 `assistant/message` 事件为准**
- **append 是同步的 —— 热路径绝不阻塞 I/O**；`session/event` 是同步通知
- 持久化插件**缓冲写**，在**每轮 turn 结束**时 await 的 `session/flush` 检查点统一落盘
- **Replay / fork = 用已有日志 seed 一个新会话**

> **对我方 E1/E10 的修正**：我原来只写"事件源 + SQL + 快照前 flush"。实际做法更精确：
> **同步 append + write-behind + turn 末 flush 检查点**，且原始分片与组装消息**都要留**，
> 因为前者保证 token 级回放、后者保证语义正确。

### 1.2 整值事件规则（whole-value event rule）

`dsh/proposed/architecture/2026-07-27-session-projection-and-command-log.md`：

> 携带状态的日志事件**必须携带变更后的完整状态，绝不能是裸 delta**。

给出的四条理由（原文）：
1. 每个域的转换逻辑**极简**（框架按事件驱动）
2. 值在传输中**自描述**
3. **按 seq 比较即可免疫乱序**
4. **自适应自愈 —— 丢一次更新会被下一次纠正**

**这条规则直接可用于我方 E/N 层**：多端同步时，整值事件让"丢推送"从**错误**降级为**延迟**。

### 1.3 持久化事件不得含运行时对象

`dsh/implemented/architecture/2026-07-16-explicit-turn-cancellation.md`：

> **Durable events contain no stack, signal, error object, free-form cancellation text, or backend-private detail.**

配套做法：终态事件只记"这个 turn 怎么了"（粗粒度 `{kind:'aborted'}`），
运行时信号才记"谁请求的取消"；**不把 caller 身份复制进 replay**；
且 session 加载时**拒绝**带 reason 的旧 aborted 记录，**防止 replay 重新引入 caller 细节**。

### 1.4 会话日志版本机制（我 Q1 缺的完整规范）

`dsh/implemented/architecture/2026-08-10-session-log-version-mechanism.md`：

| 规则 | 原文要点 |
| --- | --- |
| **一个单调整数，不搞 major/minor 双段** | "某一步是否可自动升级是**那一步的属性**（由它的 upgrader 是否存在表达），不是两级编号能事先承诺的" |
| **由写入方决定 bump，不是读取方** | — |
| **bump 的判据** | 旧运行时能否对新日志保持**完整语义正确**。"能解析不报错"**不是标准** —— *静默跳过影响重建的内容就是错误读取* |
| 只有结构性变更才算 | header 形状、事件信封、核心事件语义、surface 机制 |
| **拿不准就 bump** | "**近似恒等的 upgrader 几乎无成本，漏掉一次 bump 会静默损坏旧读取方**" |

**还记录了一个真实 bug**：改动前的读取方 `assertVersion` 用**方向盲**的单条消息拒绝任何版本不匹配，
且 JSONL 解码器**把未知事件类型原样透传** → 重建时静默跳过 → 
**"恢复出一个被掏空的会话且毫无诊断"**。

> **对我方 Q1 的修正**：我原来只写"v0→v1→v2→v3 链式迁移"。
> 实际还需要：**未知事件类型必须显式拒绝而非透传**、**方向敏感的错误报告**、**拿不准就 bump**。

### 1.5 命令结果不可恢复（影响 S6 审计）

同 `2026-07-27` 篇：

> `/goal`、`/plan` 等斜杠命令的结果**只存在于 RPC 响应里**，什么都没进会话日志。
> **刷新、换 tab、resume、fork 之后，"这条命令执行过"这个事实就丢了。**

域**状态**变更是持久的（goal 提交 `goal/change`、plan 提交 `plan/mode`），
**但命令的调用与裁决不持久**。

> **对我方 L2 的补充**：审计不只要求记录"工具做了什么"，
> 还要求记录**命令被调用过及其裁决** —— 这是两个不同的持久化对象。

---

## 2. 取消与并发（A / J 层）

### 2.1 取消的词汇表与边界

`dsh/.../2026-07-16-explicit-turn-cancellation.md`：

- `AgentCancelCause = {kind:'user'} | {kind:'parent'} | {kind:'hook'; reason} | {kind:'disposed'}`
- `agent.cancel()` **必须传一个**；TypeScript 在**同进程的强类型边界**上强制，
  **不提供运行时校验器、不提供兜底、不为无类型调用方提供兼容契约**

**一个反直觉的实现细节（值得记，否则会踩）**：

> holder 用**调用方自己的对象**中止，而不是 detach 一份拷贝 —— 这样到达该 signal 的传输层才能扩展它
> （Node 的 `fetch` 会往 reason 上赋 `stack`）。
> **冻结 cause 不是可选项** —— undici 在严格模式代码里做这个赋值，
> 冻结的 reason 会让 `fetch` 抛 `TypeError: Cannot add property stack`，**取代真正的 abort reason**。

### 2.2 协作式取消：必填 signal

`dsh/.../2026-07-19-cooperative-tool-cancellation.md`：

- `ToolExecutionInput.signal` 是**必填 readonly `AbortSignal`**
- 注册表**不提供重载、默认 controller、never-abort 哨兵，也不提供便利执行路径**
- 理由：可选的 signal "让直接调用方可以省略归属、让每个工具体内 `exec.signal` 变成可选、
  并鼓励注册表兜底 —— 而兜底无法表达调用方的真实生命周期"

**两条正确性论证**（都可直接用于我方审查）：

> ① **把工具 promise 与取消赛跑不是安全兜底**，因为**被放弃的同进程工作在注册表报告完成后仍在继续**。
>
> ② 一个不加区分的 `ABORTED` 结果**无法告诉持久化消费者"工具主体是否可能已产生副作用"**
> —— 取消可能发生在策略前、审批中、around-dispatch 等待中、工具体已开始后、或 post-policy 等待中。

### 2.3 消息与 turn 不能一一对应（**冲击我方 N 层**）

`dsh/.../2026-07-30-followup-enqueue-and-owned-runs.md`：

> **`MessageId` 能证明入队，但无法标识哪条 assistant 消息或 `turn/end` 是这条输入的结果。**
> 因为 steering、注入上下文、工具续跑、恢复、后续排队消息**都会贡献内容**。

所以他们：
- **否决了 per-send 完成句柄**（`one-send-one-turn` ADR）
- `Agent.followup(message): void` 是**仅入队**
- `Agent.whenIdle()` 与 `agent/status` 是**整个 agent 的生命周期观察**，都**不结算单条消息**
- SDK：`session/prompt` 在**入队成功时**即应答 `{messageId}`；
  通过 `session.event` 流式发持久事实、通过 `session.status` 发整 agent 状态迁移、
  **没有 `session.finished`**

> **对我方 N1/C6 的冲击**：如果多端协议承诺"这条 prompt 的 turn 结果"，
> 一旦有 steer 或注入，这个承诺就无法兑现。**协议层不应提供 per-prompt 的完成语义。**

### 2.4 中断的 turn 与截断

`dsh/rejected/simplification/2026-06-20-truncate-interrupted-turns.md` —— **被否决**：
不要截断被中断的 turn（状态：rejected，说明他们认为保留完整记录更重要）。

---

## 3. 上下文与压缩（F 层）

### 3.1 压缩必须在 turn 边界内发生（真实事故）

`pi-desktop/docs/adr/0030-turn-boundary-context-checkpoint-compaction.md`：

> 一次长 pi 运行在 `agent_end` 之前可以包含**许多** model/tool turn。
> **只在用户 prompt 之间、或运行已终止之后压缩，无法保护该循环内部的下一次 provider 请求。**
> 观测到的 **Bedrock 失败达到 1,077,172 tokens，而 provider 上限是 1,000,000** ——
> provider 在 PI-Desktop 有任何恢复点之前就拒绝了请求。

并且明确划界：pi-agent-core 已提供会话上下文重建、token 估算、切点选择、摘要生成、
保留尾部处理、压缩记录；**它不定义** renderer 生命周期、Rust 侧持久化、
**provider headroom 策略**、长循环守卫。

他们还**在特定 commit 上考察了 OpenCode 的 Dynamic Context Pruning (DCP)**：
`85b6f5ceba144fee9e65eb28dc36cab1b960e418` —— 跨项目参考的实例。

### 3.2 压力信号不能只看成功调用

`dsh/.../2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md`：

- `agent/pre-step` 在最终路由之前跑 → **它的压力视图是暂定的**
- **成功的调用不是唯一压力信号**：provider 可能**在返回 usage 之前**就因超上下文拒绝，
  而**有些成功调用根本不返回 usage**
- 所以需要**可回放的调用后压力**，且 overflow 恢复路径
  **在压缩无法证明有进展时，必须保留 provider 原始错误**

> **对我方 F4 的修正**：不是简单的"先判溢出再压缩"，而是
> **压力测量要放在调用后、要可回放、且恢复失败时不能吞掉原始错误**。

### 3.3 压缩失败与分块摘要

`pi-desktop/docs/adr/`：`0049-context-compaction-failure-recovery`、
`0282-compaction-summary-retry-and-sizing`、
`0302-compaction-fallback-recent-window-and-chunked-summary` ——
压缩本身需要**失败恢复、摘要重试与尺寸控制、回退到近期窗口 + 分块摘要**三级兜底。

### 3.4 fs 观察策略应可丢弃

`dsh/.../2026-06-26-file-context-as-event-gate.md`：
把三件事解耦 —— ①工具做什么 ②**新鲜度/观察策略**（"编辑需要先前读过"、"写/编辑必须基于你读过的版本"）
③已观察状态的记录（**副作用，绝不应阻塞工具工作**）。

原来的做法把策略做成 **in-path 且强制**：工具不经过 `ctx.fileContext` 就到不了 `ctx.fs`，
于是**不想要该策略的部署无法简单丢弃这个包**。

> **对我方 C 层的补充**：新增两条可配规则 —— **编辑前必须先读**、**写入必须基于已读版本**。
> 且**策略层不应是 in-path 强制的**，否则无法整体关闭。

---

## 4. 工具（B / D 层）

### 4.1 声明式输出契约：执行期值 ≠ 会话格式

`dsh/.../2026-07-20-canonical-tool-output-contract.md`：

- 原来工具体直接产出面向模型的 `ContentBlock[]` → **程序化调用方拿不到稳定的域值**
- **每个工具声明一个强制的 canonical output，且只返回该契约描述的值**
- 理由：持久化所有富中间值会**膨胀日志、把实现数据暴露给压缩与迁移、
  并且错误地把执行期 API 变成会话格式**

> **关键区分（我方 B/E 层的边界）**：**执行期类型值**与**会话格式**是两个东西，
> 两者之间必须有**显式投影**。

### 4.2 重试预算：3 次而非 2 次

`pi-desktop/docs/adr/0207-three-mutation-recovery-failures.md`：

> 第一次失败常常暴露的是**语法、范围或来源修正**，而**第二次失败可能仍是在应用那个修正**。
> 在此时停止，会让一个有界的编辑错误比必要的更难恢复。

硬规则：
- 同一路径允许 **3** 次计入的失败 `Edit`，第 3 次带 `terminate: true`，
  以 `MUTATION_RETRY_BUDGET_EXHAUSTED` 终结 assistant 行
- 可恢复错误码**每码各有一次宽限**
- 计数器**按 prompt × path 双重作用域**
- **一次成功即清空该路径的失败历史**

### 4.3 输出截断与落盘

`dsh/.../2026-07-08-tool-output-spill-files.md` + pi `truncated-tool.ts`：
- 上限 **50KB（约 10k token）或 2000 行，先到先算**
- **截断时写临时文件并把路径告诉模型**，模型可再读
- 落盘有**独立的生命周期策略包**（DSH `packages/spill/spill-policy`），不是随手 write temp

---

## 5. 沙箱与子进程（D 层，**Windows 权威答案**）

`dsh/.../2026-08-28-subprocess-native-containment.md`：

**问题（原文要点）**：
> 分离的 POSIX 进程组、Windows 直接父进程遍历、PTY 后代扫描，
> **只能描述那些仍能通过某一种进程关系被观察到的成员**。
> 子进程可以 `setsid`、被重新挂到别的父进程、或**活得比直接父进程更久**，从而脱离这些范围 ——
> **终止看似的那棵树之后，工作、端口、文件可能仍在活动**。
> 而且"直接目标返回"**并不能证明所有后代都已停止**。

**决策**：
- `LocalSubprocessRuntime` 在目标可执行前**选定一个 provider 私有的"管辖范围所有者"**
- Linux 普通/PTY → 进入 **transient user-systemd scope**
- **Windows 普通 → 进入由私有 runner 持有的不具名 kill-on-close Job**
- 不支持的宿主 → 用既有的较弱兜底，并给**一次 provider 生命周期级别的警告**
- **一旦所选原生路径可能已执行过目标，provider 绝不重放该目标**

> **对我方 D 层的价值**：这是 Windows 上"如何真正管住子进程"的权威做法 ——
> **kill-on-close Job Object**。且给出了正确性论证：不可靠的兜底必须**显式告警**，
> 而不是假装管住了。

---

## 6. 持久化与资源边界（E / M 层）

`pi-desktop/docs/adr/0041-bounded-host-runtime-and-persistence-outbox.md`：

**真实故障链（原文）**：
> 每个 RPC 起一个**无界** Tokio 任务，并可启动**无界**数量的 shell 进程。
> 本地突发时出现 `Resource temporarily unavailable`，随后**并发 host 重启、写入已销毁的 stdio 管道**。
> **产出的持久化错误掩盖了最初的资源故障。**

**决策（每条都可直接抄）**：
| 规则 | 内容 |
| --- | --- |
| 有界准入 | host-core 持有 RPC 与工具执行的有界准入预算；**工具类有独立的全局上限**，**每个会话另有上限**，**队列有限** |
| 重试边界 | 瞬时进程启动失败**有界退避**；**已启动的命令绝不自动重试** |
| 许可与回收顺序 | **超时的子进程先被回收，然后才释放其许可** |
| 监督 | Electron host 监督**单飞且分代**；**过期的 host 代不能发通知或接受新 RPC 写入** |
| 持久化解耦 | 消息追加走 **file-backed outbox**，在 host 握手成功后**顺序 flush** |
| 握手纪律 | **握手会 await 该排空完成后才宣告 host ready**，因此冷的 `session.get` **无法与排队的行竞态** |
| 幂等 | host 侧消息追加**按 message id 幂等**；id 冲突且属另一会话时**重映射为 `{sessionId}:{id}`** |
| 幂等确认 | outbox 把 `UNIQUE constraint failed: messages.id` **当作 ack** |

> **"过期的 generation 不能写"** 与 ADR 0053 的 **execution epoch** 是同一个模式：
> **持久化的权威必须分代，否则重启会重放旧进程的工作。**

---

## 7. 计划与 steer（G / A 层）

### 7.1 计划检查点需要执行纪元

`pi-desktop/docs/adr/0053-plan-checkpoint-artifact-and-execution-epoch.md`：

- 旧 Plan 契约用**内存里的审批等待者** → 不给出一个确切、可检视的计划工件，
  也未定义"已批准的执行为何能在**不重放**的前提下被中断"
- **"计划批准必须持久到能扛住渲染层重载，但 host 重启绝不能重放旧 host 进程创建的工作。"**
- 决策：产品选择器 `Agent | Plan`，**Plan 就是处于 planning 状态的同一个 Agent**；
  Protocol v9 / Storage schema v10

### 7.2 steer 需要目标 turn 的准入

`pi-desktop/docs/adr/active-turn-steering.md`：
- 第二个 prompt 被**正确拒绝**为 `AGENT_BUSY`
- **Send/Enter = follow-up；Alt+Enter = 独立的 `agent/steer` 通道，带 `expectedTurnId`**
  （参照 Codex 的 turn/steer 契约）
- **steering 保持当前配置与同一个持久 turn**；**已启动的工具先跑完，下一次模型请求才消费输入**

---

## 8. 被否决 / 被撤回的设计（避免重走弯路）

| 设计 | 状态 | 原因（原文要点） | 来源 |
| --- | --- | --- | --- |
| 运行时事件 schema 注册表（Zod 化事件词汇表） | **rejected** | **插件无法 declaration-merge 一个 Zod schema**；要用 Zod 就得引入运行时注册表，而该注册表会**取代 interface 成为词汇表的真相来源** → 全仓词汇表重构（6 个 map / ~10 处 declare module / 16 个 append 点 / ~7 个 switch 消费者） | `dsh/rejected/architecture/2026-06-16-typed-event-schemas.md` |
| 截断被中断的 turn | **rejected** | 保留完整记录更重要 | `dsh/rejected/simplification/2026-06-20-truncate-interrupted-turns.md` |
| 丢弃 durable step 边界 | **rejected** | — | `dsh/rejected/simplification/2026-06-20-drop-durable-step-boundaries.md` |
| 折叠会话持久化接口 | **rejected** | — | `dsh/rejected/simplification/2026-06-20-fold-session-persistence-interface.md` |
| JSON-RPC 改为单向 | **rejected** | — | `dsh/rejected/simplification/2026-07-19-make-jsonrpc-directional.md` |
| A2A 点对点栈 | **withdrawn**（已撤） | ADR 0165 | `pi-desktop/docs/adr/0165-withdraw-a2a-peer-stack.md` |

> **`typed-event-schemas` 这条最重要**：它揭示了一个**我此前完全没提的取舍** ——
> **扩展机制决定了你以后能否加运行时校验。**
>
> - **封闭联合**（Pi 的 `AgentEvent`）→ 运行时校验容易，但**插件加不了事件类型**
> - **可合并 map**（DSH 的 `SessionEventMap` + declaration merging）→ 插件扩展容易，
>   但**没有运行时校验**（类型在运行时不存在）
>
> DSH 的折中是：**事件 map 保持编译期，Zod 只校验投影状态，迁移只校验持久化载荷。**
> 我方若要同时要"插件可加事件"与"持久化可校验"，**必须在 P0 就选边**，后期无法便宜地改。

---

## 9. 这轮对需求文档的净影响

| 层 | 新增/修正 |
| --- | --- |
| A | **A9 turn 只能入队，无 per-prompt 完成语义**；A10 steering 需 `expectedTurnId` 准入 |
| B | **B12 声明式输出契约**（执行期值 ≠ 会话格式，需显式投影）；**B13 重试预算：同路径 3 次，按 prompt×path 作用域** |
| C | **C12 编辑前必须先读 / 写入基于已读版本**；**C13 策略层不可 in-path 强制**（否则无法整体关闭） |
| D | **D13 Windows kill-on-close Job 作为管辖范围所有者**；D14 不可靠兜底必须显式告警 |
| E | **E12 整值事件规则**；**E13 事件日志同步 append + write-behind + turn 末 flush**；**E14 原始分片与组装消息都留** |
| F | **F9 压缩必须在 loop 内的 turn 边界**（附 1,077,172 vs 1,000,000 的真实事故）；**F10 压力测量在调用后且可回放，恢复失败不吞原始错误** |
| L | **L7 命令调用与裁决也要持久化**（不只工具记录） |
| M | **M8 持久化权威必须分代（generation/epoch）** |
| Q | **Q1 修正**：未知事件类型必须显式拒绝而非透传；方向敏感报错；拿不准就 bump |
| 全局 | **新增 G0 决策：事件扩展机制（封闭联合 vs 可合并 map）必须 P0 定** |
