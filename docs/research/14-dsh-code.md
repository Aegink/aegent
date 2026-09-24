# deepseek-harness 代码精读（MIT，`0010283`）

> 前几轮我**大量读了它的决策记录**（`.agents/notes/` 1177 篇，见 `05-architecture-principles.md`）。
> `docs/review-prompt.md` §三C 指出前人"读文档多、读代码少"。
> **本轮只读代码，不重复已记录过的 note 结论。**

---

## 0. 一句话

DSH 的代码里有**两个成体系的机制**，是前几轮读 note 时看不到的：
**①`invariant.ts` 全仓 38 处，每条事件在 append 之前先过该领域的 fold 校验；
②一个独立的 timeout 库，把"超时"做成有错误码作用域、可融合、可重臂的原语。**

---

## 1. ★ 38 个 `invariant.ts`：领域不变量既校验回放、也校验**写入前**

`packages/**/invariant.ts` 共 **38 个**（脚本计数）。每一个都是"Cordis 不变量伴随插件"。
代表实现 `packages/schedule/schedule/src/invariant.ts`：

```ts
/** Validate a complete exact-session stream under its fork suffix policy. */
function validate(events: readonly SessionEvent[], fail: InvariantFailure): void {
  try { foldScheduleEvents(events) }
  catch (error) { if (!(error instanceof ScheduleLogError)) throw error; fail(error.message) }
}

const install: InvariantInstaller = Object.assign((ctx, fail) => {
  for (const session of ctx.sessions.list()) validate(session.ownEvents(), fail)   // ① 回放既有会话
  ctx.on('session/created', (session) => validate(session.ownEvents(), fail), { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {                        // ② 写入前
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type !== 'schedule/change') return
    validate([...session.ownEvents(), event], fail)                                // 追加"之后"的流先校验
  }, { global: true })
}, { inject: ['sessions'] })
```

### 1.1 这个机制的三点精妙

**(a) 校验函数就是投影函数。** `foldScheduleEvents` 既是 reducer（用于投影）也是 validator。
**不存在"投影能跑但日志非法"或"校验通过但投影炸"的分离** —— 它们不可能不一致。

**(b) 校验发生在 `internal/dispatch` 上，即 append 之前。**
`[...session.ownEvents(), event]` —— **把待写事件拼上去，验整条流**。
不合法则 `fail()`，**事件根本进不了日志**。

**(c) 每条流只由它的 owner 包校验。**
`if (event.type !== 'schedule/change') return` —— 只验自己拥有的那类事件，
且注册时报 `PACKAGE_NAME`（"package-owned strict Schedule stream invariant"）。

> **对我方 E 层（P0）**：我方 L0 现在只有"事件类型"和"形状纪律"，
> **没有任何"这条流是否合法"的可执行断言**。
> **建议**：每个事件域（turn / tool / permission / compact …）提供一个
> `fold` 函数，**同时**用作投影与不变量校验；写入前校验"已有流 + 新事件"。
> 这一条同时解决三类问题：投影与校验漂移、非法流被写进日志、迁移后旧流无法验证。

**(d) 一个工程细节值得注意**：文件里有
`/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */`。
**他们装了复制粘贴检测器（jscpd），并对这段样板显式豁免且写明理由。**
加上 `oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.` ——
**这与我记过的 ZCode「eslint-disable 必须带理由」是同一条纪律，第二个独立实现。**

---

## 2. ★ 超时是一个**独立库**，不是散落的 setTimeout

`packages/util/timeout/src/index.ts`。模块注释原文：

> The library **only notifies through abort signals**; **each capability still owns the mechanism
> that stops its work** and translates timeout reasons into public outcomes.

**库只发信号，不负责停任何东西** —— 与 note `2026-07-19-cooperative-tool-cancellation.md`
"把工具 promise 与取消赛跑不是安全兜底"是同一立场的代码化。

### 2.1 三个各自有效的东西

**(a) `MAX_TIMER_DELAY_MS = 2_147_483_647`（`index.ts:25`）**

`assertTimerDelay` 拒绝 `> MAX_TIMER_DELAY_MS` 的值。这是**Node 的 setTimeout 32 位溢出**：
超过 2^31-1 的延迟会被静默钳到 **1 毫秒**（立刻触发）。
**一个"设了 30 天超时"的调用会变成"立刻超时"** —— 极难排查。
**我读过的其他仓没有一个防这个。**

**(b) `clampTimeout(requested, def, max, name)`（`index.ts:45`）—— 三档，且显式否掉 0**

调用方提示 → 后端默认 → 后端上限，取 `min`。
注释原文：**"`zero` is not a public disable-timeout sentinel"**（0 不是"关闭超时"的公开语义）。
非法值**抛错**，不静默修正。

> **我方 B 层采纳**：工具超时参数必须**三档合并**且**非法值抛错**，
> 且**必须有一个"不能关闭"的后端上限** —— 否则一个插件可以传 `Infinity` 关掉所有超时。

**(c) ★ `IdleWatchdog`（`index.ts:66`）与 `pulse()`（`:76`）—— 一个我此前完全没想到的问题**

原文：
> Rearmable timeout around **one outstanding async-iterator demand**.
> `pulse()`: **Rearm an outstanding demand after transport activity that yields no iterator value**;
> otherwise a no-op.

**问题**：LLM 流式响应里，**连接是活的（收到 keep-alive / ping），但长时间不产出任何迭代值**。
朴素的"空闲超时"会**误杀一个健康的流**。
`pulse()` 就是"收到传输层活动但无值时，把空闲计时器重新武装"。

> **这是我此前需求文档里没有的一类超时**（我只写了"调用超时"）。
> **建议（F/J 层新增）**：区分三种超时 ——
> ①**总时长**（无论有无活动）②**空闲**（无迭代值）③**可重臂空闲**（有传输活动则续期）。
> 与 ZCode 的 `StreamRecovery*` 是同一问题的两面（它管恢复，DSH 管检测）。

### 2.2 错误码**作用域**是让洋葱链可嵌套的关键

`packages/guard/timeout-policy/src/index.ts` 定义了 `TOOL_TIMEOUT`，注释原文：

> Scoping `timeoutOf` to it keeps **a nested outer deadline** (another `tools/execute` wrapper's
> timer that fired first) **from being misread as this plugin's own timeout** — it reads as an
> ordinary upstream cancel.

实现（`index.ts:64` 起）：`using d = deadline(exec.signal, timeoutMs, TOOL_TIMEOUT)` →
**把 `d.signal` 换上 `exec`，`await next()`，然后恢复上游 signal**，
**只有"本插件自己的计时器真的烧了"时才替换结果**。

模块注释第一句：
> maps its own expiry to `TOOL_TIMEOUT` **without racing or abandoning the tool promise**.

**"不赛跑、不放弃工具 promise"** —— 这正是那条 note 要求的正确做法，这里是它的实现。

> **对我方 J 层（P0）**：多个超时层嵌套时，**判定"是谁超时"必须靠错误码，不能靠"signal 被 abort 了"**。
> `AbortSignal` 只说"被中止了"，不说"谁中止的"。**`tools/execute` 的洋葱链（`($, e, next)`）此前只在 note 里见过，这里在代码里确认了。**

---

## 3. ★ 压缩切点必须"工具调用/结果配平"

`packages/compaction/compaction/src/tool-pairing.ts`。模块注释原文：

> Compaction changes surface positions, so safe cuts are derived from tool-call/result content
> in **current surface order rather than step markers**.

**为什么不用 step 标记？** 因为压缩会重写 surface 的顺序，**旧的 step 边界在重写后不再对应真实位置**。
所以他们从**内容**重算平衡：

```ts
function eventDelta(event: SessionEvent): number {
  switch (event.type) {
    case 'assistant/message':
      return event.data.message.content.filter(b => b.type === 'tool-call').length
    case 'tool/result': return -1
    default: return 0
  }
}
```

`inProgressToolCalls === 0` 的切点才是 `cutBalanced`。
且在**增量折叠**时：

> Validate the unseen tail **before mutating the live cache**, so a corrupt append cannot
> leave a partially advanced state behind.

并对两种损坏**显式抛错**：surface seq 找不到对应日志事件、`tool/result` 没有配对的 `tool-call`。
缓存用 `surface.replaceGeneration` **分代失效**（又是 generation 模式）。

> **对我方 F 层（P0）**：**压缩/截断的切点必须"工具调用与结果配平"**，
> 否则会把一次工具调用和它的结果切到两侧，模型看到悬空调用或悬空结果。
> 且切点要**从内容现算**，不能依赖可能已被重写的 step 标记。
> **这是我方需求文档里完全没有的一条。**

---

## 4. `escalation.ts`：一条锋利的区分 —— **执行期真相不得烘进全局 schema**

`packages/sandbox/sandbox/src/escalation.ts`。两处直接可抄：

**(a) "严格更宽"阶梯表**（原文注释："The strictly-wider table"）：

```ts
export const WIDER_MODES: Record<string, readonly SandboxMode[]> = {
  'read-only':       ['workspace-write', 'danger-full-access'],
  'workspace-write': ['danger-full-access'],
}
```

**沙箱模式只能向"严格更宽"升级** —— 不存在横移或降级。
（对照 Codex 的 `Decision` `Ord`：同样是**用类型系统的顺序表达单调性**。）

**(b) ★ 注释原文，值得整句抄进我方规范**：

> Checked at **EXECUTION**, never baked into a tool schema — the schema's enum is
> `ESCALATION_TARGETS`, because **schemas are registry-global while the effective mode is
> per-call truth**.

**同一个工具，在不同调用里有效沙箱模式不同** → 所以"能升到哪一档"**必须执行期算**。
把它写进工具 schema（一个全局对象）就是把**每次调用的真相**塞进**全局常量**。
**这是一类真实且隐蔽的 bug**：schema 看着对，因为它在某些调用里恰好对。

> **对我方 B 层**：**凡"每次调用都不同"的约束，不得进入工具 schema。**
> schema 只放"对所有调用都成立"的东西。这条可以直接进 `AGENTS.md`。

**(c) 审批通道是"结构化的函数形状"，不是服务类型。** 原文：

> The channel is a minimal STRUCTURAL function shape ({@link EscalationAsk}), **not the approval
> service type**: the tool layer — which owns the agent, the call id, and the tool name —
> closes over `ctx.approval.request(...)` and hands the closure down, so **this package never
> depends on the approval or agent packages**.

**依赖倒置用"函数形状"实现，不引入接口包。** 与 ZCode 的 Port 同目的、更轻。

而且**理由写明了**："One home keeps the two families'（bash 与 fs）**approval ordering and verbatim
error texts from drifting apart**" —— **集中化的理由是防止两个工具族的审批次序与错误文案漂移**。
这是"为什么要有这个模块"的正确写法。

---

## 5. 其他

- **`guard/` 是一个包族**：`repeat-tool-reminder/`、`timeout-policy/`。
  **"重复工具调用提醒"与"超时策略"各是一个独立插件** —— 治理逻辑也是可插拔的。
  这两个都由 `ctx.on('tools/execute', async (exec, next) => …)` 挂进洋葱链。
- **`jobs/jobs-local/src/pump.ts`**：本地任务用一个 "pump" 驱动（我只看了文件名）。
- 通篇 `@module` 文档块写得极详（每个函数都有 `@param` / `@returns` / 为什么），
  **且注释解释的是"为什么"和"防的是什么"，不是"做了什么"**。这是全仓一致的文风。

---

## 6. 本轮对需求文档的净影响（DSH 代码部分）

| 层 | 建议 | 优先级 |
| --- | --- | --- |
| **E** | **每域一个 `fold`，同时用作投影与不变量校验；写入前校验"已有流+新事件"** | **P0** |
| **F** | **压缩/截断切点必须工具调用-结果配平**，且从内容现算（不依赖 step 标记） | **P0** |
| **J** | **超时须有错误码作用域**（多层嵌套时判定"谁超时"不能靠 signal） | **P0** |
| **J** | **区分总时长/空闲/可重臂空闲三种超时**（`IdleWatchdog.pulse()`） | **P1** |
| **J** | **`setTimeout` 上限 2^31-1**：超出会被静默钳到 1ms | **P1** |
| **B** | **超时参数三档合并（提示/默认/上限），非法值抛错，上限不可关闭** | **P1** |
| **B** | **每次调用不同的约束不得进工具 schema**（schema 是全局的） | **P1** |
| **D** | **沙箱升级只能"严格更宽"**，且执行期算，不进 schema | **P1** |
| **I** | **治理逻辑（重复提醒、超时策略）做成可插拔插件** | P2 |
| 全局 | **`jscpd` / `oxlint` 的豁免必须带理由**（第二个独立实现） | P2 |

**注意**：本轮**没有**重复前几轮已记录的 note 结论（整值事件、generation、kill-on-close Job、
压缩失败三级兜底等），那些仍以 `05-architecture-principles.md` 为准。

---

## 7. 诚实声明：未读

- `packages/core/`（含 `agent-loop/` 本体、`session/`、`tools/`、`system-prompt/`、`scope/`）
  —— **只读了它们的 `invariant.ts`，主实现未读**
- `packages/llm/`、`packages/context/`、`packages/fs/`、`packages/hooks/`、
  `packages/interaction/`（含 `permission-presets/`、`user-approval/`）
  —— **未读**（`user-approval` 与 `permission-presets` 是权限主战场，**本轮没读，是明显缺口**）
- `packages/client/`（`hmr/`、`modules/`、`ui-renderer/`）、`apps/`、`native/`、`python/`
  —— **未读**
- `packages/jobs/`（我只看了文件名）、`packages/schedule/`（只读了 `invariant.ts`）、
  `packages/goal/`、`packages/plan/`、`packages/compaction/compaction/src/{checkpoint,types}.ts`
  —— **未读**
- `.agents/notes/` 1177 篇 —— **本轮未读**（前几轮读过一部分，见 `05-architecture-principles.md`）
- 全部测试 —— **未读**

**本报告是"invariant 机制 + timeout 库 + escalation + tool-pairing"四点的精读。**
**DSH 的权限主战场（`interaction/user-approval`、`permission-presets`）本轮完全没碰。**
