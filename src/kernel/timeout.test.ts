import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TOOL_TIMEOUT, TimeoutError, withTimeout } from "./timeout.js";

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
