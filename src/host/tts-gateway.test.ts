/**
 * 语音合成代理面测试（T-P3-149 D）——runTtsSynthesize 的配置/凭据/错误三路
 * + settings tts 段 parse 往返（parse 面细节在 speech-gateway.test.ts 的
 * stt 段同型用例——本卡只测代理装配层与 tts 段 fail-closed）。
 */

import { describe, expect, it } from "vitest";

import { runTtsSynthesize } from "./tts-gateway.js";
import { defaultSettings, parseSettingsShape } from "../session/settings.js";
import type { SettingsShape } from "../session/settings.js";
import type { CredentialStore } from "../session/credentials.js";

function fakeCredentials(key: string | undefined): CredentialStore & { queried: string[] } {
  return {
    queried: [],
    async setKey(name: string) {
      this.queried.push(name);
    },
    async getKey(name: string) {
      this.queried.push(name);
      return key;
    },
    async deleteKey() {
      return true;
    },
    async listKeys() {
      return [];
    },
  };
}

function fakeFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    });
  }) as typeof fetch;
  return { impl, calls };
}

function ttsSettings(overrides: Partial<NonNullable<SettingsShape["tts"]>> = {}): SettingsShape {
  return { ...defaultSettings(), tts: { baseUrl: "https://127.0.0.1/v1", model: "tts-1", ...overrides } };
}

describe("runTtsSynthesize（T-P3-149 语音合成代理）", () => {
  it("未配置端点 → 类型化 TTS_NOT_CONFIGURED（零 fetch）", async () => {
    const { impl, calls } = fakeFetch();
    await expect(
      runTtsSynthesize(defaultSettings(), fakeCredentials(undefined), { text: "hi" }, impl),
    ).rejects.toMatchObject({ code: "TTS_NOT_CONFIGURED" });
    expect(calls).toHaveLength(0);
  });

  it("配置在位 → synthesizeText（key 按 tts 键名走 credentials + voice 透传）", async () => {
    const { impl, calls } = fakeFetch();
    const credentials = fakeCredentials("sk-tts-123");
    const result = await runTtsSynthesize(
      ttsSettings({ voice: "nova" }),
      credentials,
      { text: "测试" },
      impl,
    );
    expect(result).toEqual({ audioBase64: Buffer.from([1, 2, 3]).toString("base64"), mediaType: "audio/mpeg", model: "tts-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://127.0.0.1/v1/audio/speech");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-tts-123");
    expect(credentials.queried).toContain("tts");
    const payload = JSON.parse(String(calls[0]!.init?.body)) as { voice?: string };
    expect(payload.voice).toBe("nova");
  });
});

describe("settings tts 段（parseSettingsShape——fail-closed）", () => {
  it("往返一致 + baseUrl/model 必填 + voice 可选", () => {
    const s = parseSettingsShape({ tts: { baseUrl: "https://127.0.0.1/v1", model: "tts-1", voice: "alloy" } });
    expect(s.tts).toEqual({ baseUrl: "https://127.0.0.1/v1", model: "tts-1", voice: "alloy" });
    expect(parseSettingsShape(JSON.parse(JSON.stringify(s))).tts).toEqual(s.tts);
    expect(() => parseSettingsShape({ tts: { model: "m" } })).toThrow(/baseUrl 缺失/);
    expect(() => parseSettingsShape({ tts: { baseUrl: "https://x" } })).toThrow(/model 缺失/);
    expect(() => parseSettingsShape({ tts: "x" })).toThrow(/tts 须为对象/);
    expect(defaultSettings().tts).toBeUndefined();
  });
});
