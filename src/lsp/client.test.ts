import { describe, expect, it } from "vitest";
import {
  LspClient,
  createFrameParser,
  createMemoryTransport,
  encodeFrame,
} from "./client.js";

/** 桩 server 响应：对每个请求回一个带 id 的 result 帧 */
function stubResponses(results: unknown[]): string[] {
  return results.map((result, i) =>
    encodeFrame(JSON.stringify({ jsonrpc: "2.0", id: i + 1, result })),
  );
}

describe("LSP 分帧（createFrameParser）", () => {
  it("完整帧解析出 JSON 体", () => {
    const bodies: string[] = [];
    const parser = createFrameParser((b) => bodies.push(b));
    parser.push(encodeFrame('{"a":1}'));
    expect(bodies).toEqual(['{"a":1}']);
  });

  it("半包：分两次喂齐才吐帧；粘包：一 chunk 两帧全吐", () => {
    const bodies: string[] = [];
    const parser = createFrameParser((b) => bodies.push(b));
    const frame = encodeFrame('{"x":"y"}');
    parser.push(frame.slice(0, 10));
    expect(bodies).toHaveLength(0);
    parser.push(frame.slice(10));
    expect(bodies).toEqual(['{"x":"y"}']);
    parser.push(encodeFrame('{"a":1}') + encodeFrame('{"b":2}'));
    expect(bodies).toEqual(['{"x":"y"}', '{"a":1}', '{"b":2}']);
  });

  it("多字节 UTF-8 体按字节计长不错位", () => {
    const bodies: string[] = [];
    const parser = createFrameParser((b) => bodies.push(b));
    parser.push(encodeFrame(JSON.stringify({ text: "中文内容测试" })));
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0]!).text).toBe("中文内容测试");
  });
});

describe("LspClient（内存桩 transport）", () => {
  it("initialize 握手 + request 往返（id 配对与 result 解包）", async () => {
    const transport = createMemoryTransport(
      stubResponses([{ capabilities: {} }, [{ symbol: "foo", kind: 12 }]]),
    );
    const client = new LspClient(transport, { name: "stub" });
    await client.initialize("file:///w");
    expect(client.isInitialized).toBe(true);
    const result = await client.request("textDocument/documentSymbol", {
      textDocument: { uri: "file:///w/a.txt" },
    });
    expect(result).toEqual([{ symbol: "foo", kind: 12 }]);
    // initialize + initialized 通知 + symbol 请求 = 发出 3 帧
    expect(transport.sent).toHaveLength(3);
  });

  it("server 返回 error 帧 → 类型化失败；超时请求 → LSP_TIMEOUT 错误", async () => {
    const transport = createMemoryTransport([
      encodeFrame(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })),
      encodeFrame(
        JSON.stringify({ jsonrpc: "2.0", id: 2, error: { message: "method not found" } }),
      ),
    ]);
    const client = new LspClient(transport, { name: "stub" });
    await client.initialize("file:///w");
    await expect(client.request("no/such/method", {}, 5_000)).rejects.toThrow(
      "LSP server error: method not found",
    );
    // 无响应桩：走 20ms deadline 兜底
    await expect(client.request("slow/method", {}, 20)).rejects.toThrow("LSP_TIMEOUT");
  });

  it("server 崩溃后请求 → 未初始化判定（clientFor 消费面）", async () => {
    const transport = createMemoryTransport(stubResponses([{ capabilities: {} }]));
    const client = new LspClient(transport, { name: "stub" });
    await client.initialize("file:///w");
    transport.dispose(); // 桩上 dispose 即失联（真实 transport 走 onFail）
    client.dispose();
    expect(client.isInitialized).toBe(false);
  });
});
