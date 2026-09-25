import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StreamChunk } from "../kernel/events.js";
import { parseProviderConfig } from "./config.js";
import { createOpenAiCompatProvider } from "./openai-compat.js";
import type { ChatRequest, ModelProvider } from "./provider.js";
import {
  DEFAULT_MAX_ATTEMPTS,
  backoffDelayMs,
  isRetryableStatus,
  parseRetryAfterMs,
  withRetry,
} from "./retry.js";
import { modelIdentity } from "./identity.js";
import { HttpMock } from "../test-support/http-mock.js";

function wireChunk(delta: object): object {
  return {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-test",
    choices: [{ index: 0, delta, finish_reason: null }],
  };
}

async function collect(provider: ModelProvider, req: ChatRequest): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of provider.streamChat(req)) out.push(c);
  return out;
}

/** "mock 时间"：等待时长被记录为断言数据，不真睡（真端口 IO 仍在真实事件循环上）。 */
function recordingSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return { sleep: async (ms) => void waits.push(ms), waits };
}

describe("retry 纯函数 —— J26 退避与 Retry-After", () => {
  it("可重试 status 是显式枚举（400/401/403 不在内）", () => {
    for (const s of [408, 409, 429, 500, 502, 503, 504, 529]) {
      expect(isRetryableStatus(s)).toBe(true);
    }
    for (const s of [400, 401, 403, 404, 422]) {
      expect(isRetryableStatus(s)).toBe(false);
    }
  });

  it("退避 = min(500·2^attempt, 32s) + 25% jitter，rand 注入取区间两端", () => {
    expect(backoffDelayMs(0, 0)).toBe(500);
    expect(backoffDelayMs(0, 1)).toBe(625); // 500 × 1.25
    expect(backoffDelayMs(1, 0)).toBe(1000);
    expect(backoffDelayMs(10, 0)).toBe(32_000); // 封顶
    expect(backoffDelayMs(10, 1)).toBe(40_000);
    expect(backoffDelayMs(30, 0)).toBe(32_000);
  });

  it("Retry-After 头：秒数生效、0/空/非法回落 undefined、HTTP 日期算差值", () => {
    expect(parseRetryAfterMs("2", 1000)).toBe(2000);
    expect(parseRetryAfterMs("0", 1000)).toBeUndefined();
    expect(parseRetryAfterMs("", 1000)).toBeUndefined();
    expect(parseRetryAfterMs(undefined, 1000)).toBeUndefined();
    expect(parseRetryAfterMs("garbage", 1000)).toBeUndefined();
    expect(parseRetryAfterMs("Wed, 01 Jan 2036 00:00:00 GMT", 1000)).toBeGreaterThan(0);
    expect(
      parseRetryAfterMs("Wed, 01 Jan 2000 00:00:00 GMT", Date.parse("2001-01-01T00:00:00Z")),
    ).toBeUndefined(); // 过去的日期：差值非正回落 undefined
  });

  it("DEFAULT_MAX_ATTEMPTS 与 kimi 同为 10", () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(10);
  });
});

describe("withRetry —— 显式分类重试（真实 http-mock + openai-compat）", () => {
  let mock: HttpMock;
  const req: ChatRequest = {
    identity: modelIdentity("mock", "gpt-test"),
    messages: [{ role: "user", content: "hi" }],
  };

  beforeEach(async () => {
    mock = new HttpMock();
    await mock.start();
  });
  afterEach(async () => {
    await mock.stop();
  });

  function makeInnerProvider(): ModelProvider {
    return createOpenAiCompatProvider(
      parseProviderConfig({
        name: "mock",
        settingsConfig: JSON.stringify({ baseUrl: mock.url("/v1"), apiKey: "sk-test" }),
      }),
    );
  }

  it("429 按默认退避重试（mock 时间记录 500→1000），耗尽脚本后成功", async () => {
    mock.mountSequence([
      { status: 429, body: JSON.stringify({ error: { message: "rate #1" } }) },
      { status: 429, body: JSON.stringify({ error: { message: "rate #2" } }) },
      { events: [wireChunk({ content: "ok" })] },
    ]);
    const { sleep, waits } = recordingSleep();
    const provider = withRetry(makeInnerProvider(), { sleep, rand: () => 0 });

    const chunks = await collect(provider, req);

    expect(mock.calls).toBe(3);
    expect(waits).toEqual([500, 1000]);
    expect(chunks.map((c) => c.type)).toEqual(["text-delta", "done"]);
  });

  it("400 不重试：一次调用即抛，零等待", async () => {
    mock.mountSequence([
      { status: 400, body: JSON.stringify({ error: { message: "bad request" } }) },
    ]);
    const { sleep, waits } = recordingSleep();
    const provider = withRetry(makeInnerProvider(), { sleep, rand: () => 0 });

    await expect(collect(provider, req)).rejects.toThrow("bad request");
    expect(mock.calls).toBe(1);
    expect(waits).toEqual([]);
  });

  it("Retry-After: 2 覆盖默认退避（等 2000ms 而非 500ms）", async () => {
    mock.mountSequence([
      { status: 429, headers: { "retry-after": "2" }, body: JSON.stringify({}) },
      { events: [wireChunk({ content: "ok" })] },
    ]);
    const { sleep, waits } = recordingSleep();
    const provider = withRetry(makeInnerProvider(), { sleep, rand: () => 0 });

    await collect(provider, req);

    expect(mock.calls).toBe(2);
    expect(waits).toEqual([2000]);
  });

  it("未知错误一次都不打（非 ProviderHttpError 直接抛）", async () => {
    const inner = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      throw new Error("boom");
    });
    const broken: ModelProvider = { streamChat: inner as unknown as ModelProvider["streamChat"] };
    const { sleep, waits } = recordingSleep();
    const provider = withRetry(broken, { sleep, rand: () => 0 });

    await expect(collect(provider, req)).rejects.toThrow("boom");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it("maxAttempts 上限：3 次尝试后抛出最后一次错误", async () => {
    mock.mountSequence([
      { status: 429, body: JSON.stringify({ error: { message: "r1" } }) },
      { status: 429, body: JSON.stringify({ error: { message: "r2" } }) },
      { status: 429, body: JSON.stringify({ error: { message: "r3" } }) },
      { events: [wireChunk({ content: "never" })] },
    ]);
    const { sleep, waits } = recordingSleep();
    const provider = withRetry(makeInnerProvider(), { sleep, rand: () => 0, maxAttempts: 3 });

    await expect(collect(provider, req)).rejects.toThrow("r3");
    expect(mock.calls).toBe(3);
    expect(waits).toEqual([500, 1000]);
  });

  it("流已产出增量后中途失败不重试（防重复送达）", async () => {
    const inner = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: "text-delta", text: "part" };
      throw new Error("stream broke");
    });
    const broken: ModelProvider = { streamChat: inner as unknown as ModelProvider["streamChat"] };
    const { sleep, waits } = recordingSleep();
    const provider = withRetry(broken, { sleep, rand: () => 0 });

    await expect(collect(provider, req)).rejects.toThrow("stream broke");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });
});
