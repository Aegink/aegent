# L0 事件词汇表（设计稿）

> 依据 `docs/l0-eval.md` §8 的结论：**L0 的第一个产物是词汇表，不是 `loop.ts`。**
> 本文是那份词汇表的正式设计稿。所有上游引用均为本机实测（`oss/SOURCES.lock` 锁定 commit）。
> **本文不含实现**，定稿后才写 `src/kernel/events.ts`。

---

## 1. 为什么这份文档先于 loop

Q9 已定**封闭联合**，配 C16（新增事件类型必须同步 `assertNever`）。
封闭联合的代价是：**词汇表是一次性单向门**。定完再改，代价就是
`dsh/rejected/architecture/2026-06-16-typed-event-schemas.md` 里记录的那个悬崖
（6 个 map / ~10 处 declare module / 16 个 append 点 / ~7 个 switch 消费者）。

而我方 `04-module-map.md` 的草稿只有 10 个扁平事件类型，对照 P0 需求**至少缺 3 类**。
本轮继续深挖 DSH 的真实词汇表后，发现问题比"缺 3 类"更严重 —— **是生命周期层数不对**（见 §2.1）。

---

## 2. 三份上游词汇表实测对比

| 来源 | 事件数 | 生命周期 | 机制 |
| --- | ---: | --- | --- |
| pi `AgentEvent`<br>`oss/pi/packages/agent/src/types.ts:485` | **10** | **2 级**：turn → message | **封闭联合** |
| pi session `Entry`<br>`oss/pi/packages/agent/src/harness/session/types.ts:16,64` | **4** | 树（有 `parentId`） | 封闭 + `custom` 逃生舱 |
| DSH `SessionEventMap`<br>`oss/deepseek-harness/packages/core/session/src/types.ts:281` | **14** | **3 级**：turn → step → message | 可合并 map |

### 2.1 最大分歧：`turn` 到底指什么

- **pi**：`turn` = "one assistant response + any tool calls/results"（`types.ts:489` 注释原文）。
- **DSH**：`turn` = **用户轮**（"Opens turn before the loop claims queued input",`types.ts:288`），
  `step` = "one model call plus the tool executions it requested"（`types.ts:299`）。

**这不是命名口味问题。** 一次用户提问通常会引发**许多**"一次模型回复 + 其工具调用"的循环。
用 pi 的语义，一次用户提问会产生 N 个 `turn`，**而"用户轮"这个概念在事件流里根本没有标记**。

后果直接砸在 **A9**（turn 只能入队，协议不提供 per-prompt 完成语义）上：
A9 要求"用户轮"的边界清晰可断言，但 pi 语义下无处可断言。

> **决定 1：采用 3 级生命周期，并把 pi 的 `turn` 改名为 `step`。**

### 2.2 第二个分歧：失败/中断的模型调用怎么记

pi 的 10 个事件里，**没有位置安放"这次模型调用没有产出可见消息"**（失败、重试、被取消、流错误）。

DSH 单独给了 `assistant/attempt`（`types.ts:355`），注释原文：

> One model attempt that committed no surface message. The embedded stream preserves a failed,
> retried, cancelled, or stream-error attempt that reached settlement **without fabricating
> model-visible history**.

**关键在最后半句**：不能为了记录失败而伪造一条模型消息。这正对应我方 **B12**
（执行期值 ≠ 会话格式）在"模型调用"上的同构要求。

### 2.3 第三个分歧：中断是标记还是推导

DSH 的 `assistant/message` 带 `interrupted?: true`（`types.ts:341`），注释原文：

> A turn cancelled mid-stream finalizes its delivered text/reasoning prefix as this event with
> `interrupted: true`; undispatched tool calls are absent. **The marker distinguishes that prefix
> without re-deriving interruption from turn boundaries.**

**"而不必从 turn 边界反推中断"** —— 这是纪律：中断是**写入时记录的事实**，不是**读取时的推测**。

### 2.4 第四个分歧：崩溃留下的未闭合 turn 怎么办

DSH 的 `TurnEndReasonMap`（`types.ts:201`）有 **7 个**结束原因，
其中**两个由读取方合成、loop 永不实时发出**：

| reason | 原文要点（`types.ts` 内注释） |
| --- | --- |
| `completed` | — |
| `aborted` | `{ reason: TurnEndCancelCause }`，取消请求中断了活动 turn |
| `blocked` | **原文无注释** |
| `error` | `error` 永远是结构化失败：`LlmError` 事实原文，或从任意其他错误摊平 |
| `max-tokens` | 至少一个 step 触顶，**即使插件让 turn 继续了** |
| `interrupted` | **崩溃孤儿 turn 事后闭合**：resume 为"最后一轮从未结束"的日志追加此 closer；冷读时 session-query 合成它。**loop 永不实时发出，崩溃前记录的事件保持完好** |
| `forked` | fork 种子构造闭合了源会话中仍打开的 turn。**仅 fork 种子携带，loop 永不发出** |

**这是本轮最有价值的发现。** 它回答了"崩在 turn 中间怎么办"：
**不截断，而是追加一个区分"loop 说的"与"我们推断的"的标记。**
（对照 `dsh/rejected/simplification/2026-06-20-truncate-interrupted-turns.md` —— 截断方案被否决。）

### 2.5 pi 的逃生舱：`custom` 条目（**对 Q9 有直接影响**）

pi session 的 `EntryType = "message" | "compaction" | "branch_summary" | "custom"`
（`types.ts:16`），其中：

```ts
export interface CustomEntry extends EntryBase {
	type: "custom";
	customType: string;      // 命名空间，避免碰撞
	data?: JsonValue;
}
```

配套 `EntryProjector`（`types.ts:59`）—— **应用自定义的投影函数，把 custom 条目转成模型可读消息**。

> **对 Q9 的重要修正**：我在 Q9 里写"封闭联合的代价是放弃第三方插件自定义事件驱动 UI"，
> 并据此把 C17（逃生舱）定成 P2 的"以后再说"。
>
> **证据显示这个代价比我说的小**：pi 在封闭联合之上开了一个 `custom` 变体，
> 而它的用途是**注入应用自定义的上下文**（经 `EntryProjector`），**不是驱动 UI**。
> 也就是说 —— **"插件注入自定义上下文"与"封闭联合"并不互斥，pi 已经证明了。**
> 我们真正放弃的只有"插件自定义事件驱动 UI"这一条，比原判断窄。

---

## 3. 我方 L0 词汇表（正式稿）

### 3.1 信封

```ts
interface EventBase {
  seq: number;        // 单调整数，权威顺序；由 store 分配，调用方不提供
  ts: number;
  turn: number;       // 用户轮
  step?: number;      // 仅 step 作用域事件
}
```

**`seq` / `ts` 由 store 分配**，照 pi 的 `NewEntry = Omit<Entry, "seq" | "timestamp">`（`types.ts:67`）。
调用方给不出正确的 seq —— 它给一个就多一个不权威的顺序来源。

### 3.2 事件联合（L0，正式计数 **25** 个）

| # | 事件 | 载荷 | 覆盖需求 |
| --- | --- | --- | --- |
| 1 | `turn/start` | `{turn}` | A9 |
| 2 | `turn/end` | `{turn, reason: TurnEndReason}` | **A7** |
| 3 | `step/start` | `{turn, step}` | A1 |
| 4 | `step/end` | `{turn, step, timing?, traceId?}` | A1 / B19（T-P1-61 追加 timing/traceId——落地记录 10） |
| 5 | `user/message` | `{message, source, promptId?}` | A9 / A12（T-P1-53 追加 promptId——落地记录 9） |
| 6 | `system/message` | `{turn, step, message}` | F 层 |
| 7 | `assistant/message` | `{turn, step, message, stream, usage?, interrupted?}` | **A7** |
| 8 | `assistant/attempt` | `{turn, step, stream}` | **J 层 / 错误可观测** |
| 9 | `tool/call` | `{turn, step, callId, name, arguments: string}` | B12 |
| 10 | `tool/result` | `{turn, step, callId, message, error?, meta?}` | B10/B12 |
| 11 | `tool/progress` | `{turn, step, callId, seqInCall, message}` | B7（T-P1-16 追加——落地记录 6） |
| 12 | `compaction` | `{turn, summary, retainedTail, tokensBefore, usage?, reason?, title?, trigger?, phase?, implementation?, strategy?, status?}`（L8 六维 + E17 status；可选全缺省兼容） | **F9**（原草稿缺）+ L8/T-P1-92 |
| 13 | `checkpoint` | `{turn, provider: string, ref: JsonValue}` | **E11**（原草稿缺） |
| 14 | `request/header` | `{config, tools?, reason}` | **J4**（**Q12 定：进 L0，不再是 log-only**） |
| 15 | `session/revert` | `{targetSeq, phase: "revert"\|"undo"}` | E4（T-1-05 追加，✅ 已追认——落地记录 2） |
| 16 | `model/switch` | `{from: {provider, modelId}, to: {provider, modelId}, reason: "user"\|"rollback"}` | J9/J10/J14（T-P1-06 追加，✅ 已追认——落地记录 3） |
| 17 | `todo/update` | `{items: Array<{content, status: "pending"\|"in_progress"\|"completed"}>}` | G2（T-P1-10 追加——落地记录 4） |
| 18 | `goal/set` | `{text, deadline?, status: "active"\|"achieved"\|"abandoned"}` | G3/G6（T-P1-12 追加——落地记录 5） |
| 19 | `session/fork` | `{parentSessionId, position: "before"\|"after", cutSeq}` | E5（T-P1-40 追加——落地记录 8） |
| 20 | `assistant/retrying` | `{turn, step, attempt, delayMs, error:{name,message,status?}}` | J27/B19（T-P1-61 追加，✅ 已追认——落地记录 10，19→20） |
| 21 | `plugin` | `{namespace, payload?}` | C17（T-P1-72 追加，✅ 已追认——落地记录 12，20→21；log-only 会话级元事件，**唯一泛型逃生舱**） |
| 22 | `command/run` | `{commandId, name, args?, source?}` | L7（T-P1-95 追加，✅ 已追认——落地记录 16，21→23；log-only 会话级元事件） |
| 23 | `command/done` | `{commandId, kind, text?}` | L7（同上，run/done 配对结算） |
| 24 | `surface/attach` | `{surfaceId, deliveryKind?}` | N8（T-P1-114 追加，✅ 已追认——落地记录 19，23→25；log-only 会话级元事件） |
| 25 | `surface/detach` | `{surfaceId, reason?}` | N8（同上，attach/detach 配对维护 roster） |

`user/message.source` 必须是联合：照 DSH 的 `types.ts:309` 注释，人类 prompt、注入上下文、
目标续跑**三者都逐字投影 content，靠 `source` 区分**。没有 `source` 就再也分不开。
`session/revert`、`model/switch`、`todo/update`、`goal/set` 与 `session/fork` 是**会话级元事件**：
不要求 turn/step 开合上下文，`turn` 挂流内最后轮（空流兜 0）。
`tool/progress` 相反是 **turn 域事件**（与 `tool/call` 同域）：只能在所属调用
未闭合时产生（校验要求 callId 在 openToolCalls 中）；`seqInCall` 是调用内
1 起单调递增的进度序号，单调用条数有上限（loop.ts 卡内定形，防撑爆事件流）。

### 3.3 `TurnEndReason`（封闭联合，L0 取 6）

```ts
type TurnEndReason =
  | { kind: "completed" }
  | { kind: "aborted";   cause: CancelCause }
  | { kind: "blocked" }                 // 策略拒绝
  | { kind: "error";     error: LlmFailure }
  | { kind: "max-tokens" }
  | { kind: "interrupted" };            // ★ 崩溃孤儿闭合，loop 永不实时发出
```

`forked` 归 P1（fork 是 P1）。**`interrupted` 必须进 L0** —— 否则崩溃恢复无处安放。

### 3.4 `CancelCause`（封闭联合，L0 取 3 + 1）

```ts
type CancelCause =
  | { kind: "user" }
  | { kind: "parent" }        // 子代理被父级取消；P1 才真用上，但槽位现在留
  | { kind: "disposed" }
  | { kind: "hook"; reason: JsonRecord; message?: string }   // Q10 定形，见下
  | { kind: "legacy" };       // 导入的旧日志无 cause —— DSH types.ts:196 同款
```

**词汇来源**：DSH `types.ts:189`（`user` / `parent` / `hook` / `disposed`）。

**Q10 已定（2026-09-25）：`hook` 变体保留，reason 结构化 + 自由文本单独放 `message`。**

- `reason: JsonRecord` —— **JSON 原始类型的键值对**，如
  `{ hook: "security-check", code: "DENIED_BY_POLICY" }`。可校验、可迁移、可查询索引
- `message?: string` —— 只给**人看**的那句话。它**不属于** `reason`，
  所以"持久化事件不含自由文本"这条规则（C14）作用在**判据字段**上而非展示字段上

**为什么这样能同时满足两边**：C14 的目的是"事件能被自动校验、迁移、回放" ——
它反对的是**用一句自然语言当判据**。把判据（`reason`）和展示（`message`）分开，
判据侧保持结构化，展示侧才有自由文本。kimi-code 已在生产用这个形状。

> **原始三选项已作废**（曾在 (a) 丢弃 / (b) 不带 reason / (c) 放宽 C14 之间选）。
> 现答案 (d) 是第四选项：**结构化 + 展示字段分离**。

---

## 4. 七条形状纪律（每条附上游出处）

1. **整值事件**（E12）：携带状态的事件必须带变更后完整值，绝非裸 delta。
   → `dsh/proposed/architecture/2026-07-27-session-projection-and-command-log.md`
2. **无运行时对象**（C14）：不得含 stack / signal / Error 实例 / 后端私有细节。
   → `dsh/implemented/architecture/2026-07-16-explicit-turn-cancellation.md`
3. **append 时即校验 JSON 可序列化**：DSH 用 `isJsonValue` 在 `Session.append` 拒绝非法 `meta`
   （`types.ts:369`），并把保证写成 "durable log reproduces the identical card on replay"。
   → 我方 `tool/result.meta` 与 `checkpoint.ref` 采用同一纪律。
4. **`seq`/`ts` 由 store 分配**，调用方不提供。出处：pi `NewEntry`（`session/types.ts:67`）。
5. **原始参数不解析**：`tool/call.arguments` 是**模型产出的原始 JSON 字符串**
   （DSH `types.ts:361` 原文 "the raw `arguments` JSON string exactly as the model produced it (unparsed)"）。
   → 解析失败、键序、字节精度都不丢。
6. **中断是标记不是推导**（§2.3）：`assistant/message.interrupted?: true`。
7. **header 与派生历史是两类东西**：`request/header` 参与"重建请求"，**不参与"派生历史"**
   （DSH `types.ts:390`, `:240-251`）。**它现在是一等的 L0 事件（Q12），只是不带消息语义** ——
   "进 L0"解决的是"这次请求带了什么设置"要有落点（J4 是 P0），不是让它变成一条消息。
   `system/message` 例外 —— 它是派生历史，不是 header（DSH 把 `system` 标了
   `@persistenceReserved` 并从 header 退休）。

---

## 5. C17 逃生舱：按 pi 的 `CustomEntry` 定形

原 C17 写的是"提供一个泛型逃生舱类型（如 `{type:"plugin", namespace, payload}`），P2"。
**证据支持把它改成 pi 的形态**：

```ts
| { type: "custom"; customType: string; data?: JsonValue }
```

三条理由：

1. **pi 已验证**（`session/types.ts:52`），不是我们发明。
2. **`customType` 是命名空间**，天然避免插件间碰撞 —— 比裸 `namespace` 字段更紧。
3. **它配 `EntryProjector`**，即"这个条目怎么变成模型能读的东西"由插件定义 ——
   这正是插件扩展**真正需要**的能力（注入上下文），而 UI 驱动不需要它。

> **C17 建议从 P2 提到 P1**：它不是"以后再说"，而是"词汇表里现在就留好那个槽"。
> 留槽的成本是一个变体；不留槽的成本是 §1 那个悬崖。

---

## 6. P0 需求覆盖检查表

| 需求 | 由哪个事件承担 | 状态 |
| --- | --- | --- |
| A7 取消/中断 turn | `turn/end{aborted}` + `assistant/message{interrupted}` | ✅ 设计已覆盖 |
| A9 turn 只能入队 | `turn/start` / `turn/end` 界定用户轮；`user/message.source` | ✅ |
| B10 超限输出落盘 | `tool/result` 载荷 | ⚠ 落盘生命周期未定 |
| B11 50KB/2000 行上限 | 同上 | ⚠ 同上 |
| B12 声明式输出契约 | `tool/call.arguments`（原始串）+ `tool/result.message`（投影后） | ✅ |
| C10 危险命令模式库 | `{kind:"blocked"}` | ✅ |
| C14 无运行时对象 | §4 纪律 2 | ✅ |
| C15/C16 封闭联合 | 本文档本身 | ✅ |
| D15 已启动命令不重试 | 不影响词汇表（执行层纪律） | — |
| E11 代码检查点 | `checkpoint` | ✅ |
| E12 整值事件 | §4 纪律 1 | ✅ |
| E13 同步 append + write-behind | 不影响词汇表（存储层） | — |
| F9 压缩在 turn 边界 | `compaction` + `turn/end{max-tokens}` | ⚠ **需补一条**：压缩发生在哪个 turn 边界必须可断言 |
| F10 调用后压力可回放 | `assistant/message.usage` + `assistant/attempt.stream` | ✅ 设计已覆盖 |
| J4 模型身份二元组 | `request/header.config` | ✅ |

**两处 ⚠ 需在写 `events.ts` 前定**：B10/B11 的落盘生命周期、F9 的压缩归属 turn。

---

## 7. 已定（2026-09-25，原「未决」四项）

**这四项已全部答复，本文档据此定稿；`requirements.md` §3 是唯一权威记录。**

| # | 问题 | 答案 | 对本文档的改动 |
| --- | --- | --- | --- |
| Q10 | §3.4 的 `hook` reason 冲突 | **(d)** reason 结构化（JSON 原始类型 record）+ 自由文本单独放 `message` | §3.4 的 `CancelCause` 形状据此定 |
| Q11 | C17 逃生舱优先级 | **提到 P1**（理由见 §5） | §5 不再是"建议"，是**要做的** |
| Q12 | `request/header` 进不进 L0 | **进** | §3.2 从"12 个 + 1 log-only"改为**13 个** |
| Q13 | §6 两处 ⚠ | ① B10/B11 落盘**打标记**策略前移 P0（清理仍 P1）；② F9/F21 的 P0 **只做 `PreTurn` 与 `MidTurn`** | §6 的两处 ⚠ 标记可去掉，改为"P0 范围已定" |

---

## 8. 诚实声明

- **所有上游引用均为本机实测**，路径与行号可复现；引用为原文摘意或原文。
- **"pi 简单核心不 import harness"** 是上轮实测结论（`grep "harness/"` 于三个文件零命中）。
- **DSH `blocked` 的含义未查证**：该变体在 `TurnEndReasonMap` 中**无注释**，
  我按语义推断为"策略拒绝"，**这是推断不是证据**，写实现前需读其消费点确认。
- **未验证**：`LlmFailure` 的具体形状（只在 `types.ts:212` 的 error 变体里被引用，未展开读）。
- **未评估**：DSH 的 `SurfaceEventType` / `SurfaceOp` 机制是否要在 L0 引入。
  它区分"有序表面"与"原始日志"，可能对 N 层多端同步有用 —— **本轮没读，标注为未看**。
- **本文档的词汇表部分已定稿**（Q10–Q13 已答复）；尚未定稿的是 §8 列出的未验证项。
- **上一行声明已履行**：§5、§7 的建议经你确认后已落到 `requirements.md`。
- **落地记录（2026-09-25，T-1-01 执行会话）**：① §8 曾声明"未验证 LlmFailure 形状"——P0 已定最小形状并落在 `src/kernel/events.ts`：`{code, message, status?, providerRetryAfterMs?}`（取 DSH `packages/llm/llm/src/types.ts:41` 的前四字段；`requestId`/`offloadImages` 暂不引入，待有真实消费者再加）。② `assistant/message` / `assistant/attempt` 的 `stream` 落为 `TimedStreamChunk[]`（带原始时间戳的 chunk 定时序列）——**不抄** DSH 的 delta-run 打包（`assistant-stream.ts:20`，属压缩优化），P0 只需无损。③ `request/header.reason` 取 DSH 四值 `initial|resume|change|series`；`user/message.source` 三值定名 `user|injected|resume`。
- **落地记录 2（2026-09-25，T-1-05 执行会话；✅ 已追认）**：词汇表 13→14——E4 revert 需要"追加标记事件"（plan-p0.md T-1-05 明文），但 §3.2 的 13 事件没有回退标记的落点。已新增 `session/revert {targetSeq, phase: "revert"|"undo"}`（会话级元事件，不要求 turn/step 上下文，最新标记生效；undo 约定 targetSeq=0）。理由：append-only 流不可截断（不变量 1），revert 是状态变更就必须有事件承载。已同步 events.ts / EVENT_TYPES / 投影校验，`plan-p0-progress.md` 待澄清表已立案供追认。**用户追认于 2026-09-25（"词汇表 13→14，允许"），此案关闭，§3.2 的正式计数为 14 事件。**
- **落地记录 3（2026-09-25，T-P1-06 执行会话；✅ 已追认）**：词汇表 14→15——J9 要求"换模以持久事件承载、非静默改状态"（plan-p1.md T-P1-06 明文），14 事件没有换模落点。已新增 `model/switch {from: {provider, modelId}, to: {provider, modelId}, reason: "user"|"rollback"}`（会话级元事件，session/revert 同款纪律：不要求 turn/step 开合上下文、turn 挂流内最后轮空流兜 0）。reason 值域两值：`user`（owner 经协议/端口换模受理，**含 deferred 受理**——受理即用户选择的事实落流，进程崩溃后重启仍可按流重建；deferred 应用不重复落事件，最新 to 已权威）与 `rollback`（J11 不兼容回滚，from=被回滚目标、to=恢复的 prev——T-P1-05 偏离③的兑现）。会话级选择的事实源 = 流内最新本事件的 to（J14 回放保护：restore/重启按流重建，不以全局默认覆盖；投影 modelSwitches 在有效视窗内取最新）。同步面：events.ts（ModelSwitchEvent / EVENT_TYPES / _EVENT_TYPES_EXACT 编译闸门）/ project.ts（validation 豁免 + 投影记录 + revert 切点切割）/ event-asserts.ts（O7 会话级元事件豁免面）/ model-switch.ts（emit 注入）/ assembly.ts（emit 落流 + J10 globalDefaultIdentity 分离存储）。**用户追认于 2026-09-25（"可以"），此案关闭，§3.2 的正式计数为 15 事件。**
- **落地记录 4（2026-09-26，T-P1-10 执行会话；✅ 已追认）**：词汇表 15→16——G2 要求"todo 变更 = 事件，状态 = 投影"（plan-p1.md T-P1-10 明文，opencode·session/todo 的 Event.Updated 纪律同构），15 事件没有 todo 落点。已新增 `todo/update {items: Array<{content, status: "pending"|"in_progress"|"completed"}>}`（会话级元事件，session/revert / model/switch 同款纪律：不要求 turn/step 开合上下文、turn 挂流内最后轮空流兜 0）。items 是变更后的**完整清单**（E12 整值事件，绝非 delta），最新一条本事件即 todo 当前状态的事实源；status 值域三值（opencode 的 `cancelled` 不引入——G2 最小面，YAGNI）。同步面：events.ts（TodoUpdateEvent / EVENT_TYPES / 编译闸门）/ project.ts（validation 豁免 + 投影 todos 历史 + revert 切点切割）/ event-asserts.ts（O7 豁免面）/ tools/builtin/todo.ts（todo_write 工具 emit 落流）/ assembly.ts（createTodoUpdateEmitter 落流出口）/ repl.ts（进度渲染）。**不追认的回退面**：events.ts / project.ts / event-asserts.ts / todo.ts / index.ts / assembly.ts / repl.ts / l0-events.md 本记录 + events.test 计数——约 2 小时，全部为新增面（不触碰既有 15 事件语义）。**用户追认于 2026-09-26（"全部认可"），此案关闭。**
- **落地记录 5（2026-09-26，T-P1-12 执行会话；✅ 已追认）**：词汇表 16→17——G3 要求"goal 跨 turn 保持，不因单轮结束丢失"（plan-p1.md T-P1-12 明文），goal 事实无流内落点则跨轮保持与重启恢复（验收④）都落不了（违反不变量 1）。已新增 `goal/set {text, deadline?, status: "active"|"achieved"|"abandoned"}`（会话级元事件，session/revert / model/switch / todo/update 同款纪律：不要求 turn/step 开合上下文、turn 挂流内最后轮空流兜 0）。载荷是变更后的**完整 goal 事实**（E12 整值），流内最新本事件即当前 goal；卡面载荷形状 `{text, deadline?}` 之外补必填 `status`——设定/达成/放弃/续期（卡面状态机四动作）都是状态变更，各有事件承载且终态保留 text/deadline 终值（不抹历史事实），不加 status 则达成/放弃无表达面。deadline 为 epoch 毫秒可缺省（无截止）。同步面：events.ts（GoalSetEvent / EVENT_TYPES / 编译闸门）/ project.ts（validation 豁免 + 投影 goals 历史 + revert 切点切割）/ event-asserts.ts（O7 豁免面）/ goal.ts（GoalService emit 落流 + goalFromEvents 流重建）/ assembly.ts（goal 选项 + beforeFirstModelRequest 提醒注入）。**不追认的回退面**：events.ts / project.ts / event-asserts.ts / goal.ts / assembly.ts / l0-events.md 本记录 + events.test 计数——约 2 小时，全部为新增面（不触碰既有 16 事件语义）。**用户追认于 2026-09-26（"全部认可"），此案关闭，§3.2 的正式计数为 17 事件。**
- **落地记录 6（2026-09-26，T-P1-16 执行会话；✅ 已追认）**：词汇表 17→18——B7 要求"工具进度流式上报、按序到达可观测"（plan-p1.md T-P1-16 明文），进度在事件源架构下必须落事件（不变量 1），17 事件没有进度落点。已新增 `tool/progress {turn, step, callId, seqInCall, message}`（**turn 域事件**，与 tool/call/result 同域——与前四个会话级元事件不同：校验要求 turn/step 开启且 callId 在 openToolCalls 中，进度只能在所属调用未闭合时产生）。seqInCall 是调用内 1 起单调递增的进度序号（B7 验收"按序到达"的载体，按 callId 聚合后有序）；message 是工具自解释的进度文本。单调用条数上限 MAX_TOOL_PROGRESS_PER_CALL=10（loop.ts 卡内定形——超限静默丢弃，进度是 best-effort 通道不反压执行，防高频工具撑爆事件流）。通道纪律：ToolContext.reportProgress 仅在工具执行期间可得（loop 按调用注入闭包 → toolCall 链 terminal → registry 转 ctx），不调 reportProgress 的工具零新事件。同步面：events.ts（ToolProgressEvent / EVENT_TYPES / 编译闸门）/ project.ts（validation 同域校验 + 投影 break 不消费）/ context.ts（reportProgress 键）/ registry.ts（ToolDispatchCall.report 通道）/ loop.ts（createProgressReporter + 上限常量）/ builtin/bash.ts（示范接线：命令启动前上报一次）。**不追认的回退面**：events.ts / project.ts / context.ts / registry.ts / loop.ts / bash.ts / l0-events.md 本记录 + events.test 计数——约 2 小时，回退后进度面消失但 tool/call–result 主链语义不变（不触碰既有 17 事件）。**用户追认于 2026-09-26（"两件事都按照你的建议来"），此案关闭，§3.2 的正式计数为 18 事件。**
- **落地记录 7（2026-09-26，T-P1-18 执行会话；✅ 已追认）**：词汇表**载荷面两处扩展**（事件计数 18 不变）——F5 真 LLM 摘要器落点：① `RequestHeaderReason` 四值扩五值（新增 `"compaction"`）：压缩摘要的模型副调用不是 agent 轮的 step，落 request/header 时用 initial/resume/change/series 任何一个都是流内谎言；独立值让运维面可区分主轮与副调用（"摘要提示词进 request/header 可观测"验收的承载面——副调用头 + 提示词作为该请求 system 消息）。② `CompactionEvent` 加可选 `title?: string`：会话标题随首摘要产出（引擎只在本会话无更早 compaction 事件时记录——首摘要定名），卡面"落 compaction 事件或独立元数据——优先复用既有载荷"的兑现；T-7-06 加可选 reason 字段的同款先例。同步面：events.ts（RequestHeaderReason 扩值 + CompactionEvent.title）/ compaction.ts（Summarizer 输出扩展 string | {summary,title?}——string 形状保持 P0 注入面零改动；引擎首摘要标题记录）/ llm-summarizer.ts（新文件：createLlmSummarizer + truncatingSummarizer 自 assembly 移入 context 层——context 不反向依赖 kernel/assembly，assembly re-export 保持 import 面）/ assembly.ts（summarizerModel 装配选项）/ agent-child.ts（openai 模式传 summarizerModel）。**不追认的回退面**：reason 扩值回退 = llm-summarizer 改用 "series"（语义妥协）或去头不落（验收②弱化）；title 回退 = 引擎不记录标题字段（约 1.5 小时，均不触碰既有事件语义）。**用户追认于 2026-09-26（"两件事都按照你的建议来"），此案关闭。**
- **落地记录 8（2026-09-26，T-P1-40 执行会话；✅ 已追认）**：词汇表 18→19——E5 要求 fork（分支）"`position: before/after` 定切点"（plan-p1.md T-P1-40 明文），分叉出的新会话必须有自己的流内事实承载父子关系（不变量 1：重启后 lineage 仍可按流重建；内存元数据会随进程消失）。已新增 `session/fork {parentSessionId, position: "before"|"after", cutSeq}`（会话级元事件，session/revert / model/switch 同款纪律：不要求 turn/step 开合上下文、turn 挂流内最后轮空流兜 0）。**落子流头部**（store.fork 复制完父流前缀后紧随追加）；**log-only 不进模型历史**（messages.ts 的 default 分支不消费；dsh·subagent descriptor "The descriptor is log-only — a session event absent from model history" 同构先例）；cutSeq 是父流中复制到的最后一条事件 seq（单值表达：before 时 = atSeq-1、after 时 = atSeq；0 即空分支）。词形采用 requirements 的 before/after（pi 当前版本为 `position?: "before"|"at"`，语义等价——切点是否包含选中条目，展卡记录已注明）。同步面：events.ts（SessionForkEvent / EVENT_TYPES 19 / 编译闸门）/ project.ts（validation 载荷校验 + 投影不消费）/ invariants.ts（O7 会话级元事件豁免面 +session/fork）/ store.ts（fork 方法 + ForkError 类型化拒绝）/ agent-protocol.ts（session/fork 请求 + forked 回执）/ agent-process.ts（协议 case）/ owner-port.ts（sessionFork handler）/ repl.ts（/fork 命令 + ⑂ 渲染）。**不追认的回退面**：events.ts / project.ts / invariants.ts / store.ts / agent-protocol.ts / agent-process.ts / owner-port.ts / repl.ts / l0-events.md 本记录 + events.test/fork.test 计数——约 3 小时，回退后 fork 降级为纯内存操作（不落 lineage 标记），不触碰既有 18 事件语义。**用户追认于 2026-09-26（"认可"），此案关闭，§3.2 的正式计数为 19 事件。**
- **落地记录 9（2026-09-27，T-P1-53 执行会话；✅ 已追认）**：词汇表**载荷面一处扩展**（事件计数 19 不变）——A12 要求"用户输入携带关联 id，关联该输入之后、下一次输入之前的所有事件；仍不提供 per-prompt 完成语义（与 A9 一致）"（plan-p1.md T-P1-53 明文；claude-official·claude-code.d.ts 的 BaseHookInput.prompt_id 行为同构——🔴 专有仓只学语义零代码摘取）。已在 `user/message` 载荷加**可选 `promptId?: string`**：用户输入的关联键，效力区间 = 本条 user/message 之后、下一条 user/message 之前的全部事件（**关联区间由流顺序天然定义**——事件流顺序即关联结构，区间内事件不逐个带 id，投影/消费面按 seq 切片推导，故仅扩起点一处载荷而非逐事件打 id）。loop 在落 user/message 时统一分配：runTurn 首条与 drainQueue 注入的 steer 每条各一枚，格式 `p<序数>` 会话内单调，**恢复路径从流重建计数基线**（AgentLoop 构造时数已有 user/message 条数——重启后不重号）。与 A9 纪律双向钉死：promptId 是关联键**不是完成句柄**——没有 finished() 配对、没有 per-prompt 完成语义；与 queue 的 messageId（q<序数>，inbox admission 收执，仅队列通道）分工明确。**零事件数扩展、零新事件**——T-P1-18 载荷扩展先例（RequestHeaderReason 扩值 + CompactionEvent.title）：载荷扩展≠新事件，但动词汇表载荷仍立案供追认。同步面：events.ts（UserMessageEvent.promptId 可选字段 + 注释）/ loop.ts（nextPromptId 分配器 + 构造时流重建基线 + 两处落盘点）/ project.ts（validation：present 时必须非空字符串，缺省放行=旧流前向兼容）。**不追认的回退面**：events.ts 删可选字段 / loop.ts 删分配器与两处传参 / project.ts 删校验 / l0-events.md 本记录——约 1 小时；回退后 user/message 无关联键，A12 的关联推导失去锚点（A9 语义不受影响）。**用户追认于 2026-09-27（"认可"），此案关闭。**
- **落地记录 10（2026-09-27，T-P1-61 执行会话；✅ 已追认）**：词汇表 **19→20（一处新事件 + 两处载荷扩展）**——①**新事件 `assistant/retrying`**（J27："retrying 作为一等事件，带 failedAttempt"；kimi engine.ts 的 retrying 事件同构最小面）：`{turn, step, attempt, delayMs, error:{name,message,status?}}`——provider 层的中间失败尝试（未产出 chunk、assistant/attempt 不落盘的那种）对事件流可见；turn/step 由 runAgentChildStdio 的落流观察者从 loop 当前状态读取（provider 层自身不知 loop 状态），idle 期防御性忽略（轮作用域红线）；log-only 面保持（T-P1-51 的 warn 不撤）。②**step/end 载荷扩展**（B19："每步上报 timing 与 traceId"；kimi stepCompleted 的 timing/traceId 同构，ModelRequestTiming 最小面）：可选 `timing?: {firstTokenLatencyMs, streamDurationMs}` + `traceId?: string`（`r<序数>` 会话内单调，request/header 数重建基线）——有模型请求的 step 才携带。③计数口径：**事件计数 19→20，正式计数 20 事件**。同步面：events.ts（AssistantRetryingEvent / StepEndEvent 可选字段 / EVENT_TYPES 20 / 编译闸门）/ project.ts（validation：assistant/retrying 进 step 作用域校验；step/end 载荷缺省放行=旧流前向兼容）/ invariants.ts（轮作用域面 +assistant/retrying）/ loop.ts（callModel 计时与 traceId 分配器 / runStep 两个 step/end 落盘点）/ agent-child.ts（onRetry 桥接观察者）/ agent-process.ts（registerRetryObserver hooks + 落流）/ l0-events.md 本记录 + events.test 计数 20。**不追认的回退面**：以上各文件删新增分支/字段/落盘点——约 2 小时；回退后 retrying 退回 logger.warn（T-P1-51 行为），step/end 无 timing/traceId（B19 的"每步可关联"面缺失）。**用户追认于 2026-09-27（"待澄清表认可"），此案关闭，§3.2 的正式计数为 20 事件。**
- **落地记录 11（2026-09-27，T-P1-62 执行会话；✅ 已追认）**：**StreamChunk 载荷扩展一处**（事件计数 20 不变）——B20 要求"输出 token 上限应作为'可续跑事件'，不是回合终态"（zcode turn-output-token-continuation 同构：classify 三值 + 上限 3 + 固定 CONTINUE prompt）。已在 **`StreamChunk` 的 `done` 变体加可选 `finishReason?: string`**（OpenAI wire 的 choices[0].finish_reason——此前 mapWireChunk 丢弃该字段，触顶信号无从谈起）；loop 据此判定：纯文本（无工具调用）且 finishReason ∈ OUTPUT_TOKEN_LIMIT_FINISH_REASONS 闭集（length/max_tokens/max_output_tokens，冻结只追加）且本 turn 续跑 < 3 → 落固定续跑指令（user/message source="injected"——注入上下文既有语义，**零新事件**）并直接进下一 step（内核护栏行为，不经 decideTurn——默认"无工具即 end"正是 B20 要防的"结束回合"）。同步面：events.ts（done.finishReason 可选 + 注释）/ openai-compat.ts（finishState 捕获 + done 携带）/ loop.ts（触顶集/续跑计数/判定面）/ provider.test（wire 解析 2 用例）/ loop.test（续跑 3 用例）/ l0-events.md 本记录。**不追认的回退面**：events.ts 删可选字段 / openai-compat.ts 删 finishState / loop.ts 删判定面——约 1 小时；回退后输出触顶即终轮（B20 的"可续跑"语义缺失，触顶事件流不可见）。**用户追认于 2026-09-27（"待澄清表认可"），此案关闭。**
- **落地记录 12（2026-09-27，T-P1-72 执行会话；✅ 已追认——见待澄清 #11 落款）**：词汇表 **20→21（一处新事件）**——C17 要求"若确需插件事件，只开一个泛型逃生舱类型，不改词汇表机制"（plan-p1.md T-P1-72 明文；pi·session/types.ts:52-64 的 CustomEntry `type: "custom"` + `customType` + `data?` 同构最小面）。已新增 **`plugin {namespace, payload?}`**（会话级元事件，session/fork 同款纪律：不要求 turn/step 开合上下文、turn 挂流内最后轮空流兜 0）：**namespace 非空必填**（来源可检索——pi 的 customType 同位，防匿名载荷落流）；**payload 可选 JsonValue**（只传可序列化值，agent-protocol 的可序列化红线一致）。**log-only 不进模型历史**（messages.ts 装配 default 分支不消费；dsh descriptor 同构先例），跨 compaction 保留；投影不消费（消费方按 namespace 自取）。**C15 双向钉死**：这是词汇表唯一开放槽位——其他未知类型恒被拒（project.ts KNOWN_TYPES 闸门 + 验收用例"ghost/plugin 恒拒"），C16 编译闸门同步（EVENT_TYPES 21 / _EVENT_TYPES_EXACT）。同步面：events.ts（PluginEvent / EVENT_TYPES 21 / 编译闸门）/ project.ts（validation：namespace 非空 + payload JsonValue 结构校验；投影不消费）/ invariants.ts（O7 会话级元事件豁免面 +plugin）/ l0-events.md 本记录 + events.test 计数 21。**不追认的回退面**：events.ts 删 PluginEvent/联合成员/EVENT_TYPES 行、project.ts 删 validation 与投影 case、invariants.ts 删豁免、events.test/project.test 删用例——约 1.5 小时，全部为新增面（不触碰既有 20 事件语义）；回退后插件面无流内承载（C17 的"留槽"自觉落空，插件事件只能 logger 带走）。**用户追认于 2026-09-27（"认可转正"——对执行会话按开工表态"待澄清表认可然后继续"所作解读的复核确认），此案关闭，§3.2 的正式计数为 21 事件。**

- **落地记录 13（2026-09-27，T-P1-92 执行会话；✅ 已追认（2026-09-27 用户："认可"））**：词汇表**载荷面一处扩展**（事件计数 21 不变）——L8 要求"压缩作为结构化度量事件，6 维度：trigger/reason/implementation/phase/strategy/status——压缩可统计、可归因"（codex·analytics/facts.rs:444-509 的 CodexCompactionEvent 六枚举对位）。已在 `CompactionEvent` 加**五个可选字段**（reason 已有——F24/T-7-06 六维之一）：`trigger?: "auto"|"manual"`（manual 槽位随 /compact 命令面，当前引擎只 auto）+ `phase?: "pre_turn"|"mid_turn"`（F20/F21 两相位的事件面 snake_case 映射，codex serde rename_all 同款；其 standalone_turn/post_turn 是编排特有不引入）+ `implementation?: string`（当前唯一直值 "llm-summarizer"——第二实现出现时收闭集走立案）+ `strategy?: string`（当前唯一直值 "full_summary"；memento/prefix_compaction 是 codex 策略族，我方无此二分）+ `status?: "started"|"completed"|"failed"`（**缺省读作 completed**——旧流兼容；started/failed 两值随 E17/T-P1-93 落行为；codex 的 interrupted 不引入——中断时最后事实是 started）。project 校验同步：trigger/phase/status 值域闭集（透传垃圾值拒绝）、implementation/strategy 单一实现期为自由值只查形状。obs 统计面：`src/obs/compaction-stats.ts`（compactionStats 按维度分列 + failures 归因列表——"可统计、可归因"验收的承载面；phase 缺省聚合 unrecorded 不编造事实）。**tokensAfter 未落**（卡面候选）——引擎无精确来源（压缩后窗口 token 数无权威值），宁可少字段不落流内谎言，记偏离。同步面：events.ts（CompactionEvent 五可选字段 + 注释）/ compaction.ts（run 落流处六面填充 + eventPhaseOf 映射）/ project.ts（validateCompactionMetrics 闭集校验）/ obs/compaction-stats.ts + 测试 / l0-events.md 本记录 + §3.2 行。**不追认的回退面**：events.ts 删五可选字段 / compaction.ts 删填充 / project.ts 删校验 / obs 删统计面——约 1.5 小时；全部为新增可选面（不触碰既有 21 事件语义与既有 compaction 载荷字段），回退后压缩六维不可统计（L8 的"可归因"面缺失）。

- **落地记录 14（2026-09-27，T-P1-93 执行会话；✅ 已追认（2026-09-27 用户："认可"）——与落地记录 13 同载荷扩展案的 E17 行为面）**：**零新事件零新字段**——E17"原子操作的中间态也进事件流，投影不猜"的落法 = compaction 事件 status 值的**行为化**：①压缩开始（pre hook 之后、摘要调用之前）append `compaction{status:"started", summary:"", retainedTail:0, tokensBefore, 六维其余}`——空串/0 是 started 时点的"完整状态"（E12），消费面按 status 区分；此后崩溃 → 流内最后压缩事实是 started（restore 后投影可见"压缩进行中/未完成"），绝不静默丢失。②摘要失败（summarizer 抛错——注意 llm-summarizer 内部 best-effort 降级不抛，failed 只在降级面兜不住时发生）append `compaction{status:"failed", summary:""}` 后**再上抛**（调用方 failTurn 收轮的现状行为不变）——压缩失败从"静默"变"可归因"（L8 统计面 failures）。③切换权威口径（new-window）与 title 判据统一：**只认 status 缺省/completed 的压缩**（started/failed 不切窗不占首摘要位）。④投影 compactions 如实记录 started/failed（status 可选字段）。**pre hook 中止语义不变**：中止点在 started 之前（先 hook 后 started）——T-7-02"abort 后零 compaction 事件"验收保持。落点选型记档：zcode 用独立中间态事件（queued/reserved/promoting 三类型），本方复用单事件 status 维（E12 整值/状态变更承载，词汇表 21 不变）。**不追认的回退面**：compaction.ts 删 started/failed 两段（回单事件结算）、new-window.ts 删过滤、project.ts 删 status 记录——约 1.5 小时；回退后压缩进行中/失败对投影不可见（E17 的"投影不猜"缺失），其余零影响。

- **落地记录 15（2026-09-27，T-P1-94 执行会话；✅ 已追认（2026-09-27 用户："认可"））**：词汇表**载荷面一处扩展**（事件计数 21 不变）——E18 要求"回合结局与该回合产出的消息一起结算（机器自报 produced[]）——优于事后反推'哪些消息属于这一轮'"（kimi·engine.ts:61/480 的 `turnSettled {outcome, produced}` 同构）。已在 `turn/end` 载荷加**可选 `produced?: number[]`**：本回合产出的 assistant/message 事件 seq 按序列表。**填充面**：loop 在 turnEndChain 终端（closeTurn 全路径——completed/aborted/error 均经此）从流按 turn 归属收集 assistant/message seq（机器=loop 在收轮时点自报，口径固定；消费者免事后反推）；A14 看门狗 forceCloseTurn 强制收轮路径同口径。**abort 语义**：部分产出照报（kimi 同构——"不丢不虚构"）。**缺席语义**：produced 为空集时不落字段（空集与缺席同义——无 assistant 产出的轮）；旧流缺省兼容。**tool 结果不进 produced**：tool/call+result 自带 turn 归属字段（无反推问题），produced 只收有真实反推成本的 assistant 消息域（卡面记档）。同步面：events.ts（TurnEndEvent.produced 可选 + 注释）/ loop.ts（turnEndChain 终端 + forceCloseTurn 两处自报）/ l0-events.md 本记录 + loop.test 3 用例。**不追认的回退面**：events.ts 删可选字段 / loop.ts 删两处收集——约 40 分钟；回退后消费者需自行按 turn 字段反推回合产出（E18 的"机器自报"缺失，事件流事实不变）。

- **落地记录 16（2026-09-27，T-P1-95 执行会话；✅ 已追认（2026-09-27 用户："认可"））**：词汇表 **21→23（两处新事件）**——L7 要求"命令的调用与裁决也要持久化，不只记工具；否则刷新/换端/fork 后'这条命令执行过'即丢失"（dsh·session-projection-and-command-log.md:13 的问题陈述 + :127-133 的 command/run+done 事件对同构）。已新增 **`command/run {commandId, name, args?, source?}`**（调用事实，run 前置——含失败尝试）与 **`command/done {commandId, kind: "success"|"error", text?}`**（结算，commandId 配对不变量）：**log-only 会话级元事件**（不进模型历史，session/fork / plugin 同款纪律，turn 落 0）；payload 结构化（name/args 由命令解析器自报——dsh "never re-parses a line" 纪律）；**与 L2 审计分域**（命令面 = "执行过"的存在性记录；审批域结构化字段 approver/category 仍走 L2）。CLI 接线：repl 命令入口前置 run + 受理时点 done（KNOWN_COMMANDS 白名单：revert/cancel/approve/answer/steer/fork/preset/check/unattended/resume；未知命令 run+done{error}——失败尝试也是"执行过"；**/exit /quit 不记**——进程退出路径无 done 结算点，记档）。子进程落流：agent-process command/run、command/done case（store.append + ForwardingStore 自动回显）。**C15/C16 同步**：EVENT_TYPES 23 / 编译闸门 / project 校验（commandId/name 非空 + kind 二值闭集）/ invariants 豁免面 / 投影不消费。**不追认的回退面**：events.ts 删两事件/联合成员/EVENT_TYPES 行、project.ts 删校验与投影 case、invariants.ts 删豁免、agent-protocol.ts 删请求类型与 decode、agent-process.ts 删落流 case、repl.ts 删记录面、events.test 计数回 21——约 2 小时，全部为新增面；回退后命令执行记录只在 REPL 瞬时输出（L7 的"刷新/换端后丢失"问题保留）。

> **四案追认于 2026-09-27（用户："认可"），全部关闭——§3.2 的正式计数为 23 事件。**

- **落地记录 17（2026-09-27，T-P1-100 执行会话；✅ 已追认（2026-09-27 用户："全部认可"））**：词汇表**载荷面一处扩展**（事件计数 23 不变）——F26 要求"压缩结果带指纹（配置哈希），指纹变了重压"（codex·session/turn.rs:1304 `comp_hash_changed` 双值齐备且不等才触发 + compact_model_fallback.rs:30 的 CompactionReason 词表位）。已在 `compaction` 载荷加**可选 `compHash?: string`**：压缩相关配置的稳定哈希（FNV-1a，覆盖面 = 摘要模型身份 + 摘要器种类 + 保留规则 + developer 保留预算——CompactionFingerprintInput 卡内定形）。**填充面**：engine 三次落盘（started/failed/completed）同值（指纹描述本次压缩的配置面，run 入口取值一次）；装配缺省注入（truncating/llm/custom 三 kind）。**消费面**：下轮 PreTurn 边界 `compHashChangeRequest` 纯函数判"最新已结算压缩的 compHash ≠ 当前指纹"→ 发起 reason="comp_hash_changed" 压缩（**词表位兑现**——该值是 2026-09-25 词汇表定稿注释中预先声明的 P1 槽位，非新值；双值齐备纪律——旧流无指纹/未接指纹 getter 均不触发）。**started/failed 残留不作对拍基准**（切换权威同口径）。同步面：events.ts（CompactionEvent.compHash 可选 + 注释）/ compaction.ts（指纹 + 触发纯函数 + 三处落盘）/ assembly.ts（装配期指纹 + PreTurn 触发位）/ 测试（compaction/downshift/assembly.compaction 三套件）。**不追认的回退面**：events.ts 删可选字段、compaction.ts 删指纹与触发、assembly.ts 删触发位——约 40 分钟；回退后配置变更不再自动重压（F26 的"指纹变了重压"缺失），旧流/新流零影响（可选字段前向兼容）。

- **落地记录 18（2026-09-27，T-P1-101 执行会话；✅ 已追认（2026-09-27 用户："全部认可"））**：词汇表**值域收闭集 + 载荷面一处扩展**（事件计数 23 不变）——F11 要求"压缩失败三级兜底"（pi-desktop ADR 0049/0282/0302：retained-tail 检查点 + failureReason 闭集 + "provider 错误原文不落记录"）。两处：(a) `strategy` 值域收闭集 **`"full_summary" | "recent_window_fallback"`**（原注释"唯一直值"的演进——兜底检查点是真实第二策略；旧流缺省读作 full_summary 语义不变）；(b) 新增**可选 `failureReason?: string`**——**闭集** `no_new_history`（被摘要区间无消息）/ `summary_budget`（预检/分块超 16 请求上限）/ `summary_provider`（摘要请求终态失败/空输出）/ `checkpoint_oversized`（兜底检查点仍超窗）。**语义**：仅 strategy="recent_window_fallback"（兜底成功，run 继续——ADR 0049 "no longer terminate a run"）与 status="failed"（manual fail-fast / 兜底不可行）携带；**provider 错误原文绝不落流**（闭集判据 + 原文仅 logger.warn 可检索——C14 判据/展示分域 + D14 先例）。**不追认的回退面**：events.ts 删 failureReason 字段、compaction.ts 删 buildFallbackCheckpoint 与 SummaryGenerationError 分支（回"failed 事件 + 上抛"的 E17 旧行为）、llm-summarizer.ts 恢复截断回退——约 1.5 小时；回退后压缩失败终止 run 且模型视图无近期窗口保护（F11 的三级链缺失），事件流事实不变。
> **批次 11 三案追认于 2026-09-27（用户："Anthropic"/"全部认可"）全部关闭——#16 选型 Anthropic（T-P1-108 并入批次 12），#17/#18 词汇表形状转正；§3.2 正式计数维持 23 事件（两案均为载荷/值域扩展）。**

- **落地记录 19（2026-09-27，T-P1-114 执行会话；✅ 已追认（2026-09-28 用户："认可#19"））**：词汇表 **23→25（两处新事件）**——N8 要求"多端 = surface roster，attach/detach 由事件维护；端的加入/离开是持久事件"（claude-official·claude-code.d.ts 的 surface 枚举 + `$.ui.mount`/`unmount` 显式生命周期——🔴 专有仓只学语义零代码摘取）。已新增 **`surface/attach {surfaceId, deliveryKind?}`** 与 **`surface/detach {surfaceId, reason?}`**（log-only 会话级元事件：session/fork / plugin / command 同款纪律——不要求 turn/step 开合上下文、turn 落 0、不进模型历史、跨 compaction 保留）。**两枚而非一枚 op 二值**：attach/detach 判据字段差异大（attach 带 deliveryKind 闭集 push|poll、detach 带 reason 可选——C14 结构化各自形状自洽，command/run+done 配对先例）；**roster 恢复恒等**：`src/host/roster.ts` activeRoster 纯函数从流重建（attach 入册幂等、detach 出册 no-op 收敛——流即状态，T-P1-99 先例）；**落流面**：SurfaceHub 连接生命周期（connect/close/断线自动释放）→ AgentHost emit → 装配方 append（"端的加入/离开是持久事件"——内存 roster 随进程消失不满足验收）；**会话级/host 级分域记档**：会话流承载会话级 roster，host 进程级跨会话清单由 HostRegistry 内存面承载。同步面：events.ts（SurfaceAttachEvent/SurfaceDetachEvent / EVENT_TYPES 25 / 编译闸门）/ project.ts（validation：surfaceId 非空 + deliveryKind 闭集 + reason 可选；投影不消费）/ invariants.ts（O7 会话级元事件豁免面 +surface 两事件）/ host/roster.ts + lease.ts（生命周期回调）/ registry.ts（surfaceEventOf 转换）/ events.test 计数 25。**不追认的回退面**：events.ts 删两事件/联合成员/EVENT_TYPES 两行、project.ts 删校验、invariants.ts 删豁免、host/roster.ts 删模块、lease.ts/registry.ts 删生命周期回调、events.test 计数回 23——约 1.5 小时，全部为新增面（不触碰既有 23 事件语义）；回退后 roster 回落内存面（N8"持久事件"验收缺失，端清单重启不可见）。
> **#19 追认于 2026-09-28（用户："认可#19"），此案关闭，§3.2 的正式计数为 25 事件。**
