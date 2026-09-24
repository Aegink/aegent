/**
 * 会话投影（E3/E16）——fold 既是投影又是校验器（DSH invariant.ts 的纪律：
 * 校验发生在 append 之前，`oss/deepseek-harness/packages/schedule/schedule/src/invariant.ts`）。
 *
 * 增量纪律（E3"禁止全量重放"）：校验态与投影态分离——
 * - 校验态只有开集合与 lastSeq（体积不随流长增长），validateAppend 前保存、
 *   失败回滚，单次 append 代价 O(新事件 + 开集合)，不做全量重放；
 * - 投影态（消息数组等）只在 validateAppend 通过后增量追加。
 *
 * 校验不变量（超出验收两例的结构性配对，均在 fold 一遍内可查）：
 * 1. seq 严格 = 上一条 + 1（乱序 / 断档 / 重复一律拒绝——存储损坏当场现形）；
 * 2. 事件类型必须 ∈ EVENT_TYPES（未知类型拒绝——运行时面，类型系统管不到外部数据）；
 * 3. turn/step/call 的开合配对：不许双开、不许无开而合；
 * 4. tool/result 的 callId 必须有前置未闭合的 tool/call。
 */

import { EVENT_TYPES, type SessionEvent, type TokenUsage } from "../kernel/events.js";

/** fold 拒绝的流都是同一类错误：流与词汇表/结构纪律不符（修复数据，不是捕获继续）。 */
export class ProjectError extends Error {
  constructor(message: string) {
    super(`事件流校验失败（E16）：${message}`);
    this.name = "ProjectError";
  }
}

export interface ProjectionMessage {
  seq: number;
  role: "user" | "system" | "assistant";
  content: string;
  source?: string;
  interrupted?: true;
}

export interface ProjectionToolCall {
  seq: number;
  turn: number;
  step: number;
  name: string;
  arguments: string;
}

export interface ProjectionToolResult {
  seq: number;
  turn: number;
  step: number;
  content: string;
  isError?: boolean;
}

export interface SessionProjection {
  lastSeq: number;
  /** 曾开启的 turn 总数。 */
  turnCount: number;
  /** 当前开着的 turn（不变量：至多一个）。 */
  openTurn: { turn: number; seq: number } | null;
  openSteps: Set<number>;
  openToolCalls: Set<string>;
  messages: ProjectionMessage[];
  toolCalls: Map<string, ProjectionToolCall>;
  toolResults: Map<string, ProjectionToolResult>;
  lastUsage: TokenUsage | null;
  compactions: Array<{ seq: number; summary: string; retainedTail: number; tokensBefore: number }>;
}

function emptyProjection(): SessionProjection {
  return {
    lastSeq: 0,
    turnCount: 0,
    openTurn: null,
    openSteps: new Set(),
    openToolCalls: new Set(),
    messages: [],
    toolCalls: new Map(),
    toolResults: new Map(),
    lastUsage: null,
    compactions: [],
  };
}

const KNOWN_TYPES = new Set<string>(EVENT_TYPES);

export class Projector {
  private readonly state: SessionProjection;

  private constructor(state: SessionProjection) {
    this.state = state;
  }

  static fresh(): Projector {
    return new Projector(emptyProjection());
  }

  /** 全量 fold：冷启动 / 恢复 / 基准用（增量路径走 append）。 */
  static fold(events: readonly SessionEvent[]): Projector {
    const projector = Projector.fresh();
    projector.append(events);
    return projector;
  }

  get projection(): SessionProjection {
    return this.state;
  }

  /**
   * E16 的写入前校验：已有流 + 新事件一起过 fold 纪律。
   * 校验在"模拟态"上跑开合变更，无论成败都回滚——投影推进只由 append 统一做，
   * 不会双重计数；失败时状态原地不动。
   */
  validateAppend(events: readonly SessionEvent[]): void {
    const saved = this.saveValidationState();
    try {
      for (const event of events) this.applyValidation(event);
    } finally {
      this.restoreValidationState(saved);
    }
  }

  /** 校验通过后提交：校验态 + 投影态一起增量推进。 */
  append(events: readonly SessionEvent[]): void {
    this.validateAppend(events);
    for (const event of events) this.applyProjection(event);
  }

  private saveValidationState(): Pick<SessionProjection, "lastSeq" | "openTurn" | "openSteps" | "openToolCalls" | "turnCount"> {
    return {
      lastSeq: this.state.lastSeq,
      openTurn: this.state.openTurn,
      openSteps: new Set(this.state.openSteps),
      openToolCalls: new Set(this.state.openToolCalls),
      turnCount: this.state.turnCount,
    };
  }

  private restoreValidationState(saved: ReturnType<Projector["saveValidationState"]>): void {
    this.state.lastSeq = saved.lastSeq;
    this.state.openTurn = saved.openTurn;
    this.state.openSteps = saved.openSteps;
    this.state.openToolCalls = saved.openToolCalls;
    this.state.turnCount = saved.turnCount;
  }

  /** 逐条校验并**模拟**开合变更（失败由 validateAppend 回滚）——批内配对也能查出。 */
  private applyValidation(event: SessionEvent): void {
    this.checkCommon(event);
    this.state.lastSeq = event.seq; // 模拟推进（validateAppend 的 finally 会回滚）
    const { turn, step } = event;
    switch (event.type) {
      case "turn/start":
        if (this.state.openTurn) throw new ProjectError(`turn ${turn} 开启时 turn ${this.state.openTurn.turn} 尚未闭合`);
        this.state.openTurn = { turn, seq: event.seq };
        this.state.turnCount += 1;
        break;
      case "turn/end":
        this.requireOpenTurn(turn);
        this.state.openTurn = null;
        break;
      case "step/start":
        this.requireOpenTurn(turn);
        if (this.state.openSteps.has(step!)) throw new ProjectError(`step ${step} 在 turn ${turn} 内重复开启`);
        this.state.openSteps.add(step!);
        break;
      case "step/end":
        this.requireOpenTurn(turn);
        if (!this.state.openSteps.has(step!)) throw new ProjectError(`step ${step} 未开启却要闭合（turn ${turn}）`);
        this.state.openSteps.delete(step!);
        break;
      case "user/message":
        this.requireOpenTurn(turn);
        break;
      case "assistant/message":
      case "assistant/attempt":
      case "system/message":
      case "tool/call":
        this.requireOpenTurn(turn);
        this.requireOpenStep(turn, step);
        if (event.type === "tool/call") this.state.openToolCalls.add(event.callId);
        break;
      case "tool/result": {
        this.requireOpenTurn(turn);
        this.requireOpenStep(turn, step);
        if (!this.state.openToolCalls.has(event.callId)) {
          throw new ProjectError(`tool/result 的 callId=${event.callId} 没有前置未闭合的 tool/call`);
        }
        this.state.openToolCalls.delete(event.callId);
        break;
      }
      case "compaction":
      case "checkpoint":
      case "request/header":
        break;
      default:
        throw new ProjectError(`未知事件类型 ${(event as { type: string }).type}`);
    }
  }

  private checkCommon(event: SessionEvent): void {
    if (typeof event.type !== "string" || !KNOWN_TYPES.has(event.type)) {
      throw new ProjectError(`未知事件类型 ${(event as { type: unknown }).type}`);
    }
    if (event.seq !== this.state.lastSeq + 1) {
      throw new ProjectError(
        `seq 不连续：期望 ${this.state.lastSeq + 1}，实际 ${event.seq}（乱序 / 断档 / 重复）`,
      );
    }
    if (typeof event.turn !== "number") throw new ProjectError(`seq=${event.seq} 缺少 turn`);
  }

  private requireOpenTurn(turn: number): void {
    if (!this.state.openTurn || this.state.openTurn.turn !== turn) {
      throw new ProjectError(`事件落在 turn ${turn}，但该 turn 未开启`);
    }
  }

  private requireOpenStep(turn: number, step: number | undefined): void {
    if (typeof step !== "number" || !this.state.openSteps.has(step)) {
      throw new ProjectError(`事件落在 step ${step}，但 turn ${turn} 内该 step 未开启`);
    }
  }

  /** 对已通过校验的事件做投影推进（前置检查再跑一遍，防御直接调用）。 */
  private applyProjection(event: SessionEvent): void {
    this.checkCommon(event);
    const s = this.state;
    s.lastSeq = event.seq;
    const { turn, step } = event;
    switch (event.type) {
      case "turn/start":
        s.openTurn = { turn, seq: event.seq };
        s.turnCount += 1;
        break;
      case "turn/end":
        s.openTurn = null;
        break;
      case "step/start":
        s.openSteps.add(step!);
        break;
      case "step/end":
        s.openSteps.delete(step!);
        break;
      case "user/message":
        s.messages.push({ seq: event.seq, role: "user", content: event.message.content, source: event.source });
        break;
      case "system/message":
        s.messages.push({ seq: event.seq, role: "system", content: event.message.content });
        break;
      case "assistant/message":
        s.messages.push({
          seq: event.seq,
          role: "assistant",
          content: event.message.content,
          interrupted: event.interrupted,
        });
        if (event.usage) s.lastUsage = event.usage;
        break;
      case "tool/call":
        s.toolCalls.set(event.callId, { seq: event.seq, turn, step: step!, name: event.name, arguments: event.arguments });
        s.openToolCalls.add(event.callId);
        break;
      case "tool/result":
        s.toolResults.set(event.callId, {
          seq: event.seq,
          turn,
          step: step!,
          content: event.message.content,
          isError: event.message.isError,
        });
        s.openToolCalls.delete(event.callId);
        break;
      case "assistant/attempt":
        break; // 无可见消息；失败事实留在事件流本身（F10 压力测量读它）
      case "compaction":
        s.compactions.push({
          seq: event.seq,
          summary: event.summary,
          retainedTail: event.retainedTail,
          tokensBefore: event.tokensBefore,
        });
        break;
      case "checkpoint":
      case "request/header":
        break; // 词汇表占位事件：P0 投影不消费
    }
  }
}

/** 便捷全量投影（E3 基准入口）：events → 会话投影。 */
export function project(events: readonly SessionEvent[]): SessionProjection {
  return Projector.fold(events).projection;
}
