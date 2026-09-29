/**
 * OpenAI 兼容流式适配（J1/J2 的厂商侧）——chat.completions 的 SSE wire 映射到
 * 词汇表 StreamChunk。选 OpenAI 兼容端点是因为覆盖面最大且 http-mock 易造。
 *
 * wire 映射表（chat.completion.chunk → StreamChunk）：
 * - `choices[0].delta.content`                 → {type:"text-delta"}
 * - `choices[0].delta.reasoning_content|reasoning` → {type:"reasoning-delta"}
 * - `choices[0].delta.tool_calls[i]`           → {type:"tool-call-delta"}，按 index 对齐：
 *   OpenAI 流式分片只在首片携带 id/name，后续片仅 index+arguments 增量——
 *   适配层按 index 记录开着的调用，替后续片补回 id（拼串职责归消费方）。
 * - 末尾 `usage` 对象（choices 为空）          → {type:"usage"}；请求带
 *   stream_options.include_usage 才会到达
 * - `data: [DONE]`                             → {type:"done"}，此后不再产出
 *
 * 失败语义：非 2xx 在响应头阶段抛 ProviderHttpError（T-2-03 重试层消费
 * status/Retry-After）；200 之后流中途的畸形帧是 wire 契约破坏，直接抛不重试。
 */

import type { StreamChunk } from "../kernel/events.js";
import type { ModelIdentity } from "./identity.js";
import { ProviderConfigError, parseExtraHeaders, type ProviderConfig } from "./config.js";
import type { AuthMaterial, AuthResolver } from "./auth.js";
import {
  ProviderHttpError,
  toTokenUsage,
  type ChatMessage,
  type ChatRequest,
  type ChatTool,
  type ModelProvider,
} from "./provider.js";

/** 适配层私有展开——J3 的"内核不建模"只约束内核；适配层必须解释自己的配置。 */
export interface OpenAiCompatSettings {
  baseUrl: string;
  apiKey: string;
  /** 服务级自定义请求头（T-P3-137——保留键已在 settings parse 剔除）。 */
  headers?: Record<string, string>;
}

export function parseOpenAiCompatSettings(config: ProviderConfig): OpenAiCompatSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(config.settingsConfig);
  } catch {
    // parseProviderConfig 已保证语法合法，这里只是类型收窄的防御路径
    throw new ProviderConfigError("settingsConfig 不是合法 JSON");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProviderConfigError("openai-compat 的 settingsConfig 必须是 JSON 对象");
  }
  const rec = raw as { [key: string]: unknown };
  const baseUrl = rec["baseUrl"];
  const apiKey = rec["apiKey"];
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new ProviderConfigError("openai-compat 配置缺少非空字符串字段 baseUrl");
  }
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new ProviderConfigError("openai-compat 配置缺少非空字符串字段 apiKey");
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, ...parseExtraHeaders(rec) };
}

/**
 * J13/T-P1-106：authResolver 提供时每次请求前现取鉴权材料（apiKey 覆盖
 * settings 的 Bearer；headers 并入额外头——令牌轮换/安全配置重读的接口面）；
 * 缺省 undefined = 构造期 settings 定死（零行为变化）。resolver 每请求恰好
 * 调用一次，抛错则该请求失败上抛（不吞），provider 可复用（下次重 resolve）。
 */
export function createOpenAiCompatProvider(
  config: ProviderConfig,
  options?: { authResolver?: AuthResolver },
): ModelProvider {
  const settings = parseOpenAiCompatSettings(config);
  return {
    streamChat: async function* (req: ChatRequest) {
      let material: AuthMaterial | undefined;
      if (options?.authResolver !== undefined) {
        material = await options.authResolver.resolve();
      }
      yield* streamChatOpenAi(settings, req, material);
    },
  };
}

async function* streamChatOpenAi(
  settings: OpenAiCompatSettings,
  req: ChatRequest,
  auth?: AuthMaterial,
): AsyncGenerator<StreamChunk> {
  const apiKey = auth?.apiKey ?? settings.apiKey;
  const res = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      ...(settings.headers ?? {}),
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(auth?.headers ?? {}),
    },
    body: JSON.stringify({
      model: req.identity.modelId,
      messages: req.messages.map(toWireMessage),
      ...(req.tools && req.tools.length > 0
        ? { tools: req.tools.map(toWireTool) }
        : {}),
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal: req.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderHttpError(res.status, extractErrorMessage(body, res.status), {
      retryAfter: res.headers.get("retry-after") ?? undefined,
      bodyPreview: body.slice(0, 512),
    });
  }
  if (!res.body) {
    throw new ProviderHttpError(res.status, "响应没有可读的流式 body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const openToolCalls = new Map<number, { id: string }>();
  const finishState: { reason: string | undefined } = { reason: undefined };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let frameEnd: number;
      while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const chunk = parseSseFrame(frame, openToolCalls, finishState);
        if (chunk !== null && chunk !== "done") {
          yield chunk;
          continue;
        }
        if (chunk === "done") {
          yield {
            type: "done",
            ...(finishState.reason !== undefined ? { finishReason: finishState.reason } : {}),
          };
          return;
        }
        if (chunk !== null) yield chunk;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** 解析一个 SSE 帧（`data: …` 行，可能多行拼一载荷）；返回 null 表示帧无产出。 */
function parseSseFrame(
  frame: string,
  openToolCalls: Map<number, { id: string }>,
  finishState: { reason: string | undefined },
): StreamChunk | "done" | null {
  const dataLines: string[] = [];
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith(":") || line === "") continue; // SSE 注释/空行
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const data = dataLines.join("\n");
  if (data === "[DONE]") return "done";

  let wire: unknown;
  try {
    wire = JSON.parse(data);
  } catch {
    throw new Error(`MODEL_WIRE_ERROR: SSE data 载荷不是合法 JSON（前 120 字符：${data.slice(0, 120)}）`);
  }
  const chunk = mapWireChunk(wire, openToolCalls, finishState);
  return chunk;
}

function mapWireChunk(
  wire: unknown,
  openToolCalls: Map<number, { id: string }>,
  finishState: { reason: string | undefined },
): StreamChunk | null {
  if (wire === null || typeof wire !== "object") return null;
  const rec = wire as { [key: string]: unknown };
  const usage = rec["usage"];
  if (usage !== null && usage !== undefined) {
    return { type: "usage", usage: toTokenUsage(usage as Parameters<typeof toTokenUsage>[0]) };
  }
  const choices = rec["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const choice = choices[0];
  if (choice === null || typeof choice !== "object") return null;
  // B20/T-P1-62：记最近的 finish_reason（OpenAI wire 语义——随最后一个
  // choices 帧出现、在 [DONE] 之前），供 done chunk 携带（此前被丢弃）
  const finishReason = (choice as { [key: string]: unknown })["finish_reason"];
  if (typeof finishReason === "string" && finishReason !== "") {
    finishState.reason = finishReason;
  }
  const delta = (choice as { [key: string]: unknown })["delta"];
  if (delta === null || typeof delta !== "object") return null;

  // 一个 wire chunk 理论上可同时携带 reasoning/content/tool_calls；按
  // reasoning → content → tool_calls 的产出顺序遍历（reasoning 先于正文）。
  const d = delta as { [key: string]: unknown };
  const reasoning = firstNonEmptyString(d["reasoning_content"], d["reasoning"]);
  if (reasoning !== null) return { type: "reasoning-delta", text: reasoning };
  const content = firstNonEmptyString(d["content"]);
  if (content !== null) return { type: "text-delta", text: content };

  const toolCalls = d["tool_calls"];
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      const chunk = mapToolCallDelta(tc, openToolCalls);
      if (chunk !== null) return chunk;
    }
  }
  return null;
}

function mapToolCallDelta(
  tc: unknown,
  openToolCalls: Map<number, { id: string }>,
): StreamChunk | null {
  if (tc === null || typeof tc !== "object") return null;
  const rec = tc as { [key: string]: unknown };
  const index = typeof rec["index"] === "number" ? rec["index"] : 0;
  const fn = rec["function"];
  const fnRec = fn !== null && typeof fn === "object" ? (fn as { [key: string]: unknown }) : {};
  const id = typeof rec["id"] === "string" ? rec["id"] : undefined;
  const name = typeof fnRec["name"] === "string" ? (fnRec["name"] as string) : undefined;
  const argsDelta = typeof fnRec["arguments"] === "string" ? (fnRec["arguments"] as string) : "";

  const known = openToolCalls.get(index);
  if (id !== undefined) {
    openToolCalls.set(index, { id });
  } else if (known === undefined) {
    throw new Error(
      `MODEL_WIRE_ERROR: tool_call 分片 index=${index} 未携带 id 且此前无同名调用开头`,
    );
  }
  const callId = id ?? known!.id;
  if (argsDelta === "" && name === undefined && id === undefined) return null;
  return { type: "tool-call-delta", id: callId, ...(name !== undefined ? { name } : {}), argsDelta };
}

function toWireMessage(m: ChatMessage): unknown {
  switch (m.role) {
    case "system":
      return { role: m.role, content: m.content };
    case "user":
      // P1/T-P1-124：图片附件 → OpenAI 多模态 content 数组（text 块在前，
      // image_url data URL 块随后）；无 images 零变化（纯字符串 content）。
      if (m.images?.length) {
        return {
          role: "user",
          content: [
            { type: "text", text: m.content },
            ...m.images.map((img) => ({
              type: "image_url",
              image_url: { url: `data:${img.mediaType};base64,${img.data}` },
            })),
          ],
        };
      }
      return { role: "user", content: m.content };
    case "assistant":
      return {
        role: "assistant",
        content: m.toolCalls && m.content === "" ? null : m.content,
        ...(m.toolCalls
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: tc.arguments },
              })),
            }
          : {}),
      };
    case "tool":
      // OpenAI wire 无 isError 位；错误事实靠消息文本本身表达（loop 侧决定措辞）
      return { role: "tool", tool_call_id: m.callId, content: m.content };
  }
}

function toWireTool(t: ChatTool): unknown {
  return {
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

function firstNonEmptyString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v !== "") return v;
  }
  return null;
}

function extractErrorMessage(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { [key: string]: unknown };
    const err = parsed["error"];
    if (err !== null && typeof err === "object") {
      const msg = (err as { [key: string]: unknown })["message"];
      if (typeof msg === "string" && msg !== "") return msg;
    }
  } catch {
    // 非 JSON 错误体，落到下面用状态码
  }
  return `模型端点返回 ${status}`;
}

// ---------------------------------------------------------------------------
// /models 实时发现（J12，T-P1-22）——模型目录的 discovery 回调实现
// ---------------------------------------------------------------------------

/**
 * 探测 OpenAI 兼容端点的 `GET /models`，返回该端点可服务的身份清单
 * （provider = 配置名）。**失败上抛不兜底**：404（端点无 /models 路由）、
 * 网络错、非 JSON 体都由调用方（buildModelCatalog 的兜底纪律）统一捕获
 * ——发现是增量面，失败只影响增量不吞声明行。
 */
export async function discoverOpenAiCompatModels(
  config: ProviderConfig,
  fetchImpl?: typeof fetch,
): Promise<ModelIdentity[]> {
  const settings = parseOpenAiCompatSettings(config);
  const res = await (fetchImpl ?? fetch)(`${settings.baseUrl}/models`, {
    headers: { authorization: `Bearer ${settings.apiKey}` },
  });
  if (!res.ok) {
    throw new ProviderHttpError(res.status, `GET /models 返回 ${String(res.status)}`);
  }
  const body = (await res.json()) as { data?: unknown };
  if (!Array.isArray(body.data)) {
    throw new ProviderHttpError(res.status, "GET /models 响应缺少 data 数组");
  }
  const identities: ModelIdentity[] = [];
  for (const row of body.data) {
    if (row === null || typeof row !== "object") continue;
    const id = (row as { [key: string]: unknown })["id"];
    if (typeof id !== "string" || id === "") continue;
    identities.push({ provider: config.name, modelId: id });
  }
  return identities;
}
