/**
 * 真 LLM 摘要器（F5/T-P1-18；F11/T-P1-101 升级为三级兜底链的摘要侧）——
 * 压缩路径的模型调用消费装配注入的 ModelProvider（与 loop 同一 provider，
 * withRetry 的组合点不变——本层重试是其上的摘要侧第二道，只认瞬态分类）。
 *
 * 取 qwen·session-recap 设计的纪律：一次性旁路调用（tools 缺省不带）、
 * 独立 system 指令（替代主 agent 角色）、<title>/<summary> 标签提取带
 * 回退档（推理前导由流式 reasoning-delta 天然分离，缺标签时整段直用）。
 *
 * F11 一级/三级（ADR 0282/0302）：瞬态失败有界重试（2s/4s/8s，仅 J26
 * 显式可重试 status）→ 尺寸预检（contextWindow 提供时）→ 超预算分块摘要
 * （连续切块、链式 update-the-summary、至多 16 请求、usage 求和）。终态
 * 失败/空输出/超请求上限 → 抛 SummaryGenerationError（failureReason 闭集）
 * ——**兜底裁决在引擎**（F11 二级近期窗口检查点，compaction.ts），本层
 * 不再静默回退截断摘要（原 best-effort 行为被 F11 链取代）。
 *
 * 可观测（B7 验收②的副调用面）：每次摘要调用前落 `request/header
 * {reason: "compaction"}`——主轮请求头之外，副调用在事件流上可区分
 * （reason 枚举扩展一值，l0-events.md §8 落地记录 7）。
 */

import type { ModelIdentity } from "../models/identity.js";
import type { ChatMessage, ModelProvider } from "../models/provider.js";
import { ProviderHttpError } from "../models/provider.js";
import { isRetryableStatus } from "../models/retry.js";
import type { TokenUsage } from "../kernel/events.js";
import type { SessionStore } from "../session/store.js";
import { estimateMessagesTokens, estimateTextTokens } from "./overflow.js";
import {
  type Summarizer,
  type SummarizerOutput,
} from "./compaction.js";

/**
 * P0 内置摘要器：声明性前缀 + 拼接截断（原在 kernel/assembly.ts，T-P1-18
 * 随真摘要器移入 context 层——context 不反向依赖 kernel/assembly）。真
 * LLM 摘要器的降级回退面。
 */
export function truncatingSummarizer(maxChars = 2000): Summarizer {
  return async ({ messages }) => {
    const text = messages
      .map((m) => `[${m.role}] ${m.content}`)
      .join("\n");
    return (
      text.length > maxChars
        ? `${text.slice(0, maxChars)}…（自动摘要截断）`
        : text
    );
  };
}

/** 摘要指令（qwen RECAP_SYSTEM_PROMPT 的压缩版改写；装配可整段覆盖）。 */
export const SUMMARY_SYSTEM_PROMPT = [
  "你是会话摘要员，把一段 agent 工作对话压缩成后续模型可见的交接摘要。",
  "保留：任务目标、已做出的关键决定、涉及的重要文件路径、当前进度、明确的下一步。",
  "丢弃：工具输出原文、重复试错过程、与任务无关的寒暄。",
  "总长不超过 500 字，使用对话的主导语言，纯文本（不用 markdown 列表与标题）。",
  '输出格式：第一行 <title>不超过 16 字的会话标题</title>，随后 <summary>摘要正文</summary>。',
  "只输出这两个标签，不要任何其他文字。",
].join("\n");

export interface LlmSummarizerDeps {
  provider: ModelProvider;
  /** 摘要调用的模型身份（J4 二元组；随 config 进 request/header）。 */
  identity: ModelIdentity;
  /** 落 request/header 的事件存储（与压缩引擎同一会话流）。 */
  store: SessionStore;
  /** 覆盖内置摘要指令时整段替换（测试/调优面）。 */
  systemPrompt?: string;
  /** 降级与告警的观测口（装配接 logger.warn）。 */
  onWarn?: (message: string) => void;
  /**
   * F11/T-P1-101：上下文窗口（token）——提供时启用尺寸预检与分块摘要
   * （请求预算 = contextWindow − 摘要输出预留）；缺省 undefined = 不预检
   * 不分块（P0 面，行为同前）。
   */
  contextWindow?: number;
  /** F11：重试等待实现（测试注入 mock 时钟）；缺省真实 setTimeout。 */
  sleep?: (ms: number) => Promise<void>;
  /** F11：瞬态失败重试次数（缺省 3——ADR 0282 COMPACTION_SUMMARY_RETRY_POLICY）。 */
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// F11 一级：有界重试 + 尺寸预检 + 分块摘要（ADR 0282/0302 的我方位）
// ---------------------------------------------------------------------------

/** ADR 0302 failureReason 闭集的摘要器侧子集（引擎侧补 no_new_history / checkpoint_oversized）。 */
export type SummaryFailureReason = "summary_provider" | "summary_budget";

/** 摘要生成的类型化失败——engine 据此走 F11 兜底并把 failureReason 落流。 */
export class SummaryGenerationError extends Error {
  override readonly name = "SummaryGenerationError";
  constructor(
    readonly failureReason: SummaryFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "SummaryGenerationError";
  }
}

/** ADR 0282 重试节奏：3 次重试、2s/4s/8s 退避（"A flapping provider costs at most ~14s"）。 */
const RETRY_BACKOFF_MS = [2_000, 4_000, 8_000] as const;
/** 摘要输出的 token 预留（请求预算 = contextWindow − 本值；卡内定形）。 */
const SUMMARY_OUTPUT_BUDGET_TOKENS = 512;
/** 分块请求上限（ADR 0302 "at most 16 requests"；超出按 summary_budget 兜底）。 */
export const MAX_SUMMARY_CHUNKS = 16;

export function createLlmSummarizer(deps: LlmSummarizerDeps): Summarizer {
  const systemPrompt = deps.systemPrompt ?? SUMMARY_SYSTEM_PROMPT;
  const maxRetries = deps.maxRetries ?? 3;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return async (input) => {
    const { sessionId, turn } = input.invocation;
    // 副调用先落头（reason: "compaction"——与主轮 initial/series 可区分）
    deps.store.append(sessionId, [
      {
        type: "request/header",
        turn,
        config: {
          provider: deps.identity.provider,
          modelId: deps.identity.modelId,
        },
        reason: "compaction",
      },
    ]);
    try {
      // F11 尺寸预检（ADR 0282 决策 2）：按真实请求载荷估算（被摘要区间
      // 已转写为两消息），超预算走分块链——不跳过模型。
      const budget =
        deps.contextWindow !== undefined
          ? deps.contextWindow - SUMMARY_OUTPUT_BUDGET_TOKENS
          : undefined;
      if (budget !== undefined) {
        const messages = [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: transcriptOf(input.messages) },
        ];
        const estimate = estimateMessagesTokens(messages);
        if (estimate > budget) {
          return await summarizeChunked(deps, input, systemPrompt, budget, sleep, maxRetries);
        }
      }
      // 单请求路径：有界重试 → 解析
      const text = await requestWithRetry(
        deps,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: transcriptOf(input.messages) },
        ],
        sleep,
        maxRetries,
      ).then((r) => r.text);
      const parsed = parseSummaryOutput(text);
      if (parsed !== null) return parsed;
      throw new SummaryGenerationError("summary_provider", "摘要输出为空");
    } catch (e) {
      if (e instanceof SummaryGenerationError) throw e;
      throw new SummaryGenerationError(
        "summary_provider",
        `摘要调用失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
}

/** 被摘要区间转写为旁路调用的 user 消息（qwen filterToDialog 同题：tool 噪声由引擎的 messages 构造面决定，这里原样转写）。 */
function transcriptOf(messages: ChatMessage[]): string {
  return messages.map((m) => `${chatLabel(m.role)}：${m.content}`).join("\n\n");
}

/**
 * 有界瞬态重试（F11 一级，ADR 0282 决策 1）：仅 J26 显式可重试 status 的
 * ProviderHttpError 重试（quota/auth/坏请求首试即返、未知错误一次不打——
 * 与 withRetry 同分类），2s/4s/8s 退避；每次尝试留 warn（onWarn 可检索）。
 * 返回文本与收到的 usage（分块路径求和用）。
 */
async function requestWithRetry(
  deps: LlmSummarizerDeps,
  messages: ChatMessage[],
  sleep: (ms: number) => Promise<void>,
  maxRetries: number,
): Promise<{ text: string; usage?: TokenUsage }> {
  let lastError: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      let text = "";
      let usage: TokenUsage | undefined;
      for await (const chunk of deps.provider.streamChat({
        identity: deps.identity,
        messages,
      })) {
        if (chunk.type === "text-delta") text += chunk.text;
        else if (chunk.type === "usage") usage = chunk.usage;
        else if (chunk.type === "done") break;
      }
      return { text, usage };
    } catch (e) {
      lastError = e;
      const retryable =
        e instanceof ProviderHttpError && isRetryableStatus(e.status);
      if (!retryable || attempt >= maxRetries) break;
      const delayMs = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]!;
      deps.onWarn?.(
        `llm-summarizer: 摘要请求瞬态失败，重试 ${String(attempt + 1)}/${String(maxRetries)}（${String(delayMs)}ms 后）：${e.message}`,
      );
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/**
 * 分块摘要（F11 三级，ADR 0302）：预算装不下的被摘要区间按连续消息贪心
 * 切块（每块至少一条消息），链式 update-the-summary（块 i 输入 = 前块摘要 +
 * 本块原文），至多 16 请求、usage 求和；超上限抛 summary_budget（引擎兜底）。
 */
async function summarizeChunked(
  deps: LlmSummarizerDeps,
  input: Parameters<Summarizer>[0],
  systemPrompt: string,
  budget: number,
  sleep: (ms: number) => Promise<void>,
  maxRetries: number,
): Promise<SummarizerOutput> {
  const body = input.messages;
  // 贪心切块：连续消息累积至预算上限；单条超预算也自成一块（不丢消息）
  const chunks: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  let currentEstimate = 0;
  for (const m of body) {
    const cost = estimateTextTokens(`${chatLabel(m.role)}：${m.content}`);
    if (current.length > 0 && currentEstimate + cost > budget) {
      chunks.push(current);
      current = [];
      currentEstimate = 0;
    }
    current.push(m);
    currentEstimate += cost;
  }
  if (current.length > 0) chunks.push(current);
  if (chunks.length > MAX_SUMMARY_CHUNKS) {
    throw new SummaryGenerationError(
      "summary_budget",
      `被摘要区间需 ${String(chunks.length)} 块，超过 ${String(MAX_SUMMARY_CHUNKS)} 请求上限`,
    );
  }
  deps.onWarn?.(
    `llm-summarizer: 摘要输入超预算，分块摘要 ${String(chunks.length)} 块`,
  );
  let acc: string | undefined;
  let usageSum: TokenUsage | undefined;
  for (const [i, chunk] of chunks.entries()) {
    const user =
      acc === undefined
        ? transcriptOf(chunk)
        : `此前部分摘要：\n${acc}\n\n继续摘要以下后续内容：\n${transcriptOf(chunk)}`;
    const { text, usage } = await requestWithRetry(
      deps,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: user },
      ],
      sleep,
      maxRetries,
    );
    const parsed = parseSummaryOutput(text);
    if (parsed === null) {
      throw new SummaryGenerationError(
        "summary_provider",
        `第 ${String(i + 1)} 块摘要输出为空`,
      );
    }
    acc = typeof parsed === "string" ? parsed : parsed.summary;
    if (usage !== undefined) {
      usageSum =
        usageSum === undefined
          ? usage
          : {
              inputTokens: usageSum.inputTokens + usage.inputTokens,
              outputTokens: usageSum.outputTokens + usage.outputTokens,
              ...(usageSum.totalTokens !== undefined || usage.totalTokens !== undefined
                ? {
                    totalTokens:
                      (usageSum.totalTokens ?? 0) + (usage.totalTokens ?? usage.inputTokens + usage.outputTokens),
                  }
                : {}),
              ...(usageSum.cacheReadTokens !== undefined || usage.cacheReadTokens !== undefined
                ? {
                    cacheReadTokens:
                      (usageSum.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0),
                  }
                : {}),
            };
    }
  }
  return { summary: acc!, ...(usageSum !== undefined ? { usage: usageSum } : {}) };
}

/** ChatMessage 角色的转写标签。 */
function chatLabel(role: ChatMessage["role"]): string {
  switch (role) {
    case "system":
      return "系统";
    case "user":
      return "用户";
    case "assistant":
      return "助手";
    case "tool":
      return "工具";
  }
}

/** 提取一对标签内容；只有开标签（截断）时取其后全部；缺失返回 null。 */
function extractTag(text: string, tag: string): string | null {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const openAt = text.indexOf(open);
  if (openAt < 0) return null;
  const closeAt = text.indexOf(close, openAt + open.length);
  if (closeAt >= 0) return text.slice(openAt + open.length, closeAt);
  return text.slice(openAt + open.length);
}

/**
 * qwen extractRecap 的回退档纪律：双标签 → 标题 + 摘要（首选）；只有
 * summary 开标签（maxOutputTokens 截断）→ 取其后全部；标签全缺 → 整段
 * 作为摘要（无标题）——副调用输出是压缩摘要不是 UI 展示，"宁用原文
 * 不空摘要"；空输出 → null（上层回退截断摘要）。
 */
export function parseSummaryOutput(text: string): SummarizerOutput | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const rawSummary = extractTag(trimmed, "summary");
  const summary = rawSummary !== null ? rawSummary.trim() : trimmed;
  if (summary === "") return null;
  const title = extractTag(trimmed, "title");
  return {
    summary,
    ...(title !== null && title.trim() !== "" ? { title: title.trim() } : {}),
  };
}
