/**
 * todo_write 工具（G2 / T-P1-10）——模型维护多步任务清单。每次调用提交
 * **变更后的完整清单**（E12 整值事件，绝非增量）——todo 变更 = 事件
 * （todo/update 落流），状态 = 投影（project.ts 的 todos），不变量 1 同构。
 *
 * 落流经注入的 emit（装配侧 createTodoUpdateEmitter：会话级元事件，turn
 * 挂流内最后轮空流兜 0，session/revert / model/switch 同款）。emit 抛错
 * （流校验拒绝）原样上抛交 registry 兜底 TOOL_EXECUTE_FAILED——事件没落
 * 成功绝不能向模型谎报"已记录"。
 *
 * 权限面：核心层 meta-ops 白名单放行（policy/meta-ops.ts——会话元状态
 * 写入，无工作区副作用）；plan 模式硬关（T-P1-11）在出口级压过白名单。
 * 参数校验 fail-closed：形状坏 / 超上限返回 isError 回喂（模型可自修）。
 */

import type { ToolDef } from "../../src/core/primitives/tools/registry.js";
import { toolError } from "../../src/kernel/tools/builtin/util.js";

const TODO_STATUS_VALUES = ["pending", "in_progress", "completed"] as const;
type TodoStatusValue = (typeof TODO_STATUS_VALUES)[number];

/** 清单规模上限（防上下文滥用；正常多步任务远低于此）。 */
const MAX_ITEMS = 50;
const MAX_CONTENT_CHARS = 500;

export function createTodoWriteTool(options: {
  /** 落流出口：完整清单 → todo/update 事件（装配注入）。 */
  emit: (items: Array<{ content: string; status: TodoStatusValue }>) => void;
}): ToolDef {
  return {
    name: "todo_write",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description:
            "变更后的完整任务清单（整值提交，非增量）。每项 {content, status}，status ∈ pending | in_progress | completed",
          items: {
            type: "object",
            properties: {
              content: { type: "string", description: "任务的一句话描述" },
              status: { type: "string", enum: [...TODO_STATUS_VALUES] },
            },
            required: ["content", "status"],
          },
        },
      },
      required: ["items"],
    },
    async execute(args) {
      const items = args.items;
      if (!Array.isArray(items)) {
        return toolError(
          "TodoError",
          "INVALID_ARGUMENTS",
          "todo_write 需要 items 数组（变更后的完整清单，整值提交）",
        );
      }
      if (items.length > MAX_ITEMS) {
        return toolError(
          "TodoError",
          "INVALID_ARGUMENTS",
          `todo_write 最多 ${MAX_ITEMS} 项（收到 ${items.length} 项）`,
        );
      }
      const validated: Array<{ content: string; status: TodoStatusValue }> = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item === null || typeof item !== "object" || Array.isArray(item)) {
          return toolError(
            "TodoError",
            "INVALID_ARGUMENTS",
            `items[${i}] 必须是 {content, status} 对象`,
          );
        }
        const content = (item as { content?: unknown }).content;
        const status = (item as { status?: unknown }).status;
        if (typeof content !== "string" || content.trim() === "") {
          return toolError(
            "TodoError",
            "INVALID_ARGUMENTS",
            `items[${i}].content 必须是非空字符串`,
          );
        }
        if (content.length > MAX_CONTENT_CHARS) {
          return toolError(
            "TodoError",
            "INVALID_ARGUMENTS",
            `items[${i}].content 超过 ${MAX_CONTENT_CHARS} 字符上限`,
          );
        }
        if (
          typeof status !== "string" ||
          !TODO_STATUS_VALUES.includes(status as TodoStatusValue)
        ) {
          return toolError(
            "TodoError",
            "INVALID_ARGUMENTS",
            `items[${i}].status 必须是 ${TODO_STATUS_VALUES.join(" | ")}（收到 ${JSON.stringify(status)}）`,
          );
        }
        validated.push({ content, status: status as TodoStatusValue });
      }
      options.emit(validated);
      const done = validated.filter((i) => i.status === "completed").length;
      return {
        content: `任务清单已更新（${done}/${validated.length} 完成）。`,
      };
    },
  };
}
