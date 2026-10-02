/**
 * 端点安全护栏测试（T-P3-149 C2）——协议闭集 / 凭据内嵌拒绝 / 元数据段
 * 硬拦 / 环回与私网放行（本地优先场景）/ DNS 复核（mock lookup）。
 */

import { describe, expect, it, vi } from "vitest";

import { EndpointBlockedError, assertEndpointAllowed, type LookupFn } from "./endpoint-guard.js";

const CODE = { code: "STT_ENDPOINT_BLOCKED" };

describe("assertEndpointAllowed（T-P3-149 端点护栏）", () => {
  it("合法 https 端点放行", async () => {
    await expect(assertEndpointAllowed("https://api.openai.com/v1", CODE)).resolves.toBeUndefined();
  });

  it("非 http(s) 协议拒绝（ftp/file）", async () => {
    await expect(assertEndpointAllowed("ftp://example.com/audio", CODE)).rejects.toThrow(EndpointBlockedError);
    await expect(assertEndpointAllowed("file:///etc/passwd", CODE)).rejects.toThrow(EndpointBlockedError);
  });

  it("内嵌凭据拒绝（防 key 借 URL 泄露）", async () => {
    await expect(
      assertEndpointAllowed("https://user:pass@example.com/v1", CODE),
    ).rejects.toThrow(EndpointBlockedError);
  });

  it("云元数据地址硬拦（169.254.169.254 / 100.100.100.200 / 169.254 段）", async () => {
    for (const host of ["169.254.169.254", "100.100.100.200", "169.254.1.1"]) {
      await expect(
        assertEndpointAllowed(`https://${host}/v1`, CODE),
      ).rejects.toThrow(EndpointBlockedError);
    }
  });

  it("环回与私网端点放行（本地优先合法场景——局域网 whisper 网关）", async () => {
    for (const url of [
      "http://localhost:9000/v1",
      "http://127.0.0.1:9000/v1",
      "https://192.168.1.5:9000/v1",
      "https://10.0.0.2/v1",
    ]) {
      await expect(assertEndpointAllowed(url, CODE)).resolves.toBeUndefined();
    }
  });

  it("非法 URL 拒绝", async () => {
    await expect(assertEndpointAllowed("not-a-url", CODE)).rejects.toThrow(EndpointBlockedError);
  });

  it("域名解析到元数据段拒绝（DNS rebinding 第一道）", async () => {
    const evilLookup: LookupFn = async () => [{ address: "169.254.169.254", family: 4 }];
    await expect(
      assertEndpointAllowed("https://evil.example.com/v1", { ...CODE, lookupImpl: evilLookup }),
    ).rejects.toThrow(EndpointBlockedError);
  });

  it("域名解析到公网地址放行", async () => {
    const okLookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
    await expect(
      assertEndpointAllowed("https://api.example.com/v1", { ...CODE, lookupImpl: okLookup }),
    ).resolves.toBeUndefined();
  });
});
