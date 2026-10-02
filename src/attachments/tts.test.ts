/**
 * 语音合成测试（T-P3-149 D 域）——OpenAI /audio/speech 协议契约（JSON 体
 * + Bearer 头 + 音频字节回端）+ 文本/产物上限 + 错误细分 + SSRF 护栏。
 */

import { describe, expect, it } from "vitest";

import { TtsError, synthesizeText, type TtsConfig } from "./tts.js";

const CONFIG: TtsConfig = {
    baseUrl: "https://127.0.0.1/v1",
    apiKey: "sk-tts-secret",
    model: "tts-1",
};

function makeFetch(response: { status: number; body?: unknown; bytes?: Uint8Array; contentType?: string }): {
    fetchImpl: typeof fetch;
    captured: { url: string; init: RequestInit | undefined };
} {
    const captured: { url: string; init: RequestInit | undefined } = { url: "", init: undefined };
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
        captured.url = String(url);
        captured.init = init;
        if (response.bytes !== undefined) {
            return new Response(new Uint8Array(response.bytes), {
                status: response.status,
                headers: { "Content-Type": response.contentType ?? "audio/mpeg" },
            });
        }
        return new Response(JSON.stringify(response.body ?? {}), {
            status: response.status,
            headers: { "Content-Type": "application/json" },
        });
    }) as typeof fetch;
    return { fetchImpl, captured };
}

describe("synthesizeText（T-P3-149 mock fetch 往返）", () => {
    it("契约：/audio/speech JSON 体（model/voice/input/response_format）+ Bearer 头 → 音频 base64", async () => {
        const { fetchImpl, captured } = makeFetch({ status: 200, bytes: new Uint8Array([1, 2, 3, 4]) });
        const result = await synthesizeText(
            { ...CONFIG, voice: "alloy" },
            { text: "你好世界" },
            fetchImpl,
        );
        expect(result.model).toBe("tts-1");
        expect(result.mediaType).toBe("audio/mpeg");
        expect(Buffer.from(result.audioBase64, "base64")).toEqual(Buffer.from([1, 2, 3, 4]));
        expect(captured.url).toBe("https://127.0.0.1/v1/audio/speech");
        const headers = captured.init?.headers as Record<string, string>;
        expect(headers["Authorization"]).toBe("Bearer sk-tts-secret");
        const payload = JSON.parse(String(captured.init?.body)) as {
            model: string; voice?: string; input: string; response_format: string;
        };
        expect(payload.model).toBe("tts-1");
        expect(payload.voice).toBe("alloy");
        expect(payload.input).toBe("你好世界");
        expect(payload.response_format).toBe("mp3");
    });

    it("voice 缺省省略字段（provider 自选）", async () => {
        const { fetchImpl, captured } = makeFetch({ status: 200, bytes: new Uint8Array([1]) });
        await synthesizeText(CONFIG, { text: "hi" }, fetchImpl);
        const payload = JSON.parse(String(captured.init?.body)) as { voice?: string };
        expect(payload.voice).toBeUndefined();
    });

    it("空文本 / 超长文本 → TTS_TEXT_TOO_LONG 族拒绝（零 fetch）", async () => {
        const { fetchImpl } = makeFetch({ status: 200, bytes: new Uint8Array([1]) });
        await expect(synthesizeText(CONFIG, { text: "  " }, fetchImpl)).rejects.toMatchObject({
            code: "TTS_RESPONSE_INVALID",
        });
        await expect(
            synthesizeText(CONFIG, { text: "长".repeat(4001) }, fetchImpl),
        ).rejects.toMatchObject({ code: "TTS_TEXT_TOO_LONG" });
    });

    it("401 → TTS_AUTH_ERROR；404 → TTS_BAD_ENDPOINT（不含响应体原文）", async () => {
        const auth = makeFetch({ status: 401, body: { error: "secret details" } });
        const err = await synthesizeText(CONFIG, { text: "hi" }, auth.fetchImpl).catch((e: unknown) => e);
        expect((err as TtsError).code).toBe("TTS_AUTH_ERROR");
        expect((err as TtsError).message).not.toContain("secret details");
        const notFound = makeFetch({ status: 404, body: {} });
        await expect(
            synthesizeText(CONFIG, { text: "hi" }, notFound.fetchImpl),
        ).rejects.toMatchObject({ code: "TTS_BAD_ENDPOINT" });
    });

    it("非音频 content-type → TTS_RESPONSE_INVALID；空体 → 同", async () => {
        const json = makeFetch({ status: 200, body: { ok: true } });
        await expect(synthesizeText(CONFIG, { text: "hi" }, json.fetchImpl)).rejects.toMatchObject({
            code: "TTS_RESPONSE_INVALID",
        });
        const empty = makeFetch({ status: 200, bytes: new Uint8Array([]) });
        await expect(synthesizeText(CONFIG, { text: "hi" }, empty.fetchImpl)).rejects.toMatchObject({
            code: "TTS_RESPONSE_INVALID",
        });
    });

    it("超 8MiB 产物 → TTS_AUDIO_TOO_LARGE", async () => {
        const { fetchImpl } = makeFetch({ status: 200, bytes: new Uint8Array(8 * 1024 * 1024 + 1) });
        await expect(synthesizeText(CONFIG, { text: "hi" }, fetchImpl)).rejects.toMatchObject({
            code: "TTS_AUDIO_TOO_LARGE",
        });
    });

    it("元数据端点 → TTS_ENDPOINT_BLOCKED（SSRF 护栏 fail-closed）", async () => {
        const { fetchImpl } = makeFetch({ status: 200, bytes: new Uint8Array([1]) });
        await expect(
            synthesizeText({ ...CONFIG, baseUrl: "http://169.254.169.254/v1" }, { text: "hi" }, fetchImpl),
        ).rejects.toMatchObject({ code: "TTS_ENDPOINT_BLOCKED" });
    });

    it("fetch 抛 TimeoutError → TTS_TIMEOUT", async () => {
        const timeoutFetch = (async () => {
            throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
        }) as typeof fetch;
        await expect(synthesizeText(CONFIG, { text: "hi" }, timeoutFetch)).rejects.toMatchObject({
            code: "TTS_TIMEOUT",
        });
    });
});
