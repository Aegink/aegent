/**
 * plan_enter / plan_exit 工具（G1/G4，T-P1-11/13）——plan 模式进出的显式
 * 动作（opencode 同款双工具；提示词独立文件 plan_enter.txt / plan_exit.txt，
 * T-4-01 描述分离基建）。状态变更经注入的 PlanModeService（内存态即时
 * 生效）；流内事实 = 本调用的 tool/call + tool/result（不扩词汇表，见
 * plan-mode.ts 头注释）。两工具默认 ask（不在 meta-ops 白名单）——进出
 * 都要用户批准，opencode plan_exit 的 question.ask 同语义。
 *
 * plan_enter / plan_exit 不在 WRITE_EXECUTE_TOOLS——plan 模式硬关期间
 * 进出通道保持开放（否则硬关不可逆）。
 *
 * G4（T-P1-13）：plan_exit 可携带 `plan` 计划文本——用户批准退出 = 计划
 * 批准结算，经注入的 savePlanArtifact 落盘 artifact + 记
 * checkpoint{provider:"plan", ref:{path}} 事件（装配闭包：文件失败则不落
 * checkpoint，绝不产生指向不存在文件的引用）。
 */

import type { ToolDef } from "../../src/core/index.js";
import type { PlanModeService } from "../../src/ext-builtin/prompt-defaults/plan-mode.js";
import { toolError } from "./util.js";

export function createPlanEnterTool(options: { planMode: PlanModeService }): ToolDef {
  return {
    name: "plan_enter",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
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

export function createPlanExitTool(options: {
  planMode: PlanModeService;
  /** G4 计划落盘出口（装配注入）；缺省 = plan 参数不生效（仅退出）。 */
  savePlanArtifact?: (plan: string) => { path: string };
}): ToolDef {
  return {
    name: "plan_exit",
    parameters: {
      type: "object",
      properties: {
        plan: {
          type: "string",
          description:
            "最终计划文本（可选）。用户批准退出时作为持久 artifact 落盘并记 checkpoint 事件，重启后仍可读",
        },
      },
    },
    async execute(args) {
      const plan = args.plan;
      if (plan !== undefined && (typeof plan !== "string" || plan.trim() === "")) {
        return toolError(
          "PlanError",
          "INVALID_ARGUMENTS",
          "plan 必须是非空字符串（无需提交计划时省略该参数）",
        );
      }
      const wasActive = options.planMode.isActive;
      options.planMode.exit();
      let artifactNote = "";
      if (typeof plan === "string" && options.savePlanArtifact !== undefined) {
        const { path } = options.savePlanArtifact(plan);
        artifactNote = `计划已落盘：${path}`;
      } else if (typeof plan === "string") {
        artifactNote = "计划未落盘（当前装配无 artifact 目录）。";
      }
      return {
        content: wasActive
          ? `已退出计划模式：写/执行类工具恢复按权限策略裁决。${artifactNote}`
          : `当前不在计划模式（无需退出）。${artifactNote}`.trim(),
      };
    },
  };
}
