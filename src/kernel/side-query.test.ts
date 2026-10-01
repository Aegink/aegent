import { describe, expect, it } from "vitest";
import { runSideQuery, SideQueryError } from "./side-query.js";
import { ProviderHttpError } from "../models/provider.js";
import type { ModelProvider } from "../models/provider.js";

/** fake provider：按脚本产出 text-delta/usage/done 或抛错。 */
import type { StreamChunk } from "../kernel/events.js";
type FakeChunk = Extract<StreamChunk, { type: "text-delta" | "usage" | "done" }>;
function scriptedProvider(script: () => Generator<FakeChunk>): ModelProvider {
  return {
    async *streamChat() {
      yield* script();
    },
  };
}

describe("统一副调用底座（T-P3-147 A）", () => {
  it("正常路径：text 收集 + usage 透传 + ms 计时", async () => {
    const r = await runSideQuery({
      purpose: "polish",
      provider: scriptedProvider(function* () {
        yield { type: "text-delta", text: "你好" };
        yield { type: "text-delta", text: "世界" };
        yield { type: "usage", usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 } };
        yield { type: "done" };
      }),
      identity: { provider: "echo", modelId: "m" },
      messages: [{ role: "user", content: "x" }],
      sleep: async () => {},
    });
    expect(r.text).toBe("你好世界");
    expect(r.usage?.totalTokens).toBe(8);
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it("空输出：类型化 <PURPOSE>_EMPTY，不重试", async () => {
    let attempts = 0;
    const provider: ModelProvider = {
      async *streamChat() {
        attempts++;
        yield { type: "text-delta", text: "  " };
        yield { type: "done" };
      },
    };
    await expect(
      runSideQuery({
        purpose: "polish",
        provider,
        identity: { provider: "e", modelId: "m" },
        messages: [{ role: "user", content: "x" }],
        maxRetries: 3,
        sleep: async () => {
          attempts += 10;
        },
      }),
    ).rejects.toMatchObject({ code: "POLISH_EMPTY" });
    expect(attempts).toBe(1); // 空输出不重试
  });

  it("瞬态失败重试（可重试 status）后成功；不可重试首试即返", async () => {
    let attempts = 0;
    const flaky: ModelProvider = {
      async *streamChat() {
        attempts++;
        if (attempts < 3) throw new ProviderHttpError(429, "rate limited");
        yield { type: "text-delta", text: "ok" };
        yield { type: "done" };
      },
    };
    const r = await runSideQuery({
      purpose: "title",
      provider: flaky,
      identity: { provider: "e", modelId: "m" },
      messages: [{ role: "user", content: "x" }],
      sleep: async () => {},
    });
    expect(r.text).toBe("ok");
    expect(attempts).toBe(3);
    // 不可重试（status 400）：首试即返
    let badAttempts = 0;
    const bad: ModelProvider = {
      async *streamChat() {
        badAttempts++;
        throw new ProviderHttpError(400, "bad request");
      },
    };
    await expect(
      runSideQuery({
        purpose: "title",
        provider: bad,
        identity: { provider: "e", modelId: "m" },
        messages: [{ role: "user", content: "x" }],
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(SideQueryError);
    expect(badAttempts).toBe(1);
  });
});
