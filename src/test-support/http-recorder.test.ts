/**
 * HTTP 级录制测试（L5/T-P2-514）——录制往返 + 掩码断言 + 回放生成。
 * 开关语义：env 未设置 = 零包装（生产缺省关）。
 */

import { describe, expect, it } from "vitest";

import { HttpMock } from "./http-mock.js";
import {
  AUTH_MASK,
  HTTP_RECORD_ENV,
  HttpRecorder,
  parseRecorded,
  serializeRecorded,
  toHttpMockScripts,
} from "./http-recorder.js";

describe("HTTP 级录制（L5）", () => {
  it("录制往返：请求/响应成对记录，SSE 体完整；restore 恢复原 fetch", async () => {
    const mock = new HttpMock();
    const baseUrl = await mock.start();
    try {
      mock.mountSseSequence([
        { events: [{ id: "chatcmpl-1", choices: [{ delta: { content: "hi" } }] }] },
      ]);
      const env: NodeJS.ProcessEnv = { [HTTP_RECORD_ENV]: "1" };
      const recorder = new HttpRecorder(env);
      expect(recorder.install()).toBe(true);

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-token" },
        body: JSON.stringify({ model: "gpt-x", messages: [{ role: "user", content: "hello" }] }),
      });
      await res.text();
      recorder.restore();

      const entries = recorder.entries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ method: "POST", status: 200 });
      expect(entries[0]!.requestBody).toContain("hello");
      expect(entries[0]!.responseBody).toContain("data: ");
    } finally {
      await mock.stop();
    }
  });

  it("掩码断言：authorization 整值掩码、sk- 密钥过 redactSecrets；JSONL roundtrip 保持掩码", async () => {
    const mock = new HttpMock();
    const baseUrl = await mock.start();
    try {
      mock.mountSequence([{ status: 200, body: '{"ok":true}' }]);
      const recorder = new HttpRecorder({ [HTTP_RECORD_ENV]: "1" });
      recorder.install();
      await fetch(`${baseUrl}/v1/x`, {
        method: "POST",
        headers: { authorization: "Bearer super-secret-token" },
        body: JSON.stringify({ apiKey: "sk-abcdefghij1234567890abcd", q: 1 }),
      }).then((r) => r.text());
      recorder.restore();

      const [entry] = recorder.entries();
      expect(entry!.requestHeaders["authorization"]).toBe(AUTH_MASK);
      expect(entry!.requestBody).not.toContain("sk-abcdefghij1234567890abcd");
      expect(entry!.requestBody).toContain("[REDACTED:api-key]");
      // JSONL roundtrip：掩码固化在录制物里（入库即掩码）
      const roundtrip = parseRecorded(serializeRecorded(recorder.entries()));
      expect(roundtrip[0]!.requestHeaders["authorization"]).toBe(AUTH_MASK);
      expect(roundtrip[0]!.requestBody).toContain("[REDACTED:api-key]");
    } finally {
      await mock.stop();
    }
  });

  it("回放生成：SSE 录制 → SseScript（不二次追加 DONE）、裸响应 → RawScript", async () => {
    const mock = new HttpMock();
    const baseUrl = await mock.start();
    try {
      mock.mountSseSequence([{ events: [{ delta: { content: "a" } }, { delta: { content: "b" } }] }]);
      mock.mountSequence([{ status: 429, body: "rate limited" }]);
      const recorder = new HttpRecorder({ [HTTP_RECORD_ENV]: "1" });
      recorder.install();
      const s1 = await fetch(`${baseUrl}/sse`);
      await s1.text();
      const s2 = await fetch(`${baseUrl}/plain`);
      await s2.text();
      recorder.restore();

      const scripts = toHttpMockScripts(recorder.entries());
      expect(scripts).toHaveLength(2);
      expect(scripts[0]).toMatchObject({ events: ['{"delta":{"content":"a"}}', '{"delta":{"content":"b"}}'], includeDone: false });
      expect(scripts[1]).toMatchObject({ status: 429, body: "rate limited" });
    } finally {
      await mock.stop();
    }
  });

  it("录制开关：env 未设置 = 零包装（生产缺省关）", async () => {
    const recorder = new HttpRecorder({});
    expect(recorder.install()).toBe(false);
    expect(recorder.entries()).toHaveLength(0);
    // 全局 fetch 未被替换——restore 幂等零副作用
    const original = globalThis.fetch;
    recorder.restore();
    expect(globalThis.fetch).toBe(original);
  });
});
