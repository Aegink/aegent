/**
 * 会话标题自动生成（T-P3-147 E——五仓标配任务的我方位；zcode
 * title-generation-sidecar 守卫集 + claude 命名工程细节裁剪）：
 * 首个轮次结算后异步生成短标题，写 session_titles 表（历史页/侧栏显示）。
 *
 * 守卫集（zcode session-title.ts 同构裁剪）：
 *   - 总闸关（enhancement.enabled === false）或 title 任务显式关 → 不跑；
 *   - 每会话仅一次（表里有记录 = attempted——重启后仍守卫，持久化去重）；
 *   - 首条 user 消息 ≥10 字（短输入本身即标题——zcode 同语义）；
 *   - custom 权威级不被覆盖（db.setTitle 表内守卫）。
 * 失败静默（console.warn——标题是装饰面，绝不打扰对话；claude 同语义）。
 *
 * 模型链：enhancement.title 显式 → fallbacks → fastModel（回退次序与
 * agent-child 装配同构；provider 现场构造——providerTestOp 先例，凭据走
 * credentials 面）。usage 归因记档：host 旁路不落会话流（跨会话无 store）。
 */

import type { SqliteEventStorage } from "../session/db.js";
import { channelLogger } from "./logging-ops.js";
import {
  adapterForAssembly,
  loadSettings,
  resolveEnhancementChain,
  type SettingsShape,
} from "../session/settings.js";
import { parseProviderConfig } from "../models/config.js";
import { createAnthropicMessagesProvider } from "../models/anthropic-messages.js";
import { createGoogleGenerateProvider } from "../models/google-generate.js";
import { createOpenAiCompatProvider } from "../models/openai-compat.js";
import type { CredentialStore } from "../session/credentials.js";
import { runSideQuery, SideQueryError } from "../kernel/side-query.js";

/** 标题缺省指令（pi session-title-summarize + zcode 强约束合成）。 */
export const TITLE_SYSTEM_PROMPT = [
  "根据对话开头为这个 AI 助手会话起一个标题。",
  "要求：不超过 25 个字符（4~7 个词）；短而具体（如「登录按钮修复」），不要复述句；",
  "跟随用户消息的语言；只输出标题本身——禁止 markdown、引号、emoji、任何前后缀。",
].join("\n");

/** 输入上限（zcode 首 query 截 1200 同值）。 */
const TITLE_INPUT_MAX_CHARS = 1_200;
/** 标题清洗上限（与 listSessionSummaries 的截断宽度和语义对齐）。 */
const TITLE_MAX_CHARS = 60;
/** 最短触发长度（zcode：短输入本身即标题）。 */
const TITLE_MIN_INPUT_CHARS = 10;

export interface TitleServiceDeps {
  settingsPath?: string;
  credentials: CredentialStore;
  /** 标题存取与去重（host 的 SQLite 库——未配置 = no-op 服务）。 */
  db?: SqliteEventStorage;
  /** 会话流读取（host 镜像 store.load——首条 user 消息的取材面）。 */
  sessionStream: (sessionId: string) => readonly import("../kernel/events.js").SessionEvent[];
}

export interface TitleService {
  /** 轮结算后调用（fire-and-forget；内部全守卫，绝不抛）。 */
  onTurnSettled(sessionId: string): Promise<void>;
}

export function createTitleService(deps: TitleServiceDeps): TitleService {
  const inFlight = new Set<string>();
  return {
    async onTurnSettled(sessionId: string): Promise<void> {
      try {
        if (deps.db === undefined || inFlight.has(sessionId)) return;
        const settings = (await loadSettings(deps.settingsPath)).settings;
        // 守卫：总闸 / 任务显式关（enabled === false）
        const enhancement = settings.enhancement;
        if (enhancement?.enabled === false) return;
        if (enhancement?.title && (enhancement.title as { enabled?: boolean }).enabled === false) return;
        if (deps.db.getTitle(sessionId) !== undefined) return;
        const firstUser = firstUserText(sessionId);
        if (firstUser === undefined || firstUser.length < TITLE_MIN_INPUT_CHARS) return;
        inFlight.add(sessionId);
        await generateAndStore(sessionId, firstUser, settings);
      } catch (e) {
        channelLogger("host").warn(`[title] 会话标题生成失败（静默——装饰面）: ${e instanceof Error ? e.message : String(e)}`, { category: "session" });
      } finally {
        inFlight.delete(sessionId);
      }
    },
  };

  /** 链解析 + provider 现场构造 + runSideQuery（google 记档同 agent-child 跳过）。 */
  async function generateAndStore(
    sessionId: string,
    firstUser: string,
    settings: SettingsShape,
  ): Promise<void> {
    const providers = settings.providers;
    const defaultModel = settings.defaultModel;
    const chain = [
      ...resolveEnhancementChain(settings.enhancement?.title, providers, defaultModel),
      ...resolveEnhancementChain(settings.enhancement?.fastModel, providers, defaultModel),
    ];
    for (const item of chain) {
      const entry = item.entry;
      const adapter = adapterForAssembly(
        (entry.models?.[0]?.adapter ?? entry.adapter ?? "openai") as
          | "openai"
          | "openai-responses"
          | "anthropic"
          | "google",
      );
      if (adapter === null) continue; // google——host 构造跳过（装配同款记档）
      const apiKey = await deps.credentials.getKey(entry.name);
      if (apiKey === undefined) continue;
      const config = parseProviderConfig({
        name: `${entry.name}#title`,
        settingsConfig: JSON.stringify({
          baseUrl: entry.baseUrl,
          apiKey,
          model: item.modelId,
          ...(entry.headers !== undefined ? { headers: entry.headers } : {}),
        }),
      });
      const provider =
        adapter === "anthropic"
          ? createAnthropicMessagesProvider(config)
          : adapter === "google"
            ? createGoogleGenerateProvider(config)
            : createOpenAiCompatProvider(config);
      const systemPrompt =
        typeof settings.enhancement?.title?.prompt === "string" &&
        settings.enhancement.title.prompt.trim() !== ""
          ? settings.enhancement.title.prompt
          : TITLE_SYSTEM_PROMPT;
      const r = await runSideQuery({
        purpose: "title",
        provider,
        identity: { provider: adapter, modelId: item.modelId },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: firstUser.slice(0, TITLE_INPUT_MAX_CHARS) },
        ],
        maxTokens: 64,
        maxRetries: 1,
        timeoutMs: 30_000,
      });
      const title = cleanTitle(r.text);
      if (title === "") throw new SideQueryError("TITLE_EMPTY", "标题清洗后为空");
      deps.db!.setTitle(sessionId, title, "generated");
      return;
    }
    // 链全空（无任何可用辅助模型）——静默跳过（首次尝试已消耗，标记存在防重扫：
    // 写一条空记录？不——保持无记录，下轮 turn/end 再试一次；配置好后自然生效）
  }

  /** 清洗链：模块级导出（文件尾）——闭包内不再重复。 */

  function firstUserText(sessionId: string): string | undefined {
    const stream = deps.sessionStream(sessionId);
    for (const e of stream) {
      if (e.type === "user/message" && e.source === "user") {
        const text = e.message?.content;
        return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : undefined;
      }
    }
    return undefined;
  }
}

/** 清洗链（pi cleanSummarizedTitle 同构：剥推理前导/引号/前缀/尾标点/截断）——
 *  模块级导出（测试消费；不依赖闭包状态）。 */
export function cleanTitle(raw: string): string {
  let out = raw.trim();
  out = out.replace(/^<think>[\s\S]*?<\/think>/, "").trim(); // 推理前导剥离（zcode）
  out = out.replace(/^(?:title|标题)\s*[:：]\s*/i, "");
  const firstLine = out.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  out = firstLine.trim().replace(/^["'「『]+|["'」』]+$/g, "").replace(/[。.！!？?、\s]+$/, "");
  if (out.length > TITLE_MAX_CHARS) out = `${out.slice(0, TITLE_MAX_CHARS - 1)}…`;
  return out.trim();
}

/**
 * HostServer.start 的组装入口（自 server.ts 下沉：行数纪律拆分）——
 * titleDeps 提供时构造服务（db = host 库；sessionStream 活读镜像 store），
 * 缺席 = undefined（无库 = no-op 语义不变）。
 */
export function createTitleServiceFromOptions(
  titleDeps: { settingsPath?: string; credentials: import("../session/credentials.js").CredentialStore } | undefined,
  sessionsLibrary: import("../session/db.js").SqliteEventStorage | undefined,
  sessionStream: (sessionId: string) => readonly import("../kernel/events.js").SessionEvent[],
): TitleService | undefined {
  if (titleDeps === undefined) return undefined;
  return createTitleService({
    settingsPath: titleDeps.settingsPath,
    credentials: titleDeps.credentials,
    ...(sessionsLibrary !== undefined ? { db: sessionsLibrary } : {}),
    sessionStream,
  });
}
