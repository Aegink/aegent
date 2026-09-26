/**
 * 内置工具注册入口（B3）：装配处一行把内置工具挂上注册表。
 * P0 六个 = read/write/bash（T-4-02）+ edit/glob/grep（T-4-03）。
 *
 * 路径守卫（T-6-01）：四个文件工具（read/write/edit/bash）类型上必收
 * PathGuard——缺省守卫 = 进程 cwd（装配面可显式注入覆盖）。glob/grep
 * 只读且 P0 读面不限，不接守卫（见 path-guard 头注释 LIMITATIONS #5）。
 */

import { PathGuard } from "../../../sandbox/path-guard.js";
import type { SandboxBackend, SandboxMode } from "../../../sandbox/backend.js";
import type { PendingApprovals } from "../../../policy/pending.js";
import type { ToolRegistry } from "../registry.js";
import { WriteQueue } from "../write-queue.js";
import { createApplyPatchTool } from "./apply-patch.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createGlobTool } from "./glob.js";
import { createGrepTool } from "./grep.js";
import { createPlanEnterTool, createPlanExitTool } from "./plan.js";
import { createPwshTool } from "./pwsh.js";
import { createQuestionTool, type QuestionToolDeps } from "./question.js";
import { createReadTool } from "./read.js";
import { createSkillLoadTool } from "./skill.js";
import { createTaskTool, type TaskToolDeps } from "./task.js";
import { createTodoWriteTool } from "./todo.js";
import { createToolLoadTool } from "./tool-load.js";
import { createWebfetchTool } from "./webfetch.js";
import { createWriteTool } from "./write.js";
import type { PlanModeService } from "../../plan-mode.js";
import type { NetworkGuard } from "../../../sandbox/network.js";

/** 内置工具名清单（C45 linter 的 unknown-tool 判定缺省面；与
 * registerBuiltinTools 的注册清单同步维护，新增工具两处都加）。
 * plan_enter/plan_exit 仅在装配启用 plan 模式时注册（T-P1-11）。 */
export const BUILTIN_TOOL_NAMES = [
  "read",
  "write",
  "bash",
  "pwsh",
  "edit",
  "apply_patch",
  "glob",
  "grep",
  "skill_load",
  "todo_write",
  "plan_enter",
  "plan_exit",
  "tool_load",
  "webfetch",
  "question",
  "task",
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
    /** G4 计划落盘出口（装配注入，plan_exit 的 plan 参数生效面）。 */
    savePlanArtifact?: (plan: string) => { path: string };
    /**
     * B8a/T-P1-20 网络守卫（D3 唯一网络入口）：提供时注册 webfetch——
     * 无守卫不注册（网络类工具不得直用全局 fetch，能力面绑定装配）。
     */
    networkGuard?: NetworkGuard;
    /**
     * B8b/T-P1-21 question 依赖（与权限审批共用的挂起注册表 + 答复上界）：
     * 提供时注册 question 工具；缺省不注册（无审批基建的装配无问答面）。
     */
    question?: QuestionToolDeps;
    /**
     * H1/H4/T-P1-42 task 依赖（kernel/subagent.ts 的 runner）：提供时注册
     * task 工具；缺省不注册（无子代理运行面的装配零新工具——P0 行为不变）。
     */
    task?: TaskToolDeps;
    /** B18/T-P1-55 bash 超时三档的默认档（秒）；缺省无默认超时（pi 同款）。 */
    bash?: { defaultTimeoutSeconds?: number };
    /** B15/T-P1-58 沙箱装配（backend + 会话默认模式 + 升级审批通道）；
     * 提供时 bash 走 backend.spawn（escalation 生效面），缺省 env 直通。 */
    bashSandbox?: {
      backend: SandboxBackend;
      defaultMode: SandboxMode;
      approvals?: PendingApprovals;
      sessionId?: string;
      approvalTimeoutMs?: number;
    };
  } = {},
): void {
  const guard = options.pathGuard ?? PathGuard.forWorkspace(process.cwd());
  // B4：write/edit 共享一个写队列（同路径互斥、异路径并行）
  const writeQueue = new WriteQueue();
  for (const def of [
    createReadTool({ pathGuard: guard }),
    createWriteTool({ writeQueue, pathGuard: guard }),
    createBashTool({
      pathGuard: guard,
      ...options.bash,
      ...(options.bashSandbox !== undefined ? { sandbox: options.bashSandbox } : {}),
    }),
    // D11（T-P1-28）：PowerShell 一等 shell——与 bash 平行注册（dsh
    // tool-bash/tool-pwsh 同构；Windows 沙箱态宿主正路，见 win32-backend）
    createPwshTool({ pathGuard: guard }),
    createEditTool({ writeQueue, pathGuard: guard }),
    // B8 残余（T-P1-56）：V4A patch 多文件编辑——write/edit 同款写队列
    // 与守卫注入（delete/move 的删除面走 guard.remove）
    createApplyPatchTool({ writeQueue, pathGuard: guard }),
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
          // G4：savePlanArtifact 注入 plan_exit（缺省仅退出、plan 参数不落盘）
          createPlanExitTool({
            planMode: options.planMode,
            ...(options.savePlanArtifact !== undefined
              ? { savePlanArtifact: options.savePlanArtifact }
              : {}),
          }),
        ]
      : []),
    // F12/F14 检索柄（T-P1-17）：常驻清单且自身不可 deferrable——没有
    // deferrable 工具时调用它幂等无害（claude-official ToolSearch 常驻同款）
    createToolLoadTool({ registry }),
    // B8a webfetch（T-P1-20）：networkGuard 提供时才注册（D3 唯一入口，
    // 无守卫的网络工具是骗局）
    ...(options.networkGuard !== undefined
      ? [createWebfetchTool({ guard: options.networkGuard })]
      : []),
    // B8b question（T-P1-21）：审批基建（PendingApprovals）提供时才注册
    //（挂起结算复用同一注册表，无基建的装配无问答面）
    ...(options.question !== undefined
      ? [createQuestionTool(options.question)]
      : []),
    // H1/H4 task（T-P1-42）：子代理运行面（kernel/subagent.ts 的 runner）
    // 提供时才注册——工具可见但深度超限时执行期类型化拒绝（opencode 深度
    // 检查同款，模型可自修）；H5 的 deny 规则是第二道（fail-closed 双保险）。
    ...(options.task !== undefined ? [createTaskTool(options.task)] : []),
  ]) {
    registry.registerTool(def);
  }
}
