/**
 * 日志查询纯函数层（T-P3-154 C1——pideck logQuery.ts 锚：文件枚举按天
 * 收敛避免全量读盘、损坏行跳过、过滤先于分页、单文件行数防御上限）。
 * 无 I/O 副作用之外的状态——行缓存由调用方持有（文件指纹增量重读）。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { LOG_LEVELS, levelRank, type LogLevel } from "../kernel/logger.js";

/** 单文件解析行数防御上限（pideck 20 万行同款——防超大文件拖垮查询）。 */
export const LOG_MAX_LINES_PER_FILE = 200_000;

/** 查询页大小上限。 */
export const LOG_MAX_PAGE_SIZE = 200;

/** 通道文件形状：agent/host/ui 三通道 .log（raw 是分片数据不进查看器；
 * 旧命名 aegent-YYYYMMDD.log 映射为 agent 通道——kernel 历史文件兼容）。 */
const CHANNEL_FILE_RE = /^(aegent|agent|host|ui)-(\d{8})\.log$/;

export interface LogFileRef {
  readonly channel: string;
  readonly date: string; // YYYYMMDD
  readonly path: string;
  readonly sizeBytes: number;
}

/** 枚举日志目录下的通道文件（按日期倒序——最新在前）。 */
export function listLogFiles(logDir: string, now: () => Date = () => new Date()): LogFileRef[] {
  let names: string[];
  try {
    names = readdirSync(logDir);
  } catch {
    return []; // 目录不存在 = 还没有任何日志
  }
  const out: LogFileRef[] = [];
  for (const name of names) {
    const m = CHANNEL_FILE_RE.exec(name);
    if (m === null) continue;
    const channel = m[1] === "aegent" ? "agent" : m[1]!;
    const full = join(logDir, name);
    try {
      const st = statSync(full);
      if (!st.isFile()) continue;
      out.push({ channel, date: m[2]!, path: full, sizeBytes: st.size });
    } catch {
      // stat 失败跳过
    }
  }
  out.sort((a, b) => (a.date === b.date ? a.channel.localeCompare(b.channel) : b.date.localeCompare(a.date)));
  void now;
  return out;
}

export interface ParsedLogLine {
  readonly line: string;
  readonly entry: {
    ts: string;
    level: LogLevel;
    channel?: string;
    category?: string;
    msg: string;
    data?: Record<string, unknown>;
  };
}

/** 行解析（损坏行跳过——手工截断/半写行不炸查询）。 */
export function parseLogLine(raw: string, fallbackChannel: string): ParsedLogLine | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof obj["ts"] !== "string" || typeof obj["msg"] !== "string") return null;
    const level = LOG_LEVELS.includes(obj["level"] as LogLevel) ? (obj["level"] as LogLevel) : "info";
    return {
      line: trimmed,
      entry: {
        ts: obj["ts"],
        level,
        ...(typeof obj["channel"] === "string" ? { channel: obj["channel"] } : { channel: fallbackChannel }),
        ...(typeof obj["category"] === "string" ? { category: obj["category"] } : {}),
        msg: obj["msg"],
        ...(obj["data"] !== undefined && typeof obj["data"] === "object" && obj["data"] !== null
          ? { data: obj["data"] as Record<string, unknown> }
          : {}),
      },
    };
  } catch {
    return null;
  }
}

export interface LogQueryFilter {
  /** 最低级别（≥ 语义——info 显示 info/warn/error）；缺省 all。 */
  level?: LogLevel | "";
  /** category 精确匹配；缺省 all。 */
  category?: string;
  /** 关键词子串（msg + data 序列化均参与匹配，大小写不敏感）。 */
  keyword?: string;
  /** 日期（YYYYMMDD）；缺省 = 最近 3 个文件。 */
  date?: string;
  page?: number;
  pageSize?: number;
}

export interface LogQueryResult {
  /** 可用日期清单（倒序——UI 日期下拉数据源）。 */
  readonly dates: { date: string; channels: string[] }[];
  /** 通道清单（facets——category 下拉数据源，按当前日期范围聚合）。 */
  readonly categories: string[];
  /** 命中总数（分页前）。 */
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly rows: ParsedLogLine["entry"][];
  /** 参与查询的文件（体积显示/打开目录锚）。 */
  readonly files: { name: string; channel: string; date: string; sizeBytes: number }[];
}

/** 行缓存（文件指纹增量重读——pideck logLineCache 锚）。 */
export class LogLineCache {
  private readonly cache = new Map<string, { fingerprint: string; lines: ParsedLogLine[] }>();

  read(file: LogFileRef): ParsedLogLine[] {
    let fingerprint = "";
    try {
      const st = statSync(file.path);
      fingerprint = `${st.size}:${st.mtimeMs}`;
    } catch {
      return [];
    }
    const hit = this.cache.get(file.path);
    if (hit !== undefined && hit.fingerprint === fingerprint) return hit.lines;
    let lines: ParsedLogLine[];
    try {
      const text = readFileSync(file.path, "utf8");
      const raw = text.length > 0 && !text.endsWith("\n") ? `${text}\n` : text;
      const split = raw.split("\n").slice(0, -1);
      lines = split
        .slice(-LOG_MAX_LINES_PER_FILE)
        .map((l) => parseLogLine(l, file.channel))
        .filter((l): l is ParsedLogLine => l !== null);
    } catch {
      lines = [];
    }
    // 缓存上限 8 文件（LRU 简化：超限清最旧插入）
    if (this.cache.size >= 8 && !this.cache.has(file.path)) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(file.path, { fingerprint, lines });
    return lines;
  }
}

/** 日志查询（C2 查看器数据面）：枚举 → 日期/通道收敛 → 过滤 → 分页。 */
export function queryLogs(
  logDir: string,
  filter: LogQueryFilter,
  cache: LogLineCache,
  now: () => Date = () => new Date(),
): LogQueryResult {
  const all = listLogFiles(logDir, now);
  const dates = [...new Map(all.map((f) => [f.date, true])).keys()]
    .map((date) => ({ date, channels: [...new Set(all.filter((f) => f.date === date).map((f) => f.channel))] }));
  const minRank = filter.level ? levelRank(filter.level) : -1;
  const keyword = filter.keyword?.trim().toLowerCase() ?? "";
  // 日期收敛：指定日期只查该日；否则最近 3 个文件（防全量读盘）
  const scoped =
    filter.date !== undefined && filter.date !== ""
      ? all.filter((f) => f.date === filter.date)
      : all.slice(0, 3);
  const categories = new Set<string>();
  const matched: ParsedLogLine[] = [];
  for (const file of scoped) {
    for (const parsed of cache.read(file)) {
      if (parsed.entry.category !== undefined) categories.add(parsed.entry.category);
      if (minRank >= 0 && levelRank(parsed.entry.level) < minRank) continue;
      if (filter.category !== undefined && filter.category !== "" && parsed.entry.category !== filter.category) continue;
      if (keyword !== "") {
        const haystack = `${parsed.entry.msg} ${parsed.entry.data !== undefined ? JSON.stringify(parsed.entry.data) : ""}`.toLowerCase();
        if (!haystack.includes(keyword)) continue;
      }
      matched.push(parsed);
    }
  }
  // 最新在前（倒序——排查看最新）
  matched.reverse();
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 10), LOG_MAX_PAGE_SIZE);
  const total = matched.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(filter.page ?? 1, 1), pageCount);
  const rows = matched.slice((page - 1) * pageSize, page * pageSize).map((p) => p.entry);
  return {
    dates,
    categories: [...categories].sort(),
    total,
    page,
    pageSize,
    rows,
    files: scoped.map((f) => ({ name: f.path.split(/[\\/]/).pop() ?? f.path, channel: f.channel, date: f.date, sizeBytes: f.sizeBytes })),
  };
}
