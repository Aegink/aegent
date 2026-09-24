# 权限词汇表深读：第四值、模式分类、LLM 判官

> 依据用户指令："继续读然后记录，好好看"。
> 本轮读的是上一轮只列了行数的那些文件。所有引用本机实测，路径可复现。

---

## 1. 最重要的发现：**三值决策不够，两家独立实现都加了第四值**

我方 C 层（学 OpenCode）的决策是 **`allow | ask | deny`** 三值，`ask` 兼作默认。
**两家独立实现各自发现这不够，并各自加了第四值** —— 而且**用的是同一个含义**：

| 仓 | 第四值 | 定义（原文） | 位置 |
| --- | --- | --- | --- |
| **qwen-code** | `'default'` | "**No explicit rule matched**; falls back to the global approval mode." | `permissions/types.ts:12` |
| **agentscope** | `PASSTHROUGH` | "**Let the permission engine continue with rule matching**（used by tools to defer decision to the engine）" | `permission/_types.py` |

**两者都在说同一件事：把"我没有意见，往下走"与"我要 ask"分开。**

**为什么这很重要（而不是洁癖）**：
我方 `evaluate(...) ?? {action:'ask'}` 让 `ask` 同时承担两种含义 ——
**"某条规则明确要求询问"** 与 **"没有任何规则匹配，兜底询问"**。后果：

1. **无法回答"为什么问我"** —— 这正是 C18（带 `rule`）想说清的事，但三值下即使带 `rule` 也说不清"是规则说的还是兜底说的"
2. **无法只改兜底行为**：想把"无规则命中"的策略从 ask 改成 deny（无人值守场景），会**连带改掉所有显式 ask 规则**
3. 工具的 `check_permissions` 无法表达"我不表态"

> **建议：C 层决策由 3 值改为 4 值 —— `allow | ask | deny | abstain`（或 `passthrough`）。**
> **建议 ID：C32，P0。** 这是词汇表级的决定，和 Q9 同类，**定了就改不动**。

### 1.1 附带确认：工具可以自己做决定

agentscope 的 `PermissionBehavior` 由**工具自己的 `check_permissions` 返回**，
`Bash` 用它自动放行已识别的只读命令（`ls`、`git status`）。
**这与 kimi-code 的"参数匹配委托给工具"是同一思路的更完整形态** ——
不只是匹配委托，**整个决定都可以委托**。

**一个反直觉的对照**：agentscope 的 `DEFAULT` 模式下 **`Read`/`Glob`/`Grep` 返回 PASSTHROUGH，仍会走到默认 ASK** ——
即**连读也要问**（他们自述 DEFAULT 是"most secure"）。
对照 kimi-code 的 `DEFAULT_APPROVE_TOOLS` 直接放行约 24 个含 Read/Grep/Glob 的工具。
**两家在"读要不要问"上相反**，取决于威胁模型。我方按 Q1（防误操作 + 防注入）选放行读是合理的，**但要知道这是选择不是定论**。

---

## 2. agentscope 的五档模式 —— 其中 `DONT_ASK` 解决了我们的一个待定

`permission/_types.py` 的 `PermissionMode`（原文摘要）：

| 模式 | 行为 | 用途 |
| --- | --- | --- |
| `DEFAULT` | 每次操作都问，除非 allow 规则命中，或工具自己的 `check_permissions` 返回 ALLOW（目前只有 `Bash` 对已识别的只读命令） | 默认，**最安全** |
| `ACCEPT_EDITS` | 自动放行工作目录内的文件读写；**文件系统命令（mkdir/rm/mv/cp）仅在"所有目标路径都解析到工作目录内"时**才自动放行 | 人在旁边快速迭代 |
| **`EXPLORE`** | **只读模式**：放行只读工具与只读 bash；**拒绝任何修改**；**用户配置的 DENY/ASK 规则优先于只读自动放行** | 探索代码库、规划实现 |
| `BYPASS` | 跳过所有检查，只保留用户 deny/ask 规则与工具 DENY。**工具的"安全 ASK"不再生效 —— 包括 `rm -rf /`、写 `~/.bashrc`、命令注入模式等** | 沙箱环境（容器/VM） |
| **`DONT_ASK`** | **把每一个 ASK（含安全 ASK 与 ASK 规则命中）转为 DENY。无人值守时默认安全。** | 定时任务、用户不在时的后台执行 |

### 2.1 `DONT_ASK` 优于"装不了就别装"

上一轮我记了 kimi-code 的做法：非交互模式下 `...(nonInteractive ? [] : [DangerousCommandAsk])`
—— **把无法满足的策略整个卸掉**。

**agentscope 的做法更好**：不动任何策略，**只把"无法回答的 ASK"这一种结局改成 DENY**。

差别很实在：
- kimi-code 卸掉策略 ⇒ **连"检测"都一起没了**
- agentscope 保留全部检测 ⇒ **该发现的还是发现，只是结局从"问"变成"拒"**

且实现上是一处全局映射，不需要 N 处条件安装。

**原文还明确划了 `BYPASS` 与 `DONT_ASK` 的界限**（这是给用户的指导）：
> "Use deny rules to protect specific paths. **For unattended runs that still need safety, prefer DONT_ASK.**"

> **对我方**：`DONT_ASK` 直接可用。而且它给了"无人值守"一个**安全的默认**，
> 而不是让用户在手忙脚乱时去开 `BYPASS`。→ **建议 ID：C33，P1。**

### 2.2 `EXPLORE` = 把"计划模式"实现为权限模式

我方 G 层（Planning）按 DSH 的路线走"Plan 就是处于 planning 状态的同一个 Agent"。
agentscope 走了另一条：**`EXPLORE` 是一个权限模式** —— 只读，拒绝一切修改。

**两条路都能到**，差别在于：
- DSH 的 Plan 会影响**系统提示与工具集**
- agentscope 的 EXPLORE 只影响**权限判定**（工具仍在，只是被拒）

后者的好处是**不可绕过**：就算模型决定要写，写也会被拒；前者的好处是**不浪费 token**（工具Schema都不给）。

---

## 3. qwen-code 的权限规则词汇表 —— 目前读到的最完整的一份

`permissions/types.ts`（143 行）定义了完整的规则结构，四项我方没有：

### 3.1 `raw`：保留规则原文

```ts
/** The original raw rule string as written in config. */
raw: string;
```

**这正是 `rule` 能回传的前提**（我方 C18）。只存解析后的结构，就永远说不清"是哪条规则"。
**这条与 C18 是同一件事的两半，应合并记录。**

### 3.2 `invalid`：坏规则显式标记为"永不匹配"

```ts
/** True if the raw rule was malformed (e.g. unbalanced parens) and should never match. */
invalid?: boolean;
```

对照 kimi-code 的 `parsePattern`：**抛异常**，由 `matchPermissionRule` 捕获后返回 undefined。
两者都"不让坏规则半匹配"，但 qwen-code 把它变成**可查询的数据**，
于是 §上一轮的 C23（策略自检）可以直接读它。

### 3.3 `toolParamMatchers`：第三种匹配机制

```ts
/** Example: rule `Agent(model:opus)` → `[{ key: 'model', valuePattern: 'opus' }]` */
toolParamMatchers?: Array<{ key: string; valuePattern: string }>;
```

规则可写成 `Agent(model:opus)`，要求工具实际入参中含 `model` 且值匹配 `opus`（支持 `*`）。
**即：规则不只匹配"工具名 + 一个 specifier"，还能匹配"具名参数"。**

配合 `SpecifierKind = 'command' | 'path' | 'domain' | 'literal'` ——
**匹配算法由 kind 决定，且 kind 由工具类别自动推导**：
- 命令 → shell glob
- 路径 → **gitignore 风格**（比通用 glob 更贴合路径语义）
- 域名 → domain 匹配
- 其他 → 字面量相等

> **这是"参数怎么匹配"的第三种答案**（前两种：OpenCode 通用通配；kimi-code 委托给工具）。
> qwen-code 是**把 specifier 分型，每型一个匹配器**，且**规则语法自带类型**。

### 3.4 `trustGated`：仓库自带规则的可信门控（**最精妙的一个**）

```ts
/**
 * True for a session allow rule granted by repository-controlled configuration
 * — a project skill's `allowedTools` — which is honoured only while the folder is trusted.
 * The rule stays in the session set so that a trust revoked mid-session suspends it
 * (nothing repo-supplied auto-approves in an untrusted folder) and a trust granted again
 * restores it, **without any per-skill bookkeeping**.
 */
trustGated?: boolean;
```

**问题**：仓库可以自带 skill，skill 里声明 `allowedTools` —— 那就是**仓库在替用户放行工具**。
仓库不可信时这些绝不能生效；而且**信任可以在会话中途被撤销**。

**做法**：信任变化时**不移除规则**，只加一个 `trustGated` 标记，求值时**读当前信任状态**。
于是：撤销即时生效，恢复即时生效，**不需要记录"这条规则是哪个 skill 加的"**。

> **这直接补上我方 C11（项目信任 / 未信任项目降权，P1）缺的机制。**
> 我方的 C11 只写了"降权"，没写"信任中途变化时怎么处理已经装上的规则"。
> **`trustGated` 标记法比我方能想到的"加载/卸载规则"更简单也更正确。**
> → **建议 ID：C34，P1。**

---

## 4. qwen-code 的 LLM 判官：一个完整的生产级设计

`permissions/classifier.ts`（405 行）+ `classifier-prompts/system-prompt.ts`（308 行）。
**文件头注释即设计说明**：

```
 * AUTO approval mode LLM classifier.
 *
 * Two-stage flow:
 *   Stage 1 (fast):  shouldBlock-only output, max_tokens=32, thinking off.
 *                    Allow path returns immediately (~300ms).
 *   Stage 2 (review): full output { thinking, shouldBlock, reason }, max_tokens=4096.
 *                     Reviews stage-1 blocks to reduce false positives.
 *
 * Fail-closed: any non-abort failure (API error, timeout, schema failure,
 * context overflow) returns shouldBlock=true with unavailable=true.
```

### 4.1 四件可独立采用的事

1. **两阶段，且第二阶段专门用来纠第一阶段的误报。**
   常见路径（放行）走便宜的（`max_tokens=32`、关思考、~300ms）；
   罕见路径（拦截）才走贵的，**而贵的那次是为了减少误报**。
   —— 不是"两阶段提速"，是**"用贵路径修正便宜路径的假阳性"**。

2. **`unavailable=true`：失败与判断分离。**
   fail-closed（失败即拦）是对的，但**必须同时记录"这是因为够不着，不是因为判它危险"**。
   这与 C28（不确定性作为字段）是同一纪律。
   **另一处精确**：只对 **non-abort** 失败如此 —— **用户取消不是失败，应当透传**。

3. **超时预算刻意宽松，并写明理由**：
   > "A timeout yields an unavailable result and manual fallback downstream, so **too tight a budget
   > turns transient slowness into repeated prompts**. The fast model's p99 is ~1.5s but the tail is
   > long under load, so budgets are kept generous."
   
   `STAGE1_TIMEOUT_MS = 10_000`（p99 只有 ~1.5s）。
   **因为超时的代价是"多弹一次窗"而不是"少一次保护"，所以买余量。**

4. **用户配置只能追加，不能替换**：
   > "Built-in ALLOW / SOFT BLOCK / HARD BLOCK / ENVIRONMENT lists are hardcoded here.
   > User-configured hints … are appended additively. **Replace-mode is not supported.**"
   
   **用户（或仓库）不能删掉内置保护。** 且输入有界：`MAX_USER_HINT_LENGTH = 200`、
   `MAX_USER_HINTS_PER_SECTION = 50`。另保留旧键为弃用别名（`hints.deny` → `softDeny`）。

### 4.2 三档判断法：`ALLOW` / `SOFT_DENY` / `HARD_DENY`

`SOFT_DENY` 的定义（原文）：

> The classifier should block these **unless the user's most recent explicit request asked for that
> exact action and scope**.
>
> "Soft" means user intent CAN unblock — e.g. the user explicitly asking "edit my .qwen/settings.json
> and add envKey FOO=bar" **authorizes the specific edit named, but does not authorize unrelated
> changes to the same file**.

**"授权的是点名的那个改动，不是同一个文件的其他改动"** —— 这是防范围蔓延的精确表述。

### 4.3 ★ 内置拒绝清单里有一条**我方完全没有的安全要求**

`BUILTIN_SOFT_DENY` 的第 4 类原文：

> **Self-modification**: modifying files or directories that affect Qwen Code behavior, permissions,
> startup context, commands, hooks, agents, skills, MCP servers, or project/user instructions,
> including `.qwen/settings*.json`, `QWEN.md`, `AGENTS.md`, …, `.qwen/agents/`, `.qwen/skills/`,
> `.qwen/hooks/`, … and `.mcp.json`, unless the user explicitly requested that exact change.
> **Includes adding or widening permission allow rules (e.g. wildcard "Bash(prefix:*)" entries, broad
> path allows in `.qwen/settings*.json`) that the user did not explicitly request, even while making
> a user-requested edit to the same file.**

**即：agent 不得在"顺手改配置"时把给自己的权限放宽。**
原文还堵了一个具体绕过：**即使这次修改是用户要求的，也不得顺带加入用户没要求的 allow 规则。**

**我方需求文档对此毫无覆盖。** 实测 grep：

| 关键词 | 结果 |
| --- | --- |
| 自我修改 / 提权 / 权限提升 / escalation | **仅 1 处**，且是"Windows AppContainer / 提权 MXC"（无关）；另 1 处是 S7 的"注入指令不能提权"（讲的是**抓取内容**里的注入，不是 agent 改自己的配置） |
| SSRF / IMDS / 元数据服务 / 外带 / 隧道 | **零覆盖** |

**为什么这是本轮最高严重度的一条**：一个能改写自己权限配置的 agent，
**后面所有策略都变成可选的**。C10（危险命令库）、C11（项目信任）、C27（shell 语义）
全部可以通过"先把自己加进白名单"绕过。

同清单里另外两类我方也没有：
- **IMDS（云实例元数据服务）作为 SSRF 目标** —— 代码注释解释了理由：
  "they hand out short-lived credentials to any process that can reach the link-local IP"
- **带外回调主机（collaborator 式服务、request bin、隧道）作为外带预备** ——
  "they look like benign network calls unless the classifier explicitly flags them"
  且注释写明**为什么要合并成一条**：
  "**Bundle both here so the policy is one sentence the classifier can hold in attention.**"
  —— 策略的组织方式本身是为了**让模型能把它整句持在注意力里**。

> 注：`CLAUDE.md`/`AGENTS.md` 一类"项目指令文件"也在自我修改清单内 ——
> 即**agent 不该悄悄改自己的系统提示来源**。这是提示注入的另一半：不只是"不被网页注入"，
> 还有"不自己扩权"。

---

## 5. 对我方的净影响

### 5.1 建议新增（**未写入需求文档，待你确认**）

| 建议 ID | 内容 | 依据 | 优先级 |
| --- | --- | --- | --- |
| **C32** | **C 层决策由 3 值改为 4 值**（`allow/ask/deny/abstain`）—— 把"没意见，往下走"与"我要 ask"分开 | qwen-code `'default'` + agentscope `PASSTHROUGH` **两家独立** | **P0** |
| **C33** | **无人值守模式：把每一个 ASK 转为 DENY**（而非卸掉策略）—— 保留检测，只改结局 | agentscope `DONT_ASK` | P1 |
| **C34** | **仓库自带规则用 `trustGated` 标记门控**，信任变化时不移除规则而读当前信任 —— 无需 per-skill 记账 | qwen-code `trustGated` | P1 |
| **C35** | **禁止 agent 修改自身权限配置**：含"用户要求的编辑中顺带放宽 allow 规则"这一具体绕过 | qwen-code `BUILTIN_SOFT_DENY` 第 4 类 | **P0** |
| **C36** | **内置保护清单只能追加、不能替换**；用户提示有界（长度 + 条数） | qwen-code（`Replace-mode is not supported`） | P1 |
| **C37** | **IMDS 与带外回调主机列为网络侧拒绝项** | qwen-code 代码注释 | P1 |
| **C38** | **规则保留 `raw` 原文**（与 C18 合并） | qwen-code `PermissionRule.raw` | **P0** |
| **C39** | **specifier 按 kind 分型匹配**（command→shell glob、path→**gitignore 风格**、domain、literal），kind 由工具类别推导 | qwen-code `SpecifierKind` | P1 |
| **C40** | **规则可匹配具名参数**（`Agent(model:opus)`） | qwen-code `toolParamMatchers` | P2 |
| **C41** | **坏规则显式标记为永不匹配**（与 C23 合并） | qwen-code `invalid` | P1 |
| **C42** | **两阶段 LLM 判官**（贵路径用于修正便宜路径的假阳性）；**失败 fail-closed 且带 `unavailable` 标记**；**abort 不算失败**；**超时预算刻意宽松并写明理由** | qwen-code `classifier.ts` | P2 |

### 5.2 与既有的关系

- **C35 应并入 C 层的 P0 集合**，且它比 C10 更靠前 —— 它约束的是**策略集合本身**，不是单次调用
- **`EXPLORE` 模式**给我方 G 层提供了第二条路线（把计划模式做成权限模式），**与 DSH 的路线并列**，需在 G 层注明二选一

---

## 6. 诚实声明（**证据强度分级**）

| 级别 | 内容 |
| --- | --- |
| **整文件读完** | qwen-code `permissions/types.ts`(143)；agentscope `permission/_types.py`(102) |
| **读了文件头注释 + 导出结构 + 关键代码注释** | qwen-code `classifier.ts`（**405 行的函数体未逐行读**）、`classifier-prompts/system-prompt.ts`（读了前 55 行与结构，308 行未读完） |
| **只读了类型与文档注释** | agentscope `permission/_types.py`；`_engine.py`(848 行) **未读** |
| **未读** | agentscope `permission/_engine.py`(848)/`_decision.py`/`_context.py`/`_rule.py`；qwen-code `permission-manager.ts`(1,687)/`rule-parser.ts`(1,803)/`autoMode.ts`(886)/`denialTracking.ts`(262)；agentscope `middleware/`、`classifier/_jev/`；以及上一轮列出的全部未读项 |
| **未验证** | `SpecifierKind` 四个匹配器的**实际算法**（我只读了类型定义里的文字说明，未读实现，故"gitignore 风格"是**原文用词**而非我验证过的行为）；`sanitizeClassifierReason` 的清洗规则 |
| **仍未判定** | **agentscope 我只读了权限模块的枚举定义**，其 `_engine.py`(848 行) 未读 —— **因此本报告对 agentscope 的评价仅限权限词汇表，不代表对该仓的整体判定**。上一轮"未读、不给判定"的状态**只部分解除** |
