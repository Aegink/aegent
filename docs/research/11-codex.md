# Codex 精读（openai/codex，Apache-2.0，`40eac3c`，119M）

> 本轮用户指定六个目标之一。**这是 Codex 第一次被真正读代码** —— 前几轮只扫过它的 20 篇文档。
> 方法：直接读 Rust 源码。所有引用均已 `sed -n` 逐条核验行号。
> 许可：Apache-2.0，摘代码须留版权头 + 登记 `THIRD_PARTY.md`。

---

## 0. 一句话

**Codex 在"权限"这一层比我方、比 OpenCode、比 kimi-code 都高一个量级。**
它不是一个 allow/ask/deny 判定器，而是**一个策略引擎 + 一个独立判官 agent + 一套 OS 级身份隔离**。
本轮五个仓里，**它对需求文档的冲击最大**。

---

## 1. turn → step 确认（我方层数决策的第四个独立来源）

`core/src/session/turn.rs:163` `pub(crate) async fn run_turn(`，内注释原文：

> `// run_turn owns the step used to seed context and make the first sampling request.`

循环内 `let mut next_step_context = Some(first_step_context);`（`turn.rs:421`），
每轮取 `step_context`。配套文件：`session/step_context.rs`、`step_settings.rs`、`step_activation.rs`。

**这是第四个独立确认三级生命周期 `turn → step → message` 的头部产品**
（前三个：pi 的命名、Claude Code 的 turn/step 契约、DSH 的 durable step 边界）。
我方 `docs/l0-events.md` 的「决策 1：采用三级、把 pi 的 turn 改名为 step」**证据现在是四条**。

---

## 2. ★ 头号发现：第四种权限聚合模型 —— `max()`，最严格者胜

前几轮我总结了三种模型（OpenCode `findLast` 后匹配胜 / kimi-code 有序具名策略表 / Claude Code 链位置）。
**Codex 是第四种，且是唯一一个"聚合"而非"择一"的。**

`execpolicy/src/decision.rs:9`：

```rust
pub enum Decision {
    Allow,      // 可直接运行
    Prompt,     // 需用户批准；approval_policy="never" 时直接拒绝
    Forbidden,  // 不再考虑，直接阻断
}
```

注意 `decision.rs:6` 的 derive 里有 **`Ord, PartialOrd`** —— 这个顺序就是严重度。

`execpolicy/src/policy.rs:402-412`：

```rust
fn from_matches(matched_rules: Vec<RuleMatch>) -> Self {
    let decision = matched_rules.iter().map(RuleMatch::decision).max();
    ...
}
```

**语义：把所有匹配到的规则收集起来，取严重度的最大值。** 即 `Forbidden > Prompt > Allow`，
**deny-overrides，最严格者胜**。这不是 first-match-wins，也不是 last-match-wins。

### 为什么这条比我方现在的设计好

这条聚合律有一个我方现设计**没有的结构性安全属性**：

> **增加一条规则永远只能收紧，不可能放松。**

因为新规则只贡献一个 `max()` 的候选值，它无法覆盖（override）任何已存在的更严格规则。
于是 Codex 那个"用户批准时顺便学一条规则"的机制（见 §4）**在构造上就是安全的** ——
一条自动学到的 `allow` 前缀规则，无论写进去多少次，都**不可能**越过任何一条既有 `forbidden`。

**这正好从结构上关掉了我前几轮标记的 P0 安全缺口 C35**（agent 修改自身权限配置以绕过策略）。
我方现在的规则表是"择一"语义，因此**必须**靠额外的"谁能写规则"的闸门来防；
Codex 不需要那个闸门，**因为它的聚合律本身就是单调的**。

> **建议（记入 C 层）**：我方权限聚合语义**改为 `max()` 最严格者胜**。
> 这一条同时简化 C10/C11/C27 三处的推理，并让 C35 从"要防"变成"结构上不可能"。

---

## 3. execpolicy：一个**真的策略语言**（不是规则数组）

我方 C 层现在是"规则表"。Codex 是一个**有语法、有加载期校验、有自测的策略语言**，
实现在 `execpolicy/`（2,012 行，含 473 行 parser）。`execpolicy/README.md` 摘意：

```starlark
prefix_rule(
    pattern = ["cmd", ["alt1", "alt2"]],   # 有序 token；列表项表示"或"
    decision = "prompt",                   # allow | prompt | forbidden，默认 allow
    justification = "explain why this rule exists",
    match     = [["cmd", "alt1"], "cmd alt2"],   # 必须匹配的样例
    not_match = [["cmd", "oops"], "cmd alt3"],   # 必须不匹配的样例
)
```

### 3.1 ★ 规则自带单元测试，加载期强制校验

**`match` / `not_match` 是这条语言的杀手特性**，README 原文称其为
"think of them as unit tests"（把它们当单元测试），**在加载时校验**。

这直接消灭了一类真实故障：**一条你以为会命中的规则实际不命中**（silently non-matching rule）。
我方 C 层规则表**没有任何自检**，写错了只会静默放行或静默拦截。

> **建议（C 层新增）**：每条权限规则**必须**带 `match`/`not_match` 样例，**启动期校验**，不通过则拒绝启动。
> 这一条对多端（我方 Q 层）尤其值钱：规则可能来自不同 surface 的配置合并，写错的概率随端数上升。

### 3.2 `justification`：规则必须解释自己，且拒绝要给出路

每条规则可带一段人类可读理由，**会在审批提示与拒绝消息里露出来**。README 明确要求：

> `decision = "forbidden"` 时，**在 `justification` 里给出推荐的替代做法**（例：*"Use `jj` instead of `git`."*）

**这是"拒绝要带重定向"** —— 模型拿到的不只是"不许"，而是"改用什么"。
对照我记过的 hermes-agent 静默超时 bug（拒绝无声），Codex 是另一个极端。

### 3.3 ★ `host_executable`：按绝对路径锁死解释器，反绕过

```starlark
host_executable(name = "git", paths = ["/opt/homebrew/bin/git", "/usr/bin/git"])
```

匹配语义（README 原文摘意）：
- **永远先试第一个 token 的精确匹配**。`/usr/bin/git status` 只匹配首个 token 为 `/usr/bin/git` 的规则
- 开启 host-executable 解析后，精确规则不中才**回退到 basename 规则 `git`**
- **若存在 `host_executable(name="git", paths=[...])`，basename 回退只允许列出的那些绝对路径**
- 若某 basename 没有 `host_executable()` 条目，basename 回退才放行

**这防的正是我方 C 层最怕的一类绕过**：往 `/tmp/git` 放一个恶意可执行文件，
让它去蹭 `git` 那条白名单规则。Codex 的答案是"**basename 白名单必须被绝对路径清单钉住**"。

> **建议（C 层新增）**：我方 shell 权限的 basename 规则必须有 `host_executable` 式绝对路径绑定。
> 这与 qwen-code 的 shell 语义分析是**两个不同层面的反绕过**（它防 shell 语法绕过，Codex 防解释器路径绕过），**两条都要**。

### 3.4 多策略文件按序合并 + `--changed` 式检查 CLI

`codex execpolicy check --rules a.rules --rules b.rules git status`，
多份规则**按给出的顺序合并**，输出永远是 JSON（`{"matchedRules":[...],"decision":"allow"}`）。
`Evaluation.matched_rules` **保留全部命中规则**，不只给最终判决 ——
**这是可解释性**：为什么是这个判决，一目了然。

### 3.5 三套并存的判决词汇表（**不要强行统一**）

Codex 一个产品里有**三套独立的判决类型**，各管各的对象：

| 词汇表 | 位置 | 值 | 管什么 |
| --- | --- | --- | --- |
| `Decision` | `execpolicy/src/decision.rs:9` | `Allow / Prompt / Forbidden` | shell 命令 |
| `SafetyCheck` | `core/src/safety.rs:17` | `AutoApprove / AskUser / Reject{reason}` | 文件补丁 |
| `ReviewDecision` | `protocol/src/protocol.rs:4152` | 7 个变体，见 §4 | 审批请求的**答复** |
| `GuardianAssessmentOutcome` | `protocol/src/approvals.rs:108` | `Allow / Deny` | 判官的**裁决** |

> **对我方的修正**：我此前倾向"统一权限词汇表"（把 allow/ask/deny 铺到所有地方）。
> Codex 反着做：**判决点各有各的类型**，因为对象不同（命令 ≠ 补丁 ≠ 答复 ≠ 裁决）。
> 强行统一会让"补丁的 AutoApprove"和"命令的 Allow"混为一谈，而它们的语义与持久化需求都不一样。

---

## 4. ★ 第二发现：审批不只是"同意/拒绝"，而是"同意，并且记住什么"

`protocol/src/protocol.rs:4152` 起，`ReviewDecision` 共 **7 个变体**。摘其要：

```
Approved                                   # 就这一次
ApprovedExecpolicyAmendment { proposed_execpolicy_amendment }   # 顺便写一条策略规则
ApprovedForSession                         # 本会话内同类自动放行（session 作用域缓存）
ApprovedMcpPolicyAmendment                 # 顺便改 MCP 策略（跨会话）
NetworkPolicyAmendment { network_policy_amendment }             # 顺便按主机持久化一条网络规则
Denied { rejection: String }               # 拒绝，且带上原因回给模型
TimedOut                                   # 审批超时（独立于拒绝）
Abort                                      # 拒绝且要求模型停下来等下一次用户指令
```

### 4.1 用户答复的是**两个问题**：批不批 + 记到哪一层

注意这里有 **4 种不同的持久化作用域**：

| 作用域 | 变体 | 存哪 |
| --- | --- | --- |
| 一次性 | `Approved` | 不留 |
| 会话级缓存 | `ApprovedForSession` | 本会话 |
| 策略文件（命令） | `ApprovedExecpolicyAmendment` | `.codexpolicy` |
| 策略（MCP） | `ApprovedMcpPolicyAmendment` | 跨会话 |
| 网络规则 | `NetworkPolicyAmendment` | 按主机 |

**我读过的其他所有仓（含我方现设计）都只有一个"允许"语义。**
Codex 把"记住"做成了一等公民，且**分作用域** —— 会话级与持久级是两回事，混用会导致
"我在这个会话里同意过一次，结果永久放开了"。

> **建议（C 层新增，P0）**：批准的动作必须**显式区分持久化作用域**（一次性 / 会话 / 项目 / 用户 / 受管）。
> 这不是可选的人机体验优化 —— **它是安全边界**。

### 4.2 ★ 修正建议由系统计算，不由模型提出

关键实现细节：`ApprovedExecpolicyAmendment` 里的 `proposed_execpolicy_amendment`（`protocol/src/approvals.rs:42`，
结构体只有 `command: Vec<String>`）是**由策略引擎根据当前命令算出来的**，
用户只是"接受/不接受"。**模型无法自己提案写规则。**

**这就是 C35（agent 改自身权限）的正解**：不是靠"禁止 agent 写配置文件"，
而是**把"写规则"从模型的能力面里彻底移走** —— 模型只能发命令，规则提案是引擎的产物。
配合 §2 的 `max()` 单调律，这条路径**双保险**。

### 4.3 `Denied { rejection: String }` 与 `TimedOut` 分立

拒绝要**带原因回给模型**（模型能据此改做法）；超时是**独立结局**，不等于拒绝。
对照我记过的 hermes-agent「审批静默超时」bug（`run_turn_runner_approval_settle.py`），
Codex 把 `TimedOut` 提升为协议级的一等结局，**且 `GuardianAssessmentStatus` 里同样有 `TimedOut` 与 `Aborted` 分立**。

---

## 5. guardian：一个**独立的 LLM 判官 agent**

`core/src/guardian/`（含 `review_session.rs`、`request_budget.rs`、`input_budget.rs`、`decision.rs`、`runtime.rs`）。
这不是"再问一次模型"，而是一个**有独立会话、独立预算、独立超时、独立模型选择**的审查者。

值得抄的点：

1. **abstain 落回人，绝不隐式放行**。`core/src/guardian/decision.rs:44` 注释原文：
   > `/// `None` requests the existing user flow. No contributor is never an implicit allow.`
   —— **"没有判官"不等于"允许"**。这正是我方 §C 层 fail-closed 的正确形态。

2. **独立性有预算**。`request_budget.rs` 有 `ExhaustedReviewBudget`；`input_budget.rs` 限制送进判官的
   transcript 条目数（`GUARDIAN_MAX_TOOL_ENTRY_TOKENS`）。**判官自己也会被滥用**，所以要限流。

3. **超时是常量**。`codex_guardian_reviewer::REVIEW_TIMEOUT`，且被 `tools/runtimes/unified_exec.rs:377` 复用
   去算"还要等多久"（`saturating_add(GUARDIAN_REVIEW_TIMEOUT)`）—— **超时预算参与上层调度**。

4. **判官可用管理策略强制**。`decision.rs` 里：
   `requirements.approvals_reviewer.can_set(ApprovalsReviewer::User).is_err()` ——
   **受管配置可以禁止用户退回人工审核**。即企业可以强制"必须过判官"。

5. **prompt cache 有独立 key**。`prompt_cache_key_override_for_review_session` ——
   判官会话与主会话**不共用缓存前缀**，避免互相污染（呼应我记过的缓存前缀稳定性维度）。

6. **裁决来源可追溯**。`GuardianAssessmentDecisionSource`、`GuardianCommandSource`
   （`Shell` / `UnifiedExec` —— 记的是**命令从哪个工具来的**）。

> **建议（C 层新增）**：若做 LLM 判官，必须在 P0 就定下四件事：
> ①abstain 语义（落回人，不隐式放行）②判官自身的请求/输入预算
> ③超时常量且被上层调度复用 ④受管配置可强制启用/禁止降级。

---

## 6. 工具并发：一把 `RwLock` 当全局准入闸

`core/src/tools/parallel.rs`。工具调用运行时的字段（`parallel.rs:49`）只有一个并发原语：

```rust
parallel_execution: Arc<RwLock<()>>,
```

派发处 `parallel.rs:191`：

```rust
let guard = if supports_parallel {
    Either::Left(lock.read().await)      // 可并行的工具：共享读锁，多个同时跑
} else {
    Either::Right(lock.write().await)    // 不可并行的工具：独占写锁，排他
};
```

`supports_parallel` 来自注册表（`router.rs:233` → `registry.supports_parallel_tool_calls(&tool_name)`），
**默认 `unwrap_or(false)`** —— **工具不声明就是不可并行**，fail-safe 的默认值。

**为什么这个设计好**：一个原语同时表达了两件事 ——
(a) 只读工具彼此并发；(b) 任何写工具排他。不需要额外的队列、信号量或优先级表。
对照我记过的 pi-desktop ADR 0041「有界准入」那套（分类计数 + 每会话上限 + 有限队列），
**Codex 在"工具间互斥"这个子问题上用 6 行就解决了，pi-desktop 是几十行的分类预算**。
两者解决的不是同一个问题：Codex 管**互斥**，pi-desktop 管**总量**。**我方两者都需要。**

其他值得记的：`ToolCallTimingGuard` 记录 `started_at` 与 `execution_started_at`
**两个时刻**（排队时长与执行时长分开），且 `step_context` 被 tool runtime **持有**，
注释原文：
> `// Tool calls may run later, so retain the step whose tool list advertised them.`

**即：工具真正执行时，用的必须是"当初声明它时那个 step 的工具清单"，不是当前的。**
这防的是"工具在执行期间被换掉"（step 边界换模）。**我方 B 层需要这条。**

---

## 7. ★ 第三发现：Windows 沙箱是**两个真实的 OS 账户 + WFP**

`windows-sandbox-rs/`（独立 crate，含 `acl.rs`、`token.rs`、`identity.rs`、`wfp/`、`dpapi.rs`、
`hide_users.rs`、`conpty/`、`helper_materialization/`、`elevated/`、`uninstall_windows.rs`）。

`src/setup.rs:53-54`：

```rust
pub const OFFLINE_USERNAME: &str = "CodexSandboxOffline";
pub const ONLINE_USERNAME: &str = "CodexSandboxOnline";
```

`src/setup.rs:740`：

```rust
pub(crate) enum SandboxNetworkIdentity { Offline, Online }
```
`from_permissions`：**代理强制启用、或网络策略未启用 → `Offline`；否则 `Online`。**

### 这条为什么是权威答案

我方 D 层现在写的是"Windows 原生 helper（Rust）+ kill-on-close Job Object"。
Codex 告诉我们：**真正要管住"不许联网"这件事，Job Object 不够** ——
Job 管的是**进程生命周期**，不是**网络**。一个跑在你进程组里的子进程照样能开 socket。

Codex 的做法是**把网络策略下沉到 OS 身份**：
- 建两个真实本地账户；**离线身份**被 WFP（Windows Filtering Platform）规则限制，
  只能访问指定的 loopback 代理端口（`WindowsSandboxProvisioningSettings.proxy_ports` / `allow_local_binding`）
- 需要联网的命令跑在**在线身份**下；不需要的跑在**离线身份**下
- 用 `CreateRestrictedToken` 收窄令牌，`LogonUserW(LOGON32_LOGON_INTERACTIVE)` 以该身份起进程
- 账户密码用 **DPAPI** 存（`dpapi.rs`），账户用 `hide_users.rs` **从登录界面隐藏**
- 读写放行靠 ACL 计算（`acl.rs` / `workspace_acl.rs` / `deny_read_walker.rs`）
- 一次性提权安装（`run_elevated_setup_with_proxy_settings`，`SETUP_VERSION: u32 = 5`），
  卸载路径单独一个模块，`setup_mutex.rs` 保证单实例

配套还有 `provisioning_client/`、`installation_record.rs`、`app_package.rs`、`service_identity.rs`、`no_reparse_dir.rs`
（防 NTFS reparse point / junction 绕过）。

> **对我方 D 层的修正（重要）**：
> **"进程管辖"与"网络管辖"是两个正交问题，需要两套机制。**
> Job Object 解决前者（pi-desktop ADR 的结论），**OS 身份 + WFP 解决后者**。
> 我方 D 层现在只写了前者。且 Codex 明确给出了**安装/卸载/单实例/身份隐藏**这条完整生命周期 ——
> 这不是"写个 helper"能覆盖的工程量。
>
> **这应当改变我方对 D 层工作量的估计**，并新增待定：
> **我方是否接受"Windows 上要建 OS 账户"这个前提？** 若接受，才有真网络隔离；若不接受，
> 就必须显式声明"网络策略只在工具层生效，对任意子进程不可强制"（诚实的弱承诺）。

---

## 8. 其他值得记的

### 8.1 权限配置层**按交集合成**，不能合成则拒绝

`protocol/src/permission_profile_intersection.rs` 定义了 `PermissionIntersectionError`，
顶部注释原文：

> `/// A policy cannot be intersected without weakening either input.`

错误变体：`ExternalSandbox`（"externally enforced filesystem permissions cannot be intersected safely"）、
`PlatformDefaults`、`UnsupportedPath`。

即：多个来源（用户配置 / 受管策略 / surface）各有一份权限档案，**合成方式是求交**，
**交不出来就报错，而不是放宽**。且具体授权路径**先规范化再比较**，
注释原文："so symlinks cannot acquire authority beyond either input"（符号链接无法取得超出任一输入的权限）。

> **建议（C 层 + Q 层）**：我方多来源权限（用户配置 + 受管 + 多端）**按交集合成**；
> **无交集时拒绝启动该配置**，不静默取宽。这比"就近覆盖"（last-wins）安全得多。

### 8.2 ★ 受保护元数据路径：C35 的具体落地

`protocol/src/permissions.rs:36-38`：

```rust
const PROTECTED_METADATA_GIT_PATH_NAME:    &str = ".git";
const PROTECTED_METADATA_AGENTS_PATH_NAME: &str = ".agents";
const PROTECTED_METADATA_CODEX_PATH_NAME:  &str = ".codex";
```

`forbidden_agent_metadata_write(...)`（`:56`）在**沙箱为 `Restricted` 时**，
对这三个名字的写入**在执行前直接拦截**。

**这就是我前几轮标记的 P0 缺口 C35 的参考答案**：不是"规则里写一条 deny"，
而是**在策略层之外、作为一个硬编码的、不参与规则合成的保留区**。
`.git`（能改历史与钩子）、`.agents`（能改指令）、`.codex`（能改权限配置）三者并列 ——
**agent 不得触碰的正是"能改变它自己被如何对待"的那些路径**。

> **建议（C 层，P0）**：我方照此设**保留元数据路径**，硬拦，且**不参与规则合成**（规则不得授权）。
> 我方至少要包含：`.git`、agent 指令文件（`AGENTS.md` 等）、我方配置目录。

### 8.3 读拒绝与写拒绝是**两套**机制

`permissions/deny_read_validator.rs`、`deny_read_resolver.rs`、`deny_read_walker.rs`、`deny_read_acl.rs`、
`deny_read_state.rs`（仅在 Windows 沙箱侧还有 `deny_read_acl.rs` / `deny_read_walker.rs`），
以及 `FileSystemAccessMode`、`ReadDenyMatcher`、`FileSystemSpecialPath`。
另有 `network_policy_decision.rs` + `network_approval.rs`（**1,254 行**）+ `network_policy.rs`。

**网络审批在 Codex 里是一个一等流程**（按主机 allow/deny + 可持久化 `NetworkPolicyAmendment`），
不是我方现在设想的"沙箱里不许联网"。

### 8.4 提权请求被细分成 5 个类别

`protocol/src/protocol.rs:983` `AskForApproval` 的 `Granular(GranularApprovalConfig)` 变体，
字段即类别：

| 字段 | 管什么 |
| --- | --- |
| `sandbox_approval` | shell 命令审批（含 `with_additional_permissions` / `require_escalated`） |
| `rules` | execpolicy `prompt` 规则触发的审批 |
| `skill_approval` | skill 脚本执行的审批 |
| `request_permissions` | `request_permissions` 工具触发的审批 |
| `mcp_elicitations` | MCP elicitation 审批 |

**语义**：字段为 `true` → 该类请求允许（会弹）；为 `false` → **自动拒绝，连弹都不弹**。

> **对我方 C 层的补充**：审批**不是一种东西**。我方现在把"要问用户"当作单一状态，
> Codex 把触发源分成 5 类并允许逐类配。**注意 `false` 的语义是"自动拒绝"而非"自动允许"** ——
> 关掉某类审批≠放行该类，而是把它变成硬拒绝。这个默认方向是对的。

### 8.5 规模参照

`codex-rs/` 下 **约 140 个 crate**。仅 `core/src` 就有 232,417 行 Rust（含测试）。
`core/src/session/tests.rs` 12,880 行、`config_tests.rs` 13,378 行 —— **测试比实现还多**。
另有 `code-mode`（V8 沙箱执行代码，含 `v8-poc/`）、`agent-graph-store`/`agent-roles`/`agent-identity`（多 agent）、
`memories/`、`skills/`、`hooks/`、`plugin/`、`realtime-webrtc`、`otel-trace-websocket`、`voice-host`。

---

## 9. 本轮对需求文档的净影响（Codex 部分）

| 层 | 建议 | 优先级 |
| --- | --- | --- |
| C | **权限聚合改为 `max()` 最严格者胜**（单调性 → 结构上关掉 C35） | **P0** |
| C | **规则自带 `match`/`not_match` 样例，加载期校验** | P0 |
| C | **保留元数据路径**（`.git`/指令文件/配置目录），硬拦，规则不得授权 | **P0** |
| C | **批准的持久化作用域显式化**（一次性/会话/项目/用户/受管） | **P0** |
| C | **规则提案由引擎计算，模型只能发命令** | **P0** |
| C | basename 规则必须绑绝对路径清单（`host_executable` 式） | P1 |
| C | 多来源权限**按交集合成**，无交集则拒绝 | P1 |
| C | 审批来源分 5 类，逐类配；关闭 ≠ 放行 = 硬拒绝 | P1 |
| C | `justification` 必填；`forbidden` 须给替代做法 | P2 |
| D | **网络隔离需 OS 身份 + WFP，Job Object 不够**（见下"新增待定"） | **P0** |
| B | 工具声明的元数据要**按 step 快照保留**，执行期用当初的清单 | P1 |
| B | 工具并发：**`RwLock` 一把锁**（读=并行、写=排他），未声明即不可并行 | P1 |
| A | turn→step 三级**第四次确认** | 已定 |
| L | `Evaluation.matched_rules` 保留**全部**命中规则（可解释性） | P2 |

**新增待定8：Windows 上是否接受"建 OS 账户"这个前提？**
接受 → 有真网络隔离（Codex 路线，工程量大：账户/DPAPI/WFP/隐藏/提权安装/卸载）；
不接受 → 必须**显式声明**"网络策略只在工具层生效，对任意子进程不可强制"。
**这条与待定7（agent 是否出进程）同级，都是决定 D 层边界的。**

---

## 10. 诚实声明：Codex 未读的部分

**我读了权限、沙箱、工具派发、主循环骨架。以下没读：**

- `core/src/compact*.rs`（十几万行级别的压缩体系，含 `compact_remote_v2*` 系列）—— **只看了文件名**
- `core/src/mcp_tool_call.rs`(2,504)、`mcp*.rs` 全家 —— **未读**
- `core/src/realtime_conversation.rs`(2,709) + `realtime_*` —— **未读**
- `core/src/context_manager/`、`core/src/history*`、`rollout*`（持久化）—— **未读**
- `code-mode`（V8 执行代码）—— **只看了目录名**
- `app-server*`（6 个 crate）、`tui/`、`exec-server*` —— **未读**
- `codex-rs/core/tests/suite/*` 里 40+ 个测试套件（**这是"怎么 mock LLM、怎么断言事件序列"的答案所在**）—— **未读**
- `agent-graph-store` / `agent-roles` / `agent-identity` / `multi_agents*` —— **未读**
- 全部 140 个 crate 里我实际打开过的不超过 15 个

**不要把这当成对 Codex 的完整评估。** 本节是"我确定没看的"，不是"我没想起来看的"。
