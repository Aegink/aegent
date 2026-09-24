# kimi-code 主循环精读（第六轮，用户指定）

> 上一轮我写明：**`agent/loop/loopService.ts`（2,285 行主循环本体）—— 一行未读**。本轮补。
> 引用行号均已核验。

---

## 0. 一句话

**kimi-code 的主循环不是命令式的 `while` 循环，而是三台组合的状态图（statechart）。**
自研了一个 `xstate2`（`#human/xstate2`），在此之上有 **agent 机器 × turn 机器 × tool 机器**，
`loopService.ts` 是外围的 DI 服务壳。

**这是五个仓里唯一的"状态图"方案** —— Codex 是 async Rust 循环、ZCode 是显式相位枚举（记账层）、
DSH 是洋葱链 + 不变式。**四种控制流组织方式。**

---

## 1. 三台机器组合

`agent/loop/machine/engine.ts:11-13` 的 import 直接暴露了结构：

```ts
import { createAgentMachine, type PromptGate, type PromptGateVerdict } from '#human/agent/machine';
import { createTurnMachine, type AssistantEntry, type HistoryMessage, type SystemEntry, type UserEntry } from '#human/agent/turn';
import { createToolMachine } from '#human/tool/machine';
```

| 机器 | 职责 |
| --- | --- |
| `createAgentMachine` | 回合级：`{ abortTimeoutMs, maxStepsPerTurn }`，编排 storeActor 等子 actor |
| `createTurnMachine` | 单回合内：assistant / system / user entry 与历史消息 |
| `createToolMachine` | 工具执行 |

`createAgentMachine` 内部有 **`abortTimeoutMs`（中止超时）** 与 **`maxStepsPerTurn`（每回合最大步数）**
两个必填参数 —— **循环有两个独立的护栏，且都是显式参数而非全局常量。**

### 1.1 外部快照是**从状态图状态推导**的，不是另记一份

`loop.ts:22` `AgentActivityTurnSnapshot.phase: 'running' | 'tool_call' | 'retrying'`，
在 `engine.ts:559-563` 由状态图的当前 state value 算出：

```ts
turnValue === 'retrying' ? ('retrying' as const)
  : … ? ('tool_call' as const)
  : ('running' as const);
```

**没有第二份真相** —— 快照是投影，不是状态。对照 ZCode 的 `turn-machine.ts`
（状态机与真实执行是两层，需要手动同步），**kimi 的做法更省心但也更难调试**
（状态全在状态图里，断点不好下）。

### 1.2 ★ `MachineEngineEvent` 是一个很完整的事件union（`engine.ts:52-`）

```
turnStarted   { machineTurnId, queueItemId?, entry? }
turnSettled   { outcome: 'done'|'failed'|'aborted', error?, produced: HistoryMessage[] }
stepStarted   { step, recovery?: LlmRecoveryRecord }
stepCompleted { step, entry, usage, finish?, messageId?, model?, timing?, traceId? }
stepFailed    { step, error: LlmErrorMessage, rawError? }
delta         { kind: 'assistant'|'thinking'|'toolCall', … }
retrying      { step, failedAttempt }
```

三处值得记：

- **`stepStarted` 携带 `recovery?: LlmRecoveryRecord`** —— **恢复信息在步开始时就被带进来**，
  与 ZCode 的 `StreamRecoveryAnchorCreated`（锚点先于故障）同向。
- **`retrying` 是一等事件**，带 `failedAttempt`。**重试在协议层可见**，不是循环里的内部细节。
  （对照我记过的 hermes-agent 静默超时——**不可见的重试是运维黑洞**。）
- **`stepCompleted` 带 `timing` 与 `traceId`** —— 每步都有耗时与追踪 id。
- **`turnSettled` 带回 `produced: HistoryMessage[]`** —— **回合结局与它产出的消息一起结算**。
  这与我记过的 DSH 结论（"`MessageId` 能证明入队，但无法标识哪条 assistant 消息是它的结果"）
  **表面冲突**：kimi 的做法是**让机器自己报告这一回合产出了哪些消息**，
  而不是事后从消息流反推。**这是对 DSH 那个问题的另一种解法，且可能更实用。**

---

## 2. ★ 重试分类：显式枚举，且**未知错误不重试**

`human/llm/requester/retry.ts`：

```ts
export const DEFAULT_MAX_RETRY_ATTEMPTS = 10;
const BASE_DELAY_MS = 500; const MAX_DELAY_MS = 32_000; const RETRY_FACTOR = 2; const JITTER_FACTOR = 0.25;
const RETRYABLE_STATUS_CODES = [408, 409, 429, 500, 502, 503, 504, 529];
```

```ts
export function isRetryableError(error: LlmErrorMessage): boolean {
  switch (error.kind) {
    case 'syntax': case 'abort': case 'quota_exhausted': case 'context_overflow':
    case 'request_too_large': case 'request_structure': case 'image_format':
    case 'unknown':                                   // ★ 未知 → 不重试
      return false;
    case 'empty_response': return error.finishReason !== 'filtered';   // ★ 被内容过滤 → 不重试
    case 'status': return RETRYABLE_STATUS_CODES.includes(error.statusCode);
    default: return true;
  }
}
```

三件事都对：

1. **`unknown` 明确不重试。** 把未知错误当可重试，是**把 bug 变成风暴**的最短路径。
2. **`empty_response` 且 `finishReason === 'filtered'` 不重试** —— 内容被过滤时重试无意义且浪费。
3. **退避有 jitter（25%）**，且**尊重服务端的 `retryAfterMs`**（`readRetryAfterMs`，429 场景）。

> **对我方 J 层（P0）**：**重试必须是显式的错误分类，且默认不重试未知错误**；
> 退避要有 jitter；**服务端给了 Retry-After 就听它的**。

---

## 3. `PromptGate`：入队前的闸门，且**可以改消息**

`human/agent/machine.ts:57-62`：

```ts
export type PromptGateVerdict = boolean | { block: boolean; message?: UserMessage };
export type PromptGate = (queueItemId: string | undefined, message: UserMessage) => Promise<PromptGateVerdict>;
```

**闸门不只是"放行/拦截"，还能返回一条替换后的消息**（`message?: UserMessage`）。
`ScopeFactoryOutput` 里 `promptGate?` 是可选的。

> **对我方 A 层**：入队闸门应有**三态**：放行 / 拦截（带理由）/ **改写**。
> 我读过的其他仓的闸门都只有前两态。

---

## 4. 事件存储带 **journal**（`machine/storeJournal.ts`）

`#human/eventStore/journal`：`memoryJournal`、`SyncStoreJournal`；
`storeJournal.ts` 实现 `wireStoreJournal(wire, domain)`，
从 `wire.readHumanChain()` 逐行读，按 `{ branch, seq, ts, type, kind, data }` 落成 `JournalRecord`。

**事件存储有分支（branch）与序号（seq）**，且持久化经一个 "wire"。
与我记过的 DSH（整值事件、同步 append + write-behind）是不同实现，但同样是**append-only + 投影**。

---

## 5. 对需求文档的净影响

| 编号 | 条目 | 优先级 |
| --- | --- | --- |
| **J25** | **重试按显式错误分类**；**未知错误不重试**；退避带 jitter；**尊重服务端 Retry-After** | **P0** |
| **J26** | **`retrying` 作为一等事件**，带 `failedAttempt`（重试在协议层可见） | P1 |
| **B20** | **每步上报 `timing` 与 `traceId`** | P1 |
| **A11** | **入队闸门三态**：放行 / 拦截（带理由）/ **改写消息** | P1 |
| **A12** | 循环有**两个显式护栏参数**：`abortTimeoutMs` 与 `maxStepsPerTurn` | P1 |
| **E20** | **回合结局与该回合产出的消息一起结算**（machine 自己报告 `produced[]`） | P1 |
| 形态 | 状态图（statechart）是四种控制流组织方式之一，**记为形态参照，不作默认建议** | — |

---

## 6. 诚实声明：未读

- `agent/loop/loopService.ts`（**2,285 行**）—— **只读了它的 import 区与 `loop.ts` 的类型定义**，
  主体实现（队列/暂停/通知/steer 的编排）**未读**
- `human/agent/machine.ts`(949) 与 `human/agent/turn.ts`(886) 的**状态图定义** —— **只读了导出签名**
- `human/tool/machine.ts`、`human/llm/requester/recovery`、`#human/xstate2`（自研状态图引擎）—— **未读**
- `agent/loop/machine/{requester,tools,history}.ts`(121/283/25) —— **未读**
- `agent/task/taskService.ts`(1,634)、`toolExecutor/toolExecutorService.ts`(994)、
  `llmRequester/llmRequesterService.ts`(994)、`fullCompaction/`(989) —— **未读**
- `wire/`、`state/eventDispatcherService.ts`(878) —— **未读**
- 全部测试 —— **未读**

**本报告是"主循环形态 + 事件union + 重试分类 + PromptGate"四点。**
**2,285 行的 `loopService.ts` 主体仍未读。**
