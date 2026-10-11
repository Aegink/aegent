/**
 * 内置模型目录·内核精选覆盖层（W18——pi models.generated.ts 数据化模式）：
 * 人工核对的模型元数据（contextWindow/maxOutputTokens/思考档/能力位），
 * 运行时对用户 settings models[] 的**缺省字段兜底**（用户显式字段永远优先
 * ——applyCatalogDefaults 的 `spec.x ?? catalog.x` 语义）。
 *
 * 数据纪律（verified 字段语义）：
 *   - verified: true = 官方公开参数人工核对过（本文件条目）；
 *   - generated 层（tools/generate-model-catalog.mjs 从 ui/model-catalog.json
 *     的 models.dev 大数据合并生成）条目恒 verified: false——机器来源未经
 *     人工核对；同 (adapter,id) 命中时**本层条目优先**。
 * 元数据是发布时快照：厂商上调上下文后以用户显式配置为准（目录只兜缺省）。
 * adapter 维度对齐 PROVIDER_ADAPTERS 三适配器（anthropic/openai-compat/
 * google——中转按 wire 形状归入 openai-compat）。
 */

/**
 * wire 形状闭集（与 session/settings.ts 的 PROVIDER_ADAPTERS 同值——字面量
 * 自持：models 域 requires 只有 core，不为类型导入开 session 边；
 * tools/generate-model-catalog.mjs 生成时按该闭集校验一致性）。
 */
export type CatalogAdapter = "openai" | "openai-responses" | "anthropic" | "google";

export interface BuiltinModelSpec {
  /** 模型 ID（用户 models[].id 命中键；精确优先，尾段兜底——中转前缀同款语义）。 */
  readonly id: string;
  /** wire 形状（缺省 = 不区分——任意适配器下该 id 都兜底）。 */
  readonly adapter?: CatalogAdapter;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  /** 默认思考档（THINKING_LEVELS 闭集内）。 */
  readonly reasoning?: string;
  /** 支持的思考档位（UI 高级面板胶囊选项 + wire 校验）。 */
  readonly thinkingLevels?: readonly string[];
  readonly imageInput?: boolean;
  readonly pdfInput?: boolean;
  readonly webSearch?: boolean;
  readonly forSubagents?: boolean;
  readonly alias?: string;
  readonly verified: boolean;
}

/**
 * 精选覆盖层（人工核对——模型家族代表条目；少而准，宁缺毋滥）。
 * 约定：adapter 只在 wire 形状敏感时标注（anthropic/google）；openai 形状
 * 不标（openai-compat 与任意 OpenAI 形状中转同键命中）。
 */
export const CATALOG_DATA_OVERRIDES: readonly BuiltinModelSpec[] = [
  // --- anthropic（claude 家族：200K 上下文 / 64K 输出 / 思考 / 图片+PDF）---
  {
    id: "claude-opus-4-5",
    adapter: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    reasoning: "high",
    thinkingLevels: ["off", "low", "medium", "high", "max"],
    imageInput: true,
    pdfInput: true,
    alias: "opus-4.5",
    verified: true,
  },
  {
    id: "claude-sonnet-4-5",
    adapter: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    reasoning: "high",
    thinkingLevels: ["off", "low", "medium", "high", "max"],
    imageInput: true,
    pdfInput: true,
    forSubagents: true,
    alias: "sonnet-4.5",
    verified: true,
  },
  {
    id: "claude-haiku-4-5",
    adapter: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    reasoning: "medium",
    thinkingLevels: ["off", "low", "medium", "high"],
    imageInput: true,
    pdfInput: true,
    forSubagents: true,
    alias: "haiku-4.5",
    verified: true,
  },
  {
    id: "claude-sonnet-4-0",
    adapter: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    reasoning: "high",
    thinkingLevels: ["off", "low", "medium", "high", "max"],
    imageInput: true,
    pdfInput: true,
    alias: "sonnet-4",
    verified: true,
  },
  // --- openai 形状（gpt 家族 / o 系 / 主流中转模型）---
  {
    id: "gpt-5",
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    reasoning: "medium",
    thinkingLevels: ["off", "minimal", "low", "medium", "high"],
    imageInput: true,
    pdfInput: true,
    verified: true,
  },
  {
    id: "gpt-5-mini",
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    reasoning: "medium",
    thinkingLevels: ["off", "minimal", "low", "medium", "high"],
    imageInput: true,
    forSubagents: true,
    verified: true,
  },
  {
    id: "gpt-4.1",
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    imageInput: true,
    pdfInput: true,
    verified: true,
  },
  {
    id: "gpt-4.1-mini",
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    imageInput: true,
    forSubagents: true,
    verified: true,
  },
  {
    id: "gpt-4o",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    imageInput: true,
    verified: true,
  },
  {
    id: "gpt-4o-mini",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    imageInput: true,
    forSubagents: true,
    verified: true,
  },
  {
    id: "o3",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    reasoning: "medium",
    thinkingLevels: ["low", "medium", "high"],
    imageInput: true,
    verified: true,
  },
  {
    id: "deepseek-chat",
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    forSubagents: true,
    verified: true,
  },
  {
    id: "deepseek-reasoner",
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    reasoning: "high",
    verified: true,
  },
  {
    id: "kimi-k2",
    contextWindow: 262_144,
    maxOutputTokens: 8_192,
    forSubagents: true,
    verified: true,
  },
  {
    id: "glm-4.6",
    contextWindow: 204_800,
    maxOutputTokens: 128_000,
    thinkingLevels: ["off", "high"],
    verified: true,
  },
  // --- google（gemini 家族：1M 上下文）---
  {
    id: "gemini-2.5-pro",
    adapter: "google",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    reasoning: "high",
    thinkingLevels: ["off", "low", "medium", "high"],
    imageInput: true,
    pdfInput: true,
    webSearch: true,
    alias: "gemini-pro",
    verified: true,
  },
  {
    id: "gemini-2.5-flash",
    adapter: "google",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    reasoning: "medium",
    thinkingLevels: ["off", "low", "medium", "high"],
    imageInput: true,
    pdfInput: true,
    forSubagents: true,
    verified: true,
  },
  {
    id: "gemini-2.0-flash",
    adapter: "google",
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    imageInput: true,
    forSubagents: true,
    verified: true,
  },
];
