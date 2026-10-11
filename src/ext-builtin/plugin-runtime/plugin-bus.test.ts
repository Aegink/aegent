/**
 * W15b/T9-6 验收：声明式 topic 总线（topic 闭集 + 限流 + payload/订阅者
 * 上限 + 回调超时——全部参数化）。
 */
import { describe, expect, it, vi } from "vitest";

import { createPluginBus, PluginBusError } from "./plugin-bus.js";

describe("createPluginBus（W15b/T9-6 声明式总线）", () => {
  it("声明式 topic 闭集：未声明的 publish/subscribe 类型化拒绝", async () => {
    const bus = createPluginBus();
    bus.declareTopics(["task/update"]);
    await expect(bus.publish("ghost/topic", {})).rejects.toMatchObject({
      code: "BUS_TOPIC_UNDECLARED",
    });
    expect(() => bus.subscribe("ghost/topic", () => {})).toThrow(PluginBusError);
    // 声明后放行
    const report = await bus.publish("task/update", { id: 1 });
    expect(report.ok).toBe(true);
    expect(report.delivered).toBe(0);
  });

  it("限流：每窗口超 maxPublishPerWindow → BUS_RATE_LIMITED（参数化）", async () => {
    const bus = createPluginBus({ maxPublishPerWindow: 3 });
    bus.declareTopics(["t"]);
    for (let i = 0; i < 3; i++) {
      await expect(bus.publish("t", { i })).resolves.toMatchObject({ ok: true });
    }
    await expect(bus.publish("t", { i: 4 })).rejects.toMatchObject({ code: "BUS_RATE_LIMITED" });
  });

  it("payload 上限：超 maxPayloadBytes → BUS_PAYLOAD_TOO_LARGE（参数化）", async () => {
    const bus = createPluginBus({ maxPayloadBytes: 32 });
    bus.declareTopics(["t"]);
    await expect(bus.publish("t", { blob: "x".repeat(64) })).rejects.toMatchObject({
      code: "BUS_PAYLOAD_TOO_LARGE",
    });
  });

  it("投递与退订：订阅者收到 payload；退订后零触达", async () => {
    const bus = createPluginBus();
    bus.declareTopics(["t"]);
    const seen: unknown[] = [];
    const sub = bus.subscribe("t", (payload) => void seen.push(payload));
    expect(bus.subscriberCount("t")).toBe(1);
    await bus.publish("t", { hello: 1 });
    expect(seen).toEqual([{ hello: 1 }]);
    sub.unsubscribe();
    expect(bus.subscriberCount("t")).toBe(0);
    await bus.publish("t", { hello: 2 });
    expect(seen).toHaveLength(1);
  });

  it("订阅者上限：超 maxSubscribersPerTopic → BUS_SUBSCRIBER_LIMIT", () => {
    const bus = createPluginBus({ maxSubscribersPerTopic: 2 });
    bus.declareTopics(["t"]);
    bus.subscribe("t", () => {});
    bus.subscribe("t", () => {});
    expect(() => bus.subscribe("t", () => {})).toThrow(PluginBusError);
  });

  it("回调异常/超时不冒泡：delivered 计数排除失败者（deadline 纪律）", async () => {
    const bus = createPluginBus({ handlerTimeoutMs: 30 });
    bus.declareTopics(["t"]);
    bus.subscribe("t", () => {
      throw new Error("handler boom");
    });
    bus.subscribe("t", () => new Promise(() => {})); // 挂死——超时回收
    bus.subscribe("t", () => {});
    const report = await bus.publish("t", { n: 1 });
    expect(report.ok).toBe(true);
    expect(report.delivered).toBe(1);
  });

  it("topic 总数上限：declareTopics 超 maxTopics → BUS_TOPIC_LIMIT", () => {
    const bus = createPluginBus({ maxTopics: 2 });
    bus.declareTopics(["a", "b"]);
    expect(() => bus.declareTopics(["c"])).toThrow(PluginBusError);
  });
});
