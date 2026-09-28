/**
 * 缓存健康诊断测试（F16/T-P2-512）——命中率统计 + 前缀漂移归因 mock 用例
 * + thinking 剥离用例（deepseek 风格真实端点样本 fixture：reasoning_content
 * 产出后续话不回传——OpenAI 兼容 usage 形状 prompt_cache_hit_tokens 映射面）。
 */

import { describe, expect, it } from "vitest";

import type { ChatMessage } from "./provider.js";
import {
  CacheHealthTracker,
  commonPrefixLength,
  detectPrefixDrift,
  prefixFingerprint,
} from "./cache-health.js";

function msgs(...contents: string[]): ChatMessage[] {
    return contents.map((content, i) =>
        i % 2 === 0 ? ({ role: "user", content } as ChatMessage) : ({ role: "assistant", content } as ChatMessage),
    );
}

describe("缓存健康诊断（F16）", () => {
  it("命中率统计：hit = cacheRead>0；无分列样本不进分母（不编造）", () => {
    const t = new CacheHealthTracker();
    t.record({ index: 1, modelId: "m", messages: msgs("a"), usage: { inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 100 } });
    t.record({ index: 2, modelId: "m", messages: msgs("a", "b"), usage: { inputTokens: 200, cacheReadTokens: 150, cacheWriteTokens: 50 } });
    t.record({ index: 3, modelId: "m", messages: msgs("a", "b", "c") }); // 端点未报告——不进分母
    const r = t.report();
    expect(r.hitRate).toEqual({ hits: 1, requests: 2, rate: 0.5 });
    expect(r.samples).toHaveLength(3);
  });

  it("前缀漂移归因：前缀回退（压缩重建）检出 prefix_drift；纯追加健康", () => {
    const t = new CacheHealthTracker();
    const healthy = msgs("a", "b");
    t.record({ index: 1, modelId: "m", messages: healthy, usage: { inputTokens: 100, cacheReadTokens: 80, cacheWriteTokens: 20 } });
    // 纯追加：公共长度 = 上次长度 → 无漂移
    t.record({ index: 2, modelId: "m", messages: msgs("a", "b", "c"), usage: { inputTokens: 200, cacheReadTokens: 180, cacheWriteTokens: 20 } });
    expect(t.report().regressions.filter((r) => r.kind === "prefix_drift")).toHaveLength(0);
    // 回退：压缩重建后前缀从第 0 条就不同 → drift
    t.record({ index: 3, modelId: "m", messages: msgs("[会话压缩摘要] 新窗口", "c"), usage: { inputTokens: 50, cacheReadTokens: 0 } });
    const drifts = t.report().regressions.filter((r) => r.kind === "prefix_drift");
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toMatchObject({ kind: "prefix_drift", atIndex: 3 });
    expect(drifts[0]!.evidence).toContain("公共长度 0");
  });

  it("thinking 剥离（deepseek 真实面 fixture）：流产 reasoning 后续话请求不携带 → 检出", () => {
    const t = new CacheHealthTracker();
    // deepseek 风格：流内产出 reasoning_content（openai-compat → reasoning-delta），
    // 但续话请求的 assistant 回传只有 content——reasoning 不回传前缀
    t.record({
      index: 1,
      modelId: "deepseek-r1",
      messages: msgs("q") as ChatMessage[],
      usage: { inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 100 },
      streamHadReasoning: true,
    });
    t.record({
      index: 2,
      modelId: "deepseek-r1",
      messages: msgs("q", "答案") as ChatMessage[],
      usage: { inputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 200 }, // 前缀与上轮响应不齐 → 写入重复
      streamHadReasoning: true,
    });
    const stripped = t.report().regressions.filter((r) => r.kind === "thinking_stripped");
    expect(stripped).toHaveLength(1);
    expect(stripped[0]).toMatchObject({ kind: "thinking_stripped", atIndex: 2 });
  });

  it("指纹与公共长度原语：同消息序列逐字节同指纹；指纹有界不落全文", () => {
    const a = prefixFingerprint(msgs("hello", "world"));
    const b = prefixFingerprint(msgs("hello", "world"));
    expect(a).toEqual(b);
    expect(commonPrefixLength(a, b)).toBe(2);
    // 指纹不含原文（有界）——内容长与 hash 形状
    expect(a[0]).toMatch(/^user:\d+:[0-9a-f]{8}$/);
    expect(JSON.stringify(a)).not.toContain("hello");
    expect(detectPrefixDrift(undefined, a)).toEqual({ drift: false, commonLen: 2 });
  });
});
