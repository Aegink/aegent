/**
 * 单出口 logger（T-6-05 · D9 → T-P3-154 日志中心 A 域升级）——内核日志的
 * 唯一通道，落盘前过 redact 管道：
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
 * T-P3-154 升级（「日志中心」A/B 域——pideck 按天文件+zcode 保留清理+
 * pi-desktop channel/category 锚）：
 * - **通道（channel）**：文件级分类，文件名 `<channel>-YYYYMMDD.log`——
 *   host/agent/ui/raw 四通道各落各文件；缺省 "aegent"（kernel 侧行为与
 *   旧文件名零破坏——查看器读面把 aegent- 归为 agent 通道）。
 * - **category**：行级分类（调用方给的域标签，如 transfer/mcp/provider）。
 * - **级别过滤**：options.level（缺省 "debug"=全过——kernel 侧行为不变；
 *   host 侧缺省 info 经 setLevel 热更）。
 * - **保留清理**：retentionDays（缺省 14，0=永久）——每自然日首次写入时
 *   顺带清理过期按日文件（zcode logRetention 锚：写入路径顺带做，绝不
 *   阻塞调用方；清理失败只告警）。
 * - **软上限**：单日单文件累计 64MB 告警一次（不截断——排查完整性优先）。
 */

import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
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
  /** 通道（文件级分类——host/agent/ui；缺省 aegent 不落字段——旧行兼容）。 */
  readonly channel?: string;
  /** 行级分类（调用方域标签——transfer/mcp/provider/...）。 */
  readonly category?: string;
  readonly msg: string;
  readonly data?: Record<string, unknown>;
}

export interface LogSink {
  /** 落一行（已序列化、已脱敏）。实现方自行容错。 */
  write(line: string): void;
}

/** 级别序（level 过滤语义：低于 minLevel 的行丢弃）。 */
export function levelRank(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level);
}

export interface LoggerOptions {
  /** 日志目录（缺省 "logs"，相对 cwd；文件名按日 <channel>-YYYYMMDD.log）。 */
  readonly logDir?: string;
  /** 用户原文脱敏开关（D9"可配开关"；缺省 true = 隐私默认开）。 */
  readonly redactUserContent?: boolean;
  /** 注入面（测试/替代后端）；缺省按日文件 sink。 */
  readonly sink?: LogSink;
  /** 注入钟（测试断言时间戳）。 */
  readonly clock?: () => Date;
  /** 通道名（文件前缀+行字段；缺省 "aegent"——kernel 侧行为零破坏）。 */
  readonly channel?: string;
  /** 行级分类（本 logger 实例的固定 category——缺省不落字段）。 */
  readonly category?: string;
  /** 最低级别（低于此级别的行丢弃；缺省 "debug"=全过）。 */
  readonly level?: LogLevel;
  /** 保留天数（缺省 14；0 = 永久不清理——zcode logRetention 同款语义）。 */
  readonly retentionDays?: number;
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

/** 单日文件软上限（字节）——超过只告警一次不截断（排查完整性优先）。 */
export const LOG_DAILY_SOFT_LIMIT = 64 * 1024 * 1024;

/** 过期按日文件清理（T-P3-154 B2——zcode logRetention 锚）：只认
 * `<前缀>-YYYYMMDD.log|jsonl` 形状；keepDays=0 跳过；失败整体静默
 * （清理是顺带面，绝不阻塞写入）。 */
export function cleanExpiredLogs(logDir: string, keepDays: number, now: () => Date = () => new Date()): number {
  if (!Number.isFinite(keepDays) || keepDays <= 0) return 0;
  let removed = 0;
  try {
    const cutoff = now().getTime() - keepDays * 86_400_000;
    for (const name of readdirSync(logDir)) {
      const m = /^(?:[A-Za-z][A-Za-z0-9_-]*)-(\d{8})\.(?:log|jsonl)$/.exec(name);
      if (m === null) continue;
      const d = m[1]!;
      const ts = Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T23:59:59Z`);
      if (Number.isFinite(ts) && ts < cutoff) {
        try {
          unlinkSync(path.join(logDir, name));
          removed += 1;
        } catch {
          // 单文件失败不中断清理
        }
      }
    }
  } catch {
    // 目录不存在等——静默
  }
  return removed;
}

function defaultSink(
  logDir: string,
  now: () => Date,
  channel: string,
  retentionDays: number,
): LogSink {
  // 失败只降级告警一次（防 stderr 刷屏），绝不向上抛——日志是旁路通道
  let warned = false;
  let cleanupDay = "";
  let dailyBytes = 0;
  let dailyFile = "";
  let softLimitWarned = false;
  return {
    write(line: string): void {
      try {
        mkdirSync(logDir, { recursive: true });
        // 按天分文件的日期与 ts 同源（注入 clock 时文件名跟着走——否则
        // 注入时钟下测试的落盘文件名不受控，跨日即 flaky）
        const day = now().toISOString().slice(0, 10).replaceAll("-", "");
        // 每自然日首次写入顺带清理过期文件（retentionDays=0 永久跳过）
        if (cleanupDay !== day) {
          cleanupDay = day;
          cleanExpiredLogs(logDir, retentionDays, now);
        }
        if (dailyFile !== `${channel}-${day}`) {
          dailyFile = `${channel}-${day}`;
          dailyBytes = 0;
          softLimitWarned = false;
        }
        const file = path.join(logDir, `${channel}-${day}.log`);
        dailyBytes += line.length + 1;
        if (dailyBytes > LOG_DAILY_SOFT_LIMIT && !softLimitWarned) {
          softLimitWarned = true;
          console.error(`[aegent] 日志软上限：${file} 今日已超 ${Math.round(LOG_DAILY_SOFT_LIMIT / 1024 / 1024)}MB（不截断——建议检查 debug 级是否误开）`);
        }
        appendFileSync(file, `${line}\n`, "utf8");
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
  /** 级别热更（T-P3-154 E1——host 侧设置面板动态收紧/放宽）。 */
  setLevel(level: LogLevel): void;
  /** 当前生效级别（设置面回显/健康自暴露——qwen getStatus 锚）。 */
  getLevel(): LogLevel;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const now = options.clock ?? (() => new Date());
  const channel = options.channel ?? "aegent";
  const category = options.category;
  const sink = options.sink ?? defaultSink(options.logDir ?? "logs", now, channel, options.retentionDays ?? 14);
  const redactUser = options.redactUserContent ?? true;
  let minLevel = options.level ?? "debug";
  const write = (level: LogLevel, msg: string, data?: Record<string, unknown>): void => {
    if (levelRank(level) < levelRank(minLevel)) return;
    const entry: LogEntry = {
      ts: now().toISOString(),
      level,
      ...(channel !== "aegent" ? { channel } : {}),
      ...(category !== undefined ? { category } : {}),
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
    setLevel: (level) => {
      minLevel = level;
    },
    getLevel: () => minLevel,
  };
}
