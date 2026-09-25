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
 * 该语义已钉死在 retry.test）——loop 内不设第二条重试路径。
 */

import type { ModelIdentity } from "../models/identity.js";
import { parseRetryAfterMs } from "../models/retry.js";
import {
  type ChatMessage,
  type ChatTool,
  type ModelProvider,
  ProviderHttpError,
} from "../models/provider.js";
import { Projector } from "../session/project.js";
import type { SessionStore } from "../session/store.js";
import { BudgetExceededError, ParseBudget } from "./budget.js";
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
}

/** toolCall 点位：包住"单次工具执行"（载荷与 tool/call 事件同源）。 */
export interface ToolCallPayload {
  turn: number;
  step: number;
  callId: string;
  name: string;
  /** 模型产出的原始 arguments JSON 串，unparsed（B12）。 */
  arguments: string;
}

/** toolCall 点位的产物（形状 = ToolResultEvent 的消息侧载荷）。 */
export interface ToolExecutionResult {
  content: string;
  isError?: boolean;
  error?: { name: string; code: string; reason?: string };
  /** 工具私有展示载荷，对内核不透明；append 时由 assertJsonSafe 兜底（C14）。 */
  meta?: JsonValue;
}

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
  /** 工具执行终端（阶段 4 = 注册表分发；测试注入假实现）。 */
  executeTool(
    call: { callId: string; name: string; arguments: string },
  ): Promise<ToolExecutionResult>;
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
   * 配平不变量不受影响）。
   */
  toolBudget?: { maxTicks?: number; timeoutMs?: number };
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
}

export class AgentLoop {
  private readonly $: LoopContext;
  /**
   * A7 取消槽：运行时 cause，**绝不冻结**（undici 会对 abort reason 赋 stack，
   * 冻结让真因变 TypeError）；落盘时经 copyCause 只拷声明字段。
   * 每个 turn 一份新信号：runTurn 开始时重置，turn/end 发布前清槽。
   */
  private cancelCause: CancelCause | null = null;
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
    // 新 turn 一份新信号：丢弃 idle 期迟到的取消（不武装本 turn 之前的工作）
    this.cancelCause = null;
    store.append(sessionId, [
      { type: "turn/start", turn },
      { type: "user/message", turn, message: { content: prompt }, source: "user" },
    ]);
    try {
      for (let step = 1; ; step++) {
        // A7 边界检查：step 开始前
        if (this.cancelCause) break;
        // A2：step 边界是注入点——按 QueueMode 排空队列（含第一步前），
        // steer 消息落 user/message 后经投影自然进入本次请求。
        this.drainQueue(turn);
        const result = await this.runStep(turn, step);
        if (result.kind === "blocked") return { kind: "blocked" };
        if (result.kind === "cancelled") break;
        // A1：end 必须由 DecideTurn 显式给出；continue 则同轮进下一个 step。
        const decision = await this.deps.decideTurn(result.record);
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

  /** step 边界注入（A2）：排空队列、按序落 user/message（不丢不重）。 */
  private drainQueue(turn: number): void {
    const queue = this.deps.queue;
    if (!queue) return;
    const drained = queue.drain();
    if (drained.length === 0) return;
    this.deps.store.append(
      this.deps.sessionId,
      drained.map(
        (p): NewSessionEvent => ({
          type: "user/message",
          turn,
          message: { content: p.content },
          source: "user",
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
  > {
    const { store, sessionId } = this.deps;
    store.append(sessionId, [{ type: "step/start", turn, step }]);
    const payload: ModelRequestPayload = {
      turn,
      step,
      identity: this.deps.identity,
      messages: this.buildMessages(),
      ...(this.deps.tools ? { tools: this.deps.tools } : {}),
    };
    const outcome = await this.modelChain.run(this.$, payload);
    if (outcome.truncated) {
      // modelRequest 层不放行请求（P0 无层；真实语义阶段 7 定）：step 空过、
      // turn 以 blocked 终止——不放行还继续循环没有意义。
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
        { type: "step/end", turn, step },
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
    const toolResults: StepRecord["toolResults"] = [];
    // B14：每个 step 的工具分发循环一份预算（tick=派发、progress=执行完回环）
    const budget = new ParseBudget(this.deps.toolBudget ?? {});
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
      const result = await this.dispatchTool(turn, step, call);
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
    store.append(sessionId, [{ type: "step/end", turn, step }]);
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
      });
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
   * 模型调用终端：落 request/header（层换完载荷之后，记录的是真正发出去的
   * 设置）→ 消费流 → 装配。失败时本次尝试以 assistant/attempt 落盘
   * （不为记录失败而伪造模型消息，l0-events.md §2.2），再作硬退出上抛。
   */
  private async callModel(payload: ModelRequestPayload): Promise<ModelStepOutput> {
    const { store, sessionId, identity, tools } = this.deps;
    store.append(sessionId, [
      {
        type: "request/header",
        turn: payload.turn,
        step: payload.step,
        config: { provider: identity.provider, modelId: identity.modelId },
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
    try {
      for await (const chunk of this.deps.provider.streamChat({
        identity: payload.identity,
        messages: payload.messages,
        ...(tools ? { tools } : {}),
      })) {
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
      throw e;
    }
    return {
      content,
      toolCalls: [...calls.values()],
      ...(usage ? { usage } : {}),
      timed,
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
    const outcome = await this.turnEndChain.run(this.$, { turn, reason });
    if (outcome.truncated) {
      // turnEnd 截断 = turn/end 没落盘，turn 保持未闭合（与崩溃残留同待遇）。
      // P0 没有合法的截断消费方（压缩只观察不拦截）——大声失败，不静默。
      throw new Error(
        `turnEnd 链被截断（turn=${turn}）——P0 无合法消费方，turn 保持未闭合`,
      );
    }
    // A3：turn/end 成功落盘才归位 idle——这是 run-state 的唯一归位点；
    // 到不了这里（崩溃/截断）的 turn 停在 busy，等恢复路径。
    this.deps.runState?.markIdle(this.deps.sessionId);
  }

  /** 硬退出：闭合仍开着的 step → turnEnd 链落 turn/end{error}。 */
  private async failTurn(turn: number, e: unknown): Promise<TurnEndReason> {
    const { store, sessionId } = this.deps;
    const reason: TurnEndReason = { kind: "error", error: toLlmFailure(e) };
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
   * 从事件流重建模型请求的消息序列。有效视窗遵循最新 session/revert 标记
   * （E4：最新标记生效）；assistant/attempt 不进模型历史（未产出可见消息，
   * l0-events.md §2.2）；tool/call 挂回同 step 的 assistant 消息（wire 需要
   * assistant.toolCalls 续话）。
   */
  private buildMessages(): ChatMessage[] {
    const events = this.deps.store.load(this.deps.sessionId);
    let cut = Number.POSITIVE_INFINITY;
    for (const e of events) {
      if (e.type === "session/revert") {
        cut = e.phase === "revert" ? e.targetSeq : Number.POSITIVE_INFINITY;
      }
    }
    type AssistantMsg = Extract<ChatMessage, { role: "assistant" }>;
    const messages: ChatMessage[] = [];
    let lastAssistant: AssistantMsg | null = null;
    let pendingCalls: { id: string; name: string; arguments: string }[] = [];
    const flushCalls = () => {
      if (lastAssistant && pendingCalls.length > 0) {
        lastAssistant.toolCalls = [
          ...(lastAssistant.toolCalls ?? []),
          ...pendingCalls,
        ];
        pendingCalls = [];
      }
    };
    for (const e of events) {
      if (e.seq > cut) continue;
      switch (e.type) {
        case "user/message":
          flushCalls();
          messages.push({ role: "user", content: e.message.content });
          break;
        case "system/message":
          flushCalls();
          messages.push({ role: "system", content: e.message.content });
          break;
        case "assistant/message":
          flushCalls();
          lastAssistant = { role: "assistant", content: e.message.content };
          messages.push(lastAssistant);
          break;
        case "tool/call":
          pendingCalls.push({
            id: e.callId,
            name: e.name,
            arguments: e.arguments,
          });
          break;
        case "tool/result":
          flushCalls();
          messages.push({
            role: "tool",
            callId: e.callId,
            content: e.message.content,
            ...(e.message.isError ? { isError: true as const } : {}),
          });
          break;
        default:
          // attempt / compaction / checkpoint / header / turn.* / revert 不进消息
          break;
      }
    }
    flushCalls();
    return messages;
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
