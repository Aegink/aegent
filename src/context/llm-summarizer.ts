/**
 * 真 LLM 摘要器（F5/T-P1-18）——P0 的 truncatingSummarizer 假实现换真：
 * 压缩路径的模型调用消费装配注入的 ModelProvider（与 loop 同一 provider，
 * 重试由装配处套 withRetry 的组合点不变——本层不设第二条重试路径）。
 *
 * 取 qwen·session-recap 设计的纪律：一次性旁路调用（tools 缺省不带）、
 * 独立 system 指令（替代主 agent 角色）、<title>/<summary> 标签提取带
 * 回退档（推理前导由流式 reasoning-delta 天然分离，缺标签时整段直用）。
 * **best-effort 降级**：provider 失败 / 空输出 / 提取全空 → 回退
 * truncatingSummarizer（截断回退，降级不炸压缩——F11 是它的扩展位）。
 *
 * 可观测（B7 验收②的副调用面）：每次摘要调用前落 `request/header
 * {reason: "compaction"}`——主轮请求头之外，副调用在事件流上可区分
 * （reason 枚举扩展一值，l0-events.md §8 落地记录 7）。
 */

import type { ModelIdentity } from "../models/identity.js";
import type { ChatMessage, ModelProvider } from "../models/provider.js";
import type { SessionStore } from "../session/store.js";
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
}

export function createLlmSummarizer(deps: LlmSummarizerDeps): Summarizer {
  const fallback = truncatingSummarizer();
  const systemPrompt = deps.systemPrompt ?? SUMMARY_SYSTEM_PROMPT;
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
    // 被摘要区间转写为旁路调用的 user 消息（qwen filterToDialog 同题：
    // tool 噪声由压缩引擎的 messages 构造面决定，这里原样转写）
    const transcript: string = input.messages
      .map((m) => `${chatLabel(m.role)}：${m.content}`)
      .join("\n\n");
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: transcript },
    ];
    try {
      let text = "";
      for await (const chunk of deps.provider.streamChat({
        identity: deps.identity,
        messages,
      })) {
        if (chunk.type === "text-delta") text += chunk.text;
        else if (chunk.type === "done") break;
      }
      const parsed = parseSummaryOutput(text);
      if (parsed !== null) return parsed;
      deps.onWarn?.("llm-summarizer: 摘要输出为空，回退截断摘要");
    } catch (e) {
      deps.onWarn?.(
        `llm-summarizer: 摘要调用失败回退截断摘要：${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return fallback(input);
  };
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
