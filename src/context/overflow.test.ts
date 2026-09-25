/**
 * T-7-01 验收（A4/F4）：构造假 provider 返回超限错误 → 先命中 overflow 识别
 * 分支并触发压缩入口（调用次序断言），而非直接把错误抛给用户。
 * 另覆盖：本地估算保守方向（0.9 系数放大）、本地溢出判定、错误识别判据、
 * compaction 消费接口的两个映射函数。
 */

import { describe, expect, it } from "vitest";
import { ProviderHttpError, type ModelProvider } from "../models/provider.js";
import type { StreamChunk } from "../kernel/events.js";
import {
  compactionRequestFromProviderError,
  compactionRequestFromVerdict,
  type CompactionRequest,
} from "./compaction.js";
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  detectLocalOverflow,
  estimateMessagesTokens,
  estimateTextTokens,
  isContextWindowExceeded,
} from "./overflow.js";

// ---------------------------------------------------------------------------
// 本地 token 估算：保守系数 0.9 的方向（宁可高估，注释见 overflow.ts 头）
// ---------------------------------------------------------------------------

describe("estimateTextTokens / estimateMessagesTokens", () => {
  it("保守方向：同文本估算 ≥ 基础密度 4 chars/token 的结果（0.9 放大约 11%）", () => {
    const text = "a".repeat(1000);
    const estimate = estimateTextTokens(text);
    // 有效密度 3.6 = 4 × 0.9：ceil(1000/3.6) = 278
    expect(estimate).toBe(278);
    // 保守方向断言：绝不低于无系数的基础估算（误差方向纪律的机验）
    expect(estimate).toBeGreaterThanOrEqual(Math.ceil(1000 / 4));
  });

  it("空文本估 0；向上取整", () => {
    expect(estimateTextTokens("")).toBe(0);
    expect(estimateTextTokens("ab")).toBe(1); // ceil(2/3.6)
  });

  it("消息序列 = 逐条内容 + 每条固定开销；assistant.toolCalls 计入", () => {
    const estimate = estimateMessagesTokens([
      { role: "user", content: "x".repeat(36) }, // 10 tokens + 8 overhead
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", name: "bash", arguments: "{}" }],
      },
    ]);
    // 36/3.6=10、""=0、name "bash"=ceil(4/3.6)=2、args "{}"=ceil(2/3.6)=1、2×8 overhead
    expect(estimate).toBe(10 + 0 + 2 + 1 + 16);
  });
});

// ---------------------------------------------------------------------------
// 本地溢出判定（A4：先触发 overflow 判定而非直接压）
// ---------------------------------------------------------------------------

describe("detectLocalOverflow", () => {
  it("估算在窗口内 → overflow=false，margin 为正余量", () => {
    const v = detectLocalOverflow({
      messages: [{ role: "user", content: "x".repeat(36) }], // 10+8=18
      contextWindow: 100,
    });
    expect(v.overflow).toBe(false);
    expect(v.margin).toBe(82);
    expect(v.estimatedTokens).toBe(18);
  });

  it("估算超窗口 → overflow=true，margin 为负超出量", () => {
    const v = detectLocalOverflow({
      messages: [{ role: "user", content: "x".repeat(3600) }], // 1000+8=1008
      contextWindow: 1000,
    });
    expect(v.overflow).toBe(true);
    expect(v.margin).toBe(-8);
  });
});

// ---------------------------------------------------------------------------
// provider 超限错误识别（发请求后的路由判据）
// ---------------------------------------------------------------------------

describe("isContextWindowExceeded", () => {
  it("结构化 code 命中（规范码；大小写变体同命中）", () => {
    const err = Object.assign(new Error("limit"), { code: CONTEXT_WINDOW_EXCEEDED_CODE });
    expect(isContextWindowExceeded(err)).toBe(true);
    const lower = Object.assign(new Error("limit"), { code: "context_window_exceeded" });
    expect(isContextWindowExceeded(lower)).toBe(true);
  });

  it("ProviderHttpError 的 body 命中启发式短语", () => {
    const err = new ProviderHttpError(400, "Bad request", {
      bodyPreview: `{"error": {"message": "This model's maximum context length is 8192 tokens"}}`,
    });
    expect(isContextWindowExceeded(err)).toBe(true);
  });

  it("无关错误不命中：普通 Error / 无关 body / 非 Error 值", () => {
    expect(isContextWindowExceeded(new TypeError("x is not a function"))).toBe(false);
    expect(
      isContextWindowExceeded(
        new ProviderHttpError(401, "unauthorized", { bodyPreview: "invalid api key" }),
      ),
    ).toBe(false);
    expect(isContextWindowExceeded(null)).toBe(false);
    expect(isContextWindowExceeded(undefined)).toBe(false);
    expect(isContextWindowExceeded("context window exceeded")).toBe(false);
  });

  it("错误的 message 含关键词但无 code/body 判据 → 不命中（自由文本不当判据，Q10）", () => {
    expect(isContextWindowExceeded(new Error("maximum context length exceeded"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// compaction 消费接口：overflow 的输出是 compaction 的输入
// ---------------------------------------------------------------------------

describe("compaction 消费接口", () => {
  it("溢出判定 → local-overflow 请求；未溢出 → null", () => {
    const overflow = detectLocalOverflow({
      messages: [{ role: "user", content: "y".repeat(3600) }],
      contextWindow: 1000,
    });
    const req = compactionRequestFromVerdict(overflow);
    expect(req).toEqual({
      reason: "local-overflow",
      estimatedTokens: overflow.estimatedTokens,
      contextWindow: 1000,
    });
    const within = detectLocalOverflow({
      messages: [{ role: "user", content: "y".repeat(36) }],
      contextWindow: 1000,
    });
    expect(compactionRequestFromVerdict(within)).toBeNull();
  });

  it("非超限错误 → null（错误按原路径处理，绝不在映射层吞掉）", () => {
    expect(compactionRequestFromProviderError(new Error("boom"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 验收主用例：假 provider 超限错误 → 先识别 → 触发压缩入口 → 错误不达用户
// ---------------------------------------------------------------------------

/** 抛超限错误的假 provider（OpenAI 形措辞的 400 响应）。 */
function overflowingProvider(): ModelProvider {
  return {
    async *streamChat(): AsyncIterable<StreamChunk> {
      throw new ProviderHttpError(400, "Bad request", {
        bodyPreview:
          '{"error": {"message": "This model\'s maximum context length is 8192 tokens"}}',
      });
    },
  };
}

/** 收集流到数组（复现 loop 消费流的最小形态）。 */
async function collectStream(p: ModelProvider): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of p.streamChat({
    identity: { provider: "test", modelId: "m" },
    messages: [{ role: "user", content: "hi" }],
  })) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("调用次序：overflow 识别先于压缩入口，错误不抛给用户", () => {
  it("超限错误 → [识别命中, 压缩入口] 依次发生，消费方收到压缩触发而非异常", async () => {
    const log: string[] = [];
    // 压缩入口的占位（T-7-02 提供真实现）：只记录被调与收到的请求
    const requestCompaction = (req: CompactionRequest): void => {
      log.push("compaction-entry");
      expect(req.reason).toBe("provider-overflow");
    };

    let delivered: "compaction" | undefined;
    try {
      await collectStream(overflowingProvider());
      throw new Error("假 provider 应当抛错——走到这里说明夹具坏了");
    } catch (e) {
      // 消费方的路由次序（F4）：先问 overflow 识别，命中才触发压缩入口
      if (isContextWindowExceeded(e)) {
        log.push("overflow-identified");
        const req = compactionRequestFromProviderError(e);
        if (req) requestCompaction(req);
        delivered = "compaction";
      } else {
        throw e; // 非超限错误按原路径上抛
      }
    }
    expect(delivered).toBe("compaction");
    // 调用次序断言：识别分支命中先于压缩入口
    expect(log).toEqual(["overflow-identified", "compaction-entry"]);
  });

  it("对照：无关错误不被识别，按原路径抛给调用方（不被压缩路径吞掉）", async () => {
    const broken: ModelProvider = {
      async *streamChat(): AsyncIterable<StreamChunk> {
        throw new Error("connection reset");
      },
    };
    await expect(collectStream(broken)).rejects.toThrow("connection reset");
  });

  it("本地路径：超长上下文先判溢出（A4），映射为压缩请求", () => {
    const messages = [{ role: "user" as const, content: "z".repeat(7200) }]; // 2000+8
    const verdict = detectLocalOverflow({ messages, contextWindow: 1000 });
    expect(verdict.overflow).toBe(true);
    const req = compactionRequestFromVerdict(verdict);
    expect(req?.reason).toBe("local-overflow");
  });
});
