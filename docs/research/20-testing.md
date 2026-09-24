# 测试深读（跨仓）

> 怎么 mock LLM、怎么断言事件序列 —— 三轮逐步读到实现的同一主题

> **本文件由以下轮次产出合并而成** —— 内容按原顺序保留，未改写，仅合并标题层级：
>
> - `20-testing.md` —— 第一轮：测试基础设施（网络边界 mock / DI 覆盖 / DSH 7 包）
> - `21-test-assertions-deep.md` —— 第二轮：真实快照长相 / 结构化断言配对 / 事件序列不变量
> - `22-test-impl-three.md` —— 第三轮：session/tests.rs / kimi 序列化器差分 / pi-desktop 全局态隔离
>
> 合并前的独立文件已删除（成为空号）；git 历史仍可追溯。

---

<!-- merged from 20-testing.md -->

## 测试基础设施精读（第七轮，补两轮点名的最大跨仓空白）

> 我在 `16-...md` §5 与 `19-...md` §8 都写明：**"所有仓的测试一个都没读"**，
> 且 `docs/review-prompt.md` §三C 要的"**怎么 mock LLM、怎么断言事件序列**"**至今没有答案**。本轮补。

---

### 0. ★ 交叉结论：三个仓独立收敛到同一件事

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

### 1. Codex：在**网络边界**上 mock —— 假 HTTP 服务器 + 脚本化 SSE

`core/tests/common/responses.rs`(**1,642 行**)。技术栈：`wiremock`（HTTP）+
`tokio_tungstenite`（WebSocket）+ `insta`（快照）。

#### 1.1 mock 面（实测函数名）

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

#### 1.2 ★ `context_snapshot.rs`：把"模型看到了什么"做成可 review 的快照

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

### 2. kimi-code：靠 DI **按作用域覆盖服务**，mock 是"脚本化生成"

#### 2.1 LLM mock：`scripted-generate.ts`(342)

导出 `createScriptedGenerate` / `requesterFromGenerateFn` / `LegacyGenerateFn`。
**把一个 `generate` 函数适配成完整的 `LlmsRequester`** —— 即：**mock 的就是 provider 接口本身**。

#### 2.2 ★ 测试 harness 是"按作用域覆盖 DI 服务"（`harness/agent.ts`，**2,909 行**）

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

#### 2.3 四种快照（`harness/snapshots.ts`）

`eventSnapshot` / `generateInputSnapshot(s)` / `normalizeGenerateInput` /
`RpcSnapshotEntry` / `WireSnapshotEntry` / `EventSnapshotEntry`。

**注意 `generateInputSnapshot` 与 Codex 的 `context_snapshot` 是同一个东西** ——
**两个独立实现都认为"发给模型的输入"是最该被快照的对象。**

---

### 3. ★ DSH：把测试基础设施做成**一个包组**（7 个包，22,817 行）

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

#### 3.1 四个可直接抄的点

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

### 4. pi-desktop 与 ZCode（本轮覆盖不足，如实说）

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

### 5. 对需求文档的净影响（O 层，测试）

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

### 6. 诚实声明

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

---

### 7. 补正：ZCode 的测试（重查结果）

第 §4 节我写"这个数字与仓规模严重不符，我不下结论 —— 很可能是我的 find 表达式有误"。
**重查后：表达式无误，ZCode 全仓确实只有 4 个测试文件。**

```
./packages/services/test/importedClaudeRecovery.test.ts
./packages/services/test/nonCliAcpRetirement.test.ts
./packages/services/test/providerConfigMigration.test.ts
./packages/ui/test/nonCliAcpRetirement.test.ts
```

（`find` 已用括号分组，并排除 `node_modules`/`dist`；`test`/`tests`/`__tests__` 目录全仓也只有 2 个。）

#### 7.1 ★ 这个发现本身值得记：ZCode 的测试**全是"迁移/退役"测试**

四个文件名指向同一类测试：**证明"旧的东西真的没了 / 真的被迁移了"** ——
`importedClaudeRecovery`（导入的 Claude 配置还能恢复）、
`nonCliAcpRetirement`（非 CLI 的 ACP 已退役）、
`providerConfigMigration`（provider 配置迁移）。

**这不是行为测试，是"迁移断言"。** 它回答的是"我们的迁移做完了吗、做完之后旧的入口还在不在"。

> **评价**：作为一个 122M、四种 surface 的产品仓，**只有 4 个测试且全部与迁移相关**，
> 这是一个**重大缺口**，也是我读到的六个仓里**测试覆盖最弱的**。
> 我**不把它当正面示范**。
>
> **但它揭示了一类我方也需要的东西（Q 层）**：
> **迁移必须有可执行的断言** —— "旧字段不再被读" / "旧入口已退役" / "迁移后可恢复"。
> 我方 Q1（事件日志版本迁移）目前只有规范，**没有这一层断言**。
> **建议记为一类独立测试：迁移断言。**


---

<!-- merged from 20-testing.md -->

## 测试断言深读（第八轮：真实快照与真实断言）

> 上一轮 `20-testing.md` §6 我写明：**"某一条 `insta::assert_snapshot!` 里到底断言了什么字符串——
> 我一条都没看。这是本轮最该被追问的地方。"** 本轮补上。
> 引用行号、快照内容均为实测原文。

---

### 0. 一句话

**Codex 的快照测试是我在这个调研项目里见过的最好的工程产出物。**
一条快照同时表达了：**每个上下文窗口里模型看到了什么、窗口为何在此处结束、哪些条目是新增的。**
一个 reviewer 在 PR diff 里**直接就能看懂**，不需要读懂测试代码。

---

### 1. 快照的真实长相（`mid_turn_compaction_shapes.snap`，39 行，全文核心）

```
---
source: core/tests/suite/compact.rs
expression: "format_history_snapshot(\"True mid-turn continuation compaction after tool output:
  compact request includes tool artifacts, and the continuation request includes the summary in the same turn.\", …)"
---
Scenario: True mid-turn continuation compaction after tool output: compact request includes tool
artifacts, and the continuation request includes the summary in the same turn.

### Window 1
-- request 1 (turn) --
00:message/developer:
    <PERMISSIONS_INSTRUCTIONS>
01:message/user:
    <ENVIRONMENT_CONTEXT>
02:message/user:
    function call limit push

### Window 2 (after request 1: settings changed (parallel_tool_calls, tools))
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

### Window 3 (after request 2: input diverged at item 03, settings changed (parallel_tool_calls, tools))
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

#### 1.1 五个设计要素（每一个都值得抄）

**(a) ★ 窗口头记录了"为什么在此处开新窗口"**

```
### Window 2 (after request 1: settings changed (parallel_tool_calls, tools))
### Window 3 (after request 2: input diverged at item 03, settings changed (parallel_tool_calls, tools))
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

> **这直接印证了我在 `11-codex.md` 记的分类学**
> （`CompactionPhase: StandaloneTurn|PreTurn|MidTurn|PostTurn`、`Reason: ModelDownshift|…`）——
> **它不是纸面设计，每个相位与原因都有对应的行为快照锁着。**

---

### 2. ★ 结构化断言与快照**配对使用**（`compact.rs:423-448`）

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

#### 2.1 值得学的三点

**(a) 换模时的压缩语义被精确钉死**：压缩请求跑在**旧模型**上，后续请求跑在**新模型**上。
这就是 `CompactionReason::ModelDownshift` 的实际语义 —— **用装得下的旧模型做压缩，
再切到新的小窗口模型**。**这条我此前没有意识到**（我上一轮只写了"换模前必须先压缩"）。

**(b) `model_switch` 更新项：压缩时剥掉、后续请求带上。** 一个很细的行为，
靠两条 `assert!` + 一句说明锁住。**没有快照的话这种细节根本不会被注意到。**

**(c) 每条断言都有第三参数 = 一句人话。**
失败时测试输出直接说明**哪条语义被破坏了**，而不是给一个 JSON diff。

#### 2.2 分工原则（我的总结）

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

### 3. ★★ 事件序列怎么断言 —— 答案是"断言流上的不变量"，不是"断言事件列表"

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

#### 3.1 这条测试真正在断言什么

**它不断言"事件序列是 A,B,C,D"。** 它断言一条**结构性不变量**：

> **一个回合内产生的所有条目，都携带该回合的事件 id。**

因为 `EventMsg` 的信封有一个 `id` 字段，而 **turn 的 id 被复用于它内部的所有 item**。
客户端靠这个 id 把 item 归到 turn 里。**测试锁的是这个身份契约，不是事件顺序。**

#### 3.2 为什么这个写法对

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

### 4. 对照：窗口内的差分快照（`pending_input_queued_mail_after_commentary.snap`）

```
### Window 1
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

### 5. 对需求文档的净影响（O 层续）

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

### 6. 诚实声明

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


---

<!-- merged from 20-testing.md -->

## 测试实现深读（第九轮：Codex session/tests.rs、kimi snapshots、pi-desktop plugins）

> 上一轮 §6 我列的三个下一步，本轮全做。引用均为实测原文。

---

### 1. Codex `session/tests.rs`（12,880 行，全仓最大测试文件）

#### 1.1 ★ 首先修正一个预期：它不是"事件序列测试"

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

#### 1.2 ★ 测试名就是完整的行为规格（命名规范值得直接抄）

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

#### 1.3 ★ 事件断言的实际写法（与 `compact.rs` 是两种风格）

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

#### 1.4 与 `compact.rs` 的对照（两种事件断言风格，都该有）

| | `compact.rs` | `session/tests.rs` |
| --- | --- | --- |
| 断言 | **跨事件的身份不变量**（同回合共享 id） | **有序的状态迁移 + 字段关系** |
| 循环 | `while` 收齐再断言 | 逐条 recv 逐条断言 |
| 强项 | 不脆，新增事件类型不用改 | 顺序与中间态被锁住 |
| 弱项 | 顺序没锁 | 事件多了会脆 |

**两种风格并存，各管一类不变量。** 我方 O13 应写成"两种都允许，按断言对象选"。

---

### 2. kimi-code：快照的**序列化器**是自己写的，差分在序列化时算

`test/harness/snapshots.ts`(388)。核心不是"收集数据"，是**三个自定义 vitest 序列化器**。

#### 2.1 ★ 用 Symbol 做标记，注册自定义序列化器

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

#### 2.2 ★★ 事件快照：列对齐 + 单行 JSON

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

#### 2.3 ★★ 模型输入快照：差分**在序列化时按 previous 算**

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

#### 2.4 `createEventSnapshotter()`：**稳定标签**，不是通用占位符

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

#### 2.5 `test/setup.ts`：进程全局环境的清理

```ts
for (const key of Object.keys(process.env)) if (key.startsWith('KIMI_CODE_')) delete process.env[key];
process.env['KIMI_CODE_PERSISTENCE_MINIDB_READMODEL'] = 'false';
```
**在 setup 阶段清空所有相关环境变量**（kimi 的解法；pi-desktop 用锁，见 §3）。

---

### 3. pi-desktop `plugins/tests.rs`（2,186 行）：唯一一个非 agent-loop 的样本

#### 3.1 ★ 它解决的是**进程全局状态的测试隔离**

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

### 4. 三家的对照与本轮结论

| | 断言对象 | 归一化策略 | 差分的实现位置 | 隔离问题的解法 |
| --- | --- | --- | --- | --- |
| **Codex** | 模型上下文（快照）+ 真实事件流（不变量/有序迁移） | 具名标签折叠长段 | **快照格式内部**（窗口头记录原因） | 每测试 `MockServer` |
| **kimi** | 事件/RPC/wire 流 + 模型输入 | **稳定标签**（保留 id 身份） | **序列化时对比 previous** | setup 清环境变量 |
| **pi-desktop** | 行为因果链 | —（不做快照） | — | **静态 Mutex + RAII 守卫** |

#### 4.1 新增需求项 —— 7 条，3 条 P0

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

#### 4.2 一个负面发现

**kimi 的 tools 快照只打印工具名，不打印 schema。**
`formatToolNames = tools.map(t => t.name).join(', ')`。
**代价**：工具 schema 的变化（描述、参数结构）**完全不在快照里** ——
而工具 schema 恰恰是**缓存前缀稳定性**与**模型行为**的关键输入。
**Codex 的 `portable_tool_schema` 则把 schema 纳入归一化并打印。**
**我建议采纳 Codex 的做法**：schema 要进快照，但先经 `portable_tool_schema` 式归一化去噪。

---

### 5. 诚实声明

- **Codex `session/tests.rs`**：12,880 行里读了**约 90 行**（1 个完整测试 + 50 个测试名 + 簇分类）。
  **415 个测试里 414 个未读。**
- **kimi `snapshots.ts`**：388 行里读了**约 200 行**（三个序列化器 + `formatGenerateInput` + 标签结构）。
  `formatMessages` / `normalizeValue` 的**实现未读**；`agent.ts`(2,909) **仍未读**。
- **pi-desktop `plugins/tests.rs`**：2,186 行里读了**约 60 行**（头部 + 1 个测试）。
  其余 8 个 `tests.rs` 未读。
- **仍未读**：`compact.rs` 其余 6,457 行、其余 188 个 suite 文件、
  DSH 7 个测试包的 22,817 行、ZCode 的 4 个测试（全仓仅 4 个）。
