/**
 * P4 语音转文字测试（T-P2-406）——类型白名单（音频三类入册）+ STT mock
 * 往返（multipart 契约 + Bearer 头 + 错误面）+ 投影文本断言（转写文本进
 * 模型请求占位行）。
 */

import { describe, expect, it } from "vitest";

import {
    ALLOWED_MEDIA_TYPES,
    AUDIO_MEDIA_TYPES,
    AttachmentLimitError,
    validateAttachments,
} from "./limits.js";
import { SttError, transcribeAudio, type SttConfig } from "./stt.js";
import { InMemoryAttachmentStore } from "./store.js";
import { buildChatMessages } from "../session/messages.js";

const CONFIG: SttConfig = {
    baseUrl: "https://127.0.0.1/v1",
    apiKey: "sk-test-secret",
    model: "whisper-1",
};

describe("音频类型白名单（limits.ts 扩展）", () => {
    it("音频三类入册（audio/mp4|wav|webm）", () => {
        expect([...AUDIO_MEDIA_TYPES]).toEqual(["audio/mp4", "audio/wav", "audio/webm"]);
        expect([...ALLOWED_MEDIA_TYPES]).toEqual([
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "audio/mp4",
            "audio/wav",
            "audio/webm",
        ]);
    });

    it("音频附件过限额校验（存储面契约）", () => {
        expect(() =>
            validateAttachments([{ mediaType: "audio/wav", byteLength: 1000 }]),
        ).not.toThrow();
        // 非白名单媒体仍拒绝
        expect(() =>
            validateAttachments([{ mediaType: "audio/flac", byteLength: 1000 }]),
        ).toThrow(AttachmentLimitError);
    });
});

describe("transcribeAudio（mock fetch 往返）", () => {
    function makeFetch(response: { status: number; body: unknown }): {
        fetchImpl: typeof fetch;
        captured: { url: string; init: RequestInit | undefined };
    } {
        const captured: { url: string; init: RequestInit | undefined } = { url: "", init: undefined };
        const fetchImpl = (async (url: unknown, init?: RequestInit) => {
            captured.url = String(url);
            captured.init = init;
            return new Response(JSON.stringify(response.body), { status: response.status });
        }) as typeof fetch;
        return { fetchImpl, captured };
    }

    it("mock 往返：multipart 契约（file/model 字段）+ Bearer 头 + 200 → 文本", async () => {
        const { fetchImpl, captured } = makeFetch({ status: 200, body: { text: "你好世界" } });
        const result = await transcribeAudio(
            CONFIG,
            { bytes: new Uint8Array([1, 2, 3]), mediaType: "audio/wav" },
            fetchImpl,
        );
        expect(result).toEqual({ text: "你好世界", model: "whisper-1" });
        expect(captured.url).toBe("https://127.0.0.1/v1/audio/transcriptions");
        const headers = captured.init?.headers as Record<string, string>;
        expect(headers["Authorization"]).toBe("Bearer sk-test-secret");
        const form = captured.init?.body as FormData;
        expect(form).toBeInstanceOf(FormData);
        expect(form.get("model")).toBe("whisper-1");
        const file = form.get("file");
        expect(file).toBeInstanceOf(Blob);
        expect((file as Blob).type).toBe("audio/wav");
        expect((file as File).name).toBe("audio.wav");
    });

    it("language 可选面透传；filename 提示透传", async () => {
        const { fetchImpl, captured } = makeFetch({ status: 200, body: { text: "hi" } });
        await transcribeAudio(
            { ...CONFIG, language: "zh" },
            { bytes: new Uint8Array([1]), mediaType: "audio/mp4", filename: "memo.m4a" },
            fetchImpl,
        );
        const form = captured.init?.body as FormData;
        expect(form.get("language")).toBe("zh");
        expect((form.get("file") as File).name).toBe("memo.m4a");
    });

    it("非音频 mediaType → STT_UNSUPPORTED_MEDIA_TYPE（fail-closed）", async () => {
        const { fetchImpl } = makeFetch({ status: 200, body: { text: "x" } });
        await expect(
            transcribeAudio(CONFIG, { bytes: new Uint8Array([1]), mediaType: "image/png" }, fetchImpl),
        ).rejects.toMatchObject({ code: "STT_UNSUPPORTED_MEDIA_TYPE" });
    });

    it("HTTP 401 → STT_AUTH_ERROR（不含响应体原文）", async () => {
        const { fetchImpl } = makeFetch({ status: 401, body: { error: "bad key details..." } });
        const error = await transcribeAudio(
            CONFIG,
            { bytes: new Uint8Array([1]), mediaType: "audio/wav" },
            fetchImpl,
        ).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SttError);
        expect((error as SttError).code).toBe("STT_AUTH_ERROR");
        expect((error as SttError).status).toBe(401);
        expect((error as SttError).message).not.toContain("bad key details");
    });

    it("HTTP 404 → STT_BAD_ENDPOINT；500 → STT_HTTP_ERROR", async () => {
        const notFound = makeFetch({ status: 404, body: "no route" });
        await expect(
            transcribeAudio(CONFIG, { bytes: new Uint8Array([1]), mediaType: "audio/wav" }, notFound.fetchImpl),
        ).rejects.toMatchObject({ code: "STT_BAD_ENDPOINT", status: 404 });
        const serverErr = makeFetch({ status: 500, body: "oops" });
        await expect(
            transcribeAudio(CONFIG, { bytes: new Uint8Array([1]), mediaType: "audio/wav" }, serverErr.fetchImpl),
        ).rejects.toMatchObject({ code: "STT_HTTP_ERROR", status: 500 });
    });

    it("fetch 抛 TimeoutError → STT_TIMEOUT（类型化）", async () => {
        const timeoutFetch = (async () => {
            throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
        }) as typeof fetch;
        await expect(
            transcribeAudio(CONFIG, { bytes: new Uint8Array([1]), mediaType: "audio/wav" }, timeoutFetch),
        ).rejects.toMatchObject({ code: "STT_TIMEOUT" });
    });

    it("元数据端点 → STT_ENDPOINT_BLOCKED（SSRF 护栏 fail-closed）", async () => {
        const { fetchImpl } = makeFetch({ status: 200, body: { text: "x" } });
        await expect(
            transcribeAudio(
                { ...CONFIG, baseUrl: "https://169.254.169.254/v1" },
                { bytes: new Uint8Array([1]), mediaType: "audio/wav" },
                fetchImpl,
            ),
        ).rejects.toMatchObject({ code: "STT_ENDPOINT_BLOCKED" });
    });

    it("响应缺 text 字段 → STT_RESPONSE_INVALID", async () => {
        const { fetchImpl } = makeFetch({ status: 200, body: { unexpected: true } });
        await expect(
            transcribeAudio(CONFIG, { bytes: new Uint8Array([1]), mediaType: "audio/wav" }, fetchImpl),
        ).rejects.toMatchObject({ code: "STT_RESPONSE_INVALID" });
    });
});

describe("transcribeAudio chat 通道（T-P3-149 C1——qwen input_audio 形状）", () => {
    function makeJsonFetch(body: unknown, status = 200): { fetchImpl: typeof fetch; captured: { url: string; init: RequestInit | undefined } } {
        const captured: { url: string; init: RequestInit | undefined } = { url: "", init: undefined };
        const fetchImpl = (async (url: unknown, init?: RequestInit) => {
            captured.url = String(url);
            captured.init = init;
            return new Response(JSON.stringify(body), { status });
        }) as typeof fetch;
        return { fetchImpl, captured };
    }

    it("chat 请求形状：/chat/completions + input_audio base64 + Bearer；content 字符串即转写", async () => {
        const { fetchImpl, captured } = makeJsonFetch({
            choices: [{ message: { content: "转写结果文本" } }],
        });
        const result = await transcribeAudio(
            { ...CONFIG, protocol: "chat", language: "zh" },
            { bytes: new Uint8Array([7, 8, 9]), mediaType: "audio/wav" },
            fetchImpl,
        );
        expect(result).toEqual({ text: "转写结果文本", model: "whisper-1" });
        expect(captured.url).toBe("https://127.0.0.1/v1/chat/completions");
        const headers = captured.init?.headers as Record<string, string>;
        expect(headers["Authorization"]).toBe("Bearer sk-test-secret");
        expect(headers["Content-Type"]).toBe("application/json");
        const payload = JSON.parse(String(captured.init?.body)) as {
            model: string;
            language?: string;
            messages: { role: string; content: { type: string; input_audio?: { data: string; format: string } }[] }[];
        };
        expect(payload.model).toBe("whisper-1");
        expect(payload.language).toBe("zh");
        const audioPart = payload.messages[0]?.content[1]?.input_audio;
        expect(audioPart?.format).toBe("wav");
        expect(Buffer.from(audioPart?.data ?? "", "base64")).toEqual(Buffer.from([7, 8, 9]));
    });

    it("chat 响应 content 数组形态：text 段拼接", async () => {
        const { fetchImpl } = makeJsonFetch({
            choices: [{ message: { content: [{ type: "text", text: "部分一" }, { type: "text", text: "部分二" }] } }],
        });
        const result = await transcribeAudio(
            { ...CONFIG, protocol: "chat" },
            { bytes: new Uint8Array([1]), mediaType: "audio/wav" },
            fetchImpl,
        );
        expect(result.text).toBe("部分一部分二");
    });

    it("chat 通道 webm 直接拒绝（STT_UNSUPPORTED_MEDIA_TYPE——须前端转 wav）", async () => {
        const { fetchImpl } = makeJsonFetch({ choices: [] });
        await expect(
            transcribeAudio(
                { ...CONFIG, protocol: "chat" },
                { bytes: new Uint8Array([1]), mediaType: "audio/webm" },
                fetchImpl,
            ),
        ).rejects.toMatchObject({ code: "STT_UNSUPPORTED_MEDIA_TYPE" });
    });
});

describe("转写文本投影（buildMessages）", () => {
    const resolver = (ref: { attachmentId: string }) =>
        ref.attachmentId === "img-1" ? { type: "image" as const, data: "", mediaType: "image/png" } : null;

    it("带 transcription 的音频附件 → 占位行携带转写文本", () => {
        const events = [
            {
                type: "user/message",
                seq: 1,
                ts: 1,
                turn: 0,
                message: { content: "听录音" },
                source: "user" as const,
                attachments: [
                    {
                        attachmentId: "aud-1",
                        mediaType: "audio/wav",
                        name: "memo",
                        size: 8000,
                        transcription: "明天下午三点开会",
                    },
                    { attachmentId: "img-1", mediaType: "image/png", size: 10 },
                ],
            } as never,
        ];
        const messages = buildChatMessages(events as never, { resolveImage: resolver });
        const content = String(messages[0]?.content);
        expect(content).toContain("听录音");
        expect(content).toContain("[voice note: memo (audio/wav, id=aud-1)] 明天下午三点开会");
    });

    it("未转写的音频附件 → 未转写占位行（容量事实可见）", () => {
        const events = [
            {
                type: "user/message",
                seq: 1,
                ts: 1,
                turn: 0,
                message: { content: "x" },
                source: "user" as const,
                attachments: [
                    { attachmentId: "aud-2", mediaType: "audio/webm", size: 5000 },
                ],
            } as never,
        ];
        const messages = buildChatMessages(events as never, { resolveImage: resolver });
        expect(String(messages[0]?.content)).toContain("id=aud-2) — 未转写]");
    });

    it("T-P3-149 E1：wav 附件 + resolveAudio → audios 进请求 + attached 占位行", () => {
        const events = [
            {
                type: "user/message",
                seq: 1,
                ts: 1,
                turn: 0,
                message: { content: "听" },
                source: "user" as const,
                attachments: [
                    { attachmentId: "aud-3", mediaType: "audio/wav", name: "clip", size: 100 },
                ],
            } as never,
        ];
        const messages = buildChatMessages(events as never, {
            resolveAudio: () => ({ mediaType: "audio/wav", data: "V0FW" }),
        });
        expect(String(messages[0]?.content)).toContain("[audio attached: clip (audio/wav, id=aud-3)]");
        expect((messages[0] as { audios?: unknown }).audios).toEqual([{ mediaType: "audio/wav", data: "V0FW" }]);
    });

    it("resolveAudio 缺省 / webm 附件 → 保持占位行降级（audios 不进请求）", () => {
        const events = [
            {
                type: "user/message",
                seq: 1,
                ts: 1,
                turn: 0,
                message: { content: "x" },
                source: "user" as const,
                attachments: [
                    { attachmentId: "aud-4", mediaType: "audio/wav", size: 100 },
                ],
            } as never,
        ];
        const withoutResolver = buildChatMessages(events as never, {});
        expect((withoutResolver[0] as { audios?: unknown }).audios).toBeUndefined();
        expect(String(withoutResolver[0]?.content)).toContain("— 未转写]");
        const webmEvents = [
            {
                type: "user/message",
                seq: 1,
                ts: 1,
                turn: 0,
                message: { content: "x" },
                source: "user" as const,
                attachments: [
                    { attachmentId: "aud-5", mediaType: "audio/webm", size: 100 },
                ],
            } as never,
        ];
        const withResolver = buildChatMessages(webmEvents as never, {
            resolveAudio: () => ({ mediaType: "audio/webm", data: "eA" }),
        });
        expect((withResolver[0] as { audios?: unknown }).audios).toBeUndefined(); // webm 不直读——resolver 也不进
    });
});

describe("附件存储透传 transcription", () => {
    it("内存 store：save 保留 transcription 字段", () => {
        const store = new InMemoryAttachmentStore();
        const ref = store.save({
            mediaType: "audio/wav",
            data: Buffer.from("abc").toString("base64"),
            transcription: "测试",
        });
        expect(ref.transcription).toBe("测试");
    });
});
