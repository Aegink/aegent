/**
 * 语音转写代理面测试（U26/T-P3-129）——runSttTranscribe 的配置/凭据/
 * 错误三路 + settings stt 段 parse 往返。transcribeAudio 本体的契约机验
 * 在 attachments/stt.test.ts（P4 面——本卡只测代理装配层）。
 */

import { describe, expect, it } from "vitest";

import { base64ToBytes, runSttTranscribe } from "./speech-gateway.js";
import { defaultSettings, parseSettingsShape } from "../session/settings.js";
import type { SettingsShape } from "../session/settings.js";
import type { CredentialStore } from "../session/credentials.js";

/** fake 凭据库（记录 "stt" 键的查询——凭据红线：key 不进 settings）。 */
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

/** fake fetch（OpenAI 协议 transcriptions 响应形状）。 */
function fakeFetch(response: unknown, ok = true, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(response), { status: ok ? 200 : status });
  }) as typeof fetch;
  return { impl, calls };
}

function sttSettings(overrides: Partial<NonNullable<SettingsShape["stt"]>> = {}): SettingsShape {
  return { ...defaultSettings(), stt: { baseUrl: "https://stt.example/v1", model: "whisper-1", ...overrides } };
}

describe("runSttTranscribe（U26/T-P3-129 语音转写代理）", () => {
  it("未配置端点 → 类型化 STT_NOT_CONFIGURED（零 fetch）", async () => {
    const { impl, calls } = fakeFetch({ text: "x" });
    await expect(
      runSttTranscribe(defaultSettings(), fakeCredentials(undefined), { base64: "aGk=", mediaType: "audio/webm" }, impl),
    ).rejects.toMatchObject({ code: "STT_NOT_CONFIGURED" });
    expect(calls).toHaveLength(0);
  });

  it("配置在位 → P4 transcribeAudio（URL/model/language/key 组装正确）→ text 回执", async () => {
    const { impl, calls } = fakeFetch({ text: "你好世界" });
    const credentials = fakeCredentials("sk-test-123");
    const result = await runSttTranscribe(
      sttSettings({ language: "zh" }),
      credentials,
      { base64: Buffer.from("hello").toString("base64"), mediaType: "audio/webm" },
      impl,
    );
    expect(result).toEqual({ text: "你好世界", model: "whisper-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://stt.example/v1/audio/transcriptions");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-123");
    expect(credentials.queried).toContain("stt"); // key 按 "stt" 键名走 credentials
  });

  it("音频白名单外的 mediaType → P4 类型化拒绝（STT_UNSUPPORTED_MEDIA_TYPE）", async () => {
    const { impl, calls } = fakeFetch({ text: "x" });
    await expect(
      runSttTranscribe(sttSettings(), fakeCredentials(undefined), { base64: "aGk=", mediaType: "audio/ogg" }, impl),
    ).rejects.toMatchObject({ code: "STT_UNSUPPORTED_MEDIA_TYPE" });
    expect(calls).toHaveLength(0);
  });

  it("base64ToBytes 解码往返", () => {
    const bytes = base64ToBytes(Buffer.from("audio-bytes").toString("base64"));
    expect(Buffer.from(bytes).toString("utf8")).toBe("audio-bytes");
  });
});

describe("settings stt 段（parseSettingsShape——U26 配置面）", () => {
  it("往返一致 + baseUrl/model 必填 fail-closed + language 可选", () => {
    const s = parseSettingsShape({ stt: { baseUrl: "https://stt.example/v1", model: "whisper-1", language: "zh" } });
    expect(s.stt).toEqual({ baseUrl: "https://stt.example/v1", model: "whisper-1", language: "zh" });
    expect(parseSettingsShape(JSON.parse(JSON.stringify(s))).stt).toEqual(s.stt);
    expect(() => parseSettingsShape({ stt: { model: "m" } })).toThrow(/baseUrl 缺失/);
    expect(() => parseSettingsShape({ stt: { baseUrl: "https://x" } })).toThrow(/model 缺失/);
    expect(() => parseSettingsShape({ stt: "x" })).toThrow(/stt 须为对象/);
    expect(defaultSettings().stt).toBeUndefined();
  });
});
