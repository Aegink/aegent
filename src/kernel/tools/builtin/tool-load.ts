/**
 * tool_load 工具（F12/F14，T-P1-17）——延迟加载工具的检索柄：模型按名
 * 索要某个 deferrable 工具的完整参数 schema，索取后该 schema 出现在后续
 * 请求的工具清单里（skill_load 的同构面：清单可见 → 按名取全量）。
 * 本工具自身**不可** deferrable——它是唯一检索入口，必须常驻清单
 * （claude-official ToolSearch 的"select:<tool_name>"直接选择同语义，
 * 关键词检索不做——F12 最小面按名索取，检索式延迟加载是 F12 的扩展位）。
 */

import type { ToolDef } from "../registry.js";
import type { ToolRegistry } from "../registry.js";
import { toolError } from "./util.js";

export function createToolLoadTool(options: { registry: ToolRegistry }): ToolDef {
  return {
    name: "tool_load",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "要索取完整参数 schema 的工具名（清单中带 [deferred] 标记的工具）",
        },
      },
      required: ["name"],
    },
    async execute(args) {
      const name = args.name;
      if (typeof name !== "string" || name === "") {
        return toolError("ToolLoadError", "INVALID_ARGUMENTS", "tool_load 需要 name（非空字符串）");
      }
      if (!options.registry.has(name)) {
        return toolError("ToolLoadError", "TOOL_NOT_FOUND", `未注册的工具：${name}`);
      }
      const outcome = options.registry.requestToolSchema(name);
      return {
        content:
          outcome === "loaded"
            ? `工具 ${name} 的完整参数 schema 已加载，后续请求可见`
            : `工具 ${name} 的参数 schema 已在当前工具清单中`,
      };
    },
  };
}
