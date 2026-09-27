/**
 * ACP 适配的 JSON-RPC 行编解码（K4/T-P1-117）——ACP（Agent Client Protocol）
 * 走 JSON-RPC 2.0 over stdio 行协议（xai-acp-lib 同锚：库自身只做通道/信箱、
 * 方法映射薄层）。单行一条消息：
 * - 请求   `{jsonrpc:"2.0", id, method, params}`（id 数字或字符串）
 * - 通知   `{jsonrpc:"2.0", method, params}`（无 id）
 * - 响应   `{jsonrpc:"2.0", id, result}` | `{jsonrpc:"2.0", id, error:{code, message}}`
 *
 * 解析失败抛 JsonRpcParseError（类型化——调用方回 error response 不崩连接，
 * 通知坏行丢弃）。行长度上限复用 agent-protocol 的 MAX_LINE_BYTES。
 */

import { MAX_LINE_BYTES } from "../kernel/agent-protocol.js";

export interface JsonRpcRequest {
  readonly kind: "request";
  readonly id: number | string;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcNotification {
  readonly kind: "notification";
  readonly method: string;
  readonly params?: unknown;
}

export type JsonRpcIncoming = JsonRpcRequest | JsonRpcNotification;

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: number | string;
  readonly result?: unknown;
  readonly error?: { code: number; message: string };
}

export class JsonRpcParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonRpcParseError";
  }
}

/** 解析一行入站消息（请求或通知）；非 JSON/形状错 → JsonRpcParseError。 */
export function parseIncoming(line: string): JsonRpcIncoming {
  if (line.length > MAX_LINE_BYTES) {
    throw new JsonRpcParseError(`行超长（上限 ${MAX_LINE_BYTES} 字符）`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new JsonRpcParseError(
      `非 JSON 行：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new JsonRpcParseError("JSON-RPC 消息必须是对象");
  }
  const record = parsed as Record<string, unknown>;
  if (record["jsonrpc"] !== "2.0") {
    throw new JsonRpcParseError('jsonrpc 字段必须为 "2.0"');
  }
  const method = record["method"];
  if (typeof method !== "string" || method === "") {
    throw new JsonRpcParseError("method 必须为非空字符串");
  }
  const params = record["params"];
  if (params !== undefined && (params === null || typeof params !== "object" || Array.isArray(params))) {
    throw new JsonRpcParseError("params 须为对象（缺省可省）");
  }
  if (record["id"] === undefined) {
    return {
      kind: "notification",
      method,
      ...(params !== undefined ? { params } : {}),
    };
  }
  const id = record["id"];
  if (typeof id !== "number" && typeof id !== "string") {
    throw new JsonRpcParseError("id 须为数字或字符串");
  }
  return {
    kind: "request",
    id,
    method,
    ...(params !== undefined ? { params } : {}),
  };
}

export function encodeResponse(id: number | string, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

export function encodeErrorResponse(
  id: number | string | undefined,
  code: number,
  message: string,
): string {
  // 解析失败时 id 未知 → JSON-RPC 规范的 null id（仍回错误行，不静默丢）。
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

export function encodeNotification(method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", method, params });
}

export function encodeRequest(id: number | string, method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

/** JSON-RPC 标准错误码（解析/方法面）。 */
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
