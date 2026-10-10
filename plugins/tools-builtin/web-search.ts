/**
 * web_search 工具（T-P3-172 需求 1——用户实测"工具不足：模型说没有联网
 * 搜索"的补齐面）。后端 = Exa 托管 MCP（opencode tool/mcp-websearch.ts
 * 同款路线）：一个 HTTP POST JSONRPC + SSE/JSON 双格式解析即完成调用，
 * **无 key 可用**（EXA_API_KEY 可选提升额度），符合本地优先取舍——
 * 不引入 DuckDuckGo scraping（无官方 API、易封 IP，维护成本高于收益）。
 *
 * 纪律（webfetch 同款）：
 *   - 网络经 D3 唯一入口 NetworkGuard.fetch（deny 档在 I/O 前拒绝）；
 *   - 截断走 B5 统一出口（本工具只做 25s 硬超时防挂死）；
 *   - 可预期失败（query 非法/非 2xx/超时/拒绝/MCP 错误）一律 isError
 *     回喂（模型可自修），不上抛。
 * 只读工具（B17 parallel：网络读无本地副作用）。
 */

import type { NetworkGuard } from "../../src/sandbox/network.js";
import { NetworkDeniedError, NetworkImdsDeniedError } from "../../src/sandbox/network.js";
import { toolError } from "./util.js";
import type { ToolDef } from "../../src/core/index.js";
import type { JsonRecord } from "../../src/kernel/events.js";
import type { ToolExecutionResult } from "../../src/kernel/loop.js";

/** 单次请求硬超时（opencode 25s 同款）。 */
const REQUEST_TIMEOUT_MS = 25_000;
/** 缺省结果数（opencode numResults=8 同款）。 */
const DEFAULT_NUM_RESULTS = 8;
const MAX_NUM_RESULTS = 10;
/** 结果文本回喂上限（B5 之外的软保险——超大页清单不吃上下文）。 */
const MAX_RESULT_CHARS = 20_000;

const SEARCH_MONTHS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;

export function createWebSearchTool(options: { guard: NetworkGuard }): ToolDef {
  // zcode websearch 同款：描述注入当前月份（模型对"最新"类查询的锚点）。
  const now = new Date();
  const monthHint = `${now.getFullYear()} 年 ${SEARCH_MONTHS[now.getMonth()]}`;
  const descriptionText =
    `联网搜索当前信息。返回与查询相关的网页结果清单（标题、链接、摘要）。` +
    `当前时间是 ${monthHint}——查询"最新/最近"类话题时在 query 里带上时间限定词可获得更新结果。` +
    `回答时须在结尾附 "Sources:" 来源列表。`;
  return {
    name: "web_search",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
    descriptionText,
    parallel: true, // B17：网络读无本地副作用
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索查询词（中英文均可；查新闻/版本等时效性内容时带上月份）" },
        numResults: { type: "number", description: `返回结果条数（1-${String(MAX_NUM_RESULTS)}，缺省 ${String(DEFAULT_NUM_RESULTS)}）` },
        type: { type: "string", enum: ["auto", "fast", "deep"], description: "搜索深度：auto 自动、fast 快速浅搜、deep 深搜（缺省 auto）" },
      },
      required: ["query"],
    },
    async execute(args) {
      const { query, type } = args as Partial<WebSearchArgs>;
      if (typeof query !== "string" || query.trim() === "") {
        return toolError("WebSearchError", "INVALID_ARGUMENTS", "web_search 需要 query（非空字符串）");
      }
      const rawNum = (args as Partial<WebSearchArgs>).numResults;
      const numResults =
        typeof rawNum === "number" && Number.isInteger(rawNum) && rawNum >= 1 && rawNum <= MAX_NUM_RESULTS
          ? rawNum
          : DEFAULT_NUM_RESULTS;
      const apiKey = process.env["EXA_API_KEY"] ?? "";
      const endpoint = apiKey !== "" ? `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(apiKey)}` : "https://mcp.exa.ai/mcp";
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "web_search_exa",
          arguments: {
            query,
            numResults,
            ...(type !== undefined && type !== "auto" ? { type } : {}),
          },
        },
      });
      let text: string;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let res: Response;
        try {
          res = await options.guard.fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
            body,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) {
          return toolError("WebSearchError", "HTTP_ERROR", `搜索服务返回 ${String(res.status)}——稍后重试或改写查询词`);
        }
        const raw = await res.text();
        text = extractMcpText(raw);
        if (text === "") {
          return toolError("WebSearchError", "EMPTY_RESPONSE", "搜索服务没有返回结果——改写查询词重试");
        }
      } catch (e) {
        if (e instanceof NetworkDeniedError || e instanceof NetworkImdsDeniedError) {
          return toolError("WebSearchError", "NETWORK_DENIED", e.message);
        }
        const msg = e instanceof Error ? e.message : String(e);
        const code = String((e as { code?: unknown }).code ?? "");
        return toolError(
          "WebSearchError",
          code === "ABORT_ERR" || code === "TIMEOUT" ? "TIMEOUT" : "SEARCH_FAILED",
          code === "ABORT_ERR" || code === "TIMEOUT" ? `搜索超时（${String(REQUEST_TIMEOUT_MS / 1000)}s）——改用更具体的查询词` : msg.slice(0, 300),
        );
      }
      if (text.length > MAX_RESULT_CHARS) {
        text = `${text.slice(0, MAX_RESULT_CHARS)}\n\n[结果已截断到 ${String(MAX_RESULT_CHARS)} 字符——用更具体的 query 缩小范围]`;
      }
      const meta: JsonRecord = { query, numResults };
      return { content: text, meta };
    },
  };
}

export interface WebSearchArgs {
  query: string;
  numResults?: number;
  type?: "auto" | "fast" | "deep";
}

/** MCP 响应文本抽取：JSON-RPC 结果与 SSE `data:` 行双格式兼容（opencode
 *  mcp-websearch 同款——服务端按 Accept 协商可能回任一形态）。 */
function extractMcpText(raw: string): string {
  const chunks: string[] = [];
  const scan = (payload: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    const content = (parsed as { result?: { content?: unknown } })?.result?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block !== null && typeof block === "object" && (block as { type?: unknown }).type === "text") {
        const t = (block as { text?: unknown }).text;
        if (typeof t === "string" && t.trim() !== "") chunks.push(t);
      }
    }
  };
  // SSE 形态：逐行 `data: {...}`
  if (raw.includes("data:")) {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) scan(trimmed.slice(5).trim());
    }
  }
  if (chunks.length === 0) scan(raw);
  // MCP isError 载荷（isError:true 的 text 是错误说明——当作结果原样回喂，
  // 模型可读错误自行调整；不再二次包装）
  return chunks.join("\n\n").trim();
}
