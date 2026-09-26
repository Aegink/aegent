/**
 * webfetch 工具（B8a，T-P1-20）——URL 抓取 → 文本化回喂（opencode
 * webfetch 的最小面）。纪律：
 *   - **网络经 D3 唯一入口**：fetch 必须 NetworkGuard.fetch（接线纪律与
 *     D4 同款——网络类工具不得直接使用全局 fetch）；deny 档在任何真实
 *     I/O 之前拒绝（NetworkDeniedError，错误含目标 URL 供模型自纠）。
 *   - **截断走 B5 统一出口**：本工具不做自己的截断——registry.dispatch
 *     的 boundOutput 负责超限落 spill 并告知模型完整输出位置（T-P1-14
 *     的 GC 防堆积）；本工具只做响应体硬上限（5MB，opencode 同款）防
 *     无界读入内存。
 *   - 文本化：正文按 UTF-8 解码原样回喂（HTML→markdown 转换不做——
 *     引 turndown 依赖违反 P1 最小面，原文 + content-type 已够模型用）；
 *     二进制 MIME 不回喂正文只报形状。
 *   - 错误分层：可预期失败（URL 非法/非 2xx/超时/拒绝）一律 isError 回喂
 *     （模型可自修），不上抛（上抛留给基础设施崩溃，loop 兜底）。
 * 只读工具（B17 parallel 声明：网络读无本地副作用）。
 */

import type { NetworkGuard } from "../../../sandbox/network.js";
import { NetworkDeniedError } from "../../../sandbox/network.js";
import { TimeoutError } from "../../timeout.js";
import { toolError } from "./util.js";
import type { ToolDef } from "../registry.js";
import type { JsonRecord } from "../../events.js";
import type { ToolExecutionResult } from "../../loop.js";

/** 响应体硬上限（opencode MAX_RESPONSE_SIZE 同款 5MB）——防无界读入内存。 */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
/** 超时秒数上限（opencode MAX_TIMEOUT 同款 120s）。 */
const MAX_TIMEOUT_SECONDS = 120;
const DEFAULT_TIMEOUT_SECONDS = 30;

export interface WebfetchArgs {
  url: string;
  /** 超时秒数（1..120）；缺省 30。 */
  timeout?: number;
}

function webfetchError(code: string, message: string): ToolExecutionResult {
  return toolError("WebfetchError", code, message);
}

function webfetchOk(content: string, meta: JsonRecord): ToolExecutionResult {
  return { content, meta };
}

export function createWebfetchTool(options: { guard: NetworkGuard }): ToolDef {
  return {
    name: "webfetch",
    parallel: true, // B17：只读（网络读无本地副作用），声明可并行
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "要抓取的 URL（http:// 或 https://）",
        },
        timeout: {
          type: "number",
          description: "超时秒数（1-120，缺省 30）",
        },
      },
      required: ["url"],
    },
    async execute(args) {
      const { url, timeout } = args as Partial<WebfetchArgs>;
      if (typeof url !== "string" || url === "") {
        return webfetchError("INVALID_ARGUMENTS", "webfetch 需要 url（非空字符串）");
      }
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return webfetchError(
          "INVALID_ARGUMENTS",
          `url 必须以 http:// 或 https:// 开头，收到：${url}`,
        );
      }
      if (
        timeout !== undefined &&
        (!Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_TIMEOUT_SECONDS)
      ) {
        return webfetchError(
          "INVALID_ARGUMENTS",
          `timeout 必须是 1-${String(MAX_TIMEOUT_SECONDS)} 的秒数，收到 ${String(timeout)}`,
        );
      }
      const timeoutSeconds = timeout ?? DEFAULT_TIMEOUT_SECONDS;

      // D3：deny 档在真实 I/O 前拒绝（NetworkDeniedError 含目标 URL）
      let response: Response;
      try {
        response = await options.guard.fetch(url, {
          signal: AbortSignal.timeout(timeoutSeconds * 1000),
          headers: { "user-agent": "aegent-webfetch/1.0" },
        });
      } catch (e) {
        if (e instanceof NetworkDeniedError) {
          return webfetchError(e.code, e.message);
        }
        if (e instanceof TimeoutError || (e instanceof Error && e.name === "AbortError")) {
          return webfetchError(
            "TOOL_TIMEOUT",
            `请求在 ${String(timeoutSeconds)} 秒内未完成：${url}`,
          );
        }
        return webfetchError(
          "FETCH_FAILED",
          `请求失败：${url} —— ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (!response.ok) {
        return webfetchError(
          "HTTP_STATUS",
          `HTTP ${String(response.status)}${response.statusText ? ` ${response.statusText}` : ""}：${url}`,
        );
      }
      const contentType = response.headers.get("content-type") ?? "";
      const mime = (contentType.split(";")[0] ?? "").trim().toLowerCase();
      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (contentLength > MAX_RESPONSE_BYTES) {
        return webfetchError(
          "RESPONSE_TOO_LARGE",
          `响应过大（content-length ${String(contentLength)} 字节 > 上限 ${String(MAX_RESPONSE_BYTES)}）：${url}`,
        );
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_RESPONSE_BYTES) {
        return webfetchError(
          "RESPONSE_TOO_LARGE",
          `响应过大（${String(buffer.byteLength)} 字节 > 上限 ${String(MAX_RESPONSE_BYTES)}）：${url}`,
        );
      }
      // 二进制 MIME 只报形状不回喂正文（无附件通道，pi/opencode 的图片
      // 分支不在 P1 最小面）
      if (
        mime.startsWith("image/") ||
        mime.startsWith("audio/") ||
        mime.startsWith("video/") ||
        mime === "application/octet-stream" ||
        mime === "application/pdf"
      ) {
        return webfetchOk(
          `二进制响应（${mime || "未知类型"}，${String(buffer.byteLength)} 字节）——正文不回喂。`,
          { url, status: response.status, contentType, bytes: buffer.byteLength, binary: true },
        );
      }
      const text = new TextDecoder().decode(buffer);
      return webfetchOk(text, {
        url,
        status: response.status,
        contentType,
        bytes: buffer.byteLength,
      });
    },
  };
}
