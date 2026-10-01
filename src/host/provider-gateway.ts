/**
 * 供应商端点代理面（T-P3-137）——host 侧 fetch：WebView CSP 只放开本机
 * 回环，模型清单拉取与真实对话测试都经 host 代理（node 进程无 CSP 约束）。
 *
 * 四协议（pi-desktop apiStyle 对齐）：
 * - openai / openai-responses：GET {base}/models（Bearer）；
 * - anthropic：GET {base}/v1/models?limit=1000（x-api-key + anthropic-version，
 *   base 缺 /v1 自动补）；
 * - google：GET {base}/v1beta/models?pageSize=1000（key 走查询参数，剥
 *   models/ 前缀）。
 *
 * testProviderChat：真实发一轮"你好"（用户裁决"成功才算可以使用"——比
 * pi-desktop 的 /models 连通探测更严）：
 * - openai：POST /chat/completions {model, messages, max_tokens, reasoning_effort?}；
 * - openai-responses：POST /responses {model, input, max_output_tokens, reasoning?}
 *   （output[].content[].text 提取）；
 * - anthropic：POST /v1/messages {model, max_tokens, thinking?, messages}；
 * - google：POST /v1beta/models/{model}:generateContent?key=
 *   {contents:[{parts:[{text}]}], generationConfig}（candidates[0] 提取）。
 * 200 且 content 非空才算成功，回执带回复摘要与延迟；401/403 转鉴权失败
 * 文案，429 转限流，超时 20s。保留头（authorization 等）在 settings parse
 * 层已剔除——此处把用户自定义头并进请求（鉴权键由本模块后置写入）。
 */

import { THINKING_BUDGET } from "../models/provider.js";

const MODELS_TIMEOUT_MS = 10_000;
const CHAT_TIMEOUT_MS = 20_000;
const MAX_MODELS = 500;
const ANTHROPIC_VERSION = "2023-06-01";
// 测试请求的补全配额——不能给太小：思考模型（如 deepseek-v4.1-flash）的
// reasoning 会吃光小配额导致 content 为空（实测 16 → 中转 502 "empty
// response content"，512 → 正常回复；对普通模型无额外成本，只是上限）。
const CHAT_PROBE_MAX_TOKENS = 512;

export interface ProviderEndpointSpec {
  baseUrl: string;
  adapter: "openai" | "openai-responses" | "anthropic" | "google";
  headers?: Record<string, string>;
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function anthropicBase(baseUrl: string): string {
  const base = trimBase(baseUrl);
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function googleBase(baseUrl: string): string {
  const base = trimBase(baseUrl);
  return /\/v1beta$/.test(base) ? base : `${base}/v1beta`;
}

function modelsUrl(spec: ProviderEndpointSpec): string {
  const base = trimBase(spec.baseUrl);
  if (spec.adapter === "anthropic") return `${anthropicBase(base)}/models?limit=1000`;
  if (spec.adapter === "google") return `${googleBase(base)}/models?pageSize=1000`;
  return `${base}/models`; // openai / openai-responses 同一列举端点
}

function authQuery(adapter: ProviderEndpointSpec["adapter"], apiKey: string): string {
  return adapter === "google" ? `&key=${encodeURIComponent(apiKey)}` : "";
}

function buildHeaders(spec: ProviderEndpointSpec, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(spec.headers ?? {}) };
  if (spec.adapter === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = ANTHROPIC_VERSION;
  } else if (spec.adapter !== "google") {
    headers["authorization"] = `Bearer ${apiKey}`; // google 的 key 走查询参数
  }
  return headers;
}

function normalizeModelIds(spec: ProviderEndpointSpec, body: unknown): string[] {
  // google 形 {models:[{name:"models/xxx"}]}；其余 {data:[{id}]} / 裸数组
  const rows: unknown[] =
    body !== null && typeof body === "object" && Array.isArray((body as { data?: unknown[] }).data)
      ? (body as { data: unknown[] }).data
      : body !== null && typeof body === "object" && Array.isArray((body as { models?: unknown[] }).models)
        ? (body as { models: unknown[] }).models
        : Array.isArray(body)
          ? body
          : [];
  const ids = rows
    .map((r) => {
      if (r === null || typeof r !== "object") return undefined;
      const rec = r as { id?: unknown; name?: unknown };
      if (typeof rec.id === "string" && rec.id !== "") return rec.id;
      if (typeof rec.name === "string" && rec.name !== "") return rec.name.replace(/^models\//, "");
      return undefined;
    })
    .filter((id): id is string => typeof id === "string" && id !== "");
  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : 1)).slice(0, MAX_MODELS);
}

function errorText(status: number, bodyText: string): string {
  if (status === 401 || status === 403) return "鉴权失败：API key 无效或无权限（HTTP 401/403）";
  if (status === 429) return "限流（HTTP 429）——稍后重试";
  return `HTTP ${status}：${bodyText.slice(0, 120)}`;
}

/** 拉取模型清单（GET /models——四协议归一 + 去重排序；失败上抛 Error）。 */
export async function fetchProviderModels(
  spec: ProviderEndpointSpec,
  apiKey: string,
): Promise<{ models: { id: string }[] }> {
  let res: Response;
  try {
    res = await fetch(modelsUrl(spec) + authQuery(spec.adapter, apiKey), {
      method: "GET",
      headers: buildHeaders(spec, apiKey),
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`连接失败：${e instanceof Error ? e.message : String(e)}`);
  }
  const bodyText = await res.text();
  if (!res.ok) throw new Error(errorText(res.status, bodyText));
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error("响应不是合法 JSON（确认接口地址是否正确）");
  }
  return { models: normalizeModelIds(spec, body).map((id) => ({ id })) };
}

export interface ProviderTestResult {
  ok: boolean;
  /** 成功时的模型回复摘要（≤60 字——"你好"的真实回声）。 */
  reply?: string;
  latencyMs?: number;
  error?: string;
}

/** 从各协议成功响应里提取对话文本（缺失 = 端点可达但无内容）。 */
function extractReply(adapter: ProviderEndpointSpec["adapter"], parsed: unknown): string | undefined {
  const rec = parsed as {
    choices?: { message?: { content?: unknown } }[];
    output?: { content?: { text?: unknown; type?: unknown }[] }[];
    content?: { text?: unknown }[];
    candidates?: { content?: { parts?: { text?: unknown }[] } }[];
  };
  let text: string | undefined;
  if (adapter === "anthropic") {
    text = rec.content?.map((c) => (typeof c?.text === "string" ? c.text : "")).join("");
  } else if (adapter === "google") {
    text = rec.candidates?.[0]?.content?.parts?.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
  } else if (adapter === "openai-responses") {
    text = rec.output
      ?.flatMap((o) => o.content ?? [])
      .map((c) => (typeof c?.text === "string" ? c.text : ""))
      .join("");
  } else {
    const raw = rec.choices?.[0]?.message?.content;
    text = typeof raw === "string" ? raw : undefined;
  }
  return text !== undefined && text.trim() !== "" ? text : undefined;
}

/** 真实对话测试（发"你好"——200 且 content 非空才算成功；reasoning 缺省不
 *  带思考参数，传入即按该档真实消费——用户可实测验证档位可用性）。 */
export async function testProviderChat(
  spec: ProviderEndpointSpec,
  modelId: string,
  apiKey: string,
  reasoning?: string,
  /** T-P3-147 D：辅助任务测试的探测参数（缺省 = provider 级 512 探针）。 */
  opts?: { maxTokens?: number; prompt?: string },
): Promise<ProviderTestResult> {
  const base = trimBase(spec.baseUrl);
  let url: string;
  let body: unknown;
  if (spec.adapter === "anthropic") {
    url = `${anthropicBase(base)}/messages`;
    const budget = reasoning !== undefined && reasoning !== "off" ? THINKING_BUDGET[reasoning] : undefined;
    body = {
      model: modelId,
      // anthropic 硬规则：max_tokens 必须大于 budget_tokens——开思考时抬底
      max_tokens:
        budget !== undefined
          ? Math.max(opts?.maxTokens ?? CHAT_PROBE_MAX_TOKENS, budget + 1024)
          : (opts?.maxTokens ?? CHAT_PROBE_MAX_TOKENS),
      ...(budget !== undefined ? { thinking: { type: "enabled", budget_tokens: budget } } : {}),
      messages: [{ role: "user", content: opts?.prompt ?? "你好" }],
    };
  } else if (spec.adapter === "google") {
    url = `${googleBase(base)}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const gBudget = reasoning !== undefined && reasoning !== "off" ? THINKING_BUDGET[reasoning] : undefined;
    body = {
      contents: [{ parts: [{ text: opts?.prompt ?? "你好" }] }],
      generationConfig: {
        maxOutputTokens: opts?.maxTokens ?? CHAT_PROBE_MAX_TOKENS,
        ...(gBudget !== undefined ? { thinkingConfig: { thinkingBudget: gBudget } } : {}),
      },
    };
  } else if (spec.adapter === "openai-responses") {
    url = `${base}/responses`;
    body = {
      model: modelId,
      input: opts?.prompt ?? "你好",
      max_output_tokens: opts?.maxTokens ?? CHAT_PROBE_MAX_TOKENS,
      ...(reasoning !== undefined && reasoning !== "off" ? { reasoning: { effort: reasoning } } : {}),
      stream: false,
    };
  } else {
    url = `${base}/chat/completions`;
    body = {
      model: modelId,
      messages: [{ role: "user", content: opts?.prompt ?? "你好" }],
      max_tokens: opts?.maxTokens ?? CHAT_PROBE_MAX_TOKENS,
      // 思考档真实消费（OpenAI 兼容 reasoning_effort 别名——off/缺省不带）
      ...(reasoning !== undefined && reasoning !== "off" ? { reasoning_effort: reasoning } : {}),
      stream: false,
    };
  }
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: buildHeaders(spec, apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, error: `连接失败：${e instanceof Error ? e.message : String(e)}` };
  }
  const latencyMs = Date.now() - started;
  const bodyText = await res.text();
  if (!res.ok) return { ok: false, latencyMs, error: errorText(res.status, bodyText) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { ok: false, latencyMs, error: "响应不是合法 JSON" };
  }
  const reply = extractReply(spec.adapter, parsed);
  if (reply === undefined) {
    return { ok: false, latencyMs, error: "端点可达但未返回对话内容（检查模型 ID 是否正确）" };
  }
  return { ok: true, reply: reply.slice(0, 60), latencyMs };
}
