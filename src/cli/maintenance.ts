#!/usr/bin/env node
/**
 * 维护入口（Q4/T-P2-103）——旧数据清理的**显式** CLI 调用点（不做后台
 * 定时：调度面随 15d S1）。
 *
 * 运行：`npm run maintenance -- cleanup --db <path> [--dry-run]`
 *   --db <path>        目标会话库（必填）
 *   --dry-run          只产出清单不执行（人工确认半边）
 *   --audit-days N     审计记录保留天数（缺省 90——Q6 常量）
 *   --keep-runs N      每任务保留的最新运行记录条数（缺省 100——Q6 常量）
 *   --session-days N   会话归档阈值天数（缺省 = audit-days）
 *   --json <path>      结构化报告落盘
 * 退出码：0 = 成功；1 = 执行失败；2 = 参数错误。dry-run 成功同样 exit 0。
 *
 * 可测化（D 级债务清偿）：解析/渲染导出为纯函数，入口经主模块判定
 * （import 本文件做测试不会触发执行流）。
 */

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { cleanupSessions, type CleanupOptions, type CleanupReport } from "../session/cleanup.js";

export interface MaintenanceParsedArgs {
  dbPath: string;
  dryRun: boolean;
  jsonPath?: string;
  overrides: { auditDays?: number; taskRunRecords?: number; sessionRetentionDays?: number };
}

/** 参数解析（fail 参数化——CLI 用 process.exit(2)，测试用断言）。 */
export function parseMaintenanceArgs(
  argv: readonly string[],
  fail: (message: string) => never,
): MaintenanceParsedArgs {
  const usage = (message?: string): never =>
    fail(
      (message !== undefined ? `${message}\n` : "") +
        "用法：maintenance cleanup --db <path> [--dry-run] [--audit-days N] [--keep-runs N] [--session-days N] [--json <path>]",
    );
  const [subcommand, ...rest] = argv;
  if (subcommand !== "cleanup") usage();

  let dbPath: string | undefined;
  let dryRun = false;
  let jsonPath: string | undefined;
  const overrides: MaintenanceParsedArgs["overrides"] = {};

  const parsePositiveInt = (raw: string | undefined, flag: string): number => {
    const value = Number(raw);
    if (raw === undefined || !Number.isInteger(value) || value < 0) {
      fail(`${flag} 需要一个非负整数（收到 ${JSON.stringify(raw)}）`);
    }
    return value;
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    switch (arg) {
      case "--db": {
        dbPath = rest[++i];
        if (dbPath === undefined || dbPath === "") usage();
        break;
      }
      case "--dry-run":
        dryRun = true;
        break;
      case "--audit-days":
        overrides.auditDays = parsePositiveInt(rest[++i], "--audit-days");
        break;
      case "--keep-runs":
        overrides.taskRunRecords = parsePositiveInt(rest[++i], "--keep-runs");
        break;
      case "--session-days":
        overrides.sessionRetentionDays = parsePositiveInt(rest[++i], "--session-days");
        break;
      case "--json": {
        jsonPath = rest[++i];
        if (jsonPath === undefined || jsonPath === "") usage();
        break;
      }
      default:
        usage(`未知参数「${arg}」`);
    }
  }
  if (dbPath === undefined) usage();
  return { dbPath: dbPath!, dryRun, ...(jsonPath !== undefined ? { jsonPath } : {}), overrides };
}

/** 人读报告渲染（dry-run 与执行两形态）。 */
export function renderCleanupReport(report: CleanupReport, dbPath: string): string {
  const lines = [
    `旧数据清理${report.dryRun ? "（dry-run——只算不执行）" : ""}：${dbPath}`,
    `  审计记录：${report.auditRecords} 条超保留（at < ${new Date(report.auditBefore).toISOString()}）`,
    `  任务运行记录：${report.taskRunRecords} 条超保留（每任务留最新 ${report.keepLatestTaskRuns} 条）`,
    `  会话：${report.sessions.length} 个超保留（最后活跃 < ${new Date(report.sessionCutoff).toISOString()}）`,
  ];
  for (const session of report.sessions) {
    lines.push(`    - ${session.sessionId}（最后活跃 ${new Date(session.lastActiveTs).toISOString()}）`);
  }
  if (!report.dryRun) {
    lines.push(`  已归档 ${report.archived.length} 个会话（归档 ≠ 删除——归档档可读）`);
    for (const receipt of report.archived) {
      lines.push(`    - ${receipt.sessionId} → ${receipt.archivePath}（${receipt.eventCount} 事件）`);
    }
  }
  return lines.join("\n");
}

export async function maintenanceMain(
  argv: readonly string[],
  io: Pick<Console, "log" | "error"> = console,
): Promise<void> {
  const fail = (message: string): never => {
    io.error(message);
    process.exit(2);
  };
  const { dbPath, dryRun, jsonPath, overrides } = parseMaintenanceArgs(argv, fail);

  const options: CleanupOptions = {
    dryRun,
    ...(overrides.auditDays !== undefined || overrides.taskRunRecords !== undefined
      ? {
          policy: {
            ...(overrides.auditDays !== undefined ? { auditDays: overrides.auditDays } : {}),
            ...(overrides.taskRunRecords !== undefined
              ? { taskRunRecords: overrides.taskRunRecords }
              : {}),
          },
        }
      : {}),
    ...(overrides.sessionRetentionDays !== undefined
      ? { sessionRetentionDays: overrides.sessionRetentionDays }
      : {}),
  };

  let report: CleanupReport;
  try {
    report = cleanupSessions(dbPath, Date.now(), options);
  } catch (error) {
    io.error(`清理失败：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  io.log(renderCleanupReport(report, dbPath));

  if (jsonPath !== undefined) {
    writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
    io.log(`JSON 报告已导出：${jsonPath}`);
  }
}

// 入口判定：仅直接执行本文件时运行（npm run maintenance → dist 产物）；
// 测试 import 走不到这里。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await maintenanceMain(process.argv.slice(2));
}
