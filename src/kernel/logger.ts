/**
 * 单出口 logger（T-6-05 · D9，自研）——内核日志的唯一通道，落盘前过
 * redact 管道：
 *   1. **密钥正则**（恒开）：`sk-` 形态的 API key（含 sk-proj- 连字符变体）
 *      整段替换为 [REDACTED:api-key]——卡面验收的证伪模式是
 *      sk-[A-Za-z0-9]{20,}，本管道用更宽的字符集（多盖住连字符变体），
 *      掩码后必然不匹配证伪模式；
 *   2. **用户原文开关**（redactUserContent，缺省 true——隐私默认开）：
 *      data 里约定字段名 `userContent` 的值整段替换为
 *      [REDACTED:user-content]。约定：用户 prompt 原文只允许经该字段进
 *      日志（放进 msg 属调用方违规，管道无法识别任意文本里的"原文"）。
 *
 * 事件持久化通道不受本卡管辖（T-1-01 的 assertJsonSafe 已有 JSON 安全
 * 校验；用户消息本体必须落事件流——D9 管的是日志这个旁路通道）。
 *
 * 落盘形状：logDir 下按日一文件（aegent-YYYYMMDD.log），每行一个 JSON
 * 对象（ts/level/msg/data）。写失败不致命（日志失败不能带崩 agent）——
 * 吞错并降级到 stderr 一次性告警。接线在 T-8（L1/L3 可观测）。
 */

import { appendFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export const LOG_LEVELS: readonly LogLevel[] = Object.freeze([
  "debug",
  "info",
  "warn",
  "error",
] as const);

/** 密钥形态：sk- 前缀 + ≥20 位字母数字（允许连字符变体如 sk-proj-…）。 */
const SECRET_PATTERN = /sk-[A-Za-z0-9][A-Za-z0-9-]{19,}/g;

const SECRET_MASK = "[REDACTED:api-key]";
const USER_CONTENT_MASK = "[REDACTED:user-content]";

/** 用户原文约定字段名（D9 开关作用面）。 */
export const USER_CONTENT_FIELDS: readonly string[] = Object.freeze(["userContent"] as const);

export interface LogEntry {
  readonly ts: string;
  readonly level: LogLevel;
  readonly msg: string;
  readonly data?: Record<string, unknown>;
}

export interface LogSink {
  /** 落一行（已序列化、已脱敏）。实现方自行容错。 */
  write(line: string): void;
}

export interface LoggerOptions {
  /** 日志目录（缺省 "logs"，相对 cwd；文件名按日 aegent-YYYYMMDD.log）。 */
  readonly logDir?: string;
  /** 用户原文脱敏开关（D9"可配开关"；缺省 true = 隐私默认开）。 */
  readonly redactUserContent?: boolean;
  /** 注入面（测试/替代后端）；缺省按日文件 sink。 */
  readonly sink?: LogSink;
  /** 注入钟（测试断言时间戳）。 */
  readonly clock?: () => Date;
}

/** 密钥脱敏（纯函数）：sk- 形态整段掩码。 */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, SECRET_MASK);
}

/** 用户原文脱敏（纯函数）：约定字段的值整段掩码；开关关=原样返回副本。 */
export function redactUserFields(
  data: Record<string, unknown>,
  redact: boolean,
): Record<string, unknown> {
  if (!redact) return { ...data };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = USER_CONTENT_FIELDS.includes(key) && typeof value === "string" ? USER_CONTENT_MASK : value;
  }
  return out;
}

function defaultSink(logDir: string): LogSink {
  // 失败只降级告警一次（防 stderr 刷屏），绝不向上抛——日志是旁路通道
  let warned = false;
  return {
    write(line: string): void {
      try {
        mkdirSync(logDir, { recursive: true });
        const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
        appendFileSync(path.join(logDir, `aegent-${day}.log`), `${line}\n`, "utf8");
      } catch (e) {
        if (!warned) {
          warned = true;
          console.error(`[aegent] 日志落盘失败（本进程内只告警一次）：${String((e as Error).message)}`);
        }
      }
    },
  };
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const sink = options.sink ?? defaultSink(options.logDir ?? "logs");
  const redactUser = options.redactUserContent ?? true;
  const now = options.clock ?? (() => new Date());
  const write = (level: LogLevel, msg: string, data?: Record<string, unknown>): void => {
    const entry: LogEntry = {
      ts: now().toISOString(),
      level,
      msg,
      ...(data !== undefined ? { data: redactUserFields(data, redactUser) } : {}),
    };
    // 先序列化再过密钥正则：无论 key 藏在 msg 还是 data 的哪一层都掩得到
    sink.write(redactSecrets(JSON.stringify(entry)));
  };
  return {
    debug: (msg, data) => write("debug", msg, data),
    info: (msg, data) => write("info", msg, data),
    warn: (msg, data) => write("warn", msg, data),
    error: (msg, data) => write("error", msg, data),
  };
}
