/**
 * 声明式 topic 总线（W15b/T9-6——pi-desktop bus.publish/subscribe 同构，
 * EP-12 形状落地）：跨插件发布/订阅的宿主中介面——插件互相不持引用，
 * 全部经本总线（宿主可观测可限流）。
 *
 * 参数化纪律（计划卡"限流/上限参数化"——全部构造期可调）：
 *   - **声明式 topic 闭集**：发布/订阅的 topic 必须在**某插件的
 *     contributes.bus.topics 声明集**内（fail-closed——未声明 topic 拒绝）；
 *   - **限流**：每 topic 每窗口最多 maxPublishPerWindow 条（滑动窗口），
 *     超限类型化拒绝（不静默丢弃——发布者可见可自修）；
 *   - **上限**：payload 字节上限 + 每 topic 订阅者上限 + topic 总数上限。
 *
 * 订阅回调带超时预算（插件回调是宿主代跑的不可信代码——与 SDK 事件投递
 * 同款 deadline 纪律）；回调异常不冒泡（报告面返回）。
 */

import { Deadline, withDeadline } from "../../core/index.js";
import type { Logger } from "../../core/index.js";

// 形状单源在 core/contracts/plugins.ts（EP-12 契约面）——此处 re-export
export type { BusPayload, BusPublishReport, BusSubscription } from "../../core/index.js";
import type { BusPayload, BusPublishReport, BusSubscription } from "../../core/index.js";

export interface PluginBusOptions {
  /** 每窗口（1s）每 topic 最大发布条数（缺省 20——限流参数化位）。 */
  readonly maxPublishPerWindow?: number;
  /** 单条 payload 最大字节数（缺省 64KB——JSON 序列化后）。 */
  readonly maxPayloadBytes?: number;
  /** 每 topic 最大订阅者数（缺省 16）。 */
  readonly maxSubscribersPerTopic?: number;
  /** topic 总数上限（缺省 64——声明集并集的防线）。 */
  readonly maxTopics?: number;
  /** 订阅回调超时毫秒（缺省 2_000——挂死可回收）。 */
  readonly handlerTimeoutMs?: number;
  readonly logger?: Logger;
}

export class PluginBusError extends Error {
  override readonly name = "PluginBusError";
  constructor(
    readonly code: "BUS_TOPIC_UNDECLARED" | "BUS_RATE_LIMITED" | "BUS_PAYLOAD_TOO_LARGE" | "BUS_SUBSCRIBER_LIMIT" | "BUS_TOPIC_LIMIT",
    message: string,
  ) {
    super(message);
    this.name = "PluginBusError";
  }
}

export interface PluginBus {
  /** 登记声明集（装载期——插件 contributes.bus.topics 的并集）。 */
  declareTopics(topics: readonly string[]): void;
  /** 已声明的 topic 快照（诊断面）。 */
  declaredTopics(): readonly string[];
  publish(topic: string, payload: BusPayload, opts?: { source?: string }): Promise<BusPublishReport>;
  subscribe(
    topic: string,
    handler: (payload: BusPayload) => void | Promise<void>,
    opts?: { subscriber?: string },
  ): BusSubscription;
  subscriberCount(topic: string): number;
}

export function createPluginBus(options: PluginBusOptions = {}): PluginBus {
  const maxPerWindow = options.maxPublishPerWindow ?? 20;
  const maxPayloadBytes = options.maxPayloadBytes ?? 64 * 1024;
  const maxSubscribers = options.maxSubscribersPerTopic ?? 16;
  const maxTopics = options.maxTopics ?? 64;
  const handlerTimeoutMs = options.handlerTimeoutMs ?? 2_000;

  const declared = new Set<string>();
  const subscribers = new Map<string, Set<(payload: BusPayload) => void | Promise<void>>>();
  /** 滑动窗口限流（topic → 时间戳数组）。 */
  const publishTimes = new Map<string, number[]>();

  return {
    declareTopics: (topics) => {
      for (const topic of topics) {
        if (!declared.has(topic) && declared.size >= maxTopics) {
          throw new PluginBusError(
            "BUS_TOPIC_LIMIT",
            `topic 总数超上限（${String(declared.size)}/${String(maxTopics)}）——拒绝声明 ${topic}`,
          );
        }
        declared.add(topic);
      }
    },
    declaredTopics: () => [...declared].sort(),
    publish: async (topic, payload, opts) => {
      if (!declared.has(topic)) {
        throw new PluginBusError(
          "BUS_TOPIC_UNDECLARED",
          `topic 未声明：${topic}（声明式总线——contributes.bus.topics 先声明后用）`,
        );
      }
      const size = JSON.stringify(payload ?? {}).length;
      if (size > maxPayloadBytes) {
        throw new PluginBusError(
          "BUS_PAYLOAD_TOO_LARGE",
          `payload 超上限：${String(size)} > ${String(maxPayloadBytes)} 字节（topic ${topic}）`,
        );
      }
      // 滑动窗口限流（1s 窗口）
      const now = Date.now();
      const times = publishTimes.get(topic) ?? [];
      const windowStart = now - 1_000;
      const recent = times.filter((t) => t >= windowStart);
      if (recent.length >= maxPerWindow) {
        throw new PluginBusError(
          "BUS_RATE_LIMITED",
          `topic ${topic} 发布限流：${String(recent.length)}/${String(maxPerWindow)} 每秒——稍后再发`,
        );
      }
      recent.push(now);
      publishTimes.set(topic, recent);
      // 投递（回调异常/超时不冒泡——报告面）
      const handlers = [...(subscribers.get(topic) ?? [])];
      let delivered = 0;
      for (const handler of handlers) {
        try {
          await withDeadline(
            Deadline.fromTimeoutMs("BUS_HANDLER_TIMEOUT", handlerTimeoutMs),
            Promise.resolve(handler(payload)),
          );
          delivered += 1;
        } catch (e) {
          options.logger?.warn(`bus handler 失败（topic ${topic}）：${e instanceof Error ? e.message : String(e)}`);
        }
      }
      void opts;
      return { ok: true, topic, delivered };
    },
    subscribe: (topic, handler, opts) => {
      if (!declared.has(topic)) {
        throw new PluginBusError(
          "BUS_TOPIC_UNDECLARED",
          `topic 未声明：${topic}（声明式总线——contributes.bus.topics 先声明后用）`,
        );
      }
      const set = subscribers.get(topic) ?? new Set();
      if (set.size >= maxSubscribers) {
        throw new PluginBusError(
          "BUS_SUBSCRIBER_LIMIT",
          `topic ${topic} 订阅者超上限（${String(set.size)}/${String(maxSubscribers)}）`,
        );
      }
      set.add(handler);
      subscribers.set(topic, set);
      void opts;
      return {
        topic,
        unsubscribe: () => {
          set.delete(handler);
        },
      };
    },
    subscriberCount: (topic) => subscribers.get(topic)?.size ?? 0,
  };
}
