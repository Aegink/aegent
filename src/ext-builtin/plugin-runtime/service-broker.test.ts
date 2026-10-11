/**
 * W15b/T9-6 验收：常驻服务 broker（崩溃重启 ≤5 次退避 + 放弃可见 + 收束）。
 */
import { describe, expect, it, vi } from "vitest";

import { createServiceBroker } from "./service-broker.js";

describe("createServiceBroker（W15b/T9-6 常驻服务）", () => {
  it("正常启动：registered → running；stop 收束", async () => {
    const broker = createServiceBroker();
    let started = 0;
    let stopped = 0;
    await broker.register("plug/svc", () => ({
      start: () => {
        started += 1;
      },
      stop: () => {
        stopped += 1;
      },
    }));
    await vi.waitFor(() => expect(started).toBe(1));
    expect((await broker.stop("plug/svc"))).toBe(true);
    expect(stopped).toBe(1);
    expect(broker.status()[0]?.status).toBe("stopped");
  });

  it("崩溃重启：失败 2 次后第 3 次成功（指数退避）", async () => {
    const warns: string[] = [];
    const broker = createServiceBroker({
      backoffBaseMs: 5,
      logger: { debug() {}, info() {}, warn: (m) => warns.push(m), error() {}, setLevel() {}, getLevel: () => "info", withTrace() { throw new Error("unused"); } },
    });
    let attempts = 0;
    await broker.register("plug/flaky", () => {
      attempts += 1;
      if (attempts < 3) throw new Error(`attempt ${String(attempts)} failed`);
      return { start: () => {} };
    });
    await vi.waitFor(() => {
      const entry = broker.status()[0];
      if (entry?.status !== "running") throw new Error("not yet running");
    }, { timeout: 5_000 });
    expect(attempts).toBe(3);
    expect(broker.status()[0]?.restarts).toBe(2);
    expect(warns.length).toBeGreaterThanOrEqual(2);
  });

  it("重启 ≤5 次退避：持续崩溃 → 第 6 次失败后放弃（status failed，不再重启）", async () => {
    let attempts = 0;
    const broker = createServiceBroker({ backoffBaseMs: 1, maxRestarts: 5 });
    await broker.register("plug/doomed", () => {
      attempts += 1;
      throw new Error("always fails");
    });
    await vi.waitFor(() => {
      const entry = broker.status()[0];
      if (entry?.status !== "failed") throw new Error("not yet failed");
    }, { timeout: 10_000 });
    expect(attempts).toBe(6); // 首发 + 5 次重启
    expect(broker.status()[0]?.status).toBe("failed");
    expect(broker.status()[0]?.lastError).toContain("always fails");
    const settled = attempts;
    await new Promise((r) => setTimeout(r, 50));
    expect(attempts).toBe(settled); // 放弃后不再重启
  });

  it("stopAll：后启动先停（FIFO 反序收束）", async () => {
    const broker = createServiceBroker();
    const order: string[] = [];
    await broker.register("a/one", () => ({ stop: () => void order.push("a/one") }));
    await broker.register("b/two", () => ({ stop: () => void order.push("b/two") }));
    await vi.waitFor(() => expect(broker.status().every((s) => s.status === "running")).toBe(true));
    await broker.stopAll();
    expect(order).toEqual(["b/two", "a/one"]);
  });

  it("重名拒绝 + has 判据（热重载幂等注册的守卫）", async () => {
    const broker = createServiceBroker();
    await broker.register("a/one", () => ({}));
    await expect(broker.register("a/one", () => ({}))).rejects.toThrow("重名");
    expect(broker.has("a/one")).toBe(true);
    expect(broker.has("a/two")).toBe(false);
  });
});
