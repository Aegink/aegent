/**
 * 内置模型目录·生成产物（W18 数据化——**不手工编辑**）。
 * 来源：ui/model-catalog.json（models.dev 裁剪快照，机器条目 verified:false）
 *   + src/models/catalog-data.ts（人工核对覆盖层，verified 保留，同键优先）。
 * 再生成：node tools/generate-model-catalog.mjs（--check 校验同步）。
 * 条目数：2647（覆盖层 18 / 大数据 2646）。
 */
import type { BuiltinModelSpec } from "./catalog-data.js";

export const CATALOG_GENERATED: readonly BuiltinModelSpec[] = [
  
    {
      id:  "abliterated-model",
      contextWindow:  262144,
      maxOutputTokens:  262134,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "abliterated-model-large",
      contextWindow:  1000000,
      maxOutputTokens:  999990,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      verified:  false
    },
    {
      id:  "abliterated-model-large-v2",
      contextWindow:  1000000,
      maxOutputTokens:  999990,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "active-speaker-detection",
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "agent-max",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "agent-prime",
      contextWindow:  196608,
      maxOutputTokens:  30000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "agent-standard",
      contextWindow:  128000,
      maxOutputTokens:  16000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "Agents-A1",
      contextWindow:  262000,
      maxOutputTokens:  100000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "agnes-1.5-lite",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "agnes-1.5-pro",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      verified:  false
    },
    {
      id:  "agnes-2.0-flash",
      contextWindow:  512000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "agnes-2.5-flash",
      contextWindow:  512000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "agnes-2.5-pro-alpha",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "agnes-3.0-flash",
      contextWindow:  524288,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "aion-2.0",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "aion-3.0",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "aion-3.0-mini",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "aion-3.5",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "aion-3.5-mini",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "aion-labs-aion-3-0",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "aion-labs-aion-3-0-mini",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "aion-labs-aion-3-5",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "aion-labs-aion-3-5-mini",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "aion-rp-llama-3.1-8b",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "alibaba-qwen3-32b",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "alicloud-deepseek-v4-flash",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "alicloud-deepseek-v4-pro",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "alicloud-glm-5.1",
      contextWindow:  200000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "all-mini-lm-l6-v2",
      contextWindow:  256,
      maxOutputTokens:  384,
      verified:  false
    },
    {
      id:  "allam-2-7b",
      contextWindow:  4096,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "amazon--nova-lite",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "amazon--nova-micro",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "amazon--nova-pro",
      contextWindow:  300000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "amazon--titan-embed-text",
      contextWindow:  8192,
      maxOutputTokens:  1536,
      verified:  false
    },
    {
      id:  "amazon.nova-2-lite-v1:0",
      contextWindow:  1000000,
      maxOutputTokens:  65535,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "amazon.nova-lite-v1:0",
      contextWindow:  300000,
      maxOutputTokens:  10000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "amazon.nova-lite-v1:0@us",
      contextWindow:  300000,
      maxOutputTokens:  10000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "amazon.nova-micro-v1:0",
      contextWindow:  128000,
      maxOutputTokens:  10000,
      verified:  false
    },
    {
      id:  "amazon.nova-micro-v1:0@us",
      contextWindow:  128000,
      maxOutputTokens:  10000,
      verified:  false
    },
    {
      id:  "amazon.nova-pro-v1:0",
      contextWindow:  300000,
      maxOutputTokens:  10000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "amazon.nova-pro-v1:0@us",
      contextWindow:  300000,
      maxOutputTokens:  10000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "amoral-gemma3-27B-v2",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "anthropic--claude-3-haiku",
      contextWindow:  200000,
      maxOutputTokens:  4096,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic--claude-3-opus",
      contextWindow:  200000,
      maxOutputTokens:  4096,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic--claude-3-sonnet",
      contextWindow:  200000,
      maxOutputTokens:  4096,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic--claude-3.5-sonnet",
      contextWindow:  200000,
      maxOutputTokens:  8192,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic--claude-3.7-sonnet",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic--claude-4-opus",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic--claude-4-sonnet",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic--claude-4.5-haiku",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic--claude-4.5-opus",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic--claude-4.5-sonnet",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic--claude-4.6-opus",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic--claude-4.6-sonnet",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic--claude-4.7-opus",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic--claude-4.8-opus",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-3-opus",
      contextWindow:  200000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-3.5-haiku",
      contextWindow:  200000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "anthropic-claude-3.5-sonnet",
      contextWindow:  200000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-3.7-sonnet",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-4.1-opus",
      contextWindow:  200000,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-4.5-haiku",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-4.5-sonnet",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-4.6-sonnet",
      contextWindow:  200000,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-5-sonnet",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      verified:  false
    },
    {
      id:  "anthropic-claude-fable-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-fable-5.1",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-haiku-4.5",
      contextWindow:  200000,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-opus-4",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-opus-4.5",
      contextWindow:  200000,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-opus-4.6",
      contextWindow:  200000,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-opus-4.7",
      contextWindow:  200000,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-opus-4.8",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-opus-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-opus-5.5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-sonnet-4",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic-claude-sonnet-5.5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "anthropic.claude-fable-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic.claude-fable-5-1",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic.claude-haiku-4-5-20251001-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic.claude-opus-4-1-20250805-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic.claude-opus-4-5-20251101-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic.claude-opus-4-6-v1",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic.claude-opus-4-7",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic.claude-opus-4-8",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic.claude-opus-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic.claude-opus-5-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic.claude-sonnet-4-5-20250929-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic.claude-sonnet-4-6",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "anthropic.claude-sonnet-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "Anubis-70B-v1",
      contextWindow:  65536,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "Anubis-70B-v1.1",
      contextWindow:  32000,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "apac.amazon.nova-lite-v1:0",
      contextWindow:  300000,
      maxOutputTokens:  10000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "apac.amazon.nova-micro-v1:0",
      contextWindow:  128000,
      maxOutputTokens:  10000,
      verified:  false
    },
    {
      id:  "apac.amazon.nova-pro-v1:0",
      contextWindow:  300000,
      maxOutputTokens:  10000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "apac.anthropic.claude-sonnet-4-20250514-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "apertus-70b",
      contextWindow:  30000,
      maxOutputTokens:  30000,
      verified:  false
    },
    {
      id:  "apertus-70b-instruct",
      contextWindow:  65536,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "apertus-8b-instruct",
      contextWindow:  65536,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Apertus-v1.5-70B",
      contextWindow:  100000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "arcee-trinity-large-thinking",
      contextWindow:  128000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "arrow-1.1",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "arrow-2",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "arrow-2-telos",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Artemis-v1.1",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "asi1-mini",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "atria-dawn-preview",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      verified:  false
    },
    {
      id:  "au.anthropic.claude-haiku-4-5-20251001-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "au.anthropic.claude-opus-4-6-v1",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "au.anthropic.claude-opus-4-7",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "au.anthropic.claude-opus-4-8",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "au.anthropic.claude-opus-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "au.anthropic.claude-opus-5-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "au.anthropic.claude-sonnet-4-5-20250929-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "au.anthropic.claude-sonnet-4-6",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "au.anthropic.claude-sonnet-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "auto",
      contextWindow:  2000000,
      maxOutputTokens:  32768,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "auto-model",
      contextWindow:  1000000,
      maxOutputTokens:  1000000,
      verified:  false
    },
    {
      id:  "auto-model-basic",
      contextWindow:  1000000,
      maxOutputTokens:  1000000,
      verified:  false
    },
    {
      id:  "auto-model-premium",
      contextWindow:  1000000,
      maxOutputTokens:  1000000,
      verified:  false
    },
    {
      id:  "auto-model-standard",
      contextWindow:  1000000,
      maxOutputTokens:  1000000,
      verified:  false
    },
    {
      id:  "autoglm-phone-9b",
      contextWindow:  12800,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "autoglm-phone-9b-multilingual",
      contextWindow:  65536,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "baichuan-m2-32b",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "balanced",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "bee-brood",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "bee-buzz",
      contextWindow:  262144,
      maxOutputTokens:  24576,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "bee-cell",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "bee-comb",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "bee-hive",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "bee-swarm",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "bevformer",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "bge_multilingual_gemma2",
      contextWindow:  8000,
      maxOutputTokens:  3584,
      verified:  false
    },
    {
      id:  "bge-m3",
      contextWindow:  8192,
      maxOutputTokens:  1024,
      verified:  false
    },
    {
      id:  "bge-multilingual-gemma2",
      contextWindow:  8191,
      maxOutputTokens:  3072,
      verified:  false
    },
    {
      id:  "bge-reranker-v2-m3",
      contextWindow:  8192,
      maxOutputTokens:  1,
      verified:  false
    },
    {
      id:  "Bielik-11B-v2.6-Instruct",
      contextWindow:  32000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "Bielik-11B-v3.0-Instruct",
      contextWindow:  32000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "big-pickle",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "bodybuilder",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "brick-complexity-pro",
      contextWindow:  100000,
      maxOutputTokens:  15000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "brick-v1-beta",
      contextWindow:  100000,
      maxOutputTokens:  15000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "c4ai-aya-expanse-32b",
      contextWindow:  128000,
      maxOutputTokens:  4000,
      verified:  false
    },
    {
      id:  "c4ai-aya-expanse-8b",
      contextWindow:  8000,
      maxOutputTokens:  4000,
      verified:  false
    },
    {
      id:  "c4ai-aya-vision-32b",
      contextWindow:  16000,
      maxOutputTokens:  4000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "c4ai-aya-vision-8b",
      contextWindow:  16000,
      maxOutputTokens:  4000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "ca.amazon.nova-lite-v1:0",
      contextWindow:  300000,
      maxOutputTokens:  10000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "celeris-1",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "cerebras-llama-4-maverick-17b-128e-instruct",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "cerebras-llama-4-scout-17b-16e-instruct",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "chatgpt-4o-latest",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "chatgpt-image-latest",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "cheap",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-3-5-haiku",
      contextWindow:  200000,
      maxOutputTokens:  8192,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-3-7-sonnet-20250219",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-3-7-sonnet-latest",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-3-haiku",
      contextWindow:  200000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claude-3-haiku-20240307",
      contextWindow:  200000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claude-3.5-haiku",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claude-3.5-sonnet",
      contextWindow:  200000,
      maxOutputTokens:  8200,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claude-3.5-sonnet-v2",
      contextWindow:  200000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claude-3.7-sonnet",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-4-5-sonnet",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-4-6-sonnet",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-4.0-opus",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claude-4.0-sonnet",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claude-4.1-opus",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claude-4.5-haiku",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claude-4.5-opus",
      contextWindow:  200000,
      maxOutputTokens:  200000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claude-4.5-sonnet",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claude-code",
      verified:  false
    },
    {
      id:  "claude-fable-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-fable-5-1",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-fable-5-1@default",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-fable-5.1",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-fable-5.1@eu",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-fable-5@default",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-fable-5@eu",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-fable-latest",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-haiku-3",
      contextWindow:  189096,
      maxOutputTokens:  8192,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-haiku-3.5",
      contextWindow:  189096,
      maxOutputTokens:  8192,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-haiku-4-5",
      adapter:  "anthropic",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      reasoning:  "medium",
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      forSubagents:  true,
      alias:  "haiku-4.5",
      verified:  true
    },
    {
      id:  "claude-haiku-4-5-20251001",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-haiku-4-5@20251001",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-haiku-4-5@eu",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-haiku-4.5",
      contextWindow:  192000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-haiku-4.5:thinking",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-haiku-latest",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-mythos-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4",
      contextWindow:  192512,
      maxOutputTokens:  28672,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-1",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-1-20250805",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-1-20250805-thinking",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-1@20250805",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-20250514",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-5",
      adapter:  "anthropic",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      reasoning:  "high",
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      alias:  "opus-4.5",
      verified:  true
    },
    {
      id:  "claude-opus-4-5-20251101",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-5@20251101",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-5@eu",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-6",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-6-think",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-6@default",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-6@eu",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-7",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-7-think",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-7-thinking",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-7@default",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-7@eu",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-8",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-8-fast",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-8-think",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-8@default",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4-8@eu",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.1",
      contextWindow:  196608,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.1:thinking",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.1:thinking:1024",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.1:thinking:32768",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.1:thinking:8192",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.5",
      contextWindow:  196608,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.5:thinking",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.6",
      contextWindow:  983040,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.6:thinking",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.6:thinking:low",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.6:thinking:max",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.6:thinking:medium",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.7",
      contextWindow:  1048576,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.7:thinking",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.8",
      contextWindow:  1048576,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.8-fast",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4.8:thinking",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-4@20250514",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-5-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-5-5-fast",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-5-5@default",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-5-5@eu",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-5-fast",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-5-thinking",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-5.5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-5.5-fast",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-5@default",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-5@eu",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus-latest",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus4-5",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus4-6",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus4-7",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-opus4-8",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-3.5",
      contextWindow:  189096,
      maxOutputTokens:  8192,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-3.5-june",
      contextWindow:  189096,
      maxOutputTokens:  8192,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-3.7",
      contextWindow:  196608,
      maxOutputTokens:  128000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4",
      contextWindow:  983040,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4-0",
      adapter:  "anthropic",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      reasoning:  "high",
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      alias:  "sonnet-4",
      verified:  true
    },
    {
      id:  "claude-sonnet-4-20250514",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4-5",
      adapter:  "anthropic",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      reasoning:  "high",
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      forSubagents:  true,
      alias:  "sonnet-4.5",
      verified:  true
    },
    {
      id:  "claude-sonnet-4-5-20250929",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4-5-20250929-thinking",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4-5@20250929",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4-5@eu",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4-6",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4-6-think",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4-6-thinking",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4-6@default",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4-6@eu",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4:thinking",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4:thinking:1024",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4:thinking:32768",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4:thinking:64000",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4:thinking:8192",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4.5",
      contextWindow:  983040,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4.5:thinking",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4.6",
      contextWindow:  983040,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4.6:thinking",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4@20250514",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-4@eu",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-5-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-5-5@default",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-5-5@eu",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-5-free",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-5:thinking",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-5.5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-5.5:thinking",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-5@default",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-5@eu",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claude-sonnet-latest",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "claudinio",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claudius",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "claw-high",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "claw-low",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "claw-medium",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "clover-1-150b",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "code-max",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "code-prime",
      contextWindow:  196608,
      maxOutputTokens:  30000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "code-standard",
      contextWindow:  128000,
      maxOutputTokens:  16000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "codestral",
      contextWindow:  256000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "Codestral-22B-v0.1",
      contextWindow:  128000,
      maxOutputTokens:  4000,
      verified:  false
    },
    {
      id:  "codestral-2501",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      verified:  false
    },
    {
      id:  "codestral-2508",
      contextWindow:  256000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "codestral-embed",
      contextWindow:  8192,
      maxOutputTokens:  1536,
      verified:  false
    },
    {
      id:  "codestral-latest",
      contextWindow:  256000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "codex-mini",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "coding-glm-5.1",
      contextWindow:  200000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "coding-glm-5.1-free",
      contextWindow:  200000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "coding-minimax-m2.7",
      contextWindow:  204800,
      maxOutputTokens:  128100,
      verified:  false
    },
    {
      id:  "coding-minimax-m2.7-free",
      contextWindow:  204800,
      maxOutputTokens:  128100,
      verified:  false
    },
    {
      id:  "coding-minimax-m2.7-highspeed",
      contextWindow:  204800,
      maxOutputTokens:  128100,
      verified:  false
    },
    {
      id:  "coding-router",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "coding-router:high",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "coding-router:low",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "coding-router:max",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "coding-router:medium",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "coding-xiaomi-mimo-v2.5",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "coding-xiaomi-mimo-v2.5-pro",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "cogito-v1-preview-qwen-32B",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "cogito-v2-1-671b",
      contextWindow:  163840,
      maxOutputTokens:  163840,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "cohere--command-a-reasoning",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "cohere-command-a",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "cohere-embed-v-4-0",
      contextWindow:  128000,
      maxOutputTokens:  1536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "cohere-embed-v3-english",
      contextWindow:  512,
      maxOutputTokens:  1024,
      verified:  false
    },
    {
      id:  "cohere-embed-v3-multilingual",
      contextWindow:  512,
      maxOutputTokens:  1024,
      verified:  false
    },
    {
      id:  "command-a",
      contextWindow:  256000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "command-a-03-2025",
      contextWindow:  256000,
      maxOutputTokens:  8000,
      verified:  false
    },
    {
      id:  "command-a-plus",
      contextWindow:  192000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "command-a-plus-05-2026",
      contextWindow:  128000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "command-a-reasoning-08-2025",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "command-a-translate-08-2025",
      contextWindow:  8000,
      maxOutputTokens:  8000,
      verified:  false
    },
    {
      id:  "command-a-vision-07-2025",
      contextWindow:  128000,
      maxOutputTokens:  8000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "command-r-08-2024",
      contextWindow:  128000,
      maxOutputTokens:  4000,
      verified:  false
    },
    {
      id:  "command-r-plus-08-2024",
      contextWindow:  128000,
      maxOutputTokens:  4000,
      verified:  false
    },
    {
      id:  "command-r7b-12-2024",
      contextWindow:  128000,
      maxOutputTokens:  4000,
      verified:  false
    },
    {
      id:  "command-r7b-arabic-02-2025",
      contextWindow:  128000,
      maxOutputTokens:  4000,
      verified:  false
    },
    {
      id:  "compound",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "compound-mini",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "cosmos-predict1-5b",
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "cosmos-reason2-8b",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "cosmos-transfer1-7b",
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "cosmos-transfer2_5-2b",
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "custom",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "cyberheabsy",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "Cydonia-24B-v2",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "Cydonia-24B-v4",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "cydonia-24b-v4.1",
      contextWindow:  131072,
      maxOutputTokens:  117964,
      verified:  false
    },
    {
      id:  "Cydonia-24B-v4.1",
      contextWindow:  131072,
      maxOutputTokens:  117964,
      verified:  false
    },
    {
      id:  "Cydonia-24B-v4.3",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "d1",
      contextWindow:  32000,
      verified:  false
    },
    {
      id:  "dall-e-3",
      contextWindow:  800,
      verified:  false
    },
    {
      id:  "databricks-claude-haiku-4-5",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-claude-opus-4-1",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-claude-opus-4-5",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-claude-opus-4-6",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-claude-opus-4-7",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-claude-sonnet-4",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-claude-sonnet-4-5",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-claude-sonnet-4-6",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-deepseek-v4-flash-0731",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "databricks-deepseek-v4-pro-0813",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "databricks-gemini-2-5-flash",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gemini-2-5-pro",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gemini-3-1-flash-lite",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gemini-3-1-pro",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gemini-3-flash",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gemini-3-pro",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-glm-5-2",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "databricks-gpt-5",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gpt-5-1",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gpt-5-2",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gpt-5-4",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gpt-5-4-mini",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gpt-5-4-nano",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gpt-5-5",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gpt-5-6-luna",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gpt-5-6-sol",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gpt-5-6-terra",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gpt-5-mini",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gpt-5-nano",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "databricks-gpt-oss-120b",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "databricks-gpt-oss-120b@eu",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "databricks-gpt-oss-20b",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "databricks-gpt-oss-20b@eu",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "databricks-inkling",
      contextWindow:  1000000,
      maxOutputTokens:  1048576,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "databricks-kimi-k2-7-code",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "deep-deepseek-v4-flash",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "deep-deepseek-v4-pro",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "deep-research-max-preview-04-2026",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "deep-research-preview-04-2026",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "deepseek-3.2",
      contextWindow:  163840,
      maxOutputTokens:  163840,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "deepseek-4-flash",
      contextWindow:  1048576,
      maxOutputTokens:  384000,
      verified:  false
    },
    {
      id:  "deepseek-chat",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      forSubagents:  true,
      verified:  true
    },
    {
      id:  "deepseek-chat-cheaper",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "deepseek-chat-v3-0324",
      contextWindow:  163840,
      maxOutputTokens:  147456,
      verified:  false
    },
    {
      id:  "deepseek-chat-v3.1",
      contextWindow:  163840,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "deepseek-flash",
      contextWindow:  1000000,
      maxOutputTokens:  393216,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "deepseek-flash-latest",
      contextWindow:  1048576,
      maxOutputTokens:  943718,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "deepseek-latest",
      contextWindow:  1048576,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-math-v2",
      contextWindow:  160000,
      maxOutputTokens:  160000,
      verified:  false
    },
    {
      id:  "deepseek-ocr",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "DeepSeek-OCR",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "deepseek-ocr-2",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "deepseek-pro-latest",
      contextWindow:  1048576,
      maxOutputTokens:  393216,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-prover-v2-671b",
      contextWindow:  160000,
      maxOutputTokens:  160000,
      verified:  false
    },
    {
      id:  "deepseek-r1",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "DeepSeek-R1",
      contextWindow:  164000,
      maxOutputTokens:  164000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "deepseek-r1-0528",
      contextWindow:  163840,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "high"
      ],
      verified:  false
    },
    {
      id:  "DeepSeek-R1-0528",
      contextWindow:  163840,
      maxOutputTokens:  64000,
      verified:  false
    },
    {
      id:  "deepseek-r1-0528-qwen3-8b",
      contextWindow:  128000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "deepseek-r1-distill-llama-70b",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "DeepSeek-R1-Distill-Llama-70B-abliterated",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "deepseek-r1-distill-llama-8b",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "deepseek-r1-distill-qwen-1-5b",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "deepseek-r1-distill-qwen-14b",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "deepseek-r1-distill-qwen-32b",
      contextWindow:  80000,
      maxOutputTokens:  80000,
      verified:  false
    },
    {
      id:  "DeepSeek-R1-Distill-Qwen-32B-abliterated",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "deepseek-r1-distill-qwen-7b",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "deepseek-r1-sambanova",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "deepseek-r1-turbo",
      contextWindow:  64000,
      maxOutputTokens:  16000,
      verified:  false
    },
    {
      id:  "deepseek-reasoner",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      reasoning:  "high",
      verified:  true
    },
    {
      id:  "deepseek-reasoner-cheaper",
      contextWindow:  128000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "deepseek-tng-r1t2-chimera",
      contextWindow:  130000,
      maxOutputTokens:  163840,
      verified:  false
    },
    {
      id:  "deepseek-v3",
      contextWindow:  128000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "DeepSeek-V3",
      contextWindow:  163840,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "deepseek-v3-0324",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "DeepSeek-V3-0324",
      contextWindow:  163840,
      maxOutputTokens:  163840,
      verified:  false
    },
    {
      id:  "deepseek-v3-1",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "DeepSeek-V3-1",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v3-2",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v3-2-exp",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "deepseek-v3-turbo",
      contextWindow:  64000,
      maxOutputTokens:  16000,
      verified:  false
    },
    {
      id:  "deepseek-v3.1",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "DeepSeek-V3.1",
      contextWindow:  163840,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v3.1-maas",
      contextWindow:  163840,
      maxOutputTokens:  32768,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "deepseek-v3.1-terminus",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "DeepSeek-V3.1-Terminus",
      contextWindow:  128000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "deepseek-v3.1-terminus-thinking",
      contextWindow:  128000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "DeepSeek-V3.1-Terminus:thinking",
      contextWindow:  128000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "DeepSeek-V3.1:thinking",
      contextWindow:  128000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "deepseek-v3.2",
      contextWindow:  128000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "DeepSeek-V3.2",
      contextWindow:  163840,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v3.2-251201",
      contextWindow:  128000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "deepseek-v3.2-exp",
      contextWindow:  163840,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "DeepSeek-V3.2-Exp",
      contextWindow:  164000,
      maxOutputTokens:  164000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v3.2-exp-thinking",
      contextWindow:  163840,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "deepseek-v3.2-maas",
      contextWindow:  163840,
      maxOutputTokens:  65536,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "DeepSeek-V3.2-NVFP4",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "deepseek-v3.2-speciale",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "DeepSeek-V3.2-TEE",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v3.2-thinking",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "deepseek-v3.2:thinking",
      contextWindow:  163000,
      maxOutputTokens:  65536,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "deepseek-v4-1-flash",
      contextWindow:  1000000,
      maxOutputTokens:  393216,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "deepseek-v4-flash",
      contextWindow:  1000000,
      maxOutputTokens:  393216,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "DeepSeek-V4-Flash",
      contextWindow:  1048576,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-flash-0423",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-flash-0731",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "DeepSeek-V4-Flash-0731",
      contextWindow:  1048576,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-flash-0731-284b",
      contextWindow:  1048576,
      maxOutputTokens:  81920,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-flash-0731-fast",
      contextWindow:  1000000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "DeepSeek-V4-Flash-0731-TEE",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-flash-0731:thinking",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-flash-0731@eu",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-flash-el",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      verified:  false
    },
    {
      id:  "deepseek-v4-flash-flex",
      contextWindow:  1048560,
      maxOutputTokens:  393216,
      thinkingLevels:  [
        "off",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-flash-free",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-flash-ga-260731",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-flash-latest",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-flash-speed",
      contextWindow:  1048560,
      maxOutputTokens:  393216,
      thinkingLevels:  [
        "off",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-flash-vision-exp",
      contextWindow:  1000000,
      maxOutputTokens:  393216,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "DeepSeek-V4-Flash-Vision-Exp",
      contextWindow:  1048576,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "deepseek-v4-flash:0731",
      contextWindow:  1048576,
      maxOutputTokens:  1048576,
      thinkingLevels:  [
        "off",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-flash:free",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      verified:  false
    },
    {
      id:  "deepseek-v4-flash:thinking",
      contextWindow:  1048576,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-pro",
      contextWindow:  1000000,
      maxOutputTokens:  393216,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "DeepSeek-V4-Pro",
      contextWindow:  1048576,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-pro-0423",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-pro-0813",
      contextWindow:  1000000,
      maxOutputTokens:  393216,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "DeepSeek-V4-Pro-0813",
      contextWindow:  1048576,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-pro-0813:thinking",
      contextWindow:  1048576,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-pro-0813@eu",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-pro-el",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      verified:  false
    },
    {
      id:  "deepseek-v4-pro-ga-260813",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-pro:0813",
      contextWindow:  1048576,
      maxOutputTokens:  1048576,
      thinkingLevels:  [
        "off",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-pro:free",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      verified:  false
    },
    {
      id:  "deepseek-v4-pro:thinking",
      contextWindow:  1048576,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4-pro@eu",
      contextWindow:  1048576,
      maxOutputTokens:  1048576,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "deepseek-v4.1-flash",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "DeepSeek-V4.1-Flash",
      contextWindow:  1048576,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "DeepSeek-V4.1-Flash-Fast",
      contextWindow:  1048576,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "deepseek-v4.1-flash-fast-fp4",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "deepseek-v4.1-flash-flex",
      contextWindow:  1048560,
      maxOutputTokens:  393216,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "deepseek-v4.1-flash:fast",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "deepseek-v4.1-flash:thinking",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "deepseek-v4.1-flash@eu",
      contextWindow:  1048576,
      maxOutputTokens:  393216,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "deepseek-v4p1-flash",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "deepseek.r1-v1:0",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "deepseek.v3-v1:0",
      contextWindow:  163840,
      maxOutputTokens:  81920,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "deepseek.v3.2",
      contextWindow:  163840,
      maxOutputTokens:  81920,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "devstral-2",
      contextWindow:  256000,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "devstral-2-123b-instruct-2512",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "Devstral-2-123B-Instruct-2512-int4-AutoRound",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "devstral-2512",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      verified:  false
    },
    {
      id:  "devstral-latest",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      verified:  false
    },
    {
      id:  "devstral-latest@eu",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      verified:  false
    },
    {
      id:  "devstral-medium-2507",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "devstral-medium-latest",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      verified:  false
    },
    {
      id:  "devstral-small-2",
      contextWindow:  256000,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "devstral-small-2505",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "Devstral-Small-2505",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "devstral-small-2507",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "diffusiongemma",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "xhigh"
      ],
      verified:  false
    },
    {
      id:  "diffusiongemma-26B-A4B-it",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      verified:  false
    },
    {
      id:  "dola-seed-2.0-code",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "dola-seed-2.0-code-preview",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "dola-seed-2.0-lite",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "dola-seed-2.0-mini",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "dola-seed-2.0-pro",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "dolphin-mistral-24b-venice-edition",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "dots-3-note-preview:free",
      contextWindow:  512000,
      maxOutputTokens:  460800,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-1.5-pro-256k",
      contextWindow:  256000,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "doubao-1.5-pro-32k",
      contextWindow:  32000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "doubao-1.5-thinking-pro",
      contextWindow:  128000,
      maxOutputTokens:  16000,
      verified:  false
    },
    {
      id:  "doubao-1.5-vision-pro",
      contextWindow:  128000,
      maxOutputTokens:  16000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-1.5-vision-pro-32k",
      contextWindow:  32000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-1-6",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "doubao-seed-1-6-250615",
      contextWindow:  256000,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "doubao-seed-1-6-251015",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "doubao-seed-1-6-flash",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-1-6-flash-250615",
      contextWindow:  256000,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "doubao-seed-1-6-flash-250828",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-1-6-thinking-250715",
      contextWindow:  256000,
      maxOutputTokens:  16000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-1-6-vision",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-1-6-vision-250815",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-1-8",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-1-8-251215",
      contextWindow:  224000,
      maxOutputTokens:  64000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-1-8-251228",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-1.6",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-1.6-flash",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-1.6-thinking",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-1.8",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-2-0-code-preview",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-2-0-code-preview-260215",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "doubao-seed-2-0-lite-260215",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "doubao-seed-2-0-lite-260428",
      contextWindow:  256000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-2-0-mini-260215",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "doubao-seed-2-0-mini-260428",
      contextWindow:  256000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-2-0-pro",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-2-0-pro-260215",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "doubao-seed-2-1-pro-260628",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-2-1-turbo-260628",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-2.0-code",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "doubao-seed-2.0-lite",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-2.0-mini",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-2.0-pro",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-2.1-pro",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "doubao-seed-2.1-turbo",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "doubao-seed-character",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-character-260628",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-code",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "doubao-seed-evolving",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Dracarys-72B-Instruct",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "dracarys-llama-3.1-70b-instruct",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "duo-chat-fable-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-fable-5-1",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-gpt-5-1",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-gpt-5-2",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-gpt-5-2-codex",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-gpt-5-3-codex",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-gpt-5-4",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-gpt-5-4-mini",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-gpt-5-4-nano",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-gpt-5-5",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-gpt-5-6-luna",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-gpt-5-6-sol",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-gpt-5-6-terra",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-gpt-5-codex",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-gpt-5-mini",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-gpt-6-astra",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-gpt-6-luna",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-gpt-6-sol",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-haiku-4-5",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-opus-4-5",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-opus-4-6",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-opus-4-7",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-opus-4-8",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-opus-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-opus-5-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-sonnet-4-5",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-sonnet-4-6",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "duo-chat-sonnet-5",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "e2e",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "e5-large-v2",
      contextWindow:  512,
      maxOutputTokens:  1024,
      verified:  false
    },
    {
      id:  "e5-mistral-7b-instruct",
      contextWindow:  4096,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "echo",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "efficient",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "elevenlabs-music",
      contextWindow:  2000,
      verified:  false
    },
    {
      id:  "elevenlabs-v2.5-turbo",
      contextWindow:  128000,
      verified:  false
    },
    {
      id:  "elevenlabs-v3",
      contextWindow:  128000,
      verified:  false
    },
    {
      id:  "embed-v4.0",
      contextWindow:  128000,
      maxOutputTokens:  1536,
      verified:  false
    },
    {
      id:  "ember-1",
      contextWindow:  1048576,
      maxOutputTokens:  943718,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "ernie-4.5-21B-a3b",
      contextWindow:  120000,
      maxOutputTokens:  8000,
      verified:  false
    },
    {
      id:  "ernie-4.5-21b-a3b-thinking",
      contextWindow:  128000,
      maxOutputTokens:  8000,
      verified:  false
    },
    {
      id:  "ernie-4.5-21B-a3b-thinking",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "ernie-4.5-300b-a47b-paddle",
      contextWindow:  123000,
      maxOutputTokens:  12000,
      verified:  false
    },
    {
      id:  "ernie-4.5-vl-28b-a3b",
      contextWindow:  30000,
      maxOutputTokens:  8000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "ernie-4.5-vl-28b-a3b-thinking",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "ernie-4.5-vl-424b-a47b",
      contextWindow:  123000,
      maxOutputTokens:  16000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "ernie-5.0-thinking-preview",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "ernie-5.1",
      contextWindow:  119000,
      maxOutputTokens:  64000,
      verified:  false
    },
    {
      id:  "ernie-5.1:thinking",
      contextWindow:  119000,
      maxOutputTokens:  64000,
      verified:  false
    },
    {
      id:  "ernie-x1.1-preview",
      contextWindow:  64000,
      maxOutputTokens:  8192,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "esm2-650m",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "esmfold",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "eu.amazon.nova-2-lite-v1:0",
      contextWindow:  1000000,
      maxOutputTokens:  65535,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "eu.amazon.nova-lite-v1:0",
      contextWindow:  300000,
      maxOutputTokens:  10000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "eu.amazon.nova-micro-v1:0",
      contextWindow:  128000,
      maxOutputTokens:  10000,
      verified:  false
    },
    {
      id:  "eu.amazon.nova-pro-v1:0",
      contextWindow:  300000,
      maxOutputTokens:  10000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "eu.anthropic.claude-fable-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "eu.anthropic.claude-opus-4-5-20251101-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "eu.anthropic.claude-opus-4-6-v1",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "eu.anthropic.claude-opus-4-7",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "eu.anthropic.claude-opus-4-8",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "eu.anthropic.claude-opus-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "eu.anthropic.claude-opus-5-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "eu.anthropic.claude-sonnet-4-20250514-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "eu.anthropic.claude-sonnet-4-6",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "eu.anthropic.claude-sonnet-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "eu.mistral.pixtral-large-2502-v1:0",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "EVA-LLaMA-3.33-70B-v0.0",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "EVA-LLaMA-3.33-70B-v0.1",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "EVA-Qwen2.5-32B-v0.2",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "EVA-Qwen2.5-72B-v0.2",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "fast",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "fast-sdxl",
      verified:  false
    },
    {
      id:  "faster-whisper-large-v3",
      contextWindow:  448,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "fastgpt",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "flux_1-kontext-dev",
      contextWindow:  40960,
      maxOutputTokens:  40960,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "flux_1-schnell",
      contextWindow:  77,
      verified:  false
    },
    {
      id:  "flux_2-klein-4b",
      contextWindow:  40960,
      maxOutputTokens:  40960,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "flux-2-flex",
      verified:  false
    },
    {
      id:  "flux-2-klein-4b",
      verified:  false
    },
    {
      id:  "flux-2-klein-9b",
      verified:  false
    },
    {
      id:  "flux-2-max",
      contextWindow:  67300,
      maxOutputTokens:  67300,
      verified:  false
    },
    {
      id:  "flux-2-pro",
      contextWindow:  67300,
      maxOutputTokens:  67300,
      verified:  false
    },
    {
      id:  "flux-3-video",
      verified:  false
    },
    {
      id:  "flux-fast-schnell",
      contextWindow:  512,
      verified:  false
    },
    {
      id:  "flux-kontext-max",
      contextWindow:  512,
      verified:  false
    },
    {
      id:  "flux-kontext-pro",
      contextWindow:  512,
      verified:  false
    },
    {
      id:  "flux-pro-1.0-fill",
      contextWindow:  512,
      verified:  false
    },
    {
      id:  "flux-pro-1.1",
      contextWindow:  512,
      verified:  false
    },
    {
      id:  "flux-pro-1.1-ultra",
      contextWindow:  512,
      verified:  false
    },
    {
      id:  "flux.1-dev",
      contextWindow:  4096,
      verified:  false
    },
    {
      id:  "FLUX.2-klein-4B",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "free",
      contextWindow:  200000,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "frontier",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "fugu",
      contextWindow:  1000000,
      maxOutputTokens:  1000000,
      thinkingLevels:  [
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "fugu-max",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "fugu-ultra",
      contextWindow:  1000000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "fugu-ultra-20260615",
      contextWindow:  1000000,
      maxOutputTokens:  1000000,
      thinkingLevels:  [
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "fugu-ultra-v1-0",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "fugu-ultra-v1-1",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "fugu-ultra-v1.1",
      contextWindow:  1000000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "fugu-ultra-v2",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "fugu-ultra-v2-0",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "fugu-ultra-v2.0",
      contextWindow:  1000000,
      maxOutputTokens:  1000000,
      thinkingLevels:  [
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "fusion",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "fusion-flash",
      contextWindow:  200000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "fusion-mini",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gelab-zero-4b-preview",
      contextWindow:  8192,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2-5-flash",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2-5-flash-lite",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.0-flash",
      adapter:  "google",
      contextWindow:  1048576,
      maxOutputTokens:  8192,
      imageInput:  true,
      forSubagents:  true,
      verified:  true
    },
    {
      id:  "gemini-2.0-flash-lite",
      contextWindow:  990000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.0-pro-exp-02-05",
      contextWindow:  2097152,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.0-pro-reasoner",
      contextWindow:  128000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "gemini-2.5-computer-use-preview-10-2025",
      contextWindow:  128000,
      maxOutputTokens:  64000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash",
      adapter:  "google",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      reasoning:  "medium",
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      forSubagents:  true,
      verified:  true
    },
    {
      id:  "gemini-2.5-flash-image",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash-lite",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash-lite-preview-06-17",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash-lite-preview-09-2025",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash-lite-preview-09-2025-thinking",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash-lite@eu",
      contextWindow:  1048576,
      maxOutputTokens:  65535,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash-nothink",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash-nothinking",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash-preview-04-17",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash-preview-04-17:thinking",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash-preview-05-20",
      contextWindow:  1048000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash-preview-05-20:thinking",
      contextWindow:  1048000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash-preview-09-2025",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash-preview-09-2025-thinking",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash-preview-tts",
      contextWindow:  8192,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash-tts",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "gemini-2.5-flash@eu",
      contextWindow:  1048576,
      maxOutputTokens:  65535,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-pro",
      adapter:  "google",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      reasoning:  "high",
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      webSearch:  true,
      alias:  "gemini-pro",
      verified:  true
    },
    {
      id:  "gemini-2.5-pro-exp-03-25",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-pro-preview",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-pro-preview-03-25",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-pro-preview-05-06",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-pro-preview-06-05",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-2.5-pro-preview-tts",
      contextWindow:  8192,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "gemini-2.5-pro-tts",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "gemini-2.5-pro@eu",
      contextWindow:  1048576,
      maxOutputTokens:  65535,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3-1-flash-lite",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3-1-flash-tts",
      contextWindow:  8192,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "gemini-3-1-pro",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3-1-pro-preview",
      contextWindow:  1000000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3-5-flash",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3-5-flash-lite",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3-6-flash",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3-7-flash",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3-8-flash",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3-flash",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3-flash-preview",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3-flash-preview-thinking",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3-pro",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3-pro-image",
      contextWindow:  65536,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3-pro-image-preview",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3-pro-preview",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.0-flash-preview",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.0-pro-image-preview",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.0-pro-preview",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.1-flash-image",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "minimal",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.1-flash-image-preview",
      contextWindow:  65536,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.1-flash-lite",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.1-flash-lite-image",
      contextWindow:  65536,
      maxOutputTokens:  4096,
      thinkingLevels:  [
        "minimal",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.1-flash-lite-preview",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.1-flash-lite@eu",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.1-flash-lite@us",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.1-flash-live-preview",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.1-flash-tts-preview",
      contextWindow:  8192,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "gemini-3.1-pro",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.1-pro-preview",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.1-pro-preview-customtools",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.1-pro-preview-high",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.1-pro-preview-low",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.5-flash",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.5-flash-lite",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.5-flash-lite@eu",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.5-flash-lite@us",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.5-flash-thinking",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.5-flash@eu",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.5-flash@us",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.5-live-translate-preview",
      contextWindow:  16384,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "gemini-3.5-transcribe",
      verified:  false
    },
    {
      id:  "gemini-3.5-transcribe-live",
      verified:  false
    },
    {
      id:  "gemini-3.6-flash",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.6-flash@eu",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.6-flash@us",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.7-flash",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.7-flash@eu",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.7-flash@us",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.8-flash",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.8-flash-lite-tts",
      verified:  false
    },
    {
      id:  "gemini-3.8-flash-tts",
      verified:  false
    },
    {
      id:  "gemini-3.8-flash@eu",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.8-flash@us",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-3.8-live",
      verified:  false
    },
    {
      id:  "gemini-3.8-live-extended-thinking",
      verified:  false
    },
    {
      id:  "gemini-deep-research",
      contextWindow:  1048576,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-embedding",
      contextWindow:  2048,
      maxOutputTokens:  1,
      verified:  false
    },
    {
      id:  "gemini-embedding-001",
      contextWindow:  2048,
      maxOutputTokens:  1,
      verified:  false
    },
    {
      id:  "gemini-embedding-2",
      contextWindow:  8192,
      maxOutputTokens:  1,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-exp-1206",
      contextWindow:  2097152,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-flash-latest",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-flash-lite-latest",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gemini-omni-flash-preview",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-pro-latest",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemini-robotics-er-1.6-preview",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-2-27b-it",
      contextWindow:  8192,
      maxOutputTokens:  2048,
      verified:  false
    },
    {
      id:  "gemma-2-2b-it",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "gemma-3",
      contextWindow:  125000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-3-12b",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-3-12b-it",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-3-27b",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-3-27b-it",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-3-4b-it",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-3-4b-pt",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gemma-3n-e2b-it",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-3n-e4b-it",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-3n-E4B-it",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "gemma-4",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-12b-it",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-12B-it",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      verified:  false
    },
    {
      id:  "gemma-4-12b-it-semancer",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-12b-it-station-keeper",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-26b-a4b",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-26b-a4b-it",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-26B-A4B-it",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-26b-a4b-it-chimerax",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-26b-a4b-it-cybersecurity",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-26b-a4b-it-darksoul",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-26b-a4b-it-luminous",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-26b-a4b-it-moonlight",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-26b-a4b-it-musica",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-26b-a4b-it-opusdistill",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-26b-a4b-it-shadowsiren",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-26b-a4b-it:free",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-26b-a4b-it:thinking",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Gemma-4-26B-A4B-MeroMero",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Gemma-4-26B-A4B-MeroMero:thinking",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-26b-a4b-uncensored",
      contextWindow:  65536,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "gemma-4-31b",
      contextWindow:  262144,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Gemma-4-31B-Claude-4.6-Opus-Reasoning-Distilled",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Gemma-4-31B-Cognitive-Unshackled",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Gemma-4-31B-DarkIdol",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Gemma-4-31B-GarnetV2",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-31b-it",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-31B-it",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-31b-it-darkidol",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-31b-it-fabled",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-31B-it-fp8",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-31b-it-garnet",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-31b-it-gembrain",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-31b-it-gemsicle",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-31b-it-isometry",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-31b-it-novelist",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-31b-it:free",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-31b-it:thinking",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Gemma-4-31B-MeroMero-v2",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Gemma-4-31B-MeroMero-v2:thinking",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Gemma-4-31B-Queen",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-31B-turbo-TEE",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-E2B-it",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-E4B-it",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-4-E4B-it-IQ4_XS",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "gemma-4-E4B-it-MLX-4bit",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "gemma-4-uncensored",
      contextWindow:  256000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma-sea-lion-v4-27b-it",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "gemma2-9b-it",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "gemma4",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma4-26b",
      contextWindow:  256000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma4-31b",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma4-31b-splituntied",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "gemma4-31b:thinking",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gemma4:31b",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gliguard-LLMGuardrails-300M",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gliguard-PII-multi",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "GLiNER-2.5-Decide",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gliner-pii",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "gliner2-base-v1",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gliner2-large-v1",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gliner2-multi-large-v1",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gliner2-multi-v1",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gliner2-privacy-filter-PII-multi",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gliner2.5-base-v1",
      contextWindow:  4096,
      maxOutputTokens:  4096,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gliner2.5-multi-v1",
      contextWindow:  4096,
      maxOutputTokens:  4096,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "GLM-4-32B-0414",
      contextWindow:  128000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "glm-4-32b-0414-128k",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "glm-4-5-flash",
      contextWindow:  200000,
      maxOutputTokens:  98304,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "glm-4-6v-flash",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "glm-4-7-flash",
      contextWindow:  200000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "glm-4-7-flash:free",
      contextWindow:  200000,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "GLM-4-9B-0414",
      contextWindow:  32000,
      maxOutputTokens:  8000,
      verified:  false
    },
    {
      id:  "glm-4-air-0111",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "glm-4-long",
      contextWindow:  1000000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "glm-4-plus-0111",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "glm-4.1v-thinking-flash",
      contextWindow:  64000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-4.1v-thinking-flashx",
      contextWindow:  64000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-4.5",
      contextWindow:  131072,
      maxOutputTokens:  98304,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "GLM-4.5",
      contextWindow:  131072,
      maxOutputTokens:  96000,
      verified:  false
    },
    {
      id:  "glm-4.5-air",
      contextWindow:  131072,
      maxOutputTokens:  98304,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "GLM-4.5-Air",
      contextWindow:  128000,
      maxOutputTokens:  98304,
      verified:  false
    },
    {
      id:  "GLM-4.5-Air:thinking",
      contextWindow:  128000,
      maxOutputTokens:  98304,
      verified:  false
    },
    {
      id:  "glm-4.5-airx",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "glm-4.5-flash",
      contextWindow:  131072,
      maxOutputTokens:  98304,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "glm-4.5-flash:free",
      contextWindow:  131072,
      maxOutputTokens:  98304,
      verified:  false
    },
    {
      id:  "GLM-4.5-FP8",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "glm-4.5-x",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "GLM-4.5:thinking",
      contextWindow:  128000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "glm-4.5v",
      contextWindow:  64000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "GLM-4.5V",
      contextWindow:  65536,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-4.5v:thinking",
      contextWindow:  65536,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-4.6",
      contextWindow:  204800,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  true
    },
    {
      id:  "GLM-4.6",
      contextWindow:  202752,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "GLM-4.6-Derestricted-v5",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "glm-4.6-original",
      contextWindow:  256000,
      maxOutputTokens:  65535,
      verified:  false
    },
    {
      id:  "GLM-4.6-turbo",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "GLM-4.6-turbo:thinking",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "glm-4.6:thinking",
      contextWindow:  200000,
      maxOutputTokens:  65535,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "glm-4.6v",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-4.6v-flash",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "GLM-4.6V-Flash",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-4.6v-flash-free",
      contextWindow:  200000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "glm-4.6v-flashx",
      contextWindow:  128000,
      maxOutputTokens:  16000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-4.6v-original",
      contextWindow:  128000,
      maxOutputTokens:  24000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-4.7",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "GLM-4.7",
      contextWindow:  202752,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "glm-4.7-flash",
      contextWindow:  200000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "GLM-4.7-Flash",
      contextWindow:  202752,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "glm-4.7-flash-free",
      contextWindow:  200000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "glm-4.7-flash:thinking",
      contextWindow:  200000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "glm-4.7-flashx",
      contextWindow:  200000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "glm-4.7-free",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "glm-4.7-maas",
      contextWindow:  200000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "glm-4.7-n",
      contextWindow:  205000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "glm-4.7-original",
      contextWindow:  200000,
      maxOutputTokens:  65535,
      verified:  false
    },
    {
      id:  "glm-4.7-original:thinking",
      contextWindow:  200000,
      maxOutputTokens:  65535,
      verified:  false
    },
    {
      id:  "glm-4.7:thinking",
      contextWindow:  200000,
      maxOutputTokens:  65535,
      verified:  false
    },
    {
      id:  "glm-5",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "GLM-5",
      contextWindow:  202752,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "glm-5-1",
      contextWindow:  202000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5-2",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5-2-260617",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "glm-5-3",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5-3-flash",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "glm-5-3-flash-260828",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "GLM-5-FP8",
      contextWindow:  202752,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "glm-5-free",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "glm-5-maas",
      contextWindow:  200000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "glm-5-original",
      contextWindow:  200000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "glm-5-original:thinking",
      contextWindow:  200000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "glm-5-turbo",
      contextWindow:  200000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "glm-5:thinking",
      contextWindow:  200000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "glm-5.1",
      contextWindow:  200000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "GLM-5.1",
      contextWindow:  202752,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "GLM-5.1-FP8",
      contextWindow:  202752,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "GLM-5.1-TEE",
      contextWindow:  202752,
      maxOutputTokens:  65535,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "glm-5.1-thinking",
      contextWindow:  202752,
      maxOutputTokens:  65535,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "glm-5.1:thinking",
      contextWindow:  200000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "glm-5.1@eu",
      contextWindow:  200000,
      maxOutputTokens:  200000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "GLM-5.2",
      contextWindow:  1048576,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2-caveman",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2-caveman-lite",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2-caveman-ultra",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2-fast",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "GLM-5.2-Fast",
      contextWindow:  1048576,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-5.2-flex",
      contextWindow:  1048560,
      maxOutputTokens:  1048560,
      thinkingLevels:  [
        "off",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "GLM-5.2-FP8",
      contextWindow:  393216,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "glm-5.2-highspeed",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2-honey",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2-honey-lite",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2-honey-ultra",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2-maas",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2-nitro",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "glm-5.2-ponytail",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2-ponytail-lite",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2-ponytail-ultra",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2-short",
      contextWindow:  199984,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2-short-fast",
      contextWindow:  199984,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2-short-fast-flex",
      contextWindow:  199984,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2-short-flex",
      contextWindow:  199984,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "GLM-5.2-TEE",
      contextWindow:  1048576,
      maxOutputTokens:  65535,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2:free",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "glm-5.2:thinking",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5.2@eu",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5.3",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "GLM-5.3",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5.3-fast",
      contextWindow:  1048576,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "GLM-5.3-Fast",
      contextWindow:  1048576,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-5.3-flash",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "GLM-5.3-Flash",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "glm-5.3-flash-cybersecurity",
      contextWindow:  1048576,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-5.3-flash-flex",
      contextWindow:  1048560,
      maxOutputTokens:  1048560,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-5.3-flash-fp4",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-5.3-flash-free",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "glm-5.3-flash-uncensored",
      contextWindow:  1048576,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-5.3-flash:fast",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "glm-5.3-flash@eu",
      contextWindow:  1000000,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "glm-5.3-flashx",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "glm-5.3-flex",
      contextWindow:  1048560,
      maxOutputTokens:  1048560,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5.3-fp4",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5.3-free",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5.3-highspeed",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5.3-prime",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5.3-uncensored",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5.3:fast",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "glm-5.3:thinking",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5.3@eu",
      contextWindow:  1048576,
      maxOutputTokens:  1048576,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5p3",
      contextWindow:  1048573,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5p3-fast",
      contextWindow:  1048572,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-5p3-flash",
      contextWindow:  1048573,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-5v-turbo",
      contextWindow:  200000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "GLM-5V-Turbo",
      contextWindow:  200000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-5v-turbo:thinking",
      contextWindow:  202800,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-fast-latest",
      contextWindow:  1048572,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm-flash-latest",
      contextWindow:  256000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "glm-image",
      contextWindow:  10240,
      verified:  false
    },
    {
      id:  "glm-latest",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "GLM-Z1-9B-0414",
      contextWindow:  32000,
      maxOutputTokens:  8000,
      verified:  false
    },
    {
      id:  "glm-z1-airx",
      contextWindow:  32000,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "glm5.2",
      contextWindow:  96000,
      maxOutputTokens:  96000,
      thinkingLevels:  [
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm5.2-fast",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm5.3",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm5.3-754b",
      contextWindow:  524288,
      maxOutputTokens:  81920,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "glm5.3-flash",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "global.amazon.nova-2-lite-v1:0",
      contextWindow:  1000000,
      maxOutputTokens:  65535,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "global.anthropic.claude-fable-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "global.anthropic.claude-fable-5-1",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "global.anthropic.claude-haiku-4-5-20251001-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "global.anthropic.claude-opus-4-5-20251101-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "global.anthropic.claude-opus-4-6-v1",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "global.anthropic.claude-opus-4-7",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "global.anthropic.claude-opus-4-8",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "global.anthropic.claude-opus-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "global.anthropic.claude-opus-5-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "global.anthropic.claude-sonnet-4-20250514-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "global.anthropic.claude-sonnet-4-6",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "global.anthropic.claude-sonnet-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "global.anthropic.claude-sonnet-5-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "global.moonshotai.kimi-k3",
      contextWindow:  1048576,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "global.openai.gpt-5.6-luna",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "global.openai.gpt-5.6-sol",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "global.openai.gpt-5.6-terra",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "global.openai.gpt-6-astra",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "global.openai.gpt-6-luna",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "global.openai.gpt-6-sol",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "global.xai.grok-4.6",
      contextWindow:  500000,
      maxOutputTokens:  500000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "global.xai.grok-4.7",
      contextWindow:  500000,
      maxOutputTokens:  500000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "google-gemma-3-27b-it",
      contextWindow:  198000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "google-gemma-4-26b-a4b-it",
      contextWindow:  256000,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "google-gemma-4-31b-it",
      contextWindow:  256000,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "google-paligemma",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "google.gemma-3-12b-it",
      contextWindow:  128000,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "google.gemma-3-12b-it@us",
      contextWindow:  128000,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "google.gemma-3-27b-it",
      contextWindow:  128000,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "google.gemma-3-27b-it@us",
      contextWindow:  128000,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "google.gemma-3-4b-it",
      contextWindow:  128000,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "google.gemma-3-4b-it@us",
      contextWindow:  128000,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "google.gemma-4-26b-a4b",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "google.gemma-4-31b",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "google.gemma-4-e2b",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-3.5-turbo",
      contextWindow:  16385,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "gpt-3.5-turbo-0125",
      contextWindow:  16384,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "gpt-3.5-turbo-0613",
      contextWindow:  4095,
      maxOutputTokens:  3685,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-3.5-turbo-1106",
      contextWindow:  16384,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "gpt-3.5-turbo-16k",
      contextWindow:  16385,
      maxOutputTokens:  4096,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-3.5-turbo-instruct",
      contextWindow:  3500,
      maxOutputTokens:  1024,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-3.5-turbo-raw",
      contextWindow:  4524,
      maxOutputTokens:  2048,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "gpt-4-classic",
      contextWindow:  8192,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4-classic-0314",
      contextWindow:  8192,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4-turbo",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4-turbo-vision",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4.1",
      contextWindow:  1047576,
      maxOutputTokens:  32768,
      imageInput:  true,
      pdfInput:  true,
      verified:  true
    },
    {
      id:  "gpt-4.1-fast",
      contextWindow:  1047576,
      maxOutputTokens:  32768,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4.1-mini",
      contextWindow:  1047576,
      maxOutputTokens:  32768,
      imageInput:  true,
      forSubagents:  true,
      verified:  true
    },
    {
      id:  "gpt-4.1-mini-2025-04-14",
      contextWindow:  1047576,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4.1-mini-fast",
      contextWindow:  1047576,
      maxOutputTokens:  32768,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4.1-mini@eu",
      contextWindow:  1047576,
      maxOutputTokens:  32768,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4.1-nano",
      contextWindow:  1047576,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4.1-nano-fast",
      contextWindow:  1047576,
      maxOutputTokens:  32768,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4.1-nano@eu",
      contextWindow:  1047576,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4.1@eu",
      contextWindow:  1047576,
      maxOutputTokens:  32768,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4o",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  true
    },
    {
      id:  "gpt-4o-2024-05-13",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4o-2024-08-06",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4o-2024-11-20",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4o-aug",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4o-fast",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4o-mini",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      forSubagents:  true,
      verified:  true
    },
    {
      id:  "gpt-4o-mini-2024-07-18",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4o-mini-fast",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4o-mini-search",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "gpt-4o-mini-transcribe",
      contextWindow:  16000,
      maxOutputTokens:  2000,
      verified:  false
    },
    {
      id:  "gpt-4o-mini@eu",
      contextWindow:  128000,
      maxOutputTokens:  16000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-4o-search",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "gpt-4o-transcribe",
      contextWindow:  16000,
      maxOutputTokens:  2000,
      verified:  false
    },
    {
      id:  "gpt-5",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      reasoning:  "medium",
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  true
    },
    {
      id:  "gpt-5-1",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-2",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-3-codex",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-4",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-4-mini",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-4-nano",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-5",
      contextWindow:  272000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-5-pro",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-6-luna",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-6-sol",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-6-terra",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-chat",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-chat-latest",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-codex",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-fast",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-image",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-image-mini",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-mini",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      reasoning:  "medium",
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      forSubagents:  true,
      verified:  true
    },
    {
      id:  "gpt-5-mini-fast",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-mini@eu",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-nano",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-nano@eu",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-pro",
      contextWindow:  400000,
      maxOutputTokens:  272000,
      thinkingLevels:  [
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5-thinking",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.1",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.1-2025-11-13",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gpt-5.1-chat",
      contextWindow:  128000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.1-chat-latest",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.1-codex",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.1-codex-max",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.1-codex-mini",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gpt-5.1-instant",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.1-thinking",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.1-thinking-fast",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.1@eu",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.2",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.2-chat",
      contextWindow:  128000,
      maxOutputTokens:  32000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.2-chat-latest",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.2-codex",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.2-fast",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.2-instant",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.2-pro",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.3-chat",
      contextWindow:  128000,
      maxOutputTokens:  16380,
      verified:  false
    },
    {
      id:  "gpt-5.3-chat-latest",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.3-codex",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.3-codex-fast",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.3-codex-spark",
      contextWindow:  128000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.3-codex-xhigh",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.3-instant",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.4",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.4-fast",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.4-image-2",
      contextWindow:  272000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.4-mini",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.4-mini-fast",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.4-nano",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.4-pro",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.4:free",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.4@eu",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.5",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.5-fast",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.5-instant",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.5-pro",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.5:free",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.5@eu",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.6",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.6-luna",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.6-luna-fast",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.6-luna-pro",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.6-luna@eu",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.6-sol",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.6-sol-fast",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.6-sol-pro",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.6-sol:official",
      contextWindow:  271999,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.6-sol@eu",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.6-terra",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.6-terra-fast",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.6-terra-pro",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5.6-terra@eu",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-5@eu",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-6-astra",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-6-astra-fast",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-6-astra-pro",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-6-astra:official",
      contextWindow:  271999,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-6-luna",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-6-luna-fast",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-6-luna-pro",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-6-luna@eu",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-6-sol",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-6-sol-fast",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-6-sol-pro",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-6-sol@eu",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-6.1-sol",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-6.1-sol-fast",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-6.1-sol-pro",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-6.1-sol@eu",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-astra-latest",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-audio",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-audio-mini",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-chat-latest",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-daybreak-blue-latest",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-daybreak-red-latest",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-image-1",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-image-1-mini",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-image-1.5",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-image-2",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-image-2.5-flare",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-image-2.5-sunburst",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-latest",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-live-1",
      verified:  false
    },
    {
      id:  "gpt-luna-latest",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-mini-latest",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-oss-120b",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gpt-oss-120b-cs",
      contextWindow:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gpt-oss-120b-high-throughput",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gpt-oss-120b-maas",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gpt-oss-20b",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gpt-oss-20b-maas",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gpt-oss-safeguard-120b",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "gpt-oss-safeguard-20b",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gpt-oss:120b",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gpt-oss:20b",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "gpt-pro-latest",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-realtime-1.5",
      verified:  false
    },
    {
      id:  "gpt-realtime-2",
      verified:  false
    },
    {
      id:  "gpt-realtime-2.1",
      contextWindow:  128000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "gpt-realtime-mini",
      verified:  false
    },
    {
      id:  "gpt-realtime-whisper",
      verified:  false
    },
    {
      id:  "gpt-sol-latest",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "gpt-terra-latest",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "granite-4-h-small",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "granite-4.0-h-micro",
      contextWindow:  131000,
      maxOutputTokens:  131000,
      verified:  false
    },
    {
      id:  "granite-4.1-8b",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "granite-4.2-8b",
      contextWindow:  131072,
      maxOutputTokens:  117964,
      thinkingLevels:  [
        "off",
        "low",
        "high"
      ],
      verified:  false
    },
    {
      id:  "GrayLine-Qwen3-8B",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "green-l",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "green-l-raw",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "green-r",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "green-r-raw",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "green-s",
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "green-s-pro",
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "greg-1-mini",
      contextWindow:  229376,
      maxOutputTokens:  229376,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "greg-2-super",
      contextWindow:  229376,
      maxOutputTokens:  229376,
      verified:  false
    },
    {
      id:  "greg-2-ultra",
      contextWindow:  229376,
      maxOutputTokens:  229376,
      verified:  false
    },
    {
      id:  "greg-rp",
      contextWindow:  229376,
      maxOutputTokens:  229376,
      verified:  false
    },
    {
      id:  "grok-3",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "grok-3-mini",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "grok-4",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4-0709",
      contextWindow:  256000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4-1-fast-non-reasoning",
      contextWindow:  2000000,
      maxOutputTokens:  30000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4-1-fast-reasoning",
      contextWindow:  2000000,
      maxOutputTokens:  30000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4-20",
      contextWindow:  2000000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4-20-beta-0309-non-reasoning",
      contextWindow:  2000000,
      maxOutputTokens:  30000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4-20-beta-0309-reasoning",
      contextWindow:  2000000,
      maxOutputTokens:  30000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4-20-multi-agent",
      contextWindow:  2000000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4-20-non-reasoning",
      contextWindow:  2000000,
      maxOutputTokens:  30000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4-20-reasoning",
      contextWindow:  2000000,
      maxOutputTokens:  30000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4-3",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4-5",
      contextWindow:  500000,
      maxOutputTokens:  500000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4-6",
      contextWindow:  500000,
      maxOutputTokens:  500000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4-7",
      contextWindow:  500000,
      maxOutputTokens:  500000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4-fast",
      contextWindow:  2000000,
      maxOutputTokens:  2000000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4-fast-non-reasoning",
      contextWindow:  2000000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4-fast-reasoning",
      contextWindow:  2000000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.1",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.1-fast",
      contextWindow:  2000000,
      maxOutputTokens:  2000000,
      verified:  false
    },
    {
      id:  "grok-4.1-fast-non-reasoning",
      contextWindow:  2000000,
      maxOutputTokens:  30000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.1-fast-reasoning",
      contextWindow:  2000000,
      maxOutputTokens:  30000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.2-beta",
      contextWindow:  2000000,
      maxOutputTokens:  2000000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.2-fast",
      contextWindow:  2000000,
      maxOutputTokens:  30000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.2-fast-non-reasoning",
      contextWindow:  2000000,
      maxOutputTokens:  30000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.20",
      contextWindow:  2000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.20-0309-non-reasoning",
      contextWindow:  1000000,
      maxOutputTokens:  30000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.20-0309-reasoning",
      contextWindow:  1000000,
      maxOutputTokens:  30000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.20-beta-0309-reasoning",
      contextWindow:  2000000,
      maxOutputTokens:  30000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.20-multi-agent",
      contextWindow:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.20-multi-agent-0309",
      contextWindow:  1000000,
      maxOutputTokens:  30000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.20-multi-agent-beta",
      contextWindow:  2000000,
      maxOutputTokens:  2000000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.20-non-reasoning",
      contextWindow:  2000000,
      maxOutputTokens:  2000000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.20-non-reasoning-beta",
      contextWindow:  2000000,
      maxOutputTokens:  2000000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.20-reasoning",
      contextWindow:  2000000,
      maxOutputTokens:  2000000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.20-reasoning-beta",
      contextWindow:  2000000,
      maxOutputTokens:  2000000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.3",
      contextWindow:  1000000,
      maxOutputTokens:  30000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.5",
      contextWindow:  500000,
      maxOutputTokens:  500000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.6",
      contextWindow:  500000,
      maxOutputTokens:  500000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-4.7",
      contextWindow:  500000,
      maxOutputTokens:  500000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-build-0-1",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-build-0.1",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-code",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      verified:  false
    },
    {
      id:  "grok-code-fast-1",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "grok-imagine-image",
      contextWindow:  16000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-imagine-image-2-0",
      contextWindow:  8000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-imagine-image-2.0",
      contextWindow:  66000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-imagine-image-quality",
      contextWindow:  16000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-imagine-video",
      contextWindow:  1024,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-imagine-video-1.5",
      contextWindow:  1024,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "grok-latest",
      contextWindow:  500000,
      maxOutputTokens:  450000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "grok-stt",
      verified:  false
    },
    {
      id:  "grok-tts",
      verified:  false
    },
    {
      id:  "grok-voice-stt-1.0",
      contextWindow:  15000,
      maxOutputTokens:  15000,
      verified:  false
    },
    {
      id:  "grok-voice-think-fast-1.0",
      verified:  false
    },
    {
      id:  "grok-voice-think-fast-2.0",
      verified:  false
    },
    {
      id:  "grok-voice-tts-1.0",
      contextWindow:  15000,
      maxOutputTokens:  15000,
      verified:  false
    },
    {
      id:  "groq-llama-4-maverick-17b-128e-instruct",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "gte-large-en-v1.5",
      contextWindow:  8192,
      maxOutputTokens:  1024,
      verified:  false
    },
    {
      id:  "happyhorse-1.1-i2v",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "happyhorse-1.1-r2v",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "happyhorse-1.1-t2v",
      verified:  false
    },
    {
      id:  "hermes-2-pro-llama-3-8b",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "hermes-3-llama-3.1-405b",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "hermes-3-llama-3.1-70b",
      contextWindow:  65536,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "hermes-4-405b",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Hermes-4-405B",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "hermes-4-405b:thinking",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "hermes-high",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "hermes-low",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "hermes-medium",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "holo2-30b-a3b",
      contextWindow:  22016,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "holo3-35b-a3b",
      contextWindow:  65536,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "holo3-35b-a3b:thinking",
      contextWindow:  65536,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "hunyuan-2.0-instruct",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "hunyuan-2.0-thinking",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "hunyuan-a13b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  117964,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "Hunyuan-A13B-Instruct",
      contextWindow:  131000,
      maxOutputTokens:  131000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "hunyuan-t1",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "hunyuan-turbos",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "hy-mt2-1.8b",
      contextWindow:  8192,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "hy-mt2-30b-a3b",
      contextWindow:  8192,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "hy-mt2-7b",
      contextWindow:  8192,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "hy-mt2-lite",
      contextWindow:  8000,
      maxOutputTokens:  4000,
      verified:  false
    },
    {
      id:  "hy-mt2-plus",
      contextWindow:  8192,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "hy-mt2-pro",
      contextWindow:  8000,
      maxOutputTokens:  4000,
      verified:  false
    },
    {
      id:  "hy3",
      contextWindow:  262144,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "high"
      ],
      verified:  false
    },
    {
      id:  "Hy3",
      contextWindow:  262144,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "hy3-free",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "high"
      ],
      verified:  false
    },
    {
      id:  "hy3-preview",
      contextWindow:  262144,
      maxOutputTokens:  235929,
      thinkingLevels:  [
        "off",
        "low",
        "high"
      ],
      verified:  false
    },
    {
      id:  "hy3-preview-free",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      verified:  false
    },
    {
      id:  "hy3:free",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "high"
      ],
      verified:  false
    },
    {
      id:  "hy4-preview",
      contextWindow:  1048576,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "high"
      ],
      verified:  false
    },
    {
      id:  "Hy4-preview",
      contextWindow:  1048576,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "ideogram",
      contextWindow:  150,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "ideogram-v2",
      contextWindow:  150,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "ideogram-v2a",
      contextWindow:  150,
      verified:  false
    },
    {
      id:  "ideogram-v2a-turbo",
      contextWindow:  150,
      verified:  false
    },
    {
      id:  "imagen-3",
      contextWindow:  480,
      verified:  false
    },
    {
      id:  "imagen-3-fast",
      contextWindow:  480,
      verified:  false
    },
    {
      id:  "imagen-4",
      contextWindow:  480,
      verified:  false
    },
    {
      id:  "imagen-4-fast",
      contextWindow:  480,
      verified:  false
    },
    {
      id:  "imagen-4-ultra",
      contextWindow:  480,
      verified:  false
    },
    {
      id:  "imagen-4.0-fast",
      contextWindow:  480,
      verified:  false
    },
    {
      id:  "imagen-4.0-ultra",
      contextWindow:  480,
      verified:  false
    },
    {
      id:  "in.openai.gpt-5.6-luna",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "in.openai.gpt-5.6-terra",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "inkling",
      contextWindow:  1048000,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Inkling",
      contextWindow:  524288,
      maxOutputTokens:  1048576,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "inkling-256k",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Inkling-NVFP4",
      contextWindow:  1048576,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "inkling-small",
      contextWindow:  1048576,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Inkling-Small",
      contextWindow:  524288,
      maxOutputTokens:  1048576,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "inkling-small:free",
      contextWindow:  1048576,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Inkling-Small:thinking",
      contextWindow:  524288,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "inkling:free",
      contextWindow:  1048576,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Inkling:peft:262144",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "inkling:thinking",
      contextWindow:  1048000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "interfaze-beta",
      contextWindow:  1000000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "jamba-large",
      contextWindow:  256000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "jamba-mini",
      contextWindow:  256000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "jp.amazon.nova-2-lite-v1:0",
      contextWindow:  1000000,
      maxOutputTokens:  65535,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "jp.anthropic.claude-haiku-4-5-20251001-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "jp.anthropic.claude-opus-4-7",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "jp.anthropic.claude-opus-4-8",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "jp.anthropic.claude-opus-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "jp.anthropic.claude-opus-5-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "jp.anthropic.claude-sonnet-4-5-20250929-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "jp.anthropic.claude-sonnet-4-6",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "jp.anthropic.claude-sonnet-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "K2-Think",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "k3",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "k3-256k",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kat-coder-pro",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "kat-coder-pro-v2",
      contextWindow:  256000,
      maxOutputTokens:  80000,
      verified:  false
    },
    {
      id:  "kat-coder-pro-v2.5",
      contextWindow:  262144,
      maxOutputTokens:  235929,
      verified:  false
    },
    {
      id:  "kb-whisper-large",
      contextWindow:  448,
      maxOutputTokens:  448,
      verified:  false
    },
    {
      id:  "kimi-fast-latest",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-for-coding",
      contextWindow:  1048576,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-for-coding-highspeed",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2",
      contextWindow:  262144,
      maxOutputTokens:  8192,
      forSubagents:  true,
      verified:  true
    },
    {
      id:  "Kimi-K2_6",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2-0711",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "kimi-k2-0905",
      contextWindow:  262144,
      maxOutputTokens:  98304,
      verified:  false
    },
    {
      id:  "kimi-k2-0905-preview",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      verified:  false
    },
    {
      id:  "kimi-k2-5",
      contextWindow:  256000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2-6",
      contextWindow:  256000,
      maxOutputTokens:  16000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2-6:free",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2-7-code",
      contextWindow:  256000,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2-7-code-highspeed",
      contextWindow:  256000,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2-7-code:free",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2-instruct",
      contextWindow:  256000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Kimi-K2-Instruct",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "kimi-k2-instruct-0711",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Kimi-K2-Instruct-0905",
      contextWindow:  262144,
      maxOutputTokens:  100352,
      verified:  false
    },
    {
      id:  "kimi-k2-instruct-fast",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "Kimi-K2-Instruct-FP4",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "kimi-k2-thinking",
      contextWindow:  256000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "Kimi-K2-Thinking",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      verified:  false
    },
    {
      id:  "kimi-k2-thinking-maas",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      verified:  false
    },
    {
      id:  "kimi-k2-thinking-turbo",
      contextWindow:  262000,
      maxOutputTokens:  64000,
      verified:  false
    },
    {
      id:  "kimi-k2-turbo-preview",
      contextWindow:  256000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "kimi-k2.5",
      contextWindow:  128000,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Kimi-K2.5",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2.5-free",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2.5-fw",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2.5:thinking",
      contextWindow:  256000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2.6",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Kimi-K2.6",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2.6-fast",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2.6-nitro",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Kimi-K2.6-TEE",
      contextWindow:  262144,
      maxOutputTokens:  65535,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2.6:thinking",
      contextWindow:  256000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2.6@eu",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2.7-code",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Kimi-K2.7-Code",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2.7-code-fast",
      contextWindow:  262128,
      maxOutputTokens:  262128,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2.7-code-flex",
      contextWindow:  262128,
      maxOutputTokens:  262128,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2.7-code-free",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2.7-code-highspeed",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2.7-code-nitro",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k2.7-code@eu",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k3",
      contextWindow:  1048576,
      maxOutputTokens:  1048576,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Kimi-K3",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k3-eco",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k3-fast",
      contextWindow:  1040384,
      maxOutputTokens:  1040384,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Kimi-K3-Fast",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k3-fast-api",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k3-flex",
      contextWindow:  1048560,
      maxOutputTokens:  1048560,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k3-free",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Kimi-K3-TEE",
      contextWindow:  1048576,
      maxOutputTokens:  65535,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k3:fast",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-k3@eu",
      contextWindow:  1048576,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kimi-latest",
      contextWindow:  1048576,
      maxOutputTokens:  943718,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kling-v2-6",
      contextWindow:  99999999,
      maxOutputTokens:  99999999,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "kling-v2.5-turbo-i2v",
      verified:  false
    },
    {
      id:  "kling-v2.5-turbo-t2v",
      verified:  false
    },
    {
      id:  "kling-v2.6-i2v",
      verified:  false
    },
    {
      id:  "kling-v2.6-motion-control",
      verified:  false
    },
    {
      id:  "kling-v2.6-t2v",
      verified:  false
    },
    {
      id:  "kling-v3.0-i2v",
      verified:  false
    },
    {
      id:  "kling-v3.0-motion-control",
      verified:  false
    },
    {
      id:  "kling-v3.0-t2v",
      verified:  false
    },
    {
      id:  "Kloker",
      contextWindow:  200000,
      maxOutputTokens:  50000,
      verified:  false
    },
    {
      id:  "Kloker-Integration-Architect",
      contextWindow:  200000,
      maxOutputTokens:  50000,
      verified:  false
    },
    {
      id:  "Kloker-Integration-Developer",
      contextWindow:  200000,
      maxOutputTokens:  50000,
      verified:  false
    },
    {
      id:  "l3-70b-euryale-v2.1",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "l3-8b-lunaris",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "L3-8B-stheno-v3.2",
      contextWindow:  8192,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "L3-8B-Stheno-v3.2",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "l3-lunaris-8b",
      contextWindow:  8192,
      maxOutputTokens:  7372,
      verified:  false
    },
    {
      id:  "L3.1-70B-Celeste-V0.1-BF16",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "L3.1-70B-Euryale-v2.2",
      contextWindow:  20480,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "L3.1-70B-Hanami-x1",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "l3.1-euryale-70b",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "L3.3-70B-Euryale-v2.3",
      contextWindow:  20480,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "L3.3-Cu-Mai-R1-70b",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "L3.3-Electra-R1-70b",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "l3.3-euryale-70b",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "L3.3-MS-Nevoria-70b",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "L3.3-Nevoria-R1-70b",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "l31-70b-euryale-v2.2",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "labs-devstral-small-2512",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "laguna-m.1",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "laguna-s-2.1",
      contextWindow:  1048576,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "laguna-s-2.1-free",
      contextWindow:  256000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "laguna-s-2.1:free",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "laguna-s-2.1:thinking",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "laguna-xs-2.1",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "laguna-xs-2.1:free",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "laguna-xs.2",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "large",
      contextWindow:  202752,
      maxOutputTokens:  202752,
      thinkingLevels:  [
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "leanstral-1-5",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "leanstral-1-5@eu",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "lfm-2.5-2.6b",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      verified:  false
    },
    {
      id:  "lfm-2.5-2.6b:free",
      contextWindow:  65536,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "high"
      ],
      verified:  false
    },
    {
      id:  "LFM2-24B-A2B",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "LightOnOCR-2-1B",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "ling-1t",
      contextWindow:  128000,
      maxOutputTokens:  64000,
      verified:  false
    },
    {
      id:  "Ling-1T",
      contextWindow:  128000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "ling-2.6-1t",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "ling-2.6-flash",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "ling-2.6-flash-free",
      contextWindow:  262100,
      maxOutputTokens:  32800,
      verified:  false
    },
    {
      id:  "ling-3.0-flash",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "ling-3.0-flash-fin",
      contextWindow:  262144,
      maxOutputTokens:  235929,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "ling-3.0-flash-fin-free",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "ling-3.0-flash-free",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "ling-3.0-flash-sante",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "ling-3.0-flash-sante-free",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "ling-3.0-flash-sante:free",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "ling-3.0-flash-vl",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "ling-3.0-flash:thinking",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      verified:  false
    },
    {
      id:  "ling-3.0-tiny",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "ling-3.0-tiny-free",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "ling-3.1-flash",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "ling-3.1-flash-free",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "Ling-flash-2.0",
      contextWindow:  131000,
      maxOutputTokens:  131000,
      verified:  false
    },
    {
      id:  "llama-3_2-nemoretriever-300m-embed-v1",
      contextWindow:  32768,
      maxOutputTokens:  2048,
      verified:  false
    },
    {
      id:  "llama-3-3-70b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "llama-3-70b-instruct",
      contextWindow:  8192,
      maxOutputTokens:  8000,
      verified:  false
    },
    {
      id:  "llama-3-8b-instruct",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Llama-3.05-Nemotron-Tenyxchat-Storybreaker-70B",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Llama-3.05-NT-Storybreaker-Ministral-70B",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "llama-3.1-70b",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "llama-3.1-70b-instruct",
      contextWindow:  128000,
      maxOutputTokens:  2048,
      verified:  false
    },
    {
      id:  "Llama-3.1-70B-Instruct",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "llama-3.1-8b",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "llama-3.1-8b-cs",
      contextWindow:  128000,
      verified:  false
    },
    {
      id:  "llama-3.1-8b-instant",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "llama-3.1-8b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "Llama-3.1-8B-Instruct",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "llama-3.1-8b-instruct-fp8",
      contextWindow:  32000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "llama-3.1-8b-instruct-turbo",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "llama-3.1-nemotron-70b-instruct",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Llama-3.1-Nemotron-70B-Instruct",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Llama-3.1-Nemotron-70B-Instruct-HF",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "llama-3.1-nemotron-nano-8b-v1",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "llama-3.1-nemotron-nano-vl-8b-v1",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "llama-3.1-nemotron-safety-guard-8b-v3",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "llama-3.1-nemotron-ultra-253b-v1",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "llama-3.2-11b-instruct",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "llama-3.2-11b-vision-instruct",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Llama-3.2-11B-Vision-Instruct",
      contextWindow:  131072,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Llama-3.2-1B",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "llama-3.2-1b-instruct",
      contextWindow:  60000,
      maxOutputTokens:  60000,
      verified:  false
    },
    {
      id:  "Llama-3.2-1B-Instruct",
      contextWindow:  131072,
      maxOutputTokens:  60000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "llama-3.2-3b",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "Llama-3.2-3B",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "llama-3.2-3b-instruct",
      contextWindow:  80000,
      maxOutputTokens:  80000,
      verified:  false
    },
    {
      id:  "Llama-3.2-3B-Instruct",
      contextWindow:  131072,
      maxOutputTokens:  80000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "llama-3.2-90b-vision-instruct",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Llama-3.2-90B-Vision-Instruct",
      contextWindow:  16000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "llama-3.3-70b",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "llama-3.3-70b-cs",
      verified:  false
    },
    {
      id:  "llama-3.3-70b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "Llama-3.3-70B-Instruct",
      contextWindow:  70000,
      maxOutputTokens:  70000,
      verified:  false
    },
    {
      id:  "Llama-3.3-70B-Instruct-abliterated",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "Llama-3.3-70B-Instruct-FP8",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "Llama-3.3-70B-Instruct-FP8-Dynamic",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "llama-3.3-70b-instruct-fp8-fast",
      contextWindow:  24000,
      maxOutputTokens:  24000,
      verified:  false
    },
    {
      id:  "llama-3.3-70b-instruct-maas",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Llama-3.3-70B-Instruct-Turbo",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "llama-3.3-70b-versatile",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "llama-3.3-8b-instruct",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "llama-3.3-nemotron-super-49b-v1",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "Llama-3.3-Nemotron-Super-49B-v1",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "llama-3.3-nemotron-super-49b-v1.5",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "Llama-3.3-Nemotron-Super-49B-v1.5",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "llama-4-maverick",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "llama-4-maverick-17b-128e-instruct",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "llama-4-maverick-17b-128e-instruct-fp8",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Llama-4-Maverick-17B-128E-Instruct-FP8",
      contextWindow:  1048576,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "llama-4-maverick-17b-128e-instruct-maas",
      contextWindow:  524288,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "llama-4-maverick-17b-instruct",
      contextWindow:  8192,
      maxOutputTokens:  2048,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "llama-4-scout",
      contextWindow:  328000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "llama-4-scout-17b-16e-instruct",
      contextWindow:  131000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Llama-4-Scout-17B-16E-Instruct",
      contextWindow:  327680,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "llama-4-scout-17b-16e-instruct-fp8",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "llama-4-scout-17b-instruct",
      contextWindow:  8192,
      maxOutputTokens:  2048,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "llama-guard-3-8b",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "Llama-Guard-3-8B",
      contextWindow:  131072,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "llama-guard-4",
      contextWindow:  131072,
      maxOutputTokens:  1024,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "llama-guard-4-12b",
      contextWindow:  163840,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "llama-nemotron-embed-vl-1b-v2",
      contextWindow:  32768,
      maxOutputTokens:  2048,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "llama-nemotron-rerank-vl-1b-v2",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "llama-prompt-guard-2-22m",
      contextWindow:  512,
      maxOutputTokens:  512,
      verified:  false
    },
    {
      id:  "llama-prompt-guard-2-86m",
      contextWindow:  512,
      maxOutputTokens:  512,
      verified:  false
    },
    {
      id:  "Llama-xLAM-2-70b-fc-r",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "llama3-3-70b",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "llama3-8b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "llama3.3-70b-instruct",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "llama3.3:70b",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "longcat-2.0",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "LongCat-2.0",
      contextWindow:  1049000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "longcat-2.0-free",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "longcat-2.0:thinking",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "longcat-2.5-preview",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "longcat-2.5-preview-free",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "longcat-flash-chat",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "longcat-flash-lite",
      contextWindow:  256000,
      maxOutputTokens:  320000,
      verified:  false
    },
    {
      id:  "lucid-origin",
      contextWindow:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "lucid-realism",
      contextWindow:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "lucidnova-rf1-100b",
      contextWindow:  120000,
      maxOutputTokens:  8000,
      verified:  false
    },
    {
      id:  "lucidquery-agi-01-frontier",
      contextWindow:  300000,
      maxOutputTokens:  120000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "lucidquery-agi-01-swift",
      contextWindow:  300000,
      maxOutputTokens:  120000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "lucidquery-nexus-coder",
      contextWindow:  250000,
      maxOutputTokens:  60000,
      verified:  false
    },
    {
      id:  "Lumimaid-v0.2-70B",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "lynkr-auto",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "lyria",
      verified:  false
    },
    {
      id:  "lyria-3-clip-preview",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "lyria-3-pro-preview",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "m2-her",
      contextWindow:  65536,
      maxOutputTokens:  2048,
      verified:  false
    },
    {
      id:  "magibu-11b-v8",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Magidonia-24B-v4.3",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "magistral-medium",
      contextWindow:  128000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "magistral-medium-latest",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "magistral-small-2506",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "Magistral-Small-2506",
      contextWindow:  128000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "magnum-v2-72b",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "magnum-v4-72b",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "magpie-tts-zeroshot",
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "mai-code-1-flash-picker",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "mai-code-1.1-flash",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "manta-flash-1.0",
      contextWindow:  16384,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "manta-mini-1.0",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "manta-pro-1.0",
      contextWindow:  65536,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "medgemma-4b",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Mellum2-12B-A2.5B-Instruct",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "mercury-2",
      contextWindow:  128000,
      maxOutputTokens:  50000,
      verified:  false
    },
    {
      id:  "mercury-2-5",
      contextWindow:  260000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "mercury-2.5",
      contextWindow:  260000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "mercury-2.5-preview",
      contextWindow:  260000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "mercury-coder-small",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "mercury-edit-2",
      contextWindow:  32000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Meta-Llama-3_1-8B-Instruct-GGUF",
      contextWindow:  131072,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "meta-llama-3_3-70b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "meta-llama-3-1-8b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Meta-Llama-3-1-8B-Instruct-FP8",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "meta-llama-3-3-70b-instruct",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Meta-Llama-3-70B-Instruct-abliterated-v3.5",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Meta-Llama-3-8B-Instruct-Lite",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Meta-Llama-3.1-405B-Instruct-Turbo",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "Meta-Llama-3.1-8B-Instruct",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "Meta-Llama-3.3-70B-Instruct",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "meta.llama-3.3-70b-instruct",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "meta.llama-4-maverick-17b-128e-instruct-fp8",
      contextWindow:  512000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "meta.llama-4-scout-17b-16e-instruct",
      contextWindow:  192000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "meta.llama3-1-70b-instruct-v1:0",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "meta.llama3-1-8b-instruct-v1:0",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "meta.llama3-3-70b-instruct-v1:0",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "meta.llama4-maverick-17b-instruct-v1:0",
      contextWindow:  1000000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "meta.llama4-scout-17b-instruct-v1:0",
      contextWindow:  10000000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2-5-pro",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "mimo-v2-5:free",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2-6-flash",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2-6-pro",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2-6-pro-ultraspeed",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2-flash",
      contextWindow:  262144,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "MiMo-V2-Flash",
      contextWindow:  262144,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "mimo-v2-flash-free",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "mimo-v2-omni",
      contextWindow:  265000,
      maxOutputTokens:  265000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2-omni-free",
      contextWindow:  262144,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2-pro",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "mimo-v2-pro-free",
      contextWindow:  1048576,
      maxOutputTokens:  64000,
      verified:  false
    },
    {
      id:  "mimo-v2-tts",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "mimo-v2.5",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "MiMo-V2.5",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2.5-free",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2.5-pro",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "MiMo-V2.5-Pro",
      contextWindow:  1048576,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "mimo-v2.5-pro-ultraspeed",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "mimo-v2.5-pro:thinking",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "mimo-v2.5-tts",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "mimo-v2.5-tts-voiceclone",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "mimo-v2.5-tts-voicedesign",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "mimo-v2.5:thinking",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2.6-flash",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "MiMo-V2.6-Flash",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2.6-flash-abliterated",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2.6-flash-free",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2.6-flash-uncensored",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2.6-flash-uncensored:thinking",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2.6-pro",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "MiMo-V2.6-Pro",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v2.6-pro-ultraspeed",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mimo-v25",
      contextWindow:  1000000,
      maxOutputTokens:  100000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mini_lm_l12_v2",
      contextWindow:  128,
      maxOutputTokens:  384,
      verified:  false
    },
    {
      id:  "minicpm-v-4.5",
      contextWindow:  32000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "MiniCPM5-2B",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "minimax-01",
      contextWindow:  1000192,
      maxOutputTokens:  16384,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "minimax-h3",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "minimax-h3-max",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "minimax-latest",
      contextWindow:  512000,
      maxOutputTokens:  80000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "minimax-m1",
      contextWindow:  1000000,
      maxOutputTokens:  40000,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "MiniMax-M1",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "minimax-m1-80k",
      contextWindow:  1000000,
      maxOutputTokens:  40000,
      verified:  false
    },
    {
      id:  "MiniMax-M1-80k",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "minimax-m2",
      contextWindow:  200000,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "MiniMax-M2",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "MiniMax-M2_5-high-throughput",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "minimax-m2-5",
      contextWindow:  192000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "minimax-m2-7",
      contextWindow:  200000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "minimax-m2-7-highspeed",
      contextWindow:  200000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "minimax-m2-her",
      contextWindow:  65532,
      maxOutputTokens:  2048,
      verified:  false
    },
    {
      id:  "minimax-m2.1",
      contextWindow:  205000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "MiniMax-M2.1",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "minimax-m2.1-free",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "minimax-m2.1-lightning",
      contextWindow:  196608,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      verified:  false
    },
    {
      id:  "minimax-m2.5",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "MiniMax-M2.5",
      contextWindow:  196608,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "minimax-m2.5-free",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "minimax-m2.5-highspeed",
      contextWindow:  204800,
      maxOutputTokens:  131100,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      verified:  false
    },
    {
      id:  "MiniMax-M2.5-highspeed",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "minimax-m2.5-lightning",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "minimax-m2.7",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "MiniMax-M2.7",
      contextWindow:  196608,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "minimax-m2.7-highspeed",
      contextWindow:  204800,
      maxOutputTokens:  131100,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      verified:  false
    },
    {
      id:  "MiniMax-M2.7-highspeed",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "minimax-m2.7-turbo",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "minimax-m2.7:free",
      contextWindow:  204800,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "minimax-m25",
      contextWindow:  198000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "minimax-m27",
      contextWindow:  198000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "minimax-m3",
      contextWindow:  1000000,
      maxOutputTokens:  524288,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "MiniMax-M3",
      contextWindow:  524288,
      maxOutputTokens:  512000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "minimax-m3-free",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "minimax-m3-preview",
      contextWindow:  524288,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "minimax-m3:fast",
      contextWindow:  1048576,
      maxOutputTokens:  512000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "minimax-m3:thinking",
      contextWindow:  512000,
      maxOutputTokens:  80000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "MiniMax-M3.1-Flash-Preview",
      contextWindow:  1000000,
      maxOutputTokens:  512000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "minimax-m3@eu",
      contextWindow:  1048576,
      maxOutputTokens:  1048576,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "minimax-text-01",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "minimax.minimax-m2",
      contextWindow:  204608,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "minimax.minimax-m2.1",
      contextWindow:  196608,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "minimax.minimax-m2.5",
      contextWindow:  196608,
      maxOutputTokens:  98304,
      verified:  false
    },
    {
      id:  "ministral-14b",
      contextWindow:  262144,
      maxOutputTokens:  256000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "ministral-14b-2512",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "ministral-14b-instruct-2512",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Ministral-3-14B-Instruct-2512",
      contextWindow:  100000,
      maxOutputTokens:  262144,
      verified:  false
    },
    {
      id:  "Ministral-3-14B-Reasoning-2512",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Ministral-3-3B-Reasoning-2512",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "ministral-3-8b-instruct-2512",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "ministral-3b",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "ministral-3b-2512",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "ministral-3b-latest",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "ministral-8b",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "ministral-8b-2512",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "Ministral-8B-Instruct-2410",
      contextWindow:  128000,
      maxOutputTokens:  4000,
      verified:  false
    },
    {
      id:  "ministral-8b-latest",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "mistral-3-14B",
      contextWindow:  262144,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "mistral-7b-instruct-v0.2",
      contextWindow:  32000,
      maxOutputTokens:  8192,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "mistral-7b-instruct-v0.3",
      contextWindow:  65536,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "Mistral-7B-Instruct-v0.3",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "mistral-code-agent-latest",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "mistral-code-latest",
      contextWindow:  256000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "mistral-embed",
      contextWindow:  8000,
      maxOutputTokens:  3072,
      verified:  false
    },
    {
      id:  "mistral-large",
      contextWindow:  128000,
      maxOutputTokens:  102400,
      verified:  false
    },
    {
      id:  "mistral-large-2402",
      contextWindow:  32000,
      maxOutputTokens:  8192,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "mistral-large-2407",
      contextWindow:  131072,
      maxOutputTokens:  104857,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "mistral-large-2411",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "mistral-large-2512",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-large-3",
      contextWindow:  262144,
      maxOutputTokens:  256000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-large-3-675b-instruct-2512",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-large-3:675b",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Mistral-Large-Instruct-2411",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-large-latest",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-large:free",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-large2",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-medium",
      contextWindow:  128000,
      maxOutputTokens:  64000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-medium-2505",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-medium-2508",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-medium-2604",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-medium-3",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-medium-3-5",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-medium-3-5:free",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-medium-3-5@eu",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-medium-3-instruct",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-medium-3.1",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "mistral-medium-3.5",
      contextWindow:  256000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-medium-3.5-128b",
      contextWindow:  256000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Mistral-Medium-3.5-128B",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-medium-3.5:thinking",
      contextWindow:  256000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-medium-latest",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-medium-latest@eu",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-nemo",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "mistral-nemo-12b-instruct",
      contextWindow:  16000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "mistral-nemo-instruct-2407",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Mistral-Nemo-Instruct-2407",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "Mistral-Nemo-Instruct-2407-TEE",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "mistral-nemotron",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "mistral-saba",
      contextWindow:  32768,
      maxOutputTokens:  26214,
      verified:  false
    },
    {
      id:  "mistral-small",
      contextWindow:  262144,
      maxOutputTokens:  4000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-small-24b-instruct-2501",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "mistral-small-2503",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-small-2506",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-small-2603",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-small-2603@eu",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-small-3-1-24b-instruct-2503",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-small-3-2-24b-instruct",
      contextWindow:  256000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-small-3.1-24b-instruct",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "mistral-small-3.2-24b-instruct",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "mistral-small-3.2-24b-instruct-2506",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Mistral-Small-3.2-24B-Instruct-2506",
      contextWindow:  32000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "mistral-small-4",
      contextWindow:  256000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-small-4-119b",
      contextWindow:  256000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-small-4-119b-2603",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Mistral-Small-4-119B-2603",
      contextWindow:  32000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-small-4-119b-2603:thinking",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral-small-latest",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral.devstral-2-123b",
      contextWindow:  262144,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "mistral.magistral-small-2509",
      contextWindow:  128000,
      maxOutputTokens:  40000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral.ministral-3-14b-instruct",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral.ministral-3-3b-instruct",
      contextWindow:  256000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral.ministral-3-8b-instruct",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral.mistral-large-3-675b-instruct",
      contextWindow:  262144,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistral.pixtral-large-2502-v1:0",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "mistral.pixtral-large-2502-v1:0@us",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "mistral.voxtral-mini-3b-2507",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "mistral.voxtral-mini-3b-2507@us",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "mistral.voxtral-small-24b-2507",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "mistral.voxtral-small-24b-2507@us",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "mistral4-119b",
      contextWindow:  262144,
      maxOutputTokens:  81920,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistralai--mistral-medium",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistralai--mistral-medium-instruct",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mistralai--mistral-small",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "mixtral-8x22b-instruct",
      contextWindow:  65536,
      maxOutputTokens:  52428,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "mixtral-8x22b-instruct-v0.1",
      contextWindow:  65536,
      maxOutputTokens:  52428,
      verified:  false
    },
    {
      id:  "mixtral-8x7b-instruct",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "mixtral-8x7B-instruct-v0.1",
      contextWindow:  32000,
      maxOutputTokens:  4096,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "mm-poly-8b",
      contextWindow:  32768,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "MN-12B-Mag-Mell-R1",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "MN-LooseCannon-12B-v1",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "model-router",
      contextWindow:  200000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "moonshot-kimi-k2-instruct",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "moonshot.kimi-k2-thinking",
      contextWindow:  256000,
      maxOutputTokens:  262144,
      verified:  false
    },
    {
      id:  "moonshotai.kimi-k2.5",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "morph-v3-fast",
      contextWindow:  81920,
      maxOutputTokens:  38000,
      verified:  false
    },
    {
      id:  "morph-v3-large",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "motif-3",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "MS3.2-24B-Magnum-Diamond",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "MS3.2-The-Omega-Directive-24B-Unslop-v2.0",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "multi-qa-mpnet-base-dot-v1",
      contextWindow:  512,
      maxOutputTokens:  768,
      verified:  false
    },
    {
      id:  "multilingual-e5-large-instruct",
      contextWindow:  512,
      maxOutputTokens:  512,
      verified:  false
    },
    {
      id:  "multilingual-v2",
      verified:  false
    },
    {
      id:  "muse-glimmer-30b",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Muse-Glimmer-30B",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "muse-glimmer-30b-tr",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "muse-image-1.0",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "muse-spark-1-1",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "muse-spark-1-2",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "muse-spark-1-3",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "muse-spark-1.1",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "muse-spark-1.2",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "muse-spark-1.2-contributor",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "muse-spark-1.2-contributor-free",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "muse-spark-1.3",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "muse-spark-1.3-contributor",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "muse-spark-1.3-contributor-free",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "mythomax-l2-13b",
      contextWindow:  4096,
      maxOutputTokens:  3686,
      verified:  false
    },
    {
      id:  "MythoMax-L2-13b",
      contextWindow:  4096,
      maxOutputTokens:  3686,
      verified:  false
    },
    {
      id:  "namazu",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "nano-banana",
      contextWindow:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "nano-banana-pro",
      contextWindow:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "nano-gpt-help",
      contextWindow:  6000,
      maxOutputTokens:  512,
      verified:  false
    },
    {
      id:  "NemoMix-Unleashed-12B",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Nemotron-120B-A12B",
      contextWindow:  202800,
      maxOutputTokens:  202800,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "Nemotron-3_5-Lightning",
      contextWindow:  1048576,
      maxOutputTokens:  1048576,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "nemotron-3-120b-a12b",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "nemotron-3-content-safety",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "nemotron-3-nano-30b",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "nemotron-3-nano-30b-a3b",
      contextWindow:  262144,
      maxOutputTokens:  235929,
      verified:  false
    },
    {
      id:  "Nemotron-3-Nano-30B-A3B",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "nemotron-3-nano-omni",
      contextWindow:  300000,
      maxOutputTokens:  300000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "nemotron-3-nano-omni-30b-a3b-reasoning",
      contextWindow:  256000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Nemotron-3-Nano-Omni-30B-A3B-Reasoning",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "nemotron-3-nano-omni-30b-a3b-reasoning:free",
      contextWindow:  256000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Nemotron-3-Nano-Omni-30B-TEE",
      contextWindow:  131072,
      verified:  false
    },
    {
      id:  "Nemotron-3-Nano-Omni-Reasoning-30B-A3B",
      contextWindow:  256000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "nemotron-3-nano-omni@eu",
      contextWindow:  300000,
      maxOutputTokens:  300000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "nemotron-3-nano:30b",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "nemotron-3-super",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "nemotron-3-super-120b-a12b",
      contextWindow:  1000000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      verified:  false
    },
    {
      id:  "nemotron-3-super-120b-a12b:free",
      contextWindow:  262144,
      maxOutputTokens:  235929,
      thinkingLevels:  [
        "off",
        "low",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "nemotron-3-super-120b-a12b:thinking",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "nemotron-3-super-free",
      contextWindow:  204800,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "nemotron-3-ultra",
      contextWindow:  131072,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "nemotron-3-ultra-550b",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "nemotron-3-ultra-550b-a55b",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "Nemotron-3-Ultra-550b-a55b",
      contextWindow:  1048576,
      maxOutputTokens:  1048576,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "nemotron-3-ultra-550b-a55b:free",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "nemotron-3-ultra-550b-a55b:thinking",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "nemotron-3-ultra-free",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "nemotron-3-ultra-nvfp4",
      contextWindow:  262144,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "nemotron-3.5-content-safety",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "nemotron-3.5-content-safety:free",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "nemotron-3.5-lightning",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "nemotron-3.5-lightning-30b-a3b",
      contextWindow:  1000000,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "nemotron-3.5-lightning-free",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      verified:  false
    },
    {
      id:  "nemotron-3.5-lightning:free",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "nemotron-3.5-lightning:thinking",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "Nemotron-Cascade-2-30B-A3B",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "nemotron-content-safety-reasoning-4b",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "nemotron-lightning-3.5-30b-a3b",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "nemotron-lightning-3p5-30b-a3b",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "nemotron-mini-4b-instruct",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "nemotron-nano-12b-v2-vl",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "nemotron-nano-9b-v2",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "nemotron-nano-v2-12b",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "nemotron-voicechat",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "neosmith.intelligent-basic",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "neosmith.intelligent-maestro",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "neosmith.intelligent-pro",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "neosmith.neolite",
      contextWindow:  512000,
      maxOutputTokens:  64000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "NeuralDaredevil-8B-abliterated",
      contextWindow:  8192,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Nex-N2-Pro",
      contextWindow:  262144,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "nex-n2.5-mini",
      contextWindow:  262144,
      maxOutputTokens:  235929,
      thinkingLevels:  [
        "off",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "nex-n2.5-pro",
      contextWindow:  262144,
      maxOutputTokens:  235929,
      thinkingLevels:  [
        "off",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "nomic-embed-text",
      contextWindow:  8192,
      maxOutputTokens:  768,
      verified:  false
    },
    {
      id:  "north-mini-code-1-0",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "north-mini-code-free",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "north-mini-code:free",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "nova-2-lite",
      contextWindow:  1000000,
      maxOutputTokens:  65535,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "nova-2-lite-v1",
      contextWindow:  1000000,
      maxOutputTokens:  65535,
      verified:  false
    },
    {
      id:  "nova-2-pro-v1",
      contextWindow:  1000000,
      maxOutputTokens:  64000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "nova-lite",
      contextWindow:  300000,
      maxOutputTokens:  10000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "nova-lite-v1",
      contextWindow:  300000,
      maxOutputTokens:  5120,
      verified:  false
    },
    {
      id:  "nova-micro",
      contextWindow:  128000,
      maxOutputTokens:  10000,
      verified:  false
    },
    {
      id:  "nova-micro-v1",
      contextWindow:  128000,
      maxOutputTokens:  5120,
      verified:  false
    },
    {
      id:  "nova-premier-v1",
      contextWindow:  1000000,
      maxOutputTokens:  32000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "nova-pro",
      contextWindow:  300000,
      maxOutputTokens:  10000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "nova-pro-v1",
      contextWindow:  300000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "nv-embed-v1",
      contextWindow:  32768,
      maxOutputTokens:  2048,
      verified:  false
    },
    {
      id:  "nv-embedcode-7b-v1",
      contextWindow:  32768,
      maxOutputTokens:  2048,
      verified:  false
    },
    {
      id:  "nvidia--llama-3.2-nv-embedqa-1b",
      contextWindow:  8192,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "nvidia-nemotron-3-nano-30b-a3b",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "NVIDIA-Nemotron-3-Nano-30B-A3B",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "NVIDIA-Nemotron-3-Nano-30B-A3B-BF16",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "NVIDIA-Nemotron-3-Nano-30B-A3B-FP8",
      contextWindow:  1000000,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "nvidia-nemotron-3-super-120b",
      contextWindow:  1000000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "nvidia-nemotron-3-super-120b-a12b",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "NVIDIA-Nemotron-3-Super-120B-A12B",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "NVIDIA-Nemotron-3-Super-120B-A12B-FP8",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "nvidia-nemotron-3-ultra",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "nvidia-nemotron-3-ultra-550b-a55b",
      contextWindow:  256000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "NVIDIA-Nemotron-3-Ultra-550B-A55B",
      contextWindow:  202800,
      maxOutputTokens:  202800,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16",
      contextWindow:  1000000,
      maxOutputTokens:  65000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "NVIDIA-Nemotron-3.5-Lightning-30B-A3B",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16",
      contextWindow:  8192,
      maxOutputTokens:  4096,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      verified:  false
    },
    {
      id:  "nvidia-nemotron-nano-9b-v2",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "nvidia.nemotron-nano-12b-v2",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "nvidia.nemotron-nano-3-30b",
      contextWindow:  262144,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "nvidia.nemotron-nano-9b-v2",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "nvidia.nemotron-super-3-120b",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "o1",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "o1-mini",
      contextWindow:  128000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "o1-pro",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "o3",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      reasoning:  "medium",
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  true
    },
    {
      id:  "o3-deep-research",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      verified:  false
    },
    {
      id:  "o3-fast",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "o3-mini",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "o3-mini-high",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "o3-mini-low",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "o3-pro",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "o3-pro-2025-06-10",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "o4-mini",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "o4-mini-deep-research",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      verified:  false
    },
    {
      id:  "o4-mini-fast",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "o4-mini-high",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "o4-mini@eu",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "olafangensan-glm-4.7-flash-heretic",
      contextWindow:  200000,
      maxOutputTokens:  24000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "open-mistral-7b",
      contextWindow:  8000,
      maxOutputTokens:  8000,
      verified:  false
    },
    {
      id:  "open-mistral-nemo",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "open-mixtral-8x22b",
      contextWindow:  64000,
      maxOutputTokens:  64000,
      verified:  false
    },
    {
      id:  "open-mixtral-8x7b",
      contextWindow:  32000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "openai-gpt-4.1",
      contextWindow:  128000,
      maxOutputTokens:  32000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-4o",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-4o-2024-11-20",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-4o-mini",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-4o-mini-2024-07-18",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-5",
      contextWindow:  272000,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-5-mini",
      contextWindow:  272000,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-5-nano",
      contextWindow:  272000,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-5.1",
      contextWindow:  272000,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-5.1-codex-max",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-5.2",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-5.2-pro",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-5.3-codex",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-5.4",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-5.4-mini",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-5.4-nano",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-5.4-pro",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-5.5",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-5.6-luna",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-5.6-sol",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-5.6-terra",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-52",
      contextWindow:  256000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      verified:  false
    },
    {
      id:  "openai-gpt-53-codex",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-54",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-54-mini",
      contextWindow:  400000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-54-pro",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-55",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-55-pro",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-56-luna",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-56-luna-pro",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-56-sol",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-56-sol-pro",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-56-terra",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-56-terra-pro",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-6-astra",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-6-astra-pro",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-6-luna",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-6-sol",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-61-sol",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-image-1",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-image-1.5",
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-image-2",
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-gpt-oss-120b",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "openai-gpt-oss-20b",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "openai-o1",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-o3",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai-o3-mini",
      contextWindow:  200000,
      maxOutputTokens:  100000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "openai.gpt-5.4",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "openai.gpt-5.5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "openai.gpt-5.6-luna",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "openai.gpt-5.6-sol",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "openai.gpt-5.6-terra",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "openai.gpt-6-astra",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "openai.gpt-6-luna",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "openai.gpt-6-sol",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "openai.gpt-oss-120b",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "openai.gpt-oss-120b-1:0",
      contextWindow:  131072,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "openai.gpt-oss-20b",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "openai.gpt-oss-20b-1:0",
      contextWindow:  131072,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "openai.gpt-oss-safeguard-120b",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "openai.gpt-oss-safeguard-20b",
      contextWindow:  128000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "openai.gpt-oss-safeguard-20b@us",
      contextWindow:  128000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "OpenReasoning-Nemotron-32B",
      contextWindow:  32768,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "Ornith-1.0-35B-FP8",
      contextWindow:  262000,
      maxOutputTokens:  100000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "ornith-1.5-35b-a3b",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Ornith-1.5-35B-A3B",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "ornith-1.5-35b-a3b:thinking",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "orpheus-arabic-saudi",
      contextWindow:  4000,
      maxOutputTokens:  50000,
      verified:  false
    },
    {
      id:  "orpheus-v1-english",
      contextWindow:  4000,
      maxOutputTokens:  50000,
      verified:  false
    },
    {
      id:  "osmosis-structure-0.6b",
      contextWindow:  4000,
      maxOutputTokens:  2048,
      verified:  false
    },
    {
      id:  "ox-alpha",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "paddleocr-vl",
      contextWindow:  16384,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "PaddleOCR-VL-1.5",
      contextWindow:  16384,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "palmyra-x4",
      contextWindow:  128000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "palmyra-x5",
      contextWindow:  1040000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "pareto",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "pareto-code",
      contextWindow:  200000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "perceptron-mk1",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "perceptron-mk1.5",
      contextWindow:  36864,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "phi-4",
      contextWindow:  16384,
      maxOutputTokens:  14745,
      verified:  false
    },
    {
      id:  "phi-4-mini",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "phi-4-mini-instruct",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "phi-4-mini-reasoning",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "phi-4-multimodal",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "phi-4-multimodal-instruct",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "phi-4-reasoning",
      contextWindow:  32000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "phi-4-reasoning-plus",
      contextWindow:  32000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "pixel-canary",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "pixtral-12b",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "pixtral-12b-2409",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Pixtral-12B-2409",
      contextWindow:  128000,
      maxOutputTokens:  4000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "pixtral-large-2502",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "pixtral-large-latest",
      contextWindow:  128000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "pokee-isaac",
      contextWindow:  10000000,
      maxOutputTokens:  60000,
      verified:  false
    },
    {
      id:  "pplx-embed-v1-0.6b",
      contextWindow:  32000,
      verified:  false
    },
    {
      id:  "pplx-embed-v1-4b",
      contextWindow:  32000,
      verified:  false
    },
    {
      id:  "qvq-max",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-2.5-14b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "qwen-2.5-72b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwen-2.5-7b-instruct",
      contextWindow:  32768,
      maxOutputTokens:  29491,
      verified:  false
    },
    {
      id:  "qwen-2.5-7b-vision-instruct",
      contextWindow:  125000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-2.5-coder-32b",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwen-2.5-coder-32b-instruct",
      contextWindow:  32768,
      maxOutputTokens:  29491,
      verified:  false
    },
    {
      id:  "qwen-3-14b",
      contextWindow:  40960,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "qwen-3-235b",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "qwen-3-30b",
      contextWindow:  40960,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "qwen-3-32b",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "qwen-3-6-plus",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-3-7-max",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-3-7-plus",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-3-8-2-4t-a95b",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "qwen-3-8-27b",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-3-8-flash",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-3-8-max",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-3.6-max-preview",
      contextWindow:  240000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "qwen-3.6-plus",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-3.8-27b",
      contextWindow:  131072,
      maxOutputTokens:  40960,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-3.8-27b-flex",
      contextWindow:  262128,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-coder-plus",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwen-deep-research",
      contextWindow:  1000000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "qwen-doc-turbo",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwen-flash",
      contextWindow:  1000000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "qwen-image",
      contextWindow:  8192,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "qwen-image-2.0",
      contextWindow:  8192,
      verified:  false
    },
    {
      id:  "qwen-image-2.0-pro",
      contextWindow:  8192,
      verified:  false
    },
    {
      id:  "qwen-image-2.1",
      contextWindow:  8192,
      verified:  false
    },
    {
      id:  "qwen-image-edit",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-long",
      contextWindow:  10000000,
      maxOutputTokens:  8192,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "qwen-math-plus",
      contextWindow:  4096,
      maxOutputTokens:  3072,
      verified:  false
    },
    {
      id:  "qwen-math-turbo",
      contextWindow:  4096,
      maxOutputTokens:  3072,
      verified:  false
    },
    {
      id:  "qwen-max",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwen-max-2025-01-25",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "qwen-max-latest",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-mt-plus",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwen-mt-turbo",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwen-omni-turbo",
      contextWindow:  32768,
      maxOutputTokens:  2048,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-omni-turbo-realtime",
      contextWindow:  32768,
      maxOutputTokens:  2048,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-plus",
      contextWindow:  1000000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "qwen-plus-2025-07-28",
      contextWindow:  1000000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "qwen-plus-character",
      contextWindow:  32768,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "qwen-plus-character-ja",
      contextWindow:  8192,
      maxOutputTokens:  512,
      verified:  false
    },
    {
      id:  "qwen-plus-latest",
      contextWindow:  1000000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "qwen-turbo",
      contextWindow:  1000000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "qwen-vl-max",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-vl-max-2025-01-25",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-vl-ocr",
      contextWindow:  34096,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen-vl-plus",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen.qwen3-235b-a22b-2507-v1:0",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "qwen.qwen3-32b-v1:0",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "qwen.qwen3-coder-30b-a3b-v1:0",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "qwen.qwen3-coder-480b-a35b-v1:0",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "qwen.qwen3-coder-next",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "qwen.qwen3-next-80b-a3b",
      contextWindow:  262144,
      maxOutputTokens:  262000,
      verified:  false
    },
    {
      id:  "qwen.qwen3-vl-235b-a22b",
      contextWindow:  262144,
      maxOutputTokens:  262000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen2-5-14b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwen2-5-32b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwen2-5-72b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwen2-5-7b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwen2-5-coder-32b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwen2-5-coder-7b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwen2-5-math-72b-instruct",
      contextWindow:  4096,
      maxOutputTokens:  3072,
      verified:  false
    },
    {
      id:  "qwen2-5-math-7b-instruct",
      contextWindow:  4096,
      maxOutputTokens:  3072,
      verified:  false
    },
    {
      id:  "qwen2-5-omni-7b",
      contextWindow:  32768,
      maxOutputTokens:  2048,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen2-5-vl-72b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen2-5-vl-7b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen2.5-32B-Instruct-abliterated",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Qwen2.5-72B-Instruct",
      contextWindow:  33000,
      maxOutputTokens:  4000,
      verified:  false
    },
    {
      id:  "qwen2.5-7b-instruct",
      contextWindow:  32000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "Qwen2.5-7B-Instruct",
      contextWindow:  33000,
      maxOutputTokens:  4000,
      verified:  false
    },
    {
      id:  "Qwen2.5-7B-Instruct-Turbo",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "Qwen2.5-Coder-0.5B",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "qwen2.5-coder-32b-instruct",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "Qwen2.5-Coder-32B-Instruct",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwen2.5-coder-7b-fast",
      contextWindow:  32000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Qwen2.5-VL-32B-Instruct",
      contextWindow:  16384,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen2.5-vl-72b-instruct",
      contextWindow:  65536,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen2.5-vl-7b-instruct",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3_5-9B-MLX-4bit",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3_5-9B-Q4_K_M",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3-1.7B-Base",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "qwen3-14b",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "Qwen3-14B",
      contextWindow:  131000,
      maxOutputTokens:  131000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "Qwen3-14B-Instruct",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "qwen3-235b",
      contextWindow:  128000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "qwen3-235b-2507-cs",
      verified:  false
    },
    {
      id:  "qwen3-235b-a22b",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "Qwen3-235B-A22B",
      contextWindow:  40960,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "qwen3-235b-a22b-2507",
      contextWindow:  262144,
      maxOutputTokens:  235929,
      verified:  false
    },
    {
      id:  "qwen3-235b-a22b-fp8",
      contextWindow:  40960,
      maxOutputTokens:  20000,
      verified:  false
    },
    {
      id:  "qwen3-235b-a22b-instruct",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      verified:  false
    },
    {
      id:  "qwen3-235b-a22b-instruct-2507",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "Qwen3-235B-A22B-Instruct-2507",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "qwen3-235b-a22b-instruct-2507-maas",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "Qwen3-235B-A22B-Instruct-2507-tput",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      verified:  false
    },
    {
      id:  "qwen3-235b-a22b-thinking",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-235b-a22b-thinking-2507",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "Qwen3-235B-A22B-Thinking-2507",
      contextWindow:  262000,
      maxOutputTokens:  262000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "Qwen3-235B-A22B-Thinking-2507-TEE",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      verified:  false
    },
    {
      id:  "qwen3-30b-a3b",
      contextWindow:  41000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "Qwen3-30B-A3B",
      contextWindow:  40960,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "qwen3-30b-a3b-2507",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "qwen3-30b-a3b-fp8",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "qwen3-30b-a3b-instruct-2507",
      contextWindow:  256000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "Qwen3-30B-A3B-Instruct-2507",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      verified:  false
    },
    {
      id:  "qwen3-30b-a3b-thinking-2507",
      contextWindow:  81920,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "high"
      ],
      verified:  false
    },
    {
      id:  "Qwen3-30B-A3B-Thinking-2507",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "qwen3-32b",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "Qwen3-32B",
      contextWindow:  40960,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "qwen3-32b-cs",
      verified:  false
    },
    {
      id:  "qwen3-32b-fp8",
      contextWindow:  40960,
      maxOutputTokens:  20000,
      verified:  false
    },
    {
      id:  "Qwen3-32B-TEE",
      contextWindow:  40960,
      maxOutputTokens:  40960,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "Qwen3-4B-Base",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "qwen3-4b-fp8",
      contextWindow:  128000,
      maxOutputTokens:  20000,
      verified:  false
    },
    {
      id:  "Qwen3-4B-Instruct-2507",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "qwen3-5-122b-a10b",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-5-27b",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-5-35b-a3b",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-5-397b-a17b",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-5-4b",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-5-9b",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-5-flash",
      contextWindow:  1000000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-5-plus",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-6-27b",
      contextWindow:  256000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-6-35b",
      contextWindow:  16384,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-6-35b-a3b",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "qwen3-6-flash",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-6-max-preview",
      contextWindow:  256000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "qwen3-6-plus",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-7-flash",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-7-max",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "qwen3-7-plus",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-8-27b",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-8-flash",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-8-max",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-8-max-0902",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-8-omni-flash",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-8b",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "Qwen3-8B",
      contextWindow:  131000,
      maxOutputTokens:  131000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "qwen3-8b-fp8",
      contextWindow:  128000,
      maxOutputTokens:  20000,
      verified:  false
    },
    {
      id:  "qwen3-asr-flash",
      contextWindow:  53248,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "qwen3-coder",
      contextWindow:  262000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "qwen3-coder-30b",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "qwen3-coder-30b-a3b",
      contextWindow:  262144,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwen3-coder-30b-a3b-instruct",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "Qwen3-Coder-30B-A3B-Instruct",
      contextWindow:  262000,
      maxOutputTokens:  262000,
      verified:  false
    },
    {
      id:  "qwen3-coder-480b-a35b-instruct",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "Qwen3-Coder-480B-A35B-Instruct",
      contextWindow:  262000,
      maxOutputTokens:  262000,
      verified:  false
    },
    {
      id:  "Qwen3-Coder-480B-A35B-Instruct-FP8",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      verified:  false
    },
    {
      id:  "Qwen3-Coder-480B-A35B-Instruct-int4-mixed-ar",
      contextWindow:  106000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "qwen3-coder-480b-a35b-instruct-turbo",
      contextWindow:  256000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "Qwen3-Coder-480B-A35B-Instruct-Turbo",
      contextWindow:  262144,
      maxOutputTokens:  66536,
      verified:  false
    },
    {
      id:  "qwen3-coder-flash",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "qwen3-coder-next",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "Qwen3-Coder-Next",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "Qwen3-Coder-Next-FP8",
      contextWindow:  256144,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "Qwen3-Coder-Next-FP8-no-thinking",
      contextWindow:  260000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "qwen3-coder-next@eu",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "qwen3-coder-plus",
      contextWindow:  1048576,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "qwen3-coder:30b",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "qwen3-embedding-0.6b",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "Qwen3-Embedding-0.6B",
      contextWindow:  32768,
      maxOutputTokens:  1024,
      verified:  false
    },
    {
      id:  "qwen3-embedding-4b",
      contextWindow:  32000,
      maxOutputTokens:  2560,
      verified:  false
    },
    {
      id:  "Qwen3-Embedding-4B",
      contextWindow:  32000,
      maxOutputTokens:  2048,
      verified:  false
    },
    {
      id:  "qwen3-embedding-8b",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Qwen3-Embedding-8B",
      contextWindow:  32000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "qwen3-livetranslate-flash-realtime",
      contextWindow:  53248,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-max",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "Qwen3-Max",
      contextWindow:  256000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "qwen3-max-2025-09-23",
      contextWindow:  258048,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "qwen3-max-2026-01-23",
      contextWindow:  256000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "qwen3-max-preview",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "qwen3-max-thinking",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "qwen3-max@eu",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "qwen3-next-80b",
      contextWindow:  256000,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "qwen3-next-80b-a3b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "Qwen3-Next-80B-A3B-Instruct",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "qwen3-next-80b-a3b-thinking",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "Qwen3-Next-80B-A3B-Thinking",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "qwen3-omni-30b-a3b-instruct",
      contextWindow:  65536,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-omni-30b-a3b-thinking",
      contextWindow:  65536,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-omni-flash",
      contextWindow:  65536,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-omni-flash-realtime",
      contextWindow:  65536,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3-Reranker-0.6B",
      contextWindow:  40960,
      maxOutputTokens:  1024,
      verified:  false
    },
    {
      id:  "qwen3-reranker-4b",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Qwen3-Reranker-4B",
      contextWindow:  32000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "qwen3-tts-voicedesign",
      contextWindow:  32768,
      maxOutputTokens:  1,
      verified:  false
    },
    {
      id:  "qwen3-vl-235b-a22b",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-vl-235b-a22b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3-VL-235B-A22B-Instruct",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3-VL-235B-A22B-Instruct-FP8",
      contextWindow:  218000,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-vl-235b-a22b-instruct-original",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-vl-235b-a22b-thinking",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3-VL-235B-A22B-Thinking",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-vl-30b-a3b",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-vl-30b-a3b-instruct",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3-VL-30B-A3B-Instruct",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-vl-30b-a3b-thinking",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3-VL-30B-A3B-Thinking",
      contextWindow:  262000,
      maxOutputTokens:  262000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-vl-32b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3-VL-32B-Instruct",
      contextWindow:  262000,
      maxOutputTokens:  262000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3-VL-32B-Thinking",
      contextWindow:  262000,
      maxOutputTokens:  262000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-vl-8b-instruct",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3-VL-8B-Instruct",
      contextWindow:  262000,
      maxOutputTokens:  262000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-vl-8b-thinking",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3-VL-Embedding-8B",
      contextWindow:  32000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-vl-flash",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-vl-instruct",
      contextWindow:  131072,
      maxOutputTokens:  129024,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-vl-plus",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3-vl-thinking",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-0.8b",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwen3.5-122b",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-122b-a10b",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.5-122B-A10B",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.5-122B-A10B-FP8",
      contextWindow:  200000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-122b-a10b:thinking",
      contextWindow:  131072,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "qwen3.5-27b",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.5-27B",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.5-27B-BlueStar-v3-Derestricted",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.5-27B-Queen-Derestricted",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-27b:thinking",
      contextWindow:  260096,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-2b",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-35b-a3b",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.5-35B-A3B",
      contextWindow:  262144,
      maxOutputTokens:  81920,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-35b-a3b:thinking",
      contextWindow:  260096,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-397b-a17b",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.5-397B-A17B",
      contextWindow:  262144,
      maxOutputTokens:  81920,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.5-397B-A17B-FP8",
      contextWindow:  200000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.5-397B-A17B-TEE",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-397b-a17b:free",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-397b-a17b:thinking",
      contextWindow:  258048,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-4b",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "Qwen3.5-4B",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-9b",
      contextWindow:  256000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.5-9B",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-flash",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-flash-02-23",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-flash:thinking",
      contextWindow:  991808,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-omni-flash",
      contextWindow:  49152,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-omni-plus",
      contextWindow:  983616,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-plus",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.5-Plus",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-plus-02-15",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-plus-20260420",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5-plus:thinking",
      contextWindow:  983616,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.5:397b",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.6",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.6-27b",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.6-27B",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.6-27B-FP8",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.6-27B-TEE",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.6-27b:thinking",
      contextWindow:  260096,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.6-35b",
      contextWindow:  131056,
      maxOutputTokens:  131056,
      thinkingLevels:  [
        "off",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.6-35b-a3b",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.6-35B-A3B",
      contextWindow:  262144,
      maxOutputTokens:  81920,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.6-35B-A3B-FP8",
      contextWindow:  131072,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "Qwen3.6-35B-A3B-fp8-no-thinking",
      contextWindow:  262000,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.6-35b-a3b:thinking",
      contextWindow:  262144,
      maxOutputTokens:  16384,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.6-35b-fast",
      contextWindow:  131056,
      maxOutputTokens:  131056,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.6-35b-flex",
      contextWindow:  131056,
      maxOutputTokens:  131056,
      thinkingLevels:  [
        "off",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.6-flash",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.6-max-preview",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "qwen3.6-plus",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.6-Plus",
      contextWindow:  1000000,
      maxOutputTokens:  500000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "qwen3.6-plus-free",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.6:27b",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.7-flash",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.7-flash:thinking",
      contextWindow:  983616,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.7-max",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "Qwen3.7-Max",
      contextWindow:  256000,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "qwen3.7-max-2026-06-08",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "qwen3.7-max:thinking",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "qwen3.7-plus",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.7-plus:thinking",
      contextWindow:  983616,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-2.4t-a95b",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      verified:  false
    },
    {
      id:  "qwen3.8-2.4T-A95B",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "Qwen3.8-2.4T-A95B",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "xhigh"
      ],
      verified:  false
    },
    {
      id:  "Qwen3.8-2.4T-A95B-NVFP4",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "xhigh"
      ],
      verified:  false
    },
    {
      id:  "qwen3.8-2.4T-A95B@eu",
      contextWindow:  1000000,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "qwen3.8-27b",
      contextWindow:  131042,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.8-27B",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-27b-cybersecurity",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-27b-fable",
      contextWindow:  524288,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.8-27B-FP8",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-27b-hemmingway",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.8-27B-NVFP4",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-27b-obliterated",
      contextWindow:  524288,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-27b-obliterated:thinking",
      contextWindow:  524288,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-27b-queen",
      contextWindow:  524288,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.8-27B-TEE",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-27b-uncensored",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "low",
        "medium",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-27b-uncensored:thinking",
      contextWindow:  524288,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-27b:free",
      contextWindow:  262144,
      maxOutputTokens:  235929,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-27b:thinking",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-flash",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.8-Flash",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-flash-next",
      contextWindow:  262144,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "low",
        "medium",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.8-Flash-Next",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-flash-next@eu",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-max",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "Qwen3.8-Max",
      contextWindow:  256000,
      maxOutputTokens:  131072,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-max-0902",
      contextWindow:  991808,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-max-preview",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-max-prime",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-max:thinking",
      contextWindow:  991000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "qwen3.8-omni-flash",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen35-122b-a10b",
      contextWindow:  262144,
      maxOutputTokens:  25000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "qwen35-397b-a17b",
      contextWindow:  262144,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "qwen3guard-gen-0.6b",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "qwen3guard-gen-8b",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "qwen3p8-2p4t-a95b",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "xhigh"
      ],
      verified:  false
    },
    {
      id:  "qwen3p8-max",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Qwerky-72B",
      contextWindow:  32000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "qwq-32b",
      contextWindow:  24000,
      maxOutputTokens:  24000,
      verified:  false
    },
    {
      id:  "QwQ-32B",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "qwq-plus",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "ray2",
      contextWindow:  5000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "recraft-v2",
      contextWindow:  512,
      verified:  false
    },
    {
      id:  "recraft-v3",
      contextWindow:  512,
      verified:  false
    },
    {
      id:  "recraft-v4",
      verified:  false
    },
    {
      id:  "recraft-v4-pro",
      verified:  false
    },
    {
      id:  "recraft-v4.1",
      verified:  false
    },
    {
      id:  "recraft-v4.1-flash",
      verified:  false
    },
    {
      id:  "recraft-v4.1-pro",
      verified:  false
    },
    {
      id:  "recraft-v4.1-utility",
      verified:  false
    },
    {
      id:  "recraft-v4.1-utility-pro",
      verified:  false
    },
    {
      id:  "reka-edge",
      contextWindow:  16384,
      maxOutputTokens:  14745,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "reka-flash-3",
      contextWindow:  65536,
      maxOutputTokens:  58982,
      thinkingLevels:  [
        "high"
      ],
      verified:  false
    },
    {
      id:  "relace-apply-3",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "relace-search",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      verified:  false
    },
    {
      id:  "remm-slerp-l2-13b",
      contextWindow:  6144,
      maxOutputTokens:  4096,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "rerank-2.5",
      contextWindow:  32000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "rerank-2.5-lite",
      contextWindow:  32000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "rerank-qa-mistral-4b",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "rerank-v3.5",
      contextWindow:  4096,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "rerank-v4-fast",
      contextWindow:  32000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "rerank-v4-pro",
      contextWindow:  32000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "ring-1t",
      contextWindow:  128000,
      maxOutputTokens:  64000,
      verified:  false
    },
    {
      id:  "Ring-1T",
      contextWindow:  128000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "ring-2.6-1t",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      verified:  false
    },
    {
      id:  "ring-2.6-1t-free",
      contextWindow:  262000,
      maxOutputTokens:  66000,
      verified:  false
    },
    {
      id:  "riva-translate-4b-instruct-v1.1",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "Rnj-1-Instruct",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "roc",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Rocinante-12B-v1.1",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "route-llm",
      contextWindow:  128000,
      maxOutputTokens:  64000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "runway",
      contextWindow:  256,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "runway-gen-4-turbo",
      contextWindow:  256,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "s1",
      verified:  false
    },
    {
      id:  "s2-pro",
      verified:  false
    },
    {
      id:  "s2.1-pro",
      verified:  false
    },
    {
      id:  "sakana-namazu",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "sap-abap-1",
      contextWindow:  32768,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "sarvam-105b",
      contextWindow:  131072,
      maxOutputTokens:  4096,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "sarvam-30b",
      contextWindow:  65536,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "sarvam-m",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "schematron-v2-small",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "schematron-v2-turbo",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "schnell",
      verified:  false
    },
    {
      id:  "seed-1-6-250615",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-1-6-250915",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-1-6-flash-250715",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-1-8-251228",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-1.6",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-1.6-flash",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-1.8",
      contextWindow:  256000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-2-0-code",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-2-0-code-preview-260328",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-2-0-lite",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-2-0-lite-260428",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-2-0-mini",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-2-0-mini-260428",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-2-0-pro",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-2-0-pro-260328",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-2-1-turbo",
      contextWindow:  256000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-2.0-code",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Seed-2.0-code",
      contextWindow:  256000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-2.0-lite",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-2.0-mini",
      contextWindow:  262144,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "minimal",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Seed-2.0-mini",
      contextWindow:  256000,
      maxOutputTokens:  32000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-2.0-pro",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Seed-2.0-pro",
      contextWindow:  256000,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-2.1-turbo",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seed-oss-36b-instruct",
      contextWindow:  262000,
      maxOutputTokens:  262000,
      verified:  false
    },
    {
      id:  "Seed-OSS-36B-Instruct",
      contextWindow:  262000,
      maxOutputTokens:  262000,
      verified:  false
    },
    {
      id:  "seedance-2",
      contextWindow:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seedance-2.0",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seedance-2.0-fast",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seedance-2.0-mini",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "seedance-2.5",
      verified:  false
    },
    {
      id:  "seedance-v1.0-pro",
      verified:  false
    },
    {
      id:  "seedance-v1.0-pro-fast",
      verified:  false
    },
    {
      id:  "seedance-v1.5-pro",
      verified:  false
    },
    {
      id:  "seedream-4.0",
      verified:  false
    },
    {
      id:  "seedream-4.5",
      verified:  false
    },
    {
      id:  "seedream-5.0-lite",
      verified:  false
    },
    {
      id:  "seedream-5.0-pro",
      verified:  false
    },
    {
      id:  "sensenova-6.8-flash-lite",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "shisa-v2-llama3.3-70b",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "shisa-v2.1-llama3.3-70b",
      contextWindow:  32768,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "skyfall-36b-v2",
      contextWindow:  32768,
      maxOutputTokens:  29491,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "small",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "SmolLM3-3B-Base",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "snowflake-llama3.3-70b",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "solar-10.7b-instruct",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "solar-mini",
      contextWindow:  32768,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "solar-mini4",
      contextWindow:  524288,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "solar-mini4:thinking",
      contextWindow:  524288,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "solar-pro-3",
      contextWindow:  131072,
      maxOutputTokens:  117964,
      verified:  false
    },
    {
      id:  "solar-pro2",
      contextWindow:  65536,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "minimal",
        "high"
      ],
      verified:  false
    },
    {
      id:  "solar-pro3",
      contextWindow:  131072,
      maxOutputTokens:  8192,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "solar-pro4",
      contextWindow:  524288,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "solar-pro4:thinking",
      contextWindow:  524288,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "sonar",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "sonar-deep-research",
      contextWindow:  128000,
      maxOutputTokens:  115200,
      thinkingLevels:  [
        "off",
        "high"
      ],
      verified:  false
    },
    {
      id:  "sonar-pro",
      contextWindow:  200000,
      maxOutputTokens:  8000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "sonar-pro-search",
      contextWindow:  200000,
      maxOutputTokens:  8000,
      thinkingLevels:  [
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "sonar-reasoning",
      contextWindow:  127000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "sonar-reasoning-pro",
      contextWindow:  128000,
      maxOutputTokens:  115200,
      thinkingLevels:  [
        "off",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "sora-2",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "sora-2-pro",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "space-bunny-alpha",
      contextWindow:  1000000,
      maxOutputTokens:  524288,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "space-bunny-free",
      contextWindow:  1048576,
      maxOutputTokens:  524288,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "sparsedrive",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "stable-diffusion-3.5-large",
      contextWindow:  256,
      maxOutputTokens:  1,
      verified:  false
    },
    {
      id:  "stablediffusionxl",
      contextWindow:  200,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "standardcompute",
      contextWindow:  1000000,
      maxOutputTokens:  24576,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Starcannon-Unleashed-12B-v1.0",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "step-1-32k",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "step-2-16k",
      contextWindow:  16384,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "step-3",
      contextWindow:  65536,
      maxOutputTokens:  64000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "step-3-5-flash",
      contextWindow:  256000,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "step-3-5-flash-2603",
      contextWindow:  256000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high"
      ],
      verified:  false
    },
    {
      id:  "step-3-7-flash",
      contextWindow:  256000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "step-3-7-flash:free",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "step-3.5-flash",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "Step-3.5-Flash",
      contextWindow:  262000,
      maxOutputTokens:  262000,
      verified:  false
    },
    {
      id:  "step-3.5-flash-2603",
      contextWindow:  262144,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "step-3.7-flash",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Step-3.7-Flash",
      contextWindow:  262144,
      maxOutputTokens:  256000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "step-3.7-flash-free",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "step-3.7-flash:free",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "step-3.7-flash:thinking",
      contextWindow:  262144,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "step-5-preview",
      contextWindow:  1024000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "step-router-v1",
      contextWindow:  256000,
      maxOutputTokens:  256000,
      verified:  false
    },
    {
      id:  "step-tts-2",
      verified:  false
    },
    {
      id:  "stepaudio-2.5-asr",
      verified:  false
    },
    {
      id:  "stepaudio-2.5-tts",
      verified:  false
    },
    {
      id:  "streampetr",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "studiovoice",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "synth",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "synth-code",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "synthetic-video-detector",
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "tako",
      contextWindow:  2048,
      verified:  false
    },
    {
      id:  "tc-code-latest",
      contextWindow:  131072,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "ternary-bonsai-2-27b",
      contextWindow:  262144,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "medium",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "text-embedding-005",
      contextWindow:  8192,
      maxOutputTokens:  1536,
      verified:  false
    },
    {
      id:  "text-embedding-3-large",
      contextWindow:  8191,
      maxOutputTokens:  3072,
      verified:  false
    },
    {
      id:  "text-embedding-3-small",
      contextWindow:  8191,
      maxOutputTokens:  1536,
      verified:  false
    },
    {
      id:  "text-embedding-ada-002",
      contextWindow:  8192,
      maxOutputTokens:  1536,
      verified:  false
    },
    {
      id:  "text-max",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "text-multilingual-embedding-002",
      contextWindow:  8192,
      maxOutputTokens:  1536,
      verified:  false
    },
    {
      id:  "text-prime",
      contextWindow:  196608,
      maxOutputTokens:  30000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "text-standard",
      contextWindow:  128000,
      maxOutputTokens:  16000,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "text-to-audio",
      verified:  false
    },
    {
      id:  "tim-qwen3.6-27b",
      contextWindow:  8192,
      maxOutputTokens:  5000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "titan-embed-text-v2",
      contextWindow:  8192,
      maxOutputTokens:  1536,
      verified:  false
    },
    {
      id:  "toast-1",
      contextWindow:  131000,
      maxOutputTokens:  4000,
      verified:  false
    },
    {
      id:  "tongyi-intent-detect-v3",
      contextWindow:  8192,
      maxOutputTokens:  1024,
      verified:  false
    },
    {
      id:  "topazlabs",
      contextWindow:  204,
      verified:  false
    },
    {
      id:  "transcribe-1",
      verified:  false
    },
    {
      id:  "trendyol-asure-12b",
      contextWindow:  40960,
      maxOutputTokens:  40960,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "trinity-large-preview-free",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "trinity-large-thinking",
      contextWindow:  262144,
      maxOutputTokens:  80000,
      verified:  false
    },
    {
      id:  "trinity-mini",
      contextWindow:  131072,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "tts-1",
      verified:  false
    },
    {
      id:  "tts-1-hd",
      verified:  false
    },
    {
      id:  "ui-tars-1.5-7b",
      contextWindow:  128000,
      maxOutputTokens:  2048,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "umans-coder",
      contextWindow:  1048576,
      maxOutputTokens:  131071,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "umans-deepseek-v4-flash-0731",
      contextWindow:  1048576,
      maxOutputTokens:  393215,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "umans-deepseek-v4.1-flash",
      contextWindow:  1048576,
      maxOutputTokens:  393215,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "umans-flash",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "umans-glm-5.3-flash",
      contextWindow:  1048576,
      maxOutputTokens:  131071,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "umans-kimi-k3",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "umans-qwen3.6-35b-a3b",
      contextWindow:  262144,
      maxOutputTokens:  262144,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "universal-summarizer",
      contextWindow:  32768,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "unslopnemo-12b",
      contextWindow:  1024000,
      maxOutputTokens:  819200,
      verified:  false
    },
    {
      id:  "UnslopNemo-12B-v4.1",
      contextWindow:  8192,
      maxOutputTokens:  26214,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us-gov.openai.gpt-oss-120b-1:0",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "us-gov.openai.gpt-oss-20b-1:0",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "us.amazon.nova-2-lite-v1:0",
      contextWindow:  1000000,
      maxOutputTokens:  65535,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.amazon.nova-lite-v1:0",
      contextWindow:  300000,
      maxOutputTokens:  10000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.amazon.nova-micro-v1:0",
      contextWindow:  128000,
      maxOutputTokens:  10000,
      verified:  false
    },
    {
      id:  "us.amazon.nova-premier-v1:0",
      contextWindow:  1000000,
      maxOutputTokens:  10000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.amazon.nova-pro-v1:0",
      contextWindow:  300000,
      maxOutputTokens:  10000,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.anthropic.claude-fable-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.anthropic.claude-fable-5-1",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.anthropic.claude-opus-4-1-20250805-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.anthropic.claude-opus-4-5-20251101-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.anthropic.claude-opus-4-6-v1",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.anthropic.claude-opus-4-7",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.anthropic.claude-opus-4-8",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.anthropic.claude-opus-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.anthropic.claude-opus-5-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.anthropic.claude-sonnet-4-20250514-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      contextWindow:  200000,
      maxOutputTokens:  64000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.anthropic.claude-sonnet-4-6",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.anthropic.claude-sonnet-5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "us.deepseek.r1-v1:0",
      contextWindow:  128000,
      maxOutputTokens:  32768,
      verified:  false
    },
    {
      id:  "us.meta.llama3-1-70b-instruct-v1:0",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "us.meta.llama3-1-8b-instruct-v1:0",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "us.meta.llama3-3-70b-instruct-v1:0",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "us.meta.llama4-maverick-17b-instruct-v1:0",
      contextWindow:  1000000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "us.meta.llama4-scout-17b-instruct-v1:0",
      contextWindow:  10000000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "us.mistral.pixtral-large-2502-v1:0",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "us.moonshotai.kimi-k3",
      contextWindow:  1048576,
      maxOutputTokens:  128000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "us.openai.gpt-5.6-luna",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "us.openai.gpt-5.6-sol",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "us.openai.gpt-5.6-terra",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "us.openai.gpt-6-astra",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "us.openai.gpt-6-luna",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "us.openai.gpt-6-sol",
      contextWindow:  1050000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "us.writer.palmyra-x4-v1:0",
      contextWindow:  122880,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "us.writer.palmyra-x5-v1:0",
      contextWindow:  1040000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "us.xai.grok-4.6",
      contextWindow:  500000,
      maxOutputTokens:  500000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "us.xai.grok-4.7",
      contextWindow:  500000,
      maxOutputTokens:  500000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "usdcode",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "usdvalidate",
      maxOutputTokens:  4096,
      verified:  false
    },
    {
      id:  "v0-1.0-md",
      contextWindow:  128000,
      maxOutputTokens:  32000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "v0-1.5-lg",
      contextWindow:  512000,
      maxOutputTokens:  32000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "v0-1.5-md",
      contextWindow:  128000,
      maxOutputTokens:  32000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "Veiled-Calla-12B",
      contextWindow:  32768,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "venice-uncensored",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "venice-uncensored-1-2",
      contextWindow:  128000,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "venice-uncensored-role-play",
      contextWindow:  128000,
      maxOutputTokens:  4096,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "veo-2",
      contextWindow:  480,
      verified:  false
    },
    {
      id:  "veo-3",
      contextWindow:  480,
      verified:  false
    },
    {
      id:  "veo-3-fast",
      contextWindow:  480,
      verified:  false
    },
    {
      id:  "veo-3.0-fast-generate-001",
      verified:  false
    },
    {
      id:  "veo-3.0-generate-001",
      verified:  false
    },
    {
      id:  "veo-3.1",
      contextWindow:  480,
      verified:  false
    },
    {
      id:  "veo-3.1-fast",
      contextWindow:  480,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "veo-3.1-fast-generate-001",
      verified:  false
    },
    {
      id:  "veo-3.1-fast-generate-preview",
      contextWindow:  480,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "veo-3.1-generate-001",
      verified:  false
    },
    {
      id:  "veo-3.1-generate-preview",
      contextWindow:  480,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "veo-3.1-lite-generate-001",
      verified:  false
    },
    {
      id:  "veo-3.1-lite-generate-preview",
      contextWindow:  480,
      maxOutputTokens:  8192,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "veo3.1",
      contextWindow:  400000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "veo3.1-fast",
      contextWindow:  400000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "veo3.1-lite",
      contextWindow:  400000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "vision-large",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "vision-medium",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "vision-small",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "viv-fast",
      contextWindow:  1000000,
      maxOutputTokens:  256000,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "voxtral-mini-3b",
      contextWindow:  32000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "voxtral-mini-latest",
      verified:  false
    },
    {
      id:  "voxtral-mini-tts-latest",
      verified:  false
    },
    {
      id:  "voxtral-small-24b-2507",
      contextWindow:  32768,
      maxOutputTokens:  26214,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "Voxtral-Small-24B-2507",
      contextWindow:  32000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "voxtral-small-2507",
      contextWindow:  32000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "voxtral-small-latest",
      contextWindow:  32000,
      maxOutputTokens:  32000,
      verified:  false
    },
    {
      id:  "voyage-3-large",
      contextWindow:  8192,
      maxOutputTokens:  1536,
      verified:  false
    },
    {
      id:  "voyage-3.5",
      contextWindow:  8192,
      maxOutputTokens:  1536,
      verified:  false
    },
    {
      id:  "voyage-3.5-lite",
      contextWindow:  8192,
      maxOutputTokens:  1536,
      verified:  false
    },
    {
      id:  "voyage-4",
      contextWindow:  32000,
      verified:  false
    },
    {
      id:  "voyage-4-large",
      contextWindow:  32000,
      verified:  false
    },
    {
      id:  "voyage-4-lite",
      contextWindow:  32000,
      verified:  false
    },
    {
      id:  "voyage-code-2",
      contextWindow:  8192,
      maxOutputTokens:  1536,
      verified:  false
    },
    {
      id:  "voyage-code-3",
      contextWindow:  8192,
      maxOutputTokens:  1536,
      verified:  false
    },
    {
      id:  "voyage-finance-2",
      contextWindow:  8192,
      maxOutputTokens:  1536,
      verified:  false
    },
    {
      id:  "voyage-law-2",
      contextWindow:  8192,
      maxOutputTokens:  1536,
      verified:  false
    },
    {
      id:  "wan-v2-6",
      contextWindow:  400000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "wan-v2.5-t2v-preview",
      verified:  false
    },
    {
      id:  "wan-v2.6-i2v",
      verified:  false
    },
    {
      id:  "wan-v2.6-i2v-flash",
      verified:  false
    },
    {
      id:  "wan-v2.6-r2v",
      verified:  false
    },
    {
      id:  "wan-v2.6-r2v-flash",
      verified:  false
    },
    {
      id:  "wan-v2.6-t2v",
      verified:  false
    },
    {
      id:  "wan-v2.7-r2v",
      verified:  false
    },
    {
      id:  "wan-v2.7-t2v",
      verified:  false
    },
    {
      id:  "wan-v3.0-video",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "wan-v3.0-video-prime",
      imageInput:  true,
      verified:  false
    },
    {
      id:  "wan2-2-t2v-a14b",
      contextWindow:  100,
      maxOutputTokens:  1,
      verified:  false
    },
    {
      id:  "wan2.7-image",
      contextWindow:  8192,
      verified:  false
    },
    {
      id:  "wan2.7-image-pro",
      contextWindow:  8192,
      verified:  false
    },
    {
      id:  "Wayfarer-Large-70B-Llama-3.3",
      contextWindow:  32768,
      maxOutputTokens:  16384,
      verified:  false
    },
    {
      id:  "weaver",
      contextWindow:  8000,
      maxOutputTokens:  6000,
      verified:  false
    },
    {
      id:  "whisper-1",
      verified:  false
    },
    {
      id:  "whisper-large-v3",
      verified:  false
    },
    {
      id:  "whisper-large-v3-turbo",
      verified:  false
    },
    {
      id:  "wizardlm-2-8x22b",
      contextWindow:  65536,
      maxOutputTokens:  8192,
      pdfInput:  true,
      verified:  false
    },
    {
      id:  "writer.palmyra-x4-v1:0",
      contextWindow:  122880,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "writer.palmyra-x5-v1:0",
      contextWindow:  1040000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "x-preview-f-free",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "xai.grok-4.20-non-reasoning",
      contextWindow:  1000000,
      maxOutputTokens:  30000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "xai.grok-4.20-reasoning",
      contextWindow:  1000000,
      maxOutputTokens:  30000,
      imageInput:  true,
      verified:  false
    },
    {
      id:  "xai.grok-4.3",
      contextWindow:  1000000,
      maxOutputTokens:  30000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "xai.grok-4.6",
      contextWindow:  500000,
      maxOutputTokens:  500000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "xiaomi-mimo-v2-5",
      contextWindow:  1000000,
      maxOutputTokens:  65536,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "xiaomi-mimo-v2-6-flash",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "xiaomi-mimo-v2.5",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "xiaomi-mimo-v2.5-free",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "xiaomi-mimo-v2.5-pro",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "xiaomi-mimo-v2.5-pro-free",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "xpersona-frieren-coder",
      contextWindow:  1000000,
      maxOutputTokens:  384000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "xpersona-gpt-5.5",
      contextWindow:  1000000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "z-ai-glm-5-3",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "z-ai-glm-5-3-flash",
      contextWindow:  1048576,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "z-ai-glm-5-turbo",
      contextWindow:  200000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "z-ai-glm-5v-turbo",
      contextWindow:  200000,
      maxOutputTokens:  32768,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "zai-glm-5-1",
      contextWindow:  198000,
      maxOutputTokens:  8192,
      verified:  false
    },
    {
      id:  "zai-glm-5-2",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "zai-glm-5-3",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "zai-glm-5.1",
      contextWindow:  200000,
      maxOutputTokens:  128000,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "zai-org-glm-4.6",
      contextWindow:  198000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "zai-org-glm-4.7",
      contextWindow:  198000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "zai-org-glm-4.7-flash",
      contextWindow:  128000,
      maxOutputTokens:  16384,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "zai-org-glm-5",
      contextWindow:  198000,
      maxOutputTokens:  32000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "zai-org-glm-5-1",
      contextWindow:  200000,
      maxOutputTokens:  80000,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      verified:  false
    },
    {
      id:  "zai-org-glm-5-2",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "high",
        "max"
      ],
      verified:  false
    },
    {
      id:  "zai.glm-4.7",
      contextWindow:  202752,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "zai.glm-4.7-flash",
      contextWindow:  203000,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "zai.glm-4.7-flash@us",
      contextWindow:  203000,
      maxOutputTokens:  131072,
      verified:  false
    },
    {
      id:  "zai.glm-5",
      contextWindow:  202752,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "medium"
      ],
      verified:  false
    },
    {
      id:  "zdev",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "low",
        "high",
        "max"
      ],
      imageInput:  true,
      verified:  false
    },
    {
      id:  "zdr",
      contextWindow:  1000000,
      maxOutputTokens:  131072,
      thinkingLevels:  [
        "off",
        "low",
        "medium",
        "high"
      ],
      imageInput:  true,
      pdfInput:  true,
      verified:  false
    }
  
];
