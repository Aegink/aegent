/**
 * task_output 工具（T-P3-174 批次 1）——bash/pwsh 后台任务（run_in_background）
 * 的输出/状态查询与终止面。codex unified_exec 的轮询语义（poll 即取新产出）
 * + opencode background 的 id 查询形态，落成 aegent 的单一工具：
 *
 *   - task_id（必填）：bash/pwsh run_in_background 返回的 id；
 *   - wait_seconds（可选 0..300，缺省 0）：任务还在跑时最多再等多久再取
 *     快照（codex write_stdin 空 chars 轮询的 yield 时间同构）；
 *   - kill（可选 true）：终止任务（Windows taskkill /T 杀树），返回终止时
 *     点的输出快照。
 *
 * 输出经 shell-output 的双层预算格式化（stdout 保头/stderr 保尾/单行 16k/
 * 超限 spill 到 workspace scratch）——与前台 bash 同一条出口。零依赖常驻
 * 注册（无后台任务时调用得到类型化错误 + 可用 id 清单，模型可自修）。
 */

import type { ToolDef } from "../registry.js";
import type { ToolExecutionResult } from "../../loop.js";
import type { ToolContext } from "../context.js";
import type { BackgroundOutput } from "../env.js";
import { BackgroundShellRegistry, type BackgroundTaskRecord } from "../background-shell.js";
import { formatShellOutput } from "../shell-output.js";
import { toolError } from "./util.js";

const MAX_WAIT_SECONDS = 300;

export interface TaskOutputArgs {
  task_id: string;
  wait_seconds?: number;
  kill?: boolean;
}

export function createTaskOutputTool(options: {
  /** 后台任务注册表（装配与 bash/pwsh 共享同一实例）。 */
  background: BackgroundShellRegistry;
  /** spill 目录（<workspace>/.aegent/scratch）与会话身份（Q13 标记）。 */
  scratchDir?: string;
  sessionId?: string;
}): ToolDef {
  const formatTaskOutput = async (
    record: BackgroundTaskRecord,
    snapshot: BackgroundOutput,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const elapsedMs = Date.now() - record.startedAt;
    const statusLine =
      `task_id: ${record.taskId} | shell: ${record.shell} | status: ${snapshot.status}` +
      (snapshot.exitCode !== undefined ? ` | exit code: ${String(snapshot.exitCode)}` : "") +
      ` | elapsed: ${String(Math.round(elapsedMs / 100) / 10)}s`;
    const formatted = await formatShellOutput({
      stdout: { raw: snapshot.stdout, omittedBytes: snapshot.stdoutOmittedBytes },
      stderr: { raw: snapshot.stderr, omittedBytes: snapshot.stderrOmittedBytes },
      exitCode: snapshot.exitCode ?? 0,
      ...(options.scratchDir !== undefined ? { scratchDir: options.scratchDir } : {}),
      label: record.taskId,
      sessionId: options.sessionId ?? "unknown-session",
      tool: "task_output",
      callId: ctx.toolCallId,
    });
    return {
      content: `${statusLine}\n${formatted.text}`,
      // 非零退出码只在自然结束时算失败（kill 是请求的结果，exit code 1
      // 是 Windows taskkill /F 的正常终止码——不是错误）
      ...(snapshot.exitCode !== undefined &&
      snapshot.exitCode !== 0 &&
      snapshot.status === "completed"
        ? { isError: true as const }
        : {}),
      meta: {
        task_id: record.taskId,
        status: snapshot.status,
        ...formatted.meta,
      },
    };
  };

  return {
    name: "task_output",
    parameters: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "Background task id returned by bash/pwsh run_in_background.",
        },
        wait_seconds: {
          type: "number",
          description:
            "If the task is still running, wait up to this many seconds before returning (0-300, default 0 = immediate snapshot).",
        },
        kill: {
          type: "boolean",
          description: "Terminate the task (process tree) and return its final output.",
        },
      },
      required: ["task_id"],
    },
    async execute(args, ctx: ToolContext) {
      const { task_id, wait_seconds, kill } = args as Partial<TaskOutputArgs>;
      if (typeof task_id !== "string" || task_id === "") {
        return toolError("TaskOutputError", "INVALID_ARGUMENTS", "task_output 需要 task_id（非空字符串）");
      }
      if (
        wait_seconds !== undefined &&
        (!Number.isFinite(wait_seconds) || wait_seconds < 0 || wait_seconds > MAX_WAIT_SECONDS)
      ) {
        return toolError(
          "TaskOutputError",
          "INVALID_ARGUMENTS",
          `wait_seconds 必须是 0-${String(MAX_WAIT_SECONDS)} 的秒数，收到 ${String(wait_seconds)}`,
        );
      }
      const record = options.background.get(task_id);
      if (record === undefined) {
        options.background.prune();
        const available = options.background.list().map((r) => r.taskId);
        return toolError(
          "TaskOutputError",
          "TASK_NOT_FOUND",
          `未知 task_id：${task_id}。可用任务：${available.length > 0 ? available.join(", ") : "（无）"}`,
        );
      }
      if (kill === true) {
        if (record.handle.output().status === "running") {
          await record.handle.kill();
          // kill 返回即 close 已到位（env 层保证）——wait 幂等兜底终态快照
          await record.handle.wait();
        }
        return formatTaskOutput(record, record.handle.output(), ctx);
      }
      // 轮询等待：running 且 wait_seconds > 0 时 race（到点取快照，不等死）
      let snapshot = record.handle.output();
      if (snapshot.status === "running" && wait_seconds !== undefined && wait_seconds > 0) {
        await Promise.race([
          record.handle.wait(),
          new Promise<void>((resolve) => setTimeout(resolve, wait_seconds * 1000)),
        ]);
        snapshot = record.handle.output();
      }
      return formatTaskOutput(record, snapshot, ctx);
    },
  };
}
