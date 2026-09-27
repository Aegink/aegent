/**
 * agent 主循环（A1/A6）——三级生命周期的中段：turn（用户轮）→ step（一次
 * 模型调用 + 其工具执行）→ message。**pi 的 "turn"（一次 assistant 回复 + 其
 * 工具调用）在我方叫 step**（l0-events.md §2.1 决定 1），A6 的验收措辞
 * "一个 turn = 一次 assistant 回复 + 其工具调用"按此映射到 step。
 *
 * A1 纪律：停不停由 DecideTurn **显式**给出（pi types.ts:143 的
 * AgentTurnDecision 形状），loop 自己绝不推断"没有 toolCall 就停"——
 * 有专用测试钉死：无 toolCall 且 DecideTurn 给 continue 时 loop 必须继续。
 *
 * 链接线（Q14 / T-3-01 的三点位决定）：loop 按链写，三个点位全部走到——
 *   modelRequest  包住"组装请求 → request/header → 消费流"整段（阶段 7 上下文
 *                 装配层在此换载荷 next(e2)；截断 = 不放行请求，turn 以 blocked 终止）；
 *   toolCall      包住"单次工具执行"（阶段 5 权限层在此截断 = 拒绝执行）；
 *   turnEnd       包住"落 turn/end"（阶段 7 压缩层在此作业）。
 *
 * 事件真相（不变量 1）：loop 不养第二份会话历史——每步的模型请求消息从
 * store.load() 投影重建（遵循最新 session/revert 标记的有效视窗）；loop 只写
 * 事件。compaction 的窗口重建属阶段 7，P0 逐条直读。
 *
 * 模型调用直接消费 T-2-02 的 ModelProvider/StreamChunk；重试由装配处套
 * T-2-03 的 withRetry（ProviderHttpError 只在响应头阶段抛、流产出后不重试，
 * 该语义已钉死在 retry.test）——loop 内不设第二条重试路径。模型身份每
 * turn 启动捕获一次（J6/J7 的 modelForTurn，T-P1-04）：在途换模生效点在
 * 新 turn，本 turn 全程用捕获值跑完。
 */

import type { ModelIdentity } from "../models/identity.js";
import { parseRetryAfterMs } from "../models/retry.js";
import * as path from "node:path";
import {
  type ChatMessage,
  type ChatTool,
  type ModelProvider,
  ProviderHttpError,
} from "../models/provider.js";
import { buildChatMessages, effectiveEvents } from "../session/messages.js";
import { Projector } from "../session/project.js";
import type { SessionStore } from "../session/store.js";
import { computeCacheAnchor, type PrefixChange } from "../context/prefix-anchor.js";
import { BudgetExceededError, ParseBudget } from "./budget.js";
import { normalizePromptVerdict, type PromptGate } from "./prompt-gate.js";
import { MUTATION_RETRY_BUDGET_EXHAUSTED, type MutationRetryBudget } from "./tools/mutation-budget.js";
import type { Logger } from "./logger.js";
import type { RawChunkLog } from "./raw-chunk-log.js";
import {
  type ChainExecutor,
  type ChainLayer,
  composeChain,
} from "./chain.js";
import type {
  CancelCause,
  JsonValue,
  LlmFailure,
  NewSessionEvent,
  TimedStreamChunk,
  TokenUsage,
  TurnEndReason,
} from "./events.js";
import { TimeoutError } from "./timeout.js";
import { RwLock } from "./rw-lock.js";
import { type PromptQueue } from "./queue.js";
import { type RunState } from "./run-state.js";

// ---------------------------------------------------------------------------
// 链点位的载荷 / 产物类型（T-3-01 卡定形的三个点的具体形状）
// ---------------------------------------------------------------------------

/** 链上下文（P0 最小面；阶段 5/7 需要服务时扩此接口，不开泛型）。 */
export interface LoopContext {
  sessionId: string;
}

/** modelRequest 点位：包住"这次模型请求"。 */
export interface ModelRequestPayload {
  turn: number;
  step: number;
  identity: ModelIdentity;
  messages: ChatMessage[];
  tools?: ChatTool[];
}

/** modelRequest 点位的产物：流消费完毕后的装配结果。 */
export interface ModelStepOutput {
  content: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  usage?: TokenUsage;
  /** 无损定时流记录——assistant/message.stream 与 assistant/attempt.stream 的来源。 */
  timed: TimedStreamChunk[];
  /** A7：流中途被取消——内容是已交付前缀，其后不再消费。 */
  interrupted?: true;
  /** B19/T-P1-61：本次模型请求的耗时面（首 chunk 延迟 + 流总时长）。 */
  timing?: { firstTokenLatencyMs: number; streamDurationMs: number };
  /** B19/T-P1-61：本次模型请求的关联 id（`r<序数>` 会话内单调）。 */
  traceId?: string;
  /** B20/T-P1-62：厂商 finishReason（done chunk 透传——触顶续跑判定面）。 */
  finishReason?: string;
}

/** toolCall 点位：包住"单次工具执行"（载荷与 tool/call 事件同源）。 */
export interface ToolCallPayload {
  turn: number;
  step: number;
  callId: string;
  name: string;
  /** 模型产出的原始 arguments JSON 串，unparsed（B12）。 */
  arguments: string;
  /**
   * B7 进度上报通道（T-P1-16）：loop 在进入链前按调用注入（createProgress
   * Reporter 闭包——seqInCall 单调、条数有上限），经 terminal 流进
   * ToolContext.reportProgress。链层替换载荷时丢失即无进度（best-effort）。
   */
  report?: (message: string) => void;
  /**
   * T-P1-43：本 turn 的取消信号（A7 槽位的 AbortSignal 面）——工具可选
   * 消费（task 用它联动子循环取消）；经 registry 转进 ToolContext.signal。
   */
  signal?: AbortSignal;
  /**
   * B16/T-P1-59：本 step 的执行策略快照（step 开始时固化的 parallel 声明
   * 与 M6 超时预算）——经链透传到 registry.dispatch，提供时 timeoutMs 以
   * 快照为准（在途 step 用 advertise 它们的那一步的声明）。
   */
  runtimeMeta?: { parallel?: boolean; timeoutMs?: number };
}

/** toolCall 点位的产物（形状 = ToolResultEvent 的消息侧载荷）。 */
export interface ToolExecutionResult {
  content: string;
  isError?: boolean;
  error?: { name: string; code: string; reason?: string };
  /** 工具私有展示载荷，对内核不透明；append 时由 assertJsonSafe 兜底（C14）。 */
  meta?: JsonValue;
}

/**
 * B20/T-P1-62 输出 token 触顶的 finishReason 闭集（zcode OUTPUT_LIMIT_RAW_
 * REASONS 同构，冻结只追加——C10 先例）：纯文本被截断且无工具调用时判定
 * "可续跑"。
 */
export const OUTPUT_TOKEN_LIMIT_FINISH_REASONS: ReadonlySet<string> = new Set([
  "length",
  "max_tokens",
  "max_output_tokens",
]);

/** B20/T-P1-62 续跑指令（zcode OUTPUT_TOKEN_CONTINUE_PROMPT 同款语义）。 */
export const OUTPUT_TOKEN_CONTINUE_PROMPT =
  "Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.";

/** B20/T-P1-62 每 turn 续跑上限（zcode MAX_OUTPUT_TOKEN_CONTINUATIONS=3 同值）。 */
export const MAX_OUTPUT_TOKEN_CONTINUATIONS = 3;

/** turnEnd 点位：包住"落 turn/end"。reason 由 loop 定，层只观察（P0）。 */
export interface TurnEndPayload {
  turn: number;
  reason: TurnEndReason;
}

// ---------------------------------------------------------------------------
// A1：显式停止条件
// ---------------------------------------------------------------------------

/** A1 显式停止决策（pi AgentTurnDecision 同形状）——停止是返回的决策，不是循环推断。 */
export type TurnDecision = { action: "continue" } | { action: "end" };

/**
 * B6 工具执行模式（pi ToolExecutionMode 同名两档）："sequential" = 逐个
 * 执行到底（P0 行为）；"parallel" = preflight 顺序、执行并发（pi types.ts:307
 * "preflight tool calls sequentially, then execute allowed tools concurrently"
 * 同款）——tool/call 事件按提交序落流，tool/result 按完成序落流。
 */
export type ToolExecutionMode = "sequential" | "parallel";

/**
 * B7/T-P1-16：单调用进度条数上限（卡内定形）——报告次数超过后静默丢弃。
 * 10 条 × 每条几十字节是常量级流量，"进度不撑爆事件流"由构造保证。
 */
export const MAX_TOOL_PROGRESS_PER_CALL = 10;

/** 一个 step 的完整结果——DecideTurn 的全部决策依据。 */
export interface StepRecord {
  turn: number;
  step: number;
  /** assistant 文本（只有 toolCall 时为空串）。 */
  content: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  toolResults: { callId: string; content: string; isError?: boolean }[];
  usage?: TokenUsage;
}

export type DecideTurn = (
  record: StepRecord,
) => TurnDecision | Promise<TurnDecision>;

// ---------------------------------------------------------------------------
// 循环本体
// ---------------------------------------------------------------------------

export interface AgentLoopDeps {
  sessionId: string;
  store: SessionStore;
  /**
   * 已在装配处套好 withRetry 的 provider（组合点在 T-3-06 的进程装配）；
   * loop 只认 ModelProvider 接口，不重复包重试。
   */
  provider: ModelProvider;
  identity: ModelIdentity;
  /** 本次请求可用的工具清单（阶段 4 注册表接入前可空）。 */
  tools?: ChatTool[];
  /**
   * F12/F14/T-P1-17 每请求工具清单源：模型按名索取（tool_load）后 deferrable
   * 工具的真 schema 才出现——装配传注册表的 toChatTools() 闭包，loop 每次
   * callModel 现取。缺省 undefined = 固定用 tools（P0 零行为变化）。
   */
  toolsProvider?: () => ChatTool[];
  /** 工具执行终端（阶段 4 = 注册表分发；测试注入假实现）。 */
  executeTool(call: {
    callId: string;
    name: string;
    arguments: string;
    /** B7 进度上报通道（T-P1-16）：registry 转进 ToolContext.reportProgress。 */
    report?: (message: string) => void;
  }): Promise<ToolExecutionResult>;
  decideTurn: DecideTurn;
  /**
   * prompt 队列（A2/A9，T-3-03 接线）：step 边界按 QueueMode 排空注入。
   * 空闲期（两轮之间）入队的消息会在下一个 step 边界一并进入请求；
   * 从队列开启新 turn 属进程编排（T-3-06），不在 loop 内。
   */
  queue?: PromptQueue;
  /**
   * 运行态服务（A3，T-3-05 接线）：runTurn 开始 markBusy，turn/end 落盘成功
   * 后（closeTurn 尾部，唯一通知点）markIdle。崩溃路径到不了 markIdle——
   * busy 由恢复路径归位（宁可误报 busy，绝不误报 idle）。
   */
  runState?: RunState;
  /**
   * 工具循环的双轴预算（B14，T-4-08 接入）：缺省启用默认上限
   * （DEFAULT_MAX_TOOL_CALLS / DEFAULT_TOOL_LOOP_TIMEOUT_MS），传 Infinity
   * 显式禁轴。预算耗尽 = 停止派发，未派发的调用缺席（与取消同语义，
   * 配平不变量不受影响）。parallel 模式（T-P1-15）下 tick 照常逐调用
   * 计数（并行批内累加），progress 不再调用——批内全部派发后没有剩余
   * 派发点，时间轴的实际闸门是下一步的 tick。
   */
  toolBudget?: { maxTicks?: number; timeoutMs?: number };
  /**
   * B6/T-P1-15 工具执行模式（pi ToolExecutionMode 同名两档）：缺省
   * "sequential"（P0 行为零变化）。"parallel" = preflight（取消/预算检查 +
   * tool/call 落流）顺序、执行并发（pi types.ts:307 "preflight tool calls
   * sequentially, then execute allowed tools concurrently" 同款）——tool/call
   * 事件按提交序落流，tool/result 按完成序落流；并发纪律走 isParallelTool
   * 声明 + 一把 RwLock（B17：读=并行、写=排他）。
   */
  toolExecution?: ToolExecutionMode;
  /**
   * B17 并行声明查询：工具名 → 是否声明了可并行（只读类）。未注册/未声明
   * 一律 false = 排他（未声明即不可并行，fail-closed）。缺省 undefined 时
   * parallel 模式下所有工具都排他（与 sequential 等效但事件序不同）。
   */
  isParallelTool?(name: string): boolean;
  /**
   * F6/F13/T-P1-19 缓存锚变化通知（逐请求检测）：锚 = system + tools 字节
   * 序（computeCacheAnchor）。identical 静默；appended（位置性追加，F13
   * 允许）与 rewritten（前缀作废——换模时 rewritten 即违背 F13，装配侧
   * 据此告警）。缺省 undefined = 不检测通知（锚计算本身零开销）。
   */
  onCacheAnchorChange?(change: PrefixChange): void;
  /** 三个点位的层。P0 恒空数组；阶段 5/7 的权限/上下文/压缩层从这里进。 */
  layers?: {
    toolCall?: ReadonlyArray<
      ChainLayer<LoopContext, ToolCallPayload, ToolExecutionResult>
    >;
    modelRequest?: ReadonlyArray<
      ChainLayer<LoopContext, ModelRequestPayload, ModelStepOutput>
    >;
    turnEnd?: ReadonlyArray<ChainLayer<LoopContext, TurnEndPayload, void>>;
  };
  /**
   * J6/J7 每轮模型解析（T-P1-04 装配接线）：turn 启动时调用一次，返回值
   * 即本 turn 全程的 provider 与 identity——在途换模只改装配侧 configured，
   * 本 turn 用启动时捕获值跑完（生效点在新 turn，pi 的 captured/configured
   * 分离同款）。缺省 undefined = 固定用 provider/identity（P0 单模型装配
   * 零行为变化）。
   */
  modelForTurn?(turn: number): {
    provider: ModelProvider;
    identity: ModelIdentity;
  };
  /**
   * J11 换模事务（T-P1-05 装配接线）：turn 以 error 终止时通知装配——
   * 装配处据此驱动 ModelSwitchService.reportRequestFailure（不兼容判据
   * 命中 → 回滚 prev）。同 beforeFirstModelRequest 先例：显式时点 hook，
   * 不是链点位；纯通知，loop 不关心返回。
   */
  onTurnError?(turn: number, failure: LlmFailure): void;
  /**
   * PreTurn 压缩挂点（T-8 装配，zcode PreRequest 同款）：本 turn 的
   * turn/start + user/message 已落盘（新 prompt 已入流）、首次模型请求尚未
   * 发出时调用——装配处在此跑本地溢出判定与 PreTurn 相位压缩（F9/F21）。
   * 压缩不挂 modelRequest 链（T-3-01 排除项：与上下文装配互踩），这个显式
   * 时点是 loop 提供给装配的唯一合法入口。
   */
  beforeFirstModelRequest?(turn: number): Promise<void>;
  /**
   * 一个含工具调用的 step 完成后回调（T-8 装配：RapidRefillGuard 的
   * recordCompletedToolStep 记账——真实干活会拉高 toolTurnsSinceCompact，
   * 解锁抖动断路器）。纯通知，loop 不关心返回。
   */
  onToolStepCompleted?(turn: number, step: number): void;
  /**
   * A13/T-P1-48 prompt 入队闸门：step 边界注入前逐条裁决（kimi
   * promptGateActor 出队裁决同构）——放行进历史 / 拦截不落流（warn 留痕）/
   * 改写放行。缺省 undefined = 全放行（P0 行为零变化）。gate 抛错沿
   * runTurn 的 catch 走 failTurn 收轮（装配钩子异常与 hook 崩溃同轨）。
   */
  promptGate?: PromptGate;
  /** A13 拦截留痕（结构化 warn 可检索）；缺省 undefined = 不打日志。 */
  logger?: Logger;
  /** E14/T-P1-90 原始分片诊断日志（装配注入；缺省不写——旁路通道）。 */
  rawChunkLog?: RawChunkLog;
  /**
   * A14/T-P1-50 护栏一：单 turn 内最大 step 数（模型一直 continue 不停的
   * 强制收束）。缺省 0 = 不限（kimi configSection maxStepsPerTurn optional
   * 同构）。超限 → logger.warn + turn/end{blocked}（显式护栏终止，非
   * completed——模型没说完成；与 B14 工具预算轴语义不同：B14 数工具调用
   * 且跨 turn 持续，本护栏数 step 且每 turn 重置）。
   */
  maxStepsPerTurn?: number;
  /**
   * B16/T-P1-59：工具执行策略快照源（装配注入 registry.runtimeMeta 同名
   * 包装）——loop 在 step 开始按广告清单固化声明。缺省 undefined = parallel
   * 判定落回 isParallelTool 现查、timeoutMs 用 def 现值（零行为变化）。
   */
  toolRuntimeMeta?: (name: string) => { parallel: boolean; timeoutMs: number | undefined } | undefined;
  /**
   * B13/T-P1-57 mutation 重试预算（prompt × path 双作用域）：edit/apply_patch
   * 失败结果（meta.mutationPaths）按当前 promptId 上报记账，同一路径第 3 次
   * 计数失败 → 本 step 收尾 turn/end{blocked}（显式护栏终止）。缺省 undefined
   * = 不启用（零行为变化）。
   */
  mutationBudget?: MutationRetryBudget;
  /**
   * A14/T-P1-50 护栏二：取消后等待在途工作收尾的超时（kimi machine.ts:428
   * `abortTimeout: abortTimeoutMs ?? 10_000` 同构，缺省 10_000）。超时 →
   * 强制收轮：补闭合未闭合 step + turn/end{aborted} 落盘 + runState 归位 +
   * 迟到结果闸门（在途工具结算后其结果不再落盘）。协作式纪律不变——看门狗
   * **不弃在途 promise**（runTurn 的调用栈仍等工具自然结算），强制的只是
   * 事件流终态与状态归位（LIMITATIONS 记档：挂死的外部进程需 OS 级干预）。
   * 未配置 = 无看门狗（P0 行为零变化）。
   */
  abortTimeoutMs?: number;
}

export class AgentLoop {
  private readonly $: LoopContext;
  /**
   * A7 取消槽：运行时 cause，**绝不冻结**（undici 会对 abort reason 赋 stack，
   * 冻结让真因变 TypeError）；落盘时经 copyCause 只拷声明字段。
   * 每个 turn 一份新信号：runTurn 开始时重置，turn/end 发布前清槽。
   */
  private cancelCause: CancelCause | null = null;
  /**
   * A7 信号联动（T-P1-43）：per-turn 的 AbortController——cancel() 置槽
   * 同时 abort 信号，已派发工具可经 ToolContext.signal 观察取消（协作式：
   * 工具自行决定如何响应；task 工具用它联动子循环取消，dsh activation
   * stop 传播 / opencode ctx.abort.addEventListener 同构）。每个 turn
   * 一份新 controller：runTurn 开始替换（idle 期迟到取消 abort 的是旧
   * controller，无消费者——"迟到的取消不武装后续工作"的信号面同构）。
   */
  private cancelController: AbortController | null = null;
  /**
   * 本 turn 的捕获值（J7）：runTurn 启动时从 modelForTurn 取（缺省退化为
   * 固定 provider/identity），本 turn 全程不变——runStep/callModel 只读它，
   * 不回读 deps.provider/identity。
   */
  private turnModel: {
    provider: ModelProvider;
    identity: ModelIdentity;
  };
  private readonly toolChain: ChainExecutor<
    LoopContext,
    ToolCallPayload,
    ToolExecutionResult
  >;
  private readonly modelChain: ChainExecutor<
    LoopContext,
    ModelRequestPayload,
    ModelStepOutput
  >;
  private readonly turnEndChain: ChainExecutor<LoopContext, TurnEndPayload, void>;

  constructor(private readonly deps: AgentLoopDeps) {
    this.$ = { sessionId: deps.sessionId };
    // A12/T-P1-53 关联 id 计数器：从流重建（恢复路径不重号）——已有
    // user/message 数即下一枚的序数基线。
    this.promptCounter = deps.store
      .load(deps.sessionId)
      .filter((e) => e.type === "user/message").length;
    this.traceCounter = deps.store
      .load(deps.sessionId)
      .filter((e) => e.type === "request/header").length;
    // 缺省捕获 = 固定 provider/identity（P0 行为）；runTurn 启动时按
    // modelForTurn 覆盖（J7）。
    this.turnModel = { provider: deps.provider, identity: deps.identity };
    this.toolChain = composeChain({
      point: "toolCall",
      layers: deps.layers?.toolCall ?? [],
      terminal: (_$, e) => this.deps.executeTool(e),
    });
    this.modelChain = composeChain({
      point: "modelRequest",
      layers: deps.layers?.modelRequest ?? [],
      terminal: (_$, e) => this.callModel(e),
    });
    this.turnEndChain = composeChain({
      point: "turnEnd",
      layers: deps.layers?.turnEnd ?? [],
      terminal: (_$, e) => {
        this.deps.store.append(this.deps.sessionId, [
          { type: "turn/end", turn: e.turn, reason: e.reason },
        ]);
      },
    });
  }

  /**
   * A7：取消当前 turn（first-wins，重复调用只认第一次）。
   * 协作式纪律：取消只是置槽，loop 在每个 await 边界检查，绝不 Promise.race
   * 弃掉在途的 adapter/工具 promise（未协作的工作自然结算后才收轮）。
   * 无活动 turn 时调用是无害 no-op——槽在下一次 runTurn 开始时重置，
   * 迟到的取消不武装后续工作（DSH："does not arm later work"）。
   */
  cancel(cause: CancelCause): void {
    if (this.cancelCause) return;
    this.cancelCause = cause;
    // T-P1-43 信号联动：已派发工具经 ctx.signal 观察取消（协作式——
    // 工具自行决定如何响应；task 用它联动子循环）。
    this.cancelController?.abort();
    // A14/T-P1-50：取消后武装看门狗（未配置 abortTimeoutMs 则无看门狗）
    this.armAbortWatchdog();
  }

  /**
   * A10（T-P1-47）steer 准入的权威面：当前在途轮号；idle 时 null。
   * runTurn 开始置位、closeTurn 清位（T-3-05"尾部唯一归位点"——completed/
   * blocked/aborted/error 全路径必经，收尾阶段的 steer 自然落"无活动轮"拒绝）。
   */
  private activeTurnNumber: number | null = null;
  get activeTurn(): number | null {
    return this.activeTurnNumber;
  }

  /** B19/T-P1-61：当前 step 号只读面（retrying 事件落流读取；idle 时 undefined）。 */
  private currentStepNumber: number | undefined;
  get currentStep(): number | undefined {
    return this.currentStepNumber;
  }

  /**
   * A14/T-P1-50 看门狗句柄与强制收轮标记。forcedClosed 置位后：
   * closeTurn 直接返回（终态已由看门狗落盘，防 double terminal）、
   * 迟到的工具结果不再落盘（事件流不变量优先于结果保全）。
   * 随 runTurn 开始复位（与 cancelCause 同步）。
   */
  private abortWatchdog: ReturnType<typeof setTimeout> | null = null;
  private forcedClosed = false;

  /** A12/T-P1-53 关联 id 分配（会话内单调 p1、p2…；构造时从流重建基线）。 */
  private promptCounter: number;

  /**
   * B13/T-P1-57：当前 prompt 的关联 id（nextPromptId 分配即更新——"当前
   * prompt" = 最新落盘的 user/message）。mutation 预算的计数作用域键。
   */
  private currentPromptId: string | undefined;

  /** B13/T-P1-57：本 step 内 mutation 预算耗尽的命中记录（收尾统一检查）。 */
  private mutationTerminate: { path: string; errorCode: string } | null = null;

  /** B16/T-P1-59：当前 step 的工具执行策略快照（runStep 开始时固化）。 */
  private stepToolMeta = new Map<string, { parallel: boolean; timeoutMs?: number }>();

  /** B20/T-P1-62：本 turn 的输出触顶续跑计数（每 turn 重置，上限 3）。 */
  private outputTokenContinuations = 0;

  private nextPromptId(): string {
    this.promptCounter += 1;
    this.currentPromptId = `p${this.promptCounter}`;
    return this.currentPromptId;
  }

  /** B19/T-P1-61 模型请求关联 id（`r<序数>` 会话内单调；request/header 数即基线）。 */
  private traceCounter: number;

  private nextTraceId(): string {
    this.traceCounter += 1;
    return `r${this.traceCounter}`;
  }

  private armAbortWatchdog(): void {
    const ms = this.deps.abortTimeoutMs;
    if (ms === undefined || this.abortWatchdog !== null) return;
    this.abortWatchdog = setTimeout(() => {
      this.abortWatchdog = null;
      // 正常路径已收轮（abortTurn 清槽）→ 迟到的看门狗不触发
      if (this.cancelCause === null) return;
      this.deps.logger?.warn("abortTimeoutMs 看门狗超时——强制收轮", {
        timeoutMs: ms,
        turn: this.activeTurnNumber,
      });
      this.forcedClosed = true;
      this.forceCloseTurn();
    }, ms);
    // 看门狗不阻止进程自然退出
    this.abortWatchdog.unref?.();
  }

  private disarmAbortWatchdog(): void {
    if (this.abortWatchdog !== null) {
      clearTimeout(this.abortWatchdog);
      this.abortWatchdog = null;
    }
  }

  /**
   * 看门狗超时的强制闭合：补闭合未闭合 step + turn/end{aborted} 落盘 +
   * turnEnd flush + runState 归位（failTurn 骨架的最小版——不经 turnEnd
   * 链：压缩层对"工具还挂在途"的轮无合法消费面，大声语义由 warn 承担）。
   * turn 已闭合（正常收轮先到）则 no-op。
   */
  private forceCloseTurn(): void {
    const { store, sessionId } = this.deps;
    const cause = this.cancelCause;
    if (!cause) return;
    const proj = Projector.fold(store.load(sessionId)).projection;
    if (!proj.openTurn) return; // 已闭合（竞态防御）
    const turn = proj.openTurn.turn;
    const openStep = [...proj.openSteps][0];
    const events: NewSessionEvent[] = [
      ...(openStep !== undefined
        ? [{ type: "step/end" as const, turn, step: openStep }]
        : []),
      {
        type: "turn/end" as const,
        turn,
        reason: { kind: "aborted" as const, cause: copyCause(cause) },
      },
    ];
    store.append(sessionId, events);
    void store.runFlushPoint("turnEnd", sessionId).catch(() => undefined);
    this.deps.runState?.markIdle(sessionId);
    this.activeTurnNumber = null;
  }

  /**
   * 跑一个用户轮：turn/start → user/message → N 个 step → turn/end。
   * 返回结束原因（硬退出的 error 也不抛——终态在事件流里，pi 同款
   * "error responses remain hard exits"）。
   */
  async runTurn(prompt: string): Promise<TurnEndReason> {
    const { store, sessionId } = this.deps;
    // A3：turn 尝试开始即 busy（先于任何校验与落盘）——若本 turn 半途崩溃，
    // busy 停留，由恢复路径归位。
    this.deps.runState?.markBusy(sessionId);
    const turn = this.nextTurnNumber();
    // A10（T-P1-47）：steer 准入权威面置位（closeTurn 清位）
    this.activeTurnNumber = turn;
    // A14/T-P1-50：新 turn 复位强制收轮标记与残留看门狗（与 cancelCause 同步）
    this.forcedClosed = false;
    this.disarmAbortWatchdog();
    // B13/T-P1-57：新 turn 复位预算耗尽标记（计数作用域按 promptId，本就
    // 不会跨 prompt 生效——此处清的是异常半途残留）
    this.mutationTerminate = null;
    // B20/T-P1-62：新 turn 复位输出触顶续跑计数
    this.outputTokenContinuations = 0;
    // 新 turn 一份新信号：丢弃 idle 期迟到的取消（不武装本 turn 之前的工作）
    this.cancelCause = null;
    this.cancelController = new AbortController();
    // J7 捕获：turn 启动即定本 turn 的模型（此后在途换模只影响后续 turn）。
    // 捕获在 turn/start 落盘前——装配侧坏状态在此爆出，不污染事件流。
    this.turnModel = this.deps.modelForTurn
      ? this.deps.modelForTurn(turn)
      : { provider: this.deps.provider, identity: this.deps.identity };
    store.append(sessionId, [
      {
        type: "turn/start",
        turn,
      },
      {
        type: "user/message",
        turn,
        message: { content: prompt },
        source: "user",
        promptId: this.nextPromptId(),
      },
    ]);
    try {
      // PreTurn 压缩挂点（T-8 装配）：新 prompt 已入流、首次模型请求前。
      // 必须在 try 内：hook 抛错走 failTurn 闭合（turn/start 已落盘——不能
      // 把悬挂 turn 丢给进程级崩溃路径）。
      if (this.deps.beforeFirstModelRequest) {
        await this.deps.beforeFirstModelRequest(turn);
      }
      // A17/T-P1-46：await 后显式检查（zcode·turn-loop 每 await 后
      // throwIfTurnAborted 同款时点）——挂点（PreTurn 压缩/goal 提醒）执行
      // 期间到达的取消在首步前收轮，不留到 step 边界才兜底。
      if (this.cancelCause) {
        return await this.abortTurn(turn);
      }
      for (let step = 1; ; step++) {
        // A7 边界检查：step 开始前
        if (this.cancelCause) break;
        // A14/T-P1-50 护栏：maxStepsPerTurn（缺省 0 = 不限）——超限强制
        // 收束为 blocked（显式护栏终止，非 completed；模型一直 continue
        // 不停是 A14 点名的失控面）
        const maxSteps = this.deps.maxStepsPerTurn ?? 0;
        if (maxSteps > 0 && step > maxSteps) {
          this.deps.logger?.warn("maxStepsPerTurn 护栏触发——强制收束", {
            turn,
            maxSteps,
          });
          await this.closeTurn(turn, { kind: "blocked" });
          return { kind: "blocked" };
        }
        // A2：step 边界是注入点——按 QueueMode 排空队列（含第一步前），
        // steer 消息落 user/message 后经投影自然进入本次请求。
        await this.drainQueue(turn);
        const result = await this.runStep(turn, step);
        if (result.kind === "blocked") return { kind: "blocked" };
        if (result.kind === "cancelled") break;
        // B20/T-P1-62：输出触顶续跑——内核护栏行为（不受 decideTurn 裁决，
        // 否则默认"无工具即 end"会立即终结轮——正是 B20 要防的"结束回合"），
        // 直接进下一 step（续跑指令已作为 injected user/message 入流）。
        if (result.kind === "continue") continue;
        // A1：end 必须由 DecideTurn 显式给出；continue 则同轮进下一个 step。
        const decision = await this.deps.decideTurn(result.record);
        // A17/T-P1-46：decideTurn await 后显式检查——取消发生在裁决之后
        // 不得以 completed 收轮（取消优先于正常终态；decideTurn 期间到达
        // 的取消此前会被 end 分支的 completed 吞掉）。
        if (this.cancelCause) break;
        if (decision.action === "end") {
          await this.closeTurn(turn, { kind: "completed" });
          return { kind: "completed" };
        }
      }
      return await this.abortTurn(turn);
    } catch (e) {
      return this.failTurn(turn, e);
    }
  }

  // -------------------------------------------------------------------------
  // step：step/start → 模型调用 → 工具分发 → step/end
  // -------------------------------------------------------------------------

  /**
   * step 边界注入（A2）：排空队列、按序落 user/message（不丢不重）。
   * A13/T-P1-48：注入前逐条过入队闸门（缺省不装配 = 全放行）——拦截不落流
   * （warn 留痕）、改写落改写后内容、放行原样进历史。
   */
  private async drainQueue(turn: number): Promise<void> {
    const queue = this.deps.queue;
    if (!queue) return;
    const drained = queue.drain();
    if (drained.length === 0) return;
    const gate = this.deps.promptGate;
    const admitted: typeof drained = [];
    for (const p of drained) {
      if (!gate) {
        admitted.push(p);
        continue;
      }
      const verdict = normalizePromptVerdict(await gate(p));
      if (verdict.block) {
        // 拦截：不进模型历史 = 不落盘（A9 纪律自洽）；拦截事实 warn 留痕
        // （D14 告警先例——内容不进日志，只带 messageId 与理由）
        this.deps.logger?.warn("prompt 入队闸门拦截", {
          messageId: p.messageId,
          ...(verdict.message !== undefined ? { reason: verdict.message } : {}),
        });
        continue;
      }
      admitted.push(verdict.message !== undefined ? { ...p, content: verdict.message } : p);
    }
    if (admitted.length === 0) return;
    this.deps.store.append(
      this.deps.sessionId,
      admitted.map(
        (p): NewSessionEvent => ({
          type: "user/message",
          turn,
          message: { content: p.content },
          source: "user",
          // A12/T-P1-53：steer 注入的每条输入各得一枚关联 id（新输入）
          promptId: this.nextPromptId(),
        }),
      ),
    );
  }

  private async runStep(
    turn: number,
    step: number,
  ): Promise<
    { kind: "completed"; record: StepRecord }
    | { kind: "blocked" }
    | { kind: "cancelled" }
    | { kind: "continue" }
  > {
    const { store, sessionId } = this.deps;
    this.currentStepNumber = step;
    store.append(sessionId, [{ type: "step/start", turn, step }]);
    const payload: ModelRequestPayload = {
      turn,
      step,
      identity: this.turnModel.identity,
      messages: this.buildMessages(),
      ...(this.deps.tools ? { tools: this.deps.tools } : {}),
    };
    const outcome = await this.modelChain.run(this.$, payload);
    if (outcome.truncated) {
      // modelRequest 层不放行请求（P0 无层；真实语义阶段 7 定）：step 空过、
      // turn 以 blocked 终止——不放行还继续循环没有意义。（无模型请求发生
      // ——B19 的 timing/traceId 缺省，step/end 裸落。）
      store.append(sessionId, [{ type: "step/end", turn, step }]);
      await this.closeTurn(turn, { kind: "blocked" });
      return { kind: "blocked" };
    }
    const output = outcome.value;
    if (output.interrupted) {
      // A7 流中断：已交付前缀以 interrupted 标记落盘（中断是写入时记录的事实，
      // 不是读取时的推导，l0-events §2.3）；无文本前缀但流有内容则按
      // "未产出可见消息"落 assistant/attempt；未派发的工具调用缺席（DSH 同款）。
      store.append(sessionId, [
        ...(output.content !== ""
          ? [
              {
                type: "assistant/message" as const,
                turn,
                step,
                message: { content: output.content },
                stream: output.timed,
                interrupted: true as const,
              },
            ]
          : output.timed.length > 0
            ? [
                {
                  type: "assistant/attempt" as const,
                  turn,
                  step,
                  stream: output.timed,
                },
              ]
            : []),
        {
          type: "step/end",
          turn,
          step,
          ...(output.timing ? { timing: output.timing } : {}),
          ...(output.traceId ? { traceId: output.traceId } : {}),
        },
      ]);
      return { kind: "cancelled" };
    }
    store.append(sessionId, [
      {
        type: "assistant/message",
        turn,
        step,
        message: { content: output.content },
        stream: output.timed,
        ...(output.usage ? { usage: output.usage } : {}),
      },
    ]);
    // B20/T-P1-62：输出 token 触顶可续跑——纯文本（无工具调用）且
    // finishReason ∈ 触顶闭集且本 turn 续跑未达上限 → 落固定续跑指令
    // （user/message source="injected"，注入上下文既有语义——零新事件），
    // 下一 step 继续请求；触顶不终结轮（"可续跑事件"不是回合终态）。
    if (
      output.toolCalls.length === 0 &&
      output.finishReason !== undefined &&
      OUTPUT_TOKEN_LIMIT_FINISH_REASONS.has(output.finishReason) &&
      this.outputTokenContinuations < MAX_OUTPUT_TOKEN_CONTINUATIONS
    ) {
      this.outputTokenContinuations += 1;
      store.append(sessionId, [
        {
          type: "user/message",
          turn,
          message: { content: OUTPUT_TOKEN_CONTINUE_PROMPT },
          source: "injected",
          promptId: this.nextPromptId(),
        },
        { type: "step/end", turn, step, ...(output.timing ? { timing: output.timing } : {}), ...(output.traceId ? { traceId: output.traceId } : {}) },
      ]);
      return { kind: "continue" };
    }
    const toolResults: StepRecord["toolResults"] = [];
    // B14：每个 step 的工具分发循环一份预算（tick=派发、progress=执行完回环）
    const budget = new ParseBudget(this.deps.toolBudget ?? {});
    const parallel = this.deps.toolExecution === "parallel";
    // B16/T-P1-59：本 step 的执行策略快照——模型响应里广告的工具在 step
    // 开始时固化声明（parallel 判定 + M6 超时预算），step 进行中 registry
    // 动态注册/替换不影响在途 step（codex "retain the step whose tool list
    // advertised them" 同构）。
    const toolMeta = new Map<string, { parallel: boolean; timeoutMs?: number }>();
    for (const call of output.toolCalls) {
      if (toolMeta.has(call.name)) continue;
      const meta = this.deps.toolRuntimeMeta?.(call.name);
      toolMeta.set(call.name, {
        parallel: meta !== undefined ? meta.parallel : this.deps.isParallelTool?.(call.name) === true,
        ...(meta?.timeoutMs !== undefined ? { timeoutMs: meta.timeoutMs } : {}),
      });
    }
    this.stepToolMeta = toolMeta;
    // preflight（取消/预算检查 + tool/call 落流）两种模式共用，顺序执行；
    // sequential 在此内联执行到底（P0 原路径，逐字节行为不变），
    // parallel 收集派发批、循环结束后并发执行（pi "preflight … then execute
    // allowed tools concurrently"）。
    const dispatched: { id: string; name: string; arguments: string }[] = [];
    for (const call of output.toolCalls) {
      // A7 边界检查：已派发/已执行工具的结果照落盘（事实），未派发的缺席
      if (this.cancelCause) break;
      try {
        budget.tick();
      } catch (e) {
        // B14 预算耗尽：本调用与其后调用不再派发（缺席语义 = 取消同款）；
        // step 正常闭合，模型从部分结果 + 缺席中感知收束
        if (!(e instanceof BudgetExceededError)) throw e;
        break;
      }
      store.append(sessionId, [
        {
          type: "tool/call",
          turn,
          step,
          callId: call.id,
          name: call.name,
          arguments: call.arguments,
        },
      ]);
      dispatched.push(call);
      if (parallel) continue;
      const result = await this.dispatchTool(turn, step, call);
      // A14/T-P1-50 迟到结果闸门：看门狗已强制收轮——结算回来的结果不再
      // 落盘（事件流终态已闭合，append 会破坏 single-terminal/配平不变量）
      if (this.forcedClosed) {
        this.deps.logger?.warn("看门狗强制收轮后迟到的工具结果被丢弃", {
          turn,
          step,
          callId: call.id,
        });
        break;
      }
      toolResults.push({
        callId: call.id,
        content: result.content,
        ...(result.isError ? { isError: true as const } : {}),
      });
      store.append(sessionId, [
        {
          type: "tool/result",
          turn,
          step,
          callId: call.id,
          message: {
            content: result.content,
            ...(result.isError ? { isError: true as const } : {}),
          },
          ...(result.error ? { error: result.error } : {}),
          ...(result.meta !== undefined ? { meta: result.meta } : {}),
        },
      ]);
      // 执行完回环时只查时间轴（不计数）——防单件慢工具绕过数量轴
      try {
        budget.progress();
      } catch (e) {
        if (!(e instanceof BudgetExceededError)) throw e;
        break;
      }
    }
    if (parallel && dispatched.length > 0) {
      await this.runParallelTools(turn, step, dispatched, toolResults);
    }
    store.append(sessionId, [
      {
        type: "step/end",
        turn,
        step,
        ...(output.timing ? { timing: output.timing } : {}),
        ...(output.traceId ? { traceId: output.traceId } : {}),
      },
    ]);
    // T-8 装配通知：含工具调用的 step 完成记一笔（RapidRefillGuard 的干活记账）。
    if (output.toolCalls.length > 0) {
      this.deps.onToolStepCompleted?.(turn, step);
    }
    // B13/T-P1-57：mutation 预算在本 step 内耗尽 → blocked 收轮（显式护栏
    // 终止非 completed，T-P1-50 同款）。已派发工具照常结算落盘（A11 纪律），
    // 收轮判定在 step 收尾统一做。
    if (this.mutationTerminate !== null) {
      const hit = this.mutationTerminate;
      this.mutationTerminate = null;
      this.deps.logger?.warn("mutation 重试预算耗尽——强制收束", {
        turn,
        step,
        path: hit.path,
        errorCode: hit.errorCode,
        code: MUTATION_RETRY_BUDGET_EXHAUSTED,
      });
      await this.closeTurn(turn, { kind: "blocked" });
      return { kind: "blocked" };
    }
    if (this.cancelCause) return { kind: "cancelled" };
    return {
      kind: "completed",
      record: {
        turn,
        step,
        content: output.content,
        toolCalls: output.toolCalls,
        toolResults,
        ...(output.usage ? { usage: output.usage } : {}),
      },
    };
  }

  /**
   * B7/T-P1-16 进度发射器（每调用一个闭包）：seqInCall 从 1 起单调递增，
   * 单调用条数上限 MAX_TOOL_PROGRESS_PER_CALL（卡内定形——高频工具的进度
   * 不撑爆事件流；超限后的 report 静默丢弃，进度是 best-effort 通道，
   * 不反压工具执行）。
   */
  private createProgressReporter(
    turn: number,
    step: number,
    callId: string,
  ): (message: string) => void {
    let seq = 0;
    return (message: string) => {
      if (seq >= MAX_TOOL_PROGRESS_PER_CALL) return;
      seq += 1;
      this.deps.store.append(this.deps.sessionId, [
        { type: "tool/progress", turn, step, callId, seqInCall: seq, message },
      ]);
    };
  }

  /** 工具分发过 toolCall 链；基础设施崩溃也落成 isError 结果（配平不变量）。 */
  private async dispatchTool(
    turn: number,
    step: number,
    call: { id: string; name: string; arguments: string },
  ): Promise<ToolExecutionResult> {
    try {
      const outcome = await this.toolChain.run(this.$, {
        turn,
        step,
        callId: call.id,
        name: call.name,
        arguments: call.arguments,
        report: this.createProgressReporter(turn, step, call.id),
        // T-P1-43：本 turn 的取消信号（A7 槽位的 AbortSignal 面）——
        // 工具可选消费；链层 spread 载荷时保留。
        ...(this.cancelController
          ? { signal: this.cancelController.signal }
          : {}),
        // B16/T-P1-59：本 step 的执行策略快照（超时预算在途 step 固化）
        ...(this.stepToolMeta.has(call.name)
          ? { runtimeMeta: this.stepToolMeta.get(call.name) }
          : {}),
      });
      // B13/T-P1-57：mutation 工具的成败上报预算（结果 meta.mutationPaths
      // 是工具声明的目标路径——isError 计账、成功清历史）。
      this.reportMutationOutcome(outcome.value);
      return outcome.value;
    } catch (e) {
      return {
        content: e instanceof Error ? e.message : String(e),
        isError: true,
        error: { name: "ToolError", code: "TOOL_EXECUTE_FAILED" },
      };
    }
  }

  /**
   * B13/T-P1-57：把 mutation 工具的结果上报预算。isError → 逐路径 record
   * （第 3 次计数失败置 mutationTerminate，本 step 收尾收轮）；成功 → 逐
   * 路径 clear（ADR "a successful mutation clears that path's failure
   * history"）。路径规范化 = resolve + 小写折叠（Windows 大小写不敏感）。
   */
  private reportMutationOutcome(result: ToolExecutionResult): void {
    const budget = this.deps.mutationBudget;
    const meta = result.meta;
    if (budget === undefined || this.currentPromptId === undefined) return;
    if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return;
    const paths = (meta as { [key: string]: JsonValue }).mutationPaths;
    if (!Array.isArray(paths) || paths.length === 0) return;
    for (const raw of paths) {
      if (typeof raw !== "string" || raw === "") continue;
      const normalized = path.resolve(raw).toLowerCase();
      if (result.isError === true) {
        const verdict = budget.record(this.currentPromptId, normalized, result.error?.code);
        if (verdict.terminate) {
          this.mutationTerminate = {
            path: raw,
            errorCode: result.error?.code ?? "UNKNOWN",
          };
        }
      } else {
        budget.clear(this.currentPromptId, normalized);
      }
    }
  }

  /**
   * B17/T-P1-15 parallel 模式的并发执行：一把读写锁（本 loop 一个实例），
   * isParallelTool 声明为真的只读工具持读锁互相并发，其余持写锁与一切互斥
   * （codex parallel.rs:191 `supports_parallel ? read : write` 的对应物）。
   * 事件序：tool/result 按完成序落流（pi 同款）；StepRecord.toolResults 按
   * 提交序回填（pi "tool-result message artifacts … in assistant source order"
   * 同款）。取消语义不变：已派发（tool/call 已落流）的执行照完成、结果照落盘。
   */
  private readonly toolLock = new RwLock();

  /** F6/F13/T-P1-19：上一次请求的缓存锚与身份（onCacheAnchorChange 在位时才维护）。 */
  private lastAnchor: { anchor: string; identity: ModelIdentity } | null = null;

  private async runParallelTools(
    turn: number,
    step: number,
    calls: ReadonlyArray<{ id: string; name: string; arguments: string }>,
    toolResults: StepRecord["toolResults"],
  ): Promise<void> {
    const byCallId = new Map<string, ToolExecutionResult>();
    await Promise.all(
      calls.map(async (call) => {
        // B16/T-P1-59：并行判定用 step 快照（step 中途声明替换不影响在途 step）
        const release = await (this.stepToolMeta.get(call.name)?.parallel === true
          ? this.toolLock.read()
          : this.toolLock.write());
        try {
          const result = await this.dispatchTool(turn, step, call);
          byCallId.set(call.id, result);
          // A14/T-P1-50 迟到结果闸门：强制收轮后不落盘（与 sequential 同闸）
          if (this.forcedClosed) {
            this.deps.logger?.warn("看门狗强制收轮后迟到的工具结果被丢弃", {
              turn,
              step,
              callId: call.id,
            });
            return;
          }
          this.deps.store.append(this.deps.sessionId, [
            {
              type: "tool/result",
              turn,
              step,
              callId: call.id,
              message: {
                content: result.content,
                ...(result.isError ? { isError: true as const } : {}),
              },
              ...(result.error ? { error: result.error } : {}),
              ...(result.meta !== undefined ? { meta: result.meta } : {}),
            },
          ]);
        } finally {
          release();
        }
      }),
    );
    for (const call of calls) {
      const result = byCallId.get(call.id);
      if (result === undefined) continue;
      toolResults.push({
        callId: call.id,
        content: result.content,
        ...(result.isError ? { isError: true as const } : {}),
      });
    }
  }

  /**
   * 模型调用终端：落 request/header（层换完载荷之后，记录的是真正发出去的
   * 设置）→ 消费流 → 装配。失败时本次尝试以 assistant/attempt 落盘
   * （不为记录失败而伪造模型消息，l0-events.md §2.2），再作硬退出上抛。
   */
  private async callModel(payload: ModelRequestPayload): Promise<ModelStepOutput> {
    const { store, sessionId } = this.deps;
    // F12/F14：toolsProvider 在位时每请求现取（deferrable 工具索取后真
    // schema 才进清单）；缺省回落固定 tools（P0 零行为变化）
    const tools = this.deps.toolsProvider?.() ?? this.deps.tools;
    // F6/F13/T-P1-19：逐请求缓存锚检测——system + tools 字节序。identical
    // 静默；appended/rewritten 通知装配观测（换模 + rewritten = 违背 F13
    // "中途改动不得作废已缓存前缀"的告警信号）。
    if (this.deps.onCacheAnchorChange) {
      const systemContent = payload.messages.find((m) => m.role === "system")
        ?.content;
      const anchor = computeCacheAnchor(systemContent, tools);
      const last = this.lastAnchor;
      if (last !== null && anchor !== last.anchor) {
        this.deps.onCacheAnchorChange({
          from: last.anchor,
          to: anchor,
          kind: anchor.startsWith(last.anchor) ? "appended" : "rewritten",
          modelSwitched:
            payload.identity.provider !== last.identity.provider ||
            payload.identity.modelId !== last.identity.modelId,
        });
      }
      this.lastAnchor = { anchor, identity: payload.identity };
    }
    store.append(sessionId, [
      {
        type: "request/header",
        turn: payload.turn,
        step: payload.step,
        // 记录本 turn 捕获值（J7）——换模生效点在新 turn 的事件证据就在
        // 这里：在途 turn 的 header 保持旧身份，新 turn 起变为新身份。
        config: {
          provider: payload.identity.provider,
          modelId: payload.identity.modelId,
        },
        // ChatTool 是 interface（无隐式索引签名），展开成匿名字面量过 JsonValue
        ...(tools
          ? {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
            }
          : {}),
        reason: payload.step === 1 ? "initial" : "series",
      },
    ]);
    const timed: TimedStreamChunk[] = [];
    let content = "";
    const calls = new Map<string, { id: string; name: string; arguments: string }>();
    let usage: TokenUsage | undefined;
    // B19/T-P1-61：traceId 分配 + 流计时（首 chunk 延迟 / 流总时长）
    const traceId = this.nextTraceId();
    const streamStart = Date.now();
    let firstChunkAt: number | undefined;
    let finishReason: string | undefined;
    try {
      for await (const chunk of this.turnModel.provider.streamChat({
        identity: payload.identity,
        messages: payload.messages,
        ...(tools ? { tools } : {}),
      })) {
        if (firstChunkAt === undefined) firstChunkAt = Date.now();
        timed.push({ time: Date.now(), chunk });
        switch (chunk.type) {
          case "text-delta":
            content += chunk.text;
            break;
          case "reasoning-delta":
            break; // 只进流记录，P0 不进 content（摘要属压缩，阶段 7）
          case "tool-call-delta": {
            const entry =
              calls.get(chunk.id) ?? { id: chunk.id, name: "", arguments: "" };
            if (chunk.name) entry.name = chunk.name;
            entry.arguments += chunk.argsDelta;
            calls.set(chunk.id, entry);
            break;
          }
          case "usage":
            usage = chunk.usage;
            break;
          case "done":
            finishReason = chunk.finishReason;
            break;
        }
        // A7 协作式中断：已到达的 chunk 已如实记录，其后不再消费
        // （break 会经 generator .return() 关闭流，不弃 promise 不赛跑）
        if (this.cancelCause) break;
      }
    } catch (e) {
      store.append(sessionId, [
        {
          type: "assistant/attempt",
          turn: payload.turn,
          step: payload.step,
          stream: timed,
        },
      ]);
      // E14：provider 异常路径的已到达分片同样落诊断日志（保真不分顺逆）
      this.deps.rawChunkLog?.write({
        ts: Date.now(),
        sessionId,
        turn: payload.turn,
        step: payload.step,
        identity: payload.identity,
        chunks: timed,
      });
      throw e;
    }
    // E14/T-P1-90：请求完成后分片序列落诊断日志（旁路通道——热路径零等待）
    this.deps.rawChunkLog?.write({
      ts: Date.now(),
      sessionId,
      turn: payload.turn,
      step: payload.step,
      identity: payload.identity,
      chunks: timed,
    });
    return {
      content,
      toolCalls: [...calls.values()],
      ...(usage ? { usage } : {}),
      timed,
      ...(firstChunkAt !== undefined
        ? {
            timing: {
              firstTokenLatencyMs: firstChunkAt - streamStart,
              streamDurationMs: Date.now() - streamStart,
            },
          }
        : {}),
      traceId,
      ...(finishReason !== undefined ? { finishReason } : {}),
      ...(this.cancelCause ? { interrupted: true as const } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // turn 收尾（turnEnd 点位）与失败路径
  // -------------------------------------------------------------------------

  /**
   * A7 中断收尾：**清槽先行**——turn/end 发布前到达的取消是 idle 取消
   * （DSH："terminal publication ... remain outside its authority"），
   * 落盘的 cause 是声明字段拷贝，不是运行期对象。
   */
  private async abortTurn(turn: number): Promise<TurnEndReason> {
    const cause = this.cancelCause;
    this.cancelCause = null;
    if (!cause) {
      // 不可达（break 前必有 cause）；防御兜底：无因不当中断处理
      await this.closeTurn(turn, { kind: "completed" });
      return { kind: "completed" };
    }
    const reason: TurnEndReason = { kind: "aborted", cause: copyCause(cause) };
    await this.closeTurn(turn, reason);
    return reason;
  }

  private async closeTurn(turn: number, reason: TurnEndReason): Promise<void> {
    // A14/T-P1-50：强制收轮已落 turn/end（看门狗）——自然收尾路径到此
    // 直接返回，防 double terminal（事件流不变量优先）。
    if (this.forcedClosed) return;
    // A10（T-P1-47）：steer 准入权威面在收轮开始即清位——turn/end 事件
    // 转发先于收尾完成（flush/turnEnd 链还在跑），此窗口内的 steer 不能
    // 再被受理（终态已落盘，无可重定向的在途工作）。
    this.activeTurnNumber = null;
    // A14/T-P1-50：正常收轮先到 → 拆看门狗（迟到的看门狗不得触发）
    this.disarmAbortWatchdog();
    const outcome = await this.turnEndChain.run(this.$, { turn, reason });
    if (outcome.truncated) {
      // turnEnd 截断 = turn/end 没落盘，turn 保持未闭合（与崩溃残留同待遇）。
      // P0 没有合法的截断消费方（压缩只观察不拦截）——大声失败，不静默。
      throw new Error(
        `turnEnd 链被截断（turn=${turn}）——P0 无合法消费方，turn 保持未闭合`,
      );
    }
    // E13 turn 末 flush 检查点（T-8 装配接线）：flush 本体在内、注册的 hook
    // 在外（拿到的都是"已持久化"时点）。落库失败向上抛——存储故障时进程
    // 该退出，而不是假装轮已收尾。
    await this.deps.store.runFlushPoint("turnEnd", this.deps.sessionId);
    // A3：turn/end 成功落盘才归位 idle——这是 run-state 的唯一归位点；
    // 到不了这里（崩溃/截断）的 turn 停在 busy，等恢复路径。
    this.deps.runState?.markIdle(this.deps.sessionId);
  }

  /** 硬退出：闭合仍开着的 step → turnEnd 链落 turn/end{error}。 */
  private async failTurn(turn: number, e: unknown): Promise<TurnEndReason> {
    const { store, sessionId } = this.deps;
    const reason: TurnEndReason = { kind: "error", error: toLlmFailure(e) };
    // J11 换模事务：失败事实先给装配（回滚判据的消费点），再闭合 turn。
    this.deps.onTurnError?.(turn, reason.error);
    // 出错时当前 step 可能仍开着（流中途抛）；decideTurn 等晚段错误的 step
    // 已闭合——按投影判断，绝不二次闭合。
    const proj = Projector.fold(store.load(sessionId)).projection;
    const openStep = [...proj.openSteps][0];
    if (openStep !== undefined) {
      store.append(sessionId, [{ type: "step/end", turn, step: openStep }]);
    }
    await this.closeTurn(turn, reason);
    return reason;
  }

  // -------------------------------------------------------------------------
  // 事件投影：轮号与模型消息序列（不变量 1——不养第二份状态）
  // -------------------------------------------------------------------------

  private nextTurnNumber(): number {
    const proj = Projector.fold(this.deps.store.load(this.deps.sessionId))
      .projection;
    if (proj.openTurn) {
      throw new Error(
        `会话存在未闭合 turn ${proj.openTurn.turn}（崩溃残留）——` +
          "P0 runTurn 拒绝叠加新 turn，闭合属恢复路径（T-8）",
      );
    }
    return proj.turnCount + 1;
  }

  /**
   * 从事件流重建模型请求的消息序列（T-8 接线：内嵌实现换成
   * src/session/messages.ts 的公共 helper——压缩/新窗口重建消费同一实现，
   * 三处各写一遍必然漂移）。有效视窗遵循最新 session/revert 标记（E4）；
   * assistant/attempt 不进模型历史；tool/call 挂回同 step 的 assistant 消息。
   * 压缩后的新窗口重建（摘要/developer 注入）在 modelRequest 链的装配层经
   * startNewContextWindow 换载荷完成，loop 不感知压缩。
   */
  private buildMessages(): ChatMessage[] {
    const events = effectiveEvents(this.deps.store.load(this.deps.sessionId));
    return buildChatMessages(events);
  }
}

/**
 * cause 落盘前只拷贝声明字段（DSH："copies the declared fields where the
 * cause becomes durable data"）——运行期 transport 可能给原对象附加 stack 等
 * 不稳定细节（undici 对 abort reason 的行为），durable 事件绝不带它们（C14）。
 */
function copyCause(cause: CancelCause): CancelCause {
  switch (cause.kind) {
    case "hook":
      return {
        kind: "hook",
        reason: cause.reason,
        ...(cause.message !== undefined ? { message: cause.message } : {}),
      };
    case "user":
    case "parent":
    case "disposed":
    case "legacy":
      return { kind: cause.kind };
  }
}

/** 任意失败 → LlmFailure（C14 的结构化事实：code 判据 + message 展示）。 */
function toLlmFailure(e: unknown): LlmFailure {
  if (e instanceof ProviderHttpError) {
    const failure: LlmFailure = { code: "MODEL_HTTP_ERROR", message: e.message };
    if (typeof e.status === "number") failure.status = e.status;
    const retryAfterMs = parseRetryAfterMs(e.retryAfter, Date.now());
    if (retryAfterMs !== undefined) failure.providerRetryAfterMs = retryAfterMs;
    return failure;
  }
  if (e instanceof TimeoutError) {
    return { code: e.code, message: e.message };
  }
  return {
    code: "MODEL_UNKNOWN_ERROR",
    message: e instanceof Error ? e.message : String(e),
  };
}
