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

import type { CancelCause, SessionRef, TurnEndReason } from "./events.js";
import { AgentLoop, type AgentLoopDeps, type ToolExecutionMode } from "./loop.js";
import { PromptQueue, QueueFullError } from "./queue.js";
import { validateAttachments, AttachmentLimitError } from "../attachments/limits.js";
import { base64ByteLength } from "../attachments/store.js";
import type { AttachmentRef } from "../attachments/types.js";
import type { AttachmentStore } from "../attachments/store.js";
import { offloadOldestImages } from "../attachments/offload.js";
import { effectiveEvents } from "../session/messages.js";
import {
  ReferenceError,
  assertNoReferenceCycle,
  refsOfEvents,
} from "../session/reference.js";
import { ToolClassLimiter, TurnAdmission } from "./admission.js";
import { isWriteExecuteTool } from "../policy/protected-paths.js";
import { SessionConfigStore, StaticConfigImmutableError } from "./session-config.js";
import type { RetryObservation } from "../models/retry.js";
import {
  type AgentMessage,
  type AgentRequest,
  ProtocolError,
  decodeMessage,
  decodeRequest,
} from "./agent-protocol.js";
import type { ApprovalAnnouncement } from "../policy/pending.js";
import type { ChatRequest, ModelProvider } from "../models/provider.js";
import type { ModelIdentity } from "../models/identity.js";
import { ForkError, InMemoryEventStorage, type EventStorage, SessionStore } from "../session/store.js";
import { InvalidSessionIdError, isValidSessionId } from "../session/session-id.js";
import { Projector, ProjectError } from "../session/project.js";
import { findInterruptedTurn, reconcileBootState } from "../session/boot-maintenance.js";
import { RawChunkLog } from "./raw-chunk-log.js";
import { createChildAssembly, createTodoUpdateEmitter, type ChildAssembly, type ChildAssemblyOptions } from "./assembly.js";
import { evaluateToolPolicy } from "../policy/gate.js";
import { ModelNotRegisteredError } from "./model-switch.js";
import { createSubagentRunner } from "./subagent.js";
import { registerBuiltinTools } from "./tools/builtin/index.js";
import { NodeExecutionEnv } from "./tools/env.js";
import { ToolRegistry } from "./tools/registry.js";
import { DEFAULT_SPILL_DIR } from "./tools/truncate.js";
import { sweepSessionSpill } from "./tools/spill-gc.js";

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
    output.write(`${JSON.stringify(message)}\n`);
  };

  // 事件出进程的唯一通道：append 返回的已提交事件逐条转发为协议 event 行
  // （C14 已在 append 兜底，转发值必为 JSON 安全）
  const store = new (class ForwardingStore extends SessionStore {
    override append(
      sessionId: string,
      events: readonly import("./events.js").NewSessionEvent[],
    ): import("./events.js").SessionEvent[] {
      const committed = super.append(sessionId, events);
      for (const event of committed) send({ type: "event", event });
      return committed;
    }
  })(options.storage ?? new InMemoryEventStorage());
  // M3 resume 的 restore 前置：注入式 storage 才有跨进程历史可恢复
  //（InMemory 每次启动都是空流，restore 无意义）。
  const externalStorage = options.storage;

  // 审批宣告分型（B8b/T-P1-21）：question 工具的挂起/结算不是权限审批——
  // asked 转成 question_asked 协议行、settled 不经 approval_settled 面
  //（答复事实由 tool/result 事件承载）；timed-out 依旧只走事件流。
  const forwardApprovalAnnouncement = (announcement: ApprovalAnnouncement): void => {
    if (announcement.kind === "asked") {
      if (announcement.request.tool === "question") {
        send({
          type: "question_asked",
          requestId: announcement.request.id,
          question: String(announcement.request.args["question"] ?? ""),
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
      ...(options.queueMaxSize !== undefined ? { queueMaxSize: options.queueMaxSize } : {}),
    },
    // C8：预设切换经 onInfo 留痕（logger.info——"预设事件保留用户意图"）
    options.logger !== undefined ? { onInfo: (m) => options.logger?.info(m) } : undefined,
  );

  const assembly: ChildAssembly | undefined = options.assembly
    ? createChildAssembly({
        sessionId,
        store,
        ...options.assembly,
        onApprovalAnnouncement: forwardApprovalAnnouncement,
        // C33：无人值守活查询接 SessionConfigStore（config/refresh 通道
        // 切换即生效；store getter 缺省 undefined → === true 为 false）
        unattended: () => configStore.unattended === true,
      })
    : undefined;

  // H1/H4/T-P1-42：子代理 runner（顶层会话 depth=0）。降级规则的输入 =
  // 装配 rules 选项原样（deriveSubagentRules 在 runner 内对每层子装配
  // 现算——捕获时点即派发时点，captureDelegatedPolicyOverrides 同构）。
  const runSubagent = subagentOptions
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
        ...(assembly?.modelForTurn ? { modelForTurn: assembly.modelForTurn } : {}),
      })
    : undefined;

  const queue = new PromptQueue("one-at-a-time", options.queueMaxSize);
  // 工具装配（T-4-05 接线，兑现 T-4-02 偏离⑥）：注册表分发就是 toolCall 链的
  // 链底 terminal——executeTool 槽位由 registry.dispatch 充当，不存在旁路。
  // T-8-01：装配提供 PathGuard 时经它构造（写守卫唯一入口，T-6-01）。
  // Q3（T-P1-14）：sessionId/spillDir 传进注册表——spill 标记带真实会话身份，
  // 会话关闭清理才能按身份命中（缺省标记记 unknown-session 无法清理）。
  const toolRegistry = new ToolRegistry({
    env: new NodeExecutionEnv(),
    sessionId,
    ...(options.spillDir !== undefined ? { spillDir: options.spillDir } : {}),
    // C12/C13：读记账（可选装配，缺省不启用——工具照常用）
    ...(options.assembly?.readGate !== undefined
      ? { readGate: options.assembly.readGate }
      : {}),
  });
  registerBuiltinTools(
    toolRegistry,
    {
      // G2 todo 落流出口（T-P1-10）：无条件构造——最小装配（无权限层）
      // 也有 store，todo/update 事件落流不依赖生产装配在位。
      todoEmit: createTodoUpdateEmitter(store, sessionId),
      ...(assembly
        ? {
            pathGuard: assembly.pathGuard,
            // I2 技能根 = 工作区根（skill_load 的扫描面）
            skillsRoot: options.assembly?.workspaceRoot ?? process.cwd(),
            // G1 plan 模式工具面（planMode 启用时装配提供同一服务实例）
            // + G4 计划落盘出口（planArtifactDir 提供时存在）
            ...(assembly.planMode ? { planMode: assembly.planMode } : {}),
            ...(assembly.savePlanArtifact
              ? { savePlanArtifact: assembly.savePlanArtifact }
              : {}),
            // B8a/T-P1-20：networkPolicy 装配选项提供时注册 webfetch
            //（D3 唯一入口随守卫注入，无守卫不注册）
            ...(assembly.networkGuard ? { networkGuard: assembly.networkGuard } : {}),
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
    },
  );
  const decideTurnBase: AgentLoopDeps["decideTurn"] = (record) =>
    record.toolCalls.length > 0 ? { action: "continue" } : { action: "end" };
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
    decideTurn: assembly ? assembly.wrapDecideTurn(decideTurnBase) : decideTurnBase,
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
  const loop = new AgentLoop(loopDeps);
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
      return loop.runTurn(content, attachments, sessionRefs);
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
    startTurn(next.content, next.attachments, next.sessionRefs);
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
        // A9：先收执、再入队/开轮——accepted 只证明 admission。
        // M9/T-P1-48：队列满（有限队列）类型化拒绝——收执不发、消息不入队。
        try {
          queue.enqueue(req.content, attachmentRefs, sessionRefs);
        } catch (e) {
          if (e instanceof QueueFullError) {
            send({ type: "error", code: e.code, message: e.message });
            return;
          }
          throw e;
        }
        send({ type: "accepted", messageId: req.messageId });
        kick();
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
      case "revert": {
        // E4+E11 双回退：先对话态（校验便宜、失败不产生半退）再代码态。
        // 成功回 reverted 回执（CLI 据此报告代码是否回退）；失败回 error 行。
        if (!assembly) {
          send({
            type: "error",
            code: "REVERT_FAILED",
            message: "子进程未装配会话服务（最小装配无 revert 处理）",
          });
          return;
        }
        void (async () => {
          try {
            assembly.handleRevert(req.targetSeq);
            let codeRestored = false;
            if (assembly.checkpoint) {
              await assembly.checkpoint.restoreCodeTo(req.targetSeq);
              codeRestored = true;
            }
            send({ type: "reverted", targetSeq: req.targetSeq, codeRestored });
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

  send({ type: "ready" });
  const rl = createInterface({ input, crlfDelay: Infinity });
  const closed = new Promise<void>((resolve) => rl.on("close", resolve));
  rl.on("line", (line: string) => {
    if (line.trim() === "") return;
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
  /** 编译后的子进程入口（dist/src/kernel/agent-child.js）。 */
  entryPath: string;
  /** 透传给子进程的参数（T-8-01：CLI 装配选项）。 */
  args?: readonly string[];
}

export function spawnAgentProcess(options: SpawnAgentOptions): AgentProcess {
  const child = spawn(process.execPath, [options.entryPath, ...(options.args ?? [])], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const queue = new MessageQueue();
  let buffer = "";

  child.stdout.setEncoding("utf-8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const nl = buffer.indexOf("\n");
      if (nl < 0) break;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.trim() === "") continue;
      try {
        queue.push(decodeMessage(line));
      } catch {
        // 子进程产出非协议行：父进程不该假装没看见，但也不该崩——丢弃并继续
      }
    }
  });
  child.stdout.on("close", () => queue.finish());
  child.on("close", () => queue.finish());

  return {
    send(request: AgentRequest): void {
      child.stdin.write(`${JSON.stringify(request)}\n`);
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
