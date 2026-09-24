# Codex 压缩与持久化精读（第六轮，用户指定"最好用"）

> 用户指定重点。范围：`core/src/compact*.rs`(3,735) + `core/src/context_manager/`(4,965)
> + **`rollout/` 整个 crate**(16,471)。
> 引用行号均已核验。

---

## 0. 一句话

**Codex 有两个彼此独立的压缩系统，我此前只意识到一个。**

| | 针对什么 | 在哪 | 手段 |
| --- | --- | --- | --- |
| **上下文压缩** | 模型的上下文窗口 | `core/src/compact*.rs` | 摘要 / 远端压缩 / 换新窗口 |
| **日志压缩** | 磁盘上的会话日志 | `rollout/src/compression.rs`(1,403) | **zstd 压冷文件** |

而上下文压缩的**真正洞见是：压缩是一个"生命周期"，不是一种"算法"** ——
四种实现共用一个生命周期，hook 可以在两端中止它，且**相位（phase）有四个**。

---

## 1. ★ 洞见一：压缩是**生命周期**，不是算法

`core/src/compact_token_budget.rs` 模块注释原文：

> Token-budget compaction **skips model/server summarization and installs a fresh context window**
> instead. **It is still modeled as compaction** so compact hooks and `ContextCompaction` turn items
> observe **the same lifecycle** as local or remote compaction.

**"即使它根本不做摘要，也要走压缩的生命周期"** —— 因为**下游观察者只认生命周期**。
生命周期（`run_compact_task_inner`）：

```
① run_pre_compact_hooks        → Continue | Stopped(→ Err(TurnAborted))
② emit TurnItem::ContextCompaction  started
③ <做实事：本地摘要 / 远端 v2 / token-budget 换窗 / 手动>
④ emit TurnItem::ContextCompaction  completed
⑤ run_post_compact_hooks       → Stopped(→ Err(TurnAborted))
```

**四种实现**（`CompactionImplementation: Responses | ResponsesCompactionV2`，
加上 token-budget 与 manual 两条不走摘要的路径）：

| 实现 | 文件 | 做什么 |
| --- | --- | --- |
| 本地摘要 | `compact.rs`(852) | 调模型生成摘要 |
| 远端压缩 v2 | `compact_remote_v2.rs`(**1,273**) | 服务端压缩，含 `compact_remote_v2_images.rs`(100) 与 `image_budget` 测试 |
| 远端历史 | `compact_remote_history.rs`(190) | — |
| **token-budget** | `compact_token_budget.rs`(84) | **不摘要，直接换一个新上下文窗口** |
| 模型降级回退 | `compact_model_fallback.rs`(59) | — |

> **对我方 F 层（P0）**：**把"压缩"定义成生命周期（有开始/结束事件、有 hook 可介入），
> 而不是一个函数。** 这样：①换实现不影响观察者 ②hook 能在压缩前后做事与中止
> ③"不摘要只换窗"这种降级路径也能复用同一套观测。

---

## 2. ★ 洞见二：压缩的分类学（6 个正交维度）

`analytics/src/facts.rs:444-487`。这是我读过的**最完整的压缩分类学**：

```rust
pub enum CompactionTrigger  { Manual, Auto }
pub enum CompactionReason   { UserRequested, ContextLimit, ModelDownshift, CompHashChanged }
pub enum CompactionImplementation { Responses, ResponsesCompactionV2 }
pub enum CompactionPhase    { StandaloneTurn, PreTurn, MidTurn, PostTurn }
pub enum CompactionStrategy { Memento, PrefixCompaction }
pub enum CompactionStatus   { Completed, Failed, Interrupted }
```

### 2.1 ★ `CompactionPhase` 四个值 —— 正面回答 pi-desktop ADR 0030

| 值 | 含义 |
| --- | --- |
| `StandaloneTurn` | 压缩占一个独立回合（手动 `/compact` 走这条） |
| `PreTurn` | 回合开始前 |
| **`MidTurn`** | **回合进行中**（loop 内部！） |
| `PostTurn` | 回合结束后 |

我记过的 `pi-desktop/docs/adr/0030-turn-boundary-context-checkpoint-compaction.md`
原文警告："**只在用户 prompt 之间、或运行已终止之后压缩，无法保护该循环内部的下一次
provider 请求**"，并给出了 `1,077,172 tokens vs 上限 1,000,000` 的真实事故。

**Codex 的答案是把它做成一等相位 `MidTurn`** —— 不是"在回合边界顺便压一下"，
而是**承认压缩可以发生在回合内部的任意位置，并给它一个可观测的名字**。

> **这是我方 F 层现在最该采纳的一条。** 我方只写了"压缩"，没有"压缩发生在哪"。

### 2.2 ★ `CompactionReason::ModelDownshift` 与 `CompHashChanged`

- **`ModelDownshift`** —— **换到上下文更小的模型时触发压缩**。
  这直接连到我方 J 层"运行时换模"：换模不只是切个 provider，**可能必须先压缩**，
  否则新模型装不下当前上下文。**这条我方完全没有。**
- **`CompHashChanged`** —— 压缩配置（提示词/策略）的哈希变了，于是已缓存的压缩结果失效。
  配套有 `fn comp_hash_changed(previous, current)`（`session/turn.rs:1304`）。
  **"压缩结果有指纹，指纹变了就重压"** —— 缓存失效的正确做法。

### 2.3 `CompactionStrategy: Memento | PrefixCompaction`

两种策略：**Memento**（"纪念品"，即摘要式保留）与 **PrefixCompaction**（压缩前缀、保留近尾）。
命名值得学：**策略是具名的，而不是"我们的压缩算法"**。

### 2.4 `CompactionStatus` 含 `Interrupted`

与 `Completed` / `Failed` 并列。**被取消的压缩是一个独立的结局**，不是失败。
（与我记过的"abort ≠ failure"一致。）

> **对我方 L 层（可观测，P1）**：压缩必须作为**结构化的度量事件**记录，
> 且六个维度都要有。缺任何一个，线上都答不出"为什么这次压缩发生了、它成功了吗"。

---

## 3. ★ 洞见三：上下文窗口是**编号的**，压缩 = 开一个新窗口

`core/src/session/mod.rs:4530` `start_new_context_window(step_context, world_state) -> u64`
返回 **`(window_number, window_ids)`**。随后：

```rust
self.replace_compacted_history(
    context_items,                                    // 重建的初始上下文
    Some(turn_context_item),
    Some(world_state),
    CompactedHistoryMetadata {
        message: String::new(),
        window_number, window_ids,
        compaction_response_id: None,
        compaction_model_hash: None,
        …
    }).await
```

**心智模型**：一个会话**不是"一串消息"**，而是**"一串编号的上下文窗口"**。
压缩不开除消息，而是**关掉当前窗口、开一个编号递增的新窗口**，并把该窗口的元数据持久化。
有测试 `start_new_context_window_persists_checkpoint_state`（`session/tests.rs:3658`）。

**这比我方"截断+摘要"的模型干净得多**：窗口是持久对象，问"当前是第几个窗口"
有确切答案，回放能定位到窗口边界。

### 3.1 ★ 压缩后重建上下文用的是**当前** world state

```rust
let context_items = self.build_initial_context_with_world_state(step_context, world_state.as_ref())
```

**新窗口的初始上下文是从"当前 step 的 world state"重建的**，不是从压缩前那份快照。
`WorldState` 在 Codex 里是一等对象（`context/world_state.rs`），
且在 `compact_token_budget.rs` 里被显式传递（`InitialContextInjection::BeforeLastUserMessage`
/ `DoNotInject` 两种注入时机）。

> **对我方 F 层**：**压缩后重建的上下文，必须用"压缩那一刻的真实状态"重建，
> 不能用压缩前抓的快照** —— 否则新窗口一开就是过期的。

### 3.2 ★ 客户注入的 developer 消息要**跨压缩保留**

`session/mod.rs:4536`：

```rust
let retained_client_developer_messages = if self.enabled(Feature::RetainClientDeveloperMessages) {
    let history = self.clone_history().await;
    truncate_retained_messages_for_remote_compaction(
        history.annotated_items().iter()
            .filter(|item| is_client_authored_developer_message(item)).cloned().collect(),
        RETAINED_MESSAGE_TOKEN_BUDGET)
} else { Vec::new() };
```

**客户端（调用方/插件）写进去的 developer 消息，压缩时不能被丢掉** ——
否则那些"设定"会静默消失，而模型行为变了却没人知道为什么。
且保留有**独立预算** `RETAINED_MESSAGE_TOKEN_BUDGET`。

> **对我方 F 层（P0）**：**压缩必须显式声明"哪些消息不可丢"**，
> 并给它们独立预算。我方现在没有这个概念 —— 而我们的多端/插件架构下，
> "谁注入过什么"恰恰是最容易被压缩吃掉的东西。

---

## 4. ★ 预算不是"限制"，是**要送达的事实**（`rollout_budget.rs`）

`core/src/rollout_budget.rs`(121) + `RolloutBudgetConfig`（`config/mod.rs:1283`）：

```rust
pub struct RolloutBudgetConfig {
    pub limit_tokens: i64,
    pub reminder_at_remaining_tokens: Vec<i64>,   // 多个阈值
    pub sampling_token_weight: f64,               // 输出 token 的权重
    pub prefill_token_weight: f64,                // 非缓存输入 token 的权重
}
```

### 4.1 三件值得抄的事

**(a) token 不是同价的：输出与（非缓存）输入各有权重。**
`record_usage` 用 `output_tokens * sampling_token_weight + non_cached_input() * prefill_token_weight`。
**缓存命中与未命中被区分对待** —— 与我记过的"缓存前缀稳定性"维度对上。
（若后端直接给 `codex_rollout_budget_units` 就用它，否则本地算；
且**非有限值或负值直接 `Err(Fatal)`**，不静默修正。）

**(b) 阈值是**一组**，不是"到点就停"。**

```rust
let reminder_index = state.config.reminder_at_remaining_tokens.iter()
    .filter(|&&threshold| remaining_tokens <= threshold).count() as i64;
```

`reminder_index` = **已跨越的阈值个数**，天然单调。
于是"提醒"可以分级（剩余 50% / 20% / 5% 各提醒一次）。

**(c) ★ 送达要记账，且"写进历史之后才算送达"**

```rust
/// Last reminder delivered to each thread, so every thread observes crossed thresholds.
deliveries: HashMap<ThreadId, ThreadBudgetDelivery>,
```

```rust
/// Mark delivery only after history insertion; cancellation before then should retry it.
pub(crate) fn mark_reminder_delivered(&self, thread_id, window_id, reminder) { … }
```

**关键点**：①记到**每个线程**（一个根会话树下多个子 agent，**每个都要看到自己的阈值**）
②**取消在写历史之前发生 → 提醒会重试**（至少一次送达）
③`deliveries` 绑定 `window_id`，**换窗口后提醒重新武装**。

> **对我方 M 层（长任务）**：**预算耗尽是"要送达模型的事实"，不是"到点硬停"。**
> 我方现在只写了限额。**改成"限额 + 分级提醒 + 送达记账 + 换窗重置"** ——
> 否则长任务的失败模式是"突然被截断且无人知道为什么"。

---

## 5. 日志压缩：一个我此前完全没意识到的独立系统

`rollout/src/compression.rs`(1,403)。特性清单：

| 特性 | 实现 |
| --- | --- |
| 算法 | **zstd**，产物后缀 `.zst`（`COMPRESSED_SUFFIX`） |
| 触发 | `RolloutCompressionTrigger { Startup, Rpc }` —— 注释特意写明"**请求压缩的入口，不是 Statsig 分组**" |
| 执行 | **后台 fire-and-forget worker**：失败只记日志、**不阻塞启动**、`codex_home` 下有**运行标记**防重叠与过频 |
| 对象 | **冷文件**（`spawn_rollout_compression_worker`） |
| 阅读 | ★ **`open_rollout_line_reader` 透明处理 `.jsonl` 与 `.jsonl.zst`** |
| 竞态 | 若读取路径在**表示形态切换期间**消失，**短暂重试**（`MAX_NOT_FOUND_RETRIES = 3`，间隔 50ms），**让调用方不需要知道磁盘上是哪种表示** |
| 写入 | `persist_temp_file_noclobber`（临时文件 + noclobber 原子替换），`TEMP_SUFFIX` + `TEMP_COUNTER: AtomicU64` |
| 权限 | `create_file_with_permissions` —— 重写时**保留原文件权限** |

### 5.1 ★ 核心设计：**日志的表示形态是实现细节**

> 调用方永远只调 `open_rollout_line_reader`，**不需要知道文件是明文还是压缩的**。

于是"压缩旧日志"这个优化**对上层完全透明**，可以独立演进而不动任何调用方。
且因为是**冷文件 + 后台 + 最好努力**，它**永远不会阻塞热路径**。

> **对我方 Q 层（会话数据运维，P1）**：**这是我方完全没有的一块，也是"事件源"架构必然的债** ——
> append-only 日志会无限增长。Codex 的答案是：
> **①冷热分离 ②后台压缩 ③表示形态对上层透明 ④原子替换保权限 ⑤有运行标记防重叠。**
> **这条我建议整条采纳**，且它不影响热路径设计（可以 P1 再上）。

---

## 6. `rollout/` crate 的其他部分（16,471 行）

```
recorder.rs (2,249)   → 写入路径
list.rs    (1,703)    → 会话枚举/排序/搜索入口
state_db.rs (744)     → 状态索引（与 JSONL 并存的查询层）
metadata.rs (491)     → 会话元数据
search.rs   (370)     → 检索
persistence_metrics.rs (439) → 持久化自身的度量
```

目录常量：`SESSIONS_SUBDIR` 与 **`ARCHIVED_SESSIONS_SUBDIR`** —— **归档是独立的一档**，
不是"删掉"。（对照 pi-desktop 的 `AUDIT_RETENTION_MS`/`TASK_RUNS_KEEP` 保留策略。）

**一个反例（值得记）**：`rollout/src/list.rs:1` 是

```rust
#![allow(warnings, clippy::all)]
```

**整个文件关掉全部告警与 clippy**，且**没有理由**。
对照我记过的 ZCode `/* eslint-disable max-lines -- 理由 */` 与 DSH
`oxlint-disable-next-line … -- 理由`：**同一个 Codex，有的地方纪律严明、有的地方整文件静音。**
这说明"纪律"是逐处的，不是逐仓的 —— **我方写规范时要防这一点**。

---

## 7. 对需求文档的净影响（本轮 Codex 压缩/持久化部分）

| 编号 | 条目 | 优先级 |
| --- | --- | --- |
| **F14** | **压缩是生命周期**（开始/结束事件 + hook 可介入/中止），不是函数；换实现不影响观察者 | **P0** |
| **F15** | **压缩有"相位"**：`StandaloneTurn / PreTurn / MidTurn / PostTurn`；**MidTurn 必须支持** | **P0** |
| **F16** | **压缩后重建上下文用"压缩那一刻"的状态，不用压缩前的快照** | **P0** |
| **F17** | **压缩必须声明"哪些消息不可丢"**（客户/插件注入的 developer 消息），给独立预算 | **P0** |
| **F18** | **上下文窗口编号化**；压缩 = 开新窗口 + 持久化窗口元数据 | P1 |
| **F19** | **换到更小上下文的模型时，必须先压缩**（`ModelDownshift`） | **P0** |
| **F20** | **压缩结果带指纹**（配置哈希），指纹变了重压 | P1 |
| **F21** | 压缩策略具名（摘要式 / 前缀式），不是"我们的算法" | P2 |
| **L8** | 压缩作为**结构化度量事件**，6 维度：trigger/reason/implementation/phase/strategy/status | P1 |
| **M10** | **预算是"要送达的事实"**：分级阈值 + 送达记账（写历史后才算送达，取消则重试）+ 换窗重置 | **P0** |
| **J24** | **输出 token 与非缓存输入 token 不同价**，预算按权重计 | P1 |
| **Q4** | **日志冷热分离 + 后台 zstd 压缩 + 表示形态对上层透明 + 原子替换保权限 + 运行标记防重叠** | **P1** |
| **Q5** | **归档是独立一档**（`ARCHIVED_SESSIONS_SUBDIR`），不是删除 | P2 |

**其中 P0 六条（F14/F15/F16/F17/F19/M10）** —— 这是继上一轮 C43–C51 之后最大的一批。

---

## 8. 诚实声明：未读

- `compact_remote_v2.rs`(1,273) 的**实现** —— 只读了文件名、行数与它在 `start_new_context_window` 里被调用的两处
- `context_manager/history.rs`(1,225) + `normalize.rs`(420) + `updates.rs`(60) —— **未读**
  （这是"历史如何规范化"的所在，本轮没碰）
- `rollout/src/recorder.rs`(2,249) 的**写入路径实现** —— 只读了头部 import
- `rollout/src/list.rs`(1,703)、`state_db.rs`(744)、`metadata.rs`(491)、`search.rs`(370) —— **未读**
- `compact.rs`(852) 的主体（只读了模块头与函数表）—— **未读**
- `SessionSummarizationPrompt` / `SUMMARIZATION_PROMPT` / `SUMMARY_PREFIX` 的实际提示词 —— **未读**
- `core/tests/suite/compact.rs`(**5,677 行测试**) —— **未读**（这是"怎么断言压缩行为"的答案所在）

**本报告是"压缩生命周期 + 分类学 + 窗口编号 + 预算送达 + 日志压缩存在性"五点。**
