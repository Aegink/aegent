/**
 * 容错层验收（J15/J18/J19，T-P1-23）：
 * ① 连续失败 → 熔断 open（后续请求零发出，计数断言）+ 双计数证明
 *   （请求内 N 次重试在熔断器眼里是 1 次请求——分层边界）；
 * ② 半开恢复（冷却后探测成功 → closed；探测再败 → open 重计时）；
 * ③ 开路 → 故障转移队列按序切换（跳过开路者、按序换下一家、成功粘住、
 *   全部耗尽类型化错误）；
 * ④ 限流桶用量/余量可查询、接近配额告警 edge 触发可断言。
 */

import { describe, expect, it } from "vitest";

import {
  AllBackendsFailedError,
  CircuitBreaker,
  classifyProviderFailure,
  createFailoverProvider,
  DEFAULT_RATE_LIMIT_WARN_PCT,
  RateLimitTracker,
  type FailoverBackend,
} from "./fault-tolerance.js";
import { ProviderHttpError, type ModelProvider } from "./provider.js";

/** 可计数假后端：每次 streamChat 记一次调用，按剧本决定失败/成功。 */
function scriptedBackend(
  name: string,
  script: Array<"fail-retryable" | "fail-terminal" | "succeed">,
): FailoverBackend & { calls: () => number } {
  let calls = 0;
  const provider: ModelProvider = {
    async *streamChat() {
      const step = script[Math.min(calls, script.length - 1)]!;
      calls += 1;
      if (step === "fail-retryable") {
        throw new ProviderHttpError(503, "backend down");
      }
      if (step === "fail-terminal") {
        throw new ProviderHttpError(400, "bad request");
      }
      yield { type: "text-delta", text: `ok-from-${name}` };
      yield { type: "done" };
    },
  };
  return { name, provider, calls: () => calls };
}

/** 收集一个请求的全部 chunk（错误原样上抛）。 */
async function collect(provider: ModelProvider): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of provider.streamChat({
    identity: { provider: "test", modelId: "m" },
    messages: [{ role: "user", content: "hi" }],
  })) {
    if (chunk.type === "text-delta") chunks.push(chunk.text);
  }
  return chunks;
}

describe("容错层（J15/J18/J19 / T-P1-23）", () => {
  it("验收①：连续失败 → 熔断 open（后续请求零发出）；分层边界：请求内重试在熔断器眼里是 1 次请求", async () => {
    const clock = { now: 1_000_000 };
    const a = scriptedBackend("a", ["fail-retryable"]);
    const handle = createFailoverProvider([a], {
      failureThreshold: 3,
      resetTimeoutMs: 10_000,
      retry: { maxAttempts: 1 }, // 禁请求内重试：每请求恰好 1 次调用
      now: () => clock.now,
    });

    // 三次请求全部失败（每家耗尽 → AllBackendsFailedError）
    for (let i = 0; i < 3; i++) {
      await expect(collect(handle.provider)).rejects.toMatchObject({
        code: "ALL_BACKENDS_FAILED",
      });
    }
    const breaker = handle.breakers.get("a")!;
    expect(breaker.state).toBe("open");
    expect(breaker.failureCount).toBe(3);
    expect(a.calls()).toBe(3);

    // 第 4 次请求：熔断 open → 后端零发出（计数不再增长）
    await expect(collect(handle.provider)).rejects.toBeInstanceOf(AllBackendsFailedError);
    expect(a.calls()).toBe(3);
    expect(handle.breakers.get("a")!.state).toBe("open");
  });

  it("分层边界（避免双计数）：请求内 3 次尝试只向熔断计 1 次失败", async () => {
    const clock = { now: 1_000_000 };
    // 每次调用都抛 429（可重试类）——maxAttempts=3 时单请求内重试 3 次
    const a = scriptedBackend("a", ["fail-retryable"]);
    const handle = createFailoverProvider([a], {
      failureThreshold: 2,
      retry: { maxAttempts: 3, sleep: async () => {} },
      now: () => clock.now,
    });
    await expect(collect(handle.provider)).rejects.toBeInstanceOf(AllBackendsFailedError);
    expect(a.calls()).toBe(3); // 请求内 3 次尝试
    const breaker = handle.breakers.get("a")!;
    expect(breaker.failureCount).toBe(1); // 熔断器只记 1 次请求失败（不双计数）
    // 第二个请求后再开路（2 次请求失败 = 阈值 2）
    await expect(collect(handle.provider)).rejects.toBeInstanceOf(AllBackendsFailedError);
    expect(breaker.state).toBe("open");
    expect(a.calls()).toBe(6);
  });

  it("验收②：半开恢复——冷却后探测成功 → closed；探测再败 → open 重计时", async () => {
    const clock = { now: 1_000_000 };
    const a = scriptedBackend("a", ["fail-retryable", "succeed", "fail-retryable"]);
    const handle = createFailoverProvider([a], {
      failureThreshold: 1,
      resetTimeoutMs: 5_000,
      retry: { maxAttempts: 1 },
      now: () => clock.now,
    });
    await expect(collect(handle.provider)).rejects.toBeInstanceOf(AllBackendsFailedError);
    const breaker = handle.breakers.get("a")!;
    expect(breaker.state).toBe("open");

    // 冷却未过：仍不放行
    clock.now += 1_000;
    await expect(collect(handle.provider)).rejects.toBeInstanceOf(AllBackendsFailedError);
    expect(breaker.state).toBe("open");

    // 冷却已过：半开放行探测 → 探测成功 → closed
    clock.now += 5_000;
    expect(await collect(handle.provider)).toEqual(["ok-from-a"]);
    expect(breaker.state).toBe("closed");
    expect(breaker.failureCount).toBe(0);

    // 再失败 → 重新开路（openedAt 重置）
    await expect(collect(handle.provider)).rejects.toBeInstanceOf(AllBackendsFailedError);
    expect(breaker.state).toBe("open");
  });

  it("验收③：开路 → 故障转移队列按序切换（跳过开路者、环绕尝试、成功粘住）", async () => {
    const clock = { now: 1_000_000 };
    const a = scriptedBackend("a", ["fail-retryable"]);
    const b = scriptedBackend("b", ["fail-retryable", "succeed"]);
    const c = scriptedBackend("c", ["succeed"]);
    const handle = createFailoverProvider([a, b, c], {
      failureThreshold: 1,
      resetTimeoutMs: 10_000,
      retry: { maxAttempts: 1 },
      now: () => clock.now,
    });

    // 请求 1：a 失败 → b 失败 → c 成功（按队列序），粘住 c
    expect(await collect(handle.provider)).toEqual(["ok-from-c"]);
    expect(handle.currentBackend()).toBe("c");
    expect(a.calls()).toBe(1);
    expect(b.calls()).toBe(1);

    // a、b 都已开路：请求 2 直接从 c 开始（a 零发出）
    expect(await collect(handle.provider)).toEqual(["ok-from-c"]);
    expect(a.calls()).toBe(1); // 未增长——熔断跳过
    expect(b.calls()).toBe(1);

    // 全部耗尽：c 也失败 → 类型化错误带失败清单
    const cBreaker = handle.breakers.get("c")!;
    cBreaker.recordFailure("retryable"); // 阈值 1 → c 开路
    await expect(collect(handle.provider)).rejects.toMatchObject({
      code: "ALL_BACKENDS_FAILED",
    });
  });

  it("J19 判据：terminal 失败（400）不向熔断计数，但请求仍按队列换家", async () => {
    expect(classifyProviderFailure(new ProviderHttpError(503, "x"))).toBe("retryable");
    expect(classifyProviderFailure(new ProviderHttpError(400, "x"))).toBe("terminal");
    expect(classifyProviderFailure(new Error("network down"))).toBe("retryable");

    const clock = { now: 1_000_000 };
    const a = scriptedBackend("a", ["fail-terminal"]);
    const b = scriptedBackend("b", ["succeed"]);
    const handle = createFailoverProvider([a, b], {
      failureThreshold: 1,
      retry: { maxAttempts: 1 },
      now: () => clock.now,
    });
    // terminal 失败换家成功，但 a 的熔断器不计数（端点健康）
    expect(await collect(handle.provider)).toEqual(["ok-from-b"]);
    const breaker = handle.breakers.get("a")!;
    expect(breaker.state).toBe("closed");
    expect(breaker.failureCount).toBe(0);
    expect(a.calls()).toBe(1);
  });

  it("验收④：限流桶用量/余量可查询，接近配额告警 edge 触发（自阈值下上穿告警一次）", () => {
    const clock = { now: 1_000_000 };
    const warns: Array<{ provider: string; usagePct: number; remaining: number }> = [];
    const tracker = new RateLimitTracker({
      now: () => clock.now,
      onWarn: (info: { provider: string; usagePct: number; remaining: number }) => warns.push(info),
    });

    // 第一笔：70% < 80% 缺省阈值，不告警
    const s1 = tracker.record("p", { limit: 100, remaining: 30, resetSeconds: 60 });
    expect(s1).toMatchObject({ used: 70, usagePct: 70, remaining: 30 });
    expect(warns).toHaveLength(0);
    expect(s1.resetInSeconds).toBeCloseTo(60, 6);

    // 第二笔：85% 上穿阈值 → 告警一次
    const s2 = tracker.record("p", { limit: 100, remaining: 15, resetSeconds: 60 });
    expect(s2.usagePct).toBeCloseTo(85, 6);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ provider: "p", usagePct: 85, remaining: 15 });

    // 同档不重复告警（edge 触发）
    tracker.record("p", { limit: 100, remaining: 10, resetSeconds: 60 });
    expect(warns).toHaveLength(1);

    // 余量倒计时随时钟衰减（hermes remaining_seconds_now 同款）
    clock.now += 30_000;
    const later = tracker.snapshot("p")!;
    expect(later.resetInSeconds).toBeCloseTo(30, 6);

    // 缺省阈值常量与未记录厂商查询
    expect(DEFAULT_RATE_LIMIT_WARN_PCT).toBe(80);
    expect(tracker.snapshot("no-such")).toBeUndefined();
  });
});

describe("容错层簿记（真实厂商复测发现的缺陷回归）", () => {
  it("消费方提前断开（done 即 break）：接管后端补记账——粘住生效、不再重复探测死端点", async () => {
    const clock = { now: 1_000_000 };
    const a = scriptedBackend("a", ["fail-retryable"]);
    const b = scriptedBackend("b", ["succeed", "succeed"]);
    const handle = createFailoverProvider([a, b], {
      failureThreshold: 2,
      retry: { maxAttempts: 1 },
      now: () => clock.now,
    });
    const req = { identity: { provider: "test", modelId: "m" } as never, messages: [{ role: "user" as const, content: "hi" }] };

    // 消费方在 done 到达即 break（模拟 UI 提前收尾/测试剧本）——修复前
    // 生成器在此被中止，recordSuccess 与 currentIndex 簿记全部丢失
    for await (const chunk of handle.provider.streamChat(req)) {
      if (chunk.type === "done") break;
    }
    expect(handle.currentBackend()).toBe("b"); // 粘住 backup（修复前恒为 "a"）
    expect(handle.breakers.get("b")!.state).toBe("closed");
    expect(a.calls()).toBe(1);

    // 后续请求直接从 b 开始：死掉的 a 零发出（不再被重复探测）
    for await (const chunk of handle.provider.streamChat(req)) {
      if (chunk.type === "done") break;
    }
    expect(a.calls()).toBe(1);
    expect(handle.currentBackend()).toBe("b");
  });
});
