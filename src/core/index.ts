/**
 * core 域单一公开入口（architecture-policy core.publicEntrypoints 唯一值，
 * T1-1 起生效）——跨域 import core 一律走本文件（forbidDeepImports 强制）；
 * 核内文件间相对 import 不经此。随批次下沉逐段补 re-export，
 * 最终语义面 = 0 骨架 + 1 装配入口。
 */
export * from "./skeleton/events.js";
export * from "./skeleton/logger.js";
export * from "./skeleton/chain.js";
export * from "./skeleton/timeout.js";
export * from "./skeleton/deadline.js";
export * from "./skeleton/queue.js";
export * from "./contracts/attachments.js";
export * from "./contracts/models.js";
export * from "./contracts/policy.js";
export * from "./contracts/sandbox.js";
export * from "./contracts/session.js";
export * from "./contracts/env.js";
export * from "./contracts/tools.js";
export * from "./contracts/plugins.js";
export * from "./contracts/memory.js";
export * from "./contracts/channel.js";
export * from "./contracts/schedule.js";
export * from "./contracts/telemetry.js";
export * from "./contracts/compaction.js";
export * from "./contracts/subagent.js";
export * from "./primitives/session/reference.js";
export type {
  AgentLoopDeps,
  DecideTurn,
  StepRecord,
  ToolExecutionMode,
  TurnDecision,
  ModelRequestPayload,
  ModelStepOutput,
  TurnEndPayload,
} from "./primitives/loop/loop.js";
export { AgentLoop } from "./primitives/loop/loop.js";
export { createLoop, registerLoopImplementation, type LoopImplementation } from "./primitives/loop/factory.js";
export { installConsoleRedirect } from "./primitives/process/console-redirect.js";
export * from "./skeleton/admission.js";
export * from "./skeleton/budget.js";
export * from "./skeleton/hooks.js";
export * from "./skeleton/goal.js";
export * from "./skeleton/invariants.js";
export * from "./skeleton/protocol.js";
export * from "./skeleton/protocol-payload.js";
export * from "./skeleton/protocol-framing.js";
export * from "./skeleton/run-state.js";
export * from "./skeleton/rw-lock.js";
export * from "./primitives/loop/guards.js";
export * from "./primitives/loop/watchdog.js";
export * from "./primitives/loop/prompt-args.js";
export * from "./primitives/loop/prompt-gate.js";
export * from "./primitives/loop/side-query.js";
export * from "./primitives/loop/stream-recovery.js";
export * from "./primitives/loop/model-switch.js";
export * from "./primitives/loop/retry-after.js";
export * from "./primitives/loop/goal-round-driver.js";
export * from "./primitives/session/session-config.js";
export * from "./primitives/session/project.js";
export * from "./primitives/session/messages.js";
export * from "./primitives/session/coalescer.js";
export * from "./primitives/session/prefix-anchor.js";
export * from "./primitives/session/result-trim.js";
// W16 排查 C3：reference.js 在 L27 已导出（重复导出卫生——去重）
export * from "./primitives/tools/truncate.js";
export * from "./primitives/tools/spill-gc.js";
export * from "./primitives/tools/mutation-budget.js";
export * from "./primitives/tools/scheduler.js";
export { ToolRegistry } from "./primitives/tools/registry.js";
export { WriteQueue } from "./primitives/tools/write-queue.js";
// W16 排查 C3：background-shell.js 在 L74 星号导出已含 BackgroundShellRegistry
// （命名导出重复——去重保星号）
export * from "./primitives/tools/background-shell.js";
export { NodeExecutionEnv } from "./primitives/tools/env.js";
export * from "./primitives/tools/shell-output.js";
export * from "./primitives/tools/bash-retry-guard.js";
