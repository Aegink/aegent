/**
 * 审批历史数据面（T-P3-137 八轮 E + T-P3-140 批次 E 的拆分位）——
 * bridge 的 policy-audit op 拦截器只做分派，扫描逻辑独立成域文件：
 * host 行数纪律（maxFileLines 400）下的拆分，行为零变化。
 *
 * 扫描面：当前会话流的策略拒绝（PolicyGate）+ 沙箱升级拒绝（批次 E——
 * SANDBOX_ESCALATION_DENIED / SANDBOX_UNAVAILABLE，fail-closed 的可见
 * 事实）；升级徽标与理由取自 tool/call 的原始 arguments JSON 串。
 */

import type { SessionEvent } from "../kernel/events.js";

/** 升级拒绝的错误码闭集（与 src/sandbox/escalation.ts 字面量同源——
 * 前端零构建链面，改动需两侧同步）。 */
const SANDBOX_REFUSAL_CODES = ["SANDBOX_ESCALATION_DENIED", "SANDBOX_UNAVAILABLE"];

export interface PolicyAuditEntry {
  time: string;
  tool: string;
  reason: string;
  escalation?: string;
  justification?: string;
}

export function buildPolicyAuditEntries(all: readonly SessionEvent[]): PolicyAuditEntry[] {
  // tool/result 不带工具名（name 在 tool/call）——先建 callId 映射；
  // 升级面同步提取（sandboxPermissions/justification 在 call 的原始参数串）。
  const callInfo = new Map<string, { name: string; escalation?: string; justification?: string }>();
  for (const ev of all) {
    if (ev.type !== "tool/call") continue;
    // arguments 是原始 JSON 串（保真存储）——升级字段解析失败宽容跳过
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(ev.arguments) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    callInfo.set(ev.callId, {
      name: ev.name,
      ...(typeof parsed["sandboxPermissions"] === "string"
        ? { escalation: parsed["sandboxPermissions"] }
        : {}),
      ...(typeof parsed["justification"] === "string"
        ? { justification: parsed["justification"] }
        : {}),
    });
  }
  const entries: PolicyAuditEntry[] = [];
  for (const ev of [...all].reverse()) {
    if (entries.length >= 50) break;
    if (ev.type !== "tool/result" || ev.message?.isError !== true) continue;
    const err = ev.error as { name?: unknown; reason?: unknown; code?: unknown } | undefined;
    const info = callInfo.get(ev.callId);
    const isPolicyGate = err?.name === "PolicyGate";
    const isSandboxRefusal =
      info?.escalation !== undefined &&
      typeof err?.code === "string" &&
      SANDBOX_REFUSAL_CODES.includes(err.code);
    if (!isPolicyGate && !isSandboxRefusal) continue;
    entries.push({
      time: new Date(ev.ts).toLocaleString("zh-CN"),
      tool: info?.name ?? "?",
      reason: typeof err?.reason === "string" ? err.reason.slice(0, 120) : "",
      ...(info?.escalation !== undefined ? { escalation: info.escalation } : {}),
      ...(info?.justification !== undefined ? { justification: info.justification } : {}),
    });
  }
  return entries;
}
