/**
 * get_context_remaining 工具（T-P3-174 批次 1，codex 同款）——模型自查
 * 上下文余量。数据源 = 装配的 PressureMonitor（每次模型调用后的权威计量
 * 或本地估算兜底——F10 的调用后压力测量），经装配返回面注入 getter；
 * 缺席不注册（无计量面的装配无自查可给——不造假数字）。
 *
 * 返回文本（codex "只报剩余"的形态加上下文事实）：已用/窗口/剩余三数
 * 一行，模型据此决定收束回复或收尾任务。无计量记录时返回明确"不可知"
 * （turn 首次模型调用前 monitor 无历史——诚实降级而非 0）。
 */

import type { ToolDef } from "../registry.js";
import type { ToolExecutionResult } from "../../loop.js";

/** 上下文用量快照（装配注入——PressureMonitor 最后一条压力记录的投影）。 */
export interface ContextUsageSnapshot {
  /** 最近一次模型调用的已用 token（usage 权威值或本地估算）。 */
  used: number;
  /** 上下文窗口（token）。 */
  contextWindow: number;
}

export function createGetContextRemainingTool(options: {
  usage: () => ContextUsageSnapshot | null;
}): ToolDef {
  return {
    name: "get_context_remaining",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
    parallel: true, // B17：纯读（monitor 只读投影）
    parameters: {
      type: "object",
      properties: {},
    },
    async execute(): Promise<ToolExecutionResult> {
      const snapshot = options.usage();
      if (snapshot === null) {
        return {
          content:
            "Context usage is not available yet (no model call has been measured in this session).",
          meta: { tokensLeft: null as unknown as number },
        } satisfies ToolExecutionResult;
      }
      const remaining = Math.max(0, snapshot.contextWindow - snapshot.used);
      const percent = snapshot.contextWindow > 0
        ? Math.round((snapshot.used / snapshot.contextWindow) * 100)
        : 0;
      return {
        content:
          `Context window: ${String(snapshot.contextWindow)} tokens; used: ${String(snapshot.used)} (${String(percent)}%); remaining: ${String(remaining)} tokens. ` +
          "If remaining is low, wrap up concisely or finish the task.",
        meta: {
          used: snapshot.used,
          contextWindow: snapshot.contextWindow,
          tokensLeft: remaining,
        },
      } satisfies ToolExecutionResult;
    },
  };
}
