# 测试基础设施精读（第七轮，补两轮点名的最大跨仓空白）

> 我在 `16-...md` §5 与 `19-...md` §8 都写明：**"所有仓的测试一个都没读"**，
> 且 `docs/review-prompt.md` §三C 要的"**怎么 mock LLM、怎么断言事件序列**"**至今没有答案**。本轮补。

---

## 0. ★ 交叉结论：三个仓独立收敛到同一件事

**三家（Codex / kimi-code / DSH）各自独立地做出了同一个决定：**

> **不要在内部状态上断言，要断言"模型实际看到/产生的那个东西"，并且把它归一化后做成快照。**

| 仓 | 快照什么 | 实现 |
| --- | --- | --- |
| **Codex** | **模型上下文**（请求体） | `core/tests/common/context_snapshot.rs`(806) + `insta` |
| **kimi-code** | **事件 / 模型输入 / RPC / wire** 四种 | `test/harness/snapshots.ts`(388) |
| **DSH** | **会话日志** + **模型流** | `packages/test-support/session-snapshot/` + `llm-replay/` |

**这是本轮最重要的单一结论。** 一个 agent harness 的"真观测量"不是内部状态、
不是日志文件，而是 **①发给模型的东西 ②模型回的东西 ③由此产生的持久事实**。
三家都选了这个面。

---

## 1. Codex：在**网络边界**上 mock —— 假 HTTP 服务器 + 脚本化 SSE

`core/tests/common/responses.rs`(**1,642 行**)。技术栈：`wiremock`（HTTP）+
`tokio_tungstenite`（WebSocket）+ `insta`（快照）。

### 1.1 mock 面（实测函数名）

```rust
mount_response_once(server, template)
mount_sse_once(server, body) / mount_sse_once_match(server, matcher, body)
mount_models_once(server, ModelsResponse)
mount_sse_sequence(server, Vec<String>)          // ★ 按模型调用次数挂脚本
mount_response_sequence(server, …)
mount_function_call_agent_response(…)            // 预制"模型要调工具"的响应
start_mock_server() / start_websocket_server(connections: Vec<Vec<Vec<Value>>>)
sse(events: Vec<Value>) -> String                // 由事件值拼 SSE
sse_completed(id) / sse_failed(id, code, message)
wait_for_request(…) / wait_for_handshakes(expected, timeout)
```

**★ `mount_sse_sequence`（`responses.rs:1426`）是关键**：挂一串 SSE，**每个模型调用消费一个**。
于是"多步循环"的测试就是"脚本化每一轮模型回什么"。

且 mock **记录全部请求**（`ResponseMock { requests: Arc<Mutex<Vec<ResponsesRequest>>> }`），
并提供一个会**断言数量**的访问器：

```rust
pub fn single_request(&self) -> ResponsesRequest {
    let requests = self.requests.lock().unwrap();
    if requests.len() != 1 { panic!("expected 1 request, got {}", requests.len()); }
    …
}
```

**测试跑的是真实 HTTP 路径、真实 SSE 解析、真实会话循环** —— 只有"对面的模型"是假的。
**这是保真度最高的 mock 位置。**

### 1.2 ★ `context_snapshot.rs`：把"模型看到了什么"做成可 review 的快照

模块注释原文：

> Readable snapshots of captured model context.
> Capturing and grouping requests **only decides which input items are new**. All entry points
> render items with the same formatter, which then **normalizes volatile text or replaces routine
> context blocks** according to the caller's options.

两个开关（`ContextSnapshotOptions`）：

- **`rewrite_known_segments()`** —— 注释原文："Replace known guidance with **one-line tags such as
  `<PERMISSIONS_INSTRUCTIONS>`**. The default retains the text and only truncates long lines or sections."
- **`include_request_settings()`** —— "Render model, instructions, tools, and other settings at window boundaries."

**归一化处理易变值**（`strip_metadata_from_json`、`strip_response_item_ids_from_json`、
`normalize::Normalizer`、`portable_tool_schema`、路径与 ID 归一化），
以及 `MAX_SNAPSHOT_LINE_CHARS = 160` 截长行。

**★ 而且是差分式的**：

> The **first request in a window retains all its input; later requests retain their suffix index.**

—— 同一个上下文窗口内，第一条请求快照全文，后续只快照**新增后缀**。
**这就是为什么它能同时"可读"且"测试不爆炸"。**

配套的断言函数（`core/tests/suite/compact.rs:496-516`）：

```rust
format_labeled_requests_snapshot(scenario, &[("label", &request)])
format_request_history_snapshot(scenario, requests, &options)
```

用法（`insta::assert_snapshot!`，`compact.rs` 里有 6 处），测试用
`#[test_case::test_case(bool, bool; "checklist disabled")]` 参数化并命名。

> **对我方 O 层（测试，P0）**：**这是最该整条采纳的一条。**
> 我方若做 harness，测试的**主断言面应当是"归一化 + 差分后的模型上下文快照"**。
> 它同时给出：①上下文组装的回归保护（F 层最怕的东西）②PR 里可 review 的 diff
> ③压缩行为可直接断言（`compact.rs` 6,577 行测试主要就是这个）。

---

## 2. kimi-code：靠 DI **按作用域覆盖服务**，mock 是"脚本化生成"

### 2.1 LLM mock：`scripted-generate.ts`(342)

导出 `createScriptedGenerate` / `requesterFromGenerateFn` / `LegacyGenerateFn`。
**把一个 `generate` 函数适配成完整的 `LlmsRequester`** —— 即：**mock 的就是 provider 接口本身**。

### 2.2 ★ 测试 harness 是"按作用域覆盖 DI 服务"（`harness/agent.ts`，**2,909 行**）

```ts
appServices(group)     / sessionServices(group) / agentServices(group)   // 三档作用域
appService<T>(…)       / sessionService<T>(…)   / agentService<T>(…)     // 类型化覆盖
modelProviderServices(…) / modelProviderOptionServices(…)                // 换 provider
wireRecordPersistenceServices(persistence) / configServices(…) / logServices(…)
homeDirServices(homeDir) / additionalDirServices(dirs) / execEnvServices(…)
createTestAgent(options) / testAgent / TestAgentContext
```

`InMemoryWireRecordPersistence` 实现 `WireRecordPersistence`（**六个方法**：
`read/append/rewrite/flush/close`）—— **持久化整体换成内存版**。

**这是 DI 架构的回报**：因为一切都是服务，测试就**按作用域换服务**，
不需要写复杂的 mock 框架。**代价**是我上一轮记的：DI 容器给"可嵌入为库"带来宿主初始化协议。

### 2.3 四种快照（`harness/snapshots.ts`）

`eventSnapshot` / `generateInputSnapshot(s)` / `normalizeGenerateInput` /
`RpcSnapshotEntry` / `WireSnapshotEntry` / `EventSnapshotEntry`。

**注意 `generateInputSnapshot` 与 Codex 的 `context_snapshot` 是同一个东西** ——
**两个独立实现都认为"发给模型的输入"是最该被快照的对象。**

---

## 3. ★ DSH：把测试基础设施做成**一个包组**（7 个包，22,817 行）

`packages/test-support/README.md` 摘要原文：

> The test-support group gives repository tests **deterministic, keyless ways to exercise the real product.**
> … Each package is **support-tier infrastructure**; a package moves out of this group when it gains
> a product contract and product consumers.

| 包 | 角色 |
| --- | --- |
| `session-snapshot` | **会话日志快照** + 协议适配器（`suite.ts` 1,753 / `normalize.ts` 625 / `harness.ts` 815） |
| `agent-loop-testkit` | 跑"真实 AgentLoop"所需的共享前置服务 |
| `client-runtime` | jsdom slot 测试台（浏览器侧） |
| `remote-mock` | **按端点命名**的 Remote mock + Connection 载体 |
| `loader-smoke` | 启动 Loader 组装的应用并驱动 fixture 回合（smoke） |
| **`llm-mock-server`** | **可脚本化的、OpenAI 兼容的"故障服务器"，专为恢复类测试**（749） |
| **`llm-replay`** | **回放录制下来的模型流，供 keyless 测试与演示**（1,196 / 测试 2,323） |

### 3.1 四个可直接抄的点

**(a) ★ `llm-replay`：录制 / 回放，而不是手写 mock。**
"Replays **recorded model streams** for keyless tests and demos" ——
**真实流录制一次，之后无 key 可跑**。解决的是"手写 mock 与真实行为漂移"这个根本问题。

**(b) ★ `llm-mock-server` 是"故障服务器"，不是"正常服务器"。**
定位明写是 **fault server for recovery tests** ——
**把"注入故障"当作一等测试能力**。我读过的其他仓都只 mock happy path。
恢复逻辑（我记过 F12 流恢复、J21 超时、M10 预算）**没有故障注入就无法测**。

**(c) "keyless snapshot tier" 是一条写下来的测试政策。**
README 指向 `docs/testing.md`，称这些 harness 服务于 "**the keyless snapshot tier**"。
**"分层"（tier）而非"测试金字塔"** ——且命名里就带上了**要断言快照**这件事。

**(d) 治理细节**：包组 README 里有一条**升降级规则** ——
"当某包取得产品契约与产品消费者时，就搬出本组"。**测试基础设施有自己的生命周期管理。**

---

## 4. pi-desktop 与 ZCode（本轮覆盖不足，如实说）

- **pi-desktop**：Rust 惯例，**测试模块内联在源文件旁**
  （`#[path = "…tests.rs"] mod tests;`）。已见：
  `db/tests.rs`(1,470)、`plugins/tests.rs`(2,186)、`providers/tests.rs`(1,607)、
  `plans/tests.rs`(888)、`user_skills/tests.rs`(886)、`session_collaboration/tests.rs`、
  `mcp_servers/tests.rs`、`agent_capabilities/tests.rs`。
  **我只看了它们的存在与行数，没有读内容** —— 因此**说不出它怎么 mock LLM**。
- **ZCode**：我用 `find` 只数到 4 个 `.test.ts`/`.spec.ts`，
  **这个数字与它的仓规模严重不符，我不下结论** ——
  很可能是我的 find 表达式有误（`-o` 未加括号分组），或测试用了别的命名。
  **需要重查，本轮不写结论。**

---

## 5. 对需求文档的净影响（O 层，测试）

| 编号 | 条目 | 优先级 |
| --- | --- | --- |
| **O1** | **主断言面 = 归一化 + 差分后的"模型上下文"快照**（不是内部状态、不是日志） | **P0** |
| **O2** | **在网络边界 mock**：假 HTTP 服务器 + 脚本化 SSE 序列（每次模型调用消费一个脚本） | **P0** |
| **O4** | **易变值必须归一化**（路径、ID、时间戳、元数据），否则快照无法稳定 | **P0** |
| O3 | mock **记录全部请求**，并提供"断言请求数量"的访问器 | P1 |
| O5 | **窗口内差分快照**：首条全量，后续只留新增后缀（否则快照爆炸） | P1 |
| O6 | **长行截断**（Codex 是 160 字符），已知长指引替换成一行标签（`<PERMISSIONS_INSTRUCTIONS>`） | P2 |
| **O7** | **录制 / 回放**真实模型流（`llm-replay`），避免手写 mock 与真实行为漂移 | **P1** |
| **O8** | **故障注入服务器**（`llm-mock-server`），恢复类逻辑必须能注入故障才可测 | **P1** |
| O9 | **持久化可整体替换为内存实现**（六个方法的接口） | P1 |
| O10 | **keyless 快照层是一条写下来的测试政策**，测试基础设施自成包组并有升降级规则 | P2 |
| O11 | 事件序列 / 模型输入 / RPC / wire **四种快照分开** | P2 |

**其中 P0 三条（O1/O2/O4）** —— 这是继 C43–C51 与 F14–F22 之后第三批 P0。

---

## 6. 诚实声明

**本轮我读的是"测试基础设施"，不是"测试"。** 具体地说：

- **Codex**：`responses.rs` 的 API 面、`context_snapshot.rs` 的模块头与选项、
  `compact.rs` 的断言函数与 `insta` 调用点。**`compact.rs` 6,577 行测试本体未读**，
  `session/tests.rs`(12,880) **未读**，190 个 suite 文件**一个都没打开过全篇**。
- **kimi-code**：`harness/index.ts` 的全部导出、`harness/agent.ts` 的接口与
  `InMemoryWireRecordPersistence`、`scripted-generate.ts` 头部。
  **`harness/agent.ts` 2,909 行的实现未读**，`snapshots.ts` 388 行只读了导出名。
- **DSH**：`test-support/README.md` 全篇 + 各包的目录与行数。
  **7 个包 22,817 行里一行实现都没读**。
- **pi-desktop**：只列了测试文件的存在与行数。
- **ZCode**：**没读到任何测试基础设施，需要重查。**

**因此本报告给的是"三家的测试方法论"，不是"三家的测试怎么写的"。**
具体到"某一条 `insta::assert_snapshot!` 里到底断言了什么字符串"，
我**一条都没看**。这是本轮最该被追问的地方。
