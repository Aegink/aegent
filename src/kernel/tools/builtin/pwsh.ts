/**
 * pwsh 工具（D11 · T-P1-28）——PowerShell 作为一等 shell 的模型面工具，
 * 与 bash 工具平行（dsh tool-bash/tool-pwsh 同构："Windows 下 pwsh 与 bash
 * 都有 local/sandbox 两态"）。
 *
 * 与 bash.ts 共享的纪律（同一工厂形状，不改语义面）：
 *   - 重定向目标经 analyzeShellCommand 的字面解析过 PathGuard（T-6-01
 *     出口级；`>`/`>>`/`2>` 在两种 shell 同形状——字面级解析跨方言有效）；
 *   - D15 started 标记（spawn 即标记、自动重试必须拒绝）；
 *   - 超时 TOOL_TIMEOUT、退出码落 meta、进度上报示范。
 *
 * **bash 语义依赖面（本批特有注意）**：analyzeShellCommand 是 bash 方言
 * 分析器——对 pwsh 命令只有其字面级重定向解析可信；危险模式库按 bash
 * 形状匹配（误报方向保守无害），pwsh 参数式写 cmdlet（Out-File/
 * Set-Content/Add-Content/New-Item）不识别为写操作（与 bash 的 tee/dd
 * 同款边界）——完整方言边界见 docs/shell-semantics-limitations.md 的
 * pwsh 节（D11 卡扩）。
 *
 * 退出码语义：宿主语义（见 env.ts 的 pwsh 通道注释——dsh pwsh-local
 * 同款决策）。
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
import { MAX_TIMEOUT_SECONDS, toResult } from "./bash.js";
import type { BashArgs } from "./bash.js";

export function createPwshTool(options: { pathGuard: PathGuard }): ToolDef {
  return {
    name: "pwsh",
    async execute(args, ctx: ToolContext) {
      const { command, timeout } = args as Partial<BashArgs>;
      if (typeof command !== "string" || command === "") {
        return toolError("PwshError", "INVALID_ARGUMENTS", "pwsh 需要 command（非空字符串）");
      }
      if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
        return toolError(
          "PwshError",
          "INVALID_ARGUMENTS",
          `timeout 必须是正的有限秒数，收到 ${String(timeout)}`,
        );
      }
      if (timeout !== undefined && timeout > MAX_TIMEOUT_SECONDS) {
        return toolError(
          "PwshError",
          "INVALID_ARGUMENTS",
          `timeout 上限 ${String(MAX_TIMEOUT_SECONDS)} 秒`,
        );
      }
      // T-6-01 出口级（D11 边界）：字面级重定向解析跨 shell 同形状——
      // 提取到的 file-write/file-read 虚拟操作照过守卫，拒绝不启动命令。
      try {
        await options.pathGuard.assertShellFileOps(analyzeShellCommand(command).ops);
      } catch (e) {
        if (e instanceof PathGuardError) {
          return toolError("PwshError", e.code, e.message);
        }
        throw e;
      }
      if (!ctx.env) {
        return toolError(
          "PwshError",
          "EXECUTION_ENV_MISSING",
          "pwsh 需要执行环境（装配处未注入 ExecutionEnv）",
        );
      }
      // B7 进度示范（T-P1-16 同款立场）
      ctx.reportProgress?.(
        timeout !== undefined ? `命令已启动（超时 ${String(timeout)}s）` : "命令已启动",
      );
      try {
        const result = await ctx.env.exec(
          command,
          timeout !== undefined ? { timeoutMs: timeout * 1000 } : undefined,
        );
        return markStarted(toResult(result));
      } catch (e) {
        if (e instanceof TimeoutError) {
          return markStarted(
            toolError(
              "PwshError",
              e.code,
              `命令在 ${String(timeout ?? "?")} 秒内未完成，已被终止`,
              "execution timed out",
            ),
          );
        }
        if (isSpawnFailure(e)) {
          return toolError(
            "PwshError",
            (e as NodeJS.ErrnoException).code ?? "EXEC_FAILED",
            `命令启动失败：${String((e as Error).message)}`,
          );
        }
        // 未知失败：保守按已启动处理（D15 fail-closed）
        return markStarted(
          toolError(
            "PwshError",
            (e as NodeJS.ErrnoException).code ?? "EXEC_FAILED",
            `命令执行失败：${String((e as Error).message)}`,
          ),
        );
      }
    },
  };
}

// re-export 供类型引用面（pwsh 与 bash 参数形状一致）。
export type { BashArgs };
