# 内核深读：最小实现、Shell 语义、审批批次、pi-mono 分叉

> 依据用户指令："先记录文档然后继续读然后记录"。
> 本轮实读代码。所有引用本机实测，路径可复现。**证据强度分级见 §7。**

---

## 1. mini-swe-agent：**190 行**的 agent 类 —— 对 L0 最有力的校准

`oss/mini-swe-agent`，Princeton & Stanford 的 SWE-bench 团队作品。README 原文：

> We now ask: **What if our agent was 100x simpler, and still worked nearly as well?**
> **Minimal**: Just some **100 lines of python for the agent class** …
> **Performant**: Scores >74% on the SWE-bench verified benchmark
>
> 动机原文："Back then, we placed a lot of emphasis on tools and special interfaces for the agent.
> However, one year later, as LMs have become more capable, **a lot of this is not needed at all**
> to build a useful agent!"

`src/minisweagent/agents/default.py` = **190 行**（含注释与配置类）。循环本体：

```python
while True:
    try:
        self.step()                       # step() = execute_actions(query())
    except FormatError as e: ...          # 连续计数，3 次则退出
    except InterruptAgentFlow as e: ...
    except Exception as e: ...
    finally:
        self.save(self.config.output_path)   # ★ 每步无条件整份落盘
    if self.messages[-1].get("role") == "exit":
        break
```

```python
def query(self):
    # 限额检查（step / cost / wall-time）→ raise 带 exit 消息的异常
    message = self.model.query(self.messages)
    self.add_messages(message); return message

def execute_actions(self, message):
    outputs = [self.env.execute(a) for a in message.get("extra", {}).get("actions", [])]
    return self.add_messages(*self.model.format_observation_messages(...))
```

### 1.1 它靠放弃什么换来 190 行（**逐条对照我方**）

| 它放弃的 | 它靠什么成立 | 我方为什么不能照抄 |
| --- | --- | --- |
| **没有工具** —— 动作空间只有"在环境里执行这个字符串" | SWE-bench 的环境是 bash 会话 | 我们面向 Windows 本地 + 多端，工具面是产品的一部分 |
| **消息就是状态** `list[dict]`，无事件、无投影 | 无需回放/分叉/多端 | 我方 Q6 可多端、E 层事件溯源 |
| **无权限系统** | **环境是一次性容器**，隔离替代策略 | **我方环境是用户的真实机器**（Q1）—— 隔离不可用，所以必须有 C 层 |
| **无恢复**：`role:"exit"` 哨兵即终止 | 批处理，跑完即弃 | 我方要跨天恢复 |
| **每步整份 `json.dumps`** | 轨迹小 | 可作兜底纪律，但长会话不经济 |

**结论不是"删掉 150 项功能"**，而是：**loop 本体是平凡的，其余全部是产品形态逼出来的。**
这条比我在 `docs/eval-kernel-l0.md` 里的论证更扎实 ——
我原来只说"pi 的简单核心是 2,007 行"；现在有了下界证据：**200 行能跑，但代价是接受上面五条。**

### 1.2 两条值得抄的具体做法

1. **`finally: save()` 每步无条件落盘** —— 最简单的持久化纪律，在轨迹不大时**成本为零**。
   我方 E13（同步 append + write-behind + turn 末 flush）更精细，但**这提醒我们：
   如果落盘很便宜，就把"不丢"做到最粗**。
2. **代价记账跨异常边界**（`run()` 的 `FormatError` 分支）：
   > "The call was billed before parsing failed, so `query()` never got to charge it."
   —— 他们在 except 里**手工补记这次调用的费用**。**"调用已计费但解析失败"这个洞，我方 J 层（配额/限流 J18）同样有。**

### 1.3 交互版的权限只有 ~60 行

`agents/interactive.py`（209 行）是 human-in-the-loop 版：

```python
class InteractiveAgentConfig(AgentConfig):
    mode: Literal["human", "confirm", "yolo"] = "confirm"
    whitelist_actions: list[str] = []      # 匹配这些正则的动作永不确认
    confirm_exit: bool = True              # 连"要结束了"也要确认
```

- **三档模式 `human / confirm / yolo`** —— 注意 **kimi-code 也是 `'manual' | 'yolo' | 'auto'`**。
  **`yolo` 是两个独立项目共用的词**，是事实上的命名约定。
- 运行时用 `/u` `/c` `/y` 切换模式
- `_ask_confirmation_or_interrupt(commands: list[str])` —— **接收一个列表**（见 §3.1 同样思路）
- 确认逻辑本体 ~20 行

**校准**：它的权限系统 60 行；我方 C 层目前 4 项 P0 + 20 余项 P1。
**差距的来源不是"要不要做决定"，而是"决定要不要被记录、回放、解释、跨作用域配置"。**
60 行能做决定；要做到**可审计 + 可复现 + 可解释**，才是 20 项功能。

---

## 2. qwen-code `shell-semantics.ts`：**我方完全没有的"Shell 绕过"问题**

文件头注释（`oss/qwen-code/packages/core/src/permissions/shell-semantics.ts:7-15`）原文：

> Shell command semantic analysis for permission matching.
>
> Analyzes simple shell commands to extract **"virtual tool operations"** so that
> Read / Edit / Write / WebFetch / ListFiles permission rules can match their shell equivalents
> **and prevent bypass via the shell tool.**

```ts
extractShellOperations('cat /etc/passwd', '/home/user')
// → [{ virtualTool: 'read_file', filePath: '/etc/passwd' }]
extractShellOperations('curl https://example.com/api', '/home/user')
// → [{ virtualTool: 'web_fetch', domain: 'example.com' }]
extractShellOperations('echo hi > /etc/motd', '/home/user')
// → [{ virtualTool: 'write_file', filePath: '/etc/motd' }]
```

**问题本身**：你写了"禁止读 `/etc/passwd`"，模型用 Bash 跑 `cat /etc/passwd` 就绕过去了。
**我方 169 项里没有这一条** —— 我们的 C10 是"危险命令模式库"，
即在**命令字符串上做模式匹配**，正是它要取代的那种朴素做法。

### 2.1 不确定性是一等字段（**最值得抄的一条**）

`ShellOperation`（`:51`）除了 `virtualTool` / `filePath` / `domain`，还有两个字段：

```ts
/**
 * True when this operation was extracted after a dynamic `cd` whose target cannot be
 * statically resolved. Consumers that enforce protected relative paths should treat this
 * as **conservative signal, not as a concrete path**.
 */
cwdUnknown?: boolean;
/** True when `cwdUnknown` may affect the extracted file path.
 *  Absolute paths do not depend on cwd; relative redirect/path arguments do. */
pathMayDependOnCwd?: boolean;
```

**分析器不假装知道。它把不确定性作为数据吐出来，并在注释里告诉消费方"按保守处理"。**
这与 D14（不可靠兜底必须显式告警）同源，但**作用在数据层而不是告警层** —— 更彻底。

### 2.2 它把"做不到"逐条写下来（诚实声明范式）

同一段文件头注释末尾：

```
 * Known limitations (cannot be statically analysed):
 *   - Shell variable expansion: `cat $FILE`
 *   - Command substitution: `cat $(find .)`
 *   - Interpreter scripts: `python script.py`, `node x.js`
 *   - Pipe targets: `find . | xargs cat`
 *   - Complex dynamic expressions: `eval "cat $f"`
```

**这四条列举等于承认：绕过无法被完全堵死。** 因此对这几类必须退回"对 shell 工具本身提问/拒绝"。
**我方任何"用模式匹配保护路径"的设计都必须附一份等价清单**，否则是虚假的安全感。

其余实现线索（**只读了函数签名与结构，未读函数体**）：
`tokenize`（尊重引号与反斜杠）、`extractRedirects`（重定向 → 写操作）、
`resolvePath`（相对路径按 cwd 解析）、`PREFIX_COMMANDS`（`env`/`sudo`/`time` 等前缀命令）、
`extractShellOperationsAcrossCommand`（跨 `cd` 的命令）、
`MAX_SHELL_UNWRAP_DEPTH = 4`（`bash -c "…"` 递归解包的上限）、
`stripHeredocBodies` / `getHeredocDelimiters`（heredoc）。

---

## 3. hermes-agent：审批的两处工程细节

### 3.1 审批批次：**提前收集审批，但不提前执行**

`oss/hermes-agent/agent/terminal_approval_batch.py`（282 行）的模块文档原文：

> Prepare desktop terminal consent **without running shells ahead of their turn**. Workers keep
> execution middleware on its original stack. **Only command approval runs ahead**; the existing
> sequential executor releases each worker and persists its result before releasing the next.
> **No terminal environment/cwd is acquired while preparing, and the real execution still runs
> every command guard.**

**要解决的问题**：模型一次发出多条命令，逐条弹窗要用户点 N 次。
**做法**：只把**审批**提前（合并成一批给用户），**执行仍按原顺序**，且**执行时守卫再跑一遍**。

四条不变量写得很清楚，每条都是"不要越界"：
1. 只有审批提前，执行不提前
2. 并发模型不变（原栈、顺序执行器）
3. **准备阶段不获取终端环境/cwd**（那会是副作用）
4. **真实执行仍跑每一个命令守卫** —— 提前批准**不是绕过**

实现：`contextvars` + `threading.Event`(ready/release) 每槽一对；
`_CancelledPreparation` 的消息是 **"Terminal approval preparation cancelled; command was not started"**
—— 取消文案**断言了"命令未启动"这条不变量**，不只是说"取消了"。

> **对我方 C 层**：我们的审批是"每请求一个 `Deferred`"，模型发 5 个调用就是 5 次弹窗。
> **审批可批量、执行仍顺序、守卫重跑** —— 这是可直接采用的三条。

### 3.2 审批超时的静默失败 —— **一个真实事故**

`oss/hermes-agent/gateway/run_turn_runner_approval_settle.py`（81 行）文档原文：

> `_await_gateway_decision` calls `entry.settle(reason)` once the wait ends. **Only the TUI registered
> such a hook, so on Telegram / Slack / WhatsApp a card whose timer ran out kept live buttons and
> the user never learned the command did NOT run.** The turn runner registers the hook here right
> after the prompt was delivered.

**事故形态**：审批超时 → 内部按"否"结算 → **但没有任何界面告诉用户，且按钮还亮着**。

修复设计（每条都可抄）：
- `settle(reason)` 钩子**按 request_id + session_key 注册**；只处理 `reason === "timeout"`
  （answered / interrupted / notify_failed 各自有自己的反馈）
- **`_run_still_current` 守卫**：> "after /stop, /new or a restart the turn is over and this chat
  belongs to a newer run — **do not edit or post into it**"
- **卡片就地编辑**（顺带撤掉按钮）；纯文本提示传 `None` ——
  > "it has no buttons to drop and **rewriting it would erase the record of what was asked**"
- **刻意尽力而为**：> "a failed notice is logged at debug — the approval already resolved as
  'no', and **nothing here may block the agent thread**"
- 展示给人看的命令是 **already-redacted**（脱敏在展示之前完成）

> **对我方 N 层（Q3 = 飞书）**：这正是我们要踩的坑。**审批结果必须在每一个能显示它的界面主动宣告；
> 超时静默结算是 bug。** 另两条：迟到通知必须检查"这一轮还是当前轮吗"；改写会抹掉"问过什么"的记录。

### 3.3 插件兼容的日落机制（`COMPAT_MANIFEST.md`）

hermes-agent 的 `COMPAT_MANIFEST.md` 是一份**完整的插件弃用生命周期**：
模块拆分的 PR 之后，旧导入路径通过 `PLUGIN-COMPAT` 块**仍然可导入**，但：

| 阶段 | 用户看到的 | 插件 |
| --- | --- | --- |
| 截止日前 | 黄色提示（点名插件、日期） | 加载，每次旧路径解析发一次警告 |
| **截止日 2026-09-14 起** | 红色提示，插件 **DISABLED** | **不加载**，`hermes plugins list` 给原因 |
| 回滚落地后 | 同上 | 不加载（旧路径已不存在） |

配套四条设计：
1. **有日期，且日期由代码强制** —— 不是"已弃用"这种无限期说法
2. **仓内自己禁止使用这些指针**：`scripts/check_compat_pointers.py` **CI 失败**
   —— 逃生舱不许变成承重墙
3. **用户逃生舱**：`plugins.allow_deprecated_imports: true`
4. **工具化**：`hermes plugins compat <path>` 打印每条 `file:line` 旧→新路径，**有残留则退出码 1**

> **对我方 I 层 / C17**：这回答了"怎么退役一个扩展 API 而不一次性打断所有人"。
> 尤其第 2 条：**我们自己要能不用那个口子**，否则它就是永久的。

---

## 4. pi-mono：**"给 pi 内核加扩展"这件事已经有人做过了**

`oss/pi-mono/VISION.md` 原文：

> A public-friendly **fork of `earendil-works/pi-mono`** (the Pi coding agent) … The fork ships a
> small set of platform capabilities **Pi does not have upstream yet** (a **hooks/filters extension
> layer**, **prompt-cache splitting**, an **agent/sub-agent subsystem**, **deferred tool loading**,
> and **Claude-Code-parity tool surfaces**) while **staying close enough to upstream that it keeps
> rebasing cleanly.**

**这正是我方的计划**：以 pi 内核为底，加上我们自己要的那几样。
**它比我们早走了几步，而且把"怎么跟上上游"这件事的答案也留下了**（`FORK-CHANGELOG.md` 逐次记录
"integrated exact upstream Pi 0.87.0 (`95fbc0499`)" 这类语义合并）。

### 4.1 `deferred tool loading` 有独立实现

`packages/agent/src/harness/runtime/drive/deferred.ts`。
**这是 `ToolDeferral` 的第二次独立确认**（第一次是 Claude Code，见
`docs/research/06-claude-code-official.md` §7.3）。**F12 建议由此从"一个仓的做法"升为"两个独立实现的共识"。**

### 4.2 一个我方**完全没有的维度：提示词缓存前缀稳定性**

`FORK-CHANGELOG.md` 里大量条目在解决同一类问题 —— **中途改动会打碎已缓存的提示词前缀**，
且**每条都带实测数字**：

| 问题 | 做法 | 实测证据（原文） |
| --- | --- | --- |
| 中途改推理档会作废缓存 | 请求级 `reasoning.effort` **钉在首个重放的 assistant turn**，后续变更作为**位置性的 `configuration_update` 输入项**（折叠到不相邻、活动档不同才补末尾） | "**7680 cache-read tokens** on the switched step vs **0** with request-level effort" |
| 中途增删工具会作废缓存 | **首次请求就声明 deferral 脚手架**，使后续 `tool_addition`/`tool_removal` 不破坏前缀 | — |
| 压缩会把整个上下文冷写一遍 | **cache-safe 路径重放主循环刚缓存过的活前缀**，用 `cacheRetention:"long"` + 实时路由 id | "measured **134,988-token / $1.35 write on a 131k context**" |
| 缓存健康误判 | Anthropic 会在新非工具结果的 user 消息到达时剥掉自上个 user 边界以来的 thinking 块，故热前缀恰在**上个边界之后的首个 assistant turn** 断裂；`computeCacheHealth` 把落在此边界前缀 256 token 内的读取归为 `thinking_strip_likely` | "read 90,113 = 27,269+62,844; read 101,639 = 90,113+11,526" |

**我方 §6 效率要求有五项可测指标，但没有一项是"缓存前缀稳定性"。**
Q8 说"所有生产开销都要高效" —— **这正落在其中，而且是真金白银**（单次事故 $1.35 的冷写）。
**建议新增一整组要求（见 §6）。**

---

## 5. 其余两个仓的判定

| 仓 | 判定 | 依据 |
| --- | --- | --- |
| **mini-agent**（21,039 行） | **低优先**。MiniMax M2.5 的**演示项目**（"minimal yet professional demo project"），核心 `agent.py` + `llm/{anthropic,openai}_client` + `retry.py` + `acp/server.py` + `skills/document-skills/`（docx/pptx 处理技能）。结构清晰，但**是 API 用法的示范，不是新机制的来源**。若要读，值钱的是 `skills/document-skills/` 那套**技能即脚本包**的组织方式。 | 读了 README 与文件清单，**未读实现** |
| **agentscope**（27M，Alibaba） | **本轮未读**。只看了 README 头部（多智能体框架）。**给不出判定** —— 不作结论优于编一个。 | 仅 README 头部 |

---

## 6. 建议新增（**未写入需求文档，待你确认**）

### 6.1 新维度：提示词缓存稳定性（来自 pi-mono 实测）

| 建议 ID | 内容 | 优先级 |
| --- | --- | --- |
| **F13** | **中途改动（模型/推理档/工具集）不得作废已缓存前缀**：变更以"位置性追加"表达，而非改写既有请求 | **P1** |
| **F14** | **延迟加载的工具脚手架在首次请求即声明**，使后续工具增减不破坏前缀 | P1 |
| **F15** | **压缩走 cache-safe 路径**（重放活前缀），不得冷写整个上下文 | P1 |
| **F16** | **缓存健康可诊断**：能区分"前缀漂移"与"thinking 被剥离"，并记录读/写 token 数 | P2 |

### 6.2 其余建议

| 建议 ID | 内容 | 依据 | 优先级 |
| --- | --- | --- | --- |
| **C27** | **Shell 语义分析**：把 shell 命令翻译成"虚拟工具操作"，使 Read/Write/WebFetch 规则能管住 shell 等价物 —— **堵住"用 Bash 绕过文件规则"** | qwen-code `shell-semantics.ts` | **P0** |
| **C28** | **分析结果携带不确定性字段**（`cwdUnknown` / `pathMayDependOnCwd`），消费方按保守处理 | 同上 | **P0** |
| **C29** | **任何"用模式匹配做保护"的设计必须附"静态分析做不到"的清单** | 同上 | **P0** |
| **C30** | **审批可批量**：审批提前收集、**执行仍按原顺序**、**执行时守卫重跑** | hermes-agent `terminal_approval_batch.py` | P1 |
| **C31** | **审批结果必须在每个能显示它的界面主动宣告**；超时静默结算是 bug；迟到通知须检查"这一轮是否仍是当前轮" | hermes-agent `approval_settle`（真实事故） | **P0** |
| **J21** | **调用已计费但解析失败时，代价仍要记账** | mini-swe-agent `run()` 的 `FormatError` 分支 | P1 |
| **I?** | **扩展 API 的日落机制**：带日期的弃用、分级 UX、配置逃生舱、CI 禁止仓内自用、作者自查工具 | hermes-agent `COMPAT_MANIFEST.md` | P1 |

---

## 7. 诚实声明（**证据强度分级**）

| 级别 | 内容 |
| --- | --- |
| **整文件读完** | mini-swe-agent `agents/default.py`(190)、`agents/interactive.py` 的配置与函数清单、hermes-agent `gateway/run_turn_runner_approval_settle.py`(81)、pi-mono `VISION.md`、hermes-agent `COMPAT_MANIFEST.md` |
| **读了文档注释与类型/签名，未读函数体** | qwen-code `shell-semantics.ts`（只读了文件头注释、`ShellOperation`、函数清单 —— **2,365 行的实现基本未读**）、hermes-agent `terminal_approval_batch.py`（读了模块文档与前 45 行） |
| **只读了文件清单与行数** | mini-agent（21,039 行）、qwen-code `classifier.ts` 与 `classifier-prompts/` |
| **只读了 README 头部** | **agentscope —— 本轮未读，不给判定** |
| **读了变更日志** | pi-mono `FORK-CHANGELOG.md`（**变更日志不是实现**：条目所述机制我**未读其代码**，数字为原文引用） |
| **仍未读** | agentscope 全部；mini-agent 实现；qwen-code `permission-manager.ts`(1,687) / `classifier.ts` / `rule-parser.ts`(1,803)；hermes-agent 7,000+ 个 .py 中的绝大多数；grok-build 3,408 个 .rs；kimi-code 的 `permissionMode`/`toolApproval`；pi-mono 全部实现 |

> **本轮最大收获**：mini-swe-agent 给了 L0 的**下界**（200 行能跑，代价是五条放弃）；
> qwen-code 的 shell 语义揭露了**我方设计里的一个真实漏洞**（用 Bash 绕过文件规则）；
> pi-mono 揭示了**缓存前缀稳定性**这个我方完全没有的维度。
>
> **最大缺口**：agentscope 未读；qwen-code 与 hermes-agent 的实现仍有大半未读。
