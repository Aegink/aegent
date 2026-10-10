/**
 * 遥测端口（T2-5 / §22，纯类型不接线——pi 日志端口形状；三实现
 * noop 缺省 / memory 测试 / OTLP exporter 外置插件（EP-11/T9-6）。
 * OTLP 放内核会违背"轻"——必须外置（最优评估 §22）。
 */

export type TelemetryLevel = "debug" | "info" | "warn" | "error";

/** 遥测事件（结构化——与用户可见日志流去重；trace 关联字段随 T9-6 接入）。 */
export interface TelemetryEvent {
  level: TelemetryLevel;
  message: string;
  /** 结构化字段（JSON 安全——遥测面不做运行时对象序列化）。 */
  fields?: Record<string, string | number | boolean>;
  /** trace 关联 id（zcode formatLogPrefix 同款——跨进程/跨会话串链）。 */
  traceId?: string;
  /** 产生源（域/模块名——归因用）。 */
  source?: string;
}

/** 遥测汇端口（fire-and-forget——遥测失败不反压业务路径）。 */
export interface TelemetrySink {
  record(event: TelemetryEvent): void;
}
