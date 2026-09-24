# ZCode agent 主循环精读（zai-org/ZCode，Apache-2.0，`872ad96`）

> 上一轮 `10-zcode.md` 只做了结构认知，我自己在 §8 写明"**agent 主循环与权限实现仍未读**"。
> 本轮补上。范围：`apps/zcode-cli/packages/core/src/` 与 `contracts/src/`。
> 引用行号均已核验。

---

## 0. 一句话

**ZCode 是我读过的唯一一个有"显式、带守卫、非法转移抛错"的回合状态机的仓。**
它的状态机是**记账层**而非执行层 —— 执行在 `runtime/methods/` 里，状态机同步镜像。
事件词汇表 **79 个**（我方 L0 是 13 个），其中有**一整个 `StreamRecovery*` 家族是我方完全没有的**。

---

## 1. ★ turn 状态机：10 个相位、守卫、非法转移抛错

`core/src/agent/turn-state.ts:26-36` 定义 10 个相位：

```
idle → processing_input → awaiting_model_response → streaming
     → scheduling_tools → [awaiting_permission] → executing_tools
     → aggregating_results → completing | error
```

转移表在 `turn-state.ts:230-260` `canTransitionTo()`，是**显式白名单**而非"允许一切"：

```ts
[TurnPhase.AwaitingPermission]: [TurnPhase.ExecutingTools, TurnPhase.Error],
[TurnPhase.Completing]:         [TurnPhase.Idle],
[TurnPhase.Error]:              [TurnPhase.Idle],
```

实现 `core/src/agent/turn-machine.ts:89` `transition()` **非法转移直接抛**：

```ts
if (!canTransitionTo(this.state.phase, phase)) {
  throw createCoreError(CoreErrorType.InvalidTurnPhase,
    `Cannot transition from ${this.state.phase} to ${phase}`,
    { context: { current: this.state.phase, target: phase }, recoverable: true });
}
```

> **对照**：我读过的其他仓（含我方现设计）都是**隐式**生命周期 —— 相位由代码路径体现，
> 状态错了没有任何东西会报。ZCode 把相位显式化，于是"不可能的状态"变成**启动即炸的断言**。
> `docs/review-prompt.md` §三C 要求补的"各仓 loop 的真实状态机"，这是**唯一一个真有的**。

状态机是**不可变状态 + 纯函数**：每次调用返回新 `TurnState`，调用方用
`state.turnMachine = new TurnMachineImpl(state.turnMachine.xxx())` 整体替换。

### 1.1 一个"今天不可达、但留给后来人的陷阱"（诚实标注：**我未能证明可达**）

`turn-machine.ts:166` `startToolExecution()` 把**所有非 `waiting_permission` 的工具**标成 `running`：

```ts
status: tc.status === "waiting_permission" ? tc.status : "running",
startedAt: tc.status !== "waiting_permission" ? new Date() : tc.startedAt,
```

若一个工具已是 `permission_denied`，再次调用会把它**复活成 `running`**。
转移表也允许 `AwaitingPermission → ExecutingTools`，所以状态机层面**这条路是通的**。

**但我查了全仓调用点：`startToolExecution` 只在 `runtime/methods/turn-tools.ts:153` 被调用一次，
位置在 `scheduleTools` 之后、任何权限请求之前** —— 因此**当前不可达**。
我把它写下来是因为：这是一个**状态机允许、而语义不该允许**的组合，
下一个改动循环的人很容易踩到。**这是"看起来对但实际有坑"的一例**（review-prompt 第六节第 4 问）。

---

## 2. ★ 审批可以"改参数后再批准"

`turn-machine.ts:251` `resolvePermission(toolCallId, decision, modifiedInput?)`：
被批准的工具，其 `input` 会被 `modifiedInput` **整体替换**（`input: modifiedInput ?? tc.input`）。
`core/src/runtime/methods/tools.ts:274` 的真实链路里，`PermissionBrokerResult` 携带四个字段：

```ts
{ decision: "allow" | "deny", reason?, modifiedInput?, permissionUpdates?, resolvedAt }
```

**`permissionUpdates`** —— 一次审批决定**可以携带对权限配置的更新**。

> **对照 Codex**：Codex 的做法是"引擎算出规则提案，用户接受"（模型不能提案）。
> ZCode 的做法是"审批结果本身携带 `permissionUpdates`"。
> **两者都能达成"改权限"，但 Codex 的多一道结构约束**（提案不由模型产生）。
> 我方若采用 ZCode 式，则必须回答"`permissionUpdates` 由谁填、能否由模型填"——**这正是 C35 的那个缺口**。
> **我的建议仍是 Codex 式**（提案由引擎算），ZCode 式的 `modifiedInput` 则值得单独采纳。

**`modifiedInput` 这一条本身很值钱**：用户不必在"按原样执行"和"拒绝"之间二选一，
可以"改成这样再执行"。我读过的其他仓**都没有**这个能力。

---

## 3. 循环续跑策略：工具失败**结束**本回合（有代价的取舍）

`turn-machine.ts:301` `getNextPhase()` 原文逻辑：

```ts
if (phase === Phase.AggregatingResults) {
  const failedTools = toolCalls.filter(
    (tc) => tc.status === "failed" || tc.status === "permission_denied");
  if (failedTools.length > 0)  return Phase.Completing;      // 有失败 → 收口
  return Phase.AwaitingModelResponse;                        // 全成功 → 回模型再转一圈
}
```

**即：工具失败会把整个回合收口，模型没有机会在同一回合内看到错误并重试。**

`failed` 与 `permission_denied` 被同等对待，但二者的正确处置**不同**：
- `permission_denied` → 收口合理（模型不该重试，用户已说不）
- `failed`（瞬时错误、参数写错、文件暂时锁住）→ **收口会让一个可自愈的失败变成用户可见的中断**

对照：pi-desktop ADR 0207 专门给了 **3 次** 编辑重试预算，理由是
"第一次失败暴露语法/范围修正，第二次可能仍在应用那个修正"。
**ZCode 这条策略与之相反。** 我方 F/B 层的重试预算**不要照抄 ZCode**。

> 标注清楚：这是**读代码得到的推论**，我没有读 ZCode 的设计文档来确认这是有意取舍还是简化。

---

## 4. ★ 事件词汇表 79 个，其中 `StreamRecovery*` 是我方完全空白的维度

`contracts/src/events/session.events.ts:83-174`，`SessionEventType` 共 **79 个事件**（脚本计数）。
按家族分：

| 家族 | 个数 | 备注 |
| --- | --- | --- |
| `Session*` | 7 | created/resumed/forked/compacted/title_updated/mode_changed/ended |
| `Turn*` | 6 | started/input_received/complete/error + steer 系列 |
| **`TurnSteer*`** | **7** | queued / delivery_changed / dispatch_changed / drained / rejected / discarded / reordered |
| **`StreamRecovery*`** | **6** | anchor_created / started / anchor_selected / tail_discarded / retry_started / blocked |
| `Model*` | 8 | request/selected/streaming/complete/error/network_status/anomaly_warning + `StreamingToolLedgerUpdated` |
| `Tool*` | 6 | scheduled/started/progress/result/error/batch_complete |
| `Permission*` | 3 | requested/resolved/denied |
| **`WorkspaceHookReview*`** | **4** | requested / settled / **superseded** / admission_updated |
| `HookRun*` | 5 | started/progress/completed/failed/blocked |
| `Compact*` | 4 | started/completed/failed + **boundary**；另有 **`MicrocompactBoundary`** |
| `Subagent*` | 3 | spawned/message/stopped |
| `BackgroundTask*` | 3 | started/updated/completed |
| 其他 | ~15 | rewind_triggered / checkpoint_created / target_changed / target_completion_verification / interrupt / cancel / resume / error … |

### 4.1 ★ `StreamRecovery*`（6 个）—— 我方 F/J 层的空白

**模型流在响应中途断掉怎么办？** 我方需求文档里**没有这一项**。
ZCode 把它做成了一个**持久化的、多步可观测的过程**：

```
StreamRecoveryAnchorCreated   → 建锚点
StreamRecoveryStarted         → 开始恢复
StreamRecoveryAnchorSelected  → 选中了哪个锚点
StreamRecoveryTailDiscarded   → 丢弃了哪些尾部
StreamRecoveryRetryStarted    → 重试
StreamRecoveryBlocked         → 恢复不了（终态）
```

配套 `StreamRecoveryAnchorCreated` 说明**锚点是先于故障就记下的**（不是事后补）。
`StreamRecoveryBlocked` 是一个**独立的终态**，不是"重试到底"。

> **建议（新增 F 层条目，P1）**：模型流中断的恢复必须是**有锚点、有界、可观测、有终态**的过程：
> ①锚点在流开始时即持久化；②明确"丢弃到哪个锚点"；③重试有界；
> ④恢复不了要有**显式终态**（`blocked`），不是无限重试也不是静默失败。
> **这条同时影响 J 层（重试）与 L 层（可观测）。**

### 4.2 ★ `TurnSteer*`（7 个）—— 我读到的最成熟的 steer 模型

对照 DSH 的结论（`2026-07-30-followup-enqueue-and-owned-runs.md` "`MessageId` 能证明入队，
但无法标识哪条 assistant 消息是它的结果"）—— ZCode 走得更远，
把 steer 的**每一步状态变化都变成事件**，且注释明确要求**投影不得本地猜测**：

> `// sendQueuedNow 原子提升：reservation/promoting/rollback 均进入事件流，投影不本地猜测。`
> `// guide 未遇到可用 tool batch 即收口时，原 intent 原地改投普通 queue。`

`TurnSteerReordered` 对应 `// v4 queue 重排：queue 项顺序变化（reducer 按 orderedPendingInputIds 重排 queue rows）`。

**"原子提升的三个中间态（reservation / promoting / rollback）都进事件流"** 是一条很强的纪律：
**投影层永远不需要推断，只需要折叠事件。** 我方 E/N 层可直接采用。

### 4.3 `WorkspaceHookReviewSuperseded` —— hook 决定可以被推翻

`WorkspaceHookReview*` 四个事件里，`Superseded` 值得单独记：
**一次 hook 复核的结论可以被后来的事件取代，且这个"取代"本身是持久事实。**
配套 `WorkspaceHookAdmissionUpdated`（准入状态变更）。
我方 I 层（扩展/hook）现在只有"问/答"，**没有"已答的可以作废"**。

### 4.4 两级压缩边界都是事件

`CompactBoundary` 与 **`MicrocompactBoundary`** 并存 —— **微压缩与整压缩各有自己的边界事件**。
`core/src/compact/` 下有 `manual.ts` / `microcompact.ts` / `policy.ts` / `prompt.ts` / `rounds.ts`。
**压缩不是一件事，是两件（或更多）。** 我方 F 层现在只写了一个"压缩"。

---

## 5. 权限 broker：端口 + 默认拒绝 + 超时是带类型的失败

`core/src/permission/broker.ts`。

1. **`PermissionBrokerPort` 是端口（六边形架构）** —— core 依赖接口，各 surface（CLI/桌面/浏览器）各实现。
   与我方 N 层"owner + 租约 + 闭集命令"是同一个方向。

2. **默认实现是 `DenyPermissionBroker`**（`broker.ts:26`），
   工厂函数 `createDenyPermissionBroker()` 明示这是默认：

   > `reason: \`No permission client configured for ${request.toolName}\``

   **没配权限客户端 = 拒绝。** fail-closed 的正确默认。

3. **★ 超时是 `reject`，带类型，不是静默 `resolve`**（`broker.ts:110-125`）：

   ```ts
   timeout = setTimeout(() => {
     fail(createCoreError(CoreErrorType.PermissionTimeout,
       `Permission request timed out after ${options.timeoutMs}ms`,
       { context: {...}, recoverable: true }));
   }, options.timeoutMs);
   ```

   且 **abort → `ToolCancelled`**，与超时**分开**。

   > **这正是 hermes-agent 那个 bug 的正解。** 我在 `08-kernel-deep-read.md` 记过
   > `hermes-agent/gateway/run_turn_runner_approval_settle.py` 的静默超时（审批超时后
   > 无声地把结果当默认值）。ZCode 与 Codex 都是**显式带类型地失败**。**两个独立实现给出同一答案，
   > 这条应当进我方 C 层的硬要求。**

4. `ManualPermissionBroker` 用 `settled` 标志防重复结算，`cleanup()` 同时清 timer 与 listener
   （不泄漏）；`resolvePermission` **按 requestId 或 toolCallId 都能查**（容错查找）；
   重复 requestId 直接 `reject`（`InvalidStateTransition`）。

---

## 6. 重要限定：turn-machine 是**记账层**，不是执行层

`startToolExecution` 全仓只被调用一次（`runtime/methods/turn-tools.ts:153`），
`resolvePermission` 的真实实现在 `runtime/methods/tools.ts:274`（走 broker），
而不是 `turn-machine.ts:251`。

**真实执行流程住在 `core/src/runtime/methods/` 里** ——
`turn-tools.ts`、`tools.ts`、`internal-turn-methods.ts`、`agent-runtime.ts`(584 行接口) 等。
这一层才是那 77,980 行的主体。**我本轮读的是它的状态镜像，不是它的主体。**

所以严格说：**我现在能描述 ZCode 回合的"合法相位序列"，但还不能描述它的"实际控制流"。**
两者在正常情况下应当一致，但我**没有验证**这一点。

---

## 7. 本轮对需求文档的净影响（ZCode agent loop 部分）

| 层 | 建议 | 优先级 |
| --- | --- | --- |
| A | **区间状态机显式化**：相位枚举 + 转移白名单 + 非法转移抛错 | **P1** |
| C | **审批支持 `modifiedInput`**（改成这样再执行） | **P1** |
| C | **审批超时/取消必须带类型地失败**，禁止静默默认（与 Codex 独立同证） | **P0** |
| C | **默认权限实现是拒绝**（没配客户端 = deny） | **P0** |
| E | **事件家族化**：79 个事件的规模参照；我方 L0 是 13 个并且应当保持小 | 参照 |
| E/L | **原子操作的中间态（reservation/promoting/rollback）也要进事件流**，投影不猜 | **P1** |
| F | **新增：模型流中断恢复**（锚点/有界重试/显式终态 `blocked`） | **P1** |
| F | **压缩分两级**（microcompact 与 compact 各有边界事件） | **P2** |
| I | **hook 复核结论可被 `superseded`**，且取代本身是持久事实 | P2 |
| N | **权限走端口（Port）**，各 surface 独立实现 | P1 |
| B | **不要照抄 ZCode 的"工具失败即收口"**（与 pi-desktop 3 次重试预算冲突） | **警示** |

**新增待定9：`permissionUpdates` 由谁产生？**
ZCode 允许审批结果携带权限配置更新。**若允许模型填，就是 C35 那个缺口**；
Codex 的做法是引擎算提案、用户接受。**我方要选边。**

---

## 8. 诚实声明：未读

- `core/src/runtime/methods/` 的**主体**（`agent-runtime.ts` 584 行接口背后的实现、
  `turn-tools.ts` 全文、`internal-turn-methods.ts`）—— **只读了片段**
- `core/src/compact/*`（6 个文件）—— **只看了文件名与一个边界事件**
- `core/src/context/builder.ts` 起的上下文体系 —— **未读**
- `bootstrap/src/app/dynamic-workflow-run-*`（**30+ 个文件**）—— **只看了文件名**，
  这是 ZCode 的动态工作流/子 agent 编排，**完全没读**
- `packages/adapters/`、`tui/`、`browser-use-plugin/`、`superpowers-plugin/`、
  `node-repl-host/`、`swift-bridge/` —— **未读**
- 全部测试文件 —— **未读**（"怎么 mock LLM、怎么断言事件序列"仍未回答）

**本报告是"ZCode agent 回合状态机 + 事件词汇表 + 权限 broker"的精读，不是 ZCode 的精读。**
