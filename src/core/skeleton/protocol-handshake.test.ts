import { describe, expect, it } from "vitest";

import {
  decodeClientHello,
  decodeServerHello,
  PROTOCOL_VERSION,
  ProtocolHandshakeError,
} from "./protocol.js";

describe("EP-9 协议版本握手（T1-3，pi 形状）", () => {
  it("decodeClientHello：合法 hello 解析；非 hello / 坏形状 / 坏版本号类型化拒绝", () => {
    expect(decodeClientHello('{"type":"hello","protocolVersion":1}')).toEqual({
      type: "hello",
      protocolVersion: 1,
    });
    // 首帧不是 hello（旧版子进程直接发业务帧）→ PROTOCOL_HELLO_MISSING
    try {
      decodeClientHello('{"type":"ready"}');
      expect.fail("应抛握手错误");
    } catch (e) {
      expect((e as ProtocolHandshakeError).code).toBe("PROTOCOL_HELLO_MISSING");
    }
    // 坏形状：非 JSON / 非正整数版本
    expect(() => decodeClientHello("not-json")).toThrow(ProtocolHandshakeError);
    try {
      decodeClientHello('{"type":"hello","protocolVersion":"1"}');
      expect.fail("应抛握手错误");
    } catch (e) {
      expect((e as ProtocolHandshakeError).code).toBe("PROTOCOL_HELLO_MALFORMED");
    }
  });

  it("decodeServerHello：匹配版本通过；不匹配 → PROTOCOL_VERSION_MISMATCH 带 expected/received", () => {
    expect(decodeServerHello('{"type":"hello-ack","protocolVersion":1}')).toEqual({
      type: "hello-ack",
      protocolVersion: 1,
    });
    try {
      decodeServerHello('{"type":"hello-ack","protocolVersion":999}');
      expect.fail("应抛版本不匹配");
    } catch (e) {
      const hse = e as ProtocolHandshakeError;
      expect(hse.code).toBe("PROTOCOL_VERSION_MISMATCH");
      expect(hse.expected).toBe(PROTOCOL_VERSION);
      expect(hse.received).toBe(999);
    }
    // 非 hello-ack 形状
    expect(() => decodeServerHello('{"type":"prompt"}')).toThrow(ProtocolHandshakeError);
  });
});
