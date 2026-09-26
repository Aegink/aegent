/**
 * 沙箱后端装配 + 不可靠兜底显式告警（T-P1-26 · D13 兜底面 + D14）。
 *
 * D14（dsh containment 文档原文："Unsupported hosts use the existing
 * weaker fallback with one provider-lifetime warning"）：强管辖（win32
 * 受限令牌 helper）不可用而回退弱兜底（local 直通后端）时，**provider
 * 生命周期一次性**显式告警——"不假装已管住"：弱兜底连受限模式都无法
 * 强制（D5 的 SANDBOX_UNAVAILABLE），降级事实必须对运维可见。
 *
 * 与 D15（bash-retry-guard）的边界：D15 是重试幂等边界（已启动的命令
 * 不自动重试），D14 是管辖降级告警——相邻不同义（批次 3 展卡核对结论）。
 */

import { Win32SandboxBackend } from "./win32-backend.js";
import { createLocalBackend, type SandboxBackend } from "./backend.js";
import type { ExecutionEnv } from "../kernel/tools/env.js";

export interface ContainmentLogger {
  /** 告警出口（装配处的 logger.warn）。 */
  warn(message: string): void;
}

export interface ContainedBackendOptions {
  /** helper exe 路径（在场 → 强管辖；缺席 → 降级 + 告警）。 */
  readonly helperPath: string;
  readonly workspace: string;
  readonly tempDir?: string | null;
  /** 弱兜底的底层执行环境（D4：spawn 只在 env 实现层）。 */
  readonly localEnv: ExecutionEnv;
  readonly logger?: ContainmentLogger;
}

/** D14 固定告警文案前缀（验收断言面）。 */
export const CONTAINMENT_DEGRADED_PREFIX = "子进程管辖降级";

/**
 * 装配处唯一的沙箱后端工厂：helper 在场 → Win32SandboxBackend（强管辖）；
 * 缺席 → **warn 恰一次**（本 provider 生命周期）+ local 弱兜底后端。
 * 每个 provider（每次工厂调用）告警一次——不是全局一次（新 provider
 * 仍需对新降级事实可见）。
 */
export function createContainedBackend(options: ContainedBackendOptions): SandboxBackend {
  const backend = new Win32SandboxBackend({
    helperPath: options.helperPath,
    workspace: options.workspace,
    tempDir: options.tempDir,
  });
  if (backend.isHelperAvailable()) {
    return backend;
  }
  const message =
    `${CONTAINMENT_DEGRADED_PREFIX}：win32 沙箱 helper 不在场（${options.helperPath}），` +
    `子进程管辖回退为 local 弱兜底——逃逸后代与工作区外写入**不被承诺管住**` +
    `（受限模式将报 SANDBOX_UNAVAILABLE 而非静默降级运行；先运行 ` +
    `npm run build:sandbox-helper 恢复强管辖）。`;
  options.logger?.warn(message);
  return createLocalBackend({ env: options.localEnv });
}
