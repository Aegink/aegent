import { describe, expect, it } from "vitest";

import {
  ServerDrainingError,
  ToolClassLimiter,
  TurnAdmission,
} from "./admission.js";

/**
 * J20 + M9 并发面（T-P1-49）——TurnAdmission 形状取 codex·turn_admission.rs
 * （admit→Permit / begin_drain / active 计数 / server_draining_error）；
 * ToolClassLimiter 落 M9 "Tool classes have independent global limits"。
 */
describe("TurnAdmission —— J20 turn 准入", () => {
  it("admit/release 计数：递增递减，release 幂等（双 release 不产生负计数）", () => {
    const admission = new TurnAdmission();
    expect(admission.activeCount).toBe(0);
    const p1 = admission.admit();
    expect(admission.activeCount).toBe(1);
    const p2 = admission.admit();
    expect(admission.activeCount).toBe(2);
    p1.release();
    expect(admission.activeCount).toBe(1);
    p2.release();
    p2.release(); // 幂等
    expect(admission.activeCount).toBe(0);
  });

  it("beginDrain 后 admit 抛 ServerDrainingError（code=SERVER_DRAINING）；draining 可查询", () => {
    const admission = new TurnAdmission();
    expect(admission.draining).toBe(false);
    admission.beginDrain();
    expect(admission.draining).toBe(true);
    expect(() => admission.admit()).toThrowError(ServerDrainingError);
    try {
      admission.admit();
    } catch (e) {
      expect((e as ServerDrainingError).code).toBe("SERVER_DRAINING");
      expect((e as Error).message).toContain("收尾");
    }
  });

  it("draining 前已发出的 permit 照常 release（存量工作正常结算，计数归零）", () => {
    const admission = new TurnAdmission();
    const p = admission.admit();
    admission.beginDrain();
    p.release();
    expect(admission.activeCount).toBe(0);
  });
});

describe("ToolClassLimiter —— M9 工具类独立全局上限", () => {
  it("类内超限排队等待：写执行类上限 2，第 3 个等前一个 release 后才进（FIFO）", async () => {
    const limiter = new ToolClassLimiter({ writeExecuteMax: 2 }, () => "write");
    const order: string[] = [];
    const release1 = await limiter.acquire("bash");
    const release2 = await limiter.acquire("bash");
    expect(limiter.snapshot()).toMatchObject({ writeRunning: 2, writeWaiting: 0 });
    const third = limiter.acquire("bash").then((r) => {
      order.push("third-entered");
      return r;
    });
    // 让微任务翻转：第三个仍在排队（running 满、waiters=1）
    await Promise.resolve();
    expect(limiter.snapshot()).toMatchObject({ writeRunning: 2, writeWaiting: 1 });
    release1();
    await third;
    // FIFO：名额转交给队头，第三个立即进入（running 仍 2）
    expect(order).toEqual(["third-entered"]);
    expect(limiter.snapshot()).toMatchObject({ writeRunning: 2, writeWaiting: 0 });
    release2();
  });

  it("类独立：写类满时只读类照常进入（上限互不影响）", async () => {
    const limiter = new ToolClassLimiter(
      { writeExecuteMax: 1, readOnlyMax: 3 },
      (name) => (name === "bash" || name === "write" ? "write" : "read"),
    );
    const releaseWrite = await limiter.acquire("bash");
    // 写类满（running 1/limit 1）——read 类不受影响
    const releaseRead1 = await limiter.acquire("read");
    const releaseRead2 = await limiter.acquire("glob");
    const releaseRead3 = await limiter.acquire("grep");
    expect(limiter.snapshot()).toMatchObject({
      writeRunning: 1,
      readRunning: 3,
    });
    // 只读类第 4 个排队（readOnlyMax 3）
    let readEntered = false;
    const r4 = limiter.acquire("read").then(() => {
      readEntered = true;
    });
    await Promise.resolve();
    expect(readEntered).toBe(false);
    releaseRead1();
    await r4;
    expect(readEntered).toBe(true);
    releaseWrite();
    releaseRead2();
    releaseRead3();
  });

  it("缺省 Infinity 不限：两类都无限并发（零行为变化）", async () => {
    const limiter = new ToolClassLimiter({}, () => "read");
    const releases: Array<() => void> = [];
    for (let i = 0; i < 50; i += 1) releases.push(await limiter.acquire(`t${i}`));
    expect(limiter.snapshot()).toMatchObject({ readRunning: 50, readWaiting: 0 });
    for (const r of releases) r();
    expect(limiter.snapshot().readRunning).toBe(0);
  });
});
