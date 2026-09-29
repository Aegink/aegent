/**
 * 语音转写代理面（U26/T-P3-129——settings-gateway 的行数纪律拆分位）：
 * UI MediaRecorder 录音上送 → P4 transcribeAudio → 文本回端。
 *
 * 凭据红线：STT 端点 key 按 "stt" 键名从 credentials 库解密（U2 面复用，
 * 零明文——settings.stt 段只存 baseUrl/model/language）。未配置端点 =
 * 类型化 STT_NOT_CONFIGURED（UI 引导到设置页语音分节）。
 */

import { transcribeAudio } from "../attachments/stt.js";
import type { SettingsShape } from "../session/settings.js";
import type { CredentialStore } from "../session/credentials.js";

/** base64 → 字节（stt-transcribe 载荷解码——录音体上送面）。 */
export function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

/** 转写执行（gateway 委托体——配置读取与凭据解密在此，fetch 可注入）。 */
export async function runSttTranscribe(
  settings: SettingsShape,
  credentials: CredentialStore,
  payload: { base64: string; mediaType: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string; model: string }> {
  const stt = settings.stt;
  if (stt === undefined || stt.baseUrl.trim() === "") {
    const error = new Error("STT 未配置——设置页语音分节填端点与模型");
    (error as unknown as { code: string }).code = "STT_NOT_CONFIGURED";
    throw error;
  }
  const apiKey = await credentials.getKey("stt");
  const result = await transcribeAudio(
    {
      baseUrl: stt.baseUrl,
      model: stt.model,
      ...(stt.language !== undefined ? { language: stt.language } : {}),
      ...(apiKey !== undefined ? { apiKey } : {}),
    },
    { bytes: base64ToBytes(payload.base64), mediaType: payload.mediaType },
    fetchImpl,
  );
  return { text: result.text, model: result.model };
}
