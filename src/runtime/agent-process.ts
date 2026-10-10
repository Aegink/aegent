/**
 * agent 出进程（T9 / Q16）——子进程入口 + 父进程句柄，走真实 stdio JSON 行
 * 协议（agent-protocol.ts）。入口类型签名只收 JsonValue 可序列化值：跨进程
 * 不传函数、不传引用，子进程的装配由入口自身完成（P0 内置 echo provider，
 * 真实厂商装配在 T-8 CLI 端）。
 *
 * 子进程的编排面（本文件 childScheduler）是 A9 "turn 只能入队"的进程级落点：
 * - prompt 到达即回 `accepted` 收执（不等轮结束——无 per-prompt 完成语义）；
 *   有轮在跑就进 PromptQueue（成为本轮 step 边界的 steer），空闲就开新轮，
 *   轮结束后自动从队列续开（kick 调度器，单线程无锁）；
 * - 没有 session.finished；轮终态经事件流自然可见。
 *
 * 冷启动纪律（Q16）：spawn → 首个会话事件要实测（scripts/cold-start.mjs），
 * <500ms（§6.2）。子进程图里不含 better-sqlite3（InMemory store），原生模块
 * 不进冷启动路径。
 */

import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import type { CancelCause, SessionRef, TurnEndReason } from "../kernel/events.js";
import { type AgentLoopDeps, type ToolExecutionMode } from "../kernel/loop.js";
import { createLoop } from "../core/index.js";
import { PromptQueue, QueueFullError } from "../kernel/queue.js";
import { BackgroundShellRegistry } from "../kernel/tools/background-shell.js";
import { validateAttachments, AttachmentLimitError } from "../attachments/limits.js";
import { base64ByteLength } from "../attachments/store.js";
import type { AttachmentRef, AttachmentStore } from "../core/index.js";
import { offloadOldestImages } from "../attachments/offload.js";
import { effectiveEvents } from "../session/messages.js";
import {
  ReferenceError,
  assertNoReferenceCycle,
  refsOfEvents,
} from "../session/reference.js";
import { ToolClassLimiter, TurnAdmission } from "../kernel/admission.js";
import { isWriteExecuteTool } from "../policy/protected-paths.js";
import { SessionConfigStore, type ApprovalMode, StaticConfigImmutableError } from "../kernel/session-config.js";
import type { RetryObservation } from "../models/retry.js";
import {
  type AgentMessage,
  type AgentRequest,
  EXIT_PROTOCOL_MISMATCH,
  ProtocolError,
  PROTOCOL_VERSION,
  ProtocolHandshakeError,
  type ServerHello,
  createLineSplitter,
  decodeClientHello,
  decodeMessage,
  decodeRequest,
  decodeServerHello,
  encodeFrame,
} from "../kernel/agent-protocol.js";
import type { ApprovalAnnouncement } from "../policy/pending.js";
import type { ChatRequest, ModelProvider } from "../models/provider.js";
import type { ModelIdentity } from "../models/identity.js";
import {ForkError, InMemoryEventStorage, type EventStorage, SessionEventStore, type SessionStore} from "../session/store.js";
import { InvalidSessionIdError, isValidSessionId } from "../session/session-id.js";
import { Projector, ProjectError } from "../session/project.js";
import { findInterruptedTurn, reconcileBootState } from "../session/boot-maintenance.js";
import { RawChunkLog } from "../kernel/raw-chunk-log.js";
import { loadSkillsFromRoots } from "../kernel/skills.js";
import {
  createChildAssembly,
  createTodoReadGetter,
  createTodoUpdateEmitter,
  type ChildAssembly,
  type ChildAssemblyOptions,
} from "../kernel/assembly.js";
import { evaluateToolPolicy } from "../policy/gate.js";
import { ModelNotRegisteredError } from "../kernel/model-switch.js";
import { createSubagentRunner } from "../kernel/subagent.js";
import { registerBuiltinTools } from "../kernel/tools/builtin/index.js";
import { createBrowserTools } from "../scheduler/browser.js";
import { connectPanelBrowser, panelDataDir } from "../scheduler/browser-panel.js";
import { createComputerTools } from "../scheduler/computer.js";
import { createWin32ComputerRun } from "../scheduler/computer-win32.js";
import { NodeExecutionEnv } from "../kernel/tools/env.js";
import { ToolRegistry } from "../kernel/tools/registry.js";
import { DEFAULT_SPILL_DIR } from "../kernel/tools/truncate.js";
import { sweepSessionSpill } from "../kernel/tools/spill-gc.js";
import { connectAndRegister } from "../mcp/registry-bridge.js";
import { loadConfiguredPlugins } from "../kernel/plugin-loader.js";
import { loadSettings, THINKING_LEVELS } from "../session/settings.js";
import { parseCommandArgs, parseSlashInvocation, substituteArgs } from "../kernel/prompt-args.js";
import {
  BUILTIN_PROMPT_TEMPLATES,
  lookupPromptTemplate,
  expandShellInjections,
  expandFileReferences,
  type PromptTemplateSummary,
} from "../kernel/prompts.js";
import { runPromptPolish } from "../kernel/prompt-polish.js";

// ---------------------------------------------------------------------------
// echo provider（P0 子进程内置：回声最后一条 user 消息；协议与进程全真）
// ---------------------------------------------------------------------------

export function echoProvider(): ModelProvider {
  return {
    async *streamChat(req: ChatRequest) {
      let last = "";
      for (const m of req.messages) {
        if (m.role === "user") last = m.content;
      }
      yield { type: "text-delta", text: `echo: ${last}` };
      yield { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } };
      yield { type: "done" };
    },
  };
}

// ---------------------------------------------------------------------------
// 子进程侧：读 stdin 行 → 分发 → 写 stdout 事件行
// ---------------------------------------------------------------------------

export interface AgentChildOptions {
  sessionId?: string;
  /** E14/T-P1-90 原始分片日志目录（缺省不写——旁路通道按需开启）。 */
  rawLogDir?: string;
  /**
   * U17/T-P3-119：MCP server 清单（settings mcp 段 enabled 条目——agent-child
   * 传入）。装配期连接注册，工具名 `<server>__<tool>` 进注册表（与 builtin
   * 同轨）；单 server 失败 warn 跳过不炸启动。缺省无 = 零 MCP 面（行为不变）。
   */
  mcpServers?: import("../session/settings.js").McpServerEntry[];
  /**
   * T-P3-133：插件装载清单（settings plugins 段 enabled 条目——agent-child
   * 传入）。装配期装载（inprocess import / ws 连接），工具以
   * `<插件名>__<工具名>` 命名空间进注册表；单插件失败 never-fail 跳过。
   */
  plugins?: import("../session/settings.js").PluginEntry[];
  /**
   * T-P3-148 热加载：settings.json 路径（plugins/reload 协议请求时现读最新
   * 清单做 diff 重装载；缺席 = 无重载面，类型化拒绝）。
   */
  settingsPath?: string;
  /**
   * U23/T-P3-126：子代理预设配置（settings subagents 段——用户覆盖与
   * 自定义清单；内置五预设由 resolveSubagent 常量兜底）+ 独立模型解析
   * （agent-child 按 resolveSubagentModel 链从 models 注册表取）。
   */
  subagents?: {
    defs?: import("../session/subagents-config.js").SubagentDefinition[];
    resolveModel?: (
      subagent: import("../session/subagents-config.js").ResolvedSubagent,
    ) => { provider: ModelProvider; identity: ModelIdentity } | undefined;
  };
  /**
   * C4：外部子代理后端表（agent-child 按 settings subagentBackend 段装配
   * ——acp 后端经 spawnAcpTransport/createAcpBackend 构造后注入）。缺省
   * undefined = 仅进程内 fork（既有行为零变化）。
   */
  externalBackends?: import("../kernel/subagent.js").SubagentRunnerDeps["externalBackends"];
  /**
   * S4：计算机使用门控（settings computerUse 段透传——**缺省关**）。开 =
   * computer_screenshot/click/type/key 四工具注册（审批三层纵深在
   * scheduler/computer.ts）。
   */
  computerUse?: { enabled?: boolean };
  provider?: ModelProvider;
  identity?: ModelIdentity;
  /** 缺省用 process.stdin/stdout（测试可注入内存流做进程外单测）。 */
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** dispose 或 stdin 关闭后退出（测试注入以免真实退出进程）。默认 process.exit。 */
  exit?: (code: number) => void;
  /**
   * spill 文件目录（Q3/T-P1-14）：工具出口截断的落盘位与会话关闭清理的
   * 目标位；缺省 DEFAULT_SPILL_DIR（系统临时目录 aegent-tool-spill）。
   */
  spillDir?: string;
  /**
   * B6/T-P1-15 工具执行模式：缺省 sequential（P0 行为）。parallel 时由
   * 注册表的 B17 并行声明（isParallelDeclared）驱动并发分组。
   */
  toolExecution?: ToolExecutionMode;
  /**
   * A13/T-P1-48 prompt 入队闸门（透传 loop——step 边界注入前逐条裁决）。
   * 缺省 undefined = 全放行（最小装配零行为变化）。
   */
  promptGate?: AgentLoopDeps["promptGate"];
  /**
   * F18/T-P1-102 流中断恢复策略（透传 loop）。缺省 { maxRetries: 2 }——
   * 有界恢复重试是本特性的交付面；不可重试失败 → turn/end{blocked}。
   */
  streamRecovery?: AgentLoopDeps["streamRecovery"];
  /**
   * F8/T-P1-104 工具结果历史裁剪规则（透传 loop）。缺省 undefined = 不裁剪。
   */
  resultTrim?: AgentLoopDeps["resultTrim"];
  /** A13 拦截留痕 logger（透传 loop；缺省不打日志）。 */
  logger?: AgentLoopDeps["logger"];
  /**
   * 附件存储（P1/T-P1-124）：缺省 undefined = 附件能力未启用——prompt 带
   * 附件类型化拒绝 ATTACHMENTS_UNSUPPORTED（显式能力开关，缺省部署零新
   * 目录零行为变化；批次 14 UI 端配置后启用）。
   */
  attachmentStore?: AttachmentStore;
  /**
   * M9/T-P1-48 有限队列上限（PromptQueue maxSize）：缺省 64（宽松但有限）。
   * 超限 prompt → QUEUE_FULL error 行（收执不发、消息不入队）。
   */
  queueMaxSize?: number;
  /**
   * J20+M9/T-P1-49 有界准入与工具类并发上限。缺省 undefined = 不限
   * （零行为变化）。工具类判定由 WRITE_EXECUTE_TOOLS 注入（本文件已依赖
   * policy 层的 protected-names，不新增反向依赖路径）。
   */
  toolClassLimits?: { writeExecuteMax?: number; readOnlyMax?: number };
  /**
   * K3/T-P1-112：外部类级 acquire（host 全局+会话两级组合——host/registry.ts
   * 的 chainToolAcquire 产物）。提供时优先于 toolClassLimits（后者仅在
   * 未注入时本地构造）。
   */
  toolAcquire?: (name: string) => Promise<() => void>;
  /** 事件存储（T-8-01：CLI 的 SQLite 落库走此注入）。缺省 InMemory——
   * 原生模块不进 echo 模式冷启动路径（Q16 <500ms 的结构性前提）。
   */
  storage?: EventStorage;
  /**
   * T-8-01 生产装配（权限 gate / 压缩 / 预算 / 抖动 / 系统提示）。
   * 缺省 undefined = T-3-06 最小装配（echo + 无权限层），旧测试行为不变。
   */
  assembly?: Omit<ChildAssemblyOptions, "sessionId" | "store"> & {
    /**
     * H1/H4/T-P1-42 子代理运行面：提供时构造 task 工具与 runner（进程内
     * 子代理 + 独立子会话）。maxDepth 缺省 1 = 子代理不可再分。
     */
    subagent?: { maxDepth?: number };
  };
  /**
   * T-P3-146 A：提示词模板上下文加载器（展开面每次调用新鲜读取——文件与
   * settings 运行期改动即时生效，无陈旧目录）。缺省 undefined = 无模板面
   * （`/xxx` 全部直通为普通文本——echo/最小装配行为不变）。
   */
  promptContext?: () => Promise<{
    templates: PromptTemplateSummary[];
    disabled: readonly string[];
    allowShellExpansion: boolean;
    workspaceRoot?: string;
    /** 来源分类（ready 目录的 source 标注——origin 目录绝对路径 → 桶位）。 */
    classify?: (origin: string) => "project" | "user" | "extra";
  }>;
  /**
   * T-P3-146 H：命令级模型解析（frontmatter `model`——"modelId" 全表唯一
   * 命中或 "provider/modelId" 精确命中）。未解析出 = 展开面类型化拒绝。
   */
  promptModelResolver?: (spec: string) => { provider: ModelProvider; identity: ModelIdentity } | undefined;
  /**
   * T-P3-146 I：润色旁路模型 + 模板配置装载（settings enhancement.polish
   * 模板半边每次调用新鲜读取）。缺省 undefined = polish 请求类型化拒绝。
   */
  polish?: {
    model: { provider: ModelProvider; identity: ModelIdentity };
    templateLoader?: () => Promise<{ customTemplate?: boolean; template?: string } | undefined>;
  };
}

/**
 * 子进程主循环：阻塞到 stdin 关闭或 dispose。行协议见 agent-protocol.ts。
 * 队列固定 one-at-a-time：每条排队的 prompt 各自成轮、每 step 边界最多注入
 * 一条 steer（"all" 的节奏是会话级配置，T-8 暴露给用户）。
 */
export async function runAgentChildStdio(
  options: AgentChildOptions = {},
  hooks?: {
    /** J27/T-P1-61：retrying 落流观察者注册（loop 构造后回填；provider 装配
     * 处的 onRetry 经 late-binding 桥接到此——store 在本函数内创建，装配在先）。 */
    registerRetryObserver?: (fn: (o: RetryObservation) => void) => void;
  },
): Promise<void> {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  // N1/T-P1-110：会话 id 统一过形状校验（进程内构造面同规则——"s0" 等脚手架
  // 短 id 合法，只有空串/空白/超长这类 wire 危险形状被拒）。
  const sessionId = options.sessionId ?? "s0";
  if (!isValidSessionId(sessionId)) throw new InvalidSessionIdError(sessionId);
  const output = options.output ?? process.stdout;
  const input = options.input ?? process.stdin;

  const send = (message: AgentMessage): void => {
    output.write(encodeFrame(message));
  };

  // 事件出进程的唯一通道：append 返回的已提交事件逐条转发为协议 event 行
  // （C14 已在 append 兜底，转发值必为 JSON 安全）
  const store = new (class ForwardingStore extends SessionEventStore {
    override append(
      sessionId: string,
      events: readonly import("../kernel/events.js").NewSessionEvent[],
    ): import("../kernel/events.js").SessionEvent[] {
      const committed = super.append(sessionId, events);
      for (const event of committed) send({ type: "event", event });
      return committed;
    }
  })(options.storage ?? new InMemoryEventStorage());
  // M3 resume 的 restore 前置：注入式 storage 才有跨进程历史可恢复
  //（InMemory 每次启动都是空流，restore 无意义）。
  // T-P3-174 批次 4：restore 扫出的思考档覆盖暂存位（assembly 构造在后——
  // restore 块先行；构造完成后立即应用）。
  let pendingThinkingOverride: string | undefined;
  const externalStorage = options.storage;
  // T-P3-172：child 带持久库启动即恢复本会话流（seq 接续库中最大值——
  // 权威落库的前提；不 restore 则 append 从 1 重编号与库行主键冲突）。
  // 恢复失败 = 库损坏，fail-closed 拒绝带病启动。
  if (externalStorage !== undefined) {
    try {
      await store.restore(sessionId);
    } catch {
      // T-P3-172：strict 恢复失败（seq 断续——旧版本缺陷留下的带洞流）
      // 降级 lenient 重试（可用性优先：洞保留、新事件接 maxSeq+1）；
      // lenient 仍失败才是真库损坏，fail-closed 拒绝带病启动。
      try {
        await store.restore(sessionId, { lenient: true });
      } catch (e) {
        send({ type: "error", code: "STORE_RESTORE_FAILED", message: e instanceof Error ? e.message : String(e) });
        exit(1);
        return;
      }
    }
    // T-P3-174 批次 4：思考档选择从流重建（流内最新 thinking/set 即会话级
    // 事实源——J14 回放保护纪律：恢复按流重建，不以全局默认覆盖）。空流无
    // 事件 = 无覆盖，跟模型默认档。应用点在下方 assembly 构造后（override
    // 挂在装配的 SessionThinkingOverride 面上）。
    const restoredThinkingLevel = [...store.load(sessionId)]
      .reverse()
      .find((e) => e.type === "thinking/set");
    if (restoredThinkingLevel !== undefined) {
      pendingThinkingOverride = restoredThinkingLevel.level;
    }
  }

  // 审批宣告分型（B8b/T-P1-21）：question 工具的挂起/结算不是权限审批——
  // asked 转成 question_asked 协议行、settled 不经 approval_settled 面
  //（答复事实由 tool/result 事件承载）；timed-out 依旧只走事件流。
  const forwardApprovalAnnouncement = (announcement: ApprovalAnnouncement): void => {
    if (announcement.kind === "asked") {
      if (announcement.request.tool === "question") {
        // T-P3-160：候选项/多选语义透传（UI 决策卡数据源——args 由 question
        // 工具规范化后原样落在挂起面上）
        const rawOptions = announcement.request.args["options"];
        const qOptions = Array.isArray(rawOptions)
          ? rawOptions.filter((o): o is string => typeof o === "string")
          : undefined;
        send({
          type: "question_asked",
          requestId: announcement.request.id,
          question: String(announcement.request.args["question"] ?? ""),
          ...(qOptions !== undefined && qOptions.length > 0 ? { options: qOptions } : {}),
          ...(announcement.request.args["multiple"] === true ? { multiple: true } : {}),
          timeoutMs: announcement.timeoutMs,
        });
        options.assembly?.onApprovalAnnouncement?.(announcement);
        return;
      }
      send({
        type: "approval_requested",
        requestId: announcement.request.id,
        tool: announcement.request.tool,
        args: announcement.request.args,
        timeoutMs: announcement.timeoutMs,
        category: announcement.request.category,
      });
    } else if (announcement.kind === "settled") {
      if (announcement.tool === "question") {
        // question 结算面：答复内容在 tool/result 事件里，不冒用审批 UI
        options.assembly?.onApprovalAnnouncement?.(announcement);
        return;
      }
      send({
        type: "approval_settled",
        requestId: announcement.id,
        allowed: announcement.verdict.action === "allow",
      });
    }
    options.assembly?.onApprovalAnnouncement?.(announcement);
  };

  // T-8-01 生产装配：审批宣告经 forwardApprovalAnnouncement 分型转发
  //（asked → approval_requested / question_asked、settled → 答复落定；
  // timed-out 不走协议——isError 的 tool/result 事件已是事件流上的宣告事实）。
  // H1/H4/T-P1-42：subagent 选项不进 createChildAssembly（它只驱动 task
  // 工具注册，见下方 registerBuiltinTools）。
  const subagentOptions = options.assembly?.subagent;
  // T-P3-140 批次 A：执行环境单例——ToolRegistry（无沙箱直通路径）与沙箱
  // 路由后端的 local 直通档共用同一个实例（全自动档与无沙箱行为完全一致；
  // 测试注入面也只有一处）。
  // 反馈轮九：执行环境工作目录 = 装配工作区（agent 的 shell 相对路径/pwd
// 对准项目，而非 child 进程 cwd=便携安装目录）
const executionEnv = new NodeExecutionEnv({
  ...(options.assembly?.workspaceRoot !== undefined ? { cwd: options.assembly.workspaceRoot } : {}),
});
  // B21/T-P1-63：会话配置分层（可热刷新白名单 vs 会话内静态设置）——
  // 初始值取装配面既有可配项（缺省 undefined = getter 返回 undefined，
  // 未刷新路径零行为变化）；热刷新经协议命令 config/refresh。
  // （先于 assembly 构造——C33 unattended 活查询引用它）
  const configStore = new SessionConfigStore(
    sessionId,
    {
      ...(options.assembly?.approvalTimeoutMs !== undefined
        ? { approvalTimeoutMs: options.assembly.approvalTimeoutMs }
        : {}),
      // T-P3-137 八轮 A：权限模式初始（settings.permission.mode 经
      // resolveChildLaunchArgv --permission-mode 注入的装配面）
      ...(options.assembly?.permissionMode !== undefined
        ? { approvalMode: options.assembly.permissionMode as ApprovalMode }
        : {}),
      // T-P3-140 批次 A：沙箱模式初始（settings.sandbox.mode 经
      // --sandbox-mode 注入的装配面；活刷新沿 REFRESHABLE_CONFIG_KEYS
      // 既有通道——模式卡/权限预设的热切换都写它）
      ...(options.assembly?.sandboxMode !== undefined
        ? { sandboxMode: options.assembly.sandboxMode }
        : {}),
      ...(options.queueMaxSize !== undefined ? { queueMaxSize: options.queueMaxSize } : {}),
    },
    // C8：预设切换经 onInfo 留痕（logger.info——"预设事件保留用户意图"）
    options.logger !== undefined ? { onInfo: (m) => options.logger?.info(m) } : undefined,
  );

  // T-P3-148 X：动态插件句柄汇（plugin_define 现场定义——重启即失，
  // 收尾随 finish 显式 dispose）
  const dynamicPluginHandles: { dispose(): Promise<void> }[] = [];
  // T-P3-148 插件贡献盒（B/D/E 装配面的 late-binding 载体）：插件装载在
  // toolRegistry 之后、装配消费点（系统提示首落/skill_load/ready/MCP 连接）
  // 全部晚于装载完成——盒先声明、装载后回填，消费点经 getter 活读。
  const pluginContribBox: {
    commands: import("../kernel/plugin-contributions.js").PluginCommandTemplate[];
    skillDirs: { dir: string; namePrefix: string }[];
    mcpServers: import("../kernel/plugin-contributions.js").PluginMcpServerEntry[];
    loaded: boolean;
  } = { commands: [], skillDirs: [], mcpServers: [], loaded: false };


  // W5/T3-6：registry late-binding ref（registry 创建在装配构造之后——
  // gate 的 metadata 回调运行时解引用）
  let toolRegistryRef: import("../kernel/tools/registry.js").ToolRegistry | undefined; // W5/T3-6：registry 创建后回填
  const assembly: ChildAssembly | undefined = options.assembly
    ? createChildAssembly({
        sessionId,
        store,
        ...options.assembly,
        toolMetadata: (name: string) => toolRegistryRef?.metadataOf(name),
        onApprovalAnnouncement: forwardApprovalAnnouncement,
        // C33：无人值守活查询接 SessionConfigStore（config/refresh 通道
        // 切换即生效；store getter 缺省 undefined → === true 为 false）
        unattended: () => configStore.unattended === true,
        // T-P3-137 八轮 A：审批模式活查询（同上活查询语义）
        ...(configStore.approvalMode !== undefined
          ? { approvalMode: () => configStore.approvalMode }
          : {}),
        // T-P3-140 批次 A：沙箱模式活查询（同款语义——settings.sandbox.mode
        // 初始 + 权限模式预设/沙箱模式卡经 config/refresh 热切换即生效）
        sandboxModeProvider: () => configStore.sandboxMode,
        // 同一 env 实例贯通 ToolRegistry 与沙箱 local 直通档（D4——测试
        // 注入 fake env 两者同时生效，全自动档与无沙箱路径无第二套 spawn 面）
        sandboxLocalEnv: executionEnv,
        sandboxWiring: true,
        // T-P3-148 D：插件贡献技能目录（getter 活读——插件装载晚于装配构造，
        // 系统提示首落时点盒已回填）
        pluginSkillDirs: () => pluginContribBox.skillDirs,
      })
    : undefined;

  // T-P3-174 批次 4：restore 扫出的思考档覆盖在装配构造后应用（重建先于
  // 首轮 kick——生效点语义与 thinking/set 命令受理一致）。
  if (assembly !== undefined && pendingThinkingOverride !== undefined) {
    assembly.setThinkingOverride(pendingThinkingOverride);
  }

  // H1/H4/T-P1-42：子代理 runner（顶层会话 depth=0）。降级规则的输入 =
  // 装配 rules 选项原样（deriveSubagentRules 在 runner 内对每层子装配
  // 现算——捕获时点即派发时点，captureDelegatedPolicyOverrides 同构）。
  // T-P3-140 批次 A：子代理沙箱切片（backend + 活 defaultMode，不带审批
  // ——升级在子代理语境 fail-closed；getter 保活读父 configStore）。
  const shellSandboxSlice = (() => {
    const base = assembly?.bashSandbox;
    if (base === undefined) return undefined;
    return {
      backend: base.backend,
      get defaultMode() {
        return base.defaultMode;
      },
    };
  })();

  // T-P3-145 G：队列先于 runner 构造（后台委托结算回调把报告注入父队列）。
  const queue = new PromptQueue("one-at-a-time", options.queueMaxSize);
  const subagentRuntime = subagentOptions
    ? createSubagentRunner({
        parentSessionId: sessionId,
        store,
        provider: options.provider ?? echoProvider(),
        identity: options.identity ?? { provider: "echo", modelId: "echo-1" },
        workspaceRoot: options.assembly?.workspaceRoot ?? process.cwd(),
        contextWindow: options.assembly?.contextWindow ?? 200_000,
        parentRules: options.assembly?.rules ?? [],
        depth: 0,
        ...(subagentOptions.maxDepth !== undefined
          ? { maxDepth: subagentOptions.maxDepth }
          : {}),
        ...(options.spillDir !== undefined ? { spillDir: options.spillDir } : {}),
        approvalTimeoutMs: options.assembly?.approvalTimeoutMs ?? 5_000,
        // U22/T-P3-125：技能面透传（子代理 skill_load 与父同纪律）
        ...(options.assembly?.skillsRoots !== undefined
          ? { skillsRoots: options.assembly.skillsRoots }
          : {}),
        ...(options.assembly?.skillsDisabled !== undefined
          ? { skillsDisabled: options.assembly.skillsDisabled }
          : {}),
        // U23/T-P3-126：预设清单 + 独立模型解析闭包（runner 内按次解析）
        ...(options.subagents?.defs !== undefined ? { subagentDefs: options.subagents.defs } : {}),
        // T-P3-140 批次 A：子代理与父同档同强制面（切片见 shellSandboxSlice）
        ...(shellSandboxSlice !== undefined ? { shellSandbox: shellSandboxSlice } : {}),
        ...(options.subagents?.resolveModel !== undefined
          ? { resolveSubagentModel: options.subagents.resolveModel }
          : {}),
        // C4：外部后端表透传（run 的 opts.backend 命中时出闸分派）
        ...(options.externalBackends !== undefined ? { externalBackends: options.externalBackends } : {}),
        ...(assembly?.modelForTurn ? { modelForTurn: assembly.modelForTurn } : {}),
        // T-P3-145 G：后台委托结算 → 报告注入父队列（drainQueue 在 step 边界
        // 落 user/message——模型看到报告继续；队列满被吞——报告留注册表，
        // task_wait 仍可收割）
        onSettle: (d) => {
          if (d.status === "running") return;
          const lines =
            d.status === "completed"
              ? `[后台委托完成] ${d.id}（${d.agentName}）· ${d.description}\n报告：\n${d.report ?? ""}`
              : `[后台委托结束] ${d.id}（${d.agentName}）· ${d.description}\n状态：${d.status}${d.error !== undefined ? `\n原因：${d.error}` : ""}`;
          try {
            queue.enqueue(`${lines}\n（子会话 ${d.childSessionId} 可回放查看完整过程）`);
          } catch {
            options.logger?.warn("委托报告入队失败（队列满）——task_wait 仍可收割", { id: d.id });
          }
        },
      })
    : undefined;
  const runSubagent = subagentRuntime?.run;
  // 工具装配（T-4-05 接线，兑现 T-4-02 偏离⑥）：注册表分发就是 toolCall 链的
  // 链底 terminal——executeTool 槽位由 registry.dispatch 充当，不存在旁路。
  // T-8-01：装配提供 PathGuard 时经它构造（写守卫唯一入口，T-6-01）。
  // Q3（T-P1-14）：sessionId/spillDir 传进注册表——spill 标记带真实会话身份，
  // 会话关闭清理才能按身份命中（缺省标记记 unknown-session 无法清理）。
  const toolRegistry = new ToolRegistry({
    env: executionEnv,
    sessionId,
    ...(options.spillDir !== undefined ? { spillDir: options.spillDir } : {}),
    // C12/C13：读记账（可选装配，缺省不启用——工具照常用）
    ...(options.assembly?.readGate !== undefined
      ? { readGate: options.assembly.readGate }
      : {}),
  });
  toolRegistryRef = toolRegistry; // W5/T3-6：gate metadata 回调的声明源回填
  // T-P3-174 批次 1：后台 shell 注册表（bash/pwsh/task_output 共享；会话
  // 收尾 finish 统一 kill）+ shell spill 目录（<workspace>/.aegent/scratch）
  const backgroundRegistry = new BackgroundShellRegistry();
  const shellScratchDir =
    options.assembly?.workspaceRoot !== undefined
      ? path.join(options.assembly.workspaceRoot, ".aegent", "scratch")
      : undefined;
  registerBuiltinTools(
    toolRegistry,
    {
      // G2 todo 落流出口（T-P1-10）：无条件构造——最小装配（无权限层）
      // 也有 store，todo/update 事件落流不依赖生产装配在位。
      // T-P3-172：todo_read 投影 getter（与 emit 同源——todo_write 整值
      // 提交，读回 = 最后一条 todo/update 的 items）。
      todoEmit: createTodoUpdateEmitter(store, sessionId),
      todosRead: createTodoReadGetter(store, sessionId),
      ...(assembly
        ? {
            pathGuard: assembly.pathGuard,
            // I2 技能根 = 工作区根（skill_load 的扫描面）；U22/T-P3-125：
            // roots 多根 + disabled 停用（settings skills 段装配消费）
            skillsRoot: options.assembly?.workspaceRoot ?? process.cwd(),
            ...(options.assembly?.skillsRoots !== undefined
              ? { skillsRoots: options.assembly.skillsRoots }
              : {}),
            ...(options.assembly?.skillsDisabled !== undefined
              ? { skillsDisabled: options.assembly.skillsDisabled }
              : {}),
            // T-P3-148 D：插件贡献技能目录（getter 活读——装载晚于注册）
            pluginSkillDirs: () => pluginContribBox.skillDirs,
            // T-P3-148 I：插件创建工具（工作区装配在位即注册——生成不自动装载）
            pluginCreate: { workspaceRoot: options.assembly?.workspaceRoot ?? process.cwd() },
            // T-P3-148 X：动态插件定义（进程内、重启即失——句柄挂收尾）
            pluginDefine: { toolRegistry, handles: dynamicPluginHandles },
            // G1 plan 模式工具面（planMode 启用时装配提供同一服务实例）
            // + G4 计划落盘出口（planArtifactDir 提供时存在）
            ...(assembly.planMode ? { planMode: assembly.planMode } : {}),
            ...(assembly.savePlanArtifact
              ? { savePlanArtifact: assembly.savePlanArtifact }
              : {}),
            // B8a/T-P1-20：networkPolicy 装配选项提供时注册 webfetch
            //（D3 唯一入口随守卫注入，无守卫不注册）
            ...(assembly.networkGuard ? { networkGuard: assembly.networkGuard } : {}),
            // T-P3-140 批次 A：沙箱三档接线（模式路由后端 + 活 defaultMode
            // ——bash 带升级审批通道，pwsh 是无升级切片；缺席 = env 直通）
            ...(assembly.bashSandbox !== undefined ? { bashSandbox: assembly.bashSandbox } : {}),
            ...(assembly.pwshSandbox !== undefined ? { pwshSandbox: assembly.pwshSandbox } : {}),
            // B8b/T-P1-21：question 工具依赖（共用审批挂起注册表）
            question: { ...assembly.question },
            // Q2/T-P2-105：会话查询工具（库路径提供时才注册——只读类）
            ...(options.assembly?.sessionQuery
              ? { sessionQuery: options.assembly.sessionQuery }
              : {}),
          }
        : {}),
      // H1/H4/T-P1-42：task 工具（subagent 选项提供时注册；runner 自带
      // 深度检查——可见但拒绝，opencode 深度语义同款）
      ...(runSubagent ? { task: { runSubagent } } : {}),
      // T-P3-145 G：task_wait/list/stop（后台委托收割/查看/停止——与 task
      // 同源注入；子代理 runner 缺席 = 不注册零新工具）
      ...(subagentRuntime !== undefined
        ? {
            taskWait: { delegations: subagentRuntime.delegations },
            taskList: { delegations: subagentRuntime.delegations },
            taskStop: { delegations: subagentRuntime.delegations },
          }
        : {}),
      // T-P3-174 批次 1：后台 shell 面 + scratch spill + 附件/计量条件注册
      backgroundShell: backgroundRegistry,
      ...(shellScratchDir !== undefined ? { shellScratchDir } : {}),
      sessionId,
      workspaceRoot: options.assembly?.workspaceRoot ?? process.cwd(),
      ...(options.attachmentStore ? { attachments: options.attachmentStore } : {}),
      ...(assembly?.contextUsage ? { contextUsage: assembly.contextUsage } : {}),
    },
  );
  // C2 接线（T-P3-174 浏览器驱动调研报告方案 A——最后一件胶水）：浏览器
  // 面板 CDP 工具族（browser_navigate/screenshot/extract——审批/域白名单/
  // deadline/NOTICE 安全面在 scheduler/browser.ts）。**条件注册**：壳的
  // 面板 data directory（DevToolsActivePort 文件）在位 = CDP 通道真实可用
  // （portable 布局 node.exe 与壳 exe 同目录）；缺席（无壳/测试）不注册，
  // 工具清单基线零变化。每导航审批复用既有 PendingApprovals（C 族主面），
  // 超时同 approvalTimeoutMs（C50）。
  {
    const panelDir = panelDataDir(path.dirname(process.execPath));
    if (existsSync(path.join(panelDir, "DevToolsActivePort"))) {
      const approvalTimeoutMs = options.assembly?.approvalTimeoutMs ?? 120_000;
      for (const tool of createBrowserTools({
        connect: () => connectPanelBrowser(panelDir),
        ...(assembly?.pending !== undefined
          ? {
              approve: async (action: { tool: string; url?: string }) => {
                if (assembly?.pending === undefined) return false; // fail-closed
                const verdict = await assembly.pending.ask(
                  {
                    id: `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    sessionId,
                    tool: action.tool,
                    args: (action.url !== undefined ? { url: action.url } : {}) as import("../kernel/events.js").JsonRecord,
                    category: "tool",
                  },
                  { timeoutMs: approvalTimeoutMs },
                );
                return verdict.action === "allow";
              },
            }
          : {}),
      })) {
        toolRegistry.registerTool(tool);
      }
      options.logger?.info(`浏览器面板 CDP 工具已注册（${panelDir}）`);
    }
  }
  // S4 接线（D 级批次清偿——计算机使用四工具）：**默认关**（settings
  // computerUse.enabled 门控——屏幕/输入控制是最高危工具面，注册即模型
  // 可见，必须用户显式开启）。每操作审批复用 PendingApprovals（C 族主面；
  // unattended 恒拒在 computerExecute 内层先于审批——双重纵深）。
  if (options.computerUse?.enabled === true) {
    for (const tool of createComputerTools({
      run: createWin32ComputerRun(),
      isUnattended: () => configStore.unattended === true,
      ...(assembly?.pending !== undefined
        ? {
            approve: async (request: import("../scheduler/computer.js").ComputerUseRequest) => {
              if (assembly?.pending === undefined) return false; // fail-closed
              const verdict = await assembly.pending.ask(
                {
                  id: `computer-${request.operation}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  sessionId,
                  tool: `computer_${request.operation}`,
                  args: request as unknown as import("../kernel/events.js").JsonRecord,
                  category: "tool",
                },
                { timeoutMs: options.assembly?.approvalTimeoutMs ?? 120_000 },
              );
              return verdict.action === "allow" ? "user" : false;
            },
          }
        : {}),
    })) {
      toolRegistry.registerTool(tool);
    }
    options.logger?.info("计算机使用工具已注册（settings computerUse.enabled）");
  }
  // U17/T-P3-119：MCP server 装配消费（settings mcp 段——agent-child 传入
  // 已过滤 enabled 的条目）。装配期连接注册（ready 前完成——tools 清单
  // 一次性报全）；单 server 失败 warn 继续不炸启动（never-fail 装配——
  // 与 H2 never-reject 结算同纪律）。连接句柄在收尾 dispose（防 stdio
  // 子进程悬挂——父进程退出前显式关闭）。
  const mcpConnections: import("../mcp/registry-bridge.js").McpConnection[] = [];
  for (const cfg of options.mcpServers ?? []) {
    try {
      mcpConnections.push(await connectAndRegister(toolRegistry, cfg));
    } catch (e) {
      console.error(`[mcp] server "${cfg.name}" 连接失败（跳过）:`, e instanceof Error ? e.message : e);
    }
  }
  // T-P3-133：插件装载（I4/I5 的生产装配点——settings plugins 段 enabled
  // 条目）。工具以 `<插件名>__<工具名>` 命名空间进注册表；单插件失败
  // never-fail 跳过（mcpServers 同款）；收尾 dispose 挂 finish（连接/句柄
  // 随进程退出显式收束）。
  // T-P3-148：贡献聚合回填贡献盒（B 命令→promptContext 合并 / D 技能目录
  // →三消费口 / E MCP server→连接注册）——装配消费点全部晚于本行。
  // T-P3-148 热加载：pluginLoad 可变 + 插件 MCP 连接单独数组——
  // plugins/reload 协议请求触发 diff 重装载（见 reloadPluginsNow）。
  let pluginLoad = await loadConfiguredPlugins(toolRegistry, options.plugins, {
    ...(options.logger ? { logger: options.logger } : {}),
  });
  const pluginMcpConnections: import("../mcp/registry-bridge.js").McpConnection[] = [];
  const connectPluginMcpServers = async (): Promise<void> => {
    for (const cfg of pluginContribBox.mcpServers) {
      try {
        pluginMcpConnections.push(await connectAndRegister(toolRegistry, cfg));
      } catch (e) {
        console.error(`[mcp] 插件 server "${cfg.name}" 连接失败（跳过）:`, e instanceof Error ? e.message : e);
      }
    }
  };
  const applyPluginLoad = (): void => {
    pluginContribBox.commands = [...pluginLoad.contributions.commands];
    pluginContribBox.skillDirs = [...pluginLoad.contributions.skillDirs];
    pluginContribBox.mcpServers = [...pluginLoad.contributions.mcpServers];
    pluginContribBox.loaded = true;
  };
  applyPluginLoad();
  // T-P3-148 E：插件贡献的 MCP server 连接（settings mcp 同款 never-fail；
  // env 的 {setting} 引用已在贡献解析面处理——解析失败的服务不出现在此）
  await connectPluginMcpServers();

  /**
   * T-P3-148 热加载（走查反馈：插件必须实际生效）：重读 settings → diff
   * 重装载——旧插件工具注销（B16 快照纪律保证在途 step 不受影响）+ 句柄
   * dispose + 插件 MCP 断开 → 按最新清单重装载 → 贡献盒回填 → 重发 ready
   * （工具/技能/命令清单一次刷新，bridge agentCapabilities 覆盖）。
   * settingsPath 缺席（无 --settings 的最小装配）= 无重载面。
   */
  const reloadPluginsNow = async (): Promise<void> => {
    if (options.settingsPath === undefined) {
      send({ type: "error", code: "PLUGIN_RELOAD_UNAVAILABLE", message: "子进程无 settings 路径，插件热加载不可用" });
      return;
    }
    // 旧面收束：旧一轮注册的工具名注销（dispose 后 handle.tools 清空，
    // 名单须在 dispose 前取——loadConfiguredPlugins 回传 registeredToolNames）
    for (const toolName of pluginLoad.contributions.registeredToolNames) {
      toolRegistry.unregisterTool(toolName);
    }
    await pluginLoad.disposeAll();
    for (const conn of pluginMcpConnections.splice(0)) {
      try {
        conn.client.dispose();
      } catch {
        // 断连失败不阻断重装载
      }
    }
    // 最新清单重装载（settings 插件独立生命周期——动态插件句柄不动）
    const { settings: fresh } = await loadSettings(options.settingsPath);
    const entries = (fresh.plugins ?? []).filter((p) => p.enabled !== false);
    pluginLoad = await loadConfiguredPlugins(toolRegistry, entries, {
      ...(options.logger ? { logger: options.logger } : {}),
    });
    applyPluginLoad();
    await connectPluginMcpServers();
    options.logger?.info(
      `[plugins] 热重载完成：${String(entries.length)} 条目 / 工具 ${String(toolRegistry.names().filter((n) => n.includes("__")).length)} 个`,
    );
  };
  const decideTurnBase: AgentLoopDeps["decideTurn"] = (record) =>
    record.toolCalls.length > 0 ? { action: "continue" } : { action: "end" };
  // T-P3-145 G：装配裁决包装器构造一次（有状态闭包——见 decideTurn 处注释）
  const assemblyDecideTurn = assembly ? assembly.wrapDecideTurn(decideTurnBase) : undefined;
  const loopDeps: AgentLoopDeps = {
    sessionId,
    store,
    provider: options.provider ?? echoProvider(),
    identity: options.identity ?? { provider: "echo", modelId: "echo-1" },
    // F12/F14（T-P1-17）：每请求现取工具清单——tool_load 索取后 deferrable
    // 工具的真 schema 才进后续请求（request/header.tools 同步如实记录）
    toolsProvider: () => toolRegistry.toChatTools(),
    executeTool: async (call) => {
      // M9/T-P1-49：工具类并发上限（缺省不配 = 直通零行为变化）——
      // 类级排队在外层、B17 RwLock 在 loop 内层照旧；K3/T-P1-112 起可为
      // host 注入的两级组合 acquire（全局外层 → 会话内层）。
      if (!classAcquire) return toolRegistry.dispatch(call);
      const release = await classAcquire(call.name);
      try {
        return await toolRegistry.dispatch(call);
      } finally {
        release();
      }
    },
    // T-P3-145 G：收敛钩子（结果正确回流的保证）——end 裁决 ∧ 有在途后台
    // 委托 → 等全部结算 → 报告注入队列 → continue（下个 step 边界 drainQueue
    // 落 user/message，模型看到报告继续总结）。模型忘收割也拦得住。
    // 注意：wrapDecideTurn 是有状态闭包（钩子绑定）——包装器必须构造一次，
    // 不能放进本箭头函数体内按调用重建（曾致 CLI e2e 死锁）。
    decideTurn: async (record) => {
      const decision = await (assemblyDecideTurn !== undefined
        ? assemblyDecideTurn(record)
        : decideTurnBase(record));
      if (decision.action === "end" && subagentRuntime?.delegations.hasRunning() === true) {
        const settled = await subagentRuntime.delegations.wait({ mode: "all" });
        for (const d of settled) {
          if (d.status === "running") continue; // 超时兜底——running 不注入
          const lines =
            d.status === "completed"
              ? `[后台委托完成] ${d.id}（${d.agentName}）· ${d.description}\n报告：\n${d.report ?? ""}`
              : `[后台委托结束] ${d.id}（${d.agentName}）· ${d.description}\n状态：${d.status}${d.error !== undefined ? `\n原因：${d.error}` : ""}`;
          try {
            queue.enqueue(`${lines}\n（子会话 ${d.childSessionId} 可回放查看完整过程）`);
          } catch {
            options.logger?.warn("收敛注入入队失败（队列满）", { id: d.id });
          }
        }
        return { action: "continue" };
      }
      return decision;
    },
    queue,
    // A13/T-P1-48：入队闸门与拦截留痕（缺省 undefined = 全放行零行为变化）
    ...(options.promptGate ? { promptGate: options.promptGate } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.rawLogDir
      ? { rawChunkLog: new RawChunkLog({ logDir: options.rawLogDir }) }
      : {}),
    // J6/J7：装配启用换模时，loop 每轮启动从捕获值取 provider/identity
    //（在途换模生效点在新 turn）；未启用时缺省固定 provider/identity。
    // J11：turn 失败通知 → 装配驱动换模回滚判据。
    ...(assembly?.modelForTurn ? { modelForTurn: assembly.modelForTurn } : {}),
    ...(assembly?.onTurnError ? { onTurnError: assembly.onTurnError } : {}),
    // T-P3-161/T-P3-174：思考档覆盖读取面（loop 每轮启动注入 reasoningEffort
    //——批次 4 落流测试实抓：装配写入面在而 loop 读取面未接线，覆盖从不生效）
    ...(assembly ? { thinkingOverrideForTurn: assembly.thinkingOverrideForTurn } : {}),
    // B6/B17（T-P1-15）：装配选择 parallel 时，并发分组以注册表的并行声明
    // 为准（未声明即排他）；缺省 sequential 时两个槽位都不进 deps（P0 原样）。
    ...(options.toolExecution === "parallel"
      ? {
          toolExecution: "parallel" as const,
          isParallelTool: (name: string) => toolRegistry.isParallelDeclared(name),
        }
      : {}),
    // B16/T-P1-59：执行策略快照源（loop 在 step 开始固化 parallel/timeoutMs
    // 声明——step 中途 registerTool 替换不影响在途 step）
    toolRuntimeMeta: (name: string) => toolRegistry.runtimeMeta(name),
    // F18/T-P1-102：流中断恢复（loop 级，从锚点重建重发整 step）——缺省
    // 启用 maxRetries 2（有界；不可重试失败 → turn/end{blocked} 显式终态）。
    // 首 chunk 前的失败仍在 provider 级 withRetry 域（D15 边界不分域不越界）。
    streamRecovery: options.streamRecovery ?? { maxRetries: 2 },
    ...(options.resultTrim !== undefined ? { resultTrim: options.resultTrim } : {}),
    ...(assembly
      ? {
          layers: assembly.layers,
          beforeFirstModelRequest: assembly.beforeFirstModelRequest,
          onToolStepCompleted: (turn: number, step: number) =>
            assembly.onToolStepCompleted(turn, step),
          // F6/F13/T-P1-19：逐请求缓存锚检测 → 装配观测（rewritten 告警）
          onCacheAnchorChange: assembly.onCacheAnchorChange,
        }
      : {}),
    // P1/T-P1-124：附件 store（主 loop 的投影 resolver 源）——缺省 undefined
    // = 附件能力未启用
    ...(options.attachmentStore ? { attachmentStore: options.attachmentStore } : {}),
  };
  const loop = createLoop(loopDeps);
  // J27/T-P1-61：retrying 一等事件落流（provider 层的中间失败尝试对事件流
  // 可见——attempt/delayMs/错误三字段，kimi retrying 同构最小面）。turn/step
  // 从 loop 当前状态读取（provider 自身不知 loop 状态）；idle 时的防御性
  // 缺省落 turn=0/step=0（invariants 的轮作用域校验会拒绝——实际不可达，
  // 只是类型完备）。
  hooks?.registerRetryObserver?.((o) => {
    const turn = loop.activeTurn;
    const step = loop.currentStep;
    // 轮作用域守卫：idle 期无在途模型请求，重试回调不可达——防御性忽略
    //（不落 turn=0 伪事件，invariants 的轮作用域校验是 E16 红线）
    if (turn === null || step === undefined) return;
    store.append(sessionId, [
      {
        type: "assistant/retrying",
        turn,
        step,
        attempt: o.attempt,
        delayMs: o.delayMs,
        error: {
          name: o.error.errorName,
          message: o.error.errorMessage,
          ...(o.error.statusCode !== undefined ? { status: o.error.statusCode } : {}),
        },
      },
    ]);
  });

  let inflight: Promise<void> | null = null;
  let disposing = false;

  // J20/T-P1-49 有界准入：draining 后新 prompt/steer 类型化拒绝；在途轮
  // 持 admit 名额（active = 在途轮数，可观测）。
  const admission = new TurnAdmission();
  // M9/T-P1-49 工具类并发上限（缺省不配 = 不限，零行为变化）：
  // 类级排队 → loop 派发 → B17 RwLock，三层各司其职。K3/T-P1-112：外部
  // toolAcquire（host 全局+会话两级组合，host/registry.ts chainToolAcquire
  // 产物）注入时优先生效——两级上限的会话侧接线面。
  const toolLimiter =
    options.toolAcquire === undefined && options.toolClassLimits !== undefined
      ? new ToolClassLimiter(options.toolClassLimits, (name) =>
          isWriteExecuteTool(name) ? "write" : "read",
        )
      : null;
  const classAcquire: ((name: string) => Promise<() => void>) | undefined =
    options.toolAcquire ?? (toolLimiter !== null ? (name) => toolLimiter.acquire(name) : undefined);

  // Q3 会话关闭触发（T-P1-14）：退出前清掉本会话的自动可删 spill 文件
  // （manual 声明者与其他会话的文件由 spill-gc 保留）。exit 缺省是
  // process.exit——挂起的 unlink 会被切断，所以清理必须 await 完再退。
  // AGENT_LOOP_CRASH 的 exit(1) 不在此列：异常路径保持即时退出，残留文件
  // 由下次 spill 的超量配额兜底。
  let finishing = false;
  const finish = async (): Promise<void> => {
    if (finishing) return;
    finishing = true;
    try {
      // T-P3-174 批次 1：后台 shell 任务收尾（run_in_background 的进程树
      // 随会话退出显式 kill——不留孤儿）
      await backgroundRegistry.dispose();
      for (const conn of mcpConnections) {
        try {
          conn.client.dispose();
        } catch {
          // 收尾关连接不炸退出面
        }
      }
      await pluginLoad.disposeAll(); // T-P3-133：插件句柄收束
      for (const handle of dynamicPluginHandles) {
        try {
          await handle.dispose();
        } catch {
          // 动态插件收尾幂等面
        }
      }
      await sweepSessionSpill(options.spillDir ?? DEFAULT_SPILL_DIR, sessionId);
    } finally {
      exit(0);
    }
  };

  // 轮启动的唯一入口（kick 消费队列与 M3 resume 共用——in-flight 管理、
  // E11 打点、崩溃出口、A8 退回都在这条链上，绝不开旁路）。
  const startTurn = (
    content: string,
    attachments?: AttachmentRef[],
    sessionRefs?: SessionRef[],
    meta?: { command?: string; model?: { provider: ModelProvider; identity: ModelIdentity } },
  ): void => {
    if (inflight) return;
    // J20/T-P1-49：轮跑动期间持 admit 名额（active = 在途轮数）。
    // draining 后 admit 不再计数（admit 的拒绝面只对 handleRequest 的新
    // 请求）——存量队列照常跑完（EOF"处理完剩余工作"语义），进程将退，
    // 计数无消费方。
    const permit = admission.draining ? null : admission.admit();
    let ended: TurnEndReason | undefined;
    inflight = (async () => {
      // E11 代码检查点：每轮开始前打点（pi turn_start "before LLM makes
      // changes" 的等价时点——此刻工作区就是"改前"状态，场景①的恢复依据）。
      // 打点失败内部消化（onWarn），不阻断轮。
      if (assembly?.checkpoint) {
        const turn =
          Projector.fold(store.load(sessionId)).projection.turnCount + 1;
        await assembly.checkpoint.capture(turn);
      }
      return loop.runTurn(content, attachments, sessionRefs, meta);
    })()
      .then((reason) => {
        ended = reason;
      })
      .catch((e: unknown) => {
        // loop 崩溃（异常逃出 runTurn）：会话可能有未闭合 turn，进程不可继续
        send({
          type: "error",
          code: "AGENT_LOOP_CRASH",
          message: e instanceof Error ? e.message : String(e),
        });
        exit(1);
      })
      .finally(() => {
        permit?.release();
        inflight = null;
        // A8/T-P1-52：轮以 aborted 终止且队列非空 → 未消费输入退回父进程
        // 回显（"退回输入框"），不自动续跑（pi-desktop·Stop 不独立重放）。
        // 已消费进历史的不退（drain 后即出队）；gate 拦截的未入队也不退。
        if (ended?.kind === "aborted" && queue.size > 0) {
          const rest = queue.drainAll();
          send({ type: "prompt_returned", contents: rest.map((p) => p.content) });
        }
        kick(); // 收尾后再踢一次——completed 后队列续开；aborted 退回后队列空 → idle
      });
  };

  const kick = (): void => {
    if (inflight) return;
    const next = queue.drain()[0];
    if (!next) {
      if (disposing) {
        void finish();
        return;
      }
      // T-8-01：宣告空闲（无在途轮且队列空）——CLI 的 EOF 语义据此等
      // idle 再 dispose，避免"输入流关闭即取消在途轮"。
      send({ type: "idle" });
      return;
    }
    startTurn(next.content, next.attachments, next.sessionRefs, next.meta);
  };

  // -----------------------------------------------------------------------
  // T-P3-146 A：提示词模板展开链（发送时——opencode/zcode/pi 三仓统一时机）。
  // 串行化（expandTail）保证跨 prompt 的 FIFO 入队序不因展开耗时重排；accepted
  // 在展开成功并入队后发出（展开失败 → 类型化 error 行——bridge 回执通道
  // 原样可达 UI）。缺 promptContext = 全直通（普通文本语义，echo/最小装配）。
  // -----------------------------------------------------------------------
  let expandTail: Promise<void> = Promise.resolve();
  const enqueueExpanded = (
    content: string,
    refs: AttachmentRef[] | undefined,
    srefs: SessionRef[] | undefined,
    messageId: string,
  ): void => {
    expandTail = expandTail
      .then(async () => {
        const expanded = await expandPromptInvocation(content);
        queue.enqueue(expanded.content, refs, srefs, expanded.meta);
        send({ type: "accepted", messageId });
        kick();
      })
      .catch((e: unknown) => {
        const code =
          typeof (e as { code?: unknown } | null)?.code === "string"
            ? (e as { code: string }).code
            : "PROMPT_EXPAND_FAILED";
        send({
          type: "error",
          code,
          message: e instanceof Error ? e.message : String(e),
        });
      });
  };

  const expandPromptInvocation = async (
    content: string,
  ): Promise<{
    content: string;
    meta?: { command?: string; model?: { provider: ModelProvider; identity: ModelIdentity } };
  }> => {
    const invocation = parseSlashInvocation(content);
    if (invocation === null) return { content };
    const { name, argsRaw } = invocation;
    const commandLike = /^[a-z0-9][a-z0-9_:/-]*$/i.test(name);
    // 工具/技能名直通（/ 补全里它们与模板同列——键入原样进模型，行为保持）
    const passThrough = toolRegistry.names().includes(name) || knownSkillNames().includes(name);
    if (!commandLike || passThrough || options.promptContext === undefined) {
      return { content };
    }
    const ctx = await options.promptContext();
    // T-P3-148 B：插件贡献命令合并（用户/项目模板优先——重名插件命令弃用
    // 落诊断，zcode 命令 priority 语义同构）
    if (pluginContribBox.commands.length > 0) {
      const baseNames = new Set(ctx.templates.map((t) => t.name));
      const extra = pluginContribBox.commands.filter((c) => {
        if (baseNames.has(c.name)) {
          options.logger?.warn(`plugin-contrib: 命令与既有模板重名，弃用：${c.name}`);
          return false;
        }
        baseNames.add(c.name);
        return true;
      });
      if (extra.length > 0) ctx.templates = [...ctx.templates, ...extra];
    }
    const template = lookupPromptTemplate(name, ctx.templates, ctx.disabled);
    if (template === undefined) {
      // H：MCP prompts 桥接（`server:prompt` 命名空间——live 连接的懒取回）
      if (name.includes(":")) {
        const sep = name.indexOf(":");
        const serverName = name.slice(0, sep);
        const promptName = name.slice(sep + 1);
        const conn = mcpConnections.find((c) => c.client.name === serverName);
        const prompt =
          conn !== undefined ? conn.prompts.find((p) => p.name === promptName) : undefined;
        if (conn !== undefined && prompt !== undefined) {
          // 位置参数 → 声明序映射（opencode 同构）；尾参吞剩余（与 $N 末位一致）
          const declared = prompt.arguments ?? [];
          const args = parseCommandArgs(argsRaw);
          const kv: Record<string, string> = {};
          for (let i = 0; i < declared.length; i++) {
            kv[declared[i]!.name] = args[i] ?? "";
          }
          if (declared.length > 0 && args.length > declared.length) {
            kv[declared[declared.length - 1]!.name] = args.slice(declared.length - 1).join(" ");
          }
          const text = await conn.client.getPrompt(promptName, kv);
          return { content: text, meta: { command: content.trim() } };
        }
      }
      const error = new Error(
        `未知命令 /${name}——可在 设置 → 提示词模板 新建，或去掉开头的斜杠按普通文本发送`,
      );
      (error as unknown as { code: string }).code = "PROMPT_COMMAND_UNKNOWN";
      throw error;
    }
    let expanded = substituteArgs(template.content, argsRaw);
    // H：shell 前置执行（开关缺省关——fail-closed）；@file 文本注入
    if (ctx.allowShellExpansion) {
      expanded = await expandShellInjections(expanded, {
        ...(ctx.workspaceRoot !== undefined ? { cwd: ctx.workspaceRoot } : {}),
      });
    }
    expanded = await expandFileReferences(expanded, {
      ...(ctx.workspaceRoot !== undefined ? { workspaceRoot: ctx.workspaceRoot } : {}),
    });
    // H：命令级模型覆盖（frontmatter model——未注册类型化拒绝，不静默回退）
    let model: { provider: ModelProvider; identity: ModelIdentity } | undefined;
    if (template.model !== undefined) {
      model = options.promptModelResolver?.(template.model);
      if (model === undefined) {
        const error = new Error(
          `模板 /${name} 的 model「${template.model}」未注册（models 注册表无此模型）`,
        );
        (error as unknown as { code: string }).code = "PROMPT_MODEL_UNKNOWN";
        throw error;
      }
    }
    // H：agent frontmatter → 前台子代理（展开文本作为任务提示，报告并入
    // 本条 user 消息——模型与 transcript 同见；子会话独立流，可回放）
    if (template.agent !== undefined) {
      if (runSubagent === undefined) {
        const error = new Error(
          `模板 /${name} 的 agent「${template.agent}」不可用（本进程未装配子代理面）`,
        );
        (error as unknown as { code: string }).code = "PROMPT_AGENT_UNAVAILABLE";
        throw error;
      }
      const outcome = await runSubagent(expanded, `模板 /${name}`, {
        subagentType: template.agent,
      });
      if (outcome.kind !== "foreground") {
        const error = new Error(`模板 /${name} 的子代理以后台模式启动（非预期）`);
        (error as unknown as { code: string }).code = "PROMPT_AGENT_UNAVAILABLE";
        throw error;
      }
      const r = outcome.result;
      if (r.stopReason !== "completed") {
        const error = new Error(
          `子代理 ${template.agent} 未正常收敛（${r.stopReason}）${r.error !== undefined ? `：${r.error}` : ""}`,
        );
        (error as unknown as { code: string }).code = "PROMPT_AGENT_FAILED";
        throw error;
      }
      expanded = `${expanded}\n\n---\n【子代理 ${template.agent} 执行报告】（子会话 ${r.sessionId} 可回放）\n${r.output}`;
    }
    return {
      content: expanded,
      meta: { command: content.trim(), ...(model !== undefined ? { model } : {}) },
    };
  };

  /** 技能名直通清单（装配面技能根的现扫描——展开时点新鲜；T-P3-148 D
   * 含插件贡献目录 extraDirs——名字空间化清单与系统提示/skill_load 同源）。 */
  const knownSkillNames = (): string[] => {
    if (options.assembly === undefined) return [];
    try {
      return loadSkillsFromRoots(
        options.assembly.workspaceRoot ?? process.cwd(),
        options.assembly.skillsRoots,
        pluginContribBox.skillDirs.length > 0 ? { extraDirs: pluginContribBox.skillDirs } : undefined,
      ).skills.map((s) => s.name);
    } catch {
      return [];
    }
  };

  const handleRequest = (req: AgentRequest): void => {
    switch (req.type) {
      case "prompt":
        // J20/T-P1-49：draining 后不受理新轮（类型化拒绝，连接不断）
        if (admission.draining) {
          send({
            type: "error",
            code: "SERVER_DRAINING",
            message: "进程正在收尾——不再受理新 prompt（存量队列照常跑完）",
          });
          return;
        }
        // P1/T-P1-124：附件编排面（校验限额 + 字节落 store → ref）——在
        // 收执之前完成（限额失败 = 不收执不开轮，与 QUEUE_FULL 同形态）。
        let attachmentRefs: AttachmentRef[] | undefined;
        if (req.attachments?.length) {
          if (!options.attachmentStore) {
            send({
              type: "error",
              code: "ATTACHMENTS_UNSUPPORTED",
              message: "本进程未启用附件能力（attachmentStore 未配置）",
            });
            return;
          }
          try {
            validateAttachments(
              req.attachments.map((att) => ({
                mediaType: att.mediaType,
                byteLength: base64ByteLength(att.data),
              })),
            );
          } catch (e) {
            if (e instanceof AttachmentLimitError) {
              send({ type: "error", code: e.code, message: e.message });
              return;
            }
            throw e;
          }
          attachmentRefs = req.attachments.map((att) => options.attachmentStore!.save(att));
        }
        // E9/T-P2-107：会话引用编排面——环检测（fail-closed：A 引 B、B 引 A
        // 被拒）+ 引用目标形状已在 wire 层校验；引用**只落指针不落内容**，
        // 快照注入在投影面（resolveSessionRef 装配）。
        let sessionRefs: SessionRef[] | undefined;
        if (req.sessionRefs?.length) {
          try {
            assertNoReferenceCycle(sessionId, req.sessionRefs, {
              refsOf: (id) => refsOfEvents(store.load(id)),
            });
          } catch (e) {
            if (e instanceof ReferenceError) {
              send({ type: "error", code: e.code, message: e.message });
              return;
            }
            throw e;
          }
          sessionRefs = [...req.sessionRefs];
        }
        // A9：先展开、再入队收执——accepted 证明 admission（T-P3-146 A：
        // 模板展开在入队前完成，失败走类型化 error 行不收执；串行链保 FIFO）。
        // M9/T-P1-48：队列满（有限队列）类型化拒绝——收执不发、消息不入队。
        enqueueExpanded(req.content, attachmentRefs, sessionRefs, req.messageId);
        return;
      case "offload": {
        // P2/T-P1-125：卸载触发面——从当前有效视窗选最老出现，决策落流
        // （image/offload 事件经 event 行转发可见——A9 无独立回执）；无可
        // 卸载 → 类型化 error（dsh "exhausted delegates" 语义）。
        try {
          const targets = offloadOldestImages(effectiveEvents(store.load(sessionId)), req.count);
          if (!targets) {
            send({ type: "error", code: "OFFLOAD_NO_IMAGES", message: "没有可卸载的图片出现（当前视窗无未卸载附件图片）" });
            return;
          }
          const turn = Projector.fold(store.load(sessionId)).projection.turnCount;
          store.append(sessionId, [{ type: "image/offload", turn, targets: targets.targets }]);
        } catch (e) {
          send({
            type: "error",
            code: e instanceof ProjectError ? "PROJECTION_REJECTED" : "OFFLOAD_FAILED",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      case "steer": {
        // A10/T-P1-47：steer 带目标轮准入——目标必须是当前活动轮。
        // 不匹配（含 idle）类型化拒绝且不入队（不武装队列）；匹配则入
        // 同一队列、由在途轮的 step 边界消费（A11），kick 幂等无害。
        if (admission.draining) {
          send({
            type: "error",
            code: "SERVER_DRAINING",
            message: "进程正在收尾——不再受理 steer",
          });
          return;
        }
        const active = loop.activeTurn;
        if (active === null || active !== req.expectedTurn) {
          send({
            type: "error",
            code: "TURN_NOT_ACTIVE",
            message:
              active === null
                ? `steer 目标轮 ${req.expectedTurn} 不是当前活动轮（当前无在途轮）`
                : `steer 目标轮 ${req.expectedTurn} 不是当前活动轮（当前活动轮 ${active}）`,
          });
          return;
        }
        try {
          queue.enqueue(req.content);
        } catch (e) {
          if (e instanceof QueueFullError) {
            send({ type: "error", code: e.code, message: e.message });
            return;
          }
          throw e;
        }
        kick();
        return;
      }
      case "cancel":
        loop.cancel(req.cause as CancelCause);
        return;
      case "queue/remove":
      case "queue/edit": {
        // T-P3-174 批次 7：排队条行内操作（messageId 定位——回执按操作分型）
        const qReq = req as { type: string; messageId?: string; content?: string };
        const isEdit = qReq.type === "queue/edit";
        const qOk = isEdit
          ? queue.edit(qReq.messageId ?? "", qReq.content ?? "")
          : queue.remove(qReq.messageId ?? "");
        if (!qOk) {
          send({ type: "error", code: "QUEUE_NOT_FOUND", message: `排队消息不存在：${qReq.messageId ?? ""}` });
          return;
        }
        send({ type: isEdit ? "queued_edited" : "queued_removed", messageId: qReq.messageId ?? "" });
        return;
      }
      case "thinking/set": {
        // T-P3-161：会话思考档覆盖（档位闭集 + "omit" 哨兵；受理即生效点
        // 在新 turn——与 model/switch 同款捕获语义）。回执经 notification。
        const valid = (THINKING_LEVELS as readonly string[]).includes(req.level) || req.level === "omit";
        if (!valid) {
          send({
            type: "error",
            code: "THINKING_LEVEL_INVALID",
            message: `思考档非法：${req.level}（合法：omit|${THINKING_LEVELS.join("|")}）`,
          });
          return;
        }
        if (!assembly) {
          send({
            type: "error",
            code: "THINKING_UNAVAILABLE",
            message: "子进程未装配会话服务（最小装配无思考档覆盖）",
          });
          return;
        }
        assembly.setThinkingOverride(req.level);
        // T-P3-174 批次 4：受理落流（会话级选择事实——重启后档位保持的判据）。
        // model/switch emit 同款：turn 挂流内最后轮空流兜 0（会话级元事件，
        // 不要求 turn 开合上下文）。落流即 flush（write-behind 缓冲不等
        // turn 末——否则"设完档位立刻重启"的窗口里 restore 读不到）。
        const events = store.load(sessionId);
        const lastTurn = events.length > 0 ? events[events.length - 1]!.turn : 0;
        store.append(sessionId, [{ type: "thinking/set", turn: lastTurn, level: req.level }]);
        void store.flush(sessionId).catch(() => {
          // flush 失败不回滚受理（内存序已权威；fork 同款语义）
        });
        send({ type: "thinking_set", level: req.level });
        return;
      }
      case "revert": {
        // E4+E11 双回退：先对话态（校验便宜、失败不产生半退）再代码态。
        // 成功回 reverted 回执（CLI 据此报告代码是否回退）；失败回 error 行。
        // T-P3-161：promptId 定位形态——child 流内查该 user/message 的
        // seq-1（UI 端 seq 存在 live/镜像双轨漂移，promptId 免疫）。
        if (!assembly) {
          send({
            type: "error",
            code: "REVERT_FAILED",
            message: "子进程未装配会话服务（最小装配无 revert 处理）",
          });
          return;
        }
        const reqUnion = req as { targetSeq?: number; promptId?: string };
        let resolvedTargetSeq = reqUnion.targetSeq;
        if (typeof reqUnion.promptId === "string") {
          const hit = store
            .load(sessionId)
            .filter((e) => e.type === "user/message" && e.promptId === reqUnion.promptId)
            .at(-1);
          if (hit === undefined) {
            send({
              type: "error",
              code: "REVERT_FAILED",
              message: `回溯失败：找不到 promptId=${reqUnion.promptId} 的用户消息`,
            });
            return;
          }
          resolvedTargetSeq = hit.seq - 1;
        }
        if (resolvedTargetSeq === undefined) {
          send({
            type: "error",
            code: "REVERT_FAILED",
            message: "revert 需要 targetSeq 或 promptId",
          });
          return;
        }
        void (async () => {
          try {
            assembly.handleRevert(resolvedTargetSeq);
            let codeRestored = false;
            if (assembly.checkpoint) {
              await assembly.checkpoint.restoreCodeTo(resolvedTargetSeq);
              codeRestored = true;
            }
            send({ type: "reverted", targetSeq: resolvedTargetSeq, codeRestored });
          } catch (e) {
            send({
              type: "error",
              code: "REVERT_FAILED",
              message: e instanceof Error ? e.message : String(e),
            });
          }
        })();
        return;
      }
      case "approve": {
        // C5 答复转达：成功无专用应答——settled 宣告与后续 tool/result 事件
        // 可见；失败（未装配 / 迟到 / 未知 id）回 error 行（类型化 code）。
        if (!assembly) {
          send({
            type: "error",
            code: "APPROVE_FAILED",
            message: "子进程未装配审批服务（最小装配无审批处理）",
          });
          return;
        }
        assembly
          .handleApprove(
            req.requestId,
            req.action,
            req.reason,
            req.scope,
            req.feedback,
            req.modifiedInput,
            req.source,
          )
          .catch((e: unknown) => {
            send({
              type: "error",
              code: e instanceof Error && "code" in e ? String((e as { code: unknown }).code) : "APPROVE_FAILED",
              message: e instanceof Error ? e.message : String(e),
            });
          });
        return;
      }
      case "question/answer": {
        // B8b 答复转达：映射 allow+reason=答复文本 / deny=未作答（结算语义
        // 复用 PendingApprovals）；失败（未装配 / 迟到 / 未知 id）回 error 行
        //（类型化 code，与 approve 同款分层）。
        if (!assembly) {
          send({
            type: "error",
            code: "QUESTION_ANSWER_FAILED",
            message: "子进程未装配会话服务（最小装配无 question 处理）",
          });
          return;
        }
        assembly
          .handleQuestionAnswer(req.requestId, req.answer)
          .catch((e: unknown) => {
            send({
              type: "error",
              code:
                e instanceof Error && "code" in e
                  ? String((e as { code: unknown }).code)
                  : "QUESTION_ANSWER_FAILED",
              message: e instanceof Error ? e.message : String(e),
            });
          });
        return;
      }
      case "model/switch": {
        // J6 换模：立即受理（configured 更新，生效点在新 turn——在途轮用
        // 启动时捕获值跑完，行为证据经后续 request/header 的身份变化可见）。
        // 失败回类型化 error 行：未注册 = MODEL_NOT_REGISTERED（不静默）。
        if (!assembly?.handleModelSwitch) {
          send({
            type: "error",
            code: "MODEL_SWITCH_UNAVAILABLE",
            message: "子进程未装配模型注册表（最小/单模型装配无换模能力）",
          });
          return;
        }
        try {
          assembly.handleModelSwitch(req.identity);
        } catch (e) {
          send({
            type: "error",
            code:
              e instanceof ModelNotRegisteredError
                ? e.code
                : "MODEL_SWITCH_FAILED",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      case "session/resume": {
        // M3/T-P1-86 崩溃续跑（显式动作）：restore（有外部存储时——跨进程
        // 历史进内存序）→ 对账（幂等）→ 定位最新 interrupted 轮 → 以原输入
        // 开新轮。红线：resume 是唯一的续跑例外且必须经本请求显式触发——
        // M8"重启绝不重放"的边界（无请求则零自动执行）。
        void (async () => {
          try {
            if (inflight || loop.activeTurn !== null) {
              send({
                type: "error",
                code: "AGENT_BUSY",
                message: "有在途轮——resume 只在空闲时受理",
              });
              return;
            }
            if (externalStorage) {
              await store.restore(sessionId);
            }
            reconcileBootState(store, sessionId); // 幂等：干净流 no-op
            const interrupted = findInterruptedTurn(store, sessionId);
            if (interrupted === null) {
              send({
                type: "error",
                code: "NO_INTERRUPTED_TURN",
                message: "没有可续跑的崩溃轮（最新轮已正常收束或无崩溃残留）",
              });
              return;
            }
            send({ type: "resumed", fromTurn: interrupted.turn });
            startTurn(interrupted.content);
          } catch (e) {
            send({
              type: "error",
              code: "RESUME_FAILED",
              message: e instanceof Error ? e.message : String(e),
            });
          }
        })();
        return;
      }
      case "command/run":
        // L7/T-P1-95：命令调用事实落流（log-only 会话级元事件，turn=0；
        // ForwardingStore 自动转发回显——落流可见性经协议 event 行）。
        store.append(sessionId, [
          {
            type: "command/run",
            turn: 0,
            commandId: req.commandId,
            name: req.name,
            ...(req.args !== undefined ? { args: req.args } : {}),
          },
        ]);
        return;
      case "command/done":
        store.append(sessionId, [
          {
            type: "command/done",
            turn: 0,
            commandId: req.commandId,
            kind: req.kind,
            ...(req.text !== undefined ? { text: req.text } : {}),
          },
        ]);
        return;
      case "feedback":
        // S5/T-P2-404：用户反馈落流（feedback/note log-only，turn=0）。
        // seq 存在性在此校验（流是唯一真相——kernel 不依赖 obs 域，提交面
        // obs/feedback.ts 的完整校验供库面消费方；形状校验已在协议层做）。
        if (req.targetSeq !== undefined) {
          const exists = store.load(sessionId).some((e) => e.seq === req.targetSeq);
          if (!exists) {
            send({
              type: "error",
              code: "FEEDBACK_INVALID",
              message: `feedback 的 targetSeq ${String(req.targetSeq)} 不在会话流内`,
            });
            return;
          }
        }
        store.append(sessionId, [
          {
            type: "feedback/note",
            turn: 0,
            kind: req.kind,
            ...(req.targetSeq !== undefined ? { targetSeq: req.targetSeq } : {}),
            ...(req.commandId !== undefined ? { commandId: req.commandId } : {}),
            ...(req.comment !== undefined ? { comment: req.comment } : {}),
            ...(req.doctorSummary !== undefined ? { doctorSummary: req.doctorSummary } : {}),
          },
        ]);
        return;
      case "config/refresh": {
        // B21/T-P1-63：热刷新——白名单键逐键应用并回执 applied；静态设置
        // 出现 → 类型化拒绝（STATIC_CONFIG_IMMUTABLE，整包不应用）。在途
        // turn 不受影响（J7 capturedModel 同构生效点语义）。
        try {
          const { applied } = configStore.refresh(req.patch);
          send({ type: "config_refreshed", applied });
        } catch (e) {
          send({
            type: "error",
            code: e instanceof StaticConfigImmutableError ? e.code : "CONFIG_REFRESH_FAILED",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      case "plugins/reload": {
        // T-P3-148 热加载：diff 重装载插件（工具注销/重注册 + 贡献盒回填 +
        // 插件 MCP 重连）→ 重发 ready（工具/技能/命令清单一次刷新）。在途
        // turn 不受影响（B16 执行策略快照纪律）。异步处理——错误走 error 行。
        void (async () => {
          try {
            await reloadPluginsNow();
            await sendReady();
            send({ type: "config_refreshed", applied: ["plugins"] });
          } catch (e) {
            send({
              type: "error",
              code: "PLUGIN_RELOAD_FAILED",
              message: e instanceof Error ? e.message : String(e),
            });
          }
        })();
        return;
      }
      case "policy/check": {
        // C19/T-P1-75：策略 dry-run——同链求值零执行（evaluateToolPolicy
        // 与 gate 层共用；assembly 未装配 = 无链可跑，类型化拒绝）。裁决
        // 经 policy_verdict 回执，不落事件流（dry-run 不是状态变更）。
        // handleRequest 保持同步签名，求值 promise 就地消费。
        const evalOptions = assembly?.policyEvalOptions;
        if (evalOptions === undefined) {
          send({
            type: "error",
            code: "POLICY_CHECK_UNAVAILABLE",
            message: "子进程未装配策略闸门，dry-run 不可用",
          });
          return;
        }
        evaluateToolPolicy(req.tool, JSON.stringify(req.args), evalOptions)
          .then((evaluation) => {
            if (evaluation === null) {
              send({
                type: "error",
                code: "POLICY_CHECK_MALFORMED",
                message: "参数不是 JSON 对象，dry-run 无法求值",
              });
              return;
            }
            const { verdict } = evaluation;
            // ask/abstain 一律回 "ask"：dry-run 不进 broker——显式 ask 规则
            // 与"整链无人应答"（abstain，gate 层按 C3 默认落 ask）对 dry-run
            // 消费方是同一件事：需审批。
            const action =
              verdict.action === "allow"
                ? "allow"
                : verdict.action === "deny"
                  ? "deny"
                  : "ask";
            send({
              type: "policy_verdict",
              tool: req.tool,
              args: evaluation.args,
              action,
              reason: verdict.reason,
              ...(verdict.rule !== undefined ? { rule: verdict.rule } : {}),
            });
          })
          .catch((e: unknown) => {
            send({
              type: "error",
              code: "POLICY_CHECK_FAILED",
              message: e instanceof Error ? e.message : String(e),
            });
          });
        return;
      }
      case "session/fork": {
        // E5/T-P1-40：fork 只动 store（新会话落独立流 + lineage 标记），
        // 本连接与在途轮不动——新会话的后续对话由新进程/新装配打开。
        try {
          const result = store.fork(sessionId, {
            target: req.targetId,
            ...(req.position !== undefined ? { position: req.position } : {}),
            ...(req.atSeq !== undefined ? { atSeq: req.atSeq } : {}),
          });
          void store.flush(result.sessionId).catch(() => {
            // flush 失败不回滚 fork（内存序已权威）；落库失败留给 Q5 对账
          });
          send({
            type: "forked",
            sessionId: result.sessionId,
            cutSeq: result.cutSeq,
            eventCount: result.eventCount,
          });
        } catch (e) {
          send({
            type: "error",
            code: e instanceof ForkError ? e.code : "FORK_FAILED",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      case "polish": {
        // T-P3-146 I：润色旁路调用（不开轮不落流——结果经 polish_result 回执；
        // 失败 ok:false 原样回传，UI 侧 toast）。未装配 = 类型化失败回执。
        if (options.polish === undefined) {
          send({
            type: "polish_result",
            requestId: req.requestId,
            ok: false,
            error: "本进程未装配润色面（辅助模型未配置或总闸已关闭——设置 → 辅助模型）",
          });
          return;
        }
        const polish = options.polish;
        void (async () => {
          try {
            const custom = polish.templateLoader ? await polish.templateLoader() : undefined;
            const result = await runPromptPolish({
              provider: polish.model.provider,
              identity: polish.model.identity,
              draft: req.draft,
              ...(custom !== undefined ? { custom } : {}),
            });
            // T-P3-147 F：副调用归因 header（turn=0 元事件纪律——log-only，
            // 投影不消费；usage 供 usage 页按任务分账）。失败不落（只记成功账）。
            try {
              store.append(sessionId, [
                {
                  type: "request/header",
                  turn: 0,
                  config: {
                    provider: polish.model.identity.provider,
                    modelId: polish.model.identity.modelId,
                  },
                  reason: "polish",
                  ...(result.usage !== undefined
                    ? { aux: { usage: result.usage, ms: result.ms } }
                    : {}),
                },
              ]);
              // T-P3-147 F：polish header 在轮外 append（write-behind 不经
              // turnEnd flush 点）——立即 flush 保证 SIGTERM 场景不丢归因
              void store.flush(sessionId).catch(() => undefined);
            } catch {
              // 归因落流失败不影响润色回执（观测是旁路面）
            }
            send({
              type: "polish_result",
              requestId: req.requestId,
              ok: true,
              text: result.text,
              ...(result.usage !== undefined ? { usage: result.usage } : {}),
            });
          } catch (e) {
            send({
              type: "polish_result",
              requestId: req.requestId,
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        })();
        return;
      }
      case "dispose":
        disposing = true;
        // J20/T-P1-49：收尾即闭闸——其后到达的 prompt/steer 被 SERVER_DRAINING
        // 拒绝（存量队列照常跑完 = EOF"处理完剩余工作"语义不变）。
        admission.beginDrain();
        loop.cancel({ kind: "disposed" });
        assembly?.dispose(); // 挂起审批按超时语义拒绝——gate 落 isError 后轮可收
        if (!inflight) void finish();
        return;
    }
  };

  // T-P3-146：ready 前装配提示词模板目录（文件模板 + 内置 + MCP prompts——
  // / 补全与设置页只读区的共用数据面；loader 缺席 = 目录缺席零变化）。
  /**
   * ready 消息构造（T-P3-148 热加载抽出——启动与 plugins/reload 共用：
   * 工具/技能/命令清单全部现扫，重发即刷新端面补全清单）。
   */
  const sendReady = async (): Promise<void> => {
    const readyPromptCatalog = options.promptContext
      ? await (async () => {
          try {
            const ctx = await options.promptContext!();
            // T-P3-148 B：插件贡献命令并入 ready 目录（重名弃用——同 promptContext）
            if (pluginContribBox.commands.length > 0) {
              const baseNames = new Set(ctx.templates.map((t) => t.name));
              ctx.templates = [
                ...ctx.templates,
                ...pluginContribBox.commands.filter((c) => !baseNames.has(c.name) && (baseNames.add(c.name), true)),
              ];
            }
            const classify = ctx.classify ?? (() => "extra" as const);
            const files = ctx.templates.map((t) => ({
              name: t.name,
              ...(t.description !== undefined ? { description: t.description } : {}),
              ...(t.argumentHint !== undefined ? { argumentHint: t.argumentHint } : {}),
              source: classify(t.origin),
            }));
            const builtins = BUILTIN_PROMPT_TEMPLATES.map((t) => ({
              name: t.name,
              description: t.description,
              ...(t.argumentHint !== undefined ? { argumentHint: t.argumentHint } : {}),
              source: "builtin" as const,
            }));
            const allConnections = [...mcpConnections, ...pluginMcpConnections];
            const mcpPrompts = allConnections.flatMap((c) =>
              c.prompts.map((p) => ({
                name: `${c.client.name}:${p.name}`,
                ...(p.description !== undefined ? { description: p.description } : {}),
                source: "mcp" as const,
              })),
            );
            return [...files, ...builtins, ...mcpPrompts];
          } catch {
            return undefined; // 目录装配失败 = 无目录面（never-fail，不炸启动）
          }
        })()
      : undefined;
    send({
      type: "ready",
      // U10/T-P3-109：注册表工具名 + I2 技能清单（/ 补全的清单来源——
      // registry 所有者是子进程；此扫描与首落系统提示的 loadSkills 重复一次，
      // 目录级成本记档）。assembly 缺席（最小装配）= 只报工具名单。
      tools: toolRegistry.names(),
      ...(options.assembly
        ? {
            skills: loadSkillsFromRoots(
              options.assembly.workspaceRoot ?? process.cwd(),
              options.assembly.skillsRoots,
              options.assembly.skillsDisabled !== undefined || pluginContribBox.skillDirs.length > 0
                ? {
                    ...(options.assembly.skillsDisabled !== undefined
                      ? { disabled: options.assembly.skillsDisabled }
                      : {}),
                    ...(pluginContribBox.skillDirs.length > 0 ? { extraDirs: pluginContribBox.skillDirs } : {}),
                  }
                : undefined,
            ).skills.map((s) => ({
              name: s.name,
              description: s.description,
            })),
          }
        : {}),
      ...(readyPromptCatalog !== undefined ? { prompts: readyPromptCatalog } : {}),
    });
  };
  // EP-9 握手（T1-3）：真 stdio 模式（未注入流——进程边界真实存在）启动即发
  // ClientHello，父侧校验版本后回 ServerHello，业务帧在父侧握手通过后才放行。
  // 进程内注入流（测试 rig / repl / 进程内单测——同进程同版本）跳过握手：
  // 版本协商只对跨进程边界有意义，记档。
  const realStdio = options.input === undefined;
  if (realStdio) {
    output.write(
      `${JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION } satisfies import("../kernel/agent-protocol.js").ClientHello)}\n`,
    );
  }
  await sendReady();
  const rl = createInterface({ input, crlfDelay: Infinity });
  const closed = new Promise<void>((resolve) => rl.on("close", resolve));
  let helloAcked = !realStdio;
  rl.on("line", (line: string) => {
    if (line.trim() === "") return;
    if (!helloAcked) {
      // 首行强制 ServerHello（fail-closed）：版本不匹配 / 坏形状 = stderr 归因 +
      // 类型化 exit 码（78）自退——不进业务循环，绝不带病服务
      try {
        decodeServerHello(line);
      } catch (e) {
        const hse = e as { code?: string; expected?: number; received?: number };
        process.stderr.write(
          `[agent-child] 协议握手失败：${hse?.code ?? "PROTOCOL_HELLO_MALFORMED"} ${e instanceof Error ? e.message : String(e)}\n`,
        );
        exit(EXIT_PROTOCOL_MISMATCH);
        return;
      }
      helloAcked = true;
      return;
    }
    let req: AgentRequest;
    try {
      req = decodeRequest(line);
    } catch (e) {
      const code = e instanceof ProtocolError ? e.code : "PROTOCOL_MALFORMED";
      send({ type: "error", code, message: e instanceof Error ? e.message : String(e) });
      return;
    }
    try {
      handleRequest(req);
    } catch (e) {
      send({
        type: "error",
        code: "AGENT_DISPATCH_ERROR",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });
  // 父进程意外离场（stdout 断开 → EPIPE）：不崩——无监听器时该错误会直接
  // 杀死子进程，turn 的 write-behind buffer 随之丢失。走与 stdin 关闭相同的
  // 优雅收尾：cancel 在途轮、等轮收尾（turn 末 flush 落库）再退出。
  // J2 实测踩中：父进程被 head 截断后子进程崩溃，事件 buffer 全丢。
  const outputBroken = new Promise<void>((resolve) => {
    output.on("error", () => resolve());
  });
  await Promise.race([closed, outputBroken]);
  // stdin 关闭或输出断开：视作 dispose（父进程先行离场时不留悬挂轮）
  if (!disposing) {
    disposing = true;
    admission.beginDrain();
    loop.cancel({ kind: "disposed" });
    assembly?.dispose();
  }
  if (!inflight) {
    await finish();
    return;
  }
  await inflight;
  await finish();
}

// ---------------------------------------------------------------------------
// 父进程侧：spawn + 行分帧 + 异步消息队列
// ---------------------------------------------------------------------------

/** 最小异步队列：push/finish 与 async iterator 的 next 对接。 */
class MessageQueue {
  private readonly items: AgentMessage[] = [];
  private waiter: ((r: IteratorResult<AgentMessage>) => void) | null = null;
  private finished = false;

  push(message: AgentMessage): void {
    if (this.finished) return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: message, done: false });
      return;
    }
    this.items.push(message);
  }

  finish(): void {
    this.finished = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: undefined, done: true });
    }
  }

  next(): Promise<IteratorResult<AgentMessage>> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve({ value: item, done: false });
    if (this.finished) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }
}

export interface AgentProcess {
  /** 发请求（fire-and-forget；收执/事件经 messages 观察）。 */
  send(request: AgentRequest): void;
  /** 子进程消息流（ready → accepted/event/error*），进程退出后自然结束。 */
  messages: AsyncIterable<AgentMessage>;
  /** 终止子进程并等待退出。 */
  kill(): Promise<void>;
}

export interface SpawnAgentOptions {
  /** 编译后的子进程入口（dist/src/runtime/child.js）。 */
  entryPath: string;
  /** 透传给子进程的参数（T-8-01：CLI 装配选项）。 */
  args?: readonly string[];
  /** stderr 行回调（T-P3-154 A4——host 注入 sink 归管进 agent-*.log 管道；
   * 缺省 inherit 父进程 stderr，行为不变）。 */
  stderrSink?: (line: string) => void;
}

export function spawnAgentProcess(options: SpawnAgentOptions): AgentProcess {
  const child = spawn(process.execPath, [options.entryPath, ...(options.args ?? [])], {
    stdio: ["pipe", "pipe", options.stderrSink ? "pipe" : "inherit"],
  });
  // T-P3-147（走查实录）：child 静默退出时（stderr inherit 仍无输出）父侧
  // 无从知晓——spawn 命令与退出码/信号落 stderr，运维与诊断面共用。
  // T-P3-154 A4：注入 stderrSink 时归管进日志管道（host 侧 agent-*.log）。
  const diag = (line: string): void => {
    if (options.stderrSink !== undefined) options.stderrSink(line);
    else console.error(line);
  };
  diag(
    `[agent] spawn: ${JSON.stringify([process.execPath, options.entryPath, ...(options.args ?? [])])}`,
  );
  // §18/T5-5：stderr 尾 40 行环形缓冲 + 退出归因（code/signal + stderr 尾巴）。
  const stderrTail: string[] = [];
  const STDERR_TAIL_LINES = 40;
  child.on("exit", (code, signal) => {
    const tail = stderrTail.slice(-STDERR_TAIL_LINES).join(" | ");
    diag(
      `[agent] child exited: code=${String(code)} signal=${String(signal)}` +
        (tail !== "" ? ` stderr_tail=${tail}` : ""),
    );
  });
  child.on("error", (e) => {
    diag(`[agent] child spawn error: ${e.message}`);
  });
  if (options.stderrSink !== undefined && child.stderr !== null) {
    // 行缓冲转发（跨 chunk 行不裂——pi-desktop flushChild 同款纪律）
    let errBuf = "";
    child.stderr.setEncoding("utf-8");
    // §18/T5-5：stderr 行进尾 40 行环形缓冲（退出归因数据源）再转发 sink。
    child.stderr.on("data", (chunk: string) => {
      errBuf += chunk;
      for (;;) {
        const nl = errBuf.indexOf("\n");
        if (nl < 0) break;
        const line = errBuf.slice(0, nl).trimEnd();
        errBuf = errBuf.slice(nl + 1);
        if (line.trim() !== "") {
          stderrTail.push(line);
          if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
          options.stderrSink?.(line);
        }
      }
    });
    child.stderr.on("end", () => {
      if (errBuf.trim() !== "") options.stderrSink?.(errBuf.trimEnd());
    });
  }
  const queue = new MessageQueue();
  // EP-9 握手（T1-3）：首个 stdout 行必须是 ClientHello——通过前业务帧不入队、
  // 消费者 send 的请求缓冲（保证 ServerHello 是子侧读到的首行）。
  let helloDone = false;
  const pendingRequests: AgentRequest[] = [];
  const failHandshake = (e: unknown): void => {
    const hse = e as { code?: string };
    queue.push({
      type: "error",
      code: hse?.code ?? "PROTOCOL_HELLO_MALFORMED",
      message: e instanceof Error ? e.message : String(e),
    });
    queue.finish();
    diag(`[agent] 握手失败（杀进程）：${e instanceof Error ? e.message : String(e)}`);
    child.kill();
  };

  child.stdout!.setEncoding("utf-8");
  // 行分帧走 framing 层原语（T1-4 换传输替换点：跨 chunk 行不裂的状态机）
  const feedLine = createLineSplitter((line) => {
    if (line.trim() === "") return;
    if (!helloDone) {
      // 首帧强制 hello（fail-closed）：版本不匹配 / 旧版子进程（不发 hello）/
      // 坏形状一律类型化拒绝并杀进程——不降级兼容
      try {
        const hello = decodeClientHello(line);
        if (hello.protocolVersion !== PROTOCOL_VERSION) {
          throw new ProtocolHandshakeError(
            "PROTOCOL_VERSION_MISMATCH",
            `协议版本不匹配：父进程期望 ${PROTOCOL_VERSION}，子进程声明 ${hello.protocolVersion}`,
            PROTOCOL_VERSION,
            hello.protocolVersion,
          );
        }
      } catch (e) {
        failHandshake(e);
        return;
      }
      helloDone = true;
      child.stdin!.write(encodeFrame({ type: "hello-ack", protocolVersion: PROTOCOL_VERSION } satisfies ServerHello));
      for (const r of pendingRequests) child.stdin!.write(encodeFrame(r));
      pendingRequests.length = 0;
      return;
    }
    try {
      queue.push(decodeMessage(line));
    } catch {
      // 子进程产出非协议行：父进程不该假装没看见，但也不该崩——丢弃并继续
    }
  });
  child.stdout!.on("data", (chunk: string) => feedLine(chunk));
  child.stdout!.on("close", () => queue.finish());
  child.on("close", () => queue.finish());
  // 子进程退出后父进程仍可能补发请求（收尾竞态）——stdin 对端已关触发
  // EPIPE 是生命周期正常终态而非异常；不挂监听会成为 uncaught exception
  // 带崩宿主（live 真实子进程 + vitest worker 收尾竞速，2026-09-29 记档修复）。
  child.stdin!.on("error", () => {});

  return {
    send(request: AgentRequest): void {
      if (!helloDone) {
        // 握手未完成：缓冲（ack 回写后按序 flush——ServerHello 保证是子侧首行）
        pendingRequests.push(request);
        return;
      }
      child.stdin!.write(encodeFrame(request));
    },
    messages: {
      [Symbol.asyncIterator]() {
        return { next: () => queue.next() };
      },
    },
    kill(): Promise<void> {
      return new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once("close", () => resolve());
        child.kill();
      });
    },
  };
}
