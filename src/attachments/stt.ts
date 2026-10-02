/**
 * P4 语音转文字（T-P2-406）——STT 调用面（OpenAI 协议
 * `POST {baseUrl}/audio/transcriptions`，multipart/form-data）。
 *
 * 锚点：dsh·api-speech-to-text（"provider discovery + one
 * complete-recording transcription call" 的行为；其 canonical base64 +
 * 16kHz PCM16 WAV 的强校验不抄——我方按 mediaType 白名单 + 字节上限面
 * 校验，格式解码交给 provider）。"非必需"标注——规模最小化。
 *
 * 形状定形：本函数是**端侧库面**（CLI/host 端在提交语音附件前转写，
 * 文本经 IncomingAttachment.transcription 上送——agent 子进程零 STT 依赖
 * 零阻塞）。真实端点联调列人工确认（随用户供给 STT 端点——mock 往返
 * 测试在位）。凭据红线：apiKey 只经参数传入进 Authorization 头，错误
 * 信息零回显（零落盘）。
 */

import { AUDIO_MEDIA_TYPES } from "./limits.js";
import { assertEndpointAllowed, EndpointBlockedError } from "./endpoint-guard.js";

/** 转写协议通道（T-P3-149 C1——qwen voice-model.ts 三档传输的批式收敛）。 */
export type SttProtocol = "transcriptions" | "chat";

/** chat 通道 input_audio 接受的容器格式（OpenAI 协议闭集——webm 须前端转 wav）。 */
export const CHAT_AUDIO_FORMATS = new Set(["wav", "mp3"]);

export interface SttConfig {
  /** OpenAI 协议兼容端点根（如 https://api.openai.com/v1）。 */
  baseUrl: string;
  /** API key（环境变量注入——零落盘）。 */
  apiKey?: string;
  /** 转写模型名（如 whisper-1——provider 侧语义）。 */
  model: string;
  /** 语言提示（BCP-47 可选，如 zh）。 */
  language?: string;
  /**
   * 协议通道（缺省 transcriptions）：chat = POST {baseUrl}/chat/completions
   * 带 input_audio base64 消息取 assistant 文本（qwen voice-transcriber
   * 通道——DashScope 类无 /audio/transcriptions 端点的 provider 唯一入口）。
   */
  protocol?: SttProtocol;
}

export interface SttInput {
  /** 原始音频字节。 */
  bytes: Uint8Array;
  /** 音频 mediaType（AUDIO_MEDIA_TYPES 三类闭集）。 */
  mediaType: string;
  /** 文件名提示（可选——provider 的格式嗅探用）。 */
  filename?: string;
}

export interface SttResult {
  /** 转写文本。 */
  text: string;
  /** 实际使用的模型名（回执——装配核对用）。 */
  model: string;
}

export type SttErrorCode =
  | "STT_UNSUPPORTED_MEDIA_TYPE"
  | "STT_HTTP_ERROR"
  | "STT_RESPONSE_INVALID"
  | "STT_AUTH_ERROR"
  | "STT_BAD_ENDPOINT"
  | "STT_TIMEOUT"
  | "STT_INPUT_TOO_LARGE"
  | "STT_ENDPOINT_BLOCKED";

/** 转写请求超时（qwen voice-transcriber.ts:22 对齐——60s）。 */
const STT_TIMEOUT_MS = 60_000;

export class SttError extends Error {
  constructor(
    readonly code: SttErrorCode,
    message: string,
    /** HTTP 状态码（STT_HTTP_ERROR 时——错误面不含响应体原文，防凭据/敏感泄露）。 */
    readonly status?: number,
  ) {
    super(message);
    this.name = "SttError";
  }
}

const EXT_BY_MEDIA_TYPE: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/webm": "webm",
};

/**
 * 转写一段完整录音 → 文本。fetch 可注入（mock 测试；缺省全局 fetch）。
 * 响应契约：transcriptions 通道 2xx 且 JSON 含非空 text；chat 通道 2xx 且
 * choices[0].message.content 非空——其余一律类型化拒绝。
 * 端点安全：SSRF 护栏（assertEndpointAllowed）前置——https 强制（localhost
 * 例外）+ 私网/元数据 IP 拦截 + DNS 解析复核（qwen voice-transcriber 防护面）。
 */
export async function transcribeAudio(
  config: SttConfig,
  input: SttInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SttResult> {
  if (!(AUDIO_MEDIA_TYPES as readonly string[]).includes(input.mediaType)) {
    throw new SttError(
      "STT_UNSUPPORTED_MEDIA_TYPE",
      `mediaType "${input.mediaType}" 不在音频白名单（${AUDIO_MEDIA_TYPES.join(", ")}）`,
    );
  }
  try {
    await assertEndpointAllowed(config.baseUrl, { code: "STT_ENDPOINT_BLOCKED" });
  } catch (e) {
    if (e instanceof EndpointBlockedError) {
      throw new SttError("STT_ENDPOINT_BLOCKED", e.message);
    }
    throw e;
  }
  const response = await requestWithTimeout(
    config,
    input,
    fetchImpl,
  );
  const parsed = await parseSttResponse(response);
  const text =
    config.protocol === "chat" ? extractChatText(parsed) : extractTranscriptionText(parsed);
  if (text === null || text.trim() === "") {
    throw new SttError("STT_RESPONSE_INVALID", "STT 端点响应缺少非空文本字段");
  }
  return { text, model: config.model };
}

/** 超时包装的转写请求（60s AbortSignal——TimeoutError 转类型化 STT_TIMEOUT）。 */
async function requestWithTimeout(
  config: SttConfig,
  input: SttInput,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const headers: Record<string, string> =
    config.apiKey !== undefined ? { Authorization: `Bearer ${config.apiKey}` } : {};
  let body: FormData | string;
  let url: string;
  if (config.protocol === "chat") {
    url = `${config.baseUrl}/chat/completions`;
    headers["Content-Type"] = "application/json";
    const ext = EXT_BY_MEDIA_TYPE[input.mediaType] ?? "bin";
    if (!CHAT_AUDIO_FORMATS.has(ext)) {
      throw new SttError(
        "STT_UNSUPPORTED_MEDIA_TYPE",
        `chat 协议通道只接受 wav/mp3（当前 ${input.mediaType}）——前端须先重采样为 wav`,
      );
    }
    // qwen voice-transcriber.ts:769-817 形状：input_audio base64 消息
    body = JSON.stringify({
      model: config.model,
      ...(config.language !== undefined && config.language !== ""
        ? { language: config.language }
        : {}),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this audio." },
            {
              type: "input_audio",
              input_audio: {
                data: Buffer.from(new Uint8Array(input.bytes)).toString("base64"),
                format: ext,
              },
            },
          ],
        },
      ],
    });
  } else {
    url = `${config.baseUrl}/audio/transcriptions`;
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(input.bytes)], { type: input.mediaType }),
      input.filename ?? `audio.${EXT_BY_MEDIA_TYPE[input.mediaType] ?? "bin"}`,
    );
    form.append("model", config.model);
    if (config.language !== undefined) form.append("language", config.language);
    body = form;
  }
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(STT_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new SttError("STT_TIMEOUT", `STT 端点 ${STT_TIMEOUT_MS / 1000}s 未响应（超时）`);
    }
    throw e;
  }
  if (!response.ok) {
    // HTTP 错误细分（pideck VoiceTranscriptionService 错误码映射面）——
    // 错误信息零回显响应体原文（防凭据/敏感泄露）
    const status = response.status;
    if (status === 401 || status === 403) {
      throw new SttError("STT_AUTH_ERROR", `STT 端点返回 HTTP ${String(status)}——API key 无效或无权限`, status);
    }
    if (status === 404 || status === 405) {
      throw new SttError("STT_BAD_ENDPOINT", `STT 端点返回 HTTP ${String(status)}——路径不存在，核对端点根与协议通道`, status);
    }
    throw new SttError("STT_HTTP_ERROR", `STT 端点返回 HTTP ${String(status)}（错误面不含响应体原文）`, status);
  }
  return response;
}

async function parseSttResponse(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new SttError("STT_RESPONSE_INVALID", "STT 端点响应不是合法 JSON");
  }
}

function extractTranscriptionText(parsed: unknown): string | null {
  const text =
    typeof parsed === "object" && parsed !== null && "text" in parsed
      ? (parsed as { text: unknown }).text
      : undefined;
  return typeof text === "string" ? text : null;
}

/** chat 通道：choices[0].message.content（字符串或 content 数组取 text 段拼接）。 */
function extractChatText(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (part): part is { type: string; text?: unknown } =>
          typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text",
      )
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("");
  }
  return null;
}
