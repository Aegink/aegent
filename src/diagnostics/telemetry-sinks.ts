/**
 * TelemetrySink 三实现 + 路由（W15b/T9-6——pi·packages/telemetry 的"同一
 * 接口三实现可替换 sink"范式，最优评估 §22）：
 *   - `createNoopTelemetrySink`——缺省（零行为零开销——noop 缺省纪律）；
 *   - `createMemoryTelemetrySink`——测试/内存（环形缓冲，快照读面）；
 *   - `createOtlpTelemetrySink`——OTLP/HTTP 导出（**外置于内核**：本模块
 *     在 diagnostics 域，内核只持 contracts/telemetry.ts 的端口形状；
 *     fetchImpl 注入——生产 globalThis.fetch，测试可注假件）。
 *
 * `createTelemetryRouter`——多 sink 扇出（缺省 = noop 单 sink——装配零
 * 行为变化；OTLP/插件导出通道经 addSink 挂载）。fire-and-forget 纪律：
 * record 不 await I/O（OTLP 导出内部排队，失败 warn 不上抛）。
 */

import type { TelemetryEvent, TelemetrySink } from "../core/index.js";

/** noop（缺省）：零行为。 */
export function createNoopTelemetrySink(): TelemetrySink {
  return { record: (_event: TelemetryEvent) => {} };
}

export interface MemoryTelemetrySink extends TelemetrySink {
  /** 快照读面（测试断言用——环形缓冲内的事件副本）。 */
  snapshot(): readonly TelemetryEvent[];
  clear(): void;
}

/** memory（测试/内存）：环形缓冲（缺省 256 条——FIFO 淘汰）。 */
export function createMemoryTelemetrySink(capacity = 256): MemoryTelemetrySink {
  const events: TelemetryEvent[] = [];
  return {
    record: (event) => {
      events.push({ ...event });
      if (events.length > capacity) events.splice(0, events.length - capacity);
    },
    snapshot: () => [...events],
    clear: () => {
      events.length = 0;
    },
  };
}

export interface OtlpTelemetrySinkOptions {
  /** OTLP/HTTP 导出端点（contributes.telemetry.endpoint）。 */
  readonly endpoint: string;
  /** 注入点（生产 globalThis.fetch；测试假件）。 */
  readonly fetchImpl?: typeof fetch;
  /** 批量上限（满即刷——缺省 16）。 */
  readonly batchSize?: number;
  /** 刷新间隔毫秒（缺省 5_000）。 */
  readonly flushIntervalMs?: number;
  /** 服务名（OTLP resource.service.name——缺省 aegent）。 */
  readonly serviceName?: string;
}

/**
 * OTLP/HTTP 导出（logs 信号——body 形状对齐 OTLP JSON 编码的简化投影：
 * resourceLogs[{scopeLogs[{logRecords[]}]]}；导出失败 warn 不上抛——
 * fire-and-forget 纪律，telemetry 永不拖垮宿主）。
 */
export function createOtlpTelemetrySink(options: OtlpTelemetrySinkOptions): TelemetrySink & {
  flush(): Promise<void>;
} {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const batchSize = options.batchSize ?? 16;
  const flushIntervalMs = options.flushIntervalMs ?? 5_000;
  const serviceName = options.serviceName ?? "aegent";
  let queue: TelemetryEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    const body = {
      resourceLogs: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: serviceName } }] },
          scopeLogs: [
            {
              logRecords: batch.map((event) => ({
                timeUnixNano: String(event.ts * 1_000_000),
                severityText: event.level.toUpperCase(),
                body: { stringValue: event.message },
                attributes: Object.entries(event.fields ?? {}).map(([key, value]) => ({
                  key,
                  value: { stringValue: String(value) },
                })),
                ...(event.traceId !== undefined
                  ? { traceId: event.traceId }
                  : {}),
              })),
            },
          ],
        },
      ],
    };
    try {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        // 导出失败可见（warn 走 logger——不丢队列纪律：批已消费，事件计数
        // 由 OTLP 端的响应码可查；不回灌防雪崩）
        console.warn(`[telemetry] OTLP 导出失败：${String(response.status)}`);
      }
    } catch (e) {
      console.warn(`[telemetry] OTLP 导出异常：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return {
    record: (event) => {
      queue.push({ ...event });
      if (queue.length >= batchSize) {
        void flush();
        return;
      }
      if (timer === undefined) {
        timer = setTimeout(() => void flush(), flushIntervalMs);
      }
    },
    flush,
  };
}

/** 路由器（缺省 noop 单 sink——装配零行为变化；addSink 挂 OTLP/插件通道）。 */
export function createTelemetryRouter(
  initial: readonly TelemetrySink[] = [createNoopTelemetrySink()],
): TelemetrySink & {
  addSink(sink: TelemetrySink): void;
  sinks(): readonly TelemetrySink[];
} {
  const sinks = [...initial];
  return {
    record: (event) => {
      for (const sink of sinks) {
        try {
          sink.record(event);
        } catch {
          // 单 sink 失败不拖垮其余（fire-and-forget 纪律）
        }
      }
    },
    addSink: (sink) => {
      sinks.push(sink);
    },
    sinks: () => [...sinks],
  };
}
