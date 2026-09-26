/**
 * 沙箱可插后端（T-P1-24 · D5）——子进程执行面的约束契约。形状取 dsh
 * packages/sandbox/sandbox 契约三纪律：
 *   1. mode 词汇 = `read-only / workspace-write / danger-full-access`
 *      （mode 描述命令**允许的文件效果**，不是进程策略——与 PathGuard
 *      （工具层文件 I/O）和 NetworkPolicy（网络档）互补不重叠）；
 *   2. **"If the requested mode cannot be enforced, the call fails with
 *      SANDBOX_UNAVAILABLE instead of running unconfined"**——请求的
 *      模式后端强制不了时必须报错，绝不静默降级为不受限运行（Q17
 *      "不假装已管住"在执行面的同款）；
 *   3. 后端可插：消费方只见 SandboxBackend 接口与模式/结算结果，不见
 *      平台 runner（local 直通 / win32 受限令牌 helper 都挂同一接口后）。
 *
 * escalation 词位（被拒后申请"严格更宽的一次性模式"走人工批准）是
 * B15（批次 7）的落点，本卡只在语义注释预留，不实装。
 *
 * 后端能力按 mode 显式判定（enforcement completeness）：createLocalBackend
 * 只有 danger-full-access 一档可强制（直通 env.exec），受限 mode 一律
 * SANDBOX_UNAVAILABLE——"local 后端先跑通，接口不写死"（D5 验收要点）。
 */

import type { ExecOptions, ExecResult, ExecutionEnv } from "../kernel/tools/env.js";

/** 命令允许的文件效果档位（dsh sandbox 契约词汇，冻结只追加）。 */
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

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

/** 结算结果与 ExecResult 同形（管辖/配额等扩展位在 meta，D13 卡定形）。 */
export type SandboxSpawnResult = ExecResult;

/**
 * 子进程执行面的约束契约（dsh ctx.sandbox 的对应物）：实现方声明自己能
 * 强制哪些模式；不能强制的模式在 spawn 前显式报错。
 */
export interface SandboxBackend {
  /** 当前后端可强制的模式集合（能力自述，消费方可据此预检）。 */
  readonly supportedModes: readonly SandboxMode[];
  /**
   * 在请求的 mode 约束下执行命令。mode 不可强制 → 抛 SandboxUnavailableError
   * （真实命令**零执行**）；可强制 → 按 mode 约束运行并结算。
   */
  spawn(request: SandboxSpawnRequest): Promise<SandboxSpawnResult>;
}

export interface LocalBackendOptions {
  /** 底层执行环境（D4：spawn 只在 env 实现层）。 */
  readonly env: ExecutionEnv;
}

/**
 * local 后端（D5："local 后端先跑通"）——danger-full-access 直通 env.exec，
 * 受限 mode 无 OS 强制面 → SANDBOX_UNAVAILABLE。受限模式在 Windows 的
 * 强制实现是 T-P1-25 的 win32 受限令牌后端（同一接口的另一实现）。
 */
export function createLocalBackend(options: LocalBackendOptions): SandboxBackend {
  return {
    supportedModes: ["danger-full-access"],
    async spawn(request: SandboxSpawnRequest): Promise<SandboxSpawnResult> {
      if (request.mode !== "danger-full-access") {
        throw new SandboxUnavailableError(
          request.mode,
          `沙箱后端无法强制模式「${request.mode}」（local 后端仅支持 danger-full-access），命令未执行。` +
            `配置受限模式请接入 win32 受限令牌后端（D6）；不会在无法强制时不受限运行。`,
        );
      }
      const execOptions: ExecOptions = {};
      if (request.timeoutMs !== undefined) execOptions.timeoutMs = request.timeoutMs;
      if (request.cwd !== undefined) execOptions.cwd = request.cwd;
      return options.env.exec(request.command, execOptions);
    },
  };
}
