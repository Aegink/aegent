/**
 * task 生命周期工具组（T-P3-145 G——pi-desktop TaskWait/TaskList/TaskStop
 * 的我方收敛版）：task 的 run_in_background 启动后台委托后，模型用这三个
 * 工具收割/查看/停止。注册表数据面在 kernel/subagent.ts 的 DelegationsApi
 * （runner 闭包持有）；本文件只做参数校验与结算渲染（与 task.ts 同分工）。
 *
 * 结果正确回流的第二道保证：即使模型从不调用 task_wait，主 loop 的收敛
 * 钩子（agent-process decideTurn 包装）也会在 end 裁决前等全部委托结算并
 * 把报告注入队列——task_wait 只是"主动收割"的快路径。
 */

import { toolError } from "./util.js";
import type { ToolDef } from "../../src/core/index.js";
import type { ToolExecutionResult } from "../../src/core/index.js";
import type { DelegationSnapshot, DelegationsApi } from "../../src/ext-builtin/subagent-engine/subagent.js";

/** 单委托的结算渲染（task_wait 与收敛钩子共用同一形状）。 */
export function renderDelegationReport(d: DelegationSnapshot): string {
  const elapsed = d.settledAt !== undefined ? `${Math.round((d.settledAt - d.startedAt) / 1000)}s` : "?";
  const head = `<task_report id="${d.id}" agent="${d.agentName}" state="${d.status}" session="${d.childSessionId}" elapsed="${elapsed}">`;
  if (d.status === "completed") return `${head}\n${d.report ?? ""}\n</task_report>`;
  return `${head}\n<task_error>\n${d.error ?? d.status}\n</task_error>\n</task_report>`;
}

/** 快照 → JSON 安全投影（ToolExecutionResult.meta 是 JsonValue 闭集——
 * 可选字段的 undefined 不兼容，显式构造 wire 形状）。 */
function toWire(d: DelegationSnapshot): {
  id: string;
  agent: string;
  state: DelegationSnapshot["status"];
  session: string;
  report?: string;
  error?: string;
} {
  return {
    id: d.id,
    agent: d.agentName,
    state: d.status,
    session: d.childSessionId,
    ...(d.report !== undefined ? { report: d.report } : {}),
    ...(d.error !== undefined ? { error: d.error } : {}),
  };
}

/** 在途委托的清单行（task_list）。 */
function renderDelegationRow(d: DelegationSnapshot): string {
  const elapsed = `${Math.round(((d.settledAt ?? Date.now()) - d.startedAt) / 1000)}s`;
  return `- ${d.id} [${d.status}] agent=${d.agentName} 耗时=${elapsed} 子会话=${d.childSessionId} 描述：${d.description}`;
}

export interface TaskLifecycleDeps {
  readonly delegations: DelegationsApi;
}

/** task_wait：等待指定（缺省全部在途）委托收敛并返回报告。 */
export function createTaskWaitTool(deps: TaskLifecycleDeps): ToolDef {
  return {
    name: "task_wait",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
    parallel: false,
    parameters: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "要等待的委托 id（dlg-N；缺省 = 全部在途委托）",
        },
        mode: {
          type: "string",
          enum: ["any", "all"],
          description: "any = 任一目标终态即返回；all（缺省）= 目标全部终态",
        },
        min_completed: {
          type: "number",
          description: "最少完成的委托数（加强条件——未达标继续等）",
        },
        timeout_ms: {
          type: "number",
          description: "等待上限 ms（超时返回当前快照，不杀委托；缺省 300000）",
        },
      },
    },
    async execute(args, ctx): Promise<ToolExecutionResult> {
      const ids = args["ids"];
      if (ids !== undefined && (!Array.isArray(ids) || ids.some((i) => typeof i !== "string" || i === ""))) {
        return toolError("TaskWaitError", "INVALID_ARGUMENTS", "task_wait 的 ids 须为非空字符串数组");
      }
      const mode = args["mode"];
      if (mode !== undefined && mode !== "any" && mode !== "all") {
        return toolError("TaskWaitError", "INVALID_ARGUMENTS", "task_wait 的 mode 须为 any|all");
      }
      const timeoutMs = typeof args["timeout_ms"] === "number" ? args["timeout_ms"] : 300_000;
      const snapshots = await deps.delegations.wait({
        ...(Array.isArray(ids) ? { ids: ids as string[] } : {}),
        ...(mode !== undefined ? { mode } : {}),
        ...(typeof args["min_completed"] === "number" ? { minCompleted: args["min_completed"] } : {}),
        timeoutMs,
      });
      const content =
        snapshots.length === 0
          ? "当前没有在途或已结算的委托（task 启动后台委托后才有）。"
          : snapshots.map(renderDelegationReport).join("\n\n");
      return {
        content,
        meta: { delegations: snapshots.map(toWire) },
      };
    },
  };
}

/** task_list：全部委托状态清单（含运行中）。 */
export function createTaskListTool(deps: TaskLifecycleDeps): ToolDef {
  return {
    name: "task_list",
    parallel: true,
    parameters: { type: "object", properties: {} },
    async execute(): Promise<ToolExecutionResult> {
      const all = deps.delegations.list();
      if (all.length === 0) {
        return { content: "本会话尚无委托记录（task 带 run_in_background 启动后台委托）。" };
      }
      return {
        content: all.map(renderDelegationRow).join("\n"),
        meta: { delegations: all.map(toWire) },
      };
    },
  };
}

/** task_stop：停止指定运行中委托（cancel 子 loop → 结算 stopped）。 */
export function createTaskStopTool(deps: TaskLifecycleDeps): ToolDef {
  return {
    name: "task_stop",
    parallel: false,
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "要停止的委托 id（dlg-N——task_list 可查）" },
      },
      required: ["id"],
    },
    async execute(args): Promise<ToolExecutionResult> {
      const id = args["id"];
      if (typeof id !== "string" || id === "") {
        return toolError("TaskStopError", "INVALID_ARGUMENTS", "task_stop 需要 id（非空字符串）");
      }
      const ok = deps.delegations.stop(id);
      if (!ok) {
        return toolError(
          "TaskStopError",
          "DELEGATION_NOT_RUNNING",
          `委托 ${id} 不存在或已结算（task_list 可查当前状态）`,
        );
      }
      return { content: `已向委托 ${id} 发送停止——结算 stopped（task_wait/task_list 可查收尾）。` };
    },
  };
}
