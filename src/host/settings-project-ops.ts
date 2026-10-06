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
 * title 管线——session_titles 优先、首条消息截断回退）。
 *
 * mirror（T-P3-164 根因修）：镜像 store 的 write-behind 与子进程同律——
 * turn 末才排空，**turn 进行中读库恒空**，活跃会话永远不进任务清单（用户
 * "对话了但任务列表不出现"的根因）。镜像会话（内存权威）不在库索引时从
 * 事件流折叠最小事实（标题=首条 user/message 截断），与库索引合并去重。 */
export interface MirrorTasksSource {
  sessionIds(): string[];
  load(sessionId: string): readonly { type: string; ts: number; message?: unknown }[];
}

export function projectTasksOp(
  sessionDb: SqliteEventStorage | undefined,
  projectId: string,
  mirror?: MirrorTasksSource,
): { projectId: string; tasks: { sessionId: string; title: string; createdTs: number; updatedTs: number; eventCount: number }[] } {
  const db = requireDb(sessionDb, "任务面");
  const summaries = [...db.listSessionSummaries(500)];
  const ownership = new Map(db.listSessionProjects().map((r) => [r.sessionId, r.projectId]));
  // 编排子会话血统（v9 session_origins——"因协作而创建"）：任务行附
  // orchestratedFrom=父会话 id（UI 渲染"子会话"badge；普通任务不标）。
  const originOf = new Map(db.listSessionOrigins().map((o) => [o.sessionId, o.parentSessionId]));
  if (mirror !== undefined) {
    // T-P3-170：镜像折叠双用途——①镜像会话不在库索引时补整行（T-P3-164
    // 原语义）；②库行标题空（write-behind 窗口内首轮刚结算）时用镜像
    // 首条 user 话语补标题（新任务发出第一条消息后标题立即可见）。
    const known = new Set(summaries.map((s) => s.sessionId));
    for (const sid of mirror.sessionIds()) {
      const events = mirror.load(sid);
      const first = events[0];
      const last = events[events.length - 1];
      if (first === undefined || last === undefined) continue;
      // user/message 的 message 跨事件类型形状不一（ToolProgress 是 string）——
      // 运行时形状判别后取 content（事件联合的窄化在泛型面做不到）
      const firstUser = events.find((e) => e.type === "user/message");
      const raw = firstUser?.message;
      const content =
        typeof raw === "object" && raw !== null && "content" in raw
          ? String((raw as { content?: unknown }).content ?? "")
          : "";
      const mirroredTitle = content.replace(/\s+/g, " ").trim().slice(0, 40);
      if (!known.has(sid)) {
        if (events.length === 0) continue;
        summaries.push({
          sessionId: sid,
          title: mirroredTitle,
          createdTs: first.ts,
          updatedTs: last.ts,
          eventCount: events.length,
        });
      } else if (mirroredTitle !== "") {
        const hit = summaries.find((s) => s.sessionId === sid);
        if (hit !== undefined && (hit.title ?? "") === "") hit.title = mirroredTitle;
      }
    }
  }
  const tasks = summaries
    .filter((s) => ownership.get(s.sessionId) === projectId)
    .map((s) => ({
      sessionId: s.sessionId,
      title: s.title ?? "",
      createdTs: s.createdTs,
      updatedTs: s.updatedTs,
      eventCount: s.eventCount,
      ...(originOf.get(s.sessionId) !== undefined
        ? { orchestratedFrom: originOf.get(s.sessionId) }
        : {}),
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

/** T-P3-170：任务创建（pi newSession 同语义——会话记录即刻落库 + 项目归属
 *  即刻绑定，UI 侧任务列表**毫秒级可见**，不等首条话语）。会话流本体仍由
 *  首条 prompt 自然落（事件库 INSERT OR IGNORE 幂等——两侧创建不冲突）。 */
export function taskCreateOp(
  sessionDb: SqliteEventStorage | undefined,
  projectId: string,
): { sessionId: string } {
  const db = requireDb(sessionDb, "任务创建");
  const sessionId = randomUUID();
  db.createSession(sessionId);
  db.setSessionProject(sessionId, projectId);
  return { sessionId };
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
    taskCreate(projectId: string): Promise<{ sessionId: string }>;
    importPreview(source: string, externalId: string): Promise<unknown>;
    importSessions(items: { source: string; externalId: string; projectPath?: string }[]): Promise<unknown>;
  },
  call: { op: string; path?: string; action?: string; url?: string; dir?: string; name?: string; projectId?: string; sessionId?: string; text?: string; source?: string; importItems?: { source: string; externalId: string; projectPath?: string }[] },
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
    case "task-create":
      return gateway.taskCreate(call.projectId!);
    case "import-preview":
      return gateway.importPreview(call.source!, call.path!);
    case "import-sessions":
      return gateway.importSessions(call.importItems ?? []);
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
  sqliteStorage: SqliteEventStorage | undefined,
  settingsGateway: { get(): Promise<{ activeProject?: string }> } | undefined,
): (sessionId: string, eventType: string) => void {
  // T-P3-170：per-session attached 标志（多会话并发下每个会话的首条
  // user 话语各归属一次——闭包单布尔会吞掉第二个会话的归属）
  const attached = new Set<string>();
  return (sessionId: string, eventType: string) => {
    if (eventType !== "user/message" || attached.has(sessionId)) return;
    if (sqliteStorage === undefined || settingsGateway === undefined) return;
    attached.add(sessionId);
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

// ---------------------------------------------------------------------------
// T-P3-150 A6/B1：会话内容导入与预览（spec 驱动 convert → 我方事件流重建）
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { convertImportedSession } from "./projects-gateway.js";
import type { ImportedMessage } from "./import-spec.js";
import type { SessionEvent } from "../kernel/events.js";

/** ImportedMessage → 我方事件序列（user/message 开新 turn；assistant 带
 * 空 stream；tool 配 callId 对）。E16 合法类型子集；seq/turn/step 单调。 */
export function importedMessagesToEvents(messages: ImportedMessage[], baseTs: number): SessionEvent[] {
  const events: SessionEvent[] = [];
  let seq = 1;
  let turn = 0;
  let step = 0;
  let lastTs = baseTs;
  for (const message of messages) {
    const ts =
      message.createdAt !== undefined && message.createdAt !== null
        ? Math.max(Date.parse(message.createdAt) || 0, lastTs + 1)
        : lastTs + 1;
    lastTs = ts;
    if (message.role === "user") {
      turn += 1;
      step = 0;
      events.push({
        type: "user/message", seq, ts, turn,
        message: { content: message.text ?? "" },
        source: "user",
      } as SessionEvent);
    } else if (message.role === "assistant") {
      step += 1;
      events.push({
        type: "assistant/message", seq, ts, turn, step,
        message: { content: message.text ?? "" },
        stream: [],
      } as SessionEvent);
    } else {
      step += 1;
      const callId = `imp-${String(seq)}`;
      events.push({
        type: "tool/call", seq, ts, turn, step,
        callId, name: message.toolName ?? "tool",
        arguments: JSON.stringify(message.toolArgs ?? {}),
      } as SessionEvent);
      seq += 1;
      events.push({
        type: "tool/result", seq, ts: ts + 1, turn, step,
        callId,
        message: { content: message.toolResult ?? "", ...(message.toolError === true ? { isError: true } : {}) },
      } as SessionEvent);
      lastTs = ts + 1;
    }
    seq += 1;
  }
  return events;
}

export interface ImportSessionItem {
  source: string;
  externalId: string;
  /** 原始工作目录（扫描清单带出——canonical 匹配已添加项目后自动归属）。 */
  projectPath?: string;
}

/** A6 内容导入：逐条 convert → 幂等账查重 → 事件重建 → appendBatch →
 * 项目归属（projectPath canonical 匹配已添加项目）→ 三计数。单条失败不
 * 中断批（failed 计数）。 */
export function importSessionsOp(
  sessionDb: SqliteEventStorage | undefined,
  items: ImportSessionItem[],
  projectRoots: { id: string; folders: string[] }[],
  home: string = homedir(),
): { imported: number; skipped: number; failed: number; sessionIds: string[] } {
  const db = requireDb(sessionDb, "导入面");
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const sessionIds: string[] = [];
  for (const item of items) {
    try {
      const externalKey = `${item.source}:${item.externalId}`;
      const existing = db.lookupImportedSession(externalKey);
      if (existing !== undefined) {
        skipped += 1;
        sessionIds.push(existing);
        continue;
      }
      const messages = convertImportedSession(item.source, item.externalId, home);
      if (messages === null || messages.length === 0) {
        failed += 1;
        continue;
      }
      const sessionId = randomUUID();
      const baseTs = Date.now() - messages.length * 1000;
      const events = importedMessagesToEvents(messages, baseTs);
      if (events.length === 0) {
        failed += 1;
        continue;
      }
      db.appendBatch(sessionId, events);
      db.registerImportedSession(externalKey, sessionId);
      // 项目归属：按原始工作目录 canonical 匹配已添加项目（pi-desktop 语义
      // ——未匹配不归属，留在未分组）
      const projectId = matchProjectIdForPath(item.projectPath ?? null, projectRoots);
      if (projectId !== undefined) {
        db.setSessionProject(sessionId, projectId);
      }
      imported += 1;
      sessionIds.push(sessionId);
    } catch {
      failed += 1;
    }
  }
  return { imported, skipped, failed, sessionIds };
}

/** B1 预览：单会话 convert（消息级还原——UI 对话渲染）。 */
export function importPreviewOp(
  source: string,
  externalId: string,
  home: string = homedir(),
): { messages: ImportedMessage[] } | { error: string } {
  const messages = convertImportedSession(source, externalId, home);
  if (messages === null) return { error: "会话不存在或驱动读取失败" };
  return { messages: messages.slice(0, 2000) };
}

/** A6 归属：projectPath → 已添加项目 id（canonical 前缀比对——导入后按
 * 原始工作目录归属项目，pi-desktop 语义）。 */
export function matchProjectIdForPath(
  projectPath: string | null,
  projects: { id: string; folders: string[] }[],
): string | undefined {
  if (projectPath === null) return undefined;
  const norm = (p: string) => p.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
  const target = norm(projectPath);
  for (const project of projects) {
    for (const folder of project.folders) {
      const root = norm(folder);
      if (target === root || target.startsWith(`${root}/`)) return project.id;
    }
  }
  return undefined;
}
