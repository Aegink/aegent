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

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_HELPER_PATH, Win32SandboxBackend } from "./win32-backend.js";
import { createLocalBackend, type SandboxBackend, type SandboxSpawnRequest } from "./backend.js";
import type { ExecutionEnv } from "../core/index.js";

export { Win32SandboxBackend };

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

// ---------------------------------------------------------------------------
// 模式路由后端 + helper 路径解析（T-P3-140 批次 A——沙箱三档生产接线）
// ---------------------------------------------------------------------------

/**
 * helper exe 解析（三段式）：显式环境变量 → 发行包伴随位（bundle 后
 * import.meta.url 指向 host/agent-child 的 .cjs——helper 随包发在同一
 * 目录）→ 仓库约定位置（开发机 cwd 相对，`npm run build:sandbox-helper`
 * 产物）。全部不存在时返回约定位置（调用方 existsSync 自判——doctor
 * 要对"看过哪个路径"如实报）。
 */
export function resolveSandboxHelperPath(): string {
  const envPath = process.env["AEGENT_SANDBOX_HELPER"];
  if (envPath !== undefined && envPath !== "" && existsSync(envPath)) return envPath;
  const packaged = path.join(path.dirname(fileURLToPath(import.meta.url)), "win32-sandbox-helper.exe");
  if (existsSync(packaged)) return packaged;
  return DEFAULT_HELPER_PATH;
}

export interface RoutingBackendOptions {
  /** 受限模式（read-only / workspace-write）的强制后端；undefined = 本机无强制面。 */
  readonly restricted?: SandboxBackend;
  /** 全自动档直通的底层执行环境（D4：spawn 只在 env 实现层）。 */
  readonly localEnv: ExecutionEnv;
  /** 降级告警出口（缺席可见——D14 纪律，不静默放宽）。 */
  readonly logger?: ContainmentLogger;
}

/**
 * 按 mode 路由的复合后端（T-P3-140 批次 A）：全自动档 local 直通（既有
 * 行为零变化）、受限档走 win32 受限令牌后端。**受限后端缺席时取 D5
 * fail-closed**：返回 local 后端（supportedModes 仅全自动——受限请求在
 * spawn 前类型化报 SANDBOX_UNAVAILABLE，绝不降级为不受限运行；审批过的
 * 升级同样不例外——没有强制面就没有可升级进去的档位，可见降级由装配侧
 * defaultMode 塌缩承担）。
 */
export function createRoutingBackend(options: RoutingBackendOptions): SandboxBackend {
  if (options.restricted === undefined) {
    options.logger?.warn(
      `${CONTAINMENT_DEGRADED_PREFIX}：受限模式无强制后端（helper 不在场）——` +
        `read-only / workspace-write 档不可用（SANDBOX_UNAVAILABLE），全自动档不受影响。`,
    );
    return createLocalBackend({ env: options.localEnv });
  }
  const restricted = options.restricted;
  const local = createLocalBackend({ env: options.localEnv });
  return {
    supportedModes: ["read-only", "workspace-write", "danger-full-access"],
    async spawn(request: SandboxSpawnRequest) {
      if (request.mode === "danger-full-access") {
        return local.spawn(request);
      }
      return restricted.spawn(request);
    },
  };
}
