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
import { TimeoutError, clampTimeout } from "../../timeout.js";
import { analyzeShellCommand } from "../../../policy/shell-semantics.js";
import { PathGuard, PathGuardError } from "../../../sandbox/path-guard.js";
import {
  ESCALATION_TARGETS,
  SandboxEscalationError,
  resolveEscalatedMode,
  validateEscalationArgs,
} from "../../../sandbox/escalation.js";
import type { SandboxMode } from "../../../sandbox/backend.js";
import { SandboxUnavailableError } from "../../../sandbox/backend.js";
import type { PendingApprovals } from "../../../policy/pending.js";
import { isSpawnFailure, markStarted } from "../bash-retry-guard.js";
import type { ToolContext } from "../context.js";
import type { ToolDef } from "../registry.js";
import { toolError } from "./util.js";

export interface BashArgs {
  command: string;
  /** 超时秒数（pi 同款：可选，不设默认超时）。 */
  timeout?: number;
  /**
   * B15/T-P1-58 沙箱升级目标（执行期校验，schema enum = 封闭目标词汇）：
   * 本调用的文件效果档位严格宽于会话默认模式的申请——与 justification
   * 同行，走审批，**仅本调用生效**。
   */
  sandboxPermissions?: string;
  /** 升级申请的理由（审批提示人可见，非空句）。 */
  justification?: string;
}

/** setTimeout 约束换算的秒数上限（pi bash.ts 同款）。 */
export const MAX_TIMEOUT_SECONDS = 2_147_483_647 / 1000;

export function toResult(result: ExecResult): ToolExecutionResult {
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

/** B15/T-P1-58 schema 面：sandboxPermissions 只 advertise 封闭目标词汇。 */
const SANDBOX_PERMISSIONS_SCHEMA = {
  type: "string",
  enum: [...ESCALATION_TARGETS],
  description:
    "Sandbox escalation target for this call only. Requires justification; the user is asked for approval.",
};

export function createBashTool(options: {
  pathGuard: PathGuard;
  /** B18 三档的"默认档"（秒）：timeout 参数缺省时生效。缺省 undefined =
   * 无默认超时（pi 同款行为保持）。上限档恒为 MAX_TIMEOUT_SECONDS，不可关。 */
  defaultTimeoutSeconds?: number;
  /**
   * B15/T-P1-58 沙箱装配（缺省 undefined = 命令经 env 直通，升级参数报
   * SANDBOX_UNAVAILABLE——没有沙箱可升，fail-closed 不静默）。提供时命令
   * 走 backend.spawn（mode = defaultMode + 本调用升级），审批经 PendingApprovals。
   */
  sandbox?: {
    backend: import("../../../sandbox/backend.js").SandboxBackend;
    defaultMode: SandboxMode;
    approvals?: PendingApprovals;
    sessionId?: string;
    /** 升级审批答复上界（必填于审批面——C50 纪律）。 */
    approvalTimeoutMs?: number;
  };
}): ToolDef {
  const sandboxOptions = options.sandbox;
  const schema: NonNullable<ToolDef["parameters"]> = {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to run" },
      timeout: { type: "number", description: "Timeout in seconds (optional)" },
      sandboxPermissions: SANDBOX_PERMISSIONS_SCHEMA,
      justification: {
        type: "string",
        description: "Why this call needs a wider sandbox mode (shown to the approver).",
      },
    },
    required: ["command"],
  };
  return {
    name: "bash",
    ...(schema ? { parameters: schema } : {}),
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
      // B18 三档合并：提示（模型 timeout 参数）缺省用默认档，恒被上限收口
      // （clampTimeout——上限不可经任何输入关闭）。无默认档且无提示 = 无超时
      // （现状语义保持——"禁用"由不武装表达，不用 0 哨兵；也不把上限值展开
      // 传给 env——2^31-1 秒换毫秒恰好顶到 setTimeout 可靠上限，J24 陷阱）。
      const effectiveSeconds = clampTimeout(
        timeout,
        options.defaultTimeoutSeconds ?? MAX_TIMEOUT_SECONDS,
        MAX_TIMEOUT_SECONDS,
        "bash timeout",
      );
      const armedSeconds =
        timeout !== undefined || options.defaultTimeoutSeconds !== undefined
          ? effectiveSeconds
          : undefined;
      // T-6-01：重定向目标先过守卫（经 T-5-14 虚拟文件操作），拒绝时不启动命令
      try {
        await options.pathGuard.assertShellFileOps(analyzeShellCommand(command).ops);
      } catch (e) {
        if (e instanceof PathGuardError) {
          return toolError("BashError", e.code, e.message);
        }
        throw e;
      }
      // B15/T-P1-58：沙箱升级执行期校验（schema 只 advertise 封闭目标词汇，
      // 有效模式是每调用真相）。配对校验 → 严格更宽校验 → 审批 → 仅本调用
      // 生效；任何一步失败 fail-closed 类型化拒绝（执行前，命令未启动）。
      const { sandboxPermissions, justification } = args as Partial<BashArgs>;
      if (sandboxPermissions !== undefined || justification !== undefined) {
        try {
          validateEscalationArgs(sandboxPermissions, justification);
        } catch (e) {
          if (e instanceof SandboxEscalationError) {
            return toolError("BashError", e.code, e.message);
          }
          throw e;
        }
      }
      let effectiveMode: SandboxMode | undefined;
      if (sandboxPermissions !== undefined) {
        if (sandboxOptions === undefined) {
          return toolError(
            "BashError",
            "SANDBOX_UNAVAILABLE",
            "没有沙箱装配在场——sandboxPermissions 无模式可升级（fail-closed 不静默）",
          );
        }
        try {
          effectiveMode = resolveEscalatedMode(sandboxPermissions, sandboxOptions.defaultMode);
        } catch (e) {
          if (e instanceof SandboxEscalationError) {
            return toolError("BashError", e.code, e.message);
          }
          throw e;
        }
        const approvals = sandboxOptions.approvals;
        const timeoutMs = sandboxOptions.approvalTimeoutMs;
        if (approvals === undefined || timeoutMs === undefined || sandboxOptions.sessionId === undefined) {
          return toolError(
            "BashError",
            "SANDBOX_ESCALATION_DENIED",
            `升级到 "${sandboxPermissions}" 需要审批，但本装配没有审批通道（fail-closed）`,
          );
        }
        const verdict = await approvals.ask(
          {
            id: ctx.toolCallId,
            sessionId: sandboxOptions.sessionId,
            tool: "bash",
            args: {
              escalation: `sandbox → ${sandboxPermissions}`,
              ...(justification !== undefined ? { justification } : {}),
            },
            // C54：沙箱升级审批归 tool 类（bash 工具执行内的审批面——记档）
            category: "tool",
          },
          { timeoutMs },
        );
        if (verdict.action !== "allow") {
          return toolError(
            "BashError",
            "SANDBOX_ESCALATION_DENIED",
            verdict.reason !== ""
              ? `升级到 "${sandboxPermissions}" 被拒绝：${verdict.reason}`
              : `升级到 "${sandboxPermissions}" 被拒绝`,
          );
        }
      }
      // B15/T-P1-58：沙箱装配在场时 backend.spawn 替代 env 执行——env 缺席
      // 不再是错误；两者都缺席才是装配缺失。
      if (!ctx.env && sandboxOptions === undefined) {
        return toolError(
          "BashError",
          "EXECUTION_ENV_MISSING",
          "bash 需要执行环境或沙箱后端（装配处未注入 ExecutionEnv / SandboxBackend）",
        );
      }
      // B7 进度示范（T-P1-16）：启动前上报一次——长任务的最早可见事实，
      // 与 D15 的 started 标记同语义立场（"命令已启动"是工具的诚实陈述）
      ctx.reportProgress?.(
        armedSeconds !== undefined
          ? `命令已启动（超时 ${String(armedSeconds)}s）`
          : "命令已启动",
      );
      try {
        // B15/T-P1-58：沙箱装配在场 → backend.spawn（mode = 本调用升级后
        // 的有效档，escalation 仅本调用生效——不落任何会话状态）；缺省 env
        // 直通（P0 行为）。超时 kill 语义由后端实现决定（local 直通等价）。
        const execOptions =
          armedSeconds !== undefined ? { timeoutMs: armedSeconds * 1000 } : undefined;
        let result: ExecResult;
        if (sandboxOptions !== undefined) {
          result = await sandboxOptions.backend.spawn({
            command,
            mode: effectiveMode ?? sandboxOptions.defaultMode,
            ...(execOptions ?? {}),
          });
        } else {
          // 前置检查保证：无沙箱装配时 ctx.env 必在场
          result = await ctx.env!.exec(command, execOptions);
        }
        // D15：命令已启动——成功结果同样标记（自动重发会产生重复副作用）
        return markStarted(toResult(result));
      } catch (e) {
        if (e instanceof SandboxUnavailableError) {
          // fail-closed 拒绝发生在 spawn 前——命令未启动，无 started 标记
          //（与 isSpawnFailure 同语义位：重试安全，但会得到同样的类型化拒绝）
          return toolError("BashError", e.code, e.message);
        }
        if (e instanceof TimeoutError) {
          // 子进程已启动后被 kill（env 实现层回收）——已启动，标记
          return markStarted(
            toolError(
              "BashError",
              e.code,
              `命令在 ${String(armedSeconds ?? "?")} 秒内未完成，已被终止`,
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
