# 测试实现深读（第九轮：Codex session/tests.rs、kimi snapshots、pi-desktop plugins）

> 上一轮 §6 我列的三个下一步，本轮全做。引用均为实测原文。

---

## 1. Codex `session/tests.rs`（12,880 行，全仓最大测试文件）

### 1.1 ★ 首先修正一个预期：它不是"事件序列测试"

415 个测试函数。抽样后看，它其实是一个**混合体**，按主题成簇：

| 簇 | 测试数（约） | 例子 |
| --- | --- | --- |
| **托管网络代理** | **8+** | `danger_full_access_turns_do_not_expose_managed_network_proxy` |
| 配置热重载 | 7+ | `reload_user_config_layer_keeps_previous_config_for_malformed_shell_policy` |
| 度量/遥测 | 5+ | `single_histogram_attributes`、`extension_metrics_preserve_session_metadata_tags` |
| MCP elicitation | 2 | `request_mcp_server_elicitation_auto_accepts_when_auto_deny_is_enabled` |
| 流解析器 | 3 | `assistant_message_stream_parsers_seed_buffered_prefix_stays_out_of_finish_tail` |
| 网络策略修订 | 2 | `validated_network_policy_amendment_host_allows_normalized_match` |
| 中断/生命周期 | 2 | `interrupting_regular_turn_waiting_on_startup_prewarm_emits_turn_aborted` |

### 1.2 ★ 测试名就是完整的行为规格（命名规范值得直接抄）

```
user_shell_commands_do_not_inherit_managed_network_proxy
danger_full_access_tool_attempts_do_not_enforce_managed_network
user_shell_commands_remain_login_shells_when_model_login_shells_are_disabled
reload_user_config_layer_keeps_previous_config_for_malformed_shell_policy
refresh_runtime_config_updates_runtime_refreshable_fields_and_keeps_session_static_settings
```

**每个名字陈述一条规则，且把边界写进名字里。**
读者不用打开测试就知道"用户 shell 不继承托管代理"这条安全边界存在且被测着。

**顺带暴露了两条我此前不知道的设计**：
- **配置解析失败时保留上一份配置**（`keeps_previous_config_for_malformed_shell_policy`），
  **不是回退到默认值** —— 回退到默认可能变宽松，这是 fail-safe 的正确方向。
- **配置分两类**：`runtime_refreshable_fields`（可热刷新）与 `session_static_settings`（会话内静态）。

### 1.3 ★ 事件断言的实际写法（与 `compact.rs` 是两种风格）

`session/tests.rs:761` `interrupting_regular_turn_waiting_on_startup_prewarm_emits_turn_aborted`：

```rust
let (sess, tc, rx) = make_session_and_context_with_rx().await;
// …挂一个永不 ready 的 startup prewarm…

let first = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await
    .expect("expected turn started event without waiting for startup prewarm")
    .expect("channel open");
assert!(matches!(
    first.msg,
    EventMsg::TurnStarted(TurnStartedEvent { turn_id, .. }) if turn_id == tc.sub_id
));

sess.abort_all_tasks(TurnAbortReason::Interrupted).await;

let marker_evt = tokio::time::timeout(Duration::from_secs(2), rx.recv()).await
    .expect("expected turn aborted marker event").expect("channel open");
assert!(matches!(marker_evt.msg, EventMsg::RawResponseItem(_)));

let second = tokio::time::timeout(Duration::from_secs(2), rx.recv()).await
    .expect("expected turn aborted event").expect("channel open");
let EventMsg::TurnAborted(TurnAbortedEvent { turn_id, .. }) = second.msg else { … };
```

**四个要点：**

**(a) 会话把事件推进一个 channel，测试逐条 `rx.recv()`。**
顺序**由连续的 recv 表达** —— 不写事件列表，但顺序仍被锁住。

**(b) ★ 每次 recv 都套 `tokio::time::timeout`，且 `.expect("expected <哪个事件>")`。**
**事件驱动的测试最坏的失败是"挂住"** —— 超时 + 具名期望把挂住变成一句可读的失败。

**(c) `matches!(… EventMsg::TurnStarted(TurnStartedEvent { turn_id, .. }) if turn_id == tc.sub_id)`**
—— **匹配"变体 + 载荷形状 + 一条字段关系"（用 `if` 守卫）**。
这是 Rust 特有的优势：改名/改结构**在编译期就炸**。

**(d) 中断路径中途会发一条 `EventMsg::RawResponseItem(_)` 标记事件** ——
测试把这个中间态也钉住了。**"中止时先发一条原始项"是一条被测试固定的行为契约。**

### 1.4 与 `compact.rs` 的对照（两种事件断言风格，都该有）

| | `compact.rs` | `session/tests.rs` |
| --- | --- | --- |
| 断言 | **跨事件的身份不变量**（同回合共享 id） | **有序的状态迁移 + 字段关系** |
| 循环 | `while` 收齐再断言 | 逐条 recv 逐条断言 |
| 强项 | 不脆，新增事件类型不用改 | 顺序与中间态被锁住 |
| 弱项 | 顺序没锁 | 事件多了会脆 |

**两种风格并存，各管一类不变量。** 我方 O13 应写成"两种都允许，按断言对象选"。

---

## 2. kimi-code：快照的**序列化器**是自己写的，差分在序列化时算

`test/harness/snapshots.ts`(388)。核心不是"收集数据"，是**三个自定义 vitest 序列化器**。

### 2.1 ★ 用 Symbol 做标记，注册自定义序列化器

```ts
const IS_EVENT_ARRAY = Symbol('isEventArray');
const IS_GENERATE_INPUT_SNAPSHOT = Symbol('isGenerateInputSnapshot');
const IS_GENERATE_INPUTS_SNAPSHOT = Symbol('isGenerateInputsSnapshot');

expect.addSnapshotSerializer({
  test(val) { return hasSnapshotSymbol(val, IS_EVENT_ARRAY); },
  serialize(val) { … }
});
```

**测试调用方拿到的是一个"带标记的对象"**，怎么打印由 harness 决定。
于是 `expect(x).toMatchSnapshot()` 的**输出格式是harness 的职责**，不是每个测试的负担。

### 2.2 ★★ 事件快照：列对齐 + 单行 JSON

```ts
const maxEventLength = Math.max(...events.map(e => String(e['event']).length), 0) + 2;
return events.map(v => {
    const prefix = v['type'] === '[rpc]' ? '[emit]' : '[wire]';
    return `${prefix} ${String(v['event']).padEnd(maxEventLength, ' ')} ${stringifyCompact(v['args'])}`;
}).join('\n');
```

其中 `stringifyCompact = JSON.stringify(obj, null, 1).replaceAll(/\n\s*/g, ' ').trim()`
（**JSON 压成一行**）。产出长这样：

```
[wire] session/created       {"id":"log-1"}
[emit] permission/requested  {"toolName":"bash"}
[wire] turn/end              {"reason":"completed"}
```

**domain 事件（`[wire]`）与 RPC 调用（`[emit]`）在同一条流里按序交错** ——
一份快照同时看到"发生了什么"与"对外发了什么"。**列对齐由 `padEnd` 按全体最长事件名算。**

### 2.3 ★★ 模型输入快照：差分**在序列化时按 previous 算**

```ts
function formatGenerateInput(input: GenerateCall, previous: GenerateCall | undefined): string {
  const lines: string[] = [];
  if (previous === undefined || previous.systemPrompt !== input.systemPrompt)
    lines.push(`system: ${formatSystemPrompt(input.systemPrompt)}`);
  if (previous === undefined || !isDeepEqual(previous.tools, input.tools))
    lines.push(`tools: ${formatToolNames(input.tools)}`);
  lines.push('messages:');
  if (previous !== undefined && isMessagePrefix(previous.history, input.history)) {
    const addedMessages = input.history.slice(previous.history.length);
    lines.push('  <last>');
    if (addedMessages.length > 0) lines.push(...formatMessages(addedMessages));
    return lines.join('\n');
  }
  lines.push(...formatMessages(input.history));
  return lines.join('\n');
}
```

**四条规则，每条都有理由：**

**(a) system prompt 只在与 previous 不同时才打印**，且：
```ts
function formatSystemPrompt(sp) {
  if (sp === DEFAULT_TEST_SYSTEM_PROMPT) return '<system-prompt>';
  return JSON.stringify(sp);
}
```
**等于默认值 → 折叠成 `<system-prompt>` 标签；不等于默认值 → 完整打印。**
> **这使得"提示词前缀稳定性"变成可测的** —— 一次不小心的 system prompt 改动会在快照里
> 炸出一大段 diff。**这正面服务于我记过的"缓存前缀稳定性"维度（J 层）。**

**(b) tools 只在变化时打印，且只打印名字**（`tools.map(t => t.name).join(', ')`），
**不打 schema**。工具清单变化可见，schema 噪音不进快照。

**(c) ★ `GenerateInputSnapshot { input, previous }` —— 快照**自带前一次调用**。**
差分不需要测试作者手写，是**结构里带着的**。

**(d) histories 是前缀关系 → 只打新增（`<last>` 标记）；不是前缀 → 打全部。**
**"不是前缀"正是危险情形（有改写/删除），此时全量打印是对的。**

### 2.4 `createEventSnapshotter()`：**稳定标签**，不是通用占位符

```ts
interface SnapshotLabels {
  readonly uuidLabels: Map<string, string>;
  readonly msgLabels: Map<string, string>;
  readonly interactionLabels: Map<string, string>;
}
export function createEventSnapshotter() { … return events => eventSnapshot(events, labels); }
```

**同一批快照内，每个不同的 UUID 被映射到一个固定标签。**

> **这比 DSH 的 `{{sessionId}}` 占位符更进一步**：
> 占位符**抹掉身份**（两个不同 id 打印成同一串），稳定标签**保留身份**（`log-1`、`log-2`），
> 于是快照里仍然能断言"**同一个 id 出现在事件 1、5、9**"。
>
> **归一化的两种策略，我建议我方同时具备**：DSH 式占位符用于**纯易变值**
> （时间戳、字节数），kimi 式稳定标签用于**有身份的 id**。

### 2.5 `test/setup.ts`：进程全局环境的清理

```ts
for (const key of Object.keys(process.env)) if (key.startsWith('KIMI_CODE_')) delete process.env[key];
process.env['KIMI_CODE_PERSISTENCE_MINIDB_READMODEL'] = 'false';
```
**在 setup 阶段清空所有相关环境变量**（kimi 的解法；pi-desktop 用锁，见 §3）。

---

## 3. pi-desktop `plugins/tests.rs`（2,186 行）：唯一一个非 agent-loop 的样本

### 3.1 ★ 它解决的是**进程全局状态的测试隔离**

```rust
/// Serializes tests that repoint `PI_DESKTOP_PLUGIN_MARKET_URL`.
///
/// The marketplace source is **process-global**, so two tests pointing it at
/// different catalogs — or one clearing it while another is mid-fetch —
/// **read each other's value**.
static MARKET_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn lock_market_env() -> std::sync::MutexGuard<'static, ()> {
    MARKET_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

fn with_local_market<T>(f: impl FnOnce() -> T) -> T {
    let _guard = lock_market_env();
    // Force offline/local fallback path for deterministic unit tests.
    // Safety: test-only process env mutation.
    unsafe { std::env::set_var("PI_DESKTOP_PLUGIN_MARKET_URL", "file:///nope/does-not-exist-catalog.json"); }
    let out = f();
    unsafe { std::env::remove_var("PI_DESKTOP_PLUGIN_MARKET_URL"); }
    out
}
```

**四点：**
- **注释写清了故障机制**（"两个测试设不同 catalog / 一个还在 fetch 时另一个清了它 → 互相读到对方的值"），
  不只是"加锁因为要加锁"。
- **`Mutex::new(())` 当锁**（Rust 惯用法：不保护数据，只做互斥）；
  `unwrap_or_else(|e| e.into_inner())` **处理中毒**（一个测试 panic 不该让其余全部失败）。
- **`_guard` 由 RAII 释放**，且**围住"设变量 + 跑 + 清变量"三段**，不是一个点。
- **`unsafe` 带 `// Safety:` 说明** —— Rust 2024 把 `env::set_var` 标为 unsafe（非线程安全），
  每处都要交代理由。

**(b) 用"指向不存在的 URL"强制走离线/本地回退** ——
**这是让有网络行为的代码变成确定性单测的标准手法**。

**(c) 测试断言的是行为链，且失败消息说明断言意图**：

```rust
let installed = mgr.install_from_market("demo.hello", None, true, true, None).unwrap();
assert_eq!(installed.plugin.source, "marketplace");
let listed = mgr.list();
assert!(listed.iter().any(|p| p.id == "demo.hello"),
    "installed marketplace plugin must be present in the registry");
```

**注意最后一条是"安装完必须出现在注册表里"这条语义**，不是"某个字段等于某值" ——
**断言的是跨组件的因果，不是内部形状。**

---

## 4. 三家的对照与本轮结论

| | 断言对象 | 归一化策略 | 差分的实现位置 | 隔离问题的解法 |
| --- | --- | --- | --- | --- |
| **Codex** | 模型上下文（快照）+ 真实事件流（不变量/有序迁移） | 具名标签折叠长段 | **快照格式内部**（窗口头记录原因） | 每测试 `MockServer` |
| **kimi** | 事件/RPC/wire 流 + 模型输入 | **稳定标签**（保留 id 身份） | **序列化时对比 previous** | setup 清环境变量 |
| **pi-desktop** | 行为因果链 | —（不做快照） | — | **静态 Mutex + RAII 守卫** |

### 4.1 新增需求项 —— 7 条，3 条 P0

| 编号 | 条目 | 优先级 |
| --- | --- | --- |
| **O21** | **事件 id 用"稳定标签"而非通用占位符**（保留身份，可断言"同一 id 出现在多处"） | **P0** |
| **O22** | 快照**结构里自带 previous**，差分在**序列化时**算，不靠测试作者手写 | **P0** |
| **O23** | **每次 recv 都要超时 + 具名期望**（事件驱动的测试最坏的失败是"挂住"） | **P0** |
| O24 | 事件流快照**列对齐 + 单行 JSON**；domain 事件与 RPC/wire 事件**同流交错** | P1 |
| O25 | system prompt / tools **只在变化时打印**；等于默认值折叠成标签（**使缓存前缀稳定性可测**） | P1 |
| O26 | **进程全局状态**（环境变量等）必须有隔离机制，且注释写明故障机制 | P1 |
| O27 | 测试名写成**完整的行为规格**，把安全边界写进名字 | P1 |
| **F24** | **配置解析失败保留上一份配置**，不回退默认（回退可能变宽松） | **P1** |
| **B22** | 配置分两类：**可热刷新字段** vs **会话内静态设置** | P1 |
| O28 | 断言跨组件因果（"装完必须出现在注册表"），不只断言字段值 | P2 |

### 4.2 一个负面发现

**kimi 的 tools 快照只打印工具名，不打印 schema。**
`formatToolNames = tools.map(t => t.name).join(', ')`。
**代价**：工具 schema 的变化（描述、参数结构）**完全不在快照里** ——
而工具 schema 恰恰是**缓存前缀稳定性**与**模型行为**的关键输入。
**Codex 的 `portable_tool_schema` 则把 schema 纳入归一化并打印。**
**我建议采纳 Codex 的做法**：schema 要进快照，但先经 `portable_tool_schema` 式归一化去噪。

---

## 5. 诚实声明

- **Codex `session/tests.rs`**：12,880 行里读了**约 90 行**（1 个完整测试 + 50 个测试名 + 簇分类）。
  **415 个测试里 414 个未读。**
- **kimi `snapshots.ts`**：388 行里读了**约 200 行**（三个序列化器 + `formatGenerateInput` + 标签结构）。
  `formatMessages` / `normalizeValue` 的**实现未读**；`agent.ts`(2,909) **仍未读**。
- **pi-desktop `plugins/tests.rs`**：2,186 行里读了**约 60 行**（头部 + 1 个测试）。
  其余 8 个 `tests.rs` 未读。
- **仍未读**：`compact.rs` 其余 6,457 行、其余 188 个 suite 文件、
  DSH 7 个测试包的 22,817 行、ZCode 的 4 个测试（全仓仅 4 个）。
