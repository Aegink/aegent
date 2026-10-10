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
export * from "./contracts/subagent.js";
export * from "./primitives/session/reference.js";
export type { AgentLoopDeps, DecideTurn, StepRecord, ToolExecutionMode, TurnDecision } from "./primitives/loop/loop.js";
export { AgentLoop } from "./primitives/loop/loop.js";
export { createLoop, registerLoopImplementation, type LoopImplementation } from "./primitives/loop/factory.js";
export { installConsoleRedirect } from "./primitives/process/console-redirect.js";
export { ToolRegistry } from "./primitives/tools/registry.js";
export { WriteQueue } from "./primitives/tools/write-queue.js";
export { BackgroundShellRegistry } from "./primitives/tools/background-shell.js";
export * from "./primitives/tools/background-shell.js";
export { NodeExecutionEnv } from "./primitives/tools/env.js";
export * from "./primitives/tools/shell-output.js";
export * from "./primitives/tools/bash-retry-guard.js";
