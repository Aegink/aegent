# 自研模块映射

> 左列是要创建的我方模块（**不是上游文件**），中列是上游优点出处，右列是优先级。
> 接口草稿用伪 TS，只为固定形状，不追求可直接编译。

## P0 定义

**P0 = 最小闭环**：一个进程内能跑完"用户发话 → 模型回话 → 调工具（过策略）→ 结果回灌 → 落盘 → 可恢复"。
P0 不包含：Web/IM 端、子代理、goal、插件进程外隔离、ACP。
**P0 跑通前不写任何 UI。**

---

## P0 模块清单

| # | 我方模块 | 上游优点出处 | 优先级 |
| --- | --- | --- | --- |
| 1 | `src/kernel/events.ts` | Pi `AgentEvent` 联合体形状 | **P0** |
| 2 | `src/kernel/loop.ts` | Pi `AgentTurnDecision` 显式停止 | **P0** |
| 3 | `src/kernel/run-state.ts` | OpenCode `session/run-state.ts` 独立运行态 | **P0** |
| 4 | `src/kernel/tools/registry.ts` | OpenCode 插件可注册工具 | **P0** |
| 5 | `src/kernel/tools/descriptions/*.txt` | OpenCode 描述与代码分离 | **P0** |
| 6 | `src/kernel/tools/builtin/{read,write,edit,bash,glob,grep}.ts` | Pi 最小集 | **P0** |
| 7 | `src/kernel/tools/write-queue.ts` | Pi `file-mutation-queue` | **P0** |
| 8 | `src/policy/evaluate.ts` | OpenCode `findLast` + 默认 ask | **P0** |
| 9 | `src/policy/pending.ts` | OpenCode `Deferred` + `pending: Map` | **P0** |
| 10 | `src/session/store.ts` | 事件源 + SQL（**不抄 OpenCode 的 JSON 迁移态**） | **P0** |
| 11 | `src/session/events.ts` | 事件追加写（学 Pi `commit.ts`） | **P0** |
| 12 | `src/session/project.ts` | OpenCode `projector.ts` / Codex `rollout-trace/reducer` | **P0** |
| 13 | `src/sandbox/process.ts` | Codex `codex-rs/sandboxing/` | **P0** |
| 14 | `src/sandbox/network.ts` | Codex `cli/src/doctor/network.rs` 网络策略独立 | **P0** |
| 15 | `src/context/overflow.ts` | OpenCode `session/overflow.ts` | **P0** |
| 16 | `src/context/compaction.ts` | OpenCode `session/compaction.ts` | **P0** |
| 17 | `src/models/provider.ts` | Pi `packages/ai` 独立包 | **P0** |

**P0 闭环 = 1–17。** 17 个文件，其中 6 个工具可先只实现 `read`/`bash`/`write` 三个。

---

## P1 模块（P0 跑通后）

| # | 我方模块 | 上游优点出处 | 优先级 |
| --- | --- | --- | --- |
| 18 | `src/session/fork.ts` | Pi `ForkCurrentStatePlan`（**一套抽象支持分支+树**） | P1 |
| 19 | `src/session/transcript.ts` | Kimi `packages/transcript` 独立包 | P1 |
| 20 | `src/session/export.ts` | Kimi `sessionExport` / `sessionIndex` 三分 | P1 |
| 21 | `src/plan/mode.ts` + `src/plan/*.txt` | OpenCode `plan-enter.txt`/`plan-exit.txt` | P1 |
| 22 | `src/subagent/task-tool.ts` | OpenCode `tool/task.ts` | P1 |
| 23 | `src/subagent/settlement.ts` | DSH "结算栅栏" | P1 |
| 24 | `src/longtask/goal.ts` | DSH `packages/goal/goal` | P1 |
| 25 | `src/longtask/goal-round.ts` | DSH `goal-round-driver` 跨轮驱动 | P1 |
| 26 | `src/longtask/jobs.ts` | DSH `packages/jobs/jobs-local` | P1 |
| 27 | `src/kernel/hooks.ts` | Pi `harness/hooks.ts` | P1 |
| 28 | `src/kernel/skills.ts` | Pi `harness/skills.ts` | P1 |
| 29 | `src/obs/trace.ts` | Codex `rollout-trace` + reducer | P1 |
| 30 | `src/surfaces/acp/` | Grok `xai-acp-lib`（**独立 crate 形态**） | P1 |
| 31 | `src/surfaces/server/` | Pi `packages/server` + `protocol` | P1 |
| 32 | `src/policy/presets.ts` | DSH `interaction/permission-presets` | P1 |

---

## P2 模块

| # | 我方模块 | 上游优点出处 | 优先级 |
| --- | --- | --- | --- |
| 33 | `src/surfaces/web/` | PI-Desktop `electron/main/bootstrap/remote-hosts.ts` | P2 |
| 34 | `src/surfaces/im/feishu.ts` | PiDeck `src/main/feishu/FeishuBridge.ts` | P2 |
| 35 | `src/surfaces/im/slack.ts` | OpenCode `packages/slack/` | P2 |
| 36 | `src/plugin/host-ws.ts` | PI-Desktop `plugin-websocket.ts`（进程外插件） | P2 |
| 37 | `src/plugin/sdk.ts` | OpenCode `@opencode-ai/plugin` + PI-Desktop `plugin-sdk` | P2 |
| 38 | `src/models/oauth.ts` | Kimi `packages/oauth` | P2 |
| 39 | `src/longtask/reaper.ts` | Qwen `docs/design/session-idle-reaper.md` | P2 |
| 40 | `src/longtask/recover.ts` | Codex `daemon_recovery.rs` flush 纪律 | P2 |

---

## 接口草稿（P0 关键形状）

### 1. 事件（`src/kernel/events.ts`）

选自 Pi 的 `AgentEvent`，**去掉产品相关项，只留内核必需**：

```ts
export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; delta: AssistantDelta }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; partial: unknown }
  | { type: "tool_execution_end"; toolCallId: string; result: unknown; isError: boolean };
```

**要点**：`turn` 与 `agent` 两级生命周期分开（一个 turn = 一次 assistant 回复 + 其引发的工具调用）。
事件必须**可持久化**——它就是 session 的真相来源。

### 2. 停止条件（`src/kernel/loop.ts`）

```ts
export type TurnDecision = { action: "continue" } | { action: "end" };

export interface TurnContext {
  readonly turnIndex: number;
  readonly messages: readonly AgentMessage[];
  readonly lastToolResults: readonly ToolResultMessage[];
}

// 停止条件是显式决策，不是"没有 toolCall 就停"的隐式约定
export type DecideTurn = (ctx: TurnContext) => TurnDecision | Promise<TurnDecision>;
```

**为什么显式**：隐式约定无法表达"模型没调工具但我要再问一轮"，也无法单测。
`DecideTurn` 是纯函数，可以单独断言。

### 3. 权限求值（`src/policy/evaluate.ts`）

这是从 OpenCode 抄的**三点合一**，是本报告最高价值的可直接复用形状：

```ts
export type Action = "allow" | "ask" | "deny";

export interface Rule {
  permission: string;   // 维度一：工具名，如 "bash"
  pattern: string;      // 维度二：参数 glob，如 "git *"
  action: Action;
}

export function evaluate(
  permission: string,
  pattern: string,
  ...rulesets: readonly Rule[][]
): Rule {
  return (
    rulesets.flat().findLast(
      (r) => match(permission, r.permission) && match(pattern, r.pattern),
    ) ?? { action: "ask", permission, pattern: "*" }   // 默认 ask，不是 allow
  );
}
```

三个不可动的点：
1. **`findLast`** —— 后写的规则覆盖先写的，配置可分层
2. **默认 `ask`** —— 未覆盖的危险操作落一次打扰，而非一次事故
3. **双维度** —— `permission` 与 `pattern` 都要通配，否则无法表达"只允许 `git status`"

### 4. 待审批（`src/policy/pending.ts`）

```ts
type PendingEntry = {
  request: PermissionRequest;
  deferred: Deferred<Decision, RejectedError>;   // 关键：异步挂起
};

// 发起端 await 这个 deferred；任意端调用 reply 唤醒它
export interface Policy {
  ask(req: PermissionRequest): Promise<Decision>;
  reply(id: string, decision: Decision): void;
  list(): readonly PermissionRequest[];
}
```

**这是"N 层：审批如何回到同一运行时"的答案**，直接来自 OpenCode：
发起端 suspend 在一个 `Deferred` 上，审批请求进 `pending: Map`；
**任意端**（TUI / Web / IM）调 `reply` 唤醒它。
不需要自创跨端协议——`Map` + `Deferred` 就是全部所需。

### 5. 工具（`src/kernel/tools/registry.ts`）

```ts
export interface Tool<Params> {
  name: string;
  descriptionFile: string;          // 指向 descriptions/<name>.txt，不内联
  schema: Params;
  execute(args: Params, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  toolCallId: string;
  signal: AbortSignal;
  sandbox: Sandbox;                 // 工具不自己 spawn 进程，一律走沙箱
  policy: Policy;
  emit(event: AgentEvent): void;
  onUpdate(partial: unknown): void; // 流式进度
}
```

**要点**：`execute` 拿不到裸 `child_process`——要起进程必须经 `ctx.sandbox`。
这条约束让沙箱无法被工具绕过，是 P0 就必须定死的不变量。

### 6. 沙箱（`src/sandbox/process.ts`）

```ts
export interface Sandbox {
  exec(cmd: string, opts: {
    cwd: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  }): Promise<{ code: number; stdout: string; stderr: string }>;

  // 网络策略与进程策略分开——学 Codex 把 network 独立成医生模块
  network: NetworkPolicy;
}
```

**要点**：`network` 独立于进程隔离。Codex 单独做 `doctor/network.rs` 说明网络是独立维度，
不是"沙箱开了就都管了"。

### 7. 事件追加（`src/session/events.ts`）

```ts
export interface SessionStore {
  append(sessionId: string, events: readonly AgentEvent[]): Promise<void>;
  load(sessionId: string): Promise<readonly AgentEvent[]>;
  // 投影：从事件流重放得出当前消息列表
  project(sessionId: string): Promise<readonly AgentMessage[]>;
}
```

**纪律（来自 Codex `daemon_recovery.rs`）**：**快照前必须先 flush 事件**，
否则崩溃恢复时会得到一个"快照说做了、事件流说没做"的不一致状态。

---

## 不变量（P0 就要定死，后面改代价极大）

1. **事件是唯一真相**，状态是事件的投影。任何"直接改状态不写事件"的路径都是 bug。
2. **工具不能绕过沙箱**——`ToolContext` 不暴露裸进程 API。
3. **权限默认 `ask`**，白名单是显式例外。
4. **停止条件是显式决策**，不是隐式约定。
5. **快照前必须 flush 事件**。
