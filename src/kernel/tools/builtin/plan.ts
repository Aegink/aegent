/**
 * plan_enter / plan_exit 工具（G1，T-P1-11）——plan 模式进出的显式动作
 * （opencode 同款双工具；提示词独立文件 plan_enter.txt / plan_exit.txt，
 * T-4-01 描述分离基建）。状态变更经注入的 PlanModeService（内存态即时
 * 生效）；流内事实 = 本调用的 tool/call + tool/result（不扩词汇表，见
 * plan-mode.ts 头注释）。两工具默认 ask（不在 meta-ops 白名单）——进出
 * 都要用户批准，opencode plan_exit 的 question.ask 同语义。
 *
 * plan_enter / plan_exit 不在 WRITE_EXECUTE_TOOLS——plan 模式硬关期间
 * 进出通道保持开放（否则硬关不可逆）。
 */

import type { ToolDef } from "../registry.js";
import type { PlanModeService } from "../../plan-mode.js";

export function createPlanEnterTool(options: { planMode: PlanModeService }): ToolDef {
  return {
    name: "plan_enter",
    async execute() {
      const wasActive = options.planMode.isActive;
      options.planMode.enter();
      return {
        content: wasActive
          ? "已处于计划模式。研究类工作继续；写/执行类工具保持硬关。"
          : "已进入计划模式：write/edit/bash/todo_write 等写/执行类工具将被硬关（不可被任何规则授权），read/glob/grep/skill_load 不受影响。完成研究后调用 plan_exit 退出（需用户批准）。",
      };
    },
  };
}

export function createPlanExitTool(options: { planMode: PlanModeService }): ToolDef {
  return {
    name: "plan_exit",
    async execute() {
      const wasActive = options.planMode.isActive;
      options.planMode.exit();
      return {
        content: wasActive
          ? "已退出计划模式：写/执行类工具恢复按权限策略裁决。"
          : "当前不在计划模式（无需退出）。写/执行类工具按权限策略正常裁决。",
      };
    },
  };
}
