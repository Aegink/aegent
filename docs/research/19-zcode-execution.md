# ZCode 执行层精读（第六轮，用户指定）

> 上一轮我写明：**`runtime/methods/` 的主体（那 7.8 万行的核心控制流）—— 只读了片段**。本轮补。
> 真正的回合循环在 `core/src/runtime/methods/turn-loop.ts:43` `runRegularTurnLoop`。
> `methods/` 合计 **25,587 行**。引用行号均已核验。

---

## 0. 一句话

**ZCode 的循环里有两个我此前完全没想到的机制**：
**①压缩相位 `PreRequest / MidTurn`（与 Codex 独立同证）；②"压缩抖动"的硬失败保护。**

---

## 1. ★ `CompactPhase.PreRequest | MidTurn` —— 与 Codex 独立同证

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

### 1.1 循环里压缩被查**两次，在不同粒度**

```ts
await this.microcompactIfNeeded(…);          // 每一轮都查（微压缩）
const autoCompactOutcome = await this.autoCompactIfNeeded(…);   // 全量压缩
```

**微压缩每步都查、全量压缩是独立一步** —— 与 Codex 的 `compact_token_budget`（换窗）
和 `compact.rs`（摘要）分层同构。

---

## 2. ★★ 压缩抖动（rapid refill）的硬失败保护 —— 我此前完全没想到的故障模式

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

### 2.1 这个故障模式是什么

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

## 3. `CompactReason.ContextLimit` —— 又一个跨仓同名

与 Codex `CompactionReason::ContextLimit` **同名同义**。两个独立实现的词汇表自发收敛到同一个词，
说明这个分类是**领域固有的**，不是我方的臆造。

---

## 4. ★ 闸门必须在**执行点**用**权威标识**重新推导，不能信被传递的元数据

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

## 5. steer 的排空点被逐一区分（正面回答 DSH 那个问题）

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

## 6. 其他值得记的

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

## 7. 对需求文档的净影响

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

## 8. 诚实声明：未读

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
