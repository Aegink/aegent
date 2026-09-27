import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HttpMock } from "../test-support/http-mock.js";
import { parseProviderConfig } from "./config.js";
import { ProviderHttpError } from "./provider.js";
import {
  createAnthropicMessagesProvider,
  parseAnthropicSettings,
} from "./anthropic-messages.js";
import type { ChatRequest, ModelProvider } from "./provider.js";
import type { StreamChunk } from "../kernel/events.js";
import { modelIdentity } from "./identity.js";

function makeProvider(mock: HttpMock, options?: { authResolver?: never }): ModelProvider {
  return createAnthropicMessagesProvider(
    parseProviderConfig({
      name: "anthropic",
      settingsConfig: JSON.stringify({ baseUrl: mock.url(""), apiKey: "sk-ant-test" }),
    }),
    options,
  );
}

function makeReq(messages?: ChatRequest["messages"]): ChatRequest {
  return {
    identity: modelIdentity("anthropic", "claude-test"),
    messages: messages ?? [{ role: "user", content: "hi" }],
  };
}

async function collect(provider: ModelProvider, req: ChatRequest): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of provider.streamChat(req)) out.push(chunk);
  return out;
}

/** Anthropic SSE 帧（data.type 闭集——event: 行缺省由 data.type 兜底）。 */
const anthropicEvents = {
  messageStart: {
    type: "message_start",
    message: {
      usage: { input_tokens: 25, output_tokens: 1, cache_read_input_tokens: 10 },
    },
  },
  blockStart: (index: number, block: Record<string, unknown>) => ({
    type: "content_block_start",
    index,
    content_block: block,
  }),
  textDelta: (index: number, text: string) => ({
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text },
  }),
  thinkingDelta: (index: number, thinking: string) => ({
    type: "content_block_delta",
    index,
    delta: { type: "thinking_delta", thinking },
  }),
  jsonDelta: (index: number, partialJson: string) => ({
    type: "content_block_delta",
    index,
    delta: { type: "input_json_delta", partial_json: partialJson },
  }),
  blockStop: (index: number) => ({ type: "content_block_stop", index }),
  messageDelta: (outputTokens: number) => ({
    type: "message_delta",
    delta: { stop_reason: "end_turn" },
    usage: { output_tokens: outputTokens },
  }),
  messageStop: { type: "message_stop" },
};

describe("anthropic-messages 流式适配 —— J5/T-P1-108", () => {
  let mock: HttpMock;

  beforeEach(async () => {
    mock = new HttpMock();
    await mock.start();
  });
  afterEach(async () => {
    await mock.stop();
  });

  it("文本/思考/工具块三类增量映射（block index 聚合）", async () => {
    mock.mountSseSequence([
      {
        includeDone: false,
        events: [
          anthropicEvents.messageStart,
          anthropicEvents.blockStart(0, { type: "thinking" }),
          anthropicEvents.thinkingDelta(0, "想一想"),
          anthropicEvents.blockStop(0),
          anthropicEvents.blockStart(1, { type: "text" }),
          anthropicEvents.textDelta(1, "你好"),
          anthropicEvents.textDelta(1, "，读文件"),
          anthropicEvents.blockStop(1),
          anthropicEvents.blockStart(2, { type: "tool_use", id: "toolu_1", name: "read" }),
          anthropicEvents.jsonDelta(2, '{"path":'),
          anthropicEvents.jsonDelta(2, ' "/x"}'),
          anthropicEvents.blockStop(2),
          anthropicEvents.messageDelta(7),
          anthropicEvents.messageStop,
        ],
      },
    ]);
    const chunks = await collect(makeProvider(mock), makeReq());
    const kinds = chunks.map((c) => c.type);
    expect(kinds).toEqual([
      "reasoning-delta",
      "text-delta",
      "text-delta",
      "tool-call-delta",
      "tool-call-delta",
      "usage",
      "done",
    ]);
    const toolChunks = chunks.filter((c) => c.type === "tool-call-delta") as Array<
      Extract<StreamChunk, { type: "tool-call-delta" }>
    >;
    expect(toolChunks[0]).toMatchObject({ id: "toolu_1", name: "read", argsDelta: '{"path":' });
    expect(toolChunks[1]).toMatchObject({ id: "toolu_1", argsDelta: ' "/x"}' });
  });

  it("usage 累积（message_start 起始 + message_delta 累计覆盖）+ cache_read", async () => {
    mock.mountSseSequence([
      {
        includeDone: false,
        events: [
          anthropicEvents.messageStart,
          anthropicEvents.blockStart(0, { type: "text" }),
          anthropicEvents.textDelta(0, "hi"),
          anthropicEvents.blockStop(0),
          anthropicEvents.messageDelta(7),
          anthropicEvents.messageStop,
        ],
      },
    ]);
    const chunks = await collect(makeProvider(mock), makeReq());
    const usage = chunks.find((c) => c.type === "usage") as Extract<StreamChunk, { type: "usage" }>;
    // input=25（message_start）、output=7（message_delta 累计覆盖而非相加——
    // pi-mono "both overwrite `output.usage`" 纪律）、cache_read=10
    expect(usage.usage).toEqual({
      inputTokens: 25,
      outputTokens: 7,
      cacheReadTokens: 10,
      totalTokens: 32,
    });
  });

  it("第二轮请求 wire 断言：system 顶层 + tool_use/tool_result 块（历史往返不丢）", async () => {
    mock.mountSseSequence([
      {
        includeDone: false,
        events: [
          anthropicEvents.messageStart,
          anthropicEvents.blockStart(0, { type: "text" }),
          anthropicEvents.textDelta(0, "ok"),
          anthropicEvents.blockStop(0),
          anthropicEvents.messageDelta(1),
          anthropicEvents.messageStop,
        ],
      },
    ]);
    const provider = makeProvider(mock);
    await collect(provider, makeReq([
      { role: "system", content: "你是助手" },
      { role: "user", content: "读一下" },
      { role: "assistant", content: "", toolCalls: [{ id: "toolu_1", name: "read", arguments: '{"path":"/x"}' }] },
      { role: "tool", callId: "toolu_1", content: "文件内容", isError: true },
    ]));
    const recorded = mock.requests()[0]!;
    const body = JSON.parse(recorded.body) as Record<string, unknown>;
    expect(body["system"]).toBe("你是助手"); // 顶层 system 字段
    expect(body["max_tokens"]).toBe(8192); // 缺省 max_tokens 必填
    const messages = body["messages"] as Array<{ role: string; content: unknown }>;
    const assistant = messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toEqual([
      { type: "tool_use", id: "toolu_1", name: "read", input: { path: "/x" } },
    ]);
    const toolResult = messages.find((m) => m.role === "user" && Array.isArray(m.content))!;
    expect(toolResult.content).toEqual([
      { type: "tool_result", tool_use_id: "toolu_1", content: "文件内容", is_error: true },
    ]);
    expect(recorded.headers["x-api-key"]).toBe("sk-ant-test");
    expect(recorded.headers["anthropic-version"]).toBe("2023-06-01");
    expect(recorded.path).toBe("/v1/messages");
  });

  it("流中 error 事件帧 → 类型化抛出（T-P1-102 预留 blocked 判据的真实面）", async () => {
    mock.mountSseSequence([
      {
        includeDone: false,
        events: [
          anthropicEvents.messageStart,
          { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
        ],
      },
    ]);
    await expect(collect(makeProvider(mock), makeReq())).rejects.toThrowError(
      expect.objectContaining({ code: "MODEL_HTTP_ERROR" }),
    );
    await expect(collect(makeProvider(mock), makeReq())).rejects.toThrowError(/no scripted response/);
  });

  it("流提前结束（未见 message_stop、正常 EOF）→ 兜底抛出", async () => {
    // 正常结束的流但缺 message_stop（wire 契约破坏——pi-mono "stream ended
    // before message_stop" 兜底面）。
    const frames = [
      anthropicEvents.messageStart,
      anthropicEvents.blockStart(0, { type: "text" }),
      anthropicEvents.textDelta(0, "半截"),
    ]
      .map((e) => `data: ${JSON.stringify(e)}

`)
      .join("");
    mock.mountSequence([
      { status: 200, headers: { "content-type": "text/event-stream" }, body: frames },
    ]);
    await expect(collect(makeProvider(mock), makeReq())).rejects.toThrowError(/message_stop 之前结束/);
  });

  it("非 2xx 响应头阶段 → ProviderHttpError（J26 重试层消费）", async () => {
    mock.mountSequence([{ status: 429, body: JSON.stringify({ error: { message: "rate limited" } }) }]);
    await expect(collect(makeProvider(mock), makeReq())).rejects.toMatchObject({
      code: "MODEL_HTTP_ERROR",
      status: 429,
    });
  });

  it("适配层配置缺 baseUrl/apiKey 在构造期即拒绝", () => {
    expect(() =>
      parseAnthropicSettings(parseProviderConfig({ name: "x", settingsConfig: '{"baseUrl":"https://x"}' })),
    ).toThrowError(/apiKey/);
    expect(() =>
      parseAnthropicSettings(parseProviderConfig({ name: "x", settingsConfig: '{"apiKey":"k"}' })),
    ).toThrowError(/baseUrl/);
  });

  it("catalog 声明行兜底：anthropic 声明身份在 discovery 失败时仍在位", async () => {
    const { buildModelCatalog } = await import("./catalog.js");
    const rows = await buildModelCatalog({
      declared: [modelIdentity("anthropic", "claude-sonnet-4-5"), modelIdentity("openai", "gpt-test")],
      discover: async () => {
        throw new Error("no /models route");
      },
    });
    const anthropicRows = rows.filter((r) => r.identity.provider === "anthropic");
    expect(anthropicRows).toHaveLength(1);
    expect(anthropicRows[0]!.source).toBe("declared");
  });
});


describe("anthropic 图片映射（P1/T-P1-124）", () => {
  let mock: HttpMock;
  beforeEach(async () => {
    mock = new HttpMock();
    await mock.start();
  });
  afterEach(async () => {
    await mock.stop();
  });

  it("user images → content blocks（text + image source base64）", async () => {
    mock.mountSseSequence([
      {
        events: [
          anthropicEvents.messageStart,
          anthropicEvents.textDelta(0, "ok"),
          anthropicEvents.messageDelta(1),
          anthropicEvents.messageStop,
        ],
      },
    ]);
    const provider = makeProvider(mock);
    await collect(provider, makeReq([
      {
        role: "user",
        content: "看图",
        images: [{ mediaType: "image/png", data: "AAAA" }],
      },
    ]));
    const recorded = mock.requestAt(0, "图片映射测试恰发一次模型调用");
    const body = JSON.parse(recorded.body) as { messages: { content: unknown }[] };
    expect(body.messages[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "看图" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      ],
    });
  });
});
