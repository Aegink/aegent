/**
 * settings 信封的供应商操作面（T-P3-137）——provider-models / provider-test
 * 两个 op 的实现（自 settings-gateway 拆出——host 域行数纪律，行为不变）：
 * WebView CSP 不放外网，模型拉取与真实对话测试必须经 host 代理；自足载荷
 * baseUrl/adapter/headers 直传，apiKey 缺省按条目名走凭据库（零明文）。
 */

import type { CredentialStore } from "../session/credentials.js";
import { fetchProviderModels, testProviderChat, type ProviderTestResult } from "./provider-gateway.js";

/** 供应商适配器闭集（与 settings providers 条目的 adapter 段同集）。 */
export type ProviderAdapterKind = "openai" | "openai-responses" | "anthropic" | "google";

export interface ProviderModelsPayload {
  provider: string;
  baseUrl: string;
  adapter: ProviderAdapterKind;
  headers?: Record<string, string>;
  apiKey?: string;
}

export interface ProviderTestPayload extends ProviderModelsPayload {
  modelId: string;
}

/** T-P3-137：模型清单拉取（GET /models 归一——apiKey 缺省走凭据）。 */
export async function providerModelsOp(
  credentials: CredentialStore,
  payload: ProviderModelsPayload,
): Promise<{ models: { id: string }[] }> {
  const apiKey = payload.apiKey ?? (await credentials.getKey(payload.provider));
  if (apiKey === undefined) {
    throw Object.assign(new Error("未设置 API key——请先在表单填入密钥（保存后可走凭据面）"), {
      code: "PROVIDER_KEY_MISSING",
    });
  }
  return fetchProviderModels(
    { baseUrl: payload.baseUrl, adapter: payload.adapter, headers: payload.headers },
    apiKey,
  );
}

/** T-P3-137：真实对话测试（发"你好"——成功才算可以使用）。 */
export async function providerTestOp(
  credentials: CredentialStore,
  payload: ProviderTestPayload,
): Promise<ProviderTestResult> {
  const apiKey = payload.apiKey ?? (await credentials.getKey(payload.provider));
  if (apiKey === undefined) {
    return { ok: false, error: "未设置 API key——请先在表单填入密钥" };
  }
  return testProviderChat(
    { baseUrl: payload.baseUrl, adapter: payload.adapter, headers: payload.headers },
    payload.modelId,
    apiKey,
  );
}
