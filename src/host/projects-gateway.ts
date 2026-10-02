/**
 * 项目域编排层（T-P3-150 A3/A4/B1/A5 数据面）——Git clone 添加、其他工具
 * 会话扫描（发现级）、项目任务清单、分支徽标读取。fs 三 op 的纯函数面在
 * fs-gateway.ts（边界与配额纪律在那里）。
 *
 * 导入契约（pi-desktop importers 对齐）：发现级扫描 = 只读各工具会话记录
 * 的 cwd/标题/时间，按 cwd 归组为候选项目；会话内容转换记档 A4b。扫描全
 * fail-soft（单文件坏行跳过；单源不可达 = 0 条 + note 说明）。
 */

import { existsSync, readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { gitCloneSource } from "./plugins-marketplace-git.js";
import { FsBoundaryError } from "./fs-gateway.js";

// ---------------------------------------------------------------------------
// A4 扫描导入（发现级 + 会话级——T-P3-150 多 Agent 适配：spec 驱动消费）
// ---------------------------------------------------------------------------

import { scanJsonl, jsonlMessages } from "./import-drivers.js";
import { scanJsonTree, convertJsonTree } from "./import-driver-jsontree.js";
import { scanSqlite, convertSqlite } from "./import-driver-sqlite.js";
import type { ImportedSessionSummary, ImportedMessage, ImportSpec } from "./import-spec.js";
import { loadImportSpecs } from "./import-sources.js";

export interface ImportScanResult {
  /** cwd 归组候选（UI 项目勾选——canonical path.resolve 键）。 */
  candidates: ImportedProjectCandidate[];
  /** 会话级扁平清单（A6 勾选/预览——每源上限 500 条防单源巨库撑爆回包）。 */
  sessions: ImportedSessionSummary[];
  sources: { source: string; label: string; scanned: number; sessionCount: number; note?: string; custom?: boolean }[];
  customErrors: string[];
}

export interface ImportedProjectCandidate {
  source: string;
  /** 项目目录（归组键——会话记录里的 cwd）。 */
  cwd: string;
  title: string;
  sessionCount: number;
  lastActiveTs: number;
}

const MAX_SESSIONS_PER_SOURCE = 500;
const MAX_TOTAL_SESSIONS = 3000;

function scanOneSpec(spec: ImportSpec, home: string): ImportedSessionSummary[] {
  switch (spec.driver) {
    case "jsonl-transcript":
      return scanJsonl(spec, home);
    case "json-tree":
      return scanJsonTree(spec, home);
    case "sqlite-session":
      return scanSqlite(spec, home);
    default:
      return [];
  }
}

/** 三驱动消费的扫描编排：spec 集（内置六家+自定义）→ 逐源扫描（单源失败
 * 不中断）→ cwd 归组候选 + 会话级清单 + 每源状态。 */
export function scanImportableProjects(home: string = homedir()): ImportScanResult {
  const { specs, customErrors } = loadImportSpecs(home);
  const byCwd = new Map<string, ImportedProjectCandidate>();
  const sessions: ImportedSessionSummary[] = [];
  const sources: ImportScanResult["sources"] = [];
  for (const spec of specs) {
    let scanned = 0;
    let note: string | undefined;
    try {
      const found = scanOneSpec(spec, home);
      scanned = found.length;
      const capped = found.slice(0, MAX_SESSIONS_PER_SOURCE);
      for (const summary of capped) {
        if (sessions.length < MAX_TOTAL_SESSIONS) sessions.push(summary);
        const key = summary.projectPath !== null ? path.resolve(summary.projectPath) : null;
        if (key === null) continue;
        const existing = byCwd.get(key);
        if (existing === undefined) {
          byCwd.set(key, {
            source: spec.id,
            cwd: key,
            title: summary.title,
            sessionCount: 1,
            lastActiveTs: Date.parse(summary.updatedAt) || 0,
          });
          continue;
        }
        existing.sessionCount += 1;
        const ts = Date.parse(summary.updatedAt) || 0;
        if (ts > existing.lastActiveTs) existing.lastActiveTs = ts;
      }
      if (found.length > MAX_SESSIONS_PER_SOURCE) {
        note = `会话数超 ${String(MAX_SESSIONS_PER_SOURCE)}，仅列最新段`;
      }
    } catch (e) {
      note = `扫描失败：${e instanceof Error ? e.message : String(e)}`;
    }
    sources.push({
      source: spec.id,
      label: spec.label,
      scanned,
      sessionCount: sessions.filter((s) => s.source === spec.id).length,
      ...(note !== undefined ? { note } : {}),
      ...(spec.custom === true ? { custom: true } : {}),
    });
  }
  const candidates = [...byCwd.values()].sort((a, b) => b.lastActiveTs - a.lastActiveTs);
  return { candidates, sessions, sources, customErrors };
}

function specById(specs: ImportSpec[], source: string): ImportSpec | undefined {
  return specs.find((s) => s.id === source);
}

/** B1 预览/A6 导入共用：单会话消息还原（按 source 找 spec——单源重扫定位
 * summary，再按 driver convert；文件/库路径逐次复验边界）。返回 null =
 * 找不到或驱动失败。 */
export function convertImportedSession(
  source: string,
  externalId: string,
  home: string = homedir(),
): ImportedMessage[] | null {
  const { specs } = loadImportSpecs(home);
  const spec = specById(specs, source);
  if (spec === undefined) return null;
  const found = scanOneSpec(spec, home).find((s) => s.externalId === externalId);
  if (found === undefined) return null;
  if (spec.driver === "jsonl-transcript" && found.filePath !== undefined) {
    const root = spec.root.startsWith("~") ? path.join(home, spec.root.slice(1)) : spec.root;
    const file = path.resolve(found.filePath);
    if (!file.startsWith(path.resolve(root))) return null;
    try {
      const rawText = readFileSync(file, "utf-8");
      const lines = rawText.split("\n");
      const entries: Record<string, unknown>[] = [];
      for (const line of lines.slice(0, spec.maxLines ?? 20000)) {
        const trimmed = line.trim();
        if (trimmed === "" || !trimmed.startsWith("{")) continue;
        try {
          entries.push(JSON.parse(trimmed) as Record<string, unknown>);
        } catch {
          continue;
        }
      }
      return jsonlMessages(spec, entries);
    } catch {
      return null;
    }
  }
  if (spec.driver === "json-tree" && found.filePath !== undefined) {
    return convertJsonTree(spec, found.filePath, home);
  }
  if (spec.driver === "sqlite-session" && found.dbPath !== undefined) {
    return convertSqlite(spec, found.dbPath, externalId, home);
  }
  return null;
}

// ---------------------------------------------------------------------------
// A3 Git clone 添加
// ---------------------------------------------------------------------------

export interface ProjectCloneResult {
  /** clone 完成后的仓库根（UI 以此建项目）。 */
  path: string;
}

/**
 * clone 仓库到父目录下（复用插件市场 runGit 基建——净化 env/超时/参数
 * 白名单）；目标重名 = 类型化冲突（pi-desktop git-clone.ts 语义）。
 */
export async function projectGitClone(payload: {
  url: string;
  parentDir: string;
  name?: string;
}): Promise<ProjectCloneResult> {
  const urlErr = payload.url.trim() === "" ? "URL 不能为空" : undefined;
  if (urlErr !== undefined) throw new Error(urlErr);
  if (!existsSync(payload.parentDir)) {
    throw new FsBoundaryError("PROJECT_DIR_MISSING", `父目录不存在：${payload.parentDir}`);
  }
  const inferred = inferRepoName(payload.url);
  const name = (payload.name ?? inferred).trim();
  if (name === "" || name.includes("/") || name.includes("\\")) {
    throw new Error("仓库名不合法（不能含路径分隔符）");
  }
  const dest = path.join(payload.parentDir, name);
  if (existsSync(dest)) {
    const error = new Error(`目标目录已存在：${dest}`);
    (error as unknown as { code: string }).code = "PROJECT_CLONE_CONFLICT";
    throw error;
  }
  await gitCloneSource({ url: payload.url.trim(), dest });
  return { path: dest };
}

/** 仓库 URL → 目标目录名（https/git/scp 形态的末段去 .git）。 */
function inferRepoName(url: string): string {
  const trimmed = url.trim().replace(/\.git$/, "");
  const last = trimmed.split(/[/:]/).filter((p) => p !== "").pop();
  return last ?? "repo";
}

// ---------------------------------------------------------------------------
// A5 分支徽标（.git/HEAD 读取——pi-desktop withGitBranch 方案，无 libgit2）
// ---------------------------------------------------------------------------

export function readGitBranch(workspace: string): string | undefined {
  const head = path.join(workspace, ".git", "HEAD");
  try {
    const content = readFileSync(head, "utf-8").trim();
    const match = /^ref: refs\/heads\/(.+)$/.exec(content);
    return match?.[1];
  } catch {
    return undefined; // 非 git 目录/裸 HEAD——静默无徽标
  }
}
