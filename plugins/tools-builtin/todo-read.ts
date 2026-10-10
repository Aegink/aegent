/**
 * todo_read 工具（T-P3-172 需求 1 补齐面——zcode TodoReadInputSchema 同款
 * `{}` 空参）：读回当前会话的任务清单投影。todo_write 整值提交 + 本工具
 * 读回 = 模型在长任务里核对进度的自检面（重启/压缩后尤其有用）。
 * 数据源 = 装配注入的投影 getter（与 todo_write 的 emit 同源——
 * effectiveEvents 折叠最后一条 todo/update，revert 切点语义一致）。
 * 缺省不注入 getter = 不注册（最小装配零新工具，P0 行为不变）。
 * 只读（B17 parallel）。
 */

import { toolError } from "./util.js";
import type { ToolDef } from "../../src/core/index.js";

export interface ProjectionTodo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export function createTodoReadTool(options: {
  /** 投影 getter（装配注入——返回当前清单，空清单返回 []）。 */
  todosRead: () => Array<ProjectionTodo>;
}): ToolDef {
  return {
    name: "todo_read",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
    parallel: true,
    parameters: {
      type: "object",
      properties: {},
    },
    async execute() {
      try {
        const items = options.todosRead();
        if (items.length === 0) {
          return { content: "当前没有任务清单（todo_write 创建后可读回）。" };
        }
        const statusLabel = { pending: "[ ]", in_progress: "[~]", completed: "[x]" } as const;
        const lines = items.map((t) => `${statusLabel[t.status] ?? "[ ]"} ${t.content}`);
        const done = items.filter((t) => t.status === "completed").length;
        lines.push("", `共 ${String(items.length)} 项，已完成 ${String(done)}`);
        return { content: lines.join("\n") };
      } catch (e) {
        return toolError("TodoReadError", "READ_FAILED", e instanceof Error ? e.message : String(e));
      }
    },
  };
}
