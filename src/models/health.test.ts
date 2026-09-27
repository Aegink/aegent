/**
 * J16/T-P1-107 验收：健康检查 + 保留期清理——
 * ①200/403 两响应均 reachable（"可达 ≠ 配置正确"——403 不误判不可用）；
 * ②连接被拒/超时 → unreachable（网络级错误判据）；
 * ③TTFB 超阈值 → degraded；
 * ④结果落 health.jsonl 且密钥掩码；
 * ⑤prune 删旧行留新行（retainDays 边界）+ 原子性（tmp→rename）；
 * ⑥health.ts 零熔断 import（分域不变量机内化——T-P1-87 证伪同款）；
 * ⑦仅超时类失败重试（连接被拒零重试）。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseProviderConfig } from "./config.js";
import {
  pruneHealthLogs,
  providerBaseUrl,
  probeProvider,
  runHealthCheck,
} from "./health.js";

const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-health-"));
  tmpRoots.push(dir);
  return dir;
}

function makeConfig(baseUrl: string) {
  return parseProviderConfig({
    name: "mock-provider",
    settingsConfig: JSON.stringify({ baseUrl, apiKey: "sk-secret-abc" }),
  });
}

/** 固定响应的 fetch 桩（记录 TTFB 可用 now 注入控制）。 */
function fetchOk(status: number): typeof fetch {
  return (async () => new Response("ignored", { status })) as unknown as typeof fetch;
}

describe("probeProvider（J16 可达性探测）", () => {
  it("验收①：200 与 403 均 reachable（可达 ≠ 配置正确——403 不误判）", async () => {
    for (const status of [200, 403, 500]) {
      const result = await probeProvider(
        { provider: "p", baseUrl: "https://example.invalid" },
        { fetchImpl: fetchOk(status), now: () => 1_000 },
      );
      expect(result.success).toBe(true);
      expect(result.status).toBe("operational");
      expect(result.httpStatus).toBe(status);
    }
  });

  it("验收②：连接被拒 → unreachable（网络级错误，零重试）", async () => {
    // 关闭端口：起 mock 再 stop，端口大概率立即拒绝——这里用确定性的 fetch 桩
    const refused = (async () => {
      throw new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:1");
    }) as unknown as typeof fetch;
    const result = await probeProvider(
      { provider: "p", baseUrl: "https://example.invalid" },
      { fetchImpl: refused, maxRetries: 3 },
    );
    expect(result.success).toBe(false);
    expect(result.status).toBe("unreachable");
    expect(result.message).toContain("ECONNREFUSED");
  });

  it("验收③：TTFB 超阈值 → degraded（降级档，仍可达）", async () => {
    let calls = 0;
    const slowFetch = (async () => {
      calls += 1;
      return new Response("ignored", { status: 200 });
    }) as unknown as typeof fetch;
    // now 注入：第二次调用（TTFB 计算时）返回已推进的时钟
    let ticks = 0;
    const result = await probeProvider(
      { provider: "p", baseUrl: "https://example.invalid" },
      {
        fetchImpl: (async () => {
          ticks += 1;
          return new Response("ignored", { status: 200 });
        }) as unknown as typeof fetch,
        now: () => {
          // start 调一次（0），ttfb 调一次（7000）——用调用次数模拟时钟推进
          const v = ticks * 7_000;
          return v;
        },
        degradedThresholdMs: 6_000,
      },
    );
    expect(result.status).toBe("degraded");
    expect(result.success).toBe(true);
    expect(result.responseTimeMs).toBe(7_000);
    void slowFetch;
    void calls;
  });

  it("验收②（超时）+⑦：超时类失败重试 maxRetries 次后 unreachable；连接被拒零重试", async () => {
    // 超时：AbortError（超时类的重试判定——isTimeout true）
    let timeoutCalls = 0;
    const timeoutFetch = (async () => {
      timeoutCalls += 1;
      const e = new Error("The operation was aborted");
      e.name = "AbortError";
      throw e;
    }) as unknown as typeof fetch;
    const r1 = await probeProvider(
      { provider: "p", baseUrl: "https://example.invalid" },
      { fetchImpl: timeoutFetch, maxRetries: 2 },
    );
    expect(r1.status).toBe("unreachable");
    expect(timeoutCalls).toBe(3); // 1 首试 + 2 重试（超时类值得重试）
    // 连接被拒：非超时类 → 零重试
    let refusedCalls = 0;
    const refusedFetch = (async () => {
      refusedCalls += 1;
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    const r2 = await probeProvider(
      { provider: "p", baseUrl: "https://example.invalid" },
      { fetchImpl: refusedFetch, maxRetries: 2 },
    );
    expect(r2.status).toBe("unreachable");
    expect(refusedCalls).toBe(1); // 立即返回
  });

  it("providerBaseUrl：settingsConfig 携带 baseUrl 的轻解析；缺失类型化报错", () => {
    expect(providerBaseUrl(makeConfig("https://api.example.com/v1///"))).toBe(
      "https://api.example.com/v1",
    );
    expect(() =>
      providerBaseUrl(parseProviderConfig({ name: "p", settingsConfig: '{"apiKey":"k"}' })),
    ).toThrow(/baseUrl/);
  });
});

describe("runHealthCheck + pruneHealthLogs（检查日志带保留期）", () => {
  it("验收④：结果落 health.jsonl 且密钥掩码（redactSecrets）", async () => {
    const logDir = makeTmpDir();
    const config = makeConfig("https://secret-key-abc123.example.com/v1");
    const result = await runHealthCheck(config, {
      fetchImpl: fetchOk(200),
      now: () => 1_700_000_000_000,
      logDir,
    });
    expect(result.success).toBe(true);
    const filePath = path.join(logDir, "health.jsonl");
    expect(existsSync(filePath)).toBe(true);
    const raw = readFileSync(filePath, "utf8");
    const entry = JSON.parse(raw.trim()) as {
      provider: string;
      status: string;
      testedAt: number;
    };
    expect(entry.provider).toBe("mock-provider");
    expect(entry.status).toBe("operational");
    expect(entry.testedAt).toBe(1_700_000_000_000);
    // baseUrl 内嵌密钥被掩码（redactSecrets 生效）
    expect(raw).not.toContain("secret-key-abc123");
  });

  it("验收⑤：prune 按保留期删旧行留新行（tmp→rename 原子重写）", () => {
    const logDir = makeTmpDir();
    const filePath = path.join(logDir, "health.jsonl");
    const now = 1_700_000_000_000;
    writeFileSync(
      filePath,
      [
        JSON.stringify({ testedAt: now - 40 * 86_400_000, provider: "old-1" }),
        JSON.stringify({ testedAt: now - 10 * 86_400_000, provider: "keep" }),
        JSON.stringify({ testedAt: now - 50 * 86_400_000, provider: "old-2" }),
      ].join("\n") + "\n",
      "utf8",
    );
    const report = pruneHealthLogs(30, { logDir, now: () => now });
    expect(report).toEqual({ kept: 1, removed: 2 });
    const lines = readFileSync(filePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).provider).toBe("keep");
    // 无可删行 → 零重写（零 IO）
    const report2 = pruneHealthLogs(30, { logDir, now: () => now });
    expect(report2).toEqual({ kept: 1, removed: 0 });
  });

  it("prune：日志文件不存在 → {kept:0, removed:0}（不抛）", () => {
    const logDir = makeTmpDir();
    expect(pruneHealthLogs(30, { logDir })).toEqual({ kept: 0, removed: 0 });
  });
});

describe("分域不变量（J16 核心：探测绝不触碰熔断器）", () => {
  it("验收⑥：health.ts 源码零 fault-tolerance import（T-P1-87 证伪同款机内化）", async () => {
    const { readFileSync: read } = await import("node:fs");
    const raw = read(new URL("./health.ts", import.meta.url), "utf8");
    // 剥离注释后扫描（头注释的自述文本不算 import 事实）
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(source.includes("fault-tolerance")).toBe(false);
    expect(source.includes("CircuitBreaker")).toBe(false);
    // 探测结果对象也不含熔断计数位（结构分域）
    expect(source.includes("recordFailure")).toBe(false);
    expect(source.includes("recordSuccess")).toBe(false);
  });
});
