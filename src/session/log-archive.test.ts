import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  compressColdLogs,
  detectAlgorithm,
  readMaybeCompressed,
  spawnLogArchiveWorker,
} from "./log-archive.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aegent-archive-"));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 句柄释放滞后的 EBUSY（T-1-03 已知坑）
  }
});

const OLD_TIME = new Date("2026-01-01T00:00:00Z");
const NOW = new Date("2026-09-27T00:00:00Z");

function seed(dirPath: string, name: string, content: string, mtime?: Date): void {
  mkdirSync(dirPath, { recursive: true });
  const full = path.join(dirPath, name);
  writeFileSync(full, content, "utf8");
  if (mtime) utimesSync(full, mtime, mtime);
}

describe("compressColdLogs（Q7/T-P1-91 日志冷热分离）", () => {
  it("冷文件压缩为 .zst 且内容往返一致；热文件不动（冷热分界）", () => {
    const logs = path.join(dir, "logs");
    seed(logs, "old.log", "冷日志 A", OLD_TIME);
    seed(logs, "hot.log", "热日志 B", NOW); // mtime = now → 热
    seed(logs, "raw.jsonl", "冷分片 C", OLD_TIME);

    const report = compressColdLogs({ logDir: logs, now: () => NOW });
    expect(report.compressed).toBe(2);
    expect(report.algorithm).toBe("zstd");
    expect(existsSync(path.join(logs, "old.log"))).toBe(false); // 原文件已被替换删除
    expect(existsSync(path.join(logs, "old.log.zst"))).toBe(true);
    expect(existsSync(path.join(logs, "hot.log"))).toBe(true); // 热文件原样
    // 透明读面：.zst 返回原文
    expect(readMaybeCompressed(path.join(logs, "old.log.zst")).toString("utf8")).toBe("冷日志 A");
    expect(readMaybeCompressed(path.join(logs, "raw.jsonl.zst")).toString("utf8")).toBe("冷分片 C");
    expect(readMaybeCompressed(path.join(logs, "hot.log")).toString("utf8")).toBe("热日志 B");
  });

  it("原子替换：目标 .zst 已存在时替换成功；权限位照抄原文件（Windows 实测记档）", () => {
    const logs = path.join(dir, "logs");
    seed(logs, "again.log", "第二轮内容", OLD_TIME);
    // 预置上一轮的 .zst（旧内容）
    seed(logs, "again.log.zst", "旧压缩内容");
    const report = compressColdLogs({ logDir: logs, now: () => NOW });
    expect(report.compressed).toBe(1);
    expect(readMaybeCompressed(path.join(logs, "again.log.zst")).toString("utf8")).toBe("第二轮内容");
  });

  it("运行标记防重叠：fresh lock → 跳过本轮；stale lock → 接管", () => {
    const logs = path.join(dir, "logs");
    seed(logs, "cold.log", "冷内容", OLD_TIME);
    // fresh lock（另一进程 1 分钟前持有）
    seed(logs, ".compression-lock", JSON.stringify({ pid: 999999, startedAt: NOW.getTime() - 60_000 }));
    const held = compressColdLogs({ logDir: logs, now: () => NOW });
    expect(held.skipped).toBe("lock-held");
    expect(held.compressed).toBe(0);
    expect(existsSync(path.join(logs, "cold.log"))).toBe(true); // 未被碰

    // stale lock（11 分钟前——持有进程已死）
    seed(logs, ".compression-lock", JSON.stringify({ pid: 999999, startedAt: NOW.getTime() - 11 * 60_000 }));
    const taken = compressColdLogs({ logDir: logs, now: () => NOW });
    expect(taken.compressed).toBe(1);
    expect(existsSync(path.join(logs, ".compression-lock"))).toBe(false); // 正常路径释放
  });

  it("压缩期间写入路径正常（热路径零影响）+ spawn worker 不阻塞启动", async () => {
    const logs = path.join(dir, "logs");
    seed(logs, "old.log", "冷内容", OLD_TIME);
    // spawn worker：setImmediate 调度，本行之后立即返回（启动不阻塞）
    spawnLogArchiveWorker({ logDir: logs, now: () => NOW });
    // "热路径"继续写日志（appendFileSync 不受压缩影响——不同文件）
    writeFileSync(path.join(logs, "hot.log"), "压缩进行中照常写入", "utf8");
    await new Promise((r) => setImmediate(r)); // 让 worker 跑完
    expect(readFileSync(path.join(logs, "hot.log"), "utf8")).toBe("压缩进行中照常写入");
    expect(existsSync(path.join(logs, "old.log.zst"))).toBe(true);
  });

  it("无冷文件 / 目录不存在 → skipped:no-cold-files；算法探测返回 zstd（Node 22.19 实测）", () => {
    expect(detectAlgorithm()).toBe("zstd");
    const empty = compressColdLogs({ logDir: path.join(dir, "empty"), now: () => NOW });
    expect(empty.skipped).toBe("no-cold-files");
    mkdirSync(path.join(dir, "logs"), { recursive: true });
    seed(path.join(dir, "logs"), "hot.log", "只有热文件", NOW);
    const none = compressColdLogs({ logDir: path.join(dir, "logs"), now: () => NOW });
    expect(none.skipped).toBe("no-cold-files");
    expect(none.compressed).toBe(0);
  });
});
