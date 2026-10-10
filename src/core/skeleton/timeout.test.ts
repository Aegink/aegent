import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  IdleWatchdog,
  MAX_TIMER_DELAY_MS,
  TOOL_TIMEOUT,
  TimeoutError,
  assertTimerDelayMs,
  clampTimeout,
  withTimeout,
} from "./timeout.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("withTimeout —— J22 超时错误码作用域", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => void unhandled.push(reason);
  beforeEach(() => void process.on("unhandledRejection", onUnhandled));
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    unhandled.length = 0;
  });

  it("超时路径：错误 code === TOOL_TIMEOUT 且带 timeoutMs", async () => {
    const inner = sleep(50).then(() => "late");
    await expect(withTimeout(TOOL_TIMEOUT, 10, inner)).rejects.toMatchObject({
      code: "TOOL_TIMEOUT",
      timeoutMs: 10,
    });
  });

  it("未超时正常结算且不拖满预算（clearTimeout 生效）", async () => {
    const start = Date.now();
    const inner = sleep(5).then(() => "ok");
    await expect(withTimeout(TOOL_TIMEOUT, 10_000, inner)).resolves.toBe("ok");
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("内层 rejection 原样透传（不是 TimeoutError）", async () => {
    const inner = sleep(5).then(() => {
      throw new Error("boom");
    });
    await expect(withTimeout(TOOL_TIMEOUT, 1000, inner)).rejects.toThrow("boom");
  });

  it("内层完成晚于超时不产生 unhandled rejection（成功与失败两个方向）", async () => {
    const lateOk = sleep(40).then(() => "late-ok");
    await expect(withTimeout(TOOL_TIMEOUT, 5, lateOk)).rejects.toBeInstanceOf(TimeoutError);

    const lateFail = sleep(40).then(() => {
      throw new Error("late-fail");
    });
    await expect(withTimeout(TOOL_TIMEOUT, 5, lateFail)).rejects.toBeInstanceOf(TimeoutError);

    // 给内层结果留出落地时间；unhandledRejection 监听器由 afterEach 断言
    await sleep(60);
    expect(unhandled).toEqual([]);
  });

  it("嵌套作用域：内层先到透传内层 code，外层先到是外层 code", async () => {
    // 内层 5ms 先超时：外层看到的是 INNER_TIMEOUT，不是 OUTER_TIMEOUT
    const innerFirst = withTimeout("INNER_TIMEOUT", 5, sleep(50).then(() => 1));
    await expect(withTimeout("OUTER_TIMEOUT", 1000, innerFirst)).rejects.toMatchObject({
      code: "INNER_TIMEOUT",
    });

    // 外层 5ms 先超时：外层自己的 code；内层 promise 不受影响继续执行
    const innerSecond = withTimeout("INNER_TIMEOUT", 50, sleep(50).then(() => 1));
    await expect(withTimeout("OUTER_TIMEOUT", 5, innerSecond)).rejects.toMatchObject({
      code: "OUTER_TIMEOUT",
    });
  });
});

describe("clampTimeout —— B18 三档合并", () => {
  it("提示档生效且恒被上限收口：requested < max 原样、requested > max 钳到 max", () => {
    expect(clampTimeout(3_000, 10_000, 60_000)).toBe(3_000);
    expect(clampTimeout(120_000, 10_000, 60_000)).toBe(60_000);
  });

  it("缺省用默认档；默认档也受上限收口", () => {
    expect(clampTimeout(undefined, 10_000, 60_000)).toBe(10_000);
    expect(clampTimeout(undefined, 600_000, 60_000)).toBe(60_000);
  });

  it("非法值抛错：0 / 负数 / NaN / Infinity 均不是合法提示（零不是禁用哨兵）", () => {
    expect(() => clampTimeout(0, 10_000, 60_000)).toThrow(/正的有限/);
    expect(() => clampTimeout(-5, 10_000, 60_000)).toThrow(/正的有限/);
    expect(() => clampTimeout(Number.NaN, 10_000, 60_000)).toThrow(/正的有限/);
    expect(() => clampTimeout(Number.POSITIVE_INFINITY, 10_000, 60_000)).toThrow(/正的有限/);
  });

  it("上限不可经任何输入关闭：即使 requested/def 都巨大，结果仍 ≤ max", () => {
    expect(clampTimeout(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 60_000)).toBe(60_000);
  });

  it("抛错信息带字段名（调用方看得到哪个输入坏）", () => {
    expect(() => clampTimeout(0, 1, 2, "bash timeout")).toThrow(/bash timeout/);
  });
});

describe("assertTimerDelayMs —— J24 setTimeout 上限守卫", () => {
  it("上限值 2^31-1 合法；超过即抛错（防 Node 静默钳到 1ms）", () => {
    expect(assertTimerDelayMs(MAX_TIMER_DELAY_MS)).toBe(MAX_TIMER_DELAY_MS);
    expect(() => assertTimerDelayMs(MAX_TIMER_DELAY_MS + 1)).toThrow(/2_147_483_647|2147483647/);
  });

  it("非正 / 非有限同样抛错", () => {
    expect(() => assertTimerDelayMs(0)).toThrow();
    expect(() => assertTimerDelayMs(-1)).toThrow();
    expect(() => assertTimerDelayMs(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("withTimeout 内部武装点已过闸：超上限预算立刻抛错而非静默武装", () => {
    expect(() => withTimeout("X", MAX_TIMER_DELAY_MS + 1, Promise.resolve(1))).toThrow();
  });
});

describe("IdleWatchdog —— J23 空闲 / 可重臂空闲", () => {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  it("空闲超时：arm 后 ms 内无续期 → onExpire 触发（TimeoutError 带 code 与 ms）", async () => {
    const expired: TimeoutError[] = [];
    const dog = new IdleWatchdog("IDLE_TEST", 20, (e) => void expired.push(e));
    dog.arm();
    await sleep(60);
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({ code: "IDLE_TEST", timeoutMs: 20 });
    dog.dispose();
  });

  it("touch 重置：持续有活动则不触发；活动停止后到点触发", async () => {
    const expired: TimeoutError[] = [];
    const dog = new IdleWatchdog("IDLE_TEST", 25, (e) => void expired.push(e));
    dog.arm();
    for (let i = 0; i < 3; i++) {
      await sleep(10);
      dog.touch();
    }
    expect(expired).toHaveLength(0);
    await sleep(60);
    expect(expired).toHaveLength(1);
    dog.dispose();
  });

  it("可重臂空闲（pulse）：等待窗口内的传输活动续期、不触发；窗口外 pulse 是 no-op", async () => {
    const expired: TimeoutError[] = [];
    const dog = new IdleWatchdog("IDLE_TEST", 30, (e) => void expired.push(e));
    dog.arm();
    // 窗口内 pulse 续期——15ms 间隔 × 3 覆盖 45ms，无续期本已触发一次
    for (let i = 0; i < 3; i++) {
      await sleep(15);
      dog.pulse();
    }
    expect(expired).toHaveLength(0);
    dog.disarm();
    await sleep(15);
    dog.pulse(); // 无等待窗口：no-op，不重启计时
    await sleep(40);
    expect(expired).toHaveLength(0);
    dog.dispose();
  });

  it("到期只触发一次；dispose 后 touch/pulse/arm 全部 no-op", async () => {
    const expired: TimeoutError[] = [];
    const dog = new IdleWatchdog("IDLE_TEST", 10, (e) => void expired.push(e));
    dog.arm();
    await sleep(30);
    dog.touch();
    dog.arm();
    dog.pulse();
    expect(expired).toHaveLength(1);
    dog.dispose();
    await sleep(25);
    expect(expired).toHaveLength(1);
  });
});
