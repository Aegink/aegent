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

import {
  EVENT_TYPES,
  type GoalStatus,
  type SessionEvent,
  type TodoStatus,
  type TokenUsage,
} from "../kernel/events.js";

/** todo 项（投影面形状；与事件载荷 items 同构——E12 整值语义）。 */
export interface ProjectionTodo {
  content: string;
  status: TodoStatus;
}

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
  /** lastUsage 所属事件的 seq（revert 切点截断判断用）。 */
  lastUsageSeq: number | null;
  /**
   * E17/T-P1-93：status 可选（缺省 = completed 旧流兼容口径）——started/
   * failed 的流内事实如实进投影（"投影不猜中间态"），消费方按 status 区分。
   */
  compactions: Array<{
    seq: number;
    summary: string;
    retainedTail: number;
    tokensBefore: number;
    status?: "started" | "completed" | "failed";
  }>;
  /** 非 null 时有效投影只含 seq ≤ revertedTo 的效果（E4：最新 session/revert 标记生效）。 */
  revertedTo: number | null;
  /**
   * 换模事件记录（T-P1-06）：`modelSelection` 的事实源序列——有效视窗内
   * 最新一条的 to 即当前会话级模型选择（J14 回放保护）。
   */
  modelSwitches: Array<{
    seq: number;
    to: { provider: string; modelId: string };
    reason: "user" | "rollback";
  }>;
  /**
   * todo 清单的更新历史（T-P1-10）：每条 todo/update 的完整清单（E12）。
   * 当前状态 = 有效视窗内最新一条的 items（revert 切点切割同 modelSwitches）。
   */
  todos: Array<{ seq: number; items: ProjectionTodo[] }>;
  /**
   * goal 事实的变更历史（T-P1-12）：每条 goal/set 的完整事实（E12）。
   * 当前 goal = 有效视窗内最新一条（revert 切点切割同 todos）。
   */
  goals: Array<{ seq: number; text: string; deadline?: number; status: GoalStatus }>;
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
    lastUsageSeq: null,
    compactions: [],
    revertedTo: null,
    modelSwitches: [],
    todos: [],
    goals: [],
  };
}

const KNOWN_TYPES = new Set<string>(EVENT_TYPES);

/** L8 六维值域闭集（与 events.ts 注释同步——单一事实源是词汇表）。 */
const COMPACTION_TRIGGERS = new Set(["auto", "manual"]);
const COMPACTION_EVENT_PHASES = new Set(["pre_turn", "mid_turn"]);
const COMPACTION_STATUSES = new Set(["started", "completed", "failed"]);

function validateCompactionMetrics(event: Extract<SessionEvent, { type: "compaction" }>): void {
  if (event.trigger !== undefined && !COMPACTION_TRIGGERS.has(event.trigger)) {
    throw new ProjectError(`compaction.trigger 值域外：${event.trigger}（合法：auto|manual）`);
  }
  if (event.phase !== undefined && !COMPACTION_EVENT_PHASES.has(event.phase)) {
    throw new ProjectError(`compaction.phase 值域外：${event.phase}（合法：pre_turn|mid_turn）`);
  }
  if (event.status !== undefined && !COMPACTION_STATUSES.has(event.status)) {
    throw new ProjectError(`compaction.status 值域外：${event.status}（合法：started|completed|failed）`);
  }
  // implementation/strategy 单一实现期是自由值（注释纪律收闭集），只查形状
  if (event.implementation !== undefined && typeof event.implementation !== "string") {
    throw new ProjectError("compaction.implementation 须为字符串");
  }
  if (event.strategy !== undefined && typeof event.strategy !== "string") {
    throw new ProjectError("compaction.strategy 须为字符串");
  }
}

/**
 * JsonValue 结构校验的嵌套深度上限（T5/T-P1-123——上限必须写实测溢出点与余量倍数）。
 * 实测 Node 22 默认栈下，递归结构校验（Object.values 形态）约在 ~8400 层触发
 * RangeError 栈溢出（失控异常——T6 明令禁止的形态）；本上限 512 层保持 ≥15×
 * 余量，且远超任何合法落流 payload 的深度（厂商 API 侧 JSON 深度限制通常 ≤128）。
 * 超限 = 结构校验失败（false → 调用点 ProjectError 受控拒绝），绝不崩于 RangeError。
 */
export const MAX_JSON_DEPTH = 512;

/** JsonValue 结构校验（plugin.payload 用，C17——只允许可序列化值落流）。 */
function isJsonValue(v: unknown, depth = 0): boolean {
  if (depth > MAX_JSON_DEPTH) return false;
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return true;
  }
  if (Array.isArray(v)) return v.every((x) => isJsonValue(x, depth + 1));
  if (typeof v === "object") return Object.values(v).every((x) => isJsonValue(x, depth + 1));
  return false;
}

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
        // A12/T-P1-53：promptId 可选载荷校验（present 时必须非空字符串）——
        // 旧流缺省该字段（前向兼容）。
        if (
          event.promptId !== undefined &&
          (typeof event.promptId !== "string" || event.promptId === "")
        ) {
          throw new ProjectError("user/message 的 promptId 非法（须为非空字符串或缺省）");
        }
        break;
      case "assistant/message":
      case "assistant/attempt":
      case "assistant/retrying":
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
      case "tool/progress":
        // B7 进度（T-P1-16）：与 tool/call/result 同域——进度只能在所属
        // 调用未闭合时产生（turn/step 开启 + callId 在开集合中）
        this.requireOpenTurn(turn);
        this.requireOpenStep(turn, step);
        if (!this.state.openToolCalls.has(event.callId)) {
          throw new ProjectError(`tool/progress 的 callId=${event.callId} 没有前置未闭合的 tool/call`);
        }
        break;
      case "compaction":
        // L8/T-P1-92 六维载荷值域闭集（透传垃圾值拒绝——E12/E16 校验面）；
        // 全部可选（旧流缺省兼容——status 缺省读作 completed）。
        validateCompactionMetrics(event);
        break;
      case "checkpoint":
      case "request/header":
      case "model/switch":
      case "todo/update":
      case "goal/set":
        break;
      case "session/revert":
        // 会话级元事件：不要求 turn/step 上下文。revert 的目标点不能在未来。
        if (event.phase === "revert") {
          if (event.targetSeq < 0 || event.targetSeq > this.state.lastSeq) {
            throw new ProjectError(
              `revert 目标 seq=${event.targetSeq} 越界（合法范围 0..${this.state.lastSeq}）`,
            );
          }
        } else if (event.targetSeq !== 0) {
          throw new ProjectError("undo 标记约定 targetSeq=0");
        }
        break;
      case "session/fork":
        // 会话级元事件（E5/T-P1-40，落子流头部）：载荷基本形状校验——
        // parentSessionId 非空、position 闭集、cutSeq 非负整数（cutSeq 相对
        // 父流，本流校验不了其范围——越界在 store.fork 生成时已拒绝）。
        if (typeof event.parentSessionId !== "string" || event.parentSessionId === "") {
          throw new ProjectError("session/fork 需要 parentSessionId 非空字符串");
        }
        if (event.position !== "before" && event.position !== "after") {
          throw new ProjectError(`session/fork 的 position 非法：${String(event.position)}`);
        }
        if (!Number.isInteger(event.cutSeq) || event.cutSeq < 0) {
          throw new ProjectError(`session/fork 的 cutSeq 非法：${String(event.cutSeq)}`);
        }
        break;
      case "command/run":
        // L7/T-P1-95 命令生命周期（log-only 会话级元事件）：commandId/name
        // 非空（配对与来源可检索）；args/source 可选字符串。
        if (typeof event.commandId !== "string" || event.commandId === "") {
          throw new ProjectError("command/run 需要 commandId 非空字符串");
        }
        if (typeof event.name !== "string" || event.name === "") {
          throw new ProjectError("command/run 需要 name 非空字符串");
        }
        if (event.args !== undefined && typeof event.args !== "string") {
          throw new ProjectError("command/run 的 args 须为字符串");
        }
        if (event.source !== undefined && typeof event.source !== "string") {
          throw new ProjectError("command/run 的 source 须为字符串");
        }
        break;
      case "command/done":
        // done 结算：commandId 非空 + kind 二值闭集 + text 可选字符串。
        if (typeof event.commandId !== "string" || event.commandId === "") {
          throw new ProjectError("command/done 需要 commandId 非空字符串");
        }
        if (event.kind !== "success" && event.kind !== "error") {
          throw new ProjectError(`command/done 的 kind 非法：${String(event.kind)}（合法：success|error）`);
        }
        if (event.text !== undefined && typeof event.text !== "string") {
          throw new ProjectError("command/done 的 text 须为字符串");
        }
        break;
      case "surface/attach":
        // N8/T-P1-114 surface roster 生命周期（log-only 会话级元事件）：
        // surfaceId 非空（端标识可检索）；deliveryKind 闭集（N7 投递方式）。
        if (typeof event.surfaceId !== "string" || event.surfaceId === "") {
          throw new ProjectError("surface/attach 需要 surfaceId 非空字符串");
        }
        if (
          event.deliveryKind !== undefined &&
          event.deliveryKind !== "push" &&
          event.deliveryKind !== "poll"
        ) {
          throw new ProjectError(
            `surface/attach 的 deliveryKind 非法：${String(event.deliveryKind)}（合法：push|poll）`,
          );
        }
        break;
      case "surface/detach":
        // detach 结算：surfaceId 非空 + reason 可选字符串（断线/主动/顶替）。
        if (typeof event.surfaceId !== "string" || event.surfaceId === "") {
          throw new ProjectError("surface/detach 需要 surfaceId 非空字符串");
        }
        if (event.reason !== undefined && typeof event.reason !== "string") {
          throw new ProjectError("surface/detach 的 reason 须为字符串");
        }
        break;
      case "plugin":
        // 插件泛型逃生舱（C17/T-P1-72）：namespace 非空（来源可检索）、
        // payload 可选 JsonValue（只传可序列化值）。
        if (typeof event.namespace !== "string" || event.namespace === "") {
          throw new ProjectError("plugin 需要 namespace 非空字符串");
        }
        if (
          event.payload !== undefined &&
          !isJsonValue(event.payload)
        ) {
          throw new ProjectError(
            "plugin 的 payload 必须是 JsonValue（可序列化值；含超深嵌套防护——MAX_JSON_DEPTH 512）",
          );
        }
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
        if (event.usage) {
          s.lastUsage = event.usage;
          s.lastUsageSeq = event.seq;
        }
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
      case "assistant/retrying":
        break; // 重试可见性事实（J27）——投影不聚值，事件流即真相
      case "compaction":
        // E17/T-P1-93：started/failed 也进投影（"投影不猜中间态"——崩溃
        // 后 restore 可见"压缩进行中/未完成"事实）；status 缺省 = completed
        // （旧流兼容口径）。
        s.compactions.push({
          seq: event.seq,
          summary: event.summary,
          retainedTail: event.retainedTail,
          tokensBefore: event.tokensBefore,
          // 值域已由 validateCompactionMetrics 闭集校验（上面），收窄安全
          ...(event.status !== undefined
            ? { status: event.status as "started" | "completed" | "failed" }
            : {}),
        });
        break;
      case "checkpoint":
      case "request/header":
        break; // 词汇表占位事件：P0 投影不消费
      case "model/switch":
        // J14：会话级模型选择的事实源 = 流内最新本事件的 to（有效视窗内
        // 最新——effectiveProjection 按 seq 切割）。
        s.modelSwitches.push({
          seq: event.seq,
          to: event.to,
          reason: event.reason,
        });
        break;
      case "todo/update":
        // G2：todo 变更 = 事件，状态 = 投影。items 是整值（E12），逐条全记
        //（revert 切点重建依据），当前值 = 有效视窗内最新一条。
        s.todos.push({ seq: event.seq, items: event.items.map((i) => ({ ...i })) });
        break;
      case "goal/set":
        // G3：goal 事实整值全记（E12），当前 goal = 有效视窗内最新一条。
        s.goals.push({
          seq: event.seq,
          text: event.text,
          ...(event.deadline !== undefined ? { deadline: event.deadline } : {}),
          status: event.status,
        });
        break;
      case "session/revert":
        s.revertedTo = event.phase === "revert" ? event.targetSeq : null;
        break;
      case "session/fork":
        break; // E5 lineage 是子流头部事实：投影不消费（读流头部即可查）
      case "plugin":
        break; // C17 泛型逃生舱是 log-only 载荷：投影不消费（消费方按 namespace 自取）
      case "command/run":
      case "command/done":
        break; // L7 命令生命周期是 log-only 存在性记录：投影不聚值（事件流即真相）
      case "tool/progress":
        break; // B7 进度是瞬态事实：投影不消费（事实在事件流本身，按 callId+seqInCall 可查）
    }
  }

  /**
   * 有效投影（E4 消费面）：revertedTo 非 null 时返回隐藏 seq > revertedTo 效果的副本。
   * openSteps/openToolCalls 是无 seq 的开集合，保持全流真值（P0 消费方不依赖它们过 revert 切点）。
   */
  effectiveProjection(): SessionProjection {
    const s = this.state;
    if (s.revertedTo === null) return s;
    const cut = s.revertedTo;
    return {
      ...s,
      messages: s.messages.filter((m) => m.seq <= cut),
      lastUsage: s.lastUsageSeq !== null && s.lastUsageSeq <= cut ? s.lastUsage : null,
      toolCalls: new Map([...s.toolCalls].filter(([, v]) => v.seq <= cut)),
      toolResults: new Map([...s.toolResults].filter(([, v]) => v.seq <= cut)),
      compactions: s.compactions.filter((c) => c.seq <= cut),
      modelSwitches: s.modelSwitches.filter((m) => m.seq <= cut),
      todos: s.todos.filter((t) => t.seq <= cut),
      goals: s.goals.filter((g) => g.seq <= cut),
      openTurn: s.openTurn && s.openTurn.seq <= cut ? s.openTurn : null,
    };
  }
}

/** 便捷全量投影（E3 基准入口 / E4 消费入口）：events → 有效会话投影。 */
export function project(events: readonly SessionEvent[]): SessionProjection {
  return Projector.fold(events).effectiveProjection();
}
