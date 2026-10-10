/**
 * 压缩后端契约（T7-7/W11，dsh §8 同构）——压缩 = "一族可组合后端包"
 * （basic / image-offload / tool-result-pruner / command），内核只留两挂点
 * （PreTurn/MidTurn）+ 压力记录 + result-trim/prefix-anchor。
 * **插件失败 = 回落原行为**（fail-open 到内建路径——压缩是增强面不是承重墙）。
 */

import type { SessionEvent, NewSessionEvent } from "../skeleton/events.js";
import type { SessionStore } from "./session.js";

/** 压缩请求（CompactionRequest 的契约形状——词汇沿既有 4 种来源）。 */
export type CompactionRequestKind = "overflow" | "provider_error" | "hash_change" | "manual";

export interface CompactionBackendInput {
  readonly sessionId: string;
  readonly turn: number;
  readonly request: CompactionRequestKind;
  readonly events: readonly SessionEvent[];
  /** 压缩保留规则（retainedFromEnd 等——内建路径的参数面）。 */
  readonly retainedFromEnd?: number;
}

export interface CompactionBackendOutput {
  /** 摘要文本（进 compaction 事件）。 */
  readonly summary: string;
  /** 新窗口事件（post-compaction 的重建流——backdrop 裁剪后的结果）。 */
  readonly newWindowEvents?: readonly NewSessionEvent[];
  /** 策略标注（落 compaction 事件的 strategy 字段——可归因）。 */
  readonly strategy?: string;
}

/**
 * 压缩后端端口：shouldCompact（压力判定）+ compact（执行摘要）+
 * protectedRegions（不可压缩区——system prompt/tools/prefix 永不压缩）+
 * toolPairing（tool/call↔result 配对完整性——后端不得拆散配对）。
 */
export interface CompactionBackend {
  /** 后端名（诊断与 compaction 事件 strategy 标注）。 */
  readonly name: string;
  /** 压力判定（true = 需要压缩；内建判定=token 溢出/连续错误——后端可覆盖）。 */
  shouldCompact(input: { events: readonly SessionEvent[]; tokenBudget?: number }): boolean;
  /** 执行压缩（摘要产出；失败 = 回落内建路径）。 */
  compact(input: CompactionBackendInput): Promise<CompactionBackendOutput>;
  /**
   * 不可压缩区（seq 集合——system prompt 事件/request header/prefix 锚）。
   * 缺省 = 内建判定（首落 system 段 + request/header + session/*）。
   */
  protectedRegions?(events: readonly SessionEvent[]): ReadonlySet<number>;
  /** tool 配对完整性（后端产出 newWindowEvents 后自查——配对断裂 = 拒绝落盘）。 */
  toolPairing?(events: readonly NewSessionEvent[]): { ok: boolean; reason?: string };
}

/** 回落宿主（内建 CompactionEngine.run——插件失败时的原行为路径）。 */
export type CompactionFallback = (
  input: CompactionBackendInput,
) => Promise<{ summary: string; events: readonly NewSessionEvent[] }>;

/** 后端注册（宿主装配——外部 provider 经此挂载；缺省 = 内建路径直接跑）。 */
export interface CompactionBackendHost {
  readonly backend: CompactionBackend;
  /** 失败回落（内建引擎 run——契约边界，循环依赖用注入打破）。 */
  readonly fallback: CompactionFallback;
}
