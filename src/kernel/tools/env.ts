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
 * shell 选择：实现层固定用 bash（Git Bash 在本机存在；卡面风险栏的 P0 决定），
 * 跨壳（cmd/PowerShell）留 P1 D11。
 */

import { execFile } from "node:child_process";
import { TOOL_TIMEOUT, TimeoutError } from "../timeout.js";

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

export class NodeExecutionEnv implements ExecutionEnv {
  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const timeoutMs = options?.timeoutMs;
    return await new Promise<ExecResult>((resolve, reject) => {
      execFile(
        "bash",
        ["-c", command],
        {
          ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
          ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
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
