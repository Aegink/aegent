/**
 * 日志中心域 ops（T-P3-154——settings-gateway 行数纪律拆分位，同
 * tryTransferSettingsOp 模式）：log-report（UI 错误上送）/ log-query（页内
 * 查看器数据面）/ log-open-dir（打开日志目录）/ log-export（诊断包 zip，
 * 逐行脱敏——pideck LogBundleExporter 纪律：detail/分片原文绝不外发）。
 * 通道 logger 池在此（host/agent/ui 各一——文件 <logDir>/<channel>-日期.log）；
 * settings.logging 变更经 reconfigureLogging 热更（级别/目录/保留期）。
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildStoreZip, type PackedFile } from "./plugins-pack.js";
import { collectRuntimeDoctorFacts, doctorReportToJson, runRuntimeDoctorChecks } from "../diagnostics/doctor.js";
import { cleanExpiredLogs, createLogger, LOG_LEVELS, type LogLevel, type Logger } from "../kernel/logger.js";
import { LogLineCache, queryLogs, type LogQueryFilter } from "./log-query.js";
import type { SettingsCall } from "./protocol-settings.js";
import type { SettingsGateway } from "./settings-gateway-types.js";
import { tryAboutSettingsOp } from "./about-ops.js";

/** 日志目录缺省位（B4——<dataDir>/logs，settings.logging.logDir 可改）。 */
export function defaultLogDir(home: string = homedir()): string {
  return join(home, ".aegent", "logs");
}

// —— 通道 logger 池（级别/目录/保留期热更面） ——

interface ChannelState {
  logger: Logger;
  logDir: string;
  retentionDays: number;
}

const channels = new Map<string, ChannelState>();
const lineCache = new LogLineCache();

function parseLevel(value: unknown, fallback: LogLevel): LogLevel {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value) ? (value as LogLevel) : fallback;
}

function retentionOf(value: unknown): number {
  const n = typeof value === "number" ? Math.floor(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 14;
}

/** 通道 logger（懒建+目录变更重建；缺省目录 = <home>/.aegent/logs）。 */
export function channelLogger(
  channel: "host" | "agent" | "ui",
  opts: { level?: LogLevel; logDir?: string; retentionDays?: number; home?: string } = {},
): Logger {
  const logDir = opts.logDir ?? defaultLogDir(opts.home);
  const retentionDays = opts.retentionDays ?? 14;
  const current = channels.get(channel);
  if (current !== undefined && current.logDir === logDir && current.retentionDays === retentionDays) {
    if (opts.level !== undefined) current.logger.setLevel(opts.level);
    return current.logger;
  }
  const logger = createLogger({
    logDir,
    channel,
    level: opts.level ?? current?.logger.getLevel() ?? "info",
    retentionDays,
  });
  channels.set(channel, { logger, logDir, retentionDays });
  return logger;
}

/** 当前日志目录（host 通道池投影——about/诊断面共用）。 */
export function currentLogDir(): string {
  return channels.get("host")?.logDir ?? defaultLogDir();
}

/** settings.logging 变更热更（gateway.update 落盘后调——E1 级别/目录/保留期）。 */
export function reconfigureLogging(logging: { level?: unknown; retentionDays?: unknown; logDir?: unknown } | undefined, home?: string): void {
  const level = parseLevel(logging?.level, "info");
  const retentionDays = retentionOf(logging?.retentionDays);
  const logDir = typeof logging?.logDir === "string" && logging.logDir.trim() !== "" ? logging.logDir : undefined;
  channelLogger("host", { level, logDir, retentionDays, home });
  channelLogger("ui", { level, logDir, retentionDays, home });
  // agent 通道级别跟 settings（子进程自身日志由 child 侧管理）
  channelLogger("agent", { level, logDir, retentionDays, home });
  if (logDir !== undefined && retentionDays > 0) cleanExpiredLogs(logDir, retentionDays);
}

// —— log-report：UI 错误上送落 ui-YYYYMMDD.log（zcode renderer 桥接锚） ——

export interface ReportedError {
  ts?: string;
  level?: string;
  message?: string;
  stack?: string;
  source?: string;
}

const REPORT_MAX_ENTRIES = 50;
const REPORT_FIELD_MAX = 2048;

function clip(value: unknown, max: number = REPORT_FIELD_MAX): string {
  const s = typeof value === "string" ? value : String(value ?? "");
  return s.length > max ? `${s.slice(0, max)}…（截断）` : s;
}

export function logReportOp(
  logDir: string,
  entries: ReportedError[],
  opts: { level?: LogLevel; retentionDays?: number; home?: string } = {},
): { recorded: number } {
  const logger = channelLogger("ui", { ...opts, logDir });
  let recorded = 0;
  for (const e of entries.slice(0, REPORT_MAX_ENTRIES)) {
    if (e === null || typeof e !== "object") continue;
    const message = clip(e.message ?? "（无消息）", 1024);
    const level = parseLevel(e.level, "error");
    const data = {
      ...(e.source !== undefined ? { source: clip(e.source, 256) } : {}),
      ...(e.stack !== undefined ? { stack: clip(e.stack) } : {}),
    };
    if (level === "debug") logger.debug(message, data);
    else if (level === "info") logger.info(message, data);
    else if (level === "warn") logger.warn(message, data);
    else logger.error(message, data);
    recorded += 1;
  }
  return { recorded };
}

// —— log-query：查看器数据面（C1） ——

export function logQueryOp(logDir: string, payload: LogQueryFilter): unknown {
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  return queryLogs(logDir, payload, lineCache);
}

// —— log-open-dir：打开日志目录（C3——pi-desktop SettingsPage 锚） ——

export function logOpenDirOp(logDir: string): { done: true } {
  const dir = existsSync(logDir) ? logDir : (mkdirSync(logDir, { recursive: true }), logDir);
  if (process.platform === "win32") {
    spawn("explorer", [dir], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [dir], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [dir], { detached: true, stdio: "ignore" }).unref();
  }
  return { done: true };
}

// —— log-export：诊断包（D1——zip：doctor 报告+近 N 天通道日志逐行脱敏） ——

const EXPORT_MAX_FILE_BYTES = 8 * 1024 * 1024;
const EXPORT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;

/** 诊断包逐行脱敏：只留 ts/level/channel/category/msg——data 可能含路径/
 * 请求体/用户内容，绝不外发（pideck LogBundleExporter :33-38 纪律锚）。 */
function exportRedactFile(path: string): PackedFile | null {
  try {
    const st = statSync(path);
    if (st.size > EXPORT_MAX_FILE_BYTES) return null; // 超限文件整份跳过（尾部截断记档 P2）
    const text = readFileSync(path, "utf8");
    const out: string[] = [];
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line === "") continue;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        out.push(
          JSON.stringify({
            ts: obj["ts"],
            level: obj["level"],
            ...(typeof obj["channel"] === "string" ? { channel: obj["channel"] } : {}),
            ...(typeof obj["category"] === "string" ? { category: obj["category"] } : {}),
            msg: obj["msg"],
          }),
        );
      } catch {
        // 损坏行跳过（不外发半写行）
      }
    }
    return { name: path.split(/[\\/]/).pop() ?? path, data: Buffer.from(`${out.join("\n")}\n`, "utf8") };
  } catch {
    return null;
  }
}

export function logExportOp(
  logDir: string,
  opts: { retentionDays?: number; level?: LogLevel; home?: string } = {},
): { filename: string; base64: string; files: number; totalBytes: number } {
  const keepDays = retentionOf(opts.retentionDays);
  const doctor = runRuntimeDoctorChecks(collectRuntimeDoctorFacts());
  const packed: PackedFile[] = [
    {
      name: "doctor.json",
      data: Buffer.from(doctorReportToJson(doctor as never), "utf8"),
    },
    {
      name: "manifest.json",
      data: Buffer.from(
        JSON.stringify(
          { kind: "aegent-log-export", exportedAt: new Date().toISOString(), retentionDays: keepDays, note: "日志已逐行脱敏（只留 ts/level/channel/category/msg）——分片原文与 data 字段不含在内" },
          null,
          2,
        ),
        "utf8",
      ),
    },
  ];
  let totalBytes = 0;
  try {
    for (const name of readdirSync(logDir)) {
      // raw 分片不进诊断包（token 级原文——隐私红线）
      if (!/^(aegent|agent|host|ui)-\d{8}\.log$/.test(name)) continue;
      if (totalBytes > EXPORT_MAX_TOTAL_BYTES) break;
      const red = exportRedactFile(join(logDir, name));
      if (red === null) continue;
      totalBytes += red.data.length;
      packed.push(red);
    }
  } catch {
    // 目录不存在 = 只有 doctor 报告
  }
  const zip = buildStoreZip(packed);
  mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replaceAll("-", "").replace("T", "-").replaceAll(":", "");
  const filename = `aegent-diagnostics-${stamp}.zip`;
  return { filename, base64: zip.toString("base64"), files: packed.length, totalBytes: zip.length };
}

// —— 分发（bridge 一行收敛面） ——

export function tryLoggingSettingsOp(gateway: SettingsGateway, call: SettingsCall): unknown {
  if (
    call.op !== "log-report" &&
    call.op !== "log-query" &&
    call.op !== "log-open-dir" &&
    call.op !== "log-export"
  ) {
    return tryAboutSettingsOp(gateway, call); // T-P3-155：非日志族 → 关于中心族兜底
  }
  const settingsSync = (): { logDir: string; level: LogLevel; retentionDays: number } => {
    void gateway;
    // 日志设置经 reconfigureLogging 热更进通道池——这里只取当前目录
    const host = channels.get("host");
    return {
      logDir: host?.logDir ?? defaultLogDir(),
      level: host?.logger.getLevel() ?? "info",
      retentionDays: host?.retentionDays ?? 14,
    };
  };
  const state = settingsSync();
  switch (call.op) {
    case "log-report":
      return logReportOp(state.logDir, call.entries ?? [], { level: state.level, retentionDays: state.retentionDays });
    case "log-query":
      return logQueryOp(state.logDir, call.log ?? {});
    case "log-open-dir":
      return logOpenDirOp(state.logDir);
    case "log-export":
      return logExportOp(state.logDir, { retentionDays: state.retentionDays, level: state.level });
    default:
      return tryAboutSettingsOp(gateway, call); // T-P3-155 关于中心族 fallback（链尾）
  }
}

/** agent 子进程 stderr 行归管（A4——级别按行面推断，pi-desktop levelForChild 锚）。 */
export function agentStderrSink(): (line: string) => void {
  return (line: string) => {
    const lower = line.toLowerCase();
    const logger = channelLogger("agent");
    if (lower.includes("error")) logger.error(line, { source: "child-stderr" });
    else if (lower.includes("warn")) logger.warn(line, { source: "child-stderr" });
    else logger.info(line, { source: "child-stderr" });
  };
}

