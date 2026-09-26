import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertJsonSafe, type StreamChunk } from "../kernel/events.js";
import { parseProviderConfig, ProviderConfigError } from "./config.js";
import { createOpenAiCompatProvider, parseOpenAiCompatSettings } from "./openai-compat.js";
import { ProviderHttpError, type ChatRequest, type ModelProvider } from "./provider.js";
import { modelIdentity } from "./identity.js";
import { HttpMock } from "../test-support/http-mock.js";

/** OpenAI chat.completion.chunk 的最简 wire 形状。 */
function wireChunk(delta: object, extra: object = {}): object {
  return {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-test",
    choices: [{ index: 0, delta, finish_reason: null }],
    ...extra,
  };
}

async function collect(provider: ModelProvider, req: ChatRequest): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of provider.streamChat(req)) out.push(c);
  return out;
}

describe("openai-compat 流式适配 —— J1/J2", () => {
  let mock: HttpMock;

  beforeEach(async () => {
    mock = new HttpMock();
    await mock.start();
  });
  afterEach(async () => {
    await mock.stop();
  });

  function makeProvider(): ModelProvider {
    return createOpenAiCompatProvider(
      parseProviderConfig({
        name: "mock",
        settingsConfig: JSON.stringify({ baseUrl: mock.url("/v1"), apiKey: "sk-test" }),
      }),
    );
  }

  function makeReq(messages?: ChatRequest["messages"]): ChatRequest {
    return {
      identity: modelIdentity("mock", "gpt-test"),
      messages: messages ?? [{ role: "user", content: "hi" }],
    };
  }

  it("脚本化三段剧本（reasoning+text / tool_call 分片 / usage）逐个到达且不丢不重", async () => {
    mock.mountSseSequence([
      {
        events: [
          wireChunk({ reasoning_content: "想一想" }),
          wireChunk({ content: "你好" }),
          wireChunk({ content: "，我要读文件" }),
          wireChunk({
            tool_calls: [
              { index: 0, id: "call_1", type: "function", function: { name: "read", arguments: '{"path":' } },
            ],
          }),
          // OpenAI 分片规则：后续片只带 index+arguments 增量，无 id/name
          wireChunk({ tool_calls: [{ index: 0, function: { arguments: ' "/x"}' } }] }),
          // usage 终块：choices 为空、usage 对象随行
          {
            id: "chatcmpl-1",
            object: "chat.completion.chunk",
            created: 1,
            model: "gpt-test",
            choices: [],
            usage: {
              prompt_tokens: 9,
              completion_tokens: 4,
              total_tokens: 13,
              prompt_tokens_details: { cached_tokens: 5 },
              completion_tokens_details: { reasoning_tokens: 2 },
            },
          },
        ],
      },
    ]);

    const chunks = await collect(makeProvider(), makeReq());

    expect(chunks.map((c) => c.type)).toEqual([
      "reasoning-delta",
      "text-delta",
      "text-delta",
      "tool-call-delta",
      "tool-call-delta",
      "usage",
      "done",
    ]);
    // 增量不丢不重：text 与 args 拼接恢复全文，args 还是合法 JSON
    const text = chunks
      .filter((c): c is Extract<StreamChunk, { type: "text-delta" }> => c.type === "text-delta")
      .map((c) => c.text)
      .join("");
    expect(text).toBe("你好，我要读文件");
    const toolArgs = chunks
      .filter((c): c is Extract<StreamChunk, { type: "tool-call-delta" }> => c.type === "tool-call-delta")
      .map((c) => c.argsDelta)
      .join("");
    expect(JSON.parse(toolArgs)).toEqual({ path: "/x" });
    // 后续分片的 id 由适配层按 index 补回
    const toolChunks = chunks.filter(
      (c): c is Extract<StreamChunk, { type: "tool-call-delta" }> => c.type === "tool-call-delta",
    );
    expect(toolChunks.map((c) => c.id)).toEqual(["call_1", "call_1"]);
    expect(toolChunks[0]?.name).toBe("read");
    expect(toolChunks[1]?.name).toBeUndefined();
    // usage 进事件载荷：形状即词汇表 TokenUsage（阶段 3 loop 原样落 assistant/message.usage）
    const usageChunk = chunks.find(
      (c): c is Extract<StreamChunk, { type: "usage" }> => c.type === "usage",
    );
    expect(usageChunk?.usage).toEqual({
      inputTokens: 9,
      outputTokens: 4,
      totalTokens: 13,
      cacheReadTokens: 5,
      reasoningTokens: 2,
    });
    expect(() => assertJsonSafe(usageChunk)).not.toThrow(); // C14：可落事件
  });

  it("请求形状：endpoint/鉴权头/model/stream_options 与消息映射正确", async () => {
    mock.mountSseSequence([{ events: [wireChunk({ content: "ok" })] }]);
    await collect(
      makeProvider(),
      makeReq([
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "read", arguments: '{"path":"/x"}' }],
        },
        { role: "tool", callId: "call_9", content: "file content" },
      ]),
    );

    // O13/O20 示范迁移（T-P1-31）：裸下标访问改带说明的计数先行访问器
    const recorded = mock.requestAt(0, "请求形状测试恰发一次模型调用");
    expect(recorded.path).toBe("/v1/chat/completions");
    expect(recorded.headers["authorization"]).toBe("Bearer sk-test");
    const body = JSON.parse(recorded.body) as {
      [key: string]: unknown;
      messages: { [key: string]: unknown }[];
    };
    expect(body["model"]).toBe("gpt-test");
    expect(body["stream"]).toBe(true);
    expect(body["stream_options"]).toEqual({ include_usage: true });
    expect(body.messages[1]?.["tool_calls"]).toEqual([
      { id: "call_1", type: "function", function: { name: "read", arguments: '{"path":"/x"}' } },
    ]);
    expect(body.messages[1]?.["content"]).toBeNull(); // 空正文+tool_calls → content:null
    expect(body.messages[2]).toEqual({ role: "tool", tool_call_id: "call_9", content: "file content" });
  });

  it("非 2xx 在响应头阶段抛 ProviderHttpError，status 与 Retry-After 透传", async () => {
    mock.mountSequence([
      {
        status: 429,
        headers: { "retry-after": "2" },
        body: JSON.stringify({ error: { message: "rate limited" } }),
      },
    ]);
    const err = await collect(makeProvider(), makeReq()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ProviderHttpError);
    const httpErr = err as ProviderHttpError;
    expect(httpErr.status).toBe(429);
    expect(httpErr.retryAfter).toBe("2");
    expect(httpErr.message).toContain("rate limited");
  });

  it("无 usage 剧本：不产 usage 块，[DONE] 仍收束为 done", async () => {
    mock.mountSseSequence([{ events: [wireChunk({ content: "only text" })] }]);
    const chunks = await collect(makeProvider(), makeReq());
    expect(chunks.map((c) => c.type)).toEqual(["text-delta", "done"]);
  });

  it("适配层配置缺 baseUrl/apiKey 在构造期即拒绝", () => {
    expect(() =>
      parseOpenAiCompatSettings(parseProviderConfig({ name: "x", settingsConfig: '{"apiKey":"k"}' })),
    ).toThrow(ProviderConfigError);
    expect(() =>
      parseOpenAiCompatSettings(
        parseProviderConfig({ name: "x", settingsConfig: '{"baseUrl":"https://x"}' }),
      ),
    ).toThrow(ProviderConfigError);
  });
});
