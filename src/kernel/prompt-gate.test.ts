import { describe, expect, it } from "vitest";

import { normalizePromptVerdict, type PromptGateVerdict } from "./prompt-gate.js";

/**
 * A13/T-P1-48 入队闸门三态——形状取 kimi·machine.ts:57 PromptGateVerdict，
 * 归一化同构其 promptGateActor（machine.ts:324-335）。
 * 三态语义（kimi machine.test 改写用例同构）：
 * - true = 放行；false = 拦截；{block:true, message} = 拦截带理由；
 * - {block:false, message} = 改写放行（message 是改写后的完整内容）。
 */
describe("prompt-gate —— A13 入队闸门三态", () => {
  it("归一化：boolean 两态收敛为 block 闭集", () => {
    expect(normalizePromptVerdict(true)).toEqual({ block: false });
    expect(normalizePromptVerdict(false)).toEqual({ block: true });
  });

  it("归一化：对象三态原样保留 block 与 message（有 message 才带）", () => {
    expect(normalizePromptVerdict({ block: true })).toEqual({ block: true });
    expect(normalizePromptVerdict({ block: true, message: "含危险指令" })).toEqual({
      block: true,
      message: "含危险指令",
    });
    expect(normalizePromptVerdict({ block: false, message: "改写后的内容" })).toEqual({
      block: false,
      message: "改写后的内容",
    });
  });

  it("三态在 gate 实现面上的表达：async gate 依次给出三种裁决，逐条归一化消费", async () => {
    const verdicts: PromptGateVerdict[] = [
      true,
      { block: true, message: "理由：含危险指令" },
      { block: false, message: "改写后的内容" },
    ];
    // drainQueue 的消费方式：await gate(p) → normalizePromptVerdict → 分派
    const gate = async () => verdicts.shift()!;
    const normalized = [];
    while (verdicts.length > 0) {
      normalized.push(normalizePromptVerdict(await gate()));
    }
    expect(normalized).toEqual([
      { block: false },
      { block: true, message: "理由：含危险指令" },
      { block: false, message: "改写后的内容" },
    ]);
  });
});
