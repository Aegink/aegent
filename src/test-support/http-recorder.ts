/**
 * HTTP 级录制（L5/T-P2-514）——调试模型交互（opencode·http-recorder 的
 * "请求/响应成对录制 + 掩码 + 回放驱动测试"行为，包结构不取——test-support
 * 单域，known-diffs.md 记档）。
 *
 * 录制开关（env `AEGENT_HTTP_RECORD=1`）——生产缺省关：未开启时 install()
 * 原样返回（零包装、零记录），开了才替换全局 fetch；restore() 恢复原样。
 * 掩码纪律（D14 同源）：authorization 头整值掩码 + 请求/响应体过
 * redactSecrets（sk- 模式）——录制文件入库前必须掩码复核（test-policy）。
 * 回放面：录制样本 → http-mock 脚本（SSE 体 → SseScript，其余 → RawScript），
 * 与 http-mock 的既有回放基建对接（O2/O15 面）。
 */

import { redactSecrets } from "../kernel/logger.js";
import { parseSse, type MockScript, type SseScript, type RawScript } from "./http-mock.js";

type RequestInfoLike = Parameters<typeof fetch>[0];

/** 录制开关环境变量名（生产缺省关——未设置时 install 零包装）。 */
export const HTTP_RECORD_ENV = "AEGENT_HTTP_RECORD";

/** 掩码后的凭证头值。 */
export const AUTH_MASK = "[REDACTED:authorization]";

/** 一对请求/响应的录制条目（敏感字段已掩码）。 */
export interface RecordedExchange {
  ts: number;
  url: string;
  method: string;
  /** 请求头（authorization 掩码）。 */
  requestHeaders: Record<string, string>;
  /** 请求体（文本，redactSecrets 过）。 */
  requestBody: string;
  status: number;
  /** 响应体（文本，redactSecrets 过）。 */
  responseBody: string;
  responseContentType: string;
}

const SENSITIVE_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "x-api-key"]);

function maskHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name] = SENSITIVE_HEADERS.has(name.toLowerCase()) ? AUTH_MASK : redactSecrets(value);
  });
  return out;
}

/** 录制器：替换全局 fetch 成对记录请求/响应（响应体读完后才落记录——流不截断）。 */
export class HttpRecorder {
  private readonly exchanges: RecordedExchange[] = [];
  private originalFetch: typeof fetch | null = null;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  /** 录制开启（env 开关——生产缺省关）。返回是否实际安装了包装。 */
  install(): boolean {
    if (this.env[HTTP_RECORD_ENV] !== "1") return false;
    if (this.originalFetch !== null) return true;
    this.originalFetch = globalThis.fetch;
    const recorder = this;
    globalThis.fetch = (async (input: RequestInfoLike, init?: RequestInit) => {
      const response = await recorder.originalFetch!(input as Parameters<typeof fetch>[0], init);
      await recorder.record(input, init, response);
      return response;
    }) as typeof fetch;
    return true;
  }

  private async record(input: RequestInfoLike, init: RequestInit | undefined, response: Response): Promise<void> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const requestHeaders = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const requestBody =
      typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
    // 响应体克隆读取——调用方仍可消费原响应（流不截断）
    const responseBody = await response.clone().text();
    this.exchanges.push({
      ts: Date.now(),
      url,
      method: init?.method ?? (input instanceof Request ? input.method : "GET"),
      requestHeaders: maskHeaders(requestHeaders),
      requestBody: redactSecrets(requestBody),
      status: response.status,
      responseBody: redactSecrets(responseBody),
      responseContentType: response.headers.get("content-type") ?? "",
    });
  }

  /** 恢复原 fetch（幂等）。 */
  restore(): void {
    if (this.originalFetch !== null) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = null;
    }
  }

  /** 录制条目（只读快照）。 */
  entries(): readonly RecordedExchange[] {
    return [...this.exchanges];
  }
}

/** 录制条目 → JSONL（入库边界：文件级掩码复核由调用方复核——test-policy §3）。 */
export function serializeRecorded(exchanges: readonly RecordedExchange[]): string {
  return exchanges.map((e) => JSON.stringify(e)).join("\n") + (exchanges.length > 0 ? "\n" : "");
}

/** JSONL → 录制条目（roundtrip）。 */
export function parseRecorded(text: string): RecordedExchange[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordedExchange);
}

/**
 * 录制样本 → http-mock 脚本序列（按请求顺序；SSE 体 → SseScript——原始体里的
 * `[DONE]` 剔除（includeDone:false 语义 = 不二次追加），其余 → RawScript）。
 */
export function toHttpMockScripts(exchanges: readonly RecordedExchange[]): MockScript[] {
  return exchanges.map((e) => {
    const isSse = e.responseContentType.includes("text/event-stream");
    if (isSse) {
      const events = parseSse(e.responseBody).filter((line) => line !== "[DONE]");
      const script: SseScript = { events, includeDone: false };
      return script;
    }
    const raw: RawScript = { status: e.status, body: e.responseBody };
    return raw;
  });
}
