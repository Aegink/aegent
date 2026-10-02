/**
 * 项目域 settings op 实现面（T-P3-150——从 settings-gateway 域拆分的行数
 * 纪律位；settings-plugin-ops 同款模式）。fs 三 op 的边界与配额纪律在
 * fs-gateway.ts；clone/扫描在 projects-gateway.ts——本文件只做 gateway
 * 依赖（settings 读 / 事件库）与域函数的装配。
 */

import type { SqliteEventStorage } from "../session/db.js";
import { fsListDir, fsReadFile, fsShellAction } from "./fs-gateway.js";
import { projectGitClone, readGitBranch, scanImportableProjects } from "./projects-gateway.js";

/** 项目任务清单 = 归属映射 ∩ 会话索引（标题沿用 listSessionSummaries 的
 * title 管线——session_titles 优先、首条消息截断回退）。 */
export function projectTasksOp(
  sessionDb: SqliteEventStorage | undefined,
  projectId: string,
): { projectId: string; tasks: { sessionId: string; title: string; createdTs: number; updatedTs: number; eventCount: number }[] } {
  const db = requireDb(sessionDb, "任务面");
  const summaries = db.listSessionSummaries(500);
  const ownership = new Map(db.listSessionProjects().map((r) => [r.sessionId, r.projectId]));
  const tasks = summaries
    .filter((s) => ownership.get(s.sessionId) === projectId)
    .map((s) => ({
      sessionId: s.sessionId,
      title: s.title ?? "",
      createdTs: s.createdTs,
      updatedTs: s.updatedTs,
      eventCount: s.eventCount,
    }));
  return { projectId, tasks };
}

export function sessionAttachOp(
  sessionDb: SqliteEventStorage | undefined,
  payload: { sessionId: string; projectId: string },
): { attached: true } {
  requireDb(sessionDb, "归属面").setSessionProject(payload.sessionId, payload.projectId, {
    overwrite: true,
  });
  return { attached: true };
}

/** T-P3-150 B2：任务重命名（custom 源——db.setTitle 的 custom 短路保证
 * 后续自动命名永不覆盖手动名）。 */
export function sessionRenameOp(
  sessionDb: SqliteEventStorage | undefined,
  payload: { sessionId: string; title: string },
): { renamed: true } {
  requireDb(sessionDb, "重命名").setTitle(payload.sessionId, payload.title.trim(), "custom");
  return { renamed: true };
}

export function projectBranchOp(path: string): { branch?: string } {
  return { branch: readGitBranch(path) };
}

export function fsTreeOp(roots: readonly string[], path: string): Promise<unknown> {
  return Promise.resolve(_fsTree(roots, path));
}
function _fsTree(roots: readonly string[], path: string): unknown {
  return fsListDir(path, roots);
}

export function fsReadOp(roots: readonly string[], path: string): Promise<unknown> {
  return Promise.resolve(_fsRead(roots, path));
}
function _fsRead(roots: readonly string[], path: string): unknown {
  return fsReadFile(path, roots);
}

export function fsShellOp(
  roots: readonly string[],
  payload: { path: string; action: "reveal" | "open" },
): { done: true } {
  return fsShellAction(payload.path, payload.action, roots);
}

export function projectCloneOp(payload: {
  url: string;
  parentDir: string;
  name?: string;
}): Promise<{ path: string }> {
  return projectGitClone(payload);
}

export function importScanOp(homeDir: string): Promise<unknown> {
  return Promise.resolve(scanImportableProjects(homeDir));
}

function requireDb(sessionDb: SqliteEventStorage | undefined, facet: string): SqliteEventStorage {
  if (sessionDb === undefined) {
    const error = new Error("host 未配置事件存储——任务面不可用");
    (error as unknown as { code: string }).code = "STORE_UNAVAILABLE";
    throw error;
  }
  return sessionDb;
}

/**
 * 项目域 settings op 分发收敛（T-P3-150——bridge 行数纪律位；八 op 一行
 * 分发的等价面，载荷形状已由 protocol-settings 校验）。
 */
export function tryProjectSettingsOp(
  gateway: {
    fsTree(path: string): Promise<unknown>;
    fsRead(path: string): Promise<unknown>;
    fsShell(payload: { path: string; action: "reveal" | "open" }): Promise<{ done: true }>;
    projectGitCloneOp(payload: { url: string; parentDir: string; name?: string }): Promise<{ path: string }>;
    importScan(): Promise<unknown>;
    projectTasks(projectId: string): Promise<unknown>;
    sessionAttach(payload: { sessionId: string; projectId: string }): Promise<{ attached: true }>;
    projectBranch(path: string): Promise<{ branch?: string }>;
    sessionRename(payload: { sessionId: string; title: string }): Promise<{ renamed: true }>;
  },
  call: { op: string; path?: string; action?: string; url?: string; dir?: string; name?: string; projectId?: string; sessionId?: string; text?: string },
): Promise<unknown> | undefined {
  switch (call.op) {
    case "fs-tree":
      return gateway.fsTree(call.path!);
    case "fs-read":
      return gateway.fsRead(call.path!);
    case "fs-shell":
      return gateway.fsShell({ path: call.path!, action: call.action as "reveal" | "open" });
    case "git-clone":
      return gateway.projectGitCloneOp({ url: call.url!, parentDir: call.dir!, ...(call.name !== undefined ? { name: call.name } : {}) });
    case "import-scan":
      return gateway.importScan();
    case "project-tasks":
      return gateway.projectTasks(call.projectId!);
    case "session-attach":
      return gateway.sessionAttach({ sessionId: call.sessionId!, projectId: call.projectId! });
    case "project-branch":
      return gateway.projectBranch(call.path!);
    case "session-rename":
      return gateway.sessionRename({ sessionId: call.sessionId!, title: call.text! });
    default:
      return undefined;
  }
}


/**
 * 任务归属自动写入（T-P3-150 B1——server.ts 会话流镜像的行数纪律位）：
 * 返回镜像事件处理器——首条 user/message 时按当时 activeProject 归属
 * （session_projects INSERT OR IGNORE 幂等，首次生效后不改写；进程内
 * once 标志防每条消息重读 settings）。归属是增强面：settings 读失败
 * 静默（不炸镜像）。
 */
export function makeProjectAttacher(
  sessionId: string,
  sqliteStorage: SqliteEventStorage | undefined,
  settingsGateway: { get(): Promise<{ activeProject?: string }> } | undefined,
): (eventType: string) => void {
  let attached = false;
  return (eventType: string) => {
    if (eventType !== "user/message" || attached) return;
    if (sqliteStorage === undefined || settingsGateway === undefined) return;
    attached = true;
    settingsGateway
      .get()
      .then((settings) => {
        const active = settings.activeProject;
        if (active !== undefined && active !== "") {
          sqliteStorage.setSessionProject(sessionId, active);
        }
      })
      .catch(() => {
        // 归属是增强面——settings 读失败不炸镜像
      });
  };
}
