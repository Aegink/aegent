/**
 * F8/T-P1-104 验收：工具结果历史裁剪器——
 * ①超限旧结果被裁成占位符（含原尺寸、callId、spill 指针）；
 * ②未超限与 keepLast 窗口内结果原文不动；
 * ③配对保持（每个占位符仍是 tool 角色 + callId——因果链不破）；
 * ④幂等（同输入两次裁剪逐字节相等）；
 * ⑤rules 缺省值（keepLast 4 / maxChars 2000）；
 * ⑥非破坏性（入多数组不变）。
 */

import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../models/provider.js";
import {
  DEFAULT_RESULT_TRIM_RULES,
  trimToolResultMessages,
} from "./result-trim.js";

function toolMsg(callId: string, content: string): ChatMessage {
  return { role: "tool", callId, content };
}

describe("trimToolResultMessages（F8 工具结果历史裁剪）", () => {
  it("验收①：超限旧结果 → 占位符（原尺寸 + callId + spill 指针提取）", () => {
    const big = "x".repeat(3_000) + "\n[Output truncated (51200 bytes). 完整输出在 C:/spill/a.txt]";
    const messages: ChatMessage[] = [
      { role: "user", content: "问" },
      toolMsg("c1", big),
      { role: "assistant", content: "答" },
    ];
    const trimmed = trimToolResultMessages(messages, { keepLast: 0 });
    const t = trimmed[1] as { role: "tool"; callId: string; content: string };
    expect(t.role).toBe("tool");
    expect(t.callId).toBe("c1");
    expect(t.content).toContain("结果已裁剪");
    expect(t.content).toContain(`原 ${String(big.length)} 字符`);
    expect(t.content).toContain("callId c1");
    expect(t.content).toContain("完整输出在 C:/spill/a.txt");
    // 原超长内容不再出现在视图里
    expect(t.content).not.toContain("xxxxx");
  });

  it("验收②：未超限与 keepLast 窗口内的结果原文不动；user/assistant 永不触碰", () => {
    const messages: ChatMessage[] = [
      toolMsg("c1", "y".repeat(5_000)), // 最旧：超限 → 裁
      toolMsg("c2", "短"), // 未超限 → 不裁（即使窗口外）
      toolMsg("c3", "z".repeat(9_000)), // 窗口内（keepLast 2）→ 不裁
      { role: "assistant", content: "答" },
      { role: "user", content: "w".repeat(9_999) }, // 非 tool 角色 → 不裁
    ];
    const trimmed = trimToolResultMessages(messages, { keepLast: 2, maxChars: 2_000 });
    expect((trimmed[0] as { content: string }).content).toContain("结果已裁剪");
    expect(trimmed[1]).toEqual(messages[1]);
    expect(trimmed[2]).toEqual(messages[2]);
    expect(trimmed[3]).toEqual(messages[3]);
    expect(trimmed[4]).toEqual(messages[4]);
  });

  it("验收③：配对保持——裁剪后每个 tool/call 仍有配对 result（占位符携带 callId）", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "bash", arguments: "{}" }] },
      toolMsg("c1", "a".repeat(4_000)),
      { role: "assistant", content: "", toolCalls: [{ id: "c2", name: "bash", arguments: "{}" }] },
      toolMsg("c2", "b".repeat(4_000)),
    ];
    const trimmed = trimToolResultMessages(messages, { keepLast: 0 });
    const toolCalls = trimmed.filter((m) => m.role === "tool");
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls.map((m) => (m as { callId: string }).callId).sort()).toEqual(["c1", "c2"]);
  });

  it("验收④：幂等——已裁视图再次裁剪逐字节相等", () => {
    const messages: ChatMessage[] = [
      toolMsg("c1", "a".repeat(3_000)),
      toolMsg("c2", "b".repeat(3_000)),
      toolMsg("c3", "c".repeat(3_000)),
    ];
    const once = trimToolResultMessages(messages, { keepLast: 1 });
    const twice = trimToolResultMessages(once, { keepLast: 1 });
    expect(twice).toEqual(once);
  });

  it("验收⑤：缺省规则 keepLast=4 / maxChars=2000", () => {
    expect(DEFAULT_RESULT_TRIM_RULES).toEqual({ keepLast: 4, maxChars: 2_000 });
    const messages: ChatMessage[] = Array.from({ length: 6 }, (_, i) =>
      toolMsg(`c${String(i)}`, "d".repeat(2_500)),
    );
    const trimmed = trimToolResultMessages(messages);
    // 尾部 4 条原文保留，最旧 2 条被裁
    expect(
      trimmed.filter((m) => (m as { content: string }).content.includes("结果已裁剪")),
    ).toHaveLength(2);
  });

  it("验收⑥：非破坏性——入多数组不被修改", () => {
    const messages: ChatMessage[] = [toolMsg("c1", "e".repeat(3_000))];
    const snapshot = [...messages];
    trimToolResultMessages(messages, { keepLast: 0 });
    expect(messages).toEqual(snapshot);
  });
});
