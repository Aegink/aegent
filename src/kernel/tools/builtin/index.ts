/**
 * 内置工具注册入口（B3）：装配处一行把内置工具挂上注册表。
 * P0 六个 = read/write/bash（T-4-02）+ edit/glob/grep（T-4-03）。
 *
 * 路径守卫（T-6-01）：四个文件工具（read/write/edit/bash）类型上必收
 * PathGuard——缺省守卫 = 进程 cwd（装配面可显式注入覆盖）。glob/grep
 * 只读且 P0 读面不限，不接守卫（见 path-guard 头注释 LIMITATIONS #5）。
 */

import { PathGuard } from "../../../sandbox/path-guard.js";
import type { ToolRegistry } from "../registry.js";
import { WriteQueue } from "../write-queue.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createGlobTool } from "./glob.js";
import { createGrepTool } from "./grep.js";
import { createPlanEnterTool, createPlanExitTool } from "./plan.js";
import { createReadTool } from "./read.js";
import { createSkillLoadTool } from "./skill.js";
import { createTodoWriteTool } from "./todo.js";
import { createWriteTool } from "./write.js";
import type { PlanModeService } from "../../plan-mode.js";

/** 内置工具名清单（C45 linter 的 unknown-tool 判定缺省面；与
 * registerBuiltinTools 的注册清单同步维护，新增工具两处都加）。
 * plan_enter/plan_exit 仅在装配启用 plan 模式时注册（T-P1-11）。 */
export const BUILTIN_TOOL_NAMES = [
  "read",
  "write",
  "bash",
  "edit",
  "glob",
  "grep",
  "skill_load",
  "todo_write",
  "plan_enter",
  "plan_exit",
] as const;

export function registerBuiltinTools(
  registry: ToolRegistry,
  options: {
    pathGuard?: PathGuard;
    skillsRoot?: string;
    /** G2 todo 落流出口（装配注入）；缺省不注册 todo_write——没有落流
     * 出口的工具执行会违反不变量 1（状态变更无事件承载）。 */
    todoEmit?: (
      items: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>,
    ) => void;
    /** G1 plan 模式服务（装配注入）；缺省不注册 plan 工具——plan 硬关
     * 的出口联动只在 gate 在位的装配生效，单独的工具面是骗局。 */
    planMode?: PlanModeService;
  } = {},
): void {
  const guard = options.pathGuard ?? PathGuard.forWorkspace(process.cwd());
  // B4：write/edit 共享一个写队列（同路径互斥、异路径并行）
  const writeQueue = new WriteQueue();
  for (const def of [
    createReadTool({ pathGuard: guard }),
    createWriteTool({ writeQueue, pathGuard: guard }),
    createBashTool({ pathGuard: guard }),
    createEditTool({ writeQueue, pathGuard: guard }),
    createGlobTool(),
    createGrepTool(),
    // I2 技能面：skillsRoot = 工作区根（agent-process 传 assembly 的
    // workspaceRoot）；缺省进程 cwd（与 pathGuard 缺省同款纪律）
    createSkillLoadTool({
      pathGuard: guard,
      skillsRoot: options.skillsRoot ?? process.cwd(),
    }),
    // G2 todo 面：emit 缺省时不注册（不变量 1——无落流出口的清单写入
    // 就是"直接改状态不写事件"）
    ...(options.todoEmit !== undefined
      ? [createTodoWriteTool({ emit: options.todoEmit })]
      : []),
    // G1 plan 面：planMode 缺省时不注册（plan 硬关出口联动与工具面
    // 绑定装配——有工具无硬关的 plan 模式不可交付）
    ...(options.planMode !== undefined
      ? [
          createPlanEnterTool({ planMode: options.planMode }),
          createPlanExitTool({ planMode: options.planMode }),
        ]
      : []),
  ]) {
    registry.registerTool(def);
  }
}
