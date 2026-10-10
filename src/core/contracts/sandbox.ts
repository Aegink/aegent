/**
 * 沙箱契约（T2-2 自 src/sandbox/backend.ts 下沉——后端可插端口，依赖倒置：
 * kernel 消费面依赖本契约，sandbox 域反向实现 local/win32 等后端）。
 *
 * 纪律：请求的模式无法被当前后端强制 → SandboxUnavailableError（真实命令
 * **零执行**），绝不降级为不受限运行（fail-closed）。
 */

/** 命令允许的文件效果档位（dsh sandbox 契约词汇，冻结只追加）。 */
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/** 模式闭集（parse/CLI/UI 共用的单一来源——词汇行业收敛，见调研报告 §一.2）。 */
export const SANDBOX_MODES: readonly SandboxMode[] = [
  "read-only",
  "workspace-write",
  "danger-full-access",
];

export const SANDBOX_UNAVAILABLE = "SANDBOX_UNAVAILABLE";

/** 请求的模式无法被当前后端强制时抛出（绝不降级为不受限运行）。 */
export class SandboxUnavailableError extends Error {
  override readonly name = "SandboxUnavailableError";
  readonly code = SANDBOX_UNAVAILABLE;
  constructor(
    readonly mode: SandboxMode,
    message: string,
  ) {
    super(message);
  }
}

export interface SandboxSpawnRequest {
  /** 命令行（语义与 ExecutionEnv.exec 的 command 一致，由后端决定宿主 shell）。 */
  readonly command: string;
  /** 本命令允许的文件效果档位。 */
  readonly mode: SandboxMode;
  /** 工作目录（缺省进程 cwd）。 */
  readonly cwd?: string;
  /** 超时毫秒（超时行为由后端实现决定；local 直通 env.exec 的 kill 语义）。 */
  readonly timeoutMs?: number;
}

/**
 * 结算结果（与 tools/env 的 ExecResult 同形——契约自包含，避免契约反向依赖
 * 实现域；两处形状一致性由 sandbox/backend 的类型别名绑定锚定）。
 */
export interface SandboxSpawnResult {
  /** shell 退出码（0 = 成功；非 0 由调用方按失败语义处理）。 */
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SandboxBackend {
  /** 当前后端可强制的模式集合（能力自述，消费方可据此预检）。 */
  readonly supportedModes: readonly SandboxMode[];
  /**
   * 在请求的 mode 约束下执行命令。mode 不可强制 → 抛 SandboxUnavailableError
   * （真实命令**零执行**）；可强制 → 按 mode 约束运行并结算。
   */
  spawn(request: SandboxSpawnRequest): Promise<SandboxSpawnResult>;
}
