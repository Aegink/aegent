/**
 * 调度器测试（T3-7/W6）：拓扑排序 / 并行分组 / 环检测 / 并发上限 /
 * 保模型序回填——五件齐的独立可测面。判定链全走声明（不认识工具名）。
 */
import { describe, expect, it } from "vitest";

import {
  canRunInParallel,
  DEFAULT_MAX_CONCURRENCY,
  executeSchedule,
  ScheduleCycleError,
  schedule,
  type SchedulableCall,
  type SchedulableMeta,
} from "./scheduler.js";

const meta = (m: SchedulableMeta) => m;

describe("canRunInParallel 判定链（五级，fail-closed）", () => {
  it("destructive 永不并行（即使声明 concurrentSafe——安全优先）", () => {
    expect(canRunInParallel(meta({ destructive: true, concurrentSafe: true }))).toBe(false);
  });
  it("concurrentSafe 显式 true/false 优先于 readOnly/sideEffectScope", () => {
    expect(canRunInParallel(meta({ concurrentSafe: true, readOnly: false }))).toBe(true);
    expect(canRunInParallel(meta({ concurrentSafe: false, readOnly: true }))).toBe(false);
  });
  it("readOnly → true；sideEffectScope none → true；workspace/system → false", () => {
    expect(canRunInParallel(meta({ readOnly: true }))).toBe(true);
    expect(canRunInParallel(meta({ sideEffectScope: "none" }))).toBe(true);
    expect(canRunInParallel(meta({ sideEffectScope: "workspace" }))).toBe(false);
    expect(canRunInParallel(meta({ sideEffectScope: "system" }))).toBe(false);
  });
  it("无任何声明 → false（未声明即不可并行，fail-closed）", () => {
    expect(canRunInParallel(undefined)).toBe(false);
    expect(canRunInParallel(meta({}))).toBe(false);
  });
  it("旧 parallel 声明（B17）照真值采纳（兼容迁移）", () => {
    expect(canRunInParallel(meta({ parallel: true }))).toBe(true);
    expect(canRunInParallel(meta({ parallel: false }))).toBe(false);
  });
});

describe("schedule：拓扑/分组/环", () => {
  const noDeps = (calls: SchedulableCall[]) => calls.map((c) => ({ ...c, dependsOn: undefined }));

  it("无依赖调用全部进并行组（声明 none 时）", () => {
    const calls = noDeps([
      { callId: "a", toolName: "ls", arguments: "{}" },
      { callId: "b", toolName: "grep", arguments: "{}" },
    ]);
    const r = schedule(calls, () => meta({ sideEffectScope: "none" }));
    expect(r.parallelGroups).toHaveLength(1);
    expect(r.parallelGroups[0]!.calls.map((c) => c.callId)).toEqual(["a", "b"]);
    expect(r.sequentialCalls).toHaveLength(0);
  });

  it("声明 workspace 的工具走顺序组（与并行组隔离）", () => {
    const calls = noDeps([
      { callId: "r", toolName: "read", arguments: "{}" },
      { callId: "w", toolName: "write", arguments: "{}" },
    ]);
    const r = schedule(calls, (n) => (n === "write" ? meta({ sideEffectScope: "workspace" }) : meta({ sideEffectScope: "none" })));
    expect(r.parallelGroups[0]!.calls.map((c) => c.callId)).toEqual(["r"]);
    expect(r.sequentialCalls.map((c) => c.callId)).toEqual(["w"]);
  });

  it("拓扑排序：依赖者排在依赖之后", () => {
    const calls: SchedulableCall[] = [
      { callId: "b", toolName: "grep", arguments: "{}", dependsOn: ["a"] },
      { callId: "a", toolName: "read", arguments: "{}" },
    ];
    const r = schedule(calls, () => meta({ sideEffectScope: "none" }));
    expect(r.executionOrder).toEqual(["a", "b"]);
  });

  it("成环 fail-closed：ScheduleCycleError 带环路径", () => {
    const calls: SchedulableCall[] = [
      { callId: "a", toolName: "x", arguments: "{}", dependsOn: ["b"] },
      { callId: "b", toolName: "y", arguments: "{}", dependsOn: ["a"] },
    ];
    expect(() => schedule(calls, () => meta({ sideEffectScope: "none" }))).toThrow(ScheduleCycleError);
  });

  it("依赖指向批外 callId = 无边（前置 step 的结果）", () => {
    const calls: SchedulableCall[] = [
      { callId: "a", toolName: "x", arguments: "{}", dependsOn: ["ghost"] },
    ];
    const r = schedule(calls, () => meta({ sideEffectScope: "none" }));
    expect(r.executionOrder).toEqual(["a"]);
  });
});

describe("executeSchedule：上限 / 批次边界 / 保模型序", () => {
  it("并发上限被尊重（并发峰值 ≤ maxConcurrency）", async () => {
    let running = 0;
    let peak = 0;
    const calls = Array.from({ length: 6 }, (_, i) => ({
      callId: `c${i}`,
      toolName: "ls",
      arguments: "{}",
    }));
    const results = await executeSchedule(calls, () => meta({ sideEffectScope: "none" }), {
      maxConcurrency: 2,
      runOne: async (c) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running -= 1;
        return { content: c.callId };
      },
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(results.map((r) => r.content)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5"]);
  });

  it("缺省并发上限 = 10（zcode DEFAULT_MAX_CONCURRENCY 同值）", () => {
    expect(DEFAULT_MAX_CONCURRENCY).toBe(10);
  });

  it("保模型序：完成序乱序，回填按输入序（dsh 不变量）", async () => {
    const calls = [
      { callId: "slow", toolName: "ls", arguments: "{}" },
      { callId: "fast", toolName: "grep", arguments: "{}" },
    ];
    const results = await executeSchedule(calls, () => meta({ sideEffectScope: "none" }), {
      runOne: async (c) => {
        if (c.callId === "slow") await new Promise((r) => setTimeout(r, 30));
        return { content: c.callId };
      },
    });
    // slow 先在输入序（模型序）——回填按输入序，即使 fast 先完成
    expect(results.map((r) => r.content)).toEqual(["slow", "fast"]);
  });

  it("批次边界观察：开始/完成成对（组数一致）", async () => {
    const batches: string[] = [];
    const calls = [
      { callId: "a", toolName: "ls", arguments: "{}" },
      { callId: "b", toolName: "write", arguments: "{}" },
    ];
    await executeSchedule(calls, (n) => (n === "write" ? meta({ sideEffectScope: "workspace" }) : meta({ sideEffectScope: "none" })), {
      runOne: async (c) => ({ content: c.callId }),
      observer: {
        onBatchStart: (g) => batches.push(`start:${g.batchIndex}`),
        onBatchComplete: (g) => batches.push(`done:${g.batchIndex}`),
      },
    });
    // 并行组 1 批（a）；b 顺序执行不产生批次边界
    expect(batches).toEqual(["start:0", "done:0"]);
  });

  it("调度器 runOne 抛错不静默（错误上抛交 loop 的 dispatchTool isError 结算面）", async () => {
    const calls = [{ callId: "a", toolName: "ls", arguments: "{}" }];
    await expect(
      executeSchedule(calls, () => meta({ sideEffectScope: "none" }), {
        runOne: async () => {
          throw new Error("dispatch 层已把工具异常转 isError——调度器只透传实现错误");
        },
      }),
    ).rejects.toThrow("dispatch 层已把工具异常转 isError");
  });
});
