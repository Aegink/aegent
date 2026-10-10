/**
 * F18 模型流中断恢复（T-P1-102）——zcode StreamRecovery 六事件语义面的我方
 * 同构承载（plan-p1.md 批次 11 卡序头核对结论 ③）：锚点先于故障持久化 =
 * 事件 append 逐条落盘（已提交 assistant/message 与 tool/call+result 即锚点
 * 本体，失败尝试以 assistant/attempt 连完整 timed chunks 落盘即"被丢弃的
 * tail"）；有界重试 = loop 级从锚点重建历史重发整 step（本模块供分类判据、
 * 策略形状与类型化 blocked 标记）；显式终态 blocked = TurnEndReason 既有
 * 槽位复用（零词汇表扩展）。
 *
 * 判据（classifyStreamFailure）：ProviderHttpError 且 status 不在 J26 显式
 * 可重试枚举 → non-retryable（auth/quota/4xx 终态——重试无意义，zcode
 * blocked 三判据的 non_retryable_failure 我方位）；其余 → recoverable
 * （wire 破坏/网络中断/流中断——transient 类）。zcode 的 running/unknown_
 * side_effect 两判据不适用：我方工具仅在流结束后派发，失败 attempt 的
 * tool calls 从未离开发射器（无在途副作用歧义）——loop 断言钉死。
 *
 * 分域（与 retry.ts D15 流边界）：首 chunk 前的失败仍是 provider 级
 * withRetry 的域（它已按同分类决定重试或上抛）；loop 级恢复只接管"流已
 * 产出增量"后的失败——该域内 withRetry 从不重试（增量已送达调用方，
 * chunk 级重试必然重复产出），重发的正确粒度是整 step（从锚点重建请求）。
 */

import { ProviderHttpError } from "../../index.js";
import { isRetryableStatus } from "./retry-after.js";

export interface StreamRecoveryPolicy {
  /** 恢复重试上限（不含首次；装配缺省 2）。 */
  maxRetries: number;
}

export type StreamFailureVerdict = "recoverable" | "non-retryable";

export function classifyStreamFailure(e: unknown): StreamFailureVerdict {
  if (e instanceof ProviderHttpError && !isRetryableStatus(e.status)) {
    return "non-retryable";
  }
  return "recoverable";
}

/** 不可重试流失败的类型化标记——runStep 捕获后以 turn/end{blocked} 显式收轮。 */
export class StreamRecoveryBlockedError extends Error {
  override readonly name = "StreamRecoveryBlockedError";
  constructor(readonly original: unknown) {
    super(
      `流失败不可安全重试（non_retryable_failure）：${original instanceof Error ? original.message : String(original)}`,
    );
    this.name = "StreamRecoveryBlockedError";
  }
}

/** assistant/retrying 的 error 三字段（kimi retryErrorFields 同构——J27 事件形状）。 */
export function retryErrorFieldsOf(e: unknown): {
  name: string;
  message: string;
  status?: number;
} {
  if (e instanceof ProviderHttpError) {
    return { name: "ProviderHttpError", message: e.message, status: e.status };
  }
  return {
    name: e instanceof Error ? e.name : typeof e,
    message: e instanceof Error ? e.message : String(e),
  };
}
