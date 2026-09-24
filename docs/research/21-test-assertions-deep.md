# 测试断言深读（第八轮：真实快照与真实断言）

> 上一轮 `20-testing.md` §6 我写明：**"某一条 `insta::assert_snapshot!` 里到底断言了什么字符串——
> 我一条都没看。这是本轮最该被追问的地方。"** 本轮补上。
> 引用行号、快照内容均为实测原文。

---

## 0. 一句话

**Codex 的快照测试是我在这个调研项目里见过的最好的工程产出物。**
一条快照同时表达了：**每个上下文窗口里模型看到了什么、窗口为何在此处结束、哪些条目是新增的。**
一个 reviewer 在 PR diff 里**直接就能看懂**，不需要读懂测试代码。

---

## 1. 快照的真实长相（`mid_turn_compaction_shapes.snap`，39 行，全文核心）

```
---
source: core/tests/suite/compact.rs
expression: "format_history_snapshot(\"True mid-turn continuation compaction after tool output:
  compact request includes tool artifacts, and the continuation request includes the summary in the same turn.\", …)"
---
Scenario: True mid-turn continuation compaction after tool output: compact request includes tool
artifacts, and the continuation request includes the summary in the same turn.

## Window 1
-- request 1 (turn) --
00:message/developer:
    <PERMISSIONS_INSTRUCTIONS>
01:message/user:
    <ENVIRONMENT_CONTEXT>
02:message/user:
    function call limit push

## Window 2 (after request 1: settings changed (parallel_tool_calls, tools))
-- request 2 (compaction) --
00:message/developer:
    <PERMISSIONS_INSTRUCTIONS>
01:message/user:
    <ENVIRONMENT_CONTEXT>
02:message/user:
    function call limit push
03:function_call/test_tool:{}
04:function_call_output:unsupported call: test_tool
05:message/user:
    <SUMMARIZATION_PROMPT>

## Window 3 (after request 2: input diverged at item 03, settings changed (parallel_tool_calls, tools))
-- request 3 (turn) --
00:message/developer:
    <PERMISSIONS_INSTRUCTIONS>
01:message/user:
    <ENVIRONMENT_CONTEXT>
02:message/user:
    function call limit push
03:message/user:
    <COMPACTION_SUMMARY>
    AUTO_SUMMARY
```

### 1.1 五个设计要素（每一个都值得抄）

**(a) ★ 窗口头记录了"为什么在此处开新窗口"**

```
## Window 2 (after request 1: settings changed (parallel_tool_calls, tools))
## Window 3 (after request 2: input diverged at item 03, settings changed (parallel_tool_calls, tools))
```

**开新窗口的原因只有两类，且都写出来了**：
**①settings 变了**（列出是哪些设置）**②输入在某条 item 处分叉**（给出下标）。
**这就是上一轮我说的"窗口内差分快照"的实现** —— 差分不是隐藏的，它**写在标题上**。

**(b) 已知长段落被换成一行标签**（`rewrite_known_segments()`）：
`<PERMISSIONS_INSTRUCTIONS>` / `<ENVIRONMENT_CONTEXT>` / `<SUMMARIZATION_PROMPT>` / `<COMPACTION_SUMMARY>`。
**快照里留下的全是"会变的东西"，不变的指引被折叠成标签** —— 于是 diff 里噪音极少。

**(c) 条目编号是 `NN:kind` 格式**，且**跨请求连续**：
`03:function_call/test_tool:{}`、`04:function_call_output:unsupported call: test_tool`、
`04:agent_message`（无值的块类型）。
**编号连续 ⇒ 可以用下标精确描述"从哪一条开始分叉"。**

**(d) `Scenario:` 是一句完整的自然语言**，描述**期望的语义**：

> "True mid-turn continuation compaction after tool output: compact request includes tool
> artifacts, and the continuation request includes the summary in the same turn."

**测试把语义写在快照里**，不是写在测试名里。于是快照本身就是规格。

**(e) 测试名与快照名一致**，且**每个压缩相位/原因各有一条**：
`mid_turn_compaction_shapes`（MidTurn）、`pre_sampling_model_switch_compaction_shapes`（ModelDownshift）、
`pre_turn_compaction_context_window_exceeded_shapes`、`pre_turn_compaction_including_incoming_shapes`、
`pre_turn_compaction_strips_incoming_model_switch_shapes`、`manual_compact_with_history_shapes`、
`compaction_cold_resume_after_completion`。全仓共 **43 个快照**，其中 compact 占 8 个。

> **这直接印证了我在 `17-codex-compact-persistence.md` 记的分类学**
> （`CompactionPhase: StandaloneTurn|PreTurn|MidTurn|PostTurn`、`Reason: ModelDownshift|…`）——
> **它不是纸面设计，每个相位与原因都有对应的行为快照锁着。**

---

## 2. ★ 结构化断言与快照**配对使用**（`compact.rs:423-448`）

快照不是唯一的断言。同一条测试里先做**结构化断言**，每条都带一句意图说明：

```rust
fn assert_pre_sampling_switch_compaction_requests(
    first, compact, follow_up, previous_model: &str, next_model: &str) {
    assert_eq!(first["model"].as_str(),     Some(previous_model));
    assert_eq!(compact["model"].as_str(),   Some(previous_model));   // ★ 压缩用【旧】模型
    assert_eq!(follow_up["model"].as_str(), Some(next_model));       // ★ 后续用【新】模型

    let compact_body = compact.to_string();
    assert!(body_contains_text(&compact_body, SUMMARIZATION_PROMPT),
        "pre-sampling compact request should include summarization prompt");
    assert!(!compact_body.contains("<model_switch>"),
        "pre-sampling compact request should strip trailing model-switch update item");
    assert!(follow_up.to_string().contains("<model_switch>"),
        "follow-up request after successful model-switch compaction should include model-switch update item");
}
```

### 2.1 值得学的三点

**(a) 换模时的压缩语义被精确钉死**：压缩请求跑在**旧模型**上，后续请求跑在**新模型**上。
这就是 `CompactionReason::ModelDownshift` 的实际语义 —— **用装得下的旧模型做压缩，
再切到新的小窗口模型**。**这条我此前没有意识到**（我上一轮只写了"换模前必须先压缩"）。

**(b) `model_switch` 更新项：压缩时剥掉、后续请求带上。** 一个很细的行为，
靠两条 `assert!` + 一句说明锁住。**没有快照的话这种细节根本不会被注意到。**

**(c) 每条断言都有第三参数 = 一句人话。**
失败时测试输出直接说明**哪条语义被破坏了**，而不是给一个 JSON diff。

### 2.2 分工原则（我的总结）

| 断言类型 | 用来钉什么 | 失败时给出 |
| --- | --- | --- |
| `assert_eq!` + 说明 | **少数几条关键语义**（模型选择、提示词在不在、某个 tag 在不在） | **一句人话 + 具体值** |
| `insta::assert_snapshot!` | **其余全部**（上下文组装的整体形状） | **可 review 的 diff** |

**这个分工是整件事的关键**：语义断言给**可读的失败**，快照给**全覆盖**。

且请求数量单独断言，带说明（`compact.rs:2356`）：

```rust
assert_eq!(requests.len(), 3, "expected user, compact, and follow-up requests");
```

**先钉住"应该发生几次模型调用"** —— 数量错了说明流程结构错了，
这时给一句人话远比给一张快照 diff 有用。

---

## 3. ★★ 事件序列怎么断言 —— 答案是"断言流上的不变量"，不是"断言事件列表"

`compact.rs:450-484` `assert_compaction_uses_turn_lifecycle_id`：

```rust
let mut turn_started_id = None;
let mut turn_completed_id = None;
let mut compact_started_id = None;
let mut compact_completed_id = None;

while turn_completed_id.is_none() {
    let event = codex.next_event().await.expect("next event");
    match event.msg {
        EventMsg::TurnStarted(_)    => turn_started_id    = Some(event.id.clone()),
        EventMsg::ItemStarted(ItemStartedEvent { item: TurnItem::ContextCompaction(_), .. })
                                    => compact_started_id = Some(event.id.clone()),
        EventMsg::ItemCompleted(ItemCompletedEvent { item: TurnItem::ContextCompaction(_), .. })
                                    => compact_completed_id = Some(event.id.clone()),
        EventMsg::Error(error)      => panic!("unexpected compaction error: {error:?}"),
        EventMsg::TurnComplete(_)   => turn_completed_id  = Some(event.id.clone()),
        _ => {}
    }
}

assert_eq!(turn_completed_id, turn_started_id,
    "turn start and complete should use the same event id");
assert_eq!(compact_started_id, Some(turn_started_id.clone()),
    "compaction item start should use the turn event id");
assert_eq!(compact_completed_id, Some(turn_started_id),
    "compaction item completion should use the turn event id");
```

### 3.1 这条测试真正在断言什么

**它不断言"事件序列是 A,B,C,D"。** 它断言一条**结构性不变量**：

> **一个回合内产生的所有条目，都携带该回合的事件 id。**

因为 `EventMsg` 的信封有一个 `id` 字段，而 **turn 的 id 被复用于它内部的所有 item**。
客户端靠这个 id 把 item 归到 turn 里。**测试锁的是这个身份契约，不是事件顺序。**

### 3.2 为什么这个写法对

- **不脆**：新增一个事件类型不需要改测试（`_ => {}` 兜底）；
  断言的是"同 id"这条不变量，与序列长短无关。
- **测的是真流**：`codex.next_event().await` 消费的是**真实会话产生的类型化事件流**，
  不是被 mock 出来的。
- **匹配变体而非字符串**：`EventMsg::ItemStarted(ItemStartedEvent { item: TurnItem::ContextCompaction(_), .. })`
  —— **Rust 的模式匹配把"事件类型 + 载荷形状"一起钉住**，改名/改结构会在编译期炸。
- **`panic!("unexpected compaction error")`**：**不期望的事件直接炸**，
  而不是让它默默流过去。

> **对我方 O 层（P0）**：**断言事件序列的正确方式是"在真实事件流上断言不变量"**，
> 例如：①同一回合的所有条目共享回合 id ②成对事件（问/答、调用/结果）成对出现
> ③终态事件恰好一个。**不要写"期望事件列表 [A,B,C]"** —— 那是脆的、且会随功能增长而腐坏。

---

## 4. 对照：窗口内的差分快照（`pending_input_queued_mail_after_commentary.snap`）

```
## Window 1
-- request 1 (request; First request) --
00:message/developer:  <PERMISSIONS_INSTRUCTIONS>
01:message/user:       <ENVIRONMENT_CONTEXT>
02:message/user:       first prompt
-- request 2 (request; Second request) --
03:message/assistant:  first answer
04:agent_message
```

**同一个窗口内的第二条请求，只列出 03 与 04 —— 新增的后缀**，编号从 03 接续。
**这确认了差分机制**：编号在一个窗口内连续，后续请求只显示"新增了什么"。

请求标签格式是 `(kind; label)`：`(turn)` / `(compaction)` / `(request; First request)`。

---

## 5. 对需求文档的净影响（O 层续）

| 编号 | 条目 | 优先级 |
| --- | --- | --- |
| **O13** | **断言事件序列 = 在真实事件流上断言不变量**（同回合共享 id / 成对事件成对 / 终态恰一个），**不写事件列表** | **P0** |
| **O14** | **快照的窗口头必须记录"窗口为何在此结束"**（settings 变了 / 输入在第 N 条分叉） | **P0** |
| **O15** | **结构化断言与快照配对**：少数关键语义用 `assert` + 一句人话；其余全部交给快照 | **P0** |
| **O16** | **先断言模型调用次数**，带说明（结构错了时给可读失败，而不是快照 diff） | P1 |
| **O17** | **快照里写 `Scenario:` 一句自然语言**描述期望语义 —— 快照本身即规格 | P1 |
| **O18** | **每个相位/每个原因各有一条快照**（Codex compact 有 8 条） | P1 |
| **O19** | 不期望的事件类型**直接 panic**，不静默流过 | P2 |
| **F23** | **换模压缩语义**：压缩请求跑在**旧**模型上，后续请求跑在**新**模型上；压缩时剥掉 model-switch 更新项、后续带上 | **P1** |

**O13/O14/O15 三条 P0** —— 加上上一轮的 O1/O2/O4，O 层现在共 **6 条 P0**。

---

## 6. 诚实声明

**本轮读的是 Codex 一家**（用户说"继续好好读"，我接的是自己上一轮点名的"最该被追问的地方"）。
具体覆盖：

- ✅ `compact.rs` 的快照断言用法（`insta::assert_snapshot!` 6 处里读了 2 处完整上下文）
- ✅ `assert_pre_sampling_switch_compaction_requests`（全文 26 行）
- ✅ `assert_compaction_uses_turn_lifecycle_id`（全文 35 行）
- ✅ 两条完整快照文件（`mid_turn_compaction_shapes` 全文 39 行、`pending_input_…` 前 40 行）
- ✅ 43 个快照文件的**名字**（据此推断覆盖范围）
- ❌ `compact.rs` 的**其余 6,500 行**（我只读了约 120 行）
- ❌ `session/tests.rs`(12,880)、其余 188 个 suite 文件
- ❌ kimi/DSH/pi-desktop 的**任何一条真实断言**

**所以：我现在能描述"Codex 怎么断言压缩"，不能描述"Codex 怎么断言其余一切"，
也不能描述"其他四家怎么断言任何东西"。**

**下一步最有价值的**（按我判断的性价比排序）：
1. **`session/tests.rs`(12,880)** —— 全仓最大测试文件，事件与生命周期断言的主战场
2. **DSH `session-snapshot/src/normalize.ts`(625)** —— 归一化怎么做（我方 O4 的直接参考）
3. **kimi `harness/snapshots.ts`(388) + `agent.ts`(2,909) 的实现** —— 第二家怎么做同类事
4. **pi-desktop 的 `plugins/tests.rs`(2,186)** —— 唯一一个非 agent-loop 的测试样本（插件校验）
