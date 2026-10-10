/**
 * 成本核算测试（J21/T-P2-516）——价格表驱动计价 + 会话/轮两级聚合 +
 * 无价格配置的模型如实缺席（不虚构成本）。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { Database } from "better-sqlite3";

import { SqliteEventStorage } from "../session/db.js";
import {SessionEventStore, type SessionStore} from "../session/store.js";
import { costOfUsage, costRollup, findPricing, type PricingTable } from "./cost.js";

const dirs: string[] = [];
afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function turnEvents(turn: number, usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number }): NewSessionEvent2[] {
    return [
        { type: "turn/start", turn },
        { type: "request/header", turn, step: 1, config: { provider: "openai", modelId: "gpt-x" }, reason: "initial" },
        { type: "user/message", turn, message: { content: `q${turn}` }, source: "user" },
        { type: "step/start", turn, step: 1 },
        {
            type: "assistant/message",
            turn,
            step: 1,
            message: { content: `a${turn}` },
            stream: [],
            usage,
        },
        { type: "step/end", turn, step: 1 },
        { type: "turn/end", turn, reason: { kind: "completed" } },
    ];
}
type NewSessionEvent2 = Parameters<SessionStore["append"]>[1][number];

const TABLE: PricingTable = [
    {
        provider: "openai",
        modelId: "gpt-x",
        inputPerMTok: 1.0,
        cachedInputPerMTok: 0.1,
        cacheWritePerMTok: 1.25,
        outputPerMTok: 4.0,
    },
];

describe("成本核算（J21）", () => {
  it("costOfUsage：J25 加权四类分价（非缓存输入扣除缓存读；病态数据 max(0) 防御）", () => {
    const cost = costOfUsage(
      { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 800_000, cacheWriteTokens: 100_000 },
      TABLE[0]!,
    );
    // 非缓存输入 200k × $1/M = $0.20；缓存读 800k × $0.1/M = $0.08；
    // 缓存写 100k × $1.25/M = $0.125；输出 500k × $4/M = $2.00
    expect(cost.inputCostUsd).toBeCloseTo(0.2);
    expect(cost.cachedInputCostUsd).toBeCloseTo(0.08);
    expect(cost.cacheWriteCostUsd).toBeCloseTo(0.125);
    expect(cost.outputCostUsd).toBeCloseTo(2.0);
    expect(cost.costUsd).toBeCloseTo(2.405);
    // 无缓存分列：inputTokens 全额按输入价
    const plain = costOfUsage({ inputTokens: 1_000_000, outputTokens: 0 }, TABLE[0]!);
    expect(plain.costUsd).toBeCloseTo(1.0);
    // 病态数据（cached > input）：非缓存输入 max(0) 防御——成本不为负
    const pathological = costOfUsage({ inputTokens: 100, outputTokens: 0, cacheReadTokens: 200 }, TABLE[0]!);
    expect(pathological.inputCostUsd).toBe(0);
    expect(pathological.costUsd).toBeGreaterThanOrEqual(0);
  });

  it("costRollup：按会话/轮两级聚合（模型身份来自 request/header 关联）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aegent-cost-"));
    dirs.push(dir);
    const dbPath = join(dir, "events.sqlite");
    const storage = SqliteEventStorage.open({ path: dbPath });
    const store = new SessionEventStore(storage);
    store.append("s-a", turnEvents(1, { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 800_000 }));
    store.append("s-a", turnEvents(2, { inputTokens: 1_000_000, outputTokens: 0 }));
    store.append("s-b", turnEvents(1, { inputTokens: 2_000_000, outputTokens: 250_000 }));
    await store.flush("s-a");
    await store.flush("s-b");

    const report = costRollup(storage.db as unknown as Database, TABLE);
    expect(report).toHaveLength(2);
    const [a, b] = report as [{ sessionId: string; costUsd: number; byTurn: Array<{ turn: number; costUsd: number }> }, typeof report[number]];
    expect(a.sessionId).toBe("s-a");
    expect(a.byTurn).toHaveLength(2);
    expect(a.byTurn[0]).toMatchObject({ turn: 1, modelId: "gpt-x" });
    expect(a.byTurn[0]!.costUsd).toBeCloseTo(2.28); // 非缓存 0.2 + 缓存读 0.08 + 输出 2.0（无缓存写列→0）
    // s-a 两轮合计 = 2.28 + 1.0
    expect(a.costUsd).toBeCloseTo(3.28);
    // s-b：非缓存输入 2M × $1 = $2 + 输出 250k × $4 = $1 → $3
    expect(b.costUsd).toBeCloseTo(3.0);
    storage.close();
  });

  it("未配置价格的模型如实缺席（不虚构单价）；findPricing 精确匹配", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aegent-cost-"));
    dirs.push(dir);
    const dbPath = join(dir, "events.sqlite");
    const storage = SqliteEventStorage.open({ path: dbPath });
    const store = new SessionEventStore(storage);
    store.append("s-c", turnEvents(1, { inputTokens: 1_000, outputTokens: 1_000 }));
    await store.flush("s-c");
    // 换一个未配置价格的模型身份（s-d 走 request/header 的另一个 modelId）
    store.append("s-d", [
        { type: "turn/start", turn: 1 },
        { type: "request/header", turn: 1, step: 1, config: { provider: "openai", modelId: "unknown-model" }, reason: "initial" },
        { type: "user/message", turn: 1, message: { content: "q" }, source: "user" },
        { type: "step/start", turn: 1, step: 1 },
        { type: "assistant/message", turn: 1, step: 1, message: { content: "a" }, stream: [], usage: { inputTokens: 500, outputTokens: 500 } },
        { type: "step/end", turn: 1, step: 1 },
        { type: "turn/end", turn: 1, reason: { kind: "completed" } },
    ]);
    // 修正既有隐患：未 await 的 flush 在 close 后落库 → 连接已关拒绝
    await store.flush("s-d");

    const report = costRollup(storage.db as unknown as Database, TABLE);
    // s-c 有价格（gpt-x）进成本；s-d（unknown-model）如实缺席
    expect(report.map((r) => r.sessionId)).toEqual(["s-c"]);
    expect(findPricing(TABLE, "openai", "unknown-model")).toBeNull();
    expect(findPricing(TABLE, "anthropic", "gpt-x")).toBeNull();
    storage.close();
  });
});
