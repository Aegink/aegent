# 权限域深读（跨仓）

> 权限模型、决策词汇表、聚合语义、模式分类、LLM 判官 —— 三轮逐步加深的同一主题

> **本文件由以下轮次产出合并而成** —— 内容按原顺序保留，未改写，仅合并标题层级：
>
> - `07-kernel-permission-models.md` —— 第一轮：kimi 8 模块 / 规则语法 / 作用域 / 策略自检 / qwen 20,130 行 / grok 服务端签名
> - `09-permission-vocabulary-deep.md` —— 第二轮：第四值 / agentscope 五档模式 / qwen 权限词汇表 / LLM 判官
> - `16-permission-domain-deep.md` —— 第三轮：pi-desktop 严格分层 + `None`=去问用户 / DSH 两根正交旋钮 + 预设捆包
>
> 合并前的独立文件已删除（成为空号）；git 历史仍可追溯。

---

<!-- merged from 07-permission.md -->

## 内核权限与扩展模型：实读对照

> 依据用户指令："真的做内核还是看其他的，好好看、好好评估"。
> 本轮**实读代码**（前四轮的缺口就是读文档多、读代码少）。
> 所有引用均为本机实测，路径可复现。**证据强度逐条标注**（见 §9）。

---

### 1. 本轮读到的三家权限模型（含上一轮）

| 仓 | 模型 | 权威由谁定 |
| --- | --- | --- |
| **OpenCode** | 扁平规则集 + `findLast`（**后写覆盖**） | 规则数组的顺序 |
| **Claude Code** | hook 洋葱链 + 位置 | **链位置**（托管 > 用户 > 核心） |
| **kimi-code** | **具名策略的有序列表，首个非 undefined 者胜** | 一份**可读的构造函数里的列表** |

**这三者不是"同一个东西的三种写法"。** 它们对"优先级从哪来"给出了三个不同答案。

---

### 2. kimi-code：一家把权限拆成 8 个模块的实现

`oss/kimi-code/packages/agent-core-v2/src/agent/` 下：

```
permissionGate/          permissionMode/       permissionPolicy/
permissionRules/         toolApproval/         toolPolicy/
session/sessionToolPolicy/   session/sessionToolPolicyGate/
```

**第一件值得记的事：他们把"工具是否存在"与"工具是否被允许"分开了。**

- `toolPolicy/evaluate.ts`（106 行）管**激活**：`workspaceDisabledTools` → `profile` → `global{enabled,disabled}` → `sessionDisabledTools` **四层按 AND 合成**
- `permissionPolicy/` 管**批准**：approve / deny / ask

我方的 C 层只有后者。**"这个工具在这个工作区根本不该存在"与"这次调用该不该放行"是两个问题。**

#### 2.1 核心：具名策略的有序列表

`permissionPolicy/permissionPolicyService.ts:39-55` 的构造函数，**顺序即策略**：

```
 1  AutoModeAskUserQuestionDeny       auto 模式下"问用户"这个工具直接拒（没人在）
 2  UserConfiguredDeny                用户配置的 deny
 3  DangerousCommandAsk               危险命令 → ask        ← 非交互模式不装
 4  AutoModeApprove                   auto 模式批准
 5  SessionApprovalHistory            本会话批准过 → 放行
 6  UserConfiguredAsk
 7  UserConfiguredAllow
 8  SensitiveFileAccessAsk
 9  GitControlPathAccessAsk
10  YoloModeApprove
11  DefaultToolApprove                约 24 个只读/安全工具
12  GitCwdWriteApprove
13  FallbackAsk                       兜底 ask（12 行的终结者）
```

**四条可直接采用的设计**：

1. **每个策略是一个小模块，可独立写、独立测**（多数 17–60 行）。顺序集中在一处，**一眼可审**。
2. **`SessionApprovalHistory` 在第 5 位**：会话批准能绕过 `ask`，**但绕不过 `deny`** —— 优先级正确。
3. **装不了就别装**：`...(bootstrap.args.nonInteractive ? [] : [DangerousCommandAsk])`
   —— 非交互模式下没人可问，于是**整个策略不装**，而不是"问了然后自动拒"。
4. **`FallbackAsk` 是列表的终结者**，保证求值永远有结果。

> **这是对我方 `待定6` 的一个非二元答案**：不必在"规则集"与"洋葱链"之间二选一。
> kimi-code 走的是**中间路**：形态是链（可组合、有序），元素是策略模块（可单测），
> 而 `user-configured-*` 只是列表里的**一个**元素 —— 即 **OpenCode 的规则集可以降为链中的一环**。

#### 2.2 `deny` 与 `ask` 的返回形状

`permissionPolicy/types.ts`：

```ts
type PermissionPolicyResult =
  | { kind: 'approve'; reason?; executionMetadata? }
  | { kind: 'deny';    reason?; message? }
  | { kind: 'ask';     reason?; resolveApproval?; resolveError? }
```

- **`resolveApproval?: (result: ApprovalResponse) => PermissionPolicyResolution | undefined`**
  —— 人类回答之后，由**发起该策略的那个模块**把自己的回答转成最终裁决。
- `ApprovalResponse = { decision: 'approved'|'rejected'|'cancelled', scope?: 'session', feedback?: string, selectedLabel?: string }`
  - **`scope: 'session'`** = "批准并记住"（本会话内）
  - **`feedback`** = 拒绝时给人的话，可回流给模型
  - **`selectedLabel`** = 审批界面可以给**多个选项**，选中的标签回传 —— 不是二值批准

> 对照我方 `src/policy/pending.ts` 的 `Deferred<Decision>`：**我方只有二值**，
> 没有 scope、没有 feedback、没有选项标签。这三样都是真实产品在用的。

#### 2.3 "本会话批准过"是一条合成的规则

`session-approval-history.ts` 不维护独立的"已批准集合"，而是在匹配时**合成一条 allow 规则**：

```ts
matchPermissionRule({ rule: { decision: 'allow', scope: 'session-runtime',
                              pattern, reason: 'approve for session' }, … })
```

**规则与批准共用一种表示。** 好处：批准与配置走**同一套匹配逻辑**（含 `Tool(args)` 解析、工具自实现的参数匹配），不必写第二套。

---

### 3. 规则语法 `Tool(args)` 已是行业约定

**两家独立实现用同一种文本规则语法**，且都不是我方采用的形状：

| 仓 | 语法 | 解析代码 |
| --- | --- | --- |
| **Claude Code** | `Bash(git push:*)` | 只作为 `rule` 证据回传（`ToolCheckResult.rule`） |
| **kimi-code** | `ToolName(argPattern)` | `permissionRules/matchesRule.ts:parsePattern` |
| **我方（学 OpenCode）** | `{permission, pattern}` **两维通配，无文本形式** | `policy/evaluate.ts` |

`parsePattern` 的规则（`matchesRule.ts`）：找 `(`；无则整串是工具名；有则**必须**以 `)` 结尾，
括号前是工具名、括号内是参数模式；**括号内为空则降级为"只看工具名"**。
工具名用 `picomatch` 通配，`'*'` 匹配一切。

**最值得抄的一条**：参数匹配**委托给工具自己**：

```ts
return execution.matchesRule?.(parsed.argPattern) === true ? {...} : undefined;
```

只有工具知道自己参数的含义（`Bash` 比的是命令串，`Read` 比的是路径）。
策略引擎**不需要知道**，只把 `argPattern` 交下去。**我方 `evaluate` 用通用通配匹配整个 pattern，
匹配不到参数的语义。**

**另外**：kimi-code 是 **first-match-wins**（`firstMatchingRule` 返回首个匹配），
OpenCode 是 **last-match-wins**（`findLast`）。**方向相反。**
对配置作者的含义完全相反：前者要求"具体规则写前面"，后者要求"通用规则写前面、覆盖写后面"。

---

### 4. `待定1` 的答案：把 reason 结构化，把自由文本单独放

我方 `待定1` 是：DSH 的 `{kind:'hook', reason: string}` 带自由文本，与 **C14**（持久化不含自由文本）冲突。

**kimi-code 给了第三种做法，比我列的 (a)/(b)/(c) 都好**：

```ts
type PermissionReasonValue = string | number | boolean | null;
type PermissionDecisionReason = Readonly<Record<string, PermissionReasonValue>>;
```

- **`reason` 是"键 → JSON 原始类型"的记录**，不是自由文本 → 机器可读、可比较、可聚合
- **需要给人给模型看的自由文本另开一个字段**：`deny` 有 `message?: string`

即：**结构化事实进日志，自由文本只作呈现。** 这同时满足 C14 与"UI 要说清为什么"。

> **修正建议**：待定1 由 (a)/(b)/(c) 改为 **(d) reason 结构化（值为 JSON 原始类型），自由文本单独放 `message`**。

---

### 5. 规则作用域（我方完全没有的一维）

kimi-code 的 `PermissionRule` 带 `scope`：

| scope | 含义 |
| --- | --- |
| `turn-override` | 只管一个 turn |
| `project` | 项目级配置 |
| `user` | 用户级配置 |
| `session-runtime` | 本次会话中批准的（由 `ApprovalResponse.scope:'session'` 合成） |

且 `USER_CONFIGURED_SCOPES = {turn-override, project, user}` **显式排除 `session-runtime`** ——
会话批准由专门策略处理，**不混进用户配置**。**这是干净的分离。**

> 我方 `evaluate(permission, pattern, ...rulesets)` 用"传几个数组"表达分层，
> 但**没有作用域这个可持久化、可审计的字段**。规则从哪来（项目/用户/本回合/已批准）
> 在日志里查不到。

---

### 6. 策略自检：两家都做了，我方没有

#### 6.1 kimi-code：`findInactiveToolPatterns`（`toolPolicy/evaluate.ts:85`）

返回**永远不会匹配到任何东西**的模式，并分类：

| kind | 含义 |
| --- | --- |
| `wildcard-not-mcp` | 内建工具名上用了通配符 —— **是写错了** |
| `incomplete-mcp-name` | `mcp__` 后没有第二个 `__` |
| `unknown-tool` | 字面量工具名不是已知工具 |

**这是一个我完全没想到的方向**：不是"这条规则是否放行"，而是"**这条规则有没有可能生效**"。
我方 C 层对写错的规则**静默不匹配** —— 用户以为配了保护，实际没有。

#### 6.2 qwen-code：`eager-allowlist-coverage` / `eager-allowlist-warning` / `eager-surface-report`

三个文件（含两个 200–355 行的测试）围绕 **allowlist 的覆盖与告警**。
**文件名级证据**，实现未读（见 §9）。

---

### 7. qwen-code：**权限模块 20,130 行** —— 两个我没见过的方向

`oss/qwen-code/packages/core/src/permissions/` 实测：

| 文件 | 行数 |
| --- | ---: |
| `permission-manager.ts` | 1,687 |
| `permission-manager.test.ts` | **4,923** |
| `shell-semantics.ts` | **2,365** |
| `shell-semantics.test.ts` | 1,105 |
| `rule-parser.ts` | **1,803** |
| `classifier.ts` + `classifier-prompts/` + test | — |
| `destructive-commands.ts` | 216 |
| `eager-allowlist-coverage.ts` | 145 |
| `autoMode.ts` / `denialTracking.ts` / `trusted-user-answers.ts` | — |
| **合计** | **20,130** |

**两个信号值得记，但必须标明：我只看了文件清单与行数，实现一行未读。**

1. **`shell-semantics.ts` 2,365 行** —— 他们在**为 shell 命令建语义模型**。
   含义是：判定 `git status` 与 `git status; rm -rf /` 的差别，靠的不是字符串前缀匹配，
   而是**理解这条命令实际会做什么**。这比模式库（我方 C10）深一个量级。
2. **`classifier.ts` + `classifier-prompts/`** —— **用 LLM 给权限判定做分类器**。
   这是把"危险吗"交给模型判断，代价是延迟与 token，收益是覆盖面。

> **对我方 C10（危险命令模式库，P0）的含义**：模式库在工程上是最省的，
> 但业界头部实现已经在往上走（语义模型 / 分类器）。**我方 P0 先用模式库是对的（YAGNI），
> 但 C 层的接口要留得住将来接一个"判定器"** —— 即判定不该是"模式数组匹配"这个形状。

---

### 8. grok-build：服务端签名策略 —— **明确列为非目标**

`oss/grok-build/crates/codegen/xai-grok-config/src/signed_policy/` 的模块文档原文：

> The server-signed is-managed claim: verifiers, domain separation, **and the impose/defer signal
> that closes the sidecar-removal downgrade**.

配套测试 `claim_tests.rs` 的注释：

> The required `typ` closes **signature confusion**: neither message type substitutes for the other,
> **even genuinely signed by the same key.**

即：Ed25519 签名 + 域名分离(`typ`) + 过期时间 + keyset + **`fail_closed`**。
威胁模型是**"删掉本地策略文件以降级"**（sidecar-removal downgrade）。

**与我方关系：非目标。** 依据 `docs/requirements.md` 的 **Q2（使用者只有我自己）**
与 **Q1（Windows 本地，威胁模型 = 防误操作 + 防注入）** —— 我方没有"被管理的组织策略"
这个角色，也就没有降级攻击面。**记录下来是为了把"为什么不抄"写成证据，而不是默认跳过。**

---

### 9. 对我方的净影响

#### 9.1 建议新增（**未写入需求文档，待你确认**）

| 建议 ID | 内容 | 依据 | 优先级 |
| --- | --- | --- | --- |
| **C20** | **具名策略的有序列表**：每个策略一个模块，首个非 undefined 者胜；顺序集中在一处 | kimi-code `permissionPolicyService.ts` | **P0** |
| **C21** | **参数匹配委托给工具自身**（`execution.matchesRule(argPattern)`） | kimi-code `matchesRule.ts` | **P0** |
| **C22** | **规则作用域**（project / user / turn-override / session-runtime），且批准不混进用户配置 | kimi-code `permissionRules` | P1 |
| **C23** | **策略自检**：报告永不匹配的模式（通配符用错、MCP 名不完整、未知工具名） | kimi-code `findInactiveToolPatterns` | P1 |
| **C24** | 审批响应带 **scope（记住本会话）/ feedback / 选项标签**，非二值 | kimi-code `ApprovalResponse` | P1 |
| **C25** | **工具激活与工具批准分离**（工作区/档案/全局/会话四层按 AND 合成） | kimi-code `toolPolicy/evaluate.ts` | P1 |

#### 9.2 修正待定项

| 待定 | 修正 |
| --- | --- |
| **待定1** | 增加选项 **(d) reason 结构化（值为 JSON 原始类型）+ 自由文本单独放 `message`**。**我建议 (d)**，kimi-code 已在生产用这个形状 |
| **待定6** | **不再是二选一。** kimi-code 给出第三条路：形态是链、元素是策略模块，OpenCode 式规则集降为链中**一环**。建议按此定 |

#### 9.3 一处**冲突**需记（不是错，是相反）

kimi-code **first-match-wins** vs OpenCode **last-match-wins**。
两者对"配置该怎么写"的要求完全相反。**我方必须选一个并写进文档**，否则用户写的规则行为不可预测。→ 并入待定6。

#### 9.4 确认成立

| 我方条目 | 确认来源 |
| --- | --- |
| **默认 `ask`** | kimi-code `FallbackAsk` 是列表终结者；OpenCode `?? {action:'ask'}`；Claude Code 有 "mode 裁决 ask" |
| **默认放行只读/安全工具** | kimi-code `DEFAULT_APPROVE_TOOLS`（约 24 个：Read/Grep/Glob/WebSearch/Skill/…） |
| **deny 的理由要能回到模型** | kimi-code `Tool "X" was denied by permission rule. Reason: …`；Claude Code `reason` 字段 |
| **C14 不含自由文本** | kimi-code 把结构化 reason 与自由文本 `message` 分字段 —— **C14 可保留，且不必牺牲可读性** |

---

### 10. 诚实声明（**证据强度分级**）

| 级别 | 内容 |
| --- | --- |
| **读了代码**（逐行） | kimi-code：`toolPolicy/evaluate.ts`(106)、`permissionRules/matchesRule.ts`(83)、`permissionGate.ts`(20)、`permissionPolicy/types.ts`(部分)、`permissionPolicy/permissionPolicy.ts`、`permissionPolicyService.ts`(前 60 行)、`policies/{fallback-ask, session-approval-history, default-tool-approve, user-configured-ask, user-configured-rule}.ts` |
| **只列了文件与行数** | **qwen-code 权限模块全部**（`shell-semantics.ts` 2365 行、`classifier.ts`、`rule-parser.ts` 1803 行等 —— **实现一行未读**） |
| **只读了测试文件的模块注释** | grok-build `signed_policy`（读了 `claim_tests.rs` 的文档注释，**实现未读**） |
| **读了上轮契约** | Claude Code（见 `docs/research/06-claude-code-official.md`） |
| **未读** | **hermes-agent（7,103 个 .py 文件）本轮完全未碰**；kimi-code 的 `permissionMode` / `toolApproval` / `permissionRulesService` 未读；kimi-code 其他 3,238 个 .ts 未读；qwen-code 5,169 个 .ts 未读；grok-build 3,408 个 .rs 未读；以及 agentscope / mini-agent / mini-swe-agent / pi-mono **四个仓仍未读** |
| **未验证** | kimi-code `dangerous-command-ask.ts`（377 行）我只看了文件名与行数，**没读它的模式库**，因此不能对我方 C10 作具体比较 |

> **本轮最大的收获是权限模型**，最大的缺口是 **hermes-agent 与 qwen-code 的实现**。
> 两者合计 12,000+ 个源文件。**不要把这轮当成"内核评估完成"。**


---

<!-- merged from 07-permission.md -->

## 权限词汇表深读：第四值、模式分类、LLM 判官

> 依据用户指令："继续读然后记录，好好看"。
> 本轮读的是上一轮只列了行数的那些文件。所有引用本机实测，路径可复现。

---

### 1. 最重要的发现：**三值决策不够，两家独立实现都加了第四值**

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

#### 1.1 附带确认：工具可以自己做决定

agentscope 的 `PermissionBehavior` 由**工具自己的 `check_permissions` 返回**，
`Bash` 用它自动放行已识别的只读命令（`ls`、`git status`）。
**这与 kimi-code 的"参数匹配委托给工具"是同一思路的更完整形态** ——
不只是匹配委托，**整个决定都可以委托**。

**一个反直觉的对照**：agentscope 的 `DEFAULT` 模式下 **`Read`/`Glob`/`Grep` 返回 PASSTHROUGH，仍会走到默认 ASK** ——
即**连读也要问**（他们自述 DEFAULT 是"most secure"）。
对照 kimi-code 的 `DEFAULT_APPROVE_TOOLS` 直接放行约 24 个含 Read/Grep/Glob 的工具。
**两家在"读要不要问"上相反**，取决于威胁模型。我方按 Q1（防误操作 + 防注入）选放行读是合理的，**但要知道这是选择不是定论**。

---

### 2. agentscope 的五档模式 —— 其中 `DONT_ASK` 解决了我们的一个待定

`permission/_types.py` 的 `PermissionMode`（原文摘要）：

| 模式 | 行为 | 用途 |
| --- | --- | --- |
| `DEFAULT` | 每次操作都问，除非 allow 规则命中，或工具自己的 `check_permissions` 返回 ALLOW（目前只有 `Bash` 对已识别的只读命令） | 默认，**最安全** |
| `ACCEPT_EDITS` | 自动放行工作目录内的文件读写；**文件系统命令（mkdir/rm/mv/cp）仅在"所有目标路径都解析到工作目录内"时**才自动放行 | 人在旁边快速迭代 |
| **`EXPLORE`** | **只读模式**：放行只读工具与只读 bash；**拒绝任何修改**；**用户配置的 DENY/ASK 规则优先于只读自动放行** | 探索代码库、规划实现 |
| `BYPASS` | 跳过所有检查，只保留用户 deny/ask 规则与工具 DENY。**工具的"安全 ASK"不再生效 —— 包括 `rm -rf /`、写 `~/.bashrc`、命令注入模式等** | 沙箱环境（容器/VM） |
| **`DONT_ASK`** | **把每一个 ASK（含安全 ASK 与 ASK 规则命中）转为 DENY。无人值守时默认安全。** | 定时任务、用户不在时的后台执行 |

#### 2.1 `DONT_ASK` 优于"装不了就别装"

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

#### 2.2 `EXPLORE` = 把"计划模式"实现为权限模式

我方 G 层（Planning）按 DSH 的路线走"Plan 就是处于 planning 状态的同一个 Agent"。
agentscope 走了另一条：**`EXPLORE` 是一个权限模式** —— 只读，拒绝一切修改。

**两条路都能到**，差别在于：
- DSH 的 Plan 会影响**系统提示与工具集**
- agentscope 的 EXPLORE 只影响**权限判定**（工具仍在，只是被拒）

后者的好处是**不可绕过**：就算模型决定要写，写也会被拒；前者的好处是**不浪费 token**（工具Schema都不给）。

---

### 3. qwen-code 的权限规则词汇表 —— 目前读到的最完整的一份

`permissions/types.ts`（143 行）定义了完整的规则结构，四项我方没有：

#### 3.1 `raw`：保留规则原文

```ts
/** The original raw rule string as written in config. */
raw: string;
```

**这正是 `rule` 能回传的前提**（我方 C18）。只存解析后的结构，就永远说不清"是哪条规则"。
**这条与 C18 是同一件事的两半，应合并记录。**

#### 3.2 `invalid`：坏规则显式标记为"永不匹配"

```ts
/** True if the raw rule was malformed (e.g. unbalanced parens) and should never match. */
invalid?: boolean;
```

对照 kimi-code 的 `parsePattern`：**抛异常**，由 `matchPermissionRule` 捕获后返回 undefined。
两者都"不让坏规则半匹配"，但 qwen-code 把它变成**可查询的数据**，
于是 §上一轮的 C23（策略自检）可以直接读它。

#### 3.3 `toolParamMatchers`：第三种匹配机制

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

#### 3.4 `trustGated`：仓库自带规则的可信门控（**最精妙的一个**）

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

### 4. qwen-code 的 LLM 判官：一个完整的生产级设计

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

#### 4.1 四件可独立采用的事

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

#### 4.2 三档判断法：`ALLOW` / `SOFT_DENY` / `HARD_DENY`

`SOFT_DENY` 的定义（原文）：

> The classifier should block these **unless the user's most recent explicit request asked for that
> exact action and scope**.
>
> "Soft" means user intent CAN unblock — e.g. the user explicitly asking "edit my .qwen/settings.json
> and add envKey FOO=bar" **authorizes the specific edit named, but does not authorize unrelated
> changes to the same file**.

**"授权的是点名的那个改动，不是同一个文件的其他改动"** —— 这是防范围蔓延的精确表述。

#### 4.3 ★ 内置拒绝清单里有一条**我方完全没有的安全要求**

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

### 5. 对我方的净影响

#### 5.1 建议新增（**未写入需求文档，待你确认**）

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

#### 5.2 与既有的关系

- **C35 应并入 C 层的 P0 集合**，且它比 C10 更靠前 —— 它约束的是**策略集合本身**，不是单次调用
- **`EXPLORE` 模式**给我方 G 层提供了第二条路线（把计划模式做成权限模式），**与 DSH 的路线并列**，需在 G 层注明二选一

---

### 6. 诚实声明（**证据强度分级**）

| 级别 | 内容 |
| --- | --- |
| **整文件读完** | qwen-code `permissions/types.ts`(143)；agentscope `permission/_types.py`(102) |
| **读了文件头注释 + 导出结构 + 关键代码注释** | qwen-code `classifier.ts`（**405 行的函数体未逐行读**）、`classifier-prompts/system-prompt.ts`（读了前 55 行与结构，308 行未读完） |
| **只读了类型与文档注释** | agentscope `permission/_types.py`；`_engine.py`(848 行) **未读** |
| **未读** | agentscope `permission/_engine.py`(848)/`_decision.py`/`_context.py`/`_rule.py`；qwen-code `permission-manager.ts`(1,687)/`rule-parser.ts`(1,803)/`autoMode.ts`(886)/`denialTracking.ts`(262)；agentscope `middleware/`、`classifier/_jev/`；以及上一轮列出的全部未读项 |
| **未验证** | `SpecifierKind` 四个匹配器的**实际算法**（我只读了类型定义里的文字说明，未读实现，故"gitignore 风格"是**原文用词**而非我验证过的行为）；`sanitizeClassifierReason` 的清洗规则 |
| **仍未判定** | **agentscope 我只读了权限模块的枚举定义**，其 `_engine.py`(848 行) 未读 —— **因此本报告对 agentscope 的评价仅限权限词汇表，不代表对该仓的整体判定**。上一轮"未读、不给判定"的状态**只部分解除** |


---

<!-- merged from 07-permission.md -->

## 权限域深读（第六轮，补上一轮点名的最大空白）

> 上一轮我在 `15-pi-desktop.md` §5 与 `14-dsh.md` §7 都写明：
> **"这是权限主战场，本轮没读，是明显缺口"** —— pi-desktop `permissions.rs` 与
> DSH `interaction/user-approval`、`permission-presets`。本轮补上。

---

### 1. ★ pi-desktop：判定是**严格分层**的，且 `None` = 去问用户

`crates/host-core/src/permissions.rs:195` `evaluate_auto_with_permission_mode_and_risk_and_path`
返回 **`Option<PermissionDecision>`** —— **`None` 的含义是"没有自动判定，走审批卡"**。

`permissions.rs:42`：

```rust
pub enum PermissionDecision { AllowOnce, AllowSession, Deny }
```

**注意只有两个"允许"，没有笼统的 `Allow`。** "这一次"与"这个会话"是分开的，
与我上一轮从 Codex 记下的 C47（持久化作用域显式化）**同一洞察，第二个独立实现**。

#### 1.1 判定优先级（注释里明写了顺序，且顺序本身是安全属性）

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

#### 1.2 `Risk` 分类里两条值得单独记的

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

#### 1.3 两个工程细节

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

### 2. ★★ DSH：权限是**两根正交旋钮**，预设只是捆包

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

#### 2.1 ★ 预设事件是**日志专属**（不进模型对话），且理由是具体的

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

#### 2.2 投影折叠**三个整值事件** + 组合默认

```ts
interface KnobState { preset: string | null; sandbox: SandboxMode | null; approval: ApprovalPolicy | null }
```

折 `permission/preset` / `sandbox/mode` / `approval/policy` 三个 whole-value 事件，
**在组合默认（composition defaults）之上**。
且持久化的投影状态**有 zod 校验**（`permissionStateSchema`，`.strict()`，含 `seeded` 字段标明
"日志里是否含构造期播种边界"）—— 印证了我记过的 DSH 立场：
**"事件 map 保持编译期，Zod 只校验投影状态，迁移只校验持久化载荷。"**

#### 2.3 两个"派生值"被禁止回写 —— 一条干净的纪律

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

#### 2.4 ★ `auto` 预设：全权 + 永不询问，但**只限当前会话**

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

#### 2.5 `approvalPolicy = 'never'` 的语义是**自动拒绝**，不是自动放行

`user-approval/src/index.ts:63` 注释原文：

> `'never'` — never prompt anyone: every ask resolves `'rejected'` … the policy whose outcome is
> knowable without asking.

**"不问" = 全部拒绝。** 与 Codex `GranularApprovalConfig` 的 `false → 自动拒绝` 同向。
**这是"关闭审批"的唯一安全语义。**

#### 2.6 `ApprovalOutcome` 四值 + `unavailable` 必须 fail closed

`user-approval/src/types.ts`：

> Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn request, or
> unavailable answerer. **Callers fail closed on `unavailable`.**

```ts
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

**`unavailable`（没有应答者）与 `rejected`（人说不）分开。**
我前几轮从 note 记过这个「`unavailable` 标志」，**这里在代码里确认了**，
且它也是 `ApprovalPolicy='ask'` 在**无应答者时 fail-closed** 的实现基础。

#### 2.7 ★ 审批审计必须是**成对**的，且**不得跨提交边界**

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

### 3. 本轮确立的跨仓共性（权限域，累计 5 个独立实现）

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

### 4. 对需求文档的净影响（本轮新增/修正）

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

### 5. 诚实声明

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
