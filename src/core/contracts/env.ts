/**
 * 执行环境契约（T2-4 自 src/kernel/tools/env.ts 下沉类型面——进程能力
 * 只在 ctx.env 实现层，D4；kernel/tools/env.ts 保留 NodeExecutionEnv 实现
 * 与常量，类型消费面经 core 公开入口）。
 */

export type ShellKind = "bash" | "pwsh";

export interface ExecOptions {
  /** 超时毫秒：超时 kill 进程并 reject TimeoutError{code: TOOL_TIMEOUT}（J22 词汇）。 */
  timeoutMs?: number;
  /** 工作目录（缺省进程 cwd）。 */
  cwd?: string;
}

export interface ExecResult {
  /** shell 退出码（0 = 成功；非 0 由调用方按失败语义处理）。 */
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * 结构化子进程执行选项（T-P3-174 批次 1：grep 的 rg 快路径）——参数化
 * 调用（不经 shell 字符串拼接，模式/路径零引号转义面）。
 */
export interface ExecFileOptions {
  timeoutMs?: number;
  cwd?: string;
  /** stdout 缓冲上限（字节）：超出 kill 并 reject（partial 输出丢弃——调用方回退）。 */
  maxBufferBytes?: number;
}

/**
 * 后台进程快照（capture 层现状）：stdout/stderr 各自独立封顶——与
 * pi-desktop capture 层同构（CAPTURE_MAX_BYTES = spill 上限，超出部分
 * 只计数不保留）。
 */
export interface BackgroundOutput {
  status: "running" | "completed" | "killed" | "failed";
  /** 退出码：completed 时有值；killed/failed/running 无。 */
  exitCode?: number;
  stdout: string;
  stderr: string;
  /** capture 层截断事实（超出 CAPTURE_MAX_BYTES 丢弃的量，诚实记账）。 */
  stdoutOmittedBytes: number;
  stderrOmittedBytes: number;
  /** 进程 pid（kill 面与观测用；spawn 失败时 undefined）。 */
  pid?: number;
}

/**
 * 后台进程句柄（T-P3-174 批次 1：bash/pwsh 的 run_in_background）。句柄
 * 不携带 taskId（id 由工具层注册表分配）——env 层只管进程事实。
 */
export interface BackgroundHandle {
  readonly pid: number | undefined;
  /** 现状快照（非阻塞）。 */
  output(): BackgroundOutput;
  /** 等到进程退出（已退出立即返回终态快照）。 */
  wait(): Promise<BackgroundOutput>;
  /** 终止（Windows 走 taskkill /T 杀树；POSIX SIGTERM→宽限期后 SIGKILL）。 */
  kill(): Promise<void>;
}

export interface SpawnBackgroundOptions {
  /** shell 通道（bash / pwsh——与 exec 同一套宿主解析）。 */
  shell?: ShellKind;
  cwd?: string;
}

export interface ExecutionEnv {
  /** 在 shell 中执行命令行（pi Shell.exec 同位）。 */
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  /**
   * 结构化子进程执行（可选能力——T-P3-174 批次 1）：argv 数组直传，不经
   * shell。缺省实现缺席 = 调用方回退自身内置路径（grep rg 快路径的降级面）。
   */
  execFile?(
    program: string,
    args: readonly string[],
    options?: ExecFileOptions,
  ): Promise<ExecResult>;
  /**
   * 后台启动 shell 命令（可选能力——T-P3-174 批次 1）：立即返回句柄，
   * 输出由 env 层 capture（封顶 512KB/流）。缺席 = run_in_background 报
   * BACKGROUND_UNSUPPORTED（fail-closed 不静默）。
   */
  spawnBackground?(
    command: string,
    options?: SpawnBackgroundOptions,
  ): Promise<BackgroundHandle>;
}
