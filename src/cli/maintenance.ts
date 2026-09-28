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
 */

import { writeFileSync } from "node:fs";

import { cleanupSessions, type CleanupOptions, type CleanupReport } from "../session/cleanup.js";

function usage(): never {
  console.error(
    "用法：maintenance cleanup --db <path> [--dry-run] [--audit-days N] [--keep-runs N] [--session-days N] [--json <path>]",
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
const [subcommand, ...rest] = argv;
if (subcommand !== "cleanup") usage();

let dbPath: string | undefined;
let dryRun = false;
let jsonPath: string | undefined;
const overrides: { auditDays?: number; taskRunRecords?: number; sessionRetentionDays?: number } = {};

function parsePositiveInt(raw: string | undefined, flag: string): number {
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value) || value < 0) {
    console.error(`${flag} 需要一个非负整数（收到 ${JSON.stringify(raw)}）`);
    process.exit(2);
  }
  return value;
}

for (let i = 0; i < rest.length; i++) {
  const arg = rest[i];
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
      console.error(`未知参数「${arg}」`);
      usage();
  }
}
if (dbPath === undefined) usage();

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
  console.error(`清理失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

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
console.log(lines.join("\n"));

if (jsonPath !== undefined) {
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`JSON 报告已导出：${jsonPath}`);
}
