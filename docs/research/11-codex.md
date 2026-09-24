# Codex 深读（openai/codex，Apache-2.0）

> 权限聚合 `max()`、execpolicy 策略语言、Windows 沙箱、压缩与持久化

> **本文件由以下轮次产出合并而成** —— 内容按原顺序保留，未改写，仅合并标题层级：
>
> - `11-codex.md` —— 第一轮：`max()` 聚合 / execpolicy / ReviewDecision / guardian / RwLock / Windows 双账户+WFP
> - `17-codex-compact-persistence.md` —— 第二轮：压缩是生命周期 / 6 维分类学 / 编号窗口 / 预算送达 / 日志 zstd 冷压缩
>
> 合并前的独立文件已删除（成为空号）；git 历史仍可追溯。

---

<!-- merged from 11-codex.md -->

## Codex 精读（openai/codex，Apache-2.0，`40eac3c`，119M）

> 本轮用户指定六个目标之一。**这是 Codex 第一次被真正读代码** —— 前几轮只扫过它的 20 篇文档。
> 方法：直接读 Rust 源码。所有引用均已 `sed -n` 逐条核验行号。
> 许可：Apache-2.0，摘代码须留版权头 + 登记 `THIRD_PARTY.md`。

---

### 0. 一句话

**Codex 在"权限"这一层比我方、比 OpenCode、比 kimi-code 都高一个量级。**
它不是一个 allow/ask/deny 判定器，而是**一个策略引擎 + 一个独立判官 agent + 一套 OS 级身份隔离**。
本轮五个仓里，**它对需求文档的冲击最大**。

---

### 1. turn → step 确认（我方层数决策的第四个独立来源）

`core/src/session/turn.rs:163` `pub(crate) async fn run_turn(`，内注释原文：

> `// run_turn owns the step used to seed context and make the first sampling request.`

循环内 `let mut next_step_context = Some(first_step_context);`（`turn.rs:421`），
每轮取 `step_context`。配套文件：`session/step_context.rs`、`step_settings.rs`、`step_activation.rs`。

**这是第四个独立确认三级生命周期 `turn → step → message` 的头部产品**
（前三个：pi 的命名、Claude Code 的 turn/step 契约、DSH 的 durable step 边界）。
我方 `docs/l0-events.md` 的「决策 1：采用三级、把 pi 的 turn 改名为 step」**证据现在是四条**。

---

### 2. ★ 头号发现：第四种权限聚合模型 —— `max()`，最严格者胜

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

#### 为什么这条比我方现在的设计好

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

### 3. execpolicy：一个**真的策略语言**（不是规则数组）

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

#### 3.1 ★ 规则自带单元测试，加载期强制校验

**`match` / `not_match` 是这条语言的杀手特性**，README 原文称其为
"think of them as unit tests"（把它们当单元测试），**在加载时校验**。

这直接消灭了一类真实故障：**一条你以为会命中的规则实际不命中**（silently non-matching rule）。
我方 C 层规则表**没有任何自检**，写错了只会静默放行或静默拦截。

> **建议（C 层新增）**：每条权限规则**必须**带 `match`/`not_match` 样例，**启动期校验**，不通过则拒绝启动。
> 这一条对多端（我方 Q 层）尤其值钱：规则可能来自不同 surface 的配置合并，写错的概率随端数上升。

#### 3.2 `justification`：规则必须解释自己，且拒绝要给出路

每条规则可带一段人类可读理由，**会在审批提示与拒绝消息里露出来**。README 明确要求：

> `decision = "forbidden"` 时，**在 `justification` 里给出推荐的替代做法**（例：*"Use `jj` instead of `git`."*）

**这是"拒绝要带重定向"** —— 模型拿到的不只是"不许"，而是"改用什么"。
对照我记过的 hermes-agent 静默超时 bug（拒绝无声），Codex 是另一个极端。

#### 3.3 ★ `host_executable`：按绝对路径锁死解释器，反绕过

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

#### 3.4 多策略文件按序合并 + `--changed` 式检查 CLI

`codex execpolicy check --rules a.rules --rules b.rules git status`，
多份规则**按给出的顺序合并**，输出永远是 JSON（`{"matchedRules":[...],"decision":"allow"}`）。
`Evaluation.matched_rules` **保留全部命中规则**，不只给最终判决 ——
**这是可解释性**：为什么是这个判决，一目了然。

#### 3.5 三套并存的判决词汇表（**不要强行统一**）

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

### 4. ★ 第二发现：审批不只是"同意/拒绝"，而是"同意，并且记住什么"

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

#### 4.1 用户答复的是**两个问题**：批不批 + 记到哪一层

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

#### 4.2 ★ 修正建议由系统计算，不由模型提出

关键实现细节：`ApprovedExecpolicyAmendment` 里的 `proposed_execpolicy_amendment`（`protocol/src/approvals.rs:42`，
结构体只有 `command: Vec<String>`）是**由策略引擎根据当前命令算出来的**，
用户只是"接受/不接受"。**模型无法自己提案写规则。**

**这就是 C35（agent 改自身权限）的正解**：不是靠"禁止 agent 写配置文件"，
而是**把"写规则"从模型的能力面里彻底移走** —— 模型只能发命令，规则提案是引擎的产物。
配合 §2 的 `max()` 单调律，这条路径**双保险**。

#### 4.3 `Denied { rejection: String }` 与 `TimedOut` 分立

拒绝要**带原因回给模型**（模型能据此改做法）；超时是**独立结局**，不等于拒绝。
对照我记过的 hermes-agent「审批静默超时」bug（`run_turn_runner_approval_settle.py`），
Codex 把 `TimedOut` 提升为协议级的一等结局，**且 `GuardianAssessmentStatus` 里同样有 `TimedOut` 与 `Aborted` 分立**。

---

### 5. guardian：一个**独立的 LLM 判官 agent**

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

### 6. 工具并发：一把 `RwLock` 当全局准入闸

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

### 7. ★ 第三发现：Windows 沙箱是**两个真实的 OS 账户 + WFP**

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

#### 这条为什么是权威答案

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

### 8. 其他值得记的

#### 8.1 权限配置层**按交集合成**，不能合成则拒绝

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

#### 8.2 ★ 受保护元数据路径：C35 的具体落地

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

#### 8.3 读拒绝与写拒绝是**两套**机制

`permissions/deny_read_validator.rs`、`deny_read_resolver.rs`、`deny_read_walker.rs`、`deny_read_acl.rs`、
`deny_read_state.rs`（仅在 Windows 沙箱侧还有 `deny_read_acl.rs` / `deny_read_walker.rs`），
以及 `FileSystemAccessMode`、`ReadDenyMatcher`、`FileSystemSpecialPath`。
另有 `network_policy_decision.rs` + `network_approval.rs`（**1,254 行**）+ `network_policy.rs`。

**网络审批在 Codex 里是一个一等流程**（按主机 allow/deny + 可持久化 `NetworkPolicyAmendment`），
不是我方现在设想的"沙箱里不许联网"。

#### 8.4 提权请求被细分成 5 个类别

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

#### 8.5 规模参照

`codex-rs/` 下 **约 140 个 crate**。仅 `core/src` 就有 232,417 行 Rust（含测试）。
`core/src/session/tests.rs` 12,880 行、`config_tests.rs` 13,378 行 —— **测试比实现还多**。
另有 `code-mode`（V8 沙箱执行代码，含 `v8-poc/`）、`agent-graph-store`/`agent-roles`/`agent-identity`（多 agent）、
`memories/`、`skills/`、`hooks/`、`plugin/`、`realtime-webrtc`、`otel-trace-websocket`、`voice-host`。

---

### 9. 本轮对需求文档的净影响（Codex 部分）

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

### 10. 诚实声明：Codex 未读的部分

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


---

<!-- merged from 11-codex.md -->

## Codex 压缩与持久化精读（第六轮，用户指定"最好用"）

> 用户指定重点。范围：`core/src/compact*.rs`(3,735) + `core/src/context_manager/`(4,965)
> + **`rollout/` 整个 crate**(16,471)。
> 引用行号均已核验。

---

### 0. 一句话

**Codex 有两个彼此独立的压缩系统，我此前只意识到一个。**

| | 针对什么 | 在哪 | 手段 |
| --- | --- | --- | --- |
| **上下文压缩** | 模型的上下文窗口 | `core/src/compact*.rs` | 摘要 / 远端压缩 / 换新窗口 |
| **日志压缩** | 磁盘上的会话日志 | `rollout/src/compression.rs`(1,403) | **zstd 压冷文件** |

而上下文压缩的**真正洞见是：压缩是一个"生命周期"，不是一种"算法"** ——
四种实现共用一个生命周期，hook 可以在两端中止它，且**相位（phase）有四个**。

---

### 1. ★ 洞见一：压缩是**生命周期**，不是算法

`core/src/compact_token_budget.rs` 模块注释原文：

> Token-budget compaction **skips model/server summarization and installs a fresh context window**
> instead. **It is still modeled as compaction** so compact hooks and `ContextCompaction` turn items
> observe **the same lifecycle** as local or remote compaction.

**"即使它根本不做摘要，也要走压缩的生命周期"** —— 因为**下游观察者只认生命周期**。
生命周期（`run_compact_task_inner`）：

```
① run_pre_compact_hooks        → Continue | Stopped(→ Err(TurnAborted))
② emit TurnItem::ContextCompaction  started
③ <做实事：本地摘要 / 远端 v2 / token-budget 换窗 / 手动>
④ emit TurnItem::ContextCompaction  completed
⑤ run_post_compact_hooks       → Stopped(→ Err(TurnAborted))
```

**四种实现**（`CompactionImplementation: Responses | ResponsesCompactionV2`，
加上 token-budget 与 manual 两条不走摘要的路径）：

| 实现 | 文件 | 做什么 |
| --- | --- | --- |
| 本地摘要 | `compact.rs`(852) | 调模型生成摘要 |
| 远端压缩 v2 | `compact_remote_v2.rs`(**1,273**) | 服务端压缩，含 `compact_remote_v2_images.rs`(100) 与 `image_budget` 测试 |
| 远端历史 | `compact_remote_history.rs`(190) | — |
| **token-budget** | `compact_token_budget.rs`(84) | **不摘要，直接换一个新上下文窗口** |
| 模型降级回退 | `compact_model_fallback.rs`(59) | — |

> **对我方 F 层（P0）**：**把"压缩"定义成生命周期（有开始/结束事件、有 hook 可介入），
> 而不是一个函数。** 这样：①换实现不影响观察者 ②hook 能在压缩前后做事与中止
> ③"不摘要只换窗"这种降级路径也能复用同一套观测。

---

### 2. ★ 洞见二：压缩的分类学（6 个正交维度）

`analytics/src/facts.rs:444-487`。这是我读过的**最完整的压缩分类学**：

```rust
pub enum CompactionTrigger  { Manual, Auto }
pub enum CompactionReason   { UserRequested, ContextLimit, ModelDownshift, CompHashChanged }
pub enum CompactionImplementation { Responses, ResponsesCompactionV2 }
pub enum CompactionPhase    { StandaloneTurn, PreTurn, MidTurn, PostTurn }
pub enum CompactionStrategy { Memento, PrefixCompaction }
pub enum CompactionStatus   { Completed, Failed, Interrupted }
```

#### 2.1 ★ `CompactionPhase` 四个值 —— 正面回答 pi-desktop ADR 0030

| 值 | 含义 |
| --- | --- |
| `StandaloneTurn` | 压缩占一个独立回合（手动 `/compact` 走这条） |
| `PreTurn` | 回合开始前 |
| **`MidTurn`** | **回合进行中**（loop 内部！） |
| `PostTurn` | 回合结束后 |

我记过的 `pi-desktop/docs/adr/0030-turn-boundary-context-checkpoint-compaction.md`
原文警告："**只在用户 prompt 之间、或运行已终止之后压缩，无法保护该循环内部的下一次
provider 请求**"，并给出了 `1,077,172 tokens vs 上限 1,000,000` 的真实事故。

**Codex 的答案是把它做成一等相位 `MidTurn`** —— 不是"在回合边界顺便压一下"，
而是**承认压缩可以发生在回合内部的任意位置，并给它一个可观测的名字**。

> **这是我方 F 层现在最该采纳的一条。** 我方只写了"压缩"，没有"压缩发生在哪"。

#### 2.2 ★ `CompactionReason::ModelDownshift` 与 `CompHashChanged`

- **`ModelDownshift`** —— **换到上下文更小的模型时触发压缩**。
  这直接连到我方 J 层"运行时换模"：换模不只是切个 provider，**可能必须先压缩**，
  否则新模型装不下当前上下文。**这条我方完全没有。**
- **`CompHashChanged`** —— 压缩配置（提示词/策略）的哈希变了，于是已缓存的压缩结果失效。
  配套有 `fn comp_hash_changed(previous, current)`（`session/turn.rs:1304`）。
  **"压缩结果有指纹，指纹变了就重压"** —— 缓存失效的正确做法。

#### 2.3 `CompactionStrategy: Memento | PrefixCompaction`

两种策略：**Memento**（"纪念品"，即摘要式保留）与 **PrefixCompaction**（压缩前缀、保留近尾）。
命名值得学：**策略是具名的，而不是"我们的压缩算法"**。

#### 2.4 `CompactionStatus` 含 `Interrupted`

与 `Completed` / `Failed` 并列。**被取消的压缩是一个独立的结局**，不是失败。
（与我记过的"abort ≠ failure"一致。）

> **对我方 L 层（可观测，P1）**：压缩必须作为**结构化的度量事件**记录，
> 且六个维度都要有。缺任何一个，线上都答不出"为什么这次压缩发生了、它成功了吗"。

---

### 3. ★ 洞见三：上下文窗口是**编号的**，压缩 = 开一个新窗口

`core/src/session/mod.rs:4530` `start_new_context_window(step_context, world_state) -> u64`
返回 **`(window_number, window_ids)`**。随后：

```rust
self.replace_compacted_history(
    context_items,                                    // 重建的初始上下文
    Some(turn_context_item),
    Some(world_state),
    CompactedHistoryMetadata {
        message: String::new(),
        window_number, window_ids,
        compaction_response_id: None,
        compaction_model_hash: None,
        …
    }).await
```

**心智模型**：一个会话**不是"一串消息"**，而是**"一串编号的上下文窗口"**。
压缩不开除消息，而是**关掉当前窗口、开一个编号递增的新窗口**，并把该窗口的元数据持久化。
有测试 `start_new_context_window_persists_checkpoint_state`（`session/tests.rs:3658`）。

**这比我方"截断+摘要"的模型干净得多**：窗口是持久对象，问"当前是第几个窗口"
有确切答案，回放能定位到窗口边界。

#### 3.1 ★ 压缩后重建上下文用的是**当前** world state

```rust
let context_items = self.build_initial_context_with_world_state(step_context, world_state.as_ref())
```

**新窗口的初始上下文是从"当前 step 的 world state"重建的**，不是从压缩前那份快照。
`WorldState` 在 Codex 里是一等对象（`context/world_state.rs`），
且在 `compact_token_budget.rs` 里被显式传递（`InitialContextInjection::BeforeLastUserMessage`
/ `DoNotInject` 两种注入时机）。

> **对我方 F 层**：**压缩后重建的上下文，必须用"压缩那一刻的真实状态"重建，
> 不能用压缩前抓的快照** —— 否则新窗口一开就是过期的。

#### 3.2 ★ 客户注入的 developer 消息要**跨压缩保留**

`session/mod.rs:4536`：

```rust
let retained_client_developer_messages = if self.enabled(Feature::RetainClientDeveloperMessages) {
    let history = self.clone_history().await;
    truncate_retained_messages_for_remote_compaction(
        history.annotated_items().iter()
            .filter(|item| is_client_authored_developer_message(item)).cloned().collect(),
        RETAINED_MESSAGE_TOKEN_BUDGET)
} else { Vec::new() };
```

**客户端（调用方/插件）写进去的 developer 消息，压缩时不能被丢掉** ——
否则那些"设定"会静默消失，而模型行为变了却没人知道为什么。
且保留有**独立预算** `RETAINED_MESSAGE_TOKEN_BUDGET`。

> **对我方 F 层（P0）**：**压缩必须显式声明"哪些消息不可丢"**，
> 并给它们独立预算。我方现在没有这个概念 —— 而我们的多端/插件架构下，
> "谁注入过什么"恰恰是最容易被压缩吃掉的东西。

---

### 4. ★ 预算不是"限制"，是**要送达的事实**（`rollout_budget.rs`）

`core/src/rollout_budget.rs`(121) + `RolloutBudgetConfig`（`config/mod.rs:1283`）：

```rust
pub struct RolloutBudgetConfig {
    pub limit_tokens: i64,
    pub reminder_at_remaining_tokens: Vec<i64>,   // 多个阈值
    pub sampling_token_weight: f64,               // 输出 token 的权重
    pub prefill_token_weight: f64,                // 非缓存输入 token 的权重
}
```

#### 4.1 三件值得抄的事

**(a) token 不是同价的：输出与（非缓存）输入各有权重。**
`record_usage` 用 `output_tokens * sampling_token_weight + non_cached_input() * prefill_token_weight`。
**缓存命中与未命中被区分对待** —— 与我记过的"缓存前缀稳定性"维度对上。
（若后端直接给 `codex_rollout_budget_units` 就用它，否则本地算；
且**非有限值或负值直接 `Err(Fatal)`**，不静默修正。）

**(b) 阈值是**一组**，不是"到点就停"。**

```rust
let reminder_index = state.config.reminder_at_remaining_tokens.iter()
    .filter(|&&threshold| remaining_tokens <= threshold).count() as i64;
```

`reminder_index` = **已跨越的阈值个数**，天然单调。
于是"提醒"可以分级（剩余 50% / 20% / 5% 各提醒一次）。

**(c) ★ 送达要记账，且"写进历史之后才算送达"**

```rust
/// Last reminder delivered to each thread, so every thread observes crossed thresholds.
deliveries: HashMap<ThreadId, ThreadBudgetDelivery>,
```

```rust
/// Mark delivery only after history insertion; cancellation before then should retry it.
pub(crate) fn mark_reminder_delivered(&self, thread_id, window_id, reminder) { … }
```

**关键点**：①记到**每个线程**（一个根会话树下多个子 agent，**每个都要看到自己的阈值**）
②**取消在写历史之前发生 → 提醒会重试**（至少一次送达）
③`deliveries` 绑定 `window_id`，**换窗口后提醒重新武装**。

> **对我方 M 层（长任务）**：**预算耗尽是"要送达模型的事实"，不是"到点硬停"。**
> 我方现在只写了限额。**改成"限额 + 分级提醒 + 送达记账 + 换窗重置"** ——
> 否则长任务的失败模式是"突然被截断且无人知道为什么"。

---

### 5. 日志压缩：一个我此前完全没意识到的独立系统

`rollout/src/compression.rs`(1,403)。特性清单：

| 特性 | 实现 |
| --- | --- |
| 算法 | **zstd**，产物后缀 `.zst`（`COMPRESSED_SUFFIX`） |
| 触发 | `RolloutCompressionTrigger { Startup, Rpc }` —— 注释特意写明"**请求压缩的入口，不是 Statsig 分组**" |
| 执行 | **后台 fire-and-forget worker**：失败只记日志、**不阻塞启动**、`codex_home` 下有**运行标记**防重叠与过频 |
| 对象 | **冷文件**（`spawn_rollout_compression_worker`） |
| 阅读 | ★ **`open_rollout_line_reader` 透明处理 `.jsonl` 与 `.jsonl.zst`** |
| 竞态 | 若读取路径在**表示形态切换期间**消失，**短暂重试**（`MAX_NOT_FOUND_RETRIES = 3`，间隔 50ms），**让调用方不需要知道磁盘上是哪种表示** |
| 写入 | `persist_temp_file_noclobber`（临时文件 + noclobber 原子替换），`TEMP_SUFFIX` + `TEMP_COUNTER: AtomicU64` |
| 权限 | `create_file_with_permissions` —— 重写时**保留原文件权限** |

#### 5.1 ★ 核心设计：**日志的表示形态是实现细节**

> 调用方永远只调 `open_rollout_line_reader`，**不需要知道文件是明文还是压缩的**。

于是"压缩旧日志"这个优化**对上层完全透明**，可以独立演进而不动任何调用方。
且因为是**冷文件 + 后台 + 最好努力**，它**永远不会阻塞热路径**。

> **对我方 Q 层（会话数据运维，P1）**：**这是我方完全没有的一块，也是"事件源"架构必然的债** ——
> append-only 日志会无限增长。Codex 的答案是：
> **①冷热分离 ②后台压缩 ③表示形态对上层透明 ④原子替换保权限 ⑤有运行标记防重叠。**
> **这条我建议整条采纳**，且它不影响热路径设计（可以 P1 再上）。

---

### 6. `rollout/` crate 的其他部分（16,471 行）

```
recorder.rs (2,249)   → 写入路径
list.rs    (1,703)    → 会话枚举/排序/搜索入口
state_db.rs (744)     → 状态索引（与 JSONL 并存的查询层）
metadata.rs (491)     → 会话元数据
search.rs   (370)     → 检索
persistence_metrics.rs (439) → 持久化自身的度量
```

目录常量：`SESSIONS_SUBDIR` 与 **`ARCHIVED_SESSIONS_SUBDIR`** —— **归档是独立的一档**，
不是"删掉"。（对照 pi-desktop 的 `AUDIT_RETENTION_MS`/`TASK_RUNS_KEEP` 保留策略。）

**一个反例（值得记）**：`rollout/src/list.rs:1` 是

```rust
#![allow(warnings, clippy::all)]
```

**整个文件关掉全部告警与 clippy**，且**没有理由**。
对照我记过的 ZCode `/* eslint-disable max-lines -- 理由 */` 与 DSH
`oxlint-disable-next-line … -- 理由`：**同一个 Codex，有的地方纪律严明、有的地方整文件静音。**
这说明"纪律"是逐处的，不是逐仓的 —— **我方写规范时要防这一点**。

---

### 7. 对需求文档的净影响（本轮 Codex 压缩/持久化部分）

| 编号 | 条目 | 优先级 |
| --- | --- | --- |
| **F14** | **压缩是生命周期**（开始/结束事件 + hook 可介入/中止），不是函数；换实现不影响观察者 | **P0** |
| **F15** | **压缩有"相位"**：`StandaloneTurn / PreTurn / MidTurn / PostTurn`；**MidTurn 必须支持** | **P0** |
| **F16** | **压缩后重建上下文用"压缩那一刻"的状态，不用压缩前的快照** | **P0** |
| **F17** | **压缩必须声明"哪些消息不可丢"**（客户/插件注入的 developer 消息），给独立预算 | **P0** |
| **F18** | **上下文窗口编号化**；压缩 = 开新窗口 + 持久化窗口元数据 | P1 |
| **F19** | **换到更小上下文的模型时，必须先压缩**（`ModelDownshift`） | **P0** |
| **F20** | **压缩结果带指纹**（配置哈希），指纹变了重压 | P1 |
| **F21** | 压缩策略具名（摘要式 / 前缀式），不是"我们的算法" | P2 |
| **L8** | 压缩作为**结构化度量事件**，6 维度：trigger/reason/implementation/phase/strategy/status | P1 |
| **M10** | **预算是"要送达的事实"**：分级阈值 + 送达记账（写历史后才算送达，取消则重试）+ 换窗重置 | **P0** |
| **J24** | **输出 token 与非缓存输入 token 不同价**，预算按权重计 | P1 |
| **Q4** | **日志冷热分离 + 后台 zstd 压缩 + 表示形态对上层透明 + 原子替换保权限 + 运行标记防重叠** | **P1** |
| **Q5** | **归档是独立一档**（`ARCHIVED_SESSIONS_SUBDIR`），不是删除 | P2 |

**其中 P0 六条（F14/F15/F16/F17/F19/M10）** —— 这是继上一轮 C43–C51 之后最大的一批。

---

### 8. 诚实声明：未读

- `compact_remote_v2.rs`(1,273) 的**实现** —— 只读了文件名、行数与它在 `start_new_context_window` 里被调用的两处
- `context_manager/history.rs`(1,225) + `normalize.rs`(420) + `updates.rs`(60) —— **未读**
  （这是"历史如何规范化"的所在，本轮没碰）
- `rollout/src/recorder.rs`(2,249) 的**写入路径实现** —— 只读了头部 import
- `rollout/src/list.rs`(1,703)、`state_db.rs`(744)、`metadata.rs`(491)、`search.rs`(370) —— **未读**
- `compact.rs`(852) 的主体（只读了模块头与函数表）—— **未读**
- `SessionSummarizationPrompt` / `SUMMARIZATION_PROMPT` / `SUMMARY_PREFIX` 的实际提示词 —— **未读**
- `core/tests/suite/compact.rs`(**5,677 行测试**) —— **未读**（这是"怎么断言压缩行为"的答案所在）

**本报告是"压缩生命周期 + 分类学 + 窗口编号 + 预算送达 + 日志压缩存在性"五点。**
