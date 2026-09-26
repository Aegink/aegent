/**
 * 具名故障剧本库（O16，T-P1-34）——"恢复类逻辑必须能注入故障才可测"
 * （dsh·llm-mock-server："Each accepted request consumes the next scripted
 * behavior, including resets, stalls, malformed chunks, rate limits, server
 * errors"）。每个行为是该次请求在 wire 上的具名表现，挂 HttpMock 消费即推进；
 * startMockLlmServer 捕获请求可断言（dsh 同语义）。
 *
 * 行为是闭集（FAULT_BEHAVIORS）——新故障面加枚举不加字符串。
 */

import type { MockScript } from "./http-mock.js";

/** 具名故障行为闭集（dsh llm-mock-server 的 resets/stalls/malformed/rate limits/server errors 同域）。 */
export const FAULT_BEHAVIORS = [
  "reset",
  "stall",
  "malformed-chunk",
  "rate-limit",
  "server-error",
  "partial-then-success",
] as const;

export type FaultBehavior = (typeof FAULT_BEHAVIORS)[number];

/** stall 行为的默认恢复延迟（可测性：定时恢复，客户端无需长等）。 */
export const DEFAULT_STALL_RECOVER_MS = 200;

/** 一个行为 → 该次请求的 wire 脚本（多数一行；行为参数化走 opts）。 */
export function scriptFor(
  behavior: FaultBehavior,
  opts?: { stallRecoverMs?: number; retryAfterSeconds?: string },
): MockScript {
  switch (behavior) {
    case "reset":
      return { destroy: true };
    case "stall":
      return { stall: true, stallMs: opts?.stallRecoverMs ?? DEFAULT_STALL_RECOVER_MS };
    case "malformed-chunk":
      // 200 + text/event-stream + 坏 JSON data——适配层解析应报错而非静默
      return {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]\n\n", // 缺右括号
      };
    case "rate-limit":
      return {
        status: 429,
        headers: { "retry-after": opts?.retryAfterSeconds ?? "2" },
        body: JSON.stringify({ error: { message: "rate limited", type: "rate_limit_error" } }),
      };
    case "server-error":
      return {
        status: 503,
        body: JSON.stringify({ error: { message: "backend down", type: "server_error" } }),
      };
    case "partial-then-success":
      // 一次请求内：写两条 delta 后不写 [DONE] 直接断开（半流交付）
      return {
        status: 200,
        events: [
          { id: "p1", choices: [{ delta: { role: "assistant", content: "半" } }] },
          { id: "p2", choices: [{ delta: { content: "截" } }] },
          { id: "p3", choices: [{ delta: { content: "不会到达" } }] },
        ],
        truncateAfter: 2,
      };
    default:
      throw new Error(`未知故障行为：${String(behavior)}——闭集见 FAULT_BEHAVIORS`);
  }
}

/** 行为序列 → 脚本序列（每请求消费下一个行为）。 */
export function faultSequence(behaviors: readonly FaultBehavior[], opts?: Parameters<typeof scriptFor>[1]): MockScript[] {
  return behaviors.map((b) => scriptFor(b, opts));
}
