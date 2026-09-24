# 内核权限与扩展模型：实读对照

> 依据用户指令："真的做内核还是看其他的，好好看、好好评估"。
> 本轮**实读代码**（前四轮的缺口就是读文档多、读代码少）。
> 所有引用均为本机实测，路径可复现。**证据强度逐条标注**（见 §9）。

---

## 1. 本轮读到的三家权限模型（含上一轮）

| 仓 | 模型 | 权威由谁定 |
| --- | --- | --- |
| **OpenCode** | 扁平规则集 + `findLast`（**后写覆盖**） | 规则数组的顺序 |
| **Claude Code** | hook 洋葱链 + 位置 | **链位置**（托管 > 用户 > 核心） |
| **kimi-code** | **具名策略的有序列表，首个非 undefined 者胜** | 一份**可读的构造函数里的列表** |

**这三者不是"同一个东西的三种写法"。** 它们对"优先级从哪来"给出了三个不同答案。

---

## 2. kimi-code：一家把权限拆成 8 个模块的实现

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

### 2.1 核心：具名策略的有序列表

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

### 2.2 `deny` 与 `ask` 的返回形状

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

### 2.3 "本会话批准过"是一条合成的规则

`session-approval-history.ts` 不维护独立的"已批准集合"，而是在匹配时**合成一条 allow 规则**：

```ts
matchPermissionRule({ rule: { decision: 'allow', scope: 'session-runtime',
                              pattern, reason: 'approve for session' }, … })
```

**规则与批准共用一种表示。** 好处：批准与配置走**同一套匹配逻辑**（含 `Tool(args)` 解析、工具自实现的参数匹配），不必写第二套。

---

## 3. 规则语法 `Tool(args)` 已是行业约定

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

## 4. `待定1` 的答案：把 reason 结构化，把自由文本单独放

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

## 5. 规则作用域（我方完全没有的一维）

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

## 6. 策略自检：两家都做了，我方没有

### 6.1 kimi-code：`findInactiveToolPatterns`（`toolPolicy/evaluate.ts:85`）

返回**永远不会匹配到任何东西**的模式，并分类：

| kind | 含义 |
| --- | --- |
| `wildcard-not-mcp` | 内建工具名上用了通配符 —— **是写错了** |
| `incomplete-mcp-name` | `mcp__` 后没有第二个 `__` |
| `unknown-tool` | 字面量工具名不是已知工具 |

**这是一个我完全没想到的方向**：不是"这条规则是否放行"，而是"**这条规则有没有可能生效**"。
我方 C 层对写错的规则**静默不匹配** —— 用户以为配了保护，实际没有。

### 6.2 qwen-code：`eager-allowlist-coverage` / `eager-allowlist-warning` / `eager-surface-report`

三个文件（含两个 200–355 行的测试）围绕 **allowlist 的覆盖与告警**。
**文件名级证据**，实现未读（见 §9）。

---

## 7. qwen-code：**权限模块 20,130 行** —— 两个我没见过的方向

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

## 8. grok-build：服务端签名策略 —— **明确列为非目标**

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

## 9. 对我方的净影响

### 9.1 建议新增（**未写入需求文档，待你确认**）

| 建议 ID | 内容 | 依据 | 优先级 |
| --- | --- | --- | --- |
| **C20** | **具名策略的有序列表**：每个策略一个模块，首个非 undefined 者胜；顺序集中在一处 | kimi-code `permissionPolicyService.ts` | **P0** |
| **C21** | **参数匹配委托给工具自身**（`execution.matchesRule(argPattern)`） | kimi-code `matchesRule.ts` | **P0** |
| **C22** | **规则作用域**（project / user / turn-override / session-runtime），且批准不混进用户配置 | kimi-code `permissionRules` | P1 |
| **C23** | **策略自检**：报告永不匹配的模式（通配符用错、MCP 名不完整、未知工具名） | kimi-code `findInactiveToolPatterns` | P1 |
| **C24** | 审批响应带 **scope（记住本会话）/ feedback / 选项标签**，非二值 | kimi-code `ApprovalResponse` | P1 |
| **C25** | **工具激活与工具批准分离**（工作区/档案/全局/会话四层按 AND 合成） | kimi-code `toolPolicy/evaluate.ts` | P1 |

### 9.2 修正待定项

| 待定 | 修正 |
| --- | --- |
| **待定1** | 增加选项 **(d) reason 结构化（值为 JSON 原始类型）+ 自由文本单独放 `message`**。**我建议 (d)**，kimi-code 已在生产用这个形状 |
| **待定6** | **不再是二选一。** kimi-code 给出第三条路：形态是链、元素是策略模块，OpenCode 式规则集降为链中**一环**。建议按此定 |

### 9.3 一处**冲突**需记（不是错，是相反）

kimi-code **first-match-wins** vs OpenCode **last-match-wins**。
两者对"配置该怎么写"的要求完全相反。**我方必须选一个并写进文档**，否则用户写的规则行为不可预测。→ 并入待定6。

### 9.4 确认成立

| 我方条目 | 确认来源 |
| --- | --- |
| **默认 `ask`** | kimi-code `FallbackAsk` 是列表终结者；OpenCode `?? {action:'ask'}`；Claude Code 有 "mode 裁决 ask" |
| **默认放行只读/安全工具** | kimi-code `DEFAULT_APPROVE_TOOLS`（约 24 个：Read/Grep/Glob/WebSearch/Skill/…） |
| **deny 的理由要能回到模型** | kimi-code `Tool "X" was denied by permission rule. Reason: …`；Claude Code `reason` 字段 |
| **C14 不含自由文本** | kimi-code 把结构化 reason 与自由文本 `message` 分字段 —— **C14 可保留，且不必牺牲可读性** |

---

## 10. 诚实声明（**证据强度分级**）

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
