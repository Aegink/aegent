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

### 3.2 事件联合（L0，正式计数 **16** 个）

| # | 事件 | 载荷 | 覆盖需求 |
| --- | --- | --- | --- |
| 1 | `turn/start` | `{turn}` | A9 |
| 2 | `turn/end` | `{turn, reason: TurnEndReason}` | **A7** |
| 3 | `step/start` | `{turn, step}` | A1 |
| 4 | `step/end` | `{turn, step}` | A1 |
| 5 | `user/message` | `{message, source}` | A9 |
| 6 | `system/message` | `{turn, step, message}` | F 层 |
| 7 | `assistant/message` | `{turn, step, message, stream, usage?, interrupted?}` | **A7** |
| 8 | `assistant/attempt` | `{turn, step, stream}` | **J 层 / 错误可观测** |
| 9 | `tool/call` | `{turn, step, callId, name, arguments: string}` | B12 |
| 10 | `tool/result` | `{turn, step, callId, message, error?, meta?}` | B10/B12 |
| 11 | `compaction` | `{turn, summary, retainedTail, tokensBefore, usage?}` | **F9**（原草稿缺） |
| 12 | `checkpoint` | `{turn, provider: string, ref: JsonValue}` | **E11**（原草稿缺） |
| 13 | `request/header` | `{config, tools?, reason}` | **J4**（**Q12 定：进 L0，不再是 log-only**） |
| 14 | `session/revert` | `{targetSeq, phase: "revert"\|"undo"}` | E4（T-1-05 追加，✅ 已追认——落地记录 2） |
| 15 | `model/switch` | `{from: {provider, modelId}, to: {provider, modelId}, reason: "user"\|"rollback"}` | J9/J10/J14（T-P1-06 追加，✅ 已追认——落地记录 3） |
| 16 | `todo/update` | `{items: Array<{content, status: "pending"\|"in_progress"\|"completed"}>}` | G2（T-P1-10 追加——落地记录 4） |

`user/message.source` 必须是联合：照 DSH 的 `types.ts:309` 注释，人类 prompt、注入上下文、
目标续跑**三者都逐字投影 content，靠 `source` 区分**。没有 `source` 就再也分不开。
`session/revert`、`model/switch` 与 `todo/update` 是**会话级元事件**：不要求 turn/step
开合上下文，`turn` 挂流内最后轮（空流兜 0）。

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
- **落地记录 4（2026-09-26，T-P1-10 执行会话；⏳ 待追认）**：词汇表 15→16——G2 要求"todo 变更 = 事件，状态 = 投影"（plan-p1.md T-P1-10 明文，opencode·session/todo 的 Event.Updated 纪律同构），15 事件没有 todo 落点。已新增 `todo/update {items: Array<{content, status: "pending"|"in_progress"|"completed"}>}`（会话级元事件，session/revert / model/switch 同款纪律：不要求 turn/step 开合上下文、turn 挂流内最后轮空流兜 0）。items 是变更后的**完整清单**（E12 整值事件，绝非 delta），最新一条本事件即 todo 当前状态的事实源；status 值域三值（opencode 的 `cancelled` 不引入——G2 最小面，YAGNI）。同步面：events.ts（TodoUpdateEvent / EVENT_TYPES / 编译闸门）/ project.ts（validation 豁免 + 投影 todos 历史 + revert 切点切割）/ event-asserts.ts（O7 豁免面）/ tools/builtin/todo.ts（todo_write 工具 emit 落流）/ assembly.ts（createTodoUpdateEmitter 落流出口）/ repl.ts（进度渲染）。**不追认的回退面**：events.ts / project.ts / event-asserts.ts / todo.ts / index.ts / assembly.ts / repl.ts / l0-events.md 本记录 + events.test 计数——约 2 小时，全部为新增面（不触碰既有 15 事件语义）。
