/**
 * bash 工具（B3）——在 shell 中执行命令并回显 stdout/stderr 与退出码。
 * 参数形状取 pi harness/tools/bash.ts：`{ command, timeout?（秒）}`，timeout
 * 校验落地。执行经 T-4-05 的 ExecutionEnv（D4：工具拿不到裸进程 API，
 * spawn 在 env 实现层）——本文件不含任何裸进程 API 词汇。
 * shell 选择：P0 用 bash（Git Bash 存在于本机），跨壳留 P1 D11。
 *
 * 路径边界（T-6-01/C7/D1）：重定向的文件目标经 T-5-14 的虚拟文件操作
 * （file-write/file-read）在执行前逐个过沙箱守卫——这是出口级硬拦（策略
 * 链的批准绕不过它）；不可静态验证的目标 fail-closed 拒绝执行，覆盖面与
 * 方言边界见 path-guard 头注释 LIMITATIONS。守卫拒绝发生在 env 启动命令
 * 之前（被拒命令未启动——D15 的幂等前提）。
 *
 * 重试幂等边界（T-6-06/D15）：进程一旦 spawn（env.exec 已发出），结果
 * 一律带 started 标记（成功/非零退出/超时/未知失败皆是）——自动重试层
 * 见标记必须拒绝（bash-retry-guard.assertRetryAllowed）；只有 spawn 本身
 * 失败（ENOENT 等，命令未启动）无标记、可安全重试。模型要重复执行请
 * 显式再次调用。
 *
 * 语义：退出码非 0 → isError（模型可感知失败）；超时 → TOOL_TIMEOUT
 * （J22/T-2-04 词汇，env 实现层 kill）；退出码同时落 meta.exitCode
 * （tool/result.meta 既有形状，不造第二套词汇）。
 */

import type { ExecResult } from "../env.js";
import type { ToolExecutionResult } from "../../loop.js";
import { TimeoutError } from "../../timeout.js";
import { analyzeShellCommand } from "../../../policy/shell-semantics.js";
import { PathGuard, PathGuardError } from "../../../sandbox/path-guard.js";
import { isSpawnFailure, markStarted } from "../bash-retry-guard.js";
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

export function createBashTool(options: { pathGuard: PathGuard }): ToolDef {
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
      // T-6-01：重定向目标先过守卫（经 T-5-14 虚拟文件操作），拒绝时不启动命令
      try {
        await options.pathGuard.assertShellFileOps(analyzeShellCommand(command).ops);
      } catch (e) {
        if (e instanceof PathGuardError) {
          return toolError("BashError", e.code, e.message);
        }
        throw e;
      }
      if (!ctx.env) {
        return toolError(
          "BashError",
          "EXECUTION_ENV_MISSING",
          "bash 需要执行环境（装配处未注入 ExecutionEnv）",
        );
      }
      // B7 进度示范（T-P1-16）：启动前上报一次——长任务的最早可见事实，
      // 与 D15 的 started 标记同语义立场（"命令已启动"是工具的诚实陈述）
      ctx.reportProgress?.(
        timeout !== undefined
          ? `命令已启动（超时 ${String(timeout)}s）`
          : "命令已启动",
      );
      try {
        const result = await ctx.env.exec(
          command,
          timeout !== undefined ? { timeoutMs: timeout * 1000 } : undefined,
        );
        // D15：命令已启动——成功结果同样标记（自动重发会产生重复副作用）
        return markStarted(toResult(result));
      } catch (e) {
        if (e instanceof TimeoutError) {
          // 子进程已启动后被 kill（env 实现层回收）——已启动，标记
          return markStarted(
            toolError(
              "BashError",
              e.code,
              `命令在 ${String(timeout ?? "?")} 秒内未完成，已被终止`,
              "execution timed out",
            ),
          );
        }
        if (isSpawnFailure(e)) {
          // spawn 本身失败：命令未启动，无标记——自动重试安全（bounded backoff）
          return toolError(
            "BashError",
            (e as NodeJS.ErrnoException).code ?? "EXEC_FAILED",
            `命令启动失败：${String((e as Error).message)}`,
          );
        }
        // 未知失败：保守按已启动处理（D15 fail-closed——判断不了就不重试）
        return markStarted(
          toolError(
            "BashError",
            (e as NodeJS.ErrnoException).code ?? "EXEC_FAILED",
            `命令执行失败：${String((e as Error).message)}`,
          ),
        );
      }
    },
  };
}
