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

import type { ExecResult } from "../../src/core/index.js";
import type { ToolExecutionResult } from "../../src/kernel/loop.js";
import { TimeoutError } from "../../src/kernel/timeout.js";
import { analyzeShellCommand } from "../../src/policy/shell-semantics.js";
import { PathGuard, PathGuardError } from "../../src/sandbox/path-guard.js";
import { SandboxUnavailableError } from "../../src/core/index.js";
import { isSpawnFailure, markStarted } from "../../src/core/index.js";
import type { ToolContext } from "../../src/core/index.js";
import type { ToolDef } from "../../src/core/index.js";
import { toolError } from "./util.js";
import { MAX_TIMEOUT_SECONDS, toResult } from "./bash.js";
import type { BashArgs } from "./bash.js";
import { BackgroundShellRegistry } from "../../src/core/index.js";
import { formatShellOutput } from "../../src/core/index.js";

export function createPwshTool(options: {
  pathGuard: PathGuard;
  /**
   * T-P3-140 批次 A：沙箱装配（模式路由后端 + 活 defaultMode）。提供时
   * 命令走 backend.spawn（mode = 每次调用读的 defaultMode——getter 保活
   * 读 configStore；helper 在场时受限档真实强制）。缺省 env 直通（P0
   * 行为）。**无升级参数**：升级面只在 bash 一侧（pwsh 双开会造出第二
   * 升级通道，审批语义复杂度不值——受限档同样强制，足额）。
   */
  sandbox?: {
    backend: import("../../src/sandbox/backend.js").SandboxBackend;
    readonly defaultMode: import("../../src/sandbox/backend.js").SandboxMode;
  };
  /** T-P3-174 批次 1：与 bash 同款的后台注册表与 spill 归属面。 */
  scratchDir?: string;
  sessionId?: string;
  background?: BackgroundShellRegistry;
}): ToolDef {
  const backgroundRegistry = options.background ?? new BackgroundShellRegistry();
  return {
    name: "pwsh",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "system",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The PowerShell command to run" },
        timeout: { type: "number", description: "Timeout in seconds (optional)" },
        run_in_background: {
          type: "boolean",
          description:
            "Run the command in the background: returns a task_id immediately. " +
            "Query output/status or kill it later via task_output. Not subject to timeout.",
        },
      },
      required: ["command"],
    },
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
      // 沙箱装配在场时 env 缺位不再是错误（backend.spawn 承担执行——bash
      // 同款语义）；两者都缺席才是装配缺失。
      if (!ctx.env && options.sandbox === undefined) {
        return toolError(
          "PwshError",
          "EXECUTION_ENV_MISSING",
          "pwsh 需要执行环境（装配处未注入 ExecutionEnv）",
        );
      }
      // T-P3-174 批次 1：后台执行分支（bash 同款语义——校验已全部在前，
      // 仅 danger-full-access 有效档允许 env 后台启动，立即返回 task_id）。
      if ((args as Partial<BashArgs>).run_in_background === true) {
        const effectiveSandboxMode =
          options.sandbox !== undefined ? options.sandbox.defaultMode : undefined;
        if (
          options.sandbox !== undefined &&
          effectiveSandboxMode !== "danger-full-access"
        ) {
          return toolError(
            "PwshError",
            "SANDBOX_UNSUPPORTED",
            `run_in_background 暂不支持沙箱模式「${String(effectiveSandboxMode)}」（后台执行仅 env 直通/全自动档——受限档无后台句柄无 kill）`,
          );
        }
        const env = ctx.env;
        if (!env || env.spawnBackground === undefined) {
          return toolError(
            "PwshError",
            "BACKGROUND_UNSUPPORTED",
            "当前执行环境不支持后台任务（spawnBackground 能力缺席）",
          );
        }
        ctx.reportProgress?.("后台任务启动中");
        try {
          const handle = await env.spawnBackground(command, { shell: "pwsh" });
          let taskId: string;
          try {
            taskId = backgroundRegistry.start({ shell: "pwsh", command, handle });
          } catch (e) {
            await handle.kill();
            throw e;
          }
          return markStarted({
            content:
              `后台任务已启动\ntask_id: ${taskId}\ncommand: ${command}\n` +
              "查询输出/状态或终止：task_output(task_id)。任务结束后输出仍可查询（进程内保留）。",
            meta: { task_id: taskId, background: true },
          });
        } catch (e) {
          if (e instanceof Error && e.message.includes("后台任务已满")) {
            return toolError("PwshError", "BACKGROUND_TASKS_FULL", e.message);
          }
          if (isSpawnFailure(e)) {
            return toolError(
              "PwshError",
              (e as NodeJS.ErrnoException).code ?? "EXEC_FAILED",
              `命令启动失败：${String((e as Error).message)}`,
            );
          }
          return markStarted(
            toolError(
              "PwshError",
              (e as NodeJS.ErrnoException).code ?? "EXEC_FAILED",
              `后台命令启动失败：${String((e as Error).message)}`,
            ),
          );
        }
      }
      // B7 进度示范（T-P1-16 同款立场）
      ctx.reportProgress?.(
        timeout !== undefined ? `命令已启动（超时 ${String(timeout)}s）` : "命令已启动",
      );
      try {
        // T-P3-140 批次 A：沙箱装配在场 → backend.spawn（mode 每调用活读
        // ——helper 缺席时受限档塌缩全自动由装配 getter 承担，工具面只见
        // 后端语义）；缺省 env 直通（P0 行为）。超时 kill 语义由后端决定
        //（win32 helper 回 TIMEOUT → TimeoutError，local 直通等价 env）。
        const sandboxOptions = options.sandbox;
        const result =
          sandboxOptions !== undefined
            ? await sandboxOptions.backend.spawn({
                command,
                mode: sandboxOptions.defaultMode,
                ...(timeout !== undefined ? { timeoutMs: timeout * 1000 } : {}),
              })
            : // env 分支：上方守卫保证无沙箱时 ctx.env 必在位（断言注释）
              await ctx.env!.exec(
                command,
                timeout !== undefined ? { timeoutMs: timeout * 1000 } : undefined,
              );
        // T-P3-174 批次 1：双层预算输出（bash 同款——stdout 保头/stderr 保尾/
        // 单行 16k/超限 spill，meta.outputBounded 让通用出口跳过）。
        const formatted = await formatShellOutput({
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          ...(options.scratchDir !== undefined ? { scratchDir: options.scratchDir } : {}),
          label: "pwsh",
          sessionId: options.sessionId ?? "unknown-session",
          tool: "pwsh",
          callId: ctx.toolCallId,
        });
        return markStarted({
          content: formatted.text,
          ...(result.exitCode !== 0 ? { isError: true as const } : {}),
          meta: { exitCode: result.exitCode, ...formatted.meta },
        });
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
        if (e instanceof SandboxUnavailableError) {
          // fail-closed 拒绝发生在 spawn 前——命令未启动，无 started 标记
          //（与 isSpawnFailure 同语义位：可安全重试，但重试也会同样拒绝）
          return toolError("PwshError", e.code, e.message);
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
