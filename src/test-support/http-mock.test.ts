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

describe("计数先行访问器（O13/O20，T-P1-31）", () => {
  async function withTwoCalls(): Promise<HttpMock> {
    const mock = await start();
    mock.mountSseSequence([{ events: [{ n: 1 }] }, { events: [{ n: 2 }] }]);
    for (let i = 0; i < 2; i++) {
      const res = await fetch(mock.url(), {
        method: "POST",
        body: JSON.stringify({ call: i + 1 }),
      });
      expect(res.status).toBe(200);
    }
    return mock;
  }

  it("数量对：访问器返回记录可继续断言（singleRequest / requestAt / lastRequest / expectCalls）", async () => {
    const mock = await withTwoCalls();
    const all = mock.expectCalls(2, "两次调用各消费一份剧本");
    expect(all).toHaveLength(2);
    expect(JSON.parse(mock.requestAt(0, "首请求应带 call=1").body)).toMatchObject({ call: 1 });
    expect(JSON.parse(mock.requestAt(1, "第二请求应带 call=2").body)).toMatchObject({ call: 2 });
    expect(JSON.parse(mock.lastRequest("尾请求即第二请求").body)).toMatchObject({ call: 2 });

    const solo = await start();
    solo.mountSseSequence([{ events: [{ n: 1 }] }]);
    const res = await fetch(solo.url(), { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    // singleRequest 是"恰一次"断言取值——多调用的流走 expectCalls+requestAt
    expect(solo.singleRequest("这个场景只该有一次调用").path).toBe("/v1/chat/completions");
  });

  it("数量错：错误消息含 why 原文与 expected/got（O13 可读失败原文语义）", async () => {
    const mock = await withTwoCalls();
    expect(() => mock.singleRequest("压缩后应有恰好一次 follow-up 请求")).toThrow(
      /「压缩后应有恰好一次 follow-up 请求」.*期待 1 次模型调用，实际 2 次.*expected 1, got 2/s,
    );
    expect(() => mock.expectCalls(3, "三次重试各一请求")).toThrow(
      /「三次重试各一请求」.*expected 3, got 2/s,
    );
    expect(() => mock.requestAt(5, "第六请求不存在")).toThrow(
      /「第六请求不存在」.*序号 5 越界.*实际 2 条记录/s,
    );
  });

  it("零调用：singleRequest / lastRequest 给可读失败，不返回 undefined 潜越", async () => {
    const mock = await start(); // 不挂脚本不请求
    expect(() => mock.singleRequest("还没调用就取值")).toThrow(
      /「还没调用就取值」.*实际 0 次/s,
    );
    expect(() => mock.lastRequest("零记录取尾")).toThrow(/「零记录取尾」.*实际 0 次.*没有记录可供断言/s);
  });
});
