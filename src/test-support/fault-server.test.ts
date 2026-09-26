import { afterAll, describe, expect, it } from "vitest";

import { FAULT_BEHAVIORS, DEFAULT_STALL_RECOVER_MS, faultSequence, scriptFor } from "./fault-server.js";
import { HttpMock, parseSse } from "./http-mock.js";
import { parseMockLlmArgs, startMockLlmServer } from "../cli/mock-llm.js";

const mocks: HttpMock[] = [];

afterAll(async () => {
  for (const mock of mocks) await mock.stop();
});

async function startWith(sequence: Parameters<typeof faultSequence>[0]): Promise<HttpMock> {
  const mock = new HttpMock();
  mocks.push(mock);
  await mock.start();
  mock.mountSequence(faultSequence(sequence));
  return mock;
}

async function post(url: string, timeoutMs = 2_000): Promise<Response> {
  return fetch(url, {
    method: "POST",
    body: "{}",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

describe("具名故障剧本（O16：六行为闭集，wire 行为各自可断言）", () => {
  it("行为闭集与脚本形状（rate-limit 429 + Retry-After / server-error 503）", async () => {
    expect(FAULT_BEHAVIORS).toEqual([
      "reset",
      "stall",
      "malformed-chunk",
      "rate-limit",
      "server-error",
      "partial-then-success",
    ]);
    const rate = scriptFor("rate-limit");
    expect(rate).toMatchObject({ status: 429, headers: { "retry-after": "2" } });
    const err = scriptFor("server-error");
    expect(err).toMatchObject({ status: 503 });
    expect(() => scriptFor("不存在" as never)).toThrow();
  });

  it("rate-limit / server-error 走真实 HTTP 路径可断言", async () => {
    const mock = await startWith(["rate-limit", "server-error"]);
    const limited = await post(mock.url());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("2");
    expect(await limited.json()).toMatchObject({ error: { type: "rate_limit_error" } });

    const down = await post(mock.url());
    expect(down.status).toBe(503);
    expect(mock.calls).toBe(2); // 计数先行：每请求消费一个行为
  });

  it("malformed-chunk：200 + SSE 头 + 坏 JSON data（适配层解析应报错）", async () => {
    const mock = await startWith(["malformed-chunk"]);
    const res = await post(mock.url());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const data = parseSse(await res.text());
    expect(data).toHaveLength(1);
    expect(() => JSON.parse(data[0]!)).toThrow(); // 坏 JSON 原样到 wire
  });

  it("reset：连接直接断开（fetch 网络错误）；partial-then-success：收到 2 条后断流", async () => {
    // 分 mock：server destroy 后 undici 连接池复用坏连接会污染后续请求
    const resetMock = await startWith(["reset"]);
    await expect(post(resetMock.url())).rejects.toThrow(); // 连接级失败
    await resetMock.stop();

    const partialMock = await startWith(["partial-then-success"]);
    const partial = await post(partialMock.url());
    expect(partial.status).toBe(200);
    // 半流交付：连接在流中途被断开（terminated）——从 reader 收集已到达部分，
    // 断流本身是行为的一部分
    const reader = partial.body!.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
      }
    } catch {
      // 连接错误 = 预期行为（半流后断开）
    }
    const data = parseSse(raw);
    expect(data).toHaveLength(2); // truncateAfter=2：第 3 条"不会到达"
    expect(JSON.parse(data[0]!).choices[0].delta.content).toBe("半");
    expect(data.at(-1)).not.toBe("[DONE]"); // 无收束——半流交付
    await partialMock.stop();
  });

  it("stall：挂起 DEFAULT_STALL_RECOVER_MS 后恢复 200（定时恢复可断言）", async () => {
    const mock = await startWith(["stall"]);
    const startedAt = Date.now();
    const res = await post(mock.url(), 5_000);
    const elapsed = Date.now() - startedAt;
    expect(res.status).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(DEFAULT_STALL_RECOVER_MS - 10);
    const data = parseSse(await res.text());
    expect(JSON.parse(data[0]!)).toMatchObject({ recovered: true });
  });
});

describe("mock-llm 服务器与 CLI 参数（O16 独立入口面）", () => {
  it("startMockLlmServer：ready baseUrl + 请求消费行为可查 + stop 干净", async () => {
    const server = await startMockLlmServer({ sequence: ["rate-limit", "server-error"] });
    try {
      expect(server.servedCount()).toBe(0);
      const res = await fetch(`${server.baseUrl}/v1/chat/completions`, {
        method: "POST",
        body: "{}",
        signal: AbortSignal.timeout(2_000),
      });
      expect(res.status).toBe(429);
      expect(server.servedCount()).toBe(1);
      expect(server.behaviorAt(0)).toBe("rate-limit");
    } finally {
      await server.stop();
    }
    await expect(post(`${server.baseUrl}/x`)).rejects.toThrow(); // 已停服
  });

  it("parseMockLlmArgs：行为闭集校验 + 未知参数拒绝 + 默认序列", () => {
    const parsed = parseMockLlmArgs(["--port", "8080", "--sequence", "rate-limit,stall,reset"]);
    expect(parsed).toEqual({ port: 8080, sequence: ["rate-limit", "stall", "reset"] });
    expect(() => parseMockLlmArgs(["--sequence", "no-such-behavior"])).toThrow(/未知行为/);
    expect(() => parseMockLlmArgs(["--bogus"])).toThrow(/未知参数/);
    expect(parseMockLlmArgs([]).sequence).toEqual([]);
  });
});
