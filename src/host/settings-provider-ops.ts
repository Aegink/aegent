/**
 * settings 信封的供应商操作面（T-P3-137）——provider-models / provider-test
 * 两个 op 的实现（自 settings-gateway 拆出——host 域行数纪律，行为不变）：
 * WebView CSP 不放外网，模型拉取与真实对话测试必须经 host 代理；自足载荷
 * baseUrl/adapter/headers 直传，apiKey 缺省按条目名走凭据库（零明文）。
 */

import type { CredentialStore } from "../session/credentials.js";
import type { SettingsShape } from "../session/settings.js";
import { resolveEnhancementChain } from "../session/settings.js";
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
  /** 默认思考档（T-P3-137 三轮——测试请求同步消费，验证档位真实可用）。 */
  reasoning?: string;
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
    payload.reasoning,
  );
}

// ---------------------------------------------------------------------------
// T-P3-147 D：辅助任务真实测试（enhancement-test op——每任务「测试」按钮的
// host 面）：任务级模型链（显式 → fallbacks → fastModel）解析首个命中项，
// 以 1-token 探测真实发一次请求（zcode 连通性探测语义——成本≈0，配置错/
// 凭据缺立即可见）。未配置 = ok:false + NOT_CONFIGURED（诚实回退说明）。
// ---------------------------------------------------------------------------

/** 辅助任务闭集（与 settings enhancement 段任务键一一对应；fastModel 单列）。 */
export const ENHANCEMENT_TEST_TASKS = ["judge", "summarizer", "polish", "title", "fastModel"] as const;
export type EnhancementTestTask = (typeof ENHANCEMENT_TEST_TASKS)[number];

export interface EnhancementTestResult extends ProviderTestResult {
  /** 实际命中的模型（链解析产物——"测的是谁"一目了然）。 */
  resolved?: { provider: string; modelId: string };
  /** 未配置时的回退说明（NOT_CONFIGURED——运行时将回退主模型链）。 */
  code?: "NOT_CONFIGURED" | "GATE_CLOSED";
}

export async function enhancementTestOp(
  credentials: CredentialStore,
  settings: SettingsShape,
  task: EnhancementTestTask,
): Promise<EnhancementTestResult> {
  if (settings.enhancement?.enabled === false) {
    return { ok: false, code: "GATE_CLOSED", error: "辅助流量总闸已关闭——设置 → 辅助模型 → 总开关" };
  }
  const taskEntry =
    task === "fastModel"
      ? settings.enhancement?.fastModel
      : (settings.enhancement?.[task] as import("../session/settings.js").EnhancementModelEntry | undefined);
  const chain = [
    ...resolveEnhancementChain(taskEntry, settings.providers, settings.defaultModel),
    ...resolveEnhancementChain(settings.enhancement?.fastModel, settings.providers, settings.defaultModel),
  ];
  const hit = chain[0];
  if (hit === undefined) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      error: "该任务未配置显式模型——运行时将回退主模型链（配置后可在此验证可用性）",
    };
  }
  const apiKey = await credentials.getKey(hit.entry.name);
  if (apiKey === undefined) {
    return {
      ok: false,
      resolved: { provider: hit.entry.name, modelId: hit.modelId },
      error: `条目「${hit.entry.name}」未设置 API key——供应商页补密钥后重试`,
    };
  }
  const adapter = (hit.entry.models?.[0]?.adapter ?? hit.entry.adapter ?? "openai") as ProviderAdapterKind;
  const reasoning =
    taskEntry?.reasoning ??
    hit.entry.models?.find((m) => m.id === hit.modelId)?.reasoning;
  if (hit.entry.baseUrl === undefined || hit.entry.baseUrl.trim() === "") {
    return {
      ok: false,
      resolved: { provider: hit.entry.name, modelId: hit.modelId },
      error: `条目「${hit.entry.name}」未配置 baseUrl——供应商页补端点后重试`,
    };
  }
  const r = await testProviderChat(
    {
      baseUrl: hit.entry.baseUrl,
      adapter,
      ...(hit.entry.headers !== undefined ? { headers: hit.entry.headers } : {}),
    },
    hit.modelId,
    apiKey,
    reasoning,
    { maxTokens: 1, prompt: "hi" },
  );
  return {
    ...r,
    resolved: { provider: hit.entry.name, modelId: hit.modelId },
  };
}

/**
 * 健康探测（C8——自 settings-gateway 下沉：行数纪律拆分）。条目缺失/缺
 * baseUrl 类型化拒绝（PROVIDER_NOT_FOUND / PROVIDER_NO_BASE_URL）；其余
 * 走注入的探针（生产 = models/health 的 probeProvider——不发消息）。
 */
export async function gatewayProbeProvider(
  name: string,
  healthProbe: (name: string, baseUrl: string) => Promise<import("../models/health.js").HealthCheckResult>,
  getSettings: () => Promise<SettingsShape>,
): Promise<import("../models/health.js").HealthCheckResult> {
  const entry = (await getSettings()).providers.find((p) => p.name === name);
  if (entry === undefined || entry.baseUrl === undefined || entry.baseUrl.trim() === "") {
    const missing = entry === undefined;
    const error = new Error(missing ? `provider「${name}」不在配置中` : `provider「${name}」未配置 baseUrl，无法探测`);
    (error as unknown as { code: string }).code = missing ? "PROVIDER_NOT_FOUND" : "PROVIDER_NO_BASE_URL";
    throw error;
  }
  return healthProbe(name, entry.baseUrl);
}
