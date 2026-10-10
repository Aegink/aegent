/**
 * 内置工具注册入口（B3）：装配处一行把内置工具挂上注册表。
 * P0 六个 = read/write/bash（T-4-02）+ edit/glob/grep（T-4-03）。
 *
 * 路径守卫（T-6-01）：四个文件工具（read/write/edit/bash）类型上必收
 * PathGuard——缺省守卫 = 进程 cwd（装配面可显式注入覆盖）。glob/grep
 * 只读且 P0 读面不限，不接守卫（见 path-guard 头注释 LIMITATIONS #5）。
 */

import { PathGuard } from "../../src/sandbox/path-guard.js";
import type { SandboxBackend, SandboxMode } from "../../src/core/index.js";
import { PendingApprovals } from "../../src/policy/pending.js";
import { createNetworkGuard } from "../../src/sandbox/network.js";
import { createPlanModeService } from "../../src/ext-builtin/prompt-defaults/plan-mode.js";
import { ToolRegistry } from "../../src/core/index.js";
import { WriteQueue } from "../../src/core/index.js";
import { BackgroundShellRegistry } from "../../src/core/index.js";
import type { AttachmentStore } from "../../src/core/index.js";
import { createApplyPatchTool } from "./apply-patch.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createGetContextRemainingTool, type ContextUsageSnapshot } from "./get-context-remaining.js";
import { createGlobTool } from "./glob.js";
import { createGrepTool } from "./grep.js";
import { createLspTool, type LspClientFor } from "./lsp.js";
import { createNotebookEditTool } from "./notebook-edit.js";
import { createPlanEnterTool, createPlanExitTool } from "./plan.js";
import { createPwshTool } from "./pwsh.js";
import { createQuestionTool, type QuestionToolDeps } from "./question.js";
import { createReadTool } from "./read.js";
import { createSaveMemoryTool } from "./save-memory.js";
import {
  createSessionGetTool,
  createSessionQueryTool,
  type SessionQueryToolDeps,
} from "./session-query.js";
import { createSkillLoadTool } from "./skill.js";
import { createPluginCreateTool } from "./plugin-create.js";
import { createPluginDefineTool } from "./plugin-define.js";
import { createTaskOutputTool } from "./task-output.js";
import { createTaskTool, type TaskToolDeps } from "./task.js";
import {
  createTaskWaitTool,
  createTaskListTool,
  createTaskStopTool,
  type TaskLifecycleDeps,
} from "./task-lifecycle.js";
import { createTodoReadTool, type ProjectionTodo } from "./todo-read.js";
import { createTodoWriteTool } from "./todo.js";
import { createToolLoadTool } from "./tool-load.js";
import { createViewImageTool } from "./view-image.js";
import { createWebSearchTool } from "./web-search.js";
import { createWebfetchTool } from "./webfetch.js";
import { createWriteTool } from "./write.js";
import { createLsTool } from "./ls.js";
import { createCurrentTimeTool } from "./current-time.js";
import type { PlanModeService } from "../../src/ext-builtin/prompt-defaults/plan-mode.js";
import type { NetworkGuard } from "../../src/sandbox/network.js";


/** 内置工具名清单（C45 linter 的 unknown-tool 判定缺省面；与
 * registerBuiltinTools 的注册清单同步维护，新增工具两处都加）。
 * plan_enter/plan_exit 仅在装配启用 plan 模式时注册（T-P1-11）。
 * T-P3-174 批次 1：+task_output/view_image/get_context_remaining/
 * save_memory/notebook_edit（view_image/get_context_remaining 随装配
 * 条件注册——附件面/计量面缺席不注册）。 */
export const BUILTIN_TOOL_NAMES = [
  "read",
  "write",
  "bash",
  "pwsh",
  "edit",
  "apply_patch",
  "lsp",
  "glob",
  "grep",
  "skill_load",
  "todo_write",
  "plan_enter",
  "plan_exit",
  "tool_load",
  "webfetch",
  "web_search",
  "ls",
  "current_time",
  "todo_read",
  "question",
  "task",
  "session_query",
  "session_get",
  "plugin_create",
  "plugin_define",
  "task_output",
  "view_image",
  "get_context_remaining",
  "save_memory",
  "notebook_edit",
] as const;

export function registerBuiltinTools(
  registry: ToolRegistry,
  options: {
    pathGuard?: PathGuard;
    skillsRoot?: string;
    /** U22/T-P3-125：附加技能来源目录（settings skills.roots 装配消费）。 */
    skillsRoots?: readonly string[];
    /** U22/T-P3-125：停用技能名单（settings skills.disabled 装配消费）。 */
    skillsDisabled?: readonly string[];
    /** T-P3-148 D：插件贡献技能目录（getter——插件装载晚于注册，调用时活读）。 */
    pluginSkillDirs?: () => readonly { readonly dir: string; readonly namePrefix: string }[];
    /**
     * T-P3-148 I：插件创建工具依赖（workspaceRoot——写面收敛
     * `<workspace>/plugins/<slug>`；缺省不注册——无工作区装配无创建面）。
     */
    pluginCreate?: { workspaceRoot: string };
    /**
     * T-P3-148 X：动态插件定义依赖（toolRegistry + 句柄汇——重启即失的
     * 进程内插件；缺省不注册——无装配面无动态定义）。
     */
    pluginDefine?: {
      toolRegistry: import("../../src/core/index.js").ToolRegistry;
      handles: { dispose(): Promise<void> }[];
    };
    /** G2 todo 落流出口（装配注入）；缺省不注册 todo_write——没有落流
     * 出口的工具执行会违反不变量 1（状态变更无事件承载）。 */
    todoEmit?: (
      items: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>,
    ) => void;
    /** T-P3-172：todo 投影 getter（todo_read 注入面——与 todoEmit 同源
     * 的投影读面；缺省不注册 todo_read）。 */
    todosRead?: () => Array<ProjectionTodo>;
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
    /**
     * T-P3-145 G：task 生命周期工具依赖（后台委托注册表——与 task 同源
     * 注入；缺省不注册 = 无后台委托面零新工具）。
     */
    taskWait?: TaskLifecycleDeps;
    taskList?: TaskLifecycleDeps;
    taskStop?: TaskLifecycleDeps;
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
    /**
     * T-P3-140 批次 A：pwsh 的沙箱装配切片（同一后端 + 活 defaultMode，
     * 无升级面——升级只在 bash 一侧）。提供时 pwsh 走 backend.spawn。
     */
    pwshSandbox?: {
      backend: SandboxBackend;
      defaultMode: SandboxMode;
    };
    /** B8b/T-P1-60 lsp 的 server 解析面（按文件路径返回客户端）；缺省无 server。 */
    lspClientFor?: LspClientFor;
    /**
     * Q2/T-P2-105 会话查询（dbPath 提供时才注册 session_query/session_get——
     * 无持久库的装配无历史可查；只读类，不落流）。
     */
    sessionQuery?: SessionQueryToolDeps;
    /**
     * T-P3-174 批次 1：后台 shell 任务注册表（bash/pwsh 的 run_in_background
     * 与 task_output 共享同一实例）。缺省工厂内置一个（无 dispose 挂钩——
     * 测试/最小装配面）；生产装配从 agent-process 注入以获得会话收尾 kill。
     */
    backgroundShell?: BackgroundShellRegistry;
    /**
     * T-P3-174 批次 1：shell 输出 spill 目录（`<workspace>/.aegent/scratch`）
     * 与 Q13 标记的会话身份（bash/pwsh/task_output 共用）。缺省不落盘只截断。
     */
    shellScratchDir?: string;
    /** T-P3-174 批次 1：Q13 spill 标记的会话身份（缺省 unknown-session）。 */
    sessionId?: string;
    /** T-P3-174 批次 1：相对路径解析基（view_image/notebook_edit）。 */
    workspaceRoot?: string;
    /** T-P3-174 批次 1：save_memory 的目标文件（缺省 ~/.aegent/memory/MEMORY.md）。 */
    memoryPath?: string;
    /**
     * T-P3-174 批次 1：附件 store（view_image 的字节落点；缺省不注册
     * view_image——无附件面的装配无图片注入通道）。
     */
    attachments?: AttachmentStore;
    /**
     * T-P3-174 批次 1：上下文计量快照（get_context_remaining 数据源——
     * 装配 PressureMonitor 的投影；缺省不注册，无计量面不造假数字）。
     */
    contextUsage?: () => ContextUsageSnapshot | null;
  } = {},
): void {
  const guard = options.pathGuard ?? PathGuard.forWorkspace(process.cwd());
  // B4：write/edit 共享一个写队列（同路径互斥、异路径并行）
  const writeQueue = new WriteQueue();
  // T-P3-174 批次 1：后台任务注册表（bash/pwsh/task_output 共享同一实例）
  const backgroundRegistry = options.backgroundShell ?? new BackgroundShellRegistry();
  for (const def of [
    createReadTool({ pathGuard: guard }),
    createWriteTool({ writeQueue, pathGuard: guard }),
    createBashTool({
      pathGuard: guard,
      ...options.bash,
      ...(options.shellScratchDir !== undefined ? { scratchDir: options.shellScratchDir } : {}),
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
      background: backgroundRegistry,
      ...(options.bashSandbox !== undefined ? { sandbox: options.bashSandbox } : {}),
    }),
    // D11（T-P1-28）：PowerShell 一等 shell——与 bash 平行注册（dsh
    // tool-bash/tool-pwsh 同构；Windows 沙箱态宿主正路，见 win32-backend）
    createPwshTool({
      pathGuard: guard,
      ...(options.shellScratchDir !== undefined ? { scratchDir: options.shellScratchDir } : {}),
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
      background: backgroundRegistry,
      ...(options.pwshSandbox !== undefined ? { sandbox: options.pwshSandbox } : {}),
    }),
    createEditTool({ writeQueue, pathGuard: guard }),
    // B8 残余（T-P1-56）：V4A patch 多文件编辑——write/edit 同款写队列
    // 与守卫注入（delete/move 的删除面走 guard.remove）
    createApplyPatchTool({ writeQueue, pathGuard: guard }),
    // B8b（T-P1-60）：语言服务查询——clientFor 缺省 undefined = 无 server
    //（工具恒注册，执行时类型化报错；装配提供按扩展名解析的 client 面）
    createLspTool({ pathGuard: guard, ...(options.lspClientFor ? { clientFor: options.lspClientFor } : {}) }),
    createGlobTool(),
    createGrepTool(),
    // I2 技能面：skillsRoot = 工作区根（agent-process 传 assembly 的
    // workspaceRoot）；缺省进程 cwd（与 pathGuard 缺省同款纪律）。
    // U22/T-P3-125：roots 多根 + disabled 停用（settings skills 段装配消费）
    createSkillLoadTool({
      pathGuard: guard,
      skillsRoot: options.skillsRoot ?? process.cwd(),
      ...(options.skillsRoots !== undefined ? { skillsRoots: options.skillsRoots } : {}),
      ...(options.skillsDisabled !== undefined ? { skillsDisabled: options.skillsDisabled } : {}),
      ...(options.pluginSkillDirs !== undefined ? { pluginSkillDirs: options.pluginSkillDirs } : {}),
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
    // T-P3-172 web_search（需求 1 工具补齐）：webfetch 同款 networkGuard
    // 门控（D3 唯一入口）——Exa 托管搜索免 key 可用
    ...(options.networkGuard !== undefined
      ? [createWebSearchTool({ guard: options.networkGuard })]
      : []),
    // T-P3-172：ls/current_time 零依赖常驻（看目录/对齐时间锚点的高频面）
    createLsTool(),
    createCurrentTimeTool(),
    // T-P3-172 todo_read：投影 getter 提供时才注册（与 todo_write 对偶）
    ...(options.todosRead !== undefined ? [createTodoReadTool({ todosRead: options.todosRead })] : []),
    // B8b question（T-P1-21）：审批基建（PendingApprovals）提供时才注册
    //（挂起结算复用同一注册表，无基建的装配无问答面）
    ...(options.question !== undefined
      ? [createQuestionTool(options.question)]
      : []),
    // H1/H4 task（T-P1-42）：子代理运行面（kernel/subagent.ts 的 runner）
    // 提供时才注册——工具可见但深度超限时执行期类型化拒绝（opencode 深度
    // 检查同款，模型可自修）；H5 的 deny 规则是第二道（fail-closed 双保险）。
    ...(options.task !== undefined ? [createTaskTool(options.task)] : []),
    // T-P3-145 G：task_wait/list/stop（后台委托收割/查看/停止——与 task
    // 同源注册；无 delegations 不注册）
    ...(options.taskWait !== undefined ? [createTaskWaitTool(options.taskWait)] : []),
    ...(options.taskList !== undefined ? [createTaskListTool(options.taskList)] : []),
    ...(options.taskStop !== undefined ? [createTaskStopTool(options.taskStop)] : []),
    // Q2/T-P2-105 会话查询工具（dbPath 提供时才注册——无库无历史面；
    // 两工具都是只读类：SQL 检索 + 单会话读取，零落流）
    ...(options.sessionQuery !== undefined
      ? [createSessionQueryTool(options.sessionQuery), createSessionGetTool(options.sessionQuery)]
      : []),
    // T-P3-148 I：插件创建工具（工作区装配在位才注册——写面收敛
    // `<workspace>/plugins/<slug>`；生成不自动装载，走插件中心审批链）
    ...(options.pluginCreate !== undefined ? [createPluginCreateTool(options.pluginCreate)] : []),
    // T-P3-148 X：动态插件定义（进程内、重启即失——审批走工具调用权限面）
    ...(options.pluginDefine !== undefined ? [createPluginDefineTool(options.pluginDefine)] : []),
    // T-P3-174 批次 1：task_output（bash/pwsh run_in_background 的查询/kill
    // 面——零依赖常驻，与 bash/pwsh 共享同一后台注册表）
    createTaskOutputTool({
      background: backgroundRegistry,
      ...(options.shellScratchDir !== undefined ? { scratchDir: options.shellScratchDir } : {}),
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    }),
    // T-P3-174 批次 1：view_image（附件 store 在位才注册——无附件面的装配
    // 无图片注入通道；字节进 store、事件追加在 loop）
    ...(options.attachments !== undefined
      ? [
          createViewImageTool({
            attachments: options.attachments,
            pathGuard: guard,
            ...(options.workspaceRoot !== undefined ? { workspaceRoot: options.workspaceRoot } : {}),
          }),
        ]
      : []),
    // T-P3-174 批次 1：get_context_remaining（计量快照提供时才注册——
    // 无计量面的装配不造假数字）
    ...(options.contextUsage !== undefined
      ? [createGetContextRemainingTool({ usage: options.contextUsage })]
      : []),
    // T-P3-174 批次 1：save_memory（零依赖常驻——C2 记忆索引挂点的追加面）
    createSaveMemoryTool({
      ...(options.memoryPath !== undefined ? { memoryPath: options.memoryPath } : {}),
    }),
    // T-P3-174 批次 1：notebook_edit（与 write/edit 同写队列 + 守卫）
    createNotebookEditTool({
      writeQueue,
      pathGuard: guard,
      ...(options.workspaceRoot !== undefined ? { workspaceRoot: options.workspaceRoot } : {}),
    }),
  ]) {
    registry.registerTool(def);
  }
}

/**
 * 内置工具参数名表（C40 linter 的 knownToolParams 缺省面，T-P2-201）：
 * 工具名 → 参数 schema 的属性名清单。从真实注册 schema 派生（一次性构造
 * 桩依赖注册表后读 toChatTools——单一事实源，schema 漂移免疫；桩依赖只
 * 被闭包捕获、永不执行），模块级缓存（内置工具工厂是静态面）。
 * 无 properties 的工具不入表——linter 对无 schema 条目的工具跳过参数名
 * 警告（宁可漏报不误报）。
 */
let builtinParamNamesCache: Readonly<Record<string, readonly string[]>> | undefined;

export function builtinToolParamNames(): Readonly<Record<string, readonly string[]>> {
  if (builtinParamNamesCache !== undefined) return builtinParamNamesCache;
  const registry = new ToolRegistry();
  registerBuiltinTools(registry, {
    todoEmit: () => {},
    planMode: createPlanModeService(),
    savePlanArtifact: () => ({ path: "stub" }),
    networkGuard: createNetworkGuard({ policy: "deny" }),
    question: { pending: new PendingApprovals(), sessionId: "param-names", timeoutMs: 1 },
    task: {
      runSubagent: async () => ({
        kind: "foreground",
        result: {
          sessionId: "stub",
          stopReason: "cancelled",
          output: "",
        },
      }),
    },
    sessionQuery: { dbPath: "stub" },
    pluginCreate: { workspaceRoot: "stub" },
    pluginDefine: {
      toolRegistry: new ToolRegistry(),
      handles: [],
    },
    // T-P3-174 批次 1：条件注册面（attachments/contextUsage）的桩——
    // param-names 表必须覆盖全部可注册工具（schema 漂移免疫同纪律）
    attachments: new (class {
      save() {
        return { attachmentId: "stub", mediaType: "image/png", size: 0 };
      }
      read() {
        return null;
      }
    })() as AttachmentStore,
    contextUsage: () => null,
  });
  const out: Record<string, readonly string[]> = {};
  for (const tool of registry.toChatTools()) {
    const params = tool.parameters as
      | { properties?: Record<string, unknown> }
      | undefined;
    if (params?.properties !== undefined && typeof params.properties === "object") {
      out[tool.name] = Object.keys(params.properties);
    }
  }
  builtinParamNamesCache = Object.freeze(out);
  return builtinParamNamesCache;
}
