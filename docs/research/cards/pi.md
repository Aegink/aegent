# pi — earendil-works/pi

`b313731` · MIT · 37M · Node/TS monorepo · 收 PR · 有 clean-room 声明

1. **许可/社区**：MIT (`Copyright (c) 2025 Mario Zechner`)。有 CONTRIBUTING/SECURITY。可参考实现。
2. **分层**：最干净的仓，11 个 workspace。构建顺序即依赖序：
   `chord → tui → telemetry → ai → durable → agent → session-backends → protocol → client → server → coding-agent`。
   `packages/agent` 是内核；`ai` 厂商；`durable` 持久化；`session-backends/{sqlite-node,jsonl}`；
   `protocol`+`client`+`server` 多端；`tui` 界面；`coding-agent` 产品壳。**kernel / ui / host 三者彻底分离。**
3. **Loop**：`packages/agent/src/agent-loop.ts`(898行)，导出 `agentLoop`/`agentLoopContinue`/`runAgentLoop`。
   ```
   agent_start → turn_start → [message_start/update/end, tool_execution_start/update/end ×N] → turn_end → agent_end
   决策点: AgentTurnDecision = {action:"continue"} | {action:"end"}
   ```
   停止条件是**显式决策**，非"无 toolCall 即停"的隐式约定。`QueueMode="all"|"one-at-a-time"` 控 steer 节奏。
4. **工具**：`harness/tools/`：`bash` `edit` `edit-diff` `read` `write` `image` `file-mutation-queue` `path-utils` `tool-context`。
   `ToolExecutionMode="sequential"|"parallel"` 并行可配。危险工具**无内置审批门**，靠钩子交宿主。
5. **会话**：`harness/session/`：`jsonl/` `commit.ts` `mutation-line.ts` `values.ts`。**事件源式**
   (`CommittedListAppendWrite`/`CommittedValueSetWrite`)，后端可换 sqlite。
   `fork-policy.ts`：`ForkCurrentStatePlan={scope:"branch"}|{scope:"tree"}` —— **线性与树都支持**，
   沿父链回溯，`position:"before"|"after"` 定切点。
6. **扩展**：`harness/hooks.ts` + `harness/skills.ts` + `coding-agent/examples/extensions/`(含 `sandbox`、`gondolin`)。
7. **多端**：`packages/server`+`protocol`+`client`，TUI 与 Web 共用内核。检出 MCP。
8. **安全（关键）**：`SECURITY.md` 明确**不自带沙箱**——"运行在本地用户账号的信任边界内……
   由用户自行负责监视，或用容器/虚拟机关起来"。沙箱只是 example extension，不是内核职责。
   **拿 pi 当内核 = 隔离自担。**
9. **可复用 vs 只学**：可复用（MIT，需登记）`AgentEvent` 事件联合体形状、`AgentTurnDecision` 显式停止条件、
   `ForkCurrentStatePlan` 分支/树抽象、`ToolExecutionMode` 可配并行。只学行为：loop 实现、工具实现、产品壳取舍。
10. **评分**：内核 **5** · 沙箱参考 1 · UI 参考 3(`tui`) · 多端参考 4(`protocol`+`server`)
