/**
 * 运行时诊断报告（O18，T-P1-35）——"一键导出环境/配置/沙箱可用性"
 * （codex·cli/src/doctor/ 全域 check 面：sandbox/network 之外的
 * environment/system/disk 等域，每行 status + details + remediation）。
 * 沙箱域已在 D7（sandbox/doctor.ts），本文件补环境/配置/存储三组运行时
 * 检查，cli/doctor.ts 聚合两域一次报告 + --json 导出。
 *
 * 诊断不是运行时前置条件：有则报、无则 warn（workspace 缺失 = 从非仓库
 * 根运行，不是错误）；唯一 error 面 = 存储目录不可写（会话无法落盘）。
 * 敏感面纪律：报告结构性不收集凭证（模型只出 provider/modelId 身份，
 * 不出现 key——不是"过滤"而是"从未收集"）。
 */

import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import type { DoctorCheck, DoctorReport, DoctorStatus } from "../sandbox/doctor.js";
import { CURRENT_SCHEMA_VERSION, SqliteEventStorage } from "../session/db.js";

export interface RuntimeDoctorDeps {
  nodeVersion: string;
  platform: string;
  cwd: string;
  /** 工作区根（缺省 cwd；不存在 → workspace 行 warn）。 */
  workspaceRoot: string;
  /** 事件库路径（AEGENT_DB/--db；缺省未配置 → storage 行 warn 提示）。 */
  dbPath?: string;
  /** 已注册模型身份（装配注册表；独立 CLI 模式可能为空）。 */
  modelIdentities?: readonly { provider: string; modelId: string }[];
  /** D3 网络档现值（"allow" | "deny" | "未配置"）。 */
  networkPolicy?: "allow" | "deny" | "unconfigured";
  builtinToolNames?: readonly string[];
  skillsRoot?: string;
}

export interface RuntimeDoctorReport {
  readonly checks: readonly DoctorCheck[];
  readonly errors: number;
  readonly warnings: number;
}

function isWritableDir(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function countSessions(dbPath: string): { count: number; events: number } | undefined {
  try {
    const storage = SqliteEventStorage.open({ path: dbPath });
    try {
      const rows = storage.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number };
      const ev = storage.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
      return { count: rows.n, events: ev.n };
    } finally {
      storage.db.close();
    }
  } catch {
    return undefined;
  }
}

/** 运行时三组检查（环境/配置/存储）——deps 全注入，判定面无隐藏 I/O（D7 先例）。 */
export function runRuntimeDoctorChecks(deps: RuntimeDoctorDeps): RuntimeDoctorReport {
  const checks: DoctorCheck[] = [];

  // ── 环境 ──
  checks.push({
    id: "runtime-environment",
    title: "运行时环境",
    status: "ok",
    details: [
      `node ${deps.nodeVersion} · platform ${deps.platform}`,
      `cwd: ${deps.cwd}`,
    ],
  });

  // ── 工作区 ──（缺失 warn：诊断可从任意目录跑，不是错误）
  const workspaceExists = existsSync(deps.workspaceRoot);
  checks.push({
    id: "runtime-workspace",
    title: "工作区根",
    status: workspaceExists ? "ok" : "warn",
    details: [
      `root: ${deps.workspaceRoot}`,
      workspaceExists ? "目录存在" : "目录不存在——沙箱/技能/计划落盘等路径面不可用",
    ],
    ...(workspaceExists ? {} : { remediation: "在仓库根运行，或用 --workspace/装配选项指定工作区" }),
  });

  // ── 配置（模型/网络档/工具/技能）──
  const configDetails: string[] = [];
  let configStatus: DoctorStatus = "ok";
  const identities = deps.modelIdentities ?? [];
  if (identities.length === 0) {
    configDetails.push("模型注册表：空（未注册任何模型身份）");
    configStatus = "warn";
  } else {
    configDetails.push(
      `模型注册表：${identities.map((m) => `${m.provider}/${m.modelId}`).join("、")}（身份面，不含凭证）`,
    );
  }
  configDetails.push(
    `网络档：${deps.networkPolicy === undefined || deps.networkPolicy === "unconfigured" ? "未配置（无网络工具，fail-closed 不是错误）" : deps.networkPolicy}`,
  );
  configDetails.push(`内置工具：${deps.builtinToolNames?.length ?? 0} 项`);
  if (deps.skillsRoot !== undefined) {
    const skillsExist = existsSync(deps.skillsRoot);
    configDetails.push(
      `技能目录：${deps.skillsRoot}${skillsExist ? `（${readdirSync(deps.skillsRoot).length} 项）` : "（不存在——无技能可用，不是错误）"}`,
    );
  }
  checks.push({
    id: "runtime-config",
    title: "配置面",
    status: configStatus,
    details: configDetails,
    ...(configStatus === "warn" ? { remediation: "装配选项 models/networkPolicy 按需注册（诊断报告照常可导出）" } : {}),
  });

  // ── 存储 ──
  const storageDetails: string[] = [];
  let storageStatus: DoctorStatus = "ok";
  let storageRemediation: string | undefined;
  const sessionsDir = join(deps.workspaceRoot, ".aegent", "sessions");
  if (deps.dbPath === undefined) {
    storageDetails.push(
      `事件库：未配置（AEGENT_DB/--db）——会话仅内存态，进程退出即失（.aegent/sessions 目录：${sessionsDir}）`,
    );
    storageStatus = "warn";
    storageRemediation = "用 --db <path>（或 AEGENT_DB）指定 SQLite 事件库以启用持久化";
  } else {
    const dbExists = existsSync(deps.dbPath);
    storageDetails.push(`事件库：${deps.dbPath}${dbExists ? "（已存在）" : "（尚未创建——首次会话落盘时建立）"}`);
    if (dbExists) {
      const counts = countSessions(deps.dbPath);
      if (counts === undefined) {
        storageDetails.push("事件库读取失败——库文件损坏或 schema 不兼容");
        storageStatus = "error";
        storageRemediation = "检查库文件完整性（Q5 对账口径：绝不带病重建内存序）";
      } else {
        storageDetails.push(`会话 ${counts.count} 个 / 事件 ${counts.events} 条 · schema 版本 ${CURRENT_SCHEMA_VERSION}`);
      }
    }
    const dir = dirname(deps.dbPath);
    if (!isWritableDir(dir)) {
      storageDetails.push(`库目录不可写：${dir}`);
      storageStatus = "error";
      storageRemediation = "修复目录写权限，否则会话无法落盘";
    }
  }
  checks.push({
    id: "runtime-storage",
    title: "存储面",
    status: storageStatus,
    details: storageDetails,
    ...(storageRemediation !== undefined ? { remediation: storageRemediation } : {}),
  });

  return {
    checks,
    errors: checks.filter((c) => c.status === "error").length,
    warnings: checks.filter((c) => c.status === "warn").length,
  };
}

/** 从真实进程环境收集运行时诊断事实（CLI 聚合入口用；测试不依赖本函数）。 */
export function collectRuntimeDoctorFacts(overrides: Partial<RuntimeDoctorDeps> = {}): RuntimeDoctorDeps {
  const workspaceRoot = overrides.workspaceRoot ?? process.cwd();
  return {
    nodeVersion: process.version,
    platform: process.platform,
    cwd: process.cwd(),
    workspaceRoot,
    dbPath: overrides.dbPath ?? process.env["AEGENT_DB"],
    networkPolicy: "unconfigured",
    skillsRoot: overrides.skillsRoot ?? join(workspaceRoot, ".zcode", "skills"),
    ...overrides,
  };
}

/** 报告 JSON 导出形状（basename 脱敏不在此做——报告本身结构性无凭证）。 */
export function doctorReportToJson(report: DoctorReport): string {
  return JSON.stringify(report, null, 2);
}
