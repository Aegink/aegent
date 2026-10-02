/**
 * 语音合成（T-P3-149 D 域后端）——TTS 调用面（OpenAI 协议
 * `POST {baseUrl}/audio/speech`，JSON {model, voice, input}，音频字节回端）。
 *
 * 锚点：pi-desktop speech/adapters.ts:52-66（openai_audio synthesize 协议
 * 形状 + voice 缺省语义）；8MiB 产物上限对齐其 dataUrl 面约束。
 * 端点安全与错误细分与 STT 同面（endpoint-guard + 类型化错误族——零回显
 * 响应体原文）。凭据红线：apiKey 只经参数传入进 Authorization 头。
 */

import { assertEndpointAllowed, EndpointBlockedError } from "./endpoint-guard.js";

export interface TtsConfig {
  /** OpenAI 协议兼容端点根（如 https://api.openai.com/v1）。 */
  baseUrl: string;
  /** API key（credentials 库注入——零落盘）。 */
  apiKey?: string;
  /** 合成模型名（如 tts-1——provider 侧语义）。 */
  model: string;
  /** 音色（可选，如 alloy——provider 侧语义）。 */
  voice?: string;
}

export interface TtsResult {
  /** 合成音频（base64——信封直传回端）。 */
  audioBase64: string;
  /** 音频 mediaType（从响应 content-type 收敛，缺省 audio/mpeg）。 */
  mediaType: string;
  /** 实际使用的模型名（回执）。 */
  model: string;
}

export type TtsErrorCode =
  | "TTS_TEXT_TOO_LONG"
  | "TTS_HTTP_ERROR"
  | "TTS_RESPONSE_INVALID"
  | "TTS_AUTH_ERROR"
  | "TTS_BAD_ENDPOINT"
  | "TTS_TIMEOUT"
  | "TTS_AUDIO_TOO_LARGE"
  | "TTS_ENDPOINT_BLOCKED";

export class TtsError extends Error {
  constructor(
    readonly code: TtsErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TtsError";
  }
}

/** 合成文本上限（朗读场景 4000 字符已远超单条回复长度）。 */
const MAX_TEXT_CHARS = 4000;
/** 合成产物上限（pi-desktop speech-service dataUrl 8MiB 对齐）。 */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
/** 合成请求超时（朗读是交互操作——60s 同 STT 面）。 */
const TTS_TIMEOUT_MS = 60_000;

/**
 * 合成一段文本 → 音频 base64。fetch 可注入（mock 测试）。
 * 响应契约：2xx 且体为非空音频字节（content-type 必须以 audio/ 开头）——
 * 其余一律类型化拒绝（JSON 错误体来自网关时按 HTTP 错误面处理）。
 */
export async function synthesizeText(
  config: TtsConfig,
  input: { text: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TtsResult> {
  const text = input.text.trim();
  if (text === "") throw new TtsError("TTS_RESPONSE_INVALID", "合成文本为空");
  if (text.length > MAX_TEXT_CHARS) {
    throw new TtsError("TTS_TEXT_TOO_LONG", `合成文本 ${text.length} 字符超过 ${String(MAX_TEXT_CHARS)} 上限`);
  }
  try {
    await assertEndpointAllowed(config.baseUrl, { code: "TTS_ENDPOINT_BLOCKED" });
  } catch (e) {
    if (e instanceof EndpointBlockedError) throw new TtsError("TTS_ENDPOINT_BLOCKED", e.message);
    throw e;
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey !== undefined) headers.Authorization = `Bearer ${config.apiKey}`;
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/audio/speech`, {
      method: "POST",
      headers,
      // pi-desktop adapters.ts openai_audio synthesize 形状（voice 缺省 alloy
      // 语义——voice 缺省时省略字段，provider 自选）
      body: JSON.stringify({
        model: config.model,
        ...(config.voice !== undefined && config.voice !== "" ? { voice: config.voice } : {}),
        input: text,
        response_format: "mp3",
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new TtsError("TTS_TIMEOUT", `TTS 端点 ${TTS_TIMEOUT_MS / 1000}s 未响应（超时）`);
    }
    throw e;
  }
  if (!response.ok) {
    const status = response.status;
    if (status === 401 || status === 403) {
      throw new TtsError("TTS_AUTH_ERROR", `TTS 端点返回 HTTP ${String(status)}——API key 无效或无权限`, status);
    }
    if (status === 404 || status === 405) {
      throw new TtsError("TTS_BAD_ENDPOINT", `TTS 端点返回 HTTP ${String(status)}——路径不存在，核对端点根`, status);
    }
    throw new TtsError("TTS_HTTP_ERROR", `TTS 端点返回 HTTP ${String(status)}（错误面不含响应体原文）`, status);
  }
  const contentType = (response.headers.get("content-type") ?? "audio/mpeg").split(";")[0] ?? "audio/mpeg";
  if (!contentType.startsWith("audio/")) {
    throw new TtsError("TTS_RESPONSE_INVALID", `TTS 端点响应不是音频（content-type ${contentType}）`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new TtsError("TTS_RESPONSE_INVALID", "TTS 端点返回空音频");
  }
  if (bytes.byteLength > MAX_AUDIO_BYTES) {
    throw new TtsError("TTS_AUDIO_TOO_LARGE", `合成音频超过 8MB 上限`);
  }
  return {
    audioBase64: Buffer.from(bytes).toString("base64"),
    mediaType: contentType,
    model: config.model,
  };
}
