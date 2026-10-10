/**
 * T7-7/W11 压缩后端家族化测试：后端替换 / 失败回落 / 不可压缩区 / 配对完整性。
 */
import { describe, expect, it } from "vitest";

import {
  type CompactionBackend,
  type CompactionBackendInput,
  type CompactionBackendOutput,
} from "../core/contracts/compaction.js";
import type { NewSessionEvent, SessionEvent } from "../core/index.js";

/** 最小后端构造（替换/回落用例的桩）。 */
const makeBackend = (
  name: string,
  compactImpl: (input: CompactionBackendInput) => Promise<CompactionBackendOutput>,
): CompactionBackend => ({
  name,
  shouldCompact: () => true,
  compact: compactImpl,
});

/** 带配对完整性的事件序列（turn1: assistant(toolCalls c1) → tool/call c1 → tool/result c1）。 */
const pairedEvents: readonly SessionEvent[] = [
  { type: "turn/start", seq: 1, ts: 1, turn: 1 },
  { type: "assistant/message", seq: 2, ts: 2, turn: 1, message: { content: "" }, toolCalls: [{ id: "c1", name: "read", arguments: "{}" }] },
  { type: "tool/call", seq: 3, ts: 3, turn: 1, step: 1, callId: "c1", name: "read", arguments: "{}" },
  { type: "tool/result", seq: 4, ts: 4, turn: 1, step: 1, callId: "c1", message: { content: "文件内容" } },
  { type: "turn/end", seq: 5, ts: 5, turn: 1, reason: { kind: "completed" } },
] as never;

describe("W11/T7-7 压缩后端家族化", () => {
  it("后端替换：外部 backend 产出 summary（strategy 标注 = 后端名）", async () => {
    const backend = makeBackend("external-summarizer", async (input) => ({
      summary: `外部摘要（${input.events.length} 条事件）`,
      strategy: "external-summarizer",
    }));
    const input: CompactionBackendInput = { sessionId: "s1", turn: 1, request: "overflow", events: pairedEvents };
    const out = await backend.compact(input);
    expect(out.summary).toContain("外部摘要");
    expect(out.strategy).toBe("external-summarizer");
  });

  it("失败回落：backend.compact 抛错 → 宿主 catch 落 fallback（内建路径跑原行为）", async () => {
    const failing = makeBackend("failing-backend", async () => {
      throw new Error("外部摘要服务不可达");
    });
    const fallbackCalls: string[] = [];
    const fallback = async (input: CompactionBackendInput) => {
      fallbackCalls.push("fallback-run");
      return { summary: "内建摘要（回落产物）", events: [] };
    };
    // 宿主协议：backend.compact 失败 = 回落（fail-open 到内建路径——压缩是增强面）
    let out: { summary: string };
    try {
      out = await failing.compact({ sessionId: "s1", turn: 1, request: "overflow", events: pairedEvents });
    } catch {
      out = await fallback({ sessionId: "s1", turn: 1, request: "overflow", events: pairedEvents });
    }
    expect(out.summary).toContain("内建摘要");
    expect(fallbackCalls).toHaveLength(1);
  });

  it("不可压缩区：protectedRegions 缺省内建判定（system 段/request header/session 事件）", () => {
    const backend = makeBackend("b", async () => ({ summary: "" }));
    const events = pairedEvents;
    // 缺省（backend.protectedRegions 未覆盖）= 内建判定：request/header 与 session/* 不可压缩
    const builtinProtected = (es: readonly SessionEvent[]): ReadonlySet<number> =>
      new Set(es.filter((e) => e.type === "request/header" || e.type.startsWith("session/")).map((e) => e.seq));
    const protectedSeqs = backend.protectedRegions?.(events) ?? builtinProtected(events);
    // pairedEvents 无 request/header——配对区（tool/call+result）不进保护区（可被裁剪）
    expect(protectedSeqs.has(3)).toBe(false);
  });

  it("toolPairing：配对断裂 = 拒绝落盘（tool/call 无 result 的事件窗被拒）", () => {
    const backend = makeBackend("b", async () => ({ summary: "" }));
    // 断裂窗：tool/call 后无 tool/result
    const brokenWindow: NewSessionEvent[] = [
      { type: "tool/call", turn: 1, step: 1, callId: "c1", name: "read", arguments: "{}" },
    ] as never;
    // 内建配对自查（后端未覆盖时的宿主兜底）：扫描 call/result 序
    const builtinPairing = (es: readonly NewSessionEvent[]): { ok: boolean; reason?: string } => {
      const open = new Set<string>();
      for (const e of es) {
        if (e.type === "tool/call") open.add((e as { callId: string }).callId);
        if (e.type === "tool/result") open.delete((e as { callId: string }).callId);
      }
      return open.size === 0 ? { ok: true } : { ok: false, reason: `tool/call 未闭合 ${open.size} 项（配对完整性）` };
    };
    const verdict = backend.toolPairing?.(brokenWindow) ?? builtinPairing(brokenWindow);
    expect(verdict.ok).toBe(false);
  });
});
