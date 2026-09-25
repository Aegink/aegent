/**
 * bash 工具（B3）——在 shell 中执行命令并回显 stdout/stderr 与退出码。
 * 参数形状取 pi harness/tools/bash.ts：`{ command, timeout?（秒）}`，timeout
 * 校验落地。执行经 T-4-05 的 ExecutionEnv（D4：工具拿不到裸进程 API，
 * spawn 在 env 实现层）——本文件不含任何裸进程 API 词汇。
 * shell 选择：P0 用 bash（Git Bash 存在于本机），跨壳留 P1 D11。
 *
 * 语义：退出码非 0 → isError（模型可感知失败）；超时 → TOOL_TIMEOUT
 * （J22/T-2-04 词汇，env 实现层 kill）；退出码同时落 meta.exitCode
 * （tool/result.meta 既有形状，不造第二套词汇）。
 */

import type { ExecResult } from "../env.js";
import type { ToolExecutionResult } from "../../loop.js";
import { TimeoutError } from "../../timeout.js";
import type { ToolContext } from "../context.js";
import type { ToolDef } from "../registry.js";
import { toolError } from "./util.js";

export interface BashArgs {
  command: string;
  /** 超时秒数（pi 同款：可选，不设默认超时）。 */
  timeout?: number;
}

/** setTimeout 约束换算的秒数上限（pi bash.ts 同款）。 */
const MAX_TIMEOUT_SECONDS = 2_147_483_647 / 1000;

function toResult(result: ExecResult): ToolExecutionResult {
  const output = [result.stdout, result.stderr].filter((s) => s !== "").join("\n");
  const failed = result.exitCode !== 0;
  let content = output !== "" ? output : "(no output)";
  if (failed) content += `\n[exit code ${String(result.exitCode)}]`;
  return {
    content,
    ...(failed ? { isError: true as const } : {}),
    meta: { exitCode: result.exitCode },
  };
}

export function createBashTool(): ToolDef {
  return {
    name: "bash",
    async execute(args, ctx: ToolContext) {
      const { command, timeout } = args as Partial<BashArgs>;
      if (typeof command !== "string" || command === "") {
        return toolError("BashError", "INVALID_ARGUMENTS", "bash 需要 command（非空字符串）");
      }
      if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
        return toolError(
          "BashError",
          "INVALID_ARGUMENTS",
          `timeout 必须是正的有限秒数，收到 ${String(timeout)}`,
        );
      }
      if (timeout !== undefined && timeout > MAX_TIMEOUT_SECONDS) {
        return toolError(
          "BashError",
          "INVALID_ARGUMENTS",
          `timeout 上限 ${String(MAX_TIMEOUT_SECONDS)} 秒`,
        );
      }
      if (!ctx.env) {
        return toolError(
          "BashError",
          "EXECUTION_ENV_MISSING",
          "bash 需要执行环境（装配处未注入 ExecutionEnv）",
        );
      }
      try {
        const result = await ctx.env.exec(
          command,
          timeout !== undefined ? { timeoutMs: timeout * 1000 } : undefined,
        );
        return toResult(result);
      } catch (e) {
        if (e instanceof TimeoutError) {
          return toolError(
            "BashError",
            e.code,
            `命令在 ${String(timeout ?? "?")} 秒内未完成，已被终止`,
            "execution timed out",
          );
        }
        return toolError(
          "BashError",
          (e as NodeJS.ErrnoException).code ?? "EXEC_FAILED",
          `命令启动失败：${String((e as Error).message)}`,
        );
      }
    },
  };
}
