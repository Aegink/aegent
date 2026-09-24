# 权限域深读（第六轮，补上一轮点名的最大空白）

> 上一轮我在 `15-pi-desktop-code.md` §5 与 `14-dsh-code.md` §7 都写明：
> **"这是权限主战场，本轮没读，是明显缺口"** —— pi-desktop `permissions.rs` 与
> DSH `interaction/user-approval`、`permission-presets`。本轮补上。

---

## 1. ★ pi-desktop：判定是**严格分层**的，且 `None` = 去问用户

`crates/host-core/src/permissions.rs:195` `evaluate_auto_with_permission_mode_and_risk_and_path`
返回 **`Option<PermissionDecision>`** —— **`None` 的含义是"没有自动判定，走审批卡"**。

`permissions.rs:42`：

```rust
pub enum PermissionDecision { AllowOnce, AllowSession, Deny }
```

**注意只有两个"允许"，没有笼统的 `Allow`。** "这一次"与"这个会话"是分开的，
与我上一轮从 Codex 记下的 C47（持久化作用域显式化）**同一洞察，第二个独立实现**。

### 1.1 判定优先级（注释里明写了顺序，且顺序本身是安全属性）

```
① 契约模式白名单（Plan / Goal）        ← 硬拒，且"故意排在低风险分类、auto、授权、scratch 路径之前"
② 外部路径（requires_external_path_permission）
③ 风险分级（Risk::Low → AllowOnce）
④ 权限模式（auto / accept-edits）
⑤ 会话授权（session_grants → AllowSession）
⑥ 都不是 → None（去问用户）
```

代码注释原文（`permissions.rs:213-216`）：

> The contract modes' tool allowlist is authoritative. This check **intentionally precedes**
> low-risk classification, auto, grants, and scratch paths, and covers Goal as well as Plan (D198).

**即：Plan/Goal 模式下的"不可用工具硬拒"凌驾于一切之上** —— `auto` 模式**不能**在 Plan 里
把 Write/Edit/plugin 重新打开。**硬策略不是一个"更严格的规则"，而是一个更高层。**

> **对我方 C 层（P0）**：判定必须是**显式有序的层**，且**"硬策略"层在"模式"层之上**。
> `auto`（全放行）绝不能覆盖契约模式的硬拒。**这是我方现在没有表达的语义。**

### 1.2 `Risk` 分类里两条值得单独记的

```rust
"Read" | "Glob" | "Grep" | "ScheduledTaskList" => Risk::Low,
"Write" | "Edit" | "Bash" | "GenerateImages"   => Risk::High,
name if name.starts_with("plugin_") => match declared { … }
name if name.starts_with("mcp_") => Risk::Low,          // ← 可疑
_ => Risk::Medium,
```

**(a) ★ 插件未声明风险时降级为 `Medium`，不是 `Low`**，注释原文：

> A missing or malformed manifest declaration is **not a low-risk grant**.
> Medium preserves the normal approval path.

**"没声明" ≠ "低风险"。** 与上一轮记的 C45（配置静默不生效必须有工具检出）、
I16（未实现的能力直接拒绝声明）是**同一条原则的第三次出现**：**缺失不得等于放行。**

**(b) `mcp_*` 一律 `Risk::Low` —— 我认为这个默认值有问题。**
MCP 工具是**第三方服务器**暴露的任意能力，把整个命名空间判为低风险意味着**默认自动放行**。
对照 Codex 对 MCP 的处理（`GranularApprovalConfig.mcp_elicitations` 单列一类、
`ApprovedMcpPolicyAmendment` 有独立的跨会话策略、`mcp_policy.rs` 单独一个模块），
**Codex 把 MCP 当作需要更谨慎对待的东西。pi-desktop 这条我建议不要采纳。**

### 1.3 两个工程细节

```rust
pub const PERMISSION_TIMEOUT_MS: u64 = 120_000;
const ARGS_PREVIEW_MAX_CHARS: usize = 2_000;
```

`ARGS_PREVIEW_MAX_CHARS` 的注释给了**为什么**（原文）：

> Longest string leaf kept in a permission request's args preview. Full args (e.g. a Write's
> whole file content) would otherwise **cross every stdio/IPC hop and stall the renderer
> right as the dialog opens**.

**弹审批卡时不要把整个文件内容送过 IPC** —— 这类"为了展示而搬运全部数据"的性能坑很常见，
且症状是"对话框打开时卡一下"，很难归因。`preview_value` 是递归截断（字符串留头 + 标注剩余字符数），
**保留结构、只截叶子**。

---

## 2. ★★ DSH：权限是**两根正交旋钮**，预设只是捆包

`packages/interaction/permission-presets/src/index.ts` 模块注释原文：

> A switch records the selected preset, then **writes changed knobs through their canonical
> setters**. Execution, prompt narration, and replay keep reading **their knob folds**.
> **The preset event preserves user intent when two presets share a bundle.**

**两根旋钮**：
- `sandboxMode`: `read-only` | `workspace-write` | `danger-full-access`
- `approvalPolicy`: `ask` | `never`

**预设（preset）是这两根旋钮的具名捆包。** 这是本轮最重要的一条架构判断：

> **不要发明一个"权限模式"单枚举**（agentscope 是 5 个值的单枚举，qwen-code 是
> `allow|ask|deny|default` 单枚举）。**把正交的轴分开，预设只是 UX 层的具名组合。**
> 拆开之后：执行层读旋钮、回放读旋钮、提示词叙述读旋钮，**预设层只负责"用户点了什么"。**

### 2.1 ★ 预设事件是**日志专属**（不进模型对话），且理由是具体的

```ts
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'permission/preset': { preset: string }   // durable, log-only user intent
  }
}
```

注释原文：

> Records the selected preset as **durable, log-only user intent**. The knob events follow in
> the same turn and control execution; **this event stays out of the model transcript** and lets
> the permission projection unit **preserve a selection when bundles match**.

**为什么需要单独一个事件？** 因为**两个不同的预设可能写入完全相同的旋钮值** ——
只看旋钮无法分辨用户选了哪个。**预设事件保存的是"用户意图"，旋钮保存的是"生效配置"。**

> **对我方 E 层（P0）**：**"用户意图"与"生效配置"是两个不同的持久对象。**
> 我上一轮从 DSH 的 note 记过 L7"命令的调用与裁决不持久"，
> 这里是同一条原则在**配置域**的形态。**两者都要记，不能只记生效值。**

### 2.2 投影折叠**三个整值事件** + 组合默认

```ts
interface KnobState { preset: string | null; sandbox: SandboxMode | null; approval: ApprovalPolicy | null }
```

折 `permission/preset` / `sandbox/mode` / `approval/policy` 三个 whole-value 事件，
**在组合默认（composition defaults）之上**。
且持久化的投影状态**有 zod 校验**（`permissionStateSchema`，`.strict()`，含 `seeded` 字段标明
"日志里是否含构造期播种边界"）—— 印证了我记过的 DSH 立场：
**"事件 map 保持编译期，Zod 只校验投影状态，迁移只校验持久化载荷。"**

### 2.3 两个"派生值"被禁止回写 —— 一条干净的纪律

```ts
/** Returned when effective knob values match no available preset. Clients may show it as the
 *  current value, but it is never a switch target or event payload. */
export const CUSTOM_PRESET = 'custom'
```

**`custom` 是派生的**（旋钮值不匹配任何预设时算出），**它可以被显示，但永远不能作为切换目标或事件载荷**。
**派生值不得倒灌进持久状态** —— 否则日志里会出现一个"由别的字段算出来的"事实，
回放时可能算出不同的值。**这条应当进我方 E 层的形状纪律。**

以及 `catalog-changed` 事件**故意无载荷**（原文："Payload-free by design: consumers subscribe
first, then re-read the complete catalog"）—— **通知"变了"，不传"变成了什么"**，
避免事件里携带可能不一致的部分状态。

### 2.4 ★ `auto` 预设：全权 + 永不询问，但**只限当前会话**

```ts
const AUTO_PRESET_SPEC: PresetSpec = { sandbox: 'danger-full-access', approval: 'never' }
```

**自动判官预设 = "完全放开沙箱 + 永不向人询问"** —— 因为**判官取代了人的询问**。
模块注释限定它：**"current-session-only preset with a synchronous admission check"**，
且**"settings defaults remain limited to the configured table"** ——
**实验性的全权预设不允许成为新会话的默认值。**

> **建议（C 层新增）**：若引入 LLM 判官，其对应的高权限档必须
> **①只限当前会话 ②不得成为持久默认 ③有同步准入检查**。
> **"实验性能力不许沉淀成默认"是一条应当写下来的纪律。**

### 2.5 `approvalPolicy = 'never'` 的语义是**自动拒绝**，不是自动放行

`user-approval/src/index.ts:63` 注释原文：

> `'never'` — never prompt anyone: every ask resolves `'rejected'` … the policy whose outcome is
> knowable without asking.

**"不问" = 全部拒绝。** 与 Codex `GranularApprovalConfig` 的 `false → 自动拒绝` 同向。
**这是"关闭审批"的唯一安全语义。**

### 2.6 `ApprovalOutcome` 四值 + `unavailable` 必须 fail closed

`user-approval/src/types.ts`：

> Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn request, or
> unavailable answerer. **Callers fail closed on `unavailable`.**

```ts
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

**`unavailable`（没有应答者）与 `rejected`（人说不）分开。**
我前几轮从 note 记过这个「`unavailable` 标志」，**这里在代码里确认了**，
且它也是 `ApprovalPolicy='ask'` 在**无应答者时 fail-closed** 的实现基础。

### 2.7 ★ 审批审计必须是**成对**的，且**不得跨提交边界**

`user-approval/src/index.ts:219` 有一条显式错误：

> `'approval.request() outside an open turn: the approval/asked + approval/decided audit pair '`

理由（注释）：该审计对**由持久日志的 commit/replay 边界界定**；
一个空闲期的询问**在该边界之前就被拒**。

**`approval/asked` 与 `approval/decided` 必须成对、且配对不得跨越日志提交边界** ——
否则回放时会出现"只有问没有答"或"只有答没有问"的流。

> **对我方 E 层（P0）**：**成对事件必须显式声明"不得跨提交边界"**，
> 并在越界时**抛错**而非尽力而为。我方现有的事件形状纪律里**没有这一条**。

同时注意这两个事件是 **log-only 审计**，注释明确："like `hook/*`; **NOT a surface event**,
carries no `surfaceOp`" —— **审计与 UI 渲染是两套事件面。**
而模型是通过**一段自然语言句子**（`ASK_SENTENCE` / `NEVER_SENTENCE`）得知当前策略的，
**不是通过事件**。

---

## 3. 本轮确立的跨仓共性（权限域，累计 5 个独立实现）

| # | 共性 | 独立实现 |
| --- | --- | --- |
| 1 | **多来源/多层权限只能取交或取最严，不能覆盖** | Codex 交集 · kimi 四层 AND · pi-desktop 硬策略层在最上 |
| 2 | **"配置写错/没写"不得等于放行** | Codex `match`/`not_match` · kimi linter · pi-desktop plugin 未声明→Medium |
| 3 | **"不问/关闭审批" = 自动拒绝，不是自动放行** | Codex `Granular` false · DSH `never` · （hermes-agent 静默超时是反例） |
| 4 | **允许的持久化作用域必须显式** | Codex `ReviewDecision` 7 变体 · pi-desktop `AllowOnce`/`AllowSession` · DSH preset 事件 |
| 5 | **第四判决值是必需的，且要分两种** | pi-desktop `None` · DSH `unavailable` · qwen-code `'default'` · agentscope `PASSTHROUGH` |

**第 5 条现在是四个独立实现。** 我方 C 层必须采纳"有第四值"，且要区分两种：
**"我不管，去问"**（pi-desktop `None`）与**"我问不到"**（DSH `unavailable`）。
**两者结局不同：前者弹卡，后者 fail closed。**

---

## 4. 对需求文档的净影响（本轮新增/修正）

| 编号 | 条目 | 优先级 |
| --- | --- | --- |
| C57 | **判定为显式有序层；"硬策略"层在"模式"层之上，`auto` 不能覆盖硬拒** | **P0** |
| C58 | **"用户意图"与"生效配置"是两个持久对象，都要记** | **P0** |
| C59 | **成对事件（问/答）必须显式声明不得跨提交边界，越界抛错** | **P0** |
| C60 | **第四判决值分两种**：`None`（去问）与 `unavailable`（问不到 → fail closed） | **P0** |
| C61 | **允许只分"一次性"与"会话级"，不设笼统 `Allow`** | P0 |
| C62 | **准入预设若引入 LLM 判官：只限当前会话 / 不得成为持久默认 / 有同步准入检查** | P1 |
| E18 | **派生值（`custom` 类）不得倒灌进持久状态** | P1 |
| E19 | **变更通知事件可故意无载荷**，消费者收到后重读全量 | P2 |
| B19 | **弹审批时不得把全部参数搬过 IPC**；递归截断保留结构、只截叶子 | P2 |
| 修正 | **撤回"统一权限词汇表"倾向**（已在 §12.4 记录）；补：`mcp_*` 一律低风险**不采纳** | — |

---

## 5. 诚实声明

**本轮补的是权限域，五个仓里只覆盖了 pi-desktop 与 DSH 的权限主战场。**
**仍未读**（上一轮 §5/§7 清单的其余部分一笔未动）：

- **Codex**：`compact*` 全家、`rollout*`（持久化）、`context_manager/`、`code-mode`（V8）、
  `mcp_tool_call.rs`(2,504)、`app-server*`(6 crate)、`tui/`、
  以及 **40+ 个 `core/tests/suite/*` 测试套件**
- **ZCode**：`runtime/methods/` 的**主体**（那 7.8 万行的核心控制流）、
  `bootstrap/src/app/dynamic-workflow-run-*`（30+ 文件）、`compact/*`、`context/builder.ts`
- **kimi-code**：`agent/loop/loopService.ts`（**2,285 行主循环本体，一行未读**）、
  `taskService.ts`、`llmRequesterService.ts`、`toolExecutorService.ts`、
  `human/agent/machine.ts` 的实现、解析器实现（`parser.ts`/`lexer.ts`）
- **DSH**：`core/agent-loop` 本体、`core/tools`、`core/session`、`llm/`、`context/`、
  `fs/`、`hooks/`、`schedule` 与 `jobs` 的实现、`client/`
- **pi-desktop**：`rpc/mod.rs`（**8,810 行，全仓最大**）、`sessions.rs`(6,779)、
  `tools/mod.rs`(4,435)、`review.rs`(722)、`agent_capabilities/`、
  `config_sync/` 13 个文件（只读了 `engine.rs` 的 import 区）

**以及一个跨五仓的空白，两轮都没碰：所有仓的测试一个都没读。**
`docs/review-prompt.md` 要的"怎么 mock LLM、怎么断言事件序列"**至今没有答案**。
