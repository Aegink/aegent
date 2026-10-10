/**
 * 会话导出（E8，T-P1-97）——导出/索引/兼容三分中的**导出面**。
 *
 * 取 kimi·sessionExport 的语义："导出是自包含快照物"——单 JSON 文件含
 * 全事件流与元数据，脱离库可读（纯 JSON.parse → renderTranscript 可直接
 * 消费，E7 联动）。不抄其 zip/wire-scan 打包管线（YAGNI）。
 *
 * 三分纪律（E8 验收："迁移时三者不互相污染"）：本模块不 import 索引面
 * （session-index.ts），索引面不 import 本模块，兼容面（migrate.ts 迁移链）
 * 独立——grep 证伪在测试。导出物带独立 formatVersion 声明（当前恒等库
 * CURRENT_SCHEMA_VERSION；未来导出格式演进可先于库版本——记档）。
 */

import { CURRENT_SCHEMA_VERSION } from "./db.js";
import type { SessionEvent } from "../core/index.js";
import type { SessionStore } from "./store.js";

export interface SessionExport {
  /** 自包含快照的格式声明（消费者据此解析）。 */
  kind: "aegent-session-export";
  /** 导出时的库格式版本（前向兼容锚点）。 */
  formatVersion: number;
  exportedAt: number;
  sessionId: string;
  eventCount: number;
  /** 全事件流（逐字节原事件——seq/ts/载荷完整保留）。 */
  events: readonly SessionEvent[];
}

/** 导出一个会话为自包含快照（纯读取面——不改库不改流）。 */
export function exportSession(
  store: SessionStore,
  sessionId: string,
  options: { now?: () => number } = {},
): SessionExport {
  const events = store.load(sessionId);
  return {
    kind: "aegent-session-export",
    formatVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: (options.now ?? (() => Date.now()))(),
    sessionId,
    eventCount: events.length,
    events,
  };
}

/** 解析导出物（脱离库的读取面——字符串或已解析对象）。 */
export function parseSessionExport(raw: string | unknown): SessionExport {
  const data = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (
    typeof data !== "object" ||
    data === null ||
    (data as { kind?: unknown }).kind !== "aegent-session-export"
  ) {
    throw new Error("不是 aegent 会话导出物（缺少 kind 声明）");
  }
  return data as SessionExport;
}
