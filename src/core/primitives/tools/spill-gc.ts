/**
 * spill 文件生命周期（Q3/T-P1-14）——B10 落盘标记（truncate.ts 的 SpillMarker）
 * 的消费端。上游参考 dsh packages/spill 的清理纪律：
 *   - 只认"自己认得的形状"：文件名精确形状（SPILL_FILE_RE，dsh DEFAULT_ROOT_RE
 *     的"EXACT shape not bare prefix"同款）+ 首行标记双重确认，形状不匹配的
 *     外来文件连首行都不读；
 *   - lstat 不跟随符号链接：链接与目录一律跳过，清理永不顺着链接删别人的树；
 *   - 单文件失败收集进报告、绝不中断（清理是 best-effort，永不抛）；
 *   - unlink ENOENT 视作成功（并行清理者已删 = 目标已达成）。
 *
 * 两触发（卡内定形，KISS——超龄触发不做，临时文件随会话亡，超龄留给人工）：
 *   - 会话关闭：sweepSessionSpill——删本会话 deletable="after-session-end" 的
 *     文件（agent-child 退出路径调用，exit 前必须 await——process.exit 会切断
 *     挂起的 unlink）；
 *   - 超量：enforceSpillQuota——own-marker 文件数超上限时最老先删，且只删
 *     自动可删者（registry 在 spill 发生点调用，验收①"不无限堆积"由此成立）。
 */

import { lstat, open, readdir, unlink } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import type { SpillMarker } from "./truncate.js";

/**
 * spill 文件名精确形状（boundedOutput 生成）：spill-<毫秒>-<pid>-<6 位随机>.txt。
 * 前缀式宽松匹配会误伤用户自己的 spill-* 文件——精确到段数与字符集。
 */
export const SPILL_FILE_RE = /^spill-\d+-\d+-[a-z0-9]{6}\.txt$/;

/** registry 超量触发的缺省上限：常量级宽松（1000 个 typical 50KB ≈ 50MB），只防堆积不防正常使用。 */
export const DEFAULT_SPILL_MAX_FILES = 1000;

/** 标记首行的读取上限：标记 JSON 约 200 字节，4KB 是宽裕常数（避免为大文件全文读入）。 */
const MARKER_READ_BYTES = 4096;

/** 一次清理的报告：deleted + kept 覆盖 scanned，errors 是 best-effort 的失败清单。 */
export interface SpillGcReport {
  /** 目录里命中文件名形状的项数。 */
  scanned: number;
  /** 实际已删除（或竞态中已消失）的文件路径。 */
  deleted: string[];
  /** 认得形状但按策略保留的文件路径（manual / 其他会话 / 标记不合法 / 非常规文件）。 */
  kept: string[];
  /** 单文件失败信息（也推给 onWarn；清理绝不因此中断或上抛）。 */
  errors: string[];
}

export interface SpillGcOptions {
  /** 清理失败时的观测口（装配的 logger.warn）；观测口自身抛错被吞——不影响清理。 */
  onWarn?: (message: string) => void;
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

/**
 * 读 spill 文件首行并校验标记：kind 必须是我们的标记类型，其余字段信任文件
 * 自己的声明（文件是我们写的；被篡改的标记最多导致多删/少删一个同名形状
 * 文件，形状 + kind 双门槛已把误伤面压到"用户精确伪造"的主动行为）。
 * 任何读取/解析失败 → undefined（当外来文件处理）。
 */
export async function readSpillMarker(filePath: string): Promise<SpillMarker | undefined> {
  let firstLine: string;
  try {
    const handle = await open(filePath, "r");
    try {
      const { buffer, bytesRead } = await handle.read(
        Buffer.alloc(MARKER_READ_BYTES),
        0,
        MARKER_READ_BYTES,
        0,
      );
      firstLine = buffer.toString("utf8", 0, bytesRead).split("\n", 1)[0] ?? "";
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(firstLine);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const candidate = parsed as Record<string, unknown>;
    if (candidate["kind"] !== "aegent/tool-output-spill") return undefined;
    return candidate as unknown as SpillMarker;
  } catch {
    return undefined;
  }
}

async function lstatSafe(filePath: string): Promise<Stats | undefined> {
  try {
    return await lstat(filePath);
  } catch {
    return undefined;
  }
}

/** 删一个文件：ENOENT = 目标已达成记成功；其余失败收集报告并通知观测口。 */
async function unlinkIdempotent(
  filePath: string,
  report: SpillGcReport,
  onWarn: ((message: string) => void) | undefined,
): Promise<boolean> {
  try {
    await unlink(filePath);
    report.deleted.push(filePath);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      report.deleted.push(filePath);
      return true;
    }
    const message = `spill-gc: 删除失败 ${filePath}: ${String(error)}`;
    report.errors.push(message);
    try {
      onWarn?.(message);
    } catch {
      // 观测口是纯观察回调，自身抛错不影响清理（dsh warnSafely 同款）
    }
    return false;
  }
}

/** 目录项的统一核验：形状命中 + 常规文件 + 标记合法；否则返回 undefined（保留）。 */
async function identifyOwnSpill(
  filePath: string,
): Promise<{ marker: SpillMarker; mtimeMs: number } | undefined> {
  const stats = await lstatSafe(filePath);
  // 符号链接与非常规文件一律跳过——lstat 不跟随，清理不可被链接重定向
  if (stats === undefined || !stats.isFile()) return undefined;
  const marker = await readSpillMarker(filePath);
  if (marker === undefined) return undefined;
  return { marker, mtimeMs: stats.mtimeMs };
}

/**
 * 会话关闭触发：删除 spillDir 下本会话（marker.sessionId === sessionId）且
 * deletable === "after-session-end" 的文件。manual 声明者与其他会话的文件
 * 一律保留。目录不存在是常见路径（本会话从未 spill）而非错误。
 */
export async function sweepSessionSpill(
  spillDir: string,
  sessionId: string,
  options?: SpillGcOptions,
): Promise<SpillGcReport> {
  const report: SpillGcReport = { scanned: 0, deleted: [], kept: [], errors: [] };
  let names: string[];
  try {
    names = await readdir(spillDir);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) {
      const message = `spill-gc: 读取目录失败 ${spillDir}: ${String(error)}`;
      report.errors.push(message);
      try {
        options?.onWarn?.(message);
      } catch {
        // 同 unlinkIdempotent：观测口抛错不影响清理
      }
    }
    return report;
  }
  for (const name of names) {
    // 外来名字（含用户自己的 spill-* 变体）：连首行都不读
    if (!SPILL_FILE_RE.test(name)) continue;
    report.scanned++;
    const filePath = path.join(spillDir, name);
    const own = await identifyOwnSpill(filePath);
    if (own === undefined) {
      report.kept.push(filePath);
      continue;
    }
    const eligible =
      own.marker.sessionId === sessionId &&
      own.marker.deletable === "after-session-end";
    if (!eligible) {
      report.kept.push(filePath);
      continue;
    }
    await unlinkIdempotent(filePath, report, options?.onWarn);
  }
  return report;
}

/**
 * 超量触发：own-marker 文件总数超过 maxFiles 时，按创建时间最老先删，只删
 * deletable === "after-session-end" 者（manual 声明者即使最老也保留——若
 * manual 文件本身就超限，有界性让位于人工保留纪律，报告 errors 之外如实
 * 体现在 kept）。maxFiles 为非有限值（Infinity）时是显式关闭，零动作。
 */
export async function enforceSpillQuota(
  spillDir: string,
  maxFiles: number,
  options?: SpillGcOptions,
): Promise<SpillGcReport> {
  const report: SpillGcReport = { scanned: 0, deleted: [], kept: [], errors: [] };
  if (!Number.isFinite(maxFiles)) return report;
  let names: string[];
  try {
    names = await readdir(spillDir);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) {
      const message = `spill-gc: 读取目录失败 ${spillDir}: ${String(error)}`;
      report.errors.push(message);
      try {
        options?.onWarn?.(message);
      } catch {
        // 同上：观测口抛错不影响清理
      }
    }
    return report;
  }
  interface OwnSpill {
    path: string;
    /** createdAt 的 epoch 毫秒；不可解析时回退文件 mtime。 */
    createdAtMs: number;
    autoDeletable: boolean;
  }
  const own: OwnSpill[] = [];
  for (const name of names) {
    if (!SPILL_FILE_RE.test(name)) continue;
    report.scanned++;
    const filePath = path.join(spillDir, name);
    const identified = await identifyOwnSpill(filePath);
    if (identified === undefined) {
      report.kept.push(filePath);
      continue;
    }
    const parsed = Date.parse(identified.marker.createdAt);
    own.push({
      path: filePath,
      createdAtMs: Number.isNaN(parsed) ? identified.mtimeMs : parsed,
      autoDeletable: identified.marker.deletable === "after-session-end",
    });
  }
  let excess = own.length - maxFiles;
  const evictable = own
    .filter((item) => item.autoDeletable)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);
  for (const candidate of evictable) {
    if (excess <= 0) break;
    const removed = await unlinkIdempotent(candidate.path, report, options?.onWarn);
    // 删除失败（文件仍在）不消耗配额缺口
    if (removed) excess--;
  }
  const deletedSet = new Set(report.deleted);
  for (const item of own) {
    if (!deletedSet.has(item.path)) report.kept.push(item.path);
  }
  return report;
}
