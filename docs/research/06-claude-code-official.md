# Claude Code 官方可参考部分（`refs/claude-official/`）

> 依据用户指令："cc 的也找允许的来参考"。
> 本文只使用**项目法律边界允许**的部分：官方仓库中官方自己发布的插件/示例/类型声明。
> 所有引用均为本机实测，路径与行号可复现。

---

## 0. 法律边界与本文范围（**先读这段**）

`refs/claude-official/` 是 `anthropics/claude-code` 的浅克隆，**1423 个文件**。
仓根 `LICENSE.md` 全文 150 字节：

> © Anthropic PBC. All rights reserved. Use is subject to Anthropic's Commercial Terms of Service.

**即：已发布 ≠ 已授权复用。** 本文的纪律（与 `docs/review-prompt.md` 第二节一致）：

| 允许 | 不允许 |
| --- | --- |
| 读公开契约、公开行为、类型声明的**形状** | 摘抄任何代码进我方仓库 |
| 提取**设计决策**并记录出处 | 复制实现、改名后使用 |
| 引用文件名与行号作证据 | 声称其许可为开源 |

**本文不含一行可复制代码**，全部是契约与决策的记录。

---

## 1. 重大发现：`mods/` 是官方发布的引擎源码

`refs/claude-official/mods/README.md` 原文：

> A mod is a Claude Code plugin whose behaviour lives in a hooks module: one `register(on, options)`
> entry that hooks the engine's events as functions `($, e, next)`. **These four ship inside Claude
> Code; this folder is their source, published as it is built into the binary.**

四个 mod：`sec-default`（组织策略隔离）、`diff`（`/diff` 面板）、`telemetry`、`agents-md`。
**1157 个 `.ts` 文件 + 21 个 `.tsx`。**

关键文件 **`mods/types/claude-code.d.ts`，12,990 行** —— 这是 Claude Code 插件引擎的
**官方类型声明全文**：`$`（引擎接口）、`on(事件名, 匹配器, 处理器)`、`engine.create` 折叠、
名词契约（noun contract）、测试套件 `claude-code/testing`。

**这就是最先进的 harness 的真实事件词汇表，且是官方发布的。** 前四轮我们只能靠第三方仓推测。

---

## 2. 完整 hook 事件词汇表（实测 **90 个**）

按名词分组（`grep -oE "^\s+'[a-z]+\.[a-z.]+'"` 全量提取）：

| 名词 | 事件 |
| --- | --- |
| `turn` | `start` `step` `complete` `abort` |
| `tool` | `call` `check` `describe` `list` `register` |
| `session` | `start` `end` `attach` `detach` `compact` `measure` `messages` `model` `turns` `usage` `cwd` `repo` `root` `surface(s)` `authorize` `receive` `id` |
| `prompt` | `submit` `read` `edit` `fill` `suggest` `context` `attachment` `section` |
| `agent` | `spawn` `register` `list` `offer` |
| `model` | `complete` `classify` `fork` |
| `engine` | `create` |
| `plugin` | `register` |
| `skill` | `prompt` |
| `mcp` | `call` |
| `ui` | `render` `open` `close` `focus` `input` `blit` `invalidate` |
| `store`/`env`/`fs`/`clock`/`config`/`settings` | `get` `set` `keys` `delete` / `read` `write` `list` `stat` `exists` `ancestors` / `sleep` `after` `every` `now` … |
| `http` | `fetch` |
| `process` | `run` |
| `attribution` | `text` |
| `audio` | `play` `speak` |

**两套体系并存**（`claude-code.d.ts:938-958`）：

- **classic hooks**（settings 里的 `PreToolUse` / `Stop` / …，走 stdin JSON）—— 稳定的公开契约，
  以 `classic.${ClassicHookEvent}` 桥接进新引擎（`classic.PreToolUse` 单独有 `ToolCallEnvelope`）
- **function hooks**（本次的 `on('turn.step', ...)`）—— 新 API，且文档自述
  **"Early access … may change between releases without notice"**

> **对我方 I 层的含义**：官方自己把"稳定的公开钩子契约"与"早期访问的函数钩子"**分成两层**，
> 并给后者贴了不稳定标签。我们做 I 层时应照此分层，而不是把两者混成一个 API。

---

## 3. `turn` / `step` 生命周期 —— **第三次独立确认**

契约原文（`claude-code.d.ts:3587-3609` 的输入侧文档注释）：

| 事件 | 原文要点 |
| --- | --- |
| `turn.start` | "Fires when a model turn begins, **before its first model call**; `next(e)` resolves to `{ turnId }`." |
| `turn.step` | "Fires when the engine is about to send **a model request of a turn**, main's or a subagent's (`e.agentId`); `next(e)` resolves to the whole response. `next({ ...e, model })` or `effort` sends another; **the turn, the index and the message count are pinned**." |
| `turn.complete` | "Fires when a model turn has ended… `next(e)` resolves to `{ text }`, the answer. **`e.reason` says why.**" |
| `turn.abort` | 出现在**操作**位置：`abort: (input: OpEventOf['turn.abort']) => Promise<void>`（`:2471`），列在 `LateOverload`（`:4684`） |

`turn.step` 的结果（`:3801`）：`{ turnId, index, answer, toolUses, stopReason, usage }`。

**三条结论**：

1. **`turn` ⊃ `step` 已获三次独立确认**（DSH、Claude Code，加上 pi 的两级被两者共同否决）。
   `docs/l0-events.md` 的**决定 1 成立**，可以定稿。
2. **`turn.abort` 是操作，不是通知** —— 它是"发起取消"的调用；"取消已发生"由
   `turn.complete` 带 `e.reason` 通知。**我方 `turn/end{reason}` 把两者合一**，
   这在**持久化日志**上是正确的，但我们缺了**运行时那一侧**：
   "谁发起了取消"是一次调用，按 DSH 的纪律它不该进 replay（C14），但它**要有地方去**。
   → **建议：L0 明确"取消是一次操作调用"，日志只记终态。**
3. `turn.step` 的输入带 `effort`，且"**turn、index、消息数被钉住**"——
   即 hook 可以改模型/推理档，但**不能改这三样**。这是"在途操作模型捕获"（我方 **J7**）
   的又一实现，且给了一个我们没想到的细节：**可改项与不可改项要显式列出**。

### 3.1 `prompt.id` —— 我方 A9 缺的那块

`claude-code.d.ts:588` 原文：

> UUID correlating a user prompt with **all subsequent events until the next prompt**. Same value
> emitted on OpenTelemetry events as the `prompt.id` attribute, so hook output can be joined to
> OTel events at prompt grain. Absent until the first user input of the process lifetime.

**这是 A9 的第三条路。** 我们此前只有两个选项：

- **DSH**：拒绝 per-prompt 完成语义（`MessageId` 能证明入队，无法标识结果）
- **pi**：不提供 `session.finished`，只发整 agent 状态迁移

Claude Code 的做法是 **"关联，但不结算"**：给每次用户输入一个 `prompt.id`，
与"直到下一次输入为止的所有事件"相关联。**它不下"这条 prompt 完成了"的承诺，
但让下游能把事件归到 prompt 粒度。**

> **对 A9 的补充（建议新增 A12）**：用户输入携带**关联 id**，
> 与该输入之后、下一次输入之前的所有事件相关联；**仍不提供 per-prompt 完成语义**。
> 附带好处：可跨栈关联（原文即用于把 hook 输出接进 OTel）。

---

## 4. 权限判定契约 —— 比我方现有设计多两个字段

`tool.check` 原文（`claude-code.d.ts:3223-3234`）：

> Fires when the engine decides whether a tool call may run, **after the `tool.call` and PreToolUse
> hooks and before the mode settles an ask.** `next(e)` resolves to the engine's verdict
> (rules, mode, the tool's own check, PreToolUse's decision); return any `{ decision }`.
> **`$.tool.check` runs the same chain and executes nothing.**

返回值全文（`:9756`）：

```ts
type ToolCheckResult = {
    decision: ToolCheckDecision;   // allow | ask | deny
    reason?: string;               // 给模型读的 deny 说明 / 给对话框的 ask 说明
    rule?: string;                 // 作出裁决的设置规则原文，如 "Bash(git push:*)"
};
```

| 点 | 我方现状 | 差距 |
| --- | --- | --- |
| `allow`/`ask`/`deny` 三段 | ✅ 已有（学 OpenCode） | — |
| **`reason` 一句话** | ❌ **没有** | deny 时给模型读什么、ask 时对话框显示什么 |
| **`rule` 规则原文** | ❌ **没有** | 我们能算出规则，但**不回传它** —— UI 无法说"被哪条规则拒的" |
| **策略 dry-run** | ❌ **没有** | `$.tool.check` 跑同一条链但**不执行**，UI 可问"这个会不会被允许" |

**判定链的顺序也写明了**：`tool.call` → PreToolUse → `tool.check` → "mode 裁决 ask"。
且**托管设置的钩子最先跑，其 deny 即调用结果**（`:3220` "The managed-settings hooks run first:
their deny is the call's result."）—— 即**策略优先级由链位置表达，不靠规则排序**。

> 对照 OpenCode 的 `findLast` 双维通配：两者都成体系，但**站点不同**。
> OpenCode 在**一组规则集**里用"后写覆盖"决定；Claude Code 在**一条 hook 链**上用位置决定，
> 规则匹配只产出 `rule` 证据。**我方若两者都要，必须明确谁是权威**——见 §8 待定。

---

## 5. `next` 洋葱链 —— 一个我方完全没有的机制

`StarNext` 类型全文（`claude-code.d.ts:9230`）：

```ts
export type StarNext = OrderedOverloads<EventName> & {
    (e: unknown): Promise<unknown>;
    readonly to: (e: unknown, tier: TargetTier) => Promise<unknown>;
    readonly signal: AbortSignal;
    readonly is: <M extends Pattern>(pattern: M, e: unknown) => e is Frozen<Args<Selected<M>>>;
    readonly event: EventName;
    readonly origin: Origin;
    readonly trace: readonly TraceEntry<EventName, unknown, unknown>[];
    readonly budget: NextBudget;
};
```

`next` 同时携带 **9 样东西**，每样都值得看：

| 成员 | 作用 | 我方现状 |
| --- | --- | --- |
| `next(e)` | 调用链下一层 | — |
| **`next.to(e, tier)`** | **跳到指定 tier**（可跨层） | ❌ 无 |
| **`next.signal`** | `AbortSignal` 挂在链上 | ✅ 概念有（DSH 必填 signal），但**挂在 `next` 上**是更好的位置 |
| **`next.is(pattern, e)`** | 从无类型链收窄 `e` | ❌ 无 |
| **`next.trace`** | **本次分派的遍历轨迹** | ❌ 无 |
| **`next.budget`** | 该 hook 的预算对象 | ❌ 无 |
| `next.event` / `next.origin` | 我在哪个事件 / 谁调的我 | 部分 |

还有两条失败语义（`claude-code.d.ts:877-900`）：

> `next` carries `error` and `called` (Caught) and is **replay-safe**; a return …
> `next` 在 `.catch` 里携带"为什么失败"与"失败前是否已调用过 `next`"

以及链底的硬规则（`mods/README.md`）：

> **nothing is beneath them: a call they leave unanswered throws, naming its event.**

**"没人应答的调用会抛错，并点名是哪个事件"** —— 这正是我方 **C16**（`assertNever` 穷尽检查）
在**运行时**的同构物：编译期穷尽 + 运行时点名。**我方只做了编译期那一半。**

> **我方要不要 hook 链？** 这是本文最大的待定。我方 I 层（扩展）目前按"hooks 是回调"设计，
> 没有洋葱链、没有 tier、没有 trace、没有 budget。**Claude Code 证明这四样组合起来
> 能表达"托管策略 > 用户插件 > 核心"的优先级，而不必让规则互相覆盖。**
> 但引入洋葱链是**结构性**的，不是 P2 能补的。→ 见 §8。

---

## 6. 多端：surface roster（我方 N 层的直接答案）

`session.attach` 原文（`claude-code.d.ts:3545`）：

> Fires when a remote client **joins the session's roster of attached surfaces**: it said so
> (ui_attach), or it first asked to draw. … `$.session.surfaces()` reads the roster;
> a render hook still reads `e.surface` per ask.

`session.detach`：

> Fires when a client **leaves the roster**: it detached, or the session ended with it attached (`e.reason`).

**多端不是"多个连接"，而是一份被事件维护的花名册。** 且：
- `session.surface`（单数）**已废弃** → `session.surfaces`（复数）（`:5529` 标 `@deprecated`）
  —— 说明**他们也是从单端迁到多端的**，迁移路径留了废弃标记，这是可学的做法
- `session.end` 的诚实声明（`:3574`）："**a `kill -9` raises nothing**"
  —— 与 DSH 的 D14（不可靠兜底必须显式告警）同一个态度：**承认管不住的地方**

> **对我方 N 层**：采用 roster 模型。与 `docs/requirements.md` 的 N 层现有条目对照见 §8。

---

## 7. 其余四条可落地的发现

### 7.1 `session.measure`：推，不拉

`:3562` 原文："Fires when the engine measures the session and a unit moved: **after each
main-thread turn**, and when a rate-limit window moves a whole point. Observe; …
`$.session.usage()` 的数字 **pushed, not polled**."
→ **确认我方 F10**（压力测量在调用后且可回放）。额外细节：**一次一个，突发折叠成一个**。

### 7.2 `agent.spawn`：模型在 spawn 时解析

`:3332` 原文："Fires when the Agent tool is about to start a subagent, **everything decided and its
model not yet resolved**. `next(e)` resolves to `{ model }`."
→ **确认我方 J7**（在途操作模型捕获），并给出时机：**其他都定了、模型还没解析时**。

### 7.3 工具 schema 延迟加载（**我方完全没有**）

`tool.describe` 的结果含 `ToolDeferral = boolean`：`true` = 藏在 `ToolSearch` 后面
（模型按名要才加载 schema），`false` = 出现在提示词的清单里。
→ 这是**上下文经济**：不是所有工具的 schema 都进 prompt。
**我方 303 项里没有这一条**，而它对 F 层（上下文）省 token 直接有效。

### 7.4 插件工具的命名与 schema

`ToolSpec`（`:9962`）：`{ name, description, inputSchema? }`
- 模型看到的全名是 **`mcp__<plugin>__<name>`** —— **插件工具与 MCP 工具共用一套命名空间**
- `inputSchema` 是**普通 JSON Schema 对象**，不是 Zod/TypeBox 构造器，且**可省略**（默认 `{type:"object"}`）
- `description` 里的孤立代理项半字符会被画成 U+FFFD —— 他们**清洗了进入提示词的文本**

---

## 8. 对我方的净影响

### 8.1 已确认成立（可定稿，不需改）

| 我方条目 | 来自 Claude Code 的确认 |
| --- | --- |
| **L0 决定 1：三级 turn/step** | `turn.start`/`turn.step`/`turn.complete` —— **第三次独立确认** |
| **F10** 压力测量在调用后、可回放 | `session.measure` "after each main-thread turn"、"pushed, not polled" |
| **J7** 在途操作模型捕获 | `agent.spawn` "everything decided and its model not yet resolved" |
| **C14** 持久化不含运行时对象 | `turn.abort` 是操作、`turn.complete{reason}` 是通知，两者分开 |
| **D14** 不可靠兜底必须显式告警 | `session.end`："a `kill -9` raises nothing" |

### 8.2 建议新增（**未写入需求文档，待你确认**）

| 建议 ID | 内容 | 依据 | 优先级 |
| --- | --- | --- | --- |
| **A12** | 用户输入携带**关联 id**，关联该输入之后、下一次输入之前的所有事件；**仍不提供 per-prompt 完成语义** | `prompt.id`（`:588`） | P1 |
| **C18** | 权限裁决结果带 **`rule`（规则原文，如 `Bash(git push:*)`）+ `reason`（给模型/给对话框的一句话）** | `ToolCheckResult`（`:9756`） | **P0** |
| **C19** | **策略 dry-run**：可跑完整判定链而不执行工具 | `$.tool.check` "runs the same chain and executes nothing"（`:3229`） | P1 |
| **F12** | **工具 schema 延迟加载**：工具可藏在检索后面，模型按名索要才加载 schema | `ToolDeferral`（`:9781`） | P1 |
| **N?** | 多端 = **surface roster**，attach/detach 是被事件维护的花名册 | `session.attach`/`detach`/`surfaces()` | P1 |
| **L?** | 链底"**无人应答的调用抛错并点名事件**" | `mods/README.md` | P1 |

### 8.3 结构性待定（**只有你能定**）

**待定5：要不要 hook 洋葱链？**

Claude Code 的扩展模型是 `($, e, next)` 洋葱链 + tier + trace + budget。
我方 I 层目前是"hooks 是回调"，没有链。差距是结构性的：

| 有了链 | 没有链 |
| --- | --- |
| 优先级由**链位置**表达（托管 > 用户 > 核心） | 优先级只能靠**规则互相覆盖**（OpenCode 的 `findLast`） |
| 可观测：`next.trace` 记录谁改了谁 | 无 |
| 可预算：`next.budget` 限制单 hook 开销 | 无 |
| 可跳过：`next.to(e, tier)` | 无 |

**代价**：洋葱链一旦定下，P0 的 loop 与 tools 都要按链的形态写。**这是和词汇表同级的单向门。**

**待定6：规则集与链，谁是权限权威？**

OpenCode 用"一组规则集 + `findLast` 后写覆盖"；Claude Code 用"一条 hook 链 + 位置"，
规则匹配只产出 `rule` 证据。**两者都成体系，但不能同时当权威** —— 必须选一个，
另一个降为在该权威内部的机制。

---

## 9. 诚实声明（证据强度分级）

- **我读了**（原文级）：`mods/README.md` 全文、`mods/types/claude-code.d.ts` 的**定向片段**
  （事件表、`turn.*`/`tool.*`/`session.*`/`agent.spawn` 契约、`StarNext`、`ToolCheckResult`、
  `ToolSpec`、`ToolUseSummary`）。
- **我只扫了文件名**：`mods/` 下 **1157 个 `.ts` 实现文件我一篇没读**；
  `plugins/` 149 个文件只看了目录结构（`hookify`、`plugin-dev` 的清单）。
  **本文没有一条结论来自这些实现。**
- **我读了行号并核对**：本文所有 `:NNNN` 引用均以 `sed -n` 取出对应行确认。
- **未验证**：`ToolCheckDecision` 的完整取值联合（只从文档注释确认了 `allow`/`ask`/`deny` 三个语义）。
- **未读**：`ClassicHookEvent` 的完整成员（它 `= HookInput['hook_event_name']`，指向另一处 schema）。
- **本文不是对 Claude Code 的全面评估**，只是"允许范围内、且与我方 L0/C/I/N 层直接相关"的提取。
- **仍未做**：用户点名的其他内核仓实读（grok-build / kimi-code / qwen-code / hermes-agent，
  以及 agentscope / mini-agent / mini-swe-agent / pi-mono）。**这是下一轮的主要工作。**
