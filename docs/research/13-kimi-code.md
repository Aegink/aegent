# kimi-code 深读（MoonshotAI/kimi-code，MIT）

> tree-sitter-bash 权限分析、三台状态图、重试分类

> **本文件由以下轮次产出合并而成** —— 内容按原顺序保留，未改写，仅合并标题层级：
>
> - `13-kimi-code.md` —— 第一轮：自研 bash 解析器 / 权限 11 目录 / 四层 AND / 配置 linter
> - `18-kimi-loop.md` —— 第二轮：三台机器组合 / 重试分类 / PromptGate / storeJournal
>
> 合并前的独立文件已删除（成为空号）；git 历史仍可追溯。

---

<!-- merged from 13-kimi-code.md -->

## kimi-code 精读（MoonshotAI/kimi-code，MIT，`32000d0`）

> 前几轮读了它的权限词汇表（`07-permission.md`）。
> 本轮补代码主体。**最大发现不在权限层，在 `packages/tree-sitter-bash/`。**

---

### 0. 一句话

**kimi-code 为"命令权限分析"从零写了一个纯 TypeScript 的 bash 解析器**，
与 tree-sitter-bash 0.25.0 逐字节对齐、跑完整官方语料做差分测试、
**把每一处有意偏差逐条记录并钉进测试夹具**。
这是我在整个调研里读到**工程严谨度最高**的一块，且**直接可用于我方 B/C 层**。

---

### 1. ★★ `tree-sitter-bash`：一个为权限分析而生的 bash 解析器

`packages/tree-sitter-bash/`。README 首句原文：

> A pure-TypeScript bash parser that produces a syntax tree whose named node types match
> tree-sitter-bash 0.25.0 one-to-one, **built for agent-side command permission analysis**.

#### 1.1 为什么这件事重要（三种"看懂 shell 命令"的深度）

我读过的三个仓，对"这条 shell 命令到底会做什么"给了三种不同深度的答案：

| 仓 | 手段 | 能回答的问题 | 不能回答的 |
| --- | --- | --- | --- |
| Codex | `prefix_rule` 前缀 token 匹配 | "首 token 是不是允许的那个" | 命令里嵌的 `$(...)` 换出什么 |
| qwen-code | shell 语义分析（`ShellOperation` + `virtualTool`） | "这条命令等价于哪个工具操作" | 复合语法的边界情况 |
| **kimi-code** | **完整 bash 语法树** | "这个字符串按 bash 语法**究竟**解析成什么" | 运行时值（变量内容） |

**只用前缀匹配，`ls && rm -rf /` 的首 token 是 `ls`。**
这是所有前缀/启发式方案的共同软肋。kimi-code 的答案是**别猜，解析它**。

#### 1.2 为"不被解析器拖垮"而做的四件事（**每一条我方都该抄**）

**(a) 永不抛异常，两种失败都显式返回**

`README` 原文：
- 预算耗尽 → `{ ok: false, reason: 'aborted' }`
- 畸形输入 → **降级树** + `hasError: true`（不抛、不返回 null）
- **最后兜底**：任何未预期的内部异常 → 降级为单个 `ERROR` 节点覆盖全文，
  原文："**callers still get a usable tree**"

**(b) 预算管的是"工作量"，不是"输入长度"** —— 这条最值得记

README 原文：
> The budget caps **total work, not input size**: a multi-hundred-KB string or heredoc body
> parses fine (it produces only a handful of nodes), but a source whose tree would exceed
> 50 000 nodes … is aborted.

默认 `budget.ts:11-12`：`DEFAULT_TIMEOUT_MS = 50`、`DEFAULT_MAX_NODES = 50_000`。
**两个轴同时存在，因为任一单轴都可被绕过**：大 heredoc 绕过节点数轴，深嵌套绕过时间轴。

**(c) ★ `tick()` 与 `progress()` 分立** —— 我踩过的那个坑的正解

`budget.ts:49` / `budget.ts:64`：

```ts
/** Account for one created node and re-check the deadline. */
tick(): void { this.nodeCount++; ...; if (Date.now() >= this.deadline) throw new Aborted('timeout'); }

/** Re-check the deadline WITHOUT counting a node. For long scan loops that run
 *  many iterations per produced node (character-level scanning), called at
 *  intervals so the deadline is still enforced promptly. */
progress(): void { if (Date.now() >= this.deadline) throw new Aborted('timeout'); }
```

注释原文说明了为什么必须有第二个：**"一个病态的单个 token 仍然要撞上截止时间，而不必抬高节点计数"**。

> **我方教训**：我在本工作区反复踩过 **Bash 工具 heredoc 被截断**的坑
> （见 `notes/01-workspace-gotchas.md`），根因就是**只按"命令长度"设限，且检查点在循环之外**。
> **凡是要给工作量设上限的地方，必须（1）两个轴（数量 + 时间），（2）时间轴必须在长循环内部被检查。**

**(d) 三道深度上限，且**给出实测余量**

README 原文：
- `MAX_SUBSTITUTION_DEPTH = 150`（`$( … )` / 反引号 / `<( … )` 链）
  —— "**实测在默认 Node 栈上约 380–500 层溢出**，所以该上限留了 **≥2.5× 余量**"
- `MAX_PARSE_DEPTH = 500`（子 shell / 复合命令 / `${…}` / 表达式嵌套）
- `MAX_SCAN_DEPTH = 1024`（词法器自身递归）

**"实测溢出点在哪、然后留 2.5 倍"** —— 这个写法我建议直接进我方 `AGENTS.md` 的编码规范。

#### 1.3 ★ 正确性靠**差分测试**，偏差靠**逐条钉死**

- 测试方式：**同时**用自己的解析器和真的 tree-sitter-bash（wasm）解析，
  **逐字节比较语法树**，语料含**完整的官方 0.25.0 corpus**
- `test/fixtures/corpus/known-diffs.txt`：**每一处有意偏差都写成一条带期望树的夹具**

README 的 "Known differences" 一节列了 **30 余条**偏差。**最有价值的是其中几类**：

| 类别 | 例子 | 谁对 |
| --- | --- | --- |
| **参考实现有 bug，本实现跟 bash** | `$((0x1F))` 十六进制字面量；`变量=值` 非 ASCII 标识符；`[[ ((a) == x) && y ]]` | **本实现**（README 明写 "a reference quirk — bash does …"） |
| 参考实现无法表示，本实现降级 | 一行多个 heredoc（`cat <<A <<B`）、heredoc 同行的后续语句 | 结构上无解，只能降级 |
| 纯实现细节差异 | `string_content` 是否按换行切分、零宽恢复节点的形状 | 无对错 |

> **这是"参考实现"这个词的正确用法**：不是抄，是**对齐 + 记录分歧 + 知道自己何时比它更对**。
> 我方若以某个上游为蓝本，**应当产出同样一份 `known-diffs`**。
> 这比"我们参考了 X"这种含糊表述强得多，且在法务上也更干净。

#### 1.4 性能被写成测试

README 给了具体数字（单行命令 ~4 µs；100 KB 真实部署脚本 tens of ms；
400 KB 节点炸弹 **~20 ms 内中止**），并说明
"these numbers are **smoke-tested as orders of magnitude** in `test/performance.test.ts`
**to guard against accidental quadratic complexity**"。

**性能断言进测试套件，防的是复杂度退化** —— 不是"跑得快"，是"别变成 O(n²)"。

---

### 2. 权限被拆成 **11 个目录**（规模参照）

`agent-core-v2/src/agent/` 下与"工具能不能跑"相关的目录：

```
permissionGate/  permissionMode/  permissionPolicy/  permissionRules/
toolApproval/    toolPolicy/      toolActivation/    toolSelect/    toolDedupe/
（另有 session/sessionToolPolicy/ 与 session/sessionToolPolicyGate/）
```

每个都是 `xxx.ts`（类型）+ `xxxService.ts`（实现）+ 可能的 `configSection.ts` / `xxxOps.ts`。
**这是"关注点分离"做到极致的形态**，与我方现在"权限"是一个模块形成对照。

**但我不建议我方照抄这个拆法。** 十一个目录意味着十一个 DI 注入点、十一处配置段、
十一种可能的"这个开关在哪配"。**Codex 用一个 `execpolicy` crate 覆盖了同类范围。**
我记这条是为了**规模参照**，不是为了采纳。

---

### 3. 工具激活策略：**四层纯 AND**（与 Codex 的交集同构）

`agent/toolPolicy/evaluate.ts:43` `isToolActiveComposed(layers, name, source)` 原文：

```ts
return (
  isToolActive({ disallowedTools: layers.workspaceDisabledTools }, name, source) &&
  isToolActive(layers.profile,                                   name, source) &&
  isToolActive({ tools: …, disallowedTools: layers.global?.disabled }, name, source) &&
  isToolActive({ disallowedTools: layers.sessionDisabledTools },  name, source)
);
```

**四层全部取 `&&`。** 与 Codex 的 `permission_profile_intersection` 是同一个结构性质：
**任何一层只能"减"不能"加"** —— 单调性，与 Codex 的 `max()` 是同一族设计。

> **这是本轮第二个跨仓共性**（第一个是"规则必须自检"）：
> **多来源权限的合成只能用交/取最严，不能用覆盖。**
> 两个独立实现（Codex Rust、kimi-code TS）都选了这条，且都**没有**用"就近覆盖"。

另注意 `picomatch` 只用于 **MCP 工具名**；内置工具名是**精确匹配**（`includes`）。
**通配符被限制在一个命名空间内**，不让它在内置工具上乱匹配。这也是反绕过的一个细节。

---

### 4. ★ 权限配置**自带 linter**（与 Codex 的 `match/not_match` 是同一洞察）

`evaluate.ts:85` `findInactiveToolPatterns()` 检出三类"**写了但永远不会生效**"的模式：

| 类别 | 含义 |
| --- | --- |
| `wildcard-not-mcp` | 在内置工具上用了通配符 —— 永不会匹配（因为内置是精确匹配） |
| `incomplete-mcp-name` | `mcp__` 开头但不含第二个 `__` —— 名字不完整 |
| `unknown-tool` | 不认识的工具名 |

> **跨仓共性 #3（本轮最重要的跨仓发现）**：
> **Codex 用 `match`/`not_match` 在加载期校验规则；kimi-code 用 linter 检出死模式。**
> **两个独立团队、两种语言、同一结论：**
> **"权限配置写错了但静默不生效"是一个真实且高频的故障模式，必须有工具检出。**
>
> **我方 C 层现在完全没有这个。这是本轮最该无条件采纳的一条。**

---

### 5. 架构形态：DI / Service（VSCode 式）

`_base/di/instantiationService.ts`(1,006)、`_base/di/cascadeEngine.ts`(798)，
以及 `createDecorator<IXxxService>('agentXxxGate')` 的服务声明式注入。
`agent/loop/loopService.ts` 2,285 行是主循环，各关注点（压缩、令牌计数、工具执行、LLM 请求、
工具去重、撤销、模式互斥 `modeMutex/`）**各自一个 Service**。

**这是一种与 Codex（crate 化）、ZCode（端口 + 运行时方法）都不同的组织方式。**
同样地：**记它作为形态参照，不建议照抄** —— DI 容器会给"可嵌入为库"（我方核心诉求）
带来一个宿主必须理解的初始化协议。

值得一提的目录：`human/`（`agent/machine.ts` 949 行、`agent/turn.ts` 886 行）——
**"人"被建模成一个独立的 agent 状态机**，与主 agent 并列。这在别的仓没见过。

---

### 6. 本轮对需求文档的净影响（kimi-code 部分）

| 层 | 建议 | 优先级 |
| --- | --- | --- |
| **C** | **权限配置必须自检**：规则带 `match`/`not_match`，或至少检出"永不生效"的模式 | **P0** |
| **C** | **多来源权限合成只用交/取最严**（与 Codex 独立同证） | **P0** |
| **B/C** | **shell 命令权限分析应基于真实语法解析**，不是首 token 前缀匹配 | **P1**（见下"新增待定"） |
| B | **凡是给工作量设上限的地方要两个轴：数量 + 时间**；时间轴须在长循环内部检查 | **P0** |
| 全局 | **深度/递归上限要写实测溢出点与余量倍数** | P1（进 `AGENTS.md` 编码规范） |
| 全局 | **畸形输入永不抛异常，降级返回 + 显式错误标志** | P1 |
| 全局 | **性能断言进测试套件，防复杂度退化**（不是防慢） | P2 |
| 全局 | 若以某上游为蓝本，**产出 `known-diffs` 清单**（对齐 + 记录分歧） | P2 |

**新增待定10：我方的 shell 权限分析做到哪一层？**
三种深度（Codex 前缀匹配 / qwen-code 语义分析 / kimi-code 完整语法树），
对应三档工程成本。**这与 D 层"网络隔离做到 OS 身份还是一层"是同一类问题** ——
**"我们承诺的保护强度到哪一档"，必须显式选，不能默认。**

---

### 7. 诚实声明：未读

- `agent/loop/loopService.ts`（2,285 行，**主循环本体**）—— **只看了目录，一行未读**
- `agent/task/taskService.ts`(1,634)、`features/goal/goalService.ts`(1,454)、
  `features/tower/protocol/store.ts`(1,447) —— **未读**
- `agent/fullCompaction/`(989) 与 `compact/` —— **未读**
- `toolExecutor/toolExecutorService.ts`(994)、`llmRequester/llmRequesterService.ts`(994) —— **未读**
- `human/agent/machine.ts`(949) 的**实现**（只看了文件名与行数）—— **未读**
- `tree-sitter-bash/src/parser.ts` / `lexer.ts` 的**实现** —— **只读了 README 与 `budget.ts`**
- `acp-server/`、`kap-server/`、`remote-control/`、`minidb/`、`kosong/`、
  `pi-tui/`、`klient/`、`node-sdk/`、`transcript/` —— **全部未读**
- 全部测试 —— **未读**

**本报告是"tree-sitter-bash + 权限合成 + 目录规模"的精读，不是 kimi-code 的精读。**


---

<!-- merged from 13-kimi-code.md -->

## kimi-code 主循环精读（第六轮，用户指定）

> 上一轮我写明：**`agent/loop/loopService.ts`（2,285 行主循环本体）—— 一行未读**。本轮补。
> 引用行号均已核验。

---

### 0. 一句话

**kimi-code 的主循环不是命令式的 `while` 循环，而是三台组合的状态图（statechart）。**
自研了一个 `xstate2`（`#human/xstate2`），在此之上有 **agent 机器 × turn 机器 × tool 机器**，
`loopService.ts` 是外围的 DI 服务壳。

**这是五个仓里唯一的"状态图"方案** —— Codex 是 async Rust 循环、ZCode 是显式相位枚举（记账层）、
DSH 是洋葱链 + 不变式。**四种控制流组织方式。**

---

### 1. 三台机器组合

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

#### 1.1 外部快照是**从状态图状态推导**的，不是另记一份

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

#### 1.2 ★ `MachineEngineEvent` 是一个很完整的事件union（`engine.ts:52-`）

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

### 2. ★ 重试分类：显式枚举，且**未知错误不重试**

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

### 3. `PromptGate`：入队前的闸门，且**可以改消息**

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

### 4. 事件存储带 **journal**（`machine/storeJournal.ts`）

`#human/eventStore/journal`：`memoryJournal`、`SyncStoreJournal`；
`storeJournal.ts` 实现 `wireStoreJournal(wire, domain)`，
从 `wire.readHumanChain()` 逐行读，按 `{ branch, seq, ts, type, kind, data }` 落成 `JournalRecord`。

**事件存储有分支（branch）与序号（seq）**，且持久化经一个 "wire"。
与我记过的 DSH（整值事件、同步 append + write-behind）是不同实现，但同样是**append-only + 投影**。

---

### 5. 对需求文档的净影响

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

### 6. 诚实声明：未读

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
