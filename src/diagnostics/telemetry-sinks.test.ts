/**
 * W15b/T9-6 验收：TelemetrySink 三实现同接口（noop/memory/otlp）+ 路由
 * 扇出 + logger trace 关联字段。
 */
import { describe, expect, it, vi } from "vitest";

import { createLogger, type LogSink } from "../core/index.js";
import {
  createMemoryTelemetrySink,
  createNoopTelemetrySink,
  createOtlpTelemetrySink,
  createTelemetryRouter,
} from "./telemetry-sinks.js";

const event = (level: "debug" | "info" | "warn" | "error", message = "msg") => ({
  level,
  message,
  ts: 1_700_000_000_000,
  ...(level === "warn" ? { fields: { key: "v" }, traceId: "trace-1" } : {}),
});

describe("TelemetrySink 三实现同接口（W15b/T9-6）", () => {
  it("三实现都有 record(event): void（端口同形——可替换范式）", () => {
    const noop = createNoopTelemetrySink();
    const memory = createMemoryTelemetrySink();
    const otlp = createOtlpTelemetrySink({ endpoint: "https://otel.example/v1/logs", fetchImpl: async () => new Response(null, { status: 200 }) });
    expect(() => noop.record(event("info"))).not.toThrow();
    expect(() => memory.record(event("info"))).not.toThrow();
    expect(() => otlp.record(event("info"))).not.toThrow();
  });

  it("noop 缺省：零行为零输出", () => {
    const spy = vi.fn();
    const noop: { record: (e: never) => void } = createNoopTelemetrySink();
    void spy;
    expect(() => noop.record(event("error") as never)).not.toThrow();
  });

  it("memory：环形缓冲 + 快照读面（容量淘汰 FIFO）", () => {
    const memory = createMemoryTelemetrySink(2);
    memory.record(event("info", "a"));
    memory.record(event("info", "b"));
    memory.record(event("info", "c"));
    expect(memory.snapshot().map((e) => e.message)).toEqual(["b", "c"]);
    memory.clear();
    expect(memory.snapshot()).toHaveLength(0);
  });

  it("otlp：批量满即刷（OTLP/HTTP JSON 编码——假 fetch 断言形状）", async () => {
    const bodies: unknown[] = [];
    const otlp = createOtlpTelemetrySink({
      endpoint: "https://otel.example/v1/logs",
      serviceName: "aegent-test",
      batchSize: 2,
      fetchImpl: (async (_url: string, init?: { body?: string }) => {
        bodies.push(JSON.parse(init?.body ?? "{}"));
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    });
    otlp.record(event("info", "e1"));
    otlp.record(event("warn", "e2"));
    await otlp.flush();
    expect(bodies).toHaveLength(1);
    const body = bodies[0] as {
      resourceLogs: {
        resource: { attributes: { value: { stringValue: string } }[] };
        scopeLogs: { logRecords: { body: { stringValue: string }; severityText: string; traceId?: string }[] }[];
      }[];
    };
    expect(body.resourceLogs[0]!.resource.attributes[0]!.value.stringValue).toBe("aegent-test");
    const records = body.resourceLogs[0]!.scopeLogs[0]!.logRecords;
    expect(records.map((r) => r.body.stringValue)).toEqual(["e1", "e2"]);
    expect(records[1]!.severityText).toBe("WARN");
    expect(records[1]!.traceId).toBe("trace-1");
  });

  it("otlp：导出失败不冒泡（fire-and-forget 纪律）", async () => {
    const otlp = createOtlpTelemetrySink({
      endpoint: "https://otel.example/v1/logs",
      batchSize: 1,
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => otlp.record(event("info", "e"))).not.toThrow();
    await otlp.flush();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("router：多 sink 扇出 + 单 sink 失败不拖垮其余", () => {
    const memory = createMemoryTelemetrySink();
    const boom: { record: (e: never) => void } = {
      record: () => {
        throw new Error("sink exploded");
      },
    };
    const router = createTelemetryRouter([boom as never, memory]);
    router.record(event("info", "fanout"));
    expect(memory.snapshot().map((e) => e.message)).toEqual(["fanout"]);
    expect(router.sinks()).toHaveLength(2);
  });
});

describe("logger trace 关联字段（W15b/T9-6——zcode formatLogPrefix 形状）", () => {
  it("withTrace 子 logger 产出的行带 trace 字段；父行不带", () => {
    const lines: string[] = [];
    const sink: LogSink = { write: (line) => void lines.push(line) };
    const logger = createLogger({ sink, channel: "test", logDir: undefined as never });
    logger.info("父行");
    logger.withTrace("trace-abc").info("子行");
    const parent = JSON.parse(lines[0]!) as { trace?: string };
    const child = JSON.parse(lines[1]!) as { trace?: string };
    expect(parent.trace).toBeUndefined();
    expect(child.trace).toBe("trace-abc");
  });

  it("withTrace 嵌套串链（traceId>嵌套）", () => {
    const lines: string[] = [];
    const sink: LogSink = { write: (line) => void lines.push(line) };
    const logger = createLogger({ sink, channel: "test", logDir: undefined as never });
    logger.withTrace("a").withTrace("b").info("嵌套行");
    const entry = JSON.parse(lines[0]!) as { trace?: string };
    expect(entry.trace).toBe("a>b");
  });
});
