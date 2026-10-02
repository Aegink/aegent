/**
 * 语音合成代理面（T-P3-149 D 域后端——speech-gateway 的姊妹拆分位）：
 * UI 朗读请求上送文本 → TTS synthesizeText → 音频 base64 回端。
 *
 * 凭据红线：TTS 端点 key 按 "tts" 键名从 credentials 库解密（U2 面复用，
 * 零明文——settings.tts 段只存 baseUrl/model/voice）。未配置端点 =
 * 类型化 TTS_NOT_CONFIGURED（UI 引导到设置页语音分节）。
 */

import { synthesizeText } from "../attachments/tts.js";
import type { SettingsShape } from "../session/settings.js";
import type { CredentialStore } from "../session/credentials.js";

/** 合成执行（gateway 委托体——配置读取与凭据解密在此，fetch 可注入）。 */
export async function runTtsSynthesize(
  settings: SettingsShape,
  credentials: CredentialStore,
  payload: { text: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ audioBase64: string; mediaType: string; model: string }> {
  const tts = settings.tts;
  if (tts === undefined || tts.baseUrl.trim() === "") {
    const error = new Error("TTS 未配置——设置页语音分节填端点与模型");
    (error as unknown as { code: string }).code = "TTS_NOT_CONFIGURED";
    throw error;
  }
  const apiKey = await credentials.getKey("tts");
  return synthesizeText(
    {
      baseUrl: tts.baseUrl,
      model: tts.model,
      ...(tts.voice !== undefined ? { voice: tts.voice } : {}),
      ...(apiKey !== undefined ? { apiKey } : {}),
    },
    { text: payload.text },
    fetchImpl,
  );
}
