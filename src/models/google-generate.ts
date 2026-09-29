/**
 * Google Generative AI 适配层（T-P3-137——generateContent wire 的内核契约
 * 映射，与 openai-compat/anthropic-messages 同构）：streamGenerateContent
 * SSE（alt=sse）→ 词汇表 StreamChunk。
 *
 * wire 映射表：
 * - SSE `data: {candidates:[{content:{parts:[{text|thought|functionCall}]},
 *   finishReason}], usageMetadata}` →
 *   parts[].text（thought:true → reasoning-delta；否则 text-delta）/
 *   functionCall → tool-call-delta（google 无 callId——按序生成 `call_N`，
 *   name 首片携带）/ usageMetadata → usage / finishReason → done；
 * - 流自然结束（无 [DONE] 帧）→ 读取完成后产出 done。
 *
 * 请求形状：contents[].parts（user 文本+inlineData 图片 / model 的
 * functionCall / user 的 functionResponse）；system 消息收拢
 * systemInstruction；tools → functionDeclarations。
 *
 * L1 纪律同源：本文件只解释 wire，不写任何第二份轨迹存储。
 */

import type { StreamChunk, TokenUsage } from "../kernel/events.js";
import { ProviderHttpError, type ChatMessage, type ChatRequest, type ChatTool, type ModelProvider } from "./provider.js";
import { ProviderConfigError, parseExtraHeaders, type ProviderConfig } from "./config.js";
import type { AuthMaterial, AuthResolver } from "./auth.js";
import type { ModelIdentity } from "./identity.js";

export interface GoogleGenerateSettings {
  baseUrl: string;
  apiKey: string;
  /** 服务级自定义请求头（T-P3-137——保留键已在 settings parse 剔除）。 */
  headers?: Record<string, string>;
}

export function parseGoogleGenerateSettings(config: ProviderConfig): GoogleGenerateSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(config.settingsConfig);
  } catch {
    throw new ProviderConfigError("settingsConfig 不是合法 JSON");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProviderConfigError("google 的 settingsConfig 必须是 JSON 对象");
  }
  const rec = raw as { [key: string]: unknown };
  const baseUrl = rec["baseUrl"];
  const apiKey = rec["apiKey"];
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new ProviderConfigError("google 配置缺少非空字符串字段 baseUrl");
  }
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new ProviderConfigError("google 配置缺少非空字符串字段 apiKey");
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, ...parseExtraHeaders(rec) };
}

export function createGoogleGenerateProvider(
  config: ProviderConfig,
  options?: { authResolver?: AuthResolver },
): ModelProvider {
  const settings = parseGoogleGenerateSettings(config);
  return {
    streamChat: async function* (req: ChatRequest) {
      const material = options?.authResolver !== undefined ? await options.authResolver.resolve() : undefined;
      yield* streamChatGoogle(settings, req, material);
    },
  } satisfies ModelProvider;
}

/** base 收敛到 /v1beta（官方 https://generativelanguage.googleapis.com）。 */
function googleBase(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return /\/v1(beta)?$/.test(base) ? `${base}beta` : /\/v1$/.test(base) ? `${base}beta` : `${base}/v1beta`;
}

function toGoogleParts(
  m: ChatMessage,
  callNames: Map<string, string>,
): { role: "user" | "model"; parts: unknown[] } {
  if (m.role === "user") {
    const parts: unknown[] = [{ text: m.content }];
    for (const img of m.images ?? []) {
      parts.push({ inlineData: { mimeType: img.mediaType, data: img.data } });
    }
    return { role: "user", parts };
  }
  if (m.role === "assistant") {
    const parts: unknown[] = [];
    if (m.content !== "") parts.push({ text: m.content });
    for (const tc of m.toolCalls ?? []) {
      let args: unknown = {};
      try {
        args = JSON.parse(tc.arguments || "{}");
      } catch {
        args = {};
      }
      parts.push({ functionCall: { name: tc.name, args } });
    }
    return { role: "model", parts };
  }
  if (m.role === "tool") {
    // functionResponse 挂 user 轮（google wire 语义）；name 按 callId 回溯
    const name = callNames.get(m.callId) ?? m.callId;
    return { role: "user", parts: [{ functionResponse: { name, response: { result: m.content } } }] };
  }
  return { role: "user", parts: [{ text: "" }] };
}

/** callId → 工具名回溯表（assistant 轮建立——functionResponse 需要 name）。 */
const callNameById = new Map<string, string>();

function toGoogleContents(messages: readonly ChatMessage[]): {
  contents: unknown[];
  systemInstruction?: unknown;
  callNames: Map<string, string>;
} {
  const contents: unknown[] = [];
  const systemParts: unknown[] = [];
  const callNames = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push({ text: m.content });
      continue;
    }
    if (m.role === "assistant") {
      for (const tc of m.toolCalls ?? []) callNames.set(tc.id, tc.name);
    }
    const converted = toGoogleParts(m, callNames);
    // 连续同 role 合并（google 要求 user/model 交替——system 外的 tool 帧
    // 已转 user；相邻 model+user 由上游 loop 保证，这里只兜底合并）
    const last = contents[contents.length - 1] as { role: string; parts: unknown[] } | undefined;
    if (last !== undefined && last.role === converted.role) {
      last.parts.push(...converted.parts);
    } else {
      contents.push(converted);
    }
  }
  return {
    contents,
    ...(systemParts.length > 0 ? { systemInstruction: { parts: systemParts } } : {}),
    callNames,
  };
}

function toGoogleTools(tools: readonly ChatTool[]): unknown {
  return {
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  };
}

async function* streamChatGoogle(
  settings: GoogleGenerateSettings,
  req: ChatRequest,
  auth?: AuthMaterial,
): AsyncGenerator<StreamChunk> {
  const apiKey = auth?.apiKey ?? settings.apiKey;
  const { contents, systemInstruction, callNames } = toGoogleContents(req.messages);
  const finishState: { reason: string | undefined } = { reason: undefined };
  let toolCallSeq = 0;
  const nextCallId = () => `call_${++toolCallSeq}`;
  const url = `${googleBase(settings.baseUrl)}/models/${encodeURIComponent(req.identity.modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...(settings.headers ?? {}),
      "content-type": "application/json",
      ...(auth?.headers ?? {}),
    },
    body: JSON.stringify({
      contents,
      ...(systemInstruction !== undefined ? { systemInstruction } : {}),
      ...(req.tools && req.tools.length > 0 ? { tools: [toGoogleTools(req.tools)] } : {}),
    }),
    signal: req.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderHttpError(res.status, `HTTP ${res.status}：${body.slice(0, 200)}`, {
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
  try {
    for (;;) {
      const { done: eof, value } = await reader.read();
      if (eof) break;
      buffer += decoder.decode(value, { stream: true });
      let frameEnd: number;
      while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        for (const chunk of parseGoogleFrame(frame, nextCallId, finishState, callNames)) {
          if (chunk.type !== "done-marker") yield chunk;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield {
    type: "done",
    ...(finishState.reason !== undefined ? { finishReason: finishState.reason } : {}),
  };
}

/** 内部哨兵：帧里出现 finishReason（done 的携带时机在流末尾统一产出）。 */
type DoneMarker = { type: "done-marker" };

function* parseGoogleFrame(
  frame: string,
  nextCallId: () => string,
  finishState: { reason: string | undefined },
  callNames: Map<string, string>,
): Generator<StreamChunk | DoneMarker> {
  const dataLines: string[] = [];
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith(":") || line === "") continue;
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return;
  let wire: unknown;
  try {
    wire = JSON.parse(dataLines.join("\n"));
  } catch {
    throw new Error(`MODEL_WIRE_ERROR: SSE data 载荷不是合法 JSON（前 120 字符：${dataLines.join("\n").slice(0, 120)}）`);
  }
  if (wire === null || typeof wire !== "object") return;
  const rec = wire as { [key: string]: unknown };
  const usageMeta = rec["usageMetadata"];
  if (usageMeta !== null && typeof usageMeta === "object") {
    const u = usageMeta as { [key: string]: unknown };
    const num = (v: unknown) => (typeof v === "number" && v >= 0 ? v : 0);
    const usage: TokenUsage = {
      inputTokens: num(u["promptTokenCount"]),
      outputTokens: num(u["candidatesTokenCount"]),
      totalTokens: num(u["totalTokenCount"]),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    yield { type: "usage", usage };
  }
  const candidates = rec["candidates"];
  if (!Array.isArray(candidates) || candidates.length === 0) return;
  const candidate = candidates[0] as { [key: string]: unknown };
  const finish = candidate["finishReason"];
  if (typeof finish === "string" && finish !== "") {
    finishState.reason = finish;
    yield { type: "done-marker" };
  }
  const content = candidate["content"];
  if (content === null || typeof content !== "object") return;
  const parts = (content as { [key: string]: unknown })["parts"];
  if (!Array.isArray(parts)) return;
  for (const part of parts) {
    if (part === null || typeof part !== "object") continue;
    const p = part as { [key: string]: unknown };
    if (p["functionCall"] !== null && typeof p["functionCall"] === "object") {
      const fc = p["functionCall"] as { [key: string]: unknown };
      const name = typeof fc["name"] === "string" ? fc["name"] : undefined;
      if (name === undefined) continue;
      const id = nextCallId();
      callNames.set(id, name);
      const args = fc["args"] !== undefined ? JSON.stringify(fc["args"]) : "{}";
      yield { type: "tool-call-delta", id, name, argsDelta: args };
      continue;
    }
    const text = typeof p["text"] === "string" ? p["text"] : "";
    if (text === "") continue;
    if (p["thought"] === true) {
      yield { type: "reasoning-delta", text };
    } else {
      yield { type: "text-delta", text };
    }
  }
}
