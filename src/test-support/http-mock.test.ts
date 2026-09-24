import { afterAll, describe, expect, it } from "vitest";

import { HttpMock, parseSse, type RecordedRequest } from "./http-mock.js";

const mocks: HttpMock[] = [];

afterAll(async () => {
  for (const mock of mocks) await mock.stop();
});

async function start(): Promise<HttpMock> {
  const mock = new HttpMock();
  mocks.push(mock);
  await mock.start();
  return mock;
}

describe("HttpMock（O2：网络边界 mock，真端口 + 真实 fetch + 脚本化 SSE）", () => {
  it("起真端口，客户端走真实 fetch 收 SSE，脚本按调用次序逐个消费", async () => {
    const mock = await start();
    mock.mountSseSequence([
      {
        events: [
          { id: "chunk-1", choices: [{ delta: { role: "assistant", content: "he" } }] },
          { id: "chunk-2", choices: [{ delta: { content: "llo" } }] },
        ],
      },
      {
        events: [{ id: "chunk-3", choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "bash", arguments: "{}" } }] } }] }],
      },
    ]);

    const first = await fetch(mock.url(), {
      method: "POST",
      headers: { authorization: "Bearer test-key" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("text/event-stream");
    const firstEvents = parseSse(await first.text());
    expect(firstEvents).toHaveLength(3); // 2 事件 + [DONE]
    expect(firstEvents[0]).toContain("chunk-1");
    expect(firstEvents.at(-1)).toBe("[DONE]");

    const second = await fetch(mock.url(), { method: "POST", body: "{}" });
    const secondEvents = parseSse(await second.text());
    expect(secondEvents[0]).toContain("tool_calls");

    expect(mock.calls).toBe(2);
  });

  it("请求多于脚本 → 500 且错误信息含调用序号（顺带断言了调用次数）", async () => {
    const mock = await start();
    mock.mountSseSequence([{ events: [{ ok: 1 }] }]);
    const ok = await fetch(mock.url(), { method: "POST", body: "{}" });
    expect(ok.status).toBe(200);

    const extra = await fetch(mock.url(), { method: "POST", body: "{}" });
    expect(extra.status).toBe(500);
    expect(await extra.json()).toMatchObject({ error: { message: /no scripted response for call #2/ } });
  });

  it("记录收到的请求（路径/头/体）供服务端断言；裸脚本出非 200 状态", async () => {
    const mock = await start();
    mock.mountSequence([{ status: 429, body: JSON.stringify({ error: { code: "rate_limited" } }) }]);

    const response = await fetch(mock.url("/v1/chat/completions?x=1"), {
      method: "POST",
      headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o" }),
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: "rate_limited" } });

    const recorded: readonly RecordedRequest[] = mock.requests();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.method).toBe("POST");
    expect(recorded[0]!.path).toBe("/v1/chat/completions?x=1");
    expect(recorded[0]!.headers.authorization).toBe("Bearer sk-test");
    expect(JSON.parse(recorded[0]!.body)).toMatchObject({ model: "gpt-4o" });
  });
});
