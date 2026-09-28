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

export interface SttConfig {
  /** OpenAI 协议兼容端点根（如 https://api.openai.com/v1）。 */
  baseUrl: string;
  /** API key（环境变量注入——零落盘）。 */
  apiKey?: string;
  /** 转写模型名（如 whisper-1——provider 侧语义）。 */
  model: string;
  /** 语言提示（BCP-47 可选，如 zh）。 */
  language?: string;
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
  | "STT_RESPONSE_INVALID";

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
 * 响应契约：2xx 且 JSON 含非空 text 字段——其余一律类型化拒绝。
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
  const ext = EXT_BY_MEDIA_TYPE[input.mediaType] ?? "bin";
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(input.bytes)], { type: input.mediaType }),
    input.filename ?? `audio.${ext}`,
  );
  form.append("model", config.model);
  if (config.language !== undefined) form.append("language", config.language);

  const response = await fetchImpl(`${config.baseUrl}/audio/transcriptions`, {
    method: "POST",
    ...(config.apiKey !== undefined
      ? { headers: { Authorization: `Bearer ${config.apiKey}` } }
      : {}),
    body: form,
  });
  if (!response.ok) {
    throw new SttError(
      "STT_HTTP_ERROR",
      `STT 端点返回 HTTP ${String(response.status)}（错误面不含响应体原文）`,
      response.status,
    );
  }
  let parsed: unknown;
  try {
    parsed = (await response.json()) as unknown;
  } catch {
    throw new SttError("STT_RESPONSE_INVALID", "STT 端点响应不是合法 JSON");
  }
  const text =
    typeof parsed === "object" && parsed !== null && "text" in parsed
      ? (parsed as { text: unknown }).text
      : undefined;
  if (typeof text !== "string" || text.trim() === "") {
    throw new SttError("STT_RESPONSE_INVALID", "STT 端点响应缺少非空 text 字段");
  }
  return { text, model: config.model };
}
