/**
 * webfetch 工具（B8a，T-P1-20；T-P3-174 批次 1 增强——zcode/qwen 对齐）。
 * 纪律：
 *   - **网络经 D3 唯一入口**：fetch 必须 NetworkGuard.fetch（接线纪律与
 *     D4 同款——网络类工具不得直接使用全局 fetch）；deny 档在任何真实
 *     I/O 之前拒绝（NetworkDeniedError，错误含目标 URL 供模型自纠）。
 *   - **截断走 B5 统一出口**：本工具不做自己的截断——registry.dispatch
 *     的 boundOutput 负责超限落 spill 并告知模型完整输出位置（T-P1-14
 *     的 GC 防堆积）；本工具只做响应体硬上限（5MB，opencode 同款）防
 *     无界读入内存。
 *   - **15 分钟结果缓存**（zcode webfetch-cache 同构）：进程内 Map + TTL
 *     15min + LRU（命中重插）+ 总量 50MB/单条 2MB 上限；只缓存成功文本
 *     响应（错误/重定向/二进制不缓存——失败不缓存是诚实面）。
 *   - **GitHub blob→raw 重写**（qwen web-fetch 同构，build 期应用）：权限
 *     判定与实际请求看到同一目标 host；host 精确匹配（lookalike 不触发）。
 *   - **HTTP→HTTPS 升级**（qwen 同构）：非私有 host 且无显式端口才升级；
 *     升级失败用原 http 重试一次（fallback 结果不写缓存）。
 *   - **跨域重定向返回不跟随**（qwen 同构）：redirect: manual 自管——同
 *     源（协议+端口+stripWww 同 host）自动跟随至多 5 跳；跨源返回重定向
 *     指引（模型可显式再取）。
 *   - 文本化：正文按 UTF-8 解码原样回喂；二进制 MIME 不回喂正文只报形状。
 *   - 错误分层：可预期失败一律 isError 回喂（模型可自修），不上抛。
 * 只读工具（B17 parallel 声明：网络读无本地副作用）。
 */

import type { NetworkGuard } from "../../../sandbox/network.js";
import { NetworkDeniedError, NetworkImdsDeniedError } from "../../../sandbox/network.js";
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

/** 同源重定向跟随上限（qwen 最多 10 跳的同源子集——aegent 面更窄取 5）。 */
const MAX_SAME_ORIGIN_REDIRECTS = 5;

// ---------------------------------------------------------------------------
// 15 分钟结果缓存（zcode webfetch-cache 同构：Map 保序 LRU + 惰性过期）
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const CACHE_MAX_ENTRY_BYTES = 2 * 1024 * 1024;

interface WebfetchCacheEntry {
  content: string;
  meta: JsonRecord;
  expiresAt: number;
  sizeBytes: number;
}

const fetchCache = new Map<string, WebfetchCacheEntry>();
let fetchCacheBytes = 0;

function cacheGet(key: string): WebfetchCacheEntry | undefined {
  const entry = fetchCache.get(key);
  if (entry === undefined) return undefined;
  if (entry.expiresAt <= Date.now()) {
    fetchCache.delete(key);
    fetchCacheBytes -= entry.sizeBytes;
    return undefined;
  }
  // LRU：命中重插到 Map 尾部（Map 保序）
  fetchCache.delete(key);
  fetchCache.set(key, entry);
  return entry;
}

function cachePut(key: string, content: string, meta: JsonRecord): void {
  const sizeBytes = Buffer.byteLength(content, "utf8");
  // 单条超上限不入缓存（zcode 同款——大响应放弃了缓存价值）
  if (sizeBytes > CACHE_MAX_ENTRY_BYTES) return;
  const previous = fetchCache.get(key);
  if (previous !== undefined) fetchCacheBytes -= previous.sizeBytes;
  fetchCache.set(key, {
    content,
    meta,
    expiresAt: Date.now() + CACHE_TTL_MS,
    sizeBytes,
  });
  fetchCacheBytes += sizeBytes;
  // 先清过期，再从最旧开始淘汰回总量内
  const now = Date.now();
  for (const [k, v] of fetchCache) {
    if (v.expiresAt <= now) {
      fetchCache.delete(k);
      fetchCacheBytes -= v.sizeBytes;
    }
  }
  while (fetchCacheBytes > CACHE_MAX_TOTAL_BYTES) {
    const oldest = fetchCache.keys().next();
    if (oldest.done === true) break;
    const entry = fetchCache.get(oldest.value);
    fetchCache.delete(oldest.value);
    if (entry !== undefined) fetchCacheBytes -= entry.sizeBytes;
  }
}

/** 测试隔离面：清空缓存（进程级可变全局——O25 同款显式重置纪律）。 */
export function resetWebfetchCacheForTests(): void {
  fetchCache.clear();
  fetchCacheBytes = 0;
}

// ---------------------------------------------------------------------------
// GitHub blob→raw 重写（qwen web-fetch rewriteGitHubBlobUrl 同构）
// ---------------------------------------------------------------------------

/**
 * github.com（含 www 形态）的 `/owner/repo/blob/...` 页面是 HTML 壳；raw
 * host 直出文件本体。host 精确匹配（子串 lookalike 永不触发）；非 blob
 * 路径原样返回；解析失败原样返回。
 */
export function rewriteGitHubBlobUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") return url;
    const rawPath = parsed.pathname.replace(/^(\/[^/]+\/[^/]+)\/blob\//, "$1/");
    if (rawPath === parsed.pathname) return url;
    parsed.hostname = "raw.githubusercontent.com";
    parsed.pathname = rawPath;
    return parsed.toString();
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// HTTP→HTTPS 升级（qwen computeFetchPlan 同构：非私有 host 且无显式端口）
// ---------------------------------------------------------------------------

/** 私有/本机 host 判定（升级豁免面——localhost/私网/本地开发不被升级）。 */
function isPrivateHttpHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "::1" ||
    h === "0.0.0.0" ||
    h.endsWith(".local") ||
    h.endsWith(".localhost") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h)
  );
}

export function upgradeHttpToHttps(url: string): { url: string; upgradedFrom?: string } {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "http:" ||
      isPrivateHttpHost(parsed.hostname) ||
      parsed.port !== ""
    ) {
      return { url };
    }
    parsed.protocol = "https:";
    return { url: parsed.toString(), upgradedFrom: url };
  } catch {
    return { url };
  }
}

// ---------------------------------------------------------------------------
// 同源重定向判定（qwen isPermittedRedirect 同构：协议+端口+stripWww 同 host）
// ---------------------------------------------------------------------------

function stripWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function isSameOriginRedirect(original: URL, target: URL): boolean {
  if (original.protocol !== target.protocol) return false;
  if (original.port !== target.port) return false;
  if (target.username !== "" || target.password !== "") return false;
  return stripWww(original.hostname) === stripWww(target.hostname);
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

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
          description:
            "要抓取的 URL（http:// 或 https://）。GitHub blob 页面自动重写为 raw 地址。" +
            "响应缓存 15 分钟（同 URL 命中缓存）。",
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

      // 缓存命中（key = 调用方原始 URL——zcode 同款；规范化只影响实际请求）
      const cached = cacheGet(url);
      if (cached !== undefined) {
        return webfetchOk(cached.content, { ...cached.meta, cacheHit: true });
      }

      // build 期重写（blob→raw）——守卫与请求看到同一目标
      const rewritten = rewriteGitHubBlobUrl(url);
      const { url: upgradedUrl, upgradedFrom } = upgradeHttpToHttps(rewritten);
      const fetchOnce = async (target: string): Promise<Response> =>
        options.guard.fetch(target, {
          redirect: "manual", // 跨域重定向返回不跟随（本工具自管同源跳转）
          signal: AbortSignal.timeout(timeoutSeconds * 1000),
          headers: { "user-agent": "aegent-webfetch/1.0" },
        });

      let response: Response;
      try {
        response = await fetchWithRedirects(upgradedUrl, fetchOnce);
      } catch (e) {
        // HTTPS 升级失败回退原 http 一次（qwen 同构；fallback 结果不写缓存）
        if (upgradedFrom !== undefined && isNetworkLevelError(e)) {
          try {
            response = await fetchWithRedirects(upgradedFrom, fetchOnce);
          } catch (e2) {
            return toFetchError(e2, url, timeoutSeconds);
          }
          const fallback = await toToolResult(response, url, undefined);
          return fallback;
        }
        return toFetchError(e, url, timeoutSeconds);
      }
      return toToolResult(response, url, upgradedFrom);
    },
  };

  /** 同源重定向自管循环：manual redirect 后同源 3xx 跟随至多 5 跳；跨源抛 CrossOriginRedirectError。 */
  async function fetchWithRedirects(
    firstUrl: string,
    fetchOnce: (target: string) => Promise<Response>,
  ): Promise<Response> {
    let current = firstUrl;
    for (let hop = 0; hop <= MAX_SAME_ORIGIN_REDIRECTS; hop++) {
      const response = await fetchOnce(current);
      if (
        !REDIRECT_STATUSES.has(response.status) ||
        response.headers.get("location") === null
      ) {
        return response;
      }
      const location = response.headers.get("location") ?? "";
      const target = new URL(location, current);
      if (!isSameOriginRedirect(new URL(current), target)) {
        throw new CrossOriginRedirectError(current, target.toString(), response.status);
      }
      current = target.toString();
    }
    throw new CrossOriginRedirectError(
      firstUrl,
      "",
      0,
      `同源重定向超过 ${String(MAX_SAME_ORIGIN_REDIRECTS)} 跳`,
    );
  }

  async function toToolResult(
    response: Response,
    originalUrl: string,
    upgradedFrom: string | undefined,
  ): Promise<ToolExecutionResult> {
    if (!response.ok) {
      return webfetchError(
        "HTTP_STATUS",
        `HTTP ${String(response.status)}${response.statusText ? ` ${response.statusText}` : ""}：${originalUrl}`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    const mime = (contentType.split(";")[0] ?? "").trim().toLowerCase();
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_RESPONSE_BYTES) {
      return webfetchError(
        "RESPONSE_TOO_LARGE",
        `响应过大（content-length ${String(contentLength)} 字节 > 上限 ${String(MAX_RESPONSE_BYTES)}）：${originalUrl}`,
      );
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_RESPONSE_BYTES) {
      return webfetchError(
        "RESPONSE_TOO_LARGE",
        `响应过大（${String(buffer.byteLength)} 字节 > 上限 ${String(MAX_RESPONSE_BYTES)}）：${originalUrl}`,
      );
    }
    // 二进制 MIME 只报形状不回喂正文（无附件通道，pi/opencode 的图片
    // 分支不在最小面）
    if (
      mime.startsWith("image/") ||
      mime.startsWith("audio/") ||
      mime.startsWith("video/") ||
      mime === "application/octet-stream" ||
      mime === "application/pdf"
    ) {
      return webfetchOk(
        `二进制响应（${mime || "未知类型"}，${String(buffer.byteLength)} 字节）——正文不回喂。`,
        { url: originalUrl, status: response.status, contentType, bytes: buffer.byteLength, binary: true },
      );
    }
    const text = new TextDecoder().decode(buffer);
    const meta: JsonRecord = {
      url: originalUrl,
      status: response.status,
      contentType,
      bytes: buffer.byteLength,
      ...(upgradedFrom !== undefined ? { upgradedFrom } : {}),
    };
    // 只缓存成功文本响应（错误/二进制不缓存——失败不缓存是诚实面）
    cachePut(originalUrl, text, meta);
    return webfetchOk(text, meta);
  }

  function toFetchError(e: unknown, url: string, timeoutSeconds: number): ToolExecutionResult {
    if (e instanceof CrossOriginRedirectError) {
      // 跨域重定向：返回指引不跟随（qwen 同款文本形态——模型可显式再取）
      return webfetchOk(
        `REDIRECT DETECTED: The URL redirects to a different host (or scheme/port), which was not followed automatically.\n\n` +
          `Original URL: ${e.originalUrl}\n` +
          (e.redirectUrl !== "" ? `Redirect URL: ${e.redirectUrl}\n` : "") +
          (e.status !== 0 ? `Status: ${String(e.status)}\n\n` : "\n") +
          `To fetch the redirected content, call webfetch again with url: "${e.redirectUrl}"`,
        { url, redirect: e.redirectUrl },
      );
    }
    if (e instanceof NetworkDeniedError || e instanceof NetworkImdsDeniedError) {
      // D3 拒绝与 C37 IMDS 防护清单命中都透传类型化 code（可路由）
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
}

class CrossOriginRedirectError extends Error {
  constructor(
    readonly originalUrl: string,
    readonly redirectUrl: string,
    readonly status: number,
    reason?: string,
  ) {
    super(reason ?? `cross-origin redirect from ${originalUrl} to ${redirectUrl}`);
    this.name = "CrossOriginRedirectError";
  }
}

/** 网络级错误判据（HTTPS 升级回退面——HTTP_STATUS 等响应类错误不回退）。 */
function isNetworkLevelError(e: unknown): boolean {
  return (
    !(e instanceof CrossOriginRedirectError) &&
    !(e instanceof NetworkDeniedError) &&
    !(e instanceof NetworkImdsDeniedError) &&
    !(e instanceof TimeoutError) &&
    !(e instanceof Error && e.name === "AbortError")
  );
}
