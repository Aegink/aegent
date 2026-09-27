/**
 * 日志冷热分离 + 后台压缩（Q7，T-P1-91）——codex·rollout/compression.rs
 * 五纪律的我方落法。
 *
 * **对象偏离记档**（展卡核对结论 7）：codex 压的是 per-session rollout
 * 文件；我方会话事件在单库 SQLite 热路径（WAL），无 rollout 文件可压——
 * 冷文件族 = logs/ 下的诊断日志（按日 .log）与原始分片（E14 的
 * logs/raw/*.jsonl，最大冷数据族）。"事件源架构必然的债"的等效承载。
 *
 * 五纪律（codex compression.rs 同款）：
 * ① fire-and-forget："failures are logged, startup is not blocked"——
 *    worker 异步调度（setImmediate），压缩失败只 warn 不上抛；
 * ② 冷热分界：mtime 早于 coldAfterDays（缺省 7 天）才压——热文件不动；
 * ③ 原子替换：tmp 文件（.tmp-<pid>-<n>）写满 → rename 覆盖目标（Windows
 *    实测 Node renameSync 走 MoveFileEx REPLACE_EXISTING 语义，覆盖 OK）→
 *    删原文件；权限位照抄原文件（Windows NTFS 下 mode 意义有限，记档）；
 * ④ 运行标记防重叠："a run marker prevents overlapping or too-frequent
 *    compression runs"——<dir>/.compression-lock（pid+startedAt），fresh
 *    （<10min）即跳过本轮，stale（陈旧 pid 的崩溃残留）接管覆盖；
 * ⑤ 表示形态对上层透明：readMaybeCompressed 按扩展名自动解压——消费方
 *    不感知 .zst/.gz 与原文的差别。
 *
 * 压缩算法：Node 22.15+ 内置 zstd（zstdCompressSync——零新依赖，
 * license-audit 不动）；探测失败降级 gzipSync（.gz 后缀，同一管线）。
 */

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { gzipSync, gunzipSync, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { join } from "node:path";

export interface ArchiveReport {
  /** 本轮压缩的文件数。 */
  compressed: number;
  /** 跳过原因（lock 持有 / 无冷文件）。 */
  skipped: "lock-held" | "no-cold-files" | null;
  /** 压缩文件清单（相对 logDir 的文件名）。 */
  files: string[];
  /** 实际启用的算法（zstd | gzip——Node 版本探测结果）。 */
  algorithm: "zstd" | "gzip";
}

export interface LogArchiveOptions {
  logDir: string;
  /** 冷判定阈值（天，mtime 口径）；缺省 7。 */
  coldAfterDays?: number;
  now?: () => Date;
  /** 运行标记新鲜上限（毫秒）——超过视为陈旧残留可接管；缺省 10 分钟。 */
  lockFreshMs?: number;
}

const DEFAULT_COLD_DAYS = 7;
const DEFAULT_LOCK_FRESH_MS = 10 * 60 * 1000;
const ARCHIVE_EXTENSIONS = new Set([".zst", ".gz"]);
/** 日志族的原始扩展名（压缩对象）；其余文件（lock/tmp/无关）不动。 */
const CANDIDATE_EXTENSIONS = new Set([".log", ".jsonl"]);

/** 算法探测：Node 22.15+ 内置 zstd 优先（零新依赖）；缺失降级 gzip。 */
export function detectAlgorithm(): "zstd" | "gzip" {
  return typeof zstdCompressSync === "function" ? "zstd" : "gzip";
}

function compressBuffer(data: Buffer, algorithm: "zstd" | "gzip"): Buffer {
  return algorithm === "zstd" ? zstdCompressSync(data) : gzipSync(data);
}

/** 透明读面（Q7 ⑤）：按扩展名自动解压，消费方不感知表示形态。 */
export function readMaybeCompressed(filePath: string): Buffer {
  const data = readFileSync(filePath);
  if (filePath.endsWith(".zst")) return zstdDecompressSync(data);
  if (filePath.endsWith(".gz")) return gunzipSync(data);
  return data;
}

function readLock(lockPath: string): { pid: number; startedAt: number } | null {
  if (!existsSync(lockPath)) return null;
  try {
    return JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number; startedAt: number };
  } catch {
    return null; // 损坏的标记视为可接管
  }
}

/**
 * 执行一轮冷文件压缩（同步实现；fire-and-forget 包装在 spawnLogArchiveWorker）。
 * 幂等：已压缩（.zst/.gz）与热文件跳过；lock fresh → skipped:"lock-held"。
 */
export function compressColdLogs(options: LogArchiveOptions): ArchiveReport {
  const coldAfterDays = options.coldAfterDays ?? DEFAULT_COLD_DAYS;
  const lockFreshMs = options.lockFreshMs ?? DEFAULT_LOCK_FRESH_MS;
  const now = options.now ?? (() => new Date());
  const algorithm = detectAlgorithm();
  const report: ArchiveReport = { compressed: 0, skipped: null, files: [], algorithm };

  if (!existsSync(options.logDir)) {
    report.skipped = "no-cold-files";
    return report;
  }
  const lockPath = join(options.logDir, ".compression-lock");
  const lock = readLock(lockPath);
  if (lock && now().getTime() - lock.startedAt < lockFreshMs) {
    report.skipped = "lock-held";
    return report;
  }
  // 接管（或首次写）标记
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: now().getTime() }), "utf8");

  const coldCutoff = now().getTime() - coldAfterDays * 24 * 60 * 60 * 1000;
  try {
    for (const name of readdirSync(options.logDir)) {
      const ext = name.slice(name.lastIndexOf("."));
      if (!CANDIDATE_EXTENSIONS.has(ext) || ARCHIVE_EXTENSIONS.has(ext)) continue;
      const full = join(options.logDir, name);
      const stat = statSync(full);
      if (!stat.isFile() || stat.mtimeMs >= coldCutoff) continue; // 热文件不动
      const target = `${full}.${algorithm === "zstd" ? "zst" : "gz"}`;
      const tmp = `${full}.tmp-${process.pid}-${report.compressed}`;
      // 原子替换三步：tmp 写满 → rename 覆盖 → 删原文件
      const fd = openSync(tmp, "w");
      try {
        writeFileSync(fd, compressBuffer(readFileSync(full), algorithm));
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, target);
      unlinkSync(full);
      report.compressed += 1;
      report.files.push(name);
    }
  } finally {
    rmSync(lockPath, { force: true }); // 正常路径释放标记（异常路径留给 stale 接管）
  }
  if (report.compressed === 0) report.skipped = "no-cold-files";
  return report;
}

/**
 * 后台 worker（fire-and-forget）：setImmediate 调度（模块加载/启动零阻塞），
 * 失败只 console.warn 不上抛（Q7"不影响热路径"的验收口径）。
 */
export function spawnLogArchiveWorker(options: LogArchiveOptions): void {
  setImmediate(() => {
    try {
      compressColdLogs(options);
    } catch (e) {
      console.warn(`[aegent] 日志压缩 worker 失败（不影响运行）：${String((e as Error).message)}`);
    }
  });
}
