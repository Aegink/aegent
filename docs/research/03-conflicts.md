# 冲突与决策

只列**真实互斥**的做法的。每条给：冲突双方、证据路径、决策、理由、以及"什么情况下该推翻这个决策"。

---

## 冲突 1：沙箱 —— 做，还是不做？

**双方**
- **不做**：Pi `SECURITY.md` 明写信任边界 = 本地用户账号，把隔离责任推给用户（容器/VM）；OpenCode `SECURITY.md` 更直白——权限系统是 **UX feature**，**不提供安全隔离**。
- **做**：Codex `codex-rs/sandboxing/` + `codex-rs/bwrap/` + `cli/src/doctor/network.rs`；DSH `packages/sandbox/{sandbox,sandbox-local}`；Qwen `packages/core/src/sandbox`（原型）。

**决策：做。而且必须在 P0。**

**理由**：Pi 和 OpenCode 的选择是**合理的但不是普适的**——它们的假设是"单用户、本地、用户自己盯着终端"。你的场景有一条它们没有的：
**Web + IM 端的请求不是发起者本人坐在终端前发出的**。IM 里一条被转发的消息、Web 上一个共享链接，都可能触发 agent 执行。
在这种拓扑下，"用户负责盯着"这个假设直接失效——没有终端可盯。

**推翻条件**：若最终确认所有入口都强制绑定已认证的单一操作者，且运行环境本身就是一次性容器，则可以降级为 P2。

---

## 冲突 2：权限默认值 —— `allow` 还是 `ask`？

**双方**
- OpenCode：`?? { action: "ask", permission, pattern: "*" }` —— 无匹配规则时**落 `ask`**。`packages/opencode/src/permission/index.ts`
- Pi：**无内置门**，全部交宿主钩子（等价于把默认值完全外置）。

**决策：抄 OpenCode，默认 `ask`。**

**理由**：默认 `allow` 意味着"规则没覆盖到的危险操作直接放行"，而规则库永远不可能穷举（新工具、新参数、shell 里任意命令）。默认 `ask` 把未知变成一次打扰，默认 `allow` 把未知变成一次事故。两者代价不对称。

**推翻条件**：高频只读工具（`read`/`glob`/`grep`）应显式配白名单避免打扰——这不推翻默认值，是给默认值加显式例外。

---

## 冲突 3：规则匹配方向 —— `findLast` 还是 `findFirst`？

**双方**
- OpenCode：`findLast(...)` —— **后出现的规则胜**（`packages/opencode/src/permission/index.ts`）
- 直觉写法通常是 `find`（首个匹配胜）。

**决策：抄 `findLast`（后者胜）。**

**理由**：`findLast` 让配置具备**覆盖能力**——用户可以先写一条宽的 `bash: *`，再写一条窄的 `bash: git status` 来收口，而不必修改前面的规则。`findFirst` 下宽规则会永久屏蔽后面所有窄规则，配置只能越写越前置，无法分层。
这与 CSS 层叠、iptables 后加规则的直觉一致。

**推翻条件**：若你希望"更具体的规则优先级更高"（specificity 式），那需要另一套匹配算法，不能靠顺序。但那会引入复杂度，且 OpenCode 的实测做法证明顺序方案够用。

---

## 冲突 4：工具描述 —— 内联在代码里，还是拆成独立文件？

**双方**
- OpenCode：**拆文件**。每个工具旁挂同名 `.txt`（`plan-enter.txt`、`plan-exit.txt`、`task.txt`…）。`packages/opencode/src/tool/`
- 其余多数仓：描述内联在工具定义中。

**决策：拆文件。**

**理由**：工具描述本质是**提示词**，会被反复调；工具实现是**代码**，改动要过 review 和测试。两者变更频率和审阅者不同。拆开后改提示词不触碰代码逻辑，diff 也干净——这正是你在意的那类"多轮修改不混乱"。

**推翻条件**：无。这是纯收益。

---

## 冲突 5：会话存储 —— JSON 文件树，还是 SQL？

**双方**
- **JSON 文件树**：OpenCode 旧实现 `storage/session/message/<sid>/<mid>.json`、`part/<sid>/<mid>/<pid>/*.json`
- **SQL**：OpenCode 新实现 `core/src/session/store.ts` 用 **drizzle ORM + `SessionMessageTable`/`SessionTable`**
- **事件源 + rollout**：Codex `daemon_recovery.rs`（flush rollout before snapshot）；Kimi `packages/transcript` 独立包

**决策：事件源为**唯一真相**，落地用 SQL（SQLite），从第一天就这样。**

**理由**：OpenCode 现在正处在 JSON→SQL 的迁移中间态，**两套并存**——`storage/` 和 `core/session/store.ts` 同时在仓里。这是一次正在发生、且尚未结束的迁移。它的成本直接可见：两套读路径、兼容代码、`sessionLegacy` 之类的包袱（Kimi 也有 `sessionLegacy`）。
从零开始的你**没有历史包袱，没有理由复制别人的迁移成本**。直接上 SQL + 事件源。

**推翻条件**：若需要人工直接编辑会话文件来调试，纯 SQL 不便。折中：保留"导出为 jsonl"的能力（学 Kimi 的 `sessionExport`），但不把 jsonl 当主存储。

---

## 冲突 6：子代理 —— 独立运行时，还是就是一个工具？

**双方**
- OpenCode：`tool/task.ts` —— **子代理即工具**，复用权限/审批/事件全套
- DSH：有独立的 `subagent-provider-lifecycle-events` 架构决策记录，且测试里出现 **"结算栅栏"（settlement fence）** 概念
- PI-Desktop：`packages/agent-runtime/src/subagent.ts` 独立模块

**决策：做成 `task` 工具（抄 OpenCode），但内部实现"结算栅栏"（学 DSH）。**

**理由**：这两者不矛盾，是**接口与实现的分工**。
接口上做成工具，子代理自动继承权限校验、审批 UI、事件流——不需要为它新开一套抽象。
实现上必须有结算栅栏：子代理产出必须**原子地**并入父会话，否则父会话可能读到写了一半的子代理结果。DSH 专门为这事留了架构记录，说明这是踩过的坑。

**推翻条件**：无。这是组合而非取舍。

---

## 冲突 7：插件边界 —— 进程内 hook，还是独立进程？

**双方**
- **进程内**：Pi `harness/hooks.ts` + `harness/skills.ts`（内核概念）
- **进程外**：PI-Desktop `apps/desktop/electron/main/plugin-websocket.ts`（插件跑在独立 websocket 进程）

**决策：双轨，按信任级分。**

**理由**：两者服务不同目的。内核 hooks/skills 是**你自己写的、可信的**扩展点，进程内最省事。第三方插件是**别人写的、不可信的**代码，进程外才有隔离。
PI-Desktop 之所以把插件放进程外，是因为它要装别人写的插件；Pi 的 hooks 面向自己扩展。照搬任何一个都会错配。

**推翻条件**：若永不支持第三方插件，砍掉进程外轨道。

---

## 冲突 8：内核语言 —— TypeScript 还是 Rust？

**双方**
- **TS**：Pi、OpenCode、DSH、Kimi、ZCode、Qwen、PiDeck
- **Rust**：Codex（`codex-rs/`）、Grok Build（`crates/`）、PI-Desktop 的 host 层（`crates/host-core/`）

**决策：内核用 TS，沙箱与 host 层用 Rust 或系统原语。**

**理由**：这不是"哪个语言更好"，是**分层**。注意 PI-Desktop 自身就是混的：TS 写 `agent-runtime`，Rust 写 `host-core`（工具和会话都在 Rust 侧）。Codex 全 Rust 是因为它要把沙箱做到 bubblewrap/Landlock 那一层——那是系统编程，TS 做不了。
内核逻辑（loop、策略、上下文管理）是**高频迭代的业务逻辑**，TS 的迭代速度优势明显，且生态（模型 SDK）主要在 TS。

**推翻条件**：若性能剖析显示事件源/投影成为瓶颈，把那部分下沉到 Rust——但那是优化，不是重写内核。

---

## 冲突 9：多端协议 —— ACP 还是自建？

**双方**
- **用 ACP**：Grok Build `crates/codegen/xai-acp-lib/`（抽成独立 crate）、Hermes `acp_adapter/`（整个目录）、Qwen `packages/cli/src/acp-integration/session`、DSH `packages/acp`
- **自建**：Pi `packages/protocol` + `client` + `server`；OpenCode `protocol/` + `sdk/`

**决策：自建内核协议，同时提供 ACP 适配层。**

**理由**：注意 Grok 和 Hermes 的做法差异——**Grok 把 ACP 抽成独立 crate，Qwen 塞进 CLI 包里**。前者是正确做法：协议归协议，别和某个端耦合。
但 ACP 本身不够——OpenCode 和 Pi 自建 protocol 是因为它们有多端（含 IM/Web）需求，ACP 是"编辑器↔agent"的协议，不覆盖 IM 推送、多人协作。
所以：内核对外是自建协议（学 Pi/OpenCode 的分层），**再套一层 ACP 适配**（学 Grok 的独立 crate 形态）给 IDE 用。

**推翻条件**：若 IDE 支持不是需求，砍掉 ACP 层。

---

## 一句话总结选型

| 层 | 主学 | 不要学的 |
| --- | --- | --- |
| Kernel/Loop | Pi（显式决策）、OpenCode（状态拆分） | — |
| Tools | OpenCode（.txt 分离）、Pi（写队列） | — |
| Policy | **OpenCode（evaluate 三点）** | Pi（它没有） |
| Sandbox | **Codex**（真实现）、DSH（可插后端） | **Pi/OpenCode 明确不做** |
| Session | Pi（fork 抽象）、Kimi（transcript）、Codex（flush 纪律） | OpenCode 的 JSON→SQL 迁移态 |
| Context | OpenCode（overflow/compaction 分离） | — |
| Planning | DSH（goal 四件套）、OpenCode（plan 提示词文件化） | — |
| Subagents | OpenCode（task 工具）+ DSH（结算栅栏） | — |
| MCP/Skills/Hooks | Pi（内核内）+ PI-Desktop（进程外） | — |
| Models | Pi/OpenCode（独立包）+ Kimi（OAuth 独立） | — |
| Surfaces | Grok（ACP 独立 crate）、PI-Desktop（远程 host） | Qwen（ACP 塞 CLI） |
| Observability | Codex（rollout-trace + reducer） | — |
| 长任务 | **DSH（goal/jobs）**、Codex（恢复）、Qwen（idle-reaper） | — |
| 多端同步 | **OpenCode（Deferred + Map 审批）** | — |
