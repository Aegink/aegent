/**
 * Google Generative AI 适配 wire 测试（T-P3-137）——mock SSE 流验证
 * StreamChunk 映射契约：text/thought/functionCall/usageMetadata/
 * finishReason → text-delta/reasoning-delta/tool-call-delta/usage/done。
 * 形状同 openai-compat.test 的 http-mock 先例。
 */

import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createGoogleGenerateProvider } from "./google-generate.js";
import type { StreamChunk } from "../kernel/events.js";

const servers: Server[] = [];
const buffers: string[] = [];

afterEach(() => {
  while (servers.length > 0) servers.pop()?.close();
  buffers.length = 0;
});

function startGoogleMock(frames: unknown[]): Promise<number> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      buffers.push(raw);
      res.setHeader("content-type", "text/event-stream");
      for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`);
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      servers.push(server);
      resolve((server.address() as { port: number }).port);
    });
  });
}

describe("google-generate 适配（T-P3-137）", () => {
  it("SSE 帧 → text-delta/reasoning-delta/usage/done（finishReason 帧间携带）", async () => {
    const port = await startGoogleMock([
      {
        candidates: [{ content: { parts: [{ text: "你" }] } }],
      },
      {
        candidates: [{ content: { parts: [{ text: "好", thought: true }] } }],
      },
      {
        candidates: [{ content: { parts: [{ text: "！" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      },
    ]);
    const provider = createGoogleGenerateProvider({
      name: "g",
      settingsConfig: JSON.stringify({ baseUrl: `http://127.0.0.1:${port}`, apiKey: "k" }),
    });
    const chunks: StreamChunk[] = [];
    for await (const c of provider.streamChat({
      identity: { provider: "google", modelId: "gemini-x" },
      messages: [{ role: "user", content: "你好" }],
    })) {
      chunks.push(c);
    }
    expect(chunks.some((c) => c.type === "text-delta" && c.text === "你")).toBe(true);
    expect(chunks.some((c) => c.type === "reasoning-delta" && c.text === "好")).toBe(true);
    expect(chunks.some((c) => c.type === "text-delta" && c.text === "！")).toBe(true);
    const usage = chunks.find((c) => c.type === "usage");
    expect(usage).toMatchObject({ usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
    const done = chunks.find((c) => c.type === "done");
    expect(done).toMatchObject({ type: "done", finishReason: "STOP" });
    // wire 形状断言：contents/alt=sse/key 查询参数
    expect(buffers[0]).toContain('"contents"');
  });

  it("system 收拢 systemInstruction + tools 映射 functionDeclarations + functionCall → tool-call-delta", async () => {
    const port = await startGoogleMock([
      {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "read_file", args: { path: "/a" } } }],
            },
            finishReason: "STOP",
          },
        ],
      },
    ]);
    const provider = createGoogleGenerateProvider({
      name: "g",
      settingsConfig: JSON.stringify({ baseUrl: `http://127.0.0.1:${port}`, apiKey: "k" }),
    });
    const chunks: StreamChunk[] = [];
    for await (const c of provider.streamChat({
      identity: { provider: "google", modelId: "gemini-x" },
      messages: [
        { role: "system", content: "规矩" },
        { role: "user", content: "读文件" },
      ],
      tools: [{ name: "read_file", description: "读", parameters: { type: "object" } }],
    })) {
      chunks.push(c);
    }
    const call = chunks.find((c) => c.type === "tool-call-delta");
    expect(call).toMatchObject({ type: "tool-call-delta", name: "read_file" });
    expect(JSON.parse((call as { argsDelta: string }).argsDelta)).toEqual({ path: "/a" });
    const wireText = JSON.stringify(JSON.parse(buffers[0]!));
    expect(wireText).toContain('"systemInstruction"');
    expect(wireText).toContain('"functionDeclarations"');
    expect(wireText).toContain("read_file");
    // tool 回传帧的 name 回溯（callId → call_N → name）
    const callId = (call as { id: string }).id;
    const toolRound: StreamChunk[] = [];
    for await (const c of provider.streamChat({
      identity: { provider: "google", modelId: "gemini-x" },
      messages: [
        { role: "user", content: "读文件" },
        { role: "assistant", content: "", toolCalls: [{ id: callId, name: "read_file", arguments: "{}" }] },
        { role: "tool", callId, content: "文件内容" },
      ],
    })) {
      toolRound.push(c);
    }
    const wire2Text = JSON.stringify(JSON.parse(buffers[1]!));
    expect(wire2Text).toContain('"functionResponse"');
    expect(wire2Text).toContain("read_file");
    expect(toolRound.some((c) => c.type === "done")).toBe(true);
  });
});
