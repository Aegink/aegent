/**
 * ExecutionEnv（D4）——工具可见的执行环境抽象。**进程能力只存在于本文件的
 * Node 实现层**：D4 的证伪命令（`grep -rn child_process src/kernel/tools/ |
 * grep -v env.ts` 须 0 行）放行的就是本文件——工具本体与 ToolContext 的
 * 类型面不含 child_process / spawn 词汇（env.test 的键封闭类型测试钉死）。
 *
 * 接口形状取 pi harness/types.ts 的 `ExecutionEnv extends FileSystem, Shell`
 * 的 P0 子集：只有 shell 执行（bash 工具的命令执行依赖）。文件系统能力当前
 * 由工具直接走 node:fs（P0 无沙箱面）；阶段 6 沙箱（D8/D9）落地时把 fs 收进
 * 本接口，工具零改动换 env 实现（抽象的意义）。
 *
 * shell 选择（D11 · T-P1-28）：`"bash" | "pwsh"` 两态，缺省 bash（P0 逐字节
 * 零行为变化）。pwsh 宿主 = PowerShell（优先 pwsh Core、缺失回落
 * powershell.exe——本机无 Core，实测回落面）；**退出码为宿主语义**（bash 的
 * 原生命令传播语义不同，dsh pwsh-local 同款决策——对齐需尾包装
 * `exit $LASTEXITCODE`，cmdlet 场景会引入残留值误报，比差异更糟），方言
 * 边界见 docs/shell-semantics-limitations.md。
 */

import { execFile, spawn } from "node:child_process";
import { TOOL_TIMEOUT, TimeoutError } from "../timeout.js";

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

/** exec 输出缓冲上限（B5 的输出截断在 T-4-06 工具出口做，这里只防崩）。 */
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

/** pwsh 宿主参数（dsh pwsh-local：fresh `pwsh -Command` 进程）。 */
const PWSH_PROGRAMS = ["pwsh", "powershell.exe"] as const;

export class NodeExecutionEnv implements ExecutionEnv {
  private readonly shell: ShellKind;

  constructor(options?: { shell?: ShellKind }) {
    this.shell = options?.shell ?? "bash";
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const timeoutMs = options?.timeoutMs;
    if (this.shell === "pwsh") {
      return this.execPwsh(command, timeoutMs, options?.cwd);
    }
    return this.execBash(command, timeoutMs, options?.cwd);
  }

  execFile(
    program: string,
    args: readonly string[],
    options?: ExecFileOptions,
  ): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve, reject) => {
      execFile(
        program,
        [...args],
        {
          ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
          ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
          ...(options?.maxBufferBytes !== undefined
            ? { maxBuffer: options.maxBufferBytes }
            : {}),
          windowsHide: true,
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ exitCode: 0, stdout, stderr });
            return;
          }
          if (typeof error.code === "number") {
            resolve({ exitCode: error.code, stdout, stderr });
            return;
          }
          // 超时与缓冲超限（含 ENOENT）一律 reject——调用方按类型化 code
          // 区分回退路径（rg 快路径：非 0/1 退出即回退内置搜索器）。
          if (error.killed) {
            reject(new TimeoutError(TOOL_TIMEOUT, options?.timeoutMs ?? 0));
            return;
          }
          reject(error);
        },
      );
    });
  }

  async spawnBackground(
    command: string,
    options?: SpawnBackgroundOptions,
  ): Promise<BackgroundHandle> {
    const shell = options?.shell ?? "bash";
    let program: string;
    let args: string[];
    if (shell === "pwsh") {
      program = await resolvePwshHost();
      args = ["-NoProfile", "-NonInteractive", "-Command", command];
    } else {
      program = "bash";
      args = ["-c", command];
    }
    return new BackgroundProcessImpl(
      spawn(program, args, {
        ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  }

  /** bash 通道（P0 原路径，零行为变化）。 */
  private execBash(
    command: string,
    timeoutMs: number | undefined,
    cwd: string | undefined,
  ): Promise<ExecResult> {
    return this.spawnAwait("bash", ["-c", command], timeoutMs, cwd);
  }

  /** pwsh 通道：优先 pwsh Core，缺失回落 powershell.exe（探针缓存）。 */
  private async execPwsh(
    command: string,
    timeoutMs: number | undefined,
    cwd: string | undefined,
  ): Promise<ExecResult> {
    const program = await resolvePwshHost();
    return this.spawnAwait(
      program,
      ["-NoProfile", "-NonInteractive", "-Command", command],
      timeoutMs,
      cwd,
    );
  }

  private spawnAwait(
    program: string,
    args: string[],
    timeoutMs: number | undefined,
    cwd: string | undefined,
  ): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve, reject) => {
      execFile(
        program,
        args,
        {
          ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
          ...(cwd !== undefined ? { cwd } : {}),
          windowsHide: true,
          maxBuffer: MAX_BUFFER_BYTES,
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ exitCode: 0, stdout, stderr });
            return;
          }
          if (typeof error.code === "number") {
            // 非零退出是 shell 的正常语义（结果而非失败）：带部分输出返回
            resolve({ exitCode: error.code, stdout, stderr });
            return;
          }
          if (error.killed) {
            // execFile 的 timeout 选项 kill 的（killed 只能来自超时）
            reject(new TimeoutError(TOOL_TIMEOUT, timeoutMs ?? 0));
            return;
          }
          // spawn 失败（如 SHELL_NOT_FOUND 的 ENOENT）
          reject(error);
        },
      );
    });
  }
}

let pwshHostCache: string | undefined;

/**
 * 后台进程 capture 层上限（T-P3-174 批次 1，pi-desktop 同构）：每流 512KB
 * ——刻意等于 shell spill 上限（capture 保留的副本就是 spill 的源），超出
 * 部分只计数不保留（omittedBytes 诚实记账， runaway 命令不吃满内存）。
 */
export const CAPTURE_MAX_BYTES = 512 * 1024;

class BackgroundProcessImpl implements BackgroundHandle {
  private status: BackgroundOutput["status"] = "running";
  private exitCode: number | undefined;
  private stdout = "";
  private stderr = "";
  private stdoutOmitted = 0;
  private stderrOmitted = 0;
  private waiters: Array<() => void> = [];
  private killedByUs = false;

  constructor(private readonly child: import("node:child_process").ChildProcess) {
    child.stdout?.on("data", (chunk: Buffer) => {
      this.retain("stdout", chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.retain("stderr", chunk);
    });
    child.on("error", () => {
      // spawn 后的进程错误（kill 竞态等）——failed 终态（已终止则不覆盖）
      if (this.status === "running") this.settle("failed", undefined);
    });
    // settle 挂 **exit** 而非 close（Windows 实测：taskkill 杀树后 exit 立即
    // 触发，close 要等 stdio 管道句柄全部释放——孙进程持管时会拖到其自然
    // 退出，kill 后的终态快照就变成了 30s 级悬挂）。exit 后管道残余数据
    // 仍会短暂流入 data——retain 无 status 守卫，最后一段输出不丢。
    child.on("exit", (code, signal) => {
      if (this.status !== "running") return;
      this.settle(
        this.killedByUs || signal !== null ? "killed" : "completed",
        code ?? undefined,
      );
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  output(): BackgroundOutput {
    return {
      status: this.status,
      ...(this.exitCode !== undefined ? { exitCode: this.exitCode } : {}),
      stdout: this.stdout,
      stderr: this.stderr,
      stdoutOmittedBytes: this.stdoutOmitted,
      stderrOmittedBytes: this.stderrOmitted,
      ...(this.child.pid !== undefined ? { pid: this.child.pid } : {}),
    };
  }

  wait(): Promise<BackgroundOutput> {
    if (this.status !== "running") return Promise.resolve(this.output());
    return new Promise((resolve) => {
      this.waiters.push(() => resolve(this.output()));
    });
  }

  async kill(): Promise<void> {
    if (this.status !== "running" || this.child.pid === undefined) return;
    this.killedByUs = true;
    const waitForExit = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        if (this.status !== "running") {
          resolve();
          return;
        }
        const timer = setTimeout(resolve, ms);
        this.child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    if (process.platform === "win32") {
      // Windows 无 SIGTERM 语义：taskkill /T 杀整棵树（bash -c 的孙进程
      // 不留孤儿——历史教训：只杀直接子进程会漏树）。taskkill 异步生效，
      // 等 exit 到位再返回（调用方拿到的快照恒为终态——killed 可预期）。
      await new Promise<void>((resolve) => {
        execFile(
          "taskkill",
          ["/pid", String(this.child.pid), "/T", "/F"],
          { windowsHide: true, timeout: 5000 },
          () => resolve(),
        );
      });
      await waitForExit(3000);
      return;
    }
    this.child.kill("SIGTERM");
    await waitForExit(2000);
    if (this.status === "running") {
      this.child.kill("SIGKILL");
      await waitForExit(1000);
    }
  }

  /** capture 层：512KB 内保留，超出只计数（pi-desktop retain 同构）。 */
  private retain(stream: "stdout" | "stderr", chunk: Buffer): void {
    const current = stream === "stdout" ? this.stdout : this.stderr;
    const room = CAPTURE_MAX_BYTES - Buffer.byteLength(current, "utf8");
    if (room <= 0) {
      if (stream === "stdout") this.stdoutOmitted += chunk.length;
      else this.stderrOmitted += chunk.length;
      return;
    }
    const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
    const text = kept.toString("utf8");
    if (stream === "stdout") {
      this.stdout += text;
      this.stdoutOmitted += chunk.length - kept.length;
    } else {
      this.stderr += text;
      this.stderrOmitted += chunk.length - kept.length;
    }
  }

  private settle(status: BackgroundOutput["status"], exitCode: number | undefined): void {
    this.status = status;
    this.exitCode = exitCode;
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }
}

/**
 * 测试隔离面（O25，T-P1-38）：pwshHostCache 是本模块唯一的进程级可变全局——
 * 探测结果跨测试残留会让"宿主回落"用例在前一用例已缓存时失效。显式重置
 * 面替代"改模块内部变量"的黑盒探测（配合 serializeGlobal 串行化使用）。
 */
export function resetPwshHostCacheForTests(): void {
  pwshHostCache = undefined;
}

/** pwsh 宿主解析（进程级缓存）：pwsh Core 探测，缺失回落 powershell.exe。 */
async function resolvePwshHost(): Promise<string> {
  if (pwshHostCache !== undefined) return pwshHostCache;
  for (const candidate of PWSH_PROGRAMS) {
    const available = await probeHost(candidate);
    if (available) {
      pwshHostCache = candidate;
      return candidate;
    }
  }
  // 两个宿主都探测失败仍回落 powershell.exe（系统自带；真缺失时 spawn
  // ENOENT 按既有错误路径报 SHELL_NOT_FOUND）。
  pwshHostCache = "powershell.exe";
  return pwshHostCache;
}

function probeHost(program: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      program,
      program === "pwsh" ? ["--version"] : ["/c", "ver"],
      { windowsHide: true, timeout: 5000, encoding: "utf8" },
      (error) => resolve(error === null),
    );
  });
}
