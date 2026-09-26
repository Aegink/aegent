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

import { execFile } from "node:child_process";
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

export interface ExecutionEnv {
  /** 在 shell 中执行命令行（pi Shell.exec 同位）。 */
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
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
