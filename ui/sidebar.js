/**
 * 侧栏两分段（T-P3-156 方案 A/E——需求一.1「左侧边栏仅保留项目列表」）：
 * 项目（本体）+ 最近会话 + 文件树滑入层（与两分段互斥——zcode
 * WorkspaceSidebar.tsx:1664-1696 滑入语义）。
 *
 * 数据面沿用 T-P3-150：settings.projects 段（{id,name,folders[],...}——
 * 即改即存）+ op:project-tasks / session-rename / session-delete + query
 * op:"sessions"。交互升级（E）：任务/项目状态点、置顶、拖拽排序、hover
 * 浮层按钮、missing 徽章、删除运行保护（pi-desktop/pideck 同构行为）。
 *
 * 任务语义（单会话架构诚实版）：任务 = 归属项目的会话；「新建任务」= 设
 * 该项目为活动 + 重启指引；任务点击 = 只读恢复视图（续聊走 CLI resume）。
 */

import { sendQuery, sendSettings, invalidateMetaCache } from "./api.js";
import { settingsCache, setSettingsCache, getSessionId, hooks } from "./state.js";
import { toast, appendLine } from "./feedback.js";
import { openMenu, confirmDialog, openDialog, markDirty, dirtySections, flushSettings, onSectionRefresh } from "./views/settings/core.js";
import { renderFileTree, copyText } from "./views/projects-files.js";
import { openFilePane } from "./pane.js";

// ---------------------------------------------------------------------------
// 本地偏好（置顶 / 手动顺序 / 展开——localStorage 持久化）
// ---------------------------------------------------------------------------

const PIN_KEY = "aegent.pinnedProjects";
const ORDER_KEY = "aegent.projectOrder";
const EXPAND_KEY = "aegent.expandedProjects";

function readIdSet(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(raw) ? new Set(raw) : new Set();
  } catch {
    return new Set();
  }
}

function writeIdSet(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // 存储不可用——偏好退化为会话内有效
  }
}

let pinned = readIdSet(PIN_KEY);
let manualOrder = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
})();
let expandedProjects = readIdSet(EXPAND_KEY);

// 运行态（app.js 经 CustomEvent 推送——W 的 idle 信号同源）：当前会话
// 是否有在途轮。任务/项目状态点据此判定。
const agentState = { busy: false };
window.addEventListener("agent:busy", () => {
  agentState.busy = true;
  void paintProjects();
});
window.addEventListener("agent:idle", () => {
  agentState.busy = false;
  void paintProjects();
});

// 未读会话（history.js READ_KEY 语义沿用——本端 localStorage 已读标记）
const READ_KEY = "aegent.readSessions";
function readMap() {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function markRead(sid, ts) {
  const map = readMap();
  if ((map[sid] ?? 0) >= ts) return;
  map[sid] = ts;
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(map));
  } catch {
    // 同上——未读点退化常显
  }
}

// 文件树滑入层状态
let filesProjectId = null;
let treeGeneration = 0;

let sessionsCache = [];
let historyExpanded = false;

// ---------------------------------------------------------------------------
// 初始化与总刷新
// ---------------------------------------------------------------------------

export function initSidebar() {
  onSectionRefresh(() => void refreshSidebar());
  hooks.refreshSidebar = refreshSidebar;
  // 首拉不在此处——sendSettings 依赖已建立的 WS（api.js send 为 null 时
  // 抛），由 app.js 的 hello 握手回执触发首次 refreshSidebar（连接就绪时点）
}

/** 全量刷新（settings 变更 / 会话信号 / 启动——冷启动强制拉 settings）。 */
export async function refreshSidebar() {
  if (settingsCache === null) {
    invalidateMetaCache();
    const envelope = await sendSettings({ op: "get" });
    if (envelope.ok) setSettingsCache(envelope.result.settings);
  }
  if (filesProjectId !== null) {
    await showFileTree(filesProjectId); // 文件树态：整体重建（代次守卫在树内）
    return;
  }
  await Promise.all([paintProjects(), paintHistory()]);
  refreshTopbar();
}

/** 顶栏上下文（活动项目 + 当前会话标题）。 */
export function refreshTopbar() {
  const box = document.getElementById("topbar-context");
  if (box === null) return;
  const project = (settingsCache?.projects ?? []).find((p) => p.id === settingsCache?.activeProject);
  const current = sessionsCache.find((s) => s.sessionId === getSessionId());
  const parts = [];
  if (project !== undefined) parts.push(`📁 ${project.name}`);
  if (current !== undefined && (current.title ?? "") !== "") parts.push(current.title);
  box.textContent = parts.join(" · ");
  box.title = box.textContent;
}

// ---------------------------------------------------------------------------
// 分段一：项目列表
// ---------------------------------------------------------------------------

async function paintProjects() {
  const box = document.getElementById("sb-projects");
  if (box === null || filesProjectId !== null) return;
  const projects = sortedProjects();
  box.replaceChildren(sectionHead("项目", "添加项目", () => void openAddDialog()));
  if (projects.length === 0) {
    box.appendChild(emptyGuide());
    return;
  }
  for (const project of projects) {
    box.appendChild(projectRow(project));
  }
}

function sortedProjects() {
  const projects = [...(settingsCache?.projects ?? [])];
  const orderIdx = new Map(manualOrder.map((id, i) => [id, i]));
  projects.sort((a, b) => {
    const pin = Number(pinned.has(b.id)) - Number(pinned.has(a.id));
    if (pin !== 0) return pin;
    const oa = orderIdx.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const ob = orderIdx.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || a.name.localeCompare(b.name);
  });
  return projects;
}

function isActive(project) {
  return settingsCache?.activeProject === project.id;
}

/** 项目工作区是否有在途活动：活动项目 = 当前会话归属 + agent 忙（诚实可判
 * ——单会话架构下只有活动项目的当前任务可能在跑）。 */
function projectRunning(project) {
  return isActive(project) && agentState.busy;
}

/** 项目任务里是否有待决审批（橙色点——pending 卡存在时由 app.js 推送）。 */
const agentState2 = { awaiting: false };
window.addEventListener("agent:awaiting", () => {
  agentState2.awaiting = true;
  void paintProjects();
});
window.addEventListener("agent:idle", () => {
  agentState2.awaiting = false;
});

function projectRow(project) {
  const expanded = expandedProjects.has(project.id);
  const running = projectRunning(project);
  const row = document.createElement("div");
  row.className = `sb-project${expanded ? " expanded" : ""}${running ? " running" : ""}`;
  row.dataset.id = project.id;
  row.draggable = true;

  // — 主行：折叠箭头 + 图标 + 名称 + 徽标 + hover 浮层按钮 —
  const head = document.createElement("div");
  head.className = "sb-project-head";
  const caret = document.createElement("span");
  caret.className = "sb-caret";
  caret.textContent = "▸";
  const icon = document.createElement("span");
  icon.className = "sb-icon";
  icon.textContent = expanded ? "📂" : "📁";
  const name = document.createElement("span");
  name.className = "sb-label";
  name.textContent = project.name;
  name.title = project.folders[0] ?? "";
  head.append(caret, icon, name);
  if (isActive(project)) {
    head.appendChild(chipEl("活动", "sb-chip-active"));
  }
  if (pinned.has(project.id)) {
    head.appendChild(chipEl("📌", "sb-chip-pin"));
  }
  if (project.missing === true) {
    head.appendChild(chipEl("missing", "sb-chip-missing"));
  }
  if (!expanded && running) {
    head.appendChild(chipEl("●", "sb-chip-running")); // 折叠态黄点=仍有 Agent 在跑
  }

  // hover 浮层：+ 新建任务 / ⋯ 菜单（pideck 行尾浮层——absolute 不占布局）
  const hover = document.createElement("div");
  hover.className = "sb-hover-actions";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "sb-hover-btn";
  addBtn.textContent = "+";
  addBtn.title = "新建任务（设为活动工作区）";
  addBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    void createTask(project);
  });
  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "sb-hover-btn";
  moreBtn.textContent = "⋯";
  moreBtn.title = "项目操作";
  moreBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    openMenu(moreBtn, projectMenuItems(project));
  });
  hover.append(addBtn, moreBtn);
  head.appendChild(hover);

  // 主行单击 = 折叠切换 + 选中项目（pideck:134-138 同款双职责）
  head.addEventListener("click", () => {
    if (expandedProjects.has(project.id)) {
      expandedProjects.delete(project.id);
      writeIdSet(EXPAND_KEY, expandedProjects);
      void paintProjects();
    } else {
      void expandProject(project);
    }
  });

  // 右键 = 完整菜单
  head.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    openMenu(head, projectMenuItems(project));
  });

  // 拖拽排序（搜索过滤无——列表恒全量；HTML5 drag 简实现）
  row.addEventListener("dragstart", (ev) => {
    ev.dataTransfer.setData("text/aegent-project", project.id);
    ev.dataTransfer.effectAllowed = "move";
  });
  row.addEventListener("dragover", (ev) => {
    if (ev.dataTransfer.types.includes("text/aegent-project")) {
      ev.preventDefault();
      row.classList.add("drag-over");
    }
  });
  row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
  row.addEventListener("drop", (ev) => {
    ev.preventDefault();
    row.classList.remove("drag-over");
    const draggedId = ev.dataTransfer.getData("text/aegent-project");
    if (draggedId === "" || draggedId === project.id) return;
    reorderProject(draggedId, project.id);
  });

  row.appendChild(head);

  // — 展开区：任务列表 + 查看文件入口 —
  if (expanded) {
    caret.classList.add("open");
    const taskBox = document.createElement("div");
    taskBox.className = "sb-tasks";
    taskBox.textContent = "任务加载中…";
    row.appendChild(taskBox);
    const fileEntry = document.createElement("div");
    fileEntry.className = "sb-task-row sb-files-entry";
    fileEntry.innerHTML = `<span class="sb-task-dot"></span><span class="sb-label">📂 查看文件（左侧栏文件树）</span>`;
    fileEntry.addEventListener("click", () => void showFileTree(project.id));
    row.appendChild(fileEntry);
    void loadTasks(taskBox, project);
  }
  return row;
}

function chipEl(text, cls) {
  const chip = document.createElement("span");
  chip.className = `sb-chip ${cls}`;
  chip.textContent = text;
  return chip;
}

/** 展开项目：记偏好 + 标活动 + missing 探测（fs-tree 首层——展开即预热）。 */
async function expandProject(project) {
  expandedProjects.add(project.id);
  writeIdSet(EXPAND_KEY, expandedProjects);
  if (project.missing !== true) {
    const probe = await sendSettings({ op: "fs-tree", path: project.folders[0] ?? "" });
    if (!probe.ok) project.missing = true; // 展开期探测——行上现 missing 徽章
  }
  await paintProjects();
}

function projectMenuItems(project) {
  return [
    {
      label: isActive(project) ? "当前活动项目" : "设为活动",
      onClick: () => void setActiveProject(project),
    },
    { label: "新建任务", onClick: () => void createTask(project) },
    { label: "查看文件", onClick: () => void showFileTree(project.id) },
    { label: "编辑项目（名称 / 添加其他文件夹）", onClick: () => void openEditDialog(project) },
    { label: "在资源管理器中打开", onClick: () => void revealProject(project) },
    {
      label: "复制项目路径",
      onClick: () => void copyText(project.folders[0] ?? "", "已复制项目路径"),
    },
    {
      label: pinned.has(project.id) ? "取消置顶" : "置顶",
      onClick: () => {
        if (pinned.has(project.id)) pinned.delete(project.id);
        else pinned.add(project.id);
        writeIdSet(PIN_KEY, pinned);
        void paintProjects();
      },
    },
    { label: "删除项目", danger: true, onClick: () => void deleteProject(project) },
  ];
}

async function revealProject(project) {
  const envelope = await sendSettings({ op: "fs-shell", path: project.folders[0] ?? "", action: "reveal" });
  if (!envelope.ok) {
    toast(`打开失败：${envelope.error?.message ?? ""}`, "warn");
    project.missing = true;
    await paintProjects();
  }
}

/** 拖拽落点重排：全量 order 数组重写（置顶优先级独立于 order）。 */
function reorderProject(draggedId, targetId) {
  const ids = sortedProjects().map((p) => p.id);
  const from = ids.indexOf(draggedId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return;
  ids.splice(to, 0, ...ids.splice(from, 1));
  manualOrder = ids;
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
  } catch {
    // 同上——顺序退化
  }
  void paintProjects();
}

// — 任务（归属会话）—

async function loadTasks(taskBox, project) {
  const envelope = await sendSettings({ op: "project-tasks", projectId: project.id });
  if (taskBox.isConnected === false) return; // 重渲染竞态——丢弃
  taskBox.replaceChildren();
  if (!envelope.ok) {
    taskBox.textContent = `任务加载失败：${envelope.error?.message ?? ""}`;
    return;
  }
  const tasks = (envelope.result.tasks ?? []).slice().sort((a, b) => b.updatedTs - a.updatedTs);
  if (tasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sb-tasks-empty";
    empty.textContent = "还没有任务——新建任务后第一句话自动命名";
    taskBox.appendChild(empty);
    return;
  }
  for (const task of tasks) {
    taskBox.appendChild(taskRow(task));
  }
  // 展开任务的项目顺带刷 topbar（当前会话标题可能刚生成）
  refreshTopbar();
}

function taskRow(task) {
  const row = document.createElement("div");
  row.className = "sb-task-row";
  const isCurrent = task.sessionId === getSessionId();
  const dot = document.createElement("span");
  dot.className = `sb-task-dot${isCurrent && agentState.busy ? " busy" : ""}${isCurrent && agentState2.awaiting ? " awaiting" : ""}`;
  dot.title = isCurrent ? (agentState.busy ? "运行中" : "当前会话") : "历史任务";
  const title = document.createElement("span");
  title.className = "sb-label";
  title.textContent = task.title !== "" ? task.title : task.sessionId;
  const meta = document.createElement("span");
  meta.className = "sb-task-meta";
  meta.textContent = new Date(task.updatedTs).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  row.append(dot, title, meta);
  if (isCurrent) row.classList.add("current");
  row.addEventListener("click", () => void viewTaskSession(task));
  row.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    openMenu(row, [
      { label: "重命名", onClick: () => void renameTask(task) },
      { label: "查看（只读恢复视图）", onClick: () => void viewTaskSession(task) },
      { label: "打开会话路径", onClick: () => void openSessionPath(task) },
      { label: "删除任务", danger: true, onClick: () => void deleteTask(task) },
    ]);
  });
  return row;
}

/** 任务点击 = 只读恢复视图（history.js viewSession 语义——先回对话再拉快照）。 */
async function viewTaskSession(task) {
  markRead(task.sessionId, Date.now());
  location.hash = "#chat";
  const view = await sendQuery({ sessionId: task.sessionId, op: "events" });
  if (!view.ok) {
    toast(`查看失败：${view.error?.message ?? ""}`, "warn");
    return;
  }
  hooks.resetStreamView();
  hooks.renderHistory(view.result.events ?? []);
  appendLine("── 只读视图：续聊请执行 aegent sessions resume " + task.sessionId + " ──", "warn");
}

async function openSessionPath(task) {
  // 会话库文件路径由 host 知晓（sessions/ 数据目录）——query/settings op 目前
  // 无此面，诚实降级提示（host op session-path 打磨批接线后改为直开）
  toast(`会话 ${task.sessionId.slice(0, 8)}… 的存储路径暂无直达入口——可在日志中心看存储位置`, "info");
}

async function renameTask(task) {
  const input = document.createElement("input");
  input.className = "input";
  input.type = "text";
  input.placeholder = "新任务名";
  const confirmed = await new Promise((resolve) => {
    const dialog = openDialog({
      title: "重命名任务",
      body: input,
      onClose: () => resolve(null),
      actions: [
        { label: "取消", className: "btn btn-ghost", onClick: () => resolve(null) },
        { label: "重命名", className: "btn btn-primary", onClick: () => resolve(input.value.trim()) },
      ],
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        resolve(input.value.trim());
        dialog.close(true);
      }
    });
  });
  if (typeof confirmed !== "string" || confirmed === "") {
    if (confirmed === "") toast("任务名不能为空", "warn");
    return;
  }
  const envelope = await sendSettings({ op: "session-rename", sessionId: task.sessionId, text: confirmed });
  if (!envelope.ok) {
    toast(`重命名失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  toast("已重命名（手动命名不会被自动标题覆盖）", "info");
  await refreshSidebar();
}

async function deleteTask(task) {
  const ok = await confirmDialog(`删除任务「${task.title !== "" ? task.title : task.sessionId}」？该会话的事件记录将一并删除，不可恢复。`, { danger: true });
  if (ok !== true) return;
  const envelope = await sendSettings({ op: "session-delete", sessionId: task.sessionId });
  if (!envelope.ok) {
    toast(`删除失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  toast("任务已删除", "info");
  await refreshSidebar();
}

// ---------------------------------------------------------------------------
// 分段二：最近会话（history.js 迁入——分组/未读/删除/只读查看）
// ---------------------------------------------------------------------------

async function paintHistory() {
  const box = document.getElementById("sb-history");
  if (box === null || filesProjectId !== null) return;
  box.replaceChildren(
    sectionHead(
      "最近会话",
      "导入",
      () => void importSessionsJson(),
      "导入其他机器导出的会话 JSON 包（跨机迁移，幂等）",
    ),
  );
  const envelope = await sendQuery({ sessionId: getSessionId() || "-", op: "sessions" });
  if (box.isConnected === false) return;
  if (!envelope.ok) {
    const fail = document.createElement("div");
    fail.className = "sb-tasks-empty";
    fail.textContent = `会话清单不可用：${envelope.error?.message ?? ""}`;
    box.appendChild(fail);
    return;
  }
  sessionsCache = (envelope.result.sessions ?? []).slice().sort((a, b) => (b.updatedTs ?? 0) - (a.updatedTs ?? 0));
  const shown = historyExpanded ? sessionsCache : sessionsCache.slice(0, 8);
  const map = readMap();
  if (shown.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sb-tasks-empty";
    empty.textContent = "暂无历史会话";
    box.appendChild(empty);
  }
  for (const session of shown) {
    box.appendChild(sessionRow(session, map));
  }
  if (sessionsCache.length > 8) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "sb-more-btn";
    more.textContent = historyExpanded ? "收起" : `查看更多（${String(sessionsCache.length - 8)} 条）`;
    more.addEventListener("click", () => {
      historyExpanded = !historyExpanded;
      void paintHistory();
    });
    box.appendChild(more);
  }
  refreshTopbar();
}

function sessionRow(session, map) {
  const row = document.createElement("div");
  row.className = "sb-task-row";
  const isCurrent = session.sessionId === getSessionId();
  const unread = (map[session.sessionId] ?? 0) < (session.updatedTs ?? 0) && !isCurrent;
  const dot = document.createElement("span");
  dot.className = `sb-task-dot${unread ? " unread" : ""}`;
  if (unread) dot.title = "有更新";
  const title = document.createElement("span");
  title.className = "sb-label";
  title.textContent = (session.title ?? "") !== "" ? session.title : session.sessionId;
  title.title = title.textContent;
  const meta = document.createElement("span");
  meta.className = "sb-task-meta";
  meta.textContent = rowTimeLabel(session.updatedTs ?? 0);
  row.append(dot, title, meta);
  if (isCurrent) row.classList.add("current");
  row.addEventListener("click", () => {
    markRead(session.sessionId, Date.now());
    location.hash = "#chat";
    void restoreSessionView(session.sessionId);
  });
  row.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    openMenu(row, [
      { label: "查看（只读恢复视图）", onClick: () => void row.dispatchEvent(new Event("click")) },
      { label: "复制会话 ID", onClick: () => void copyText(session.sessionId, "已复制会话 ID") },
      { label: "删除会话", danger: true, onClick: () => void deleteSession(session) },
    ]);
  });
  return row;
}

/** 只读恢复（history.js 同款——resetStream 后 renderHistory）。 */
async function restoreSessionView(sessionId) {
  const view = await sendQuery({ sessionId, op: "events" });
  if (!view.ok) {
    toast(`查看失败：${view.error?.message ?? ""}`, "warn");
    return;
  }
  hooks.resetStreamView();
  hooks.renderHistory(view.result.events ?? []);
  appendLine("── 只读视图：续聊请执行 aegent sessions resume " + sessionId + " ──", "warn");
}

async function deleteSession(session) {
  const ok = await confirmDialog(`确认删除会话「${(session.title ?? "") !== "" ? session.title : session.sessionId}」？事件不可恢复。`, { danger: true });
  if (ok !== true) return;
  const del = await sendSettings({ op: "session-delete", sessionId: session.sessionId });
  if (!del.ok) {
    toast(`删除失败：${del.error?.message ?? ""}`, "warn");
    return;
  }
  appendLine(`已删除会话 ${session.sessionId}`, "meta");
  await refreshSidebar();
}

/** 导入会话 JSON 包（history.js「导入会话 JSON」迁入——query op:"import"）。 */
async function importSessionsJson() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.jsonl";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    const text = await file.text();
    const envelope = await sendQuery({ sessionId: getSessionId() || "-", op: "import", payload: text });
    if (!envelope.ok) {
      toast(`导入失败：${envelope.error?.message ?? ""}`, "warn");
      return;
    }
    toast("会话已导入", "info");
    await refreshSidebar();
  });
  input.click();
}

/** 行内时间显示（history.js 语义：今天=HH:MM / 昨天=前缀 / 更早=日期）。 */
function rowTimeLabel(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return "?";
  const d = new Date(ts);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return hm;
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// 文件树滑入层（查看文件——需求二.4「左侧栏变文件树」；点击文件 → 面板预览）
// ---------------------------------------------------------------------------

async function showFileTree(projectId) {
  const project = (settingsCache?.projects ?? []).find((p) => p.id === projectId);
  if (project === undefined) {
    toast("项目不存在", "warn");
    return;
  }
  filesProjectId = projectId;
  const filesBox = document.getElementById("sb-files");
  const projBox = document.getElementById("sb-projects");
  const histBox = document.getElementById("sb-history");
  if (filesBox === null || projBox === null || histBox === null) return;
  treeGeneration += 1;

  projBox.hidden = true;
  histBox.hidden = true;
  filesBox.hidden = false;

  const head = document.createElement("div");
  head.className = "sb-files-head";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "sb-back-btn";
  back.textContent = "← 项目";
  back.title = "返回项目列表";
  back.addEventListener("click", () => void hideFileTree());
  const label = document.createElement("span");
  label.className = "sb-label sb-files-title";
  label.textContent = `📁 ${project.name}`;
  label.title = project.folders[0] ?? "";
  head.append(back, label);

  const treeBox = document.createElement("div");
  treeBox.className = "sb-files-tree";
  filesBox.replaceChildren(head, treeBox);
  await renderFileTree(treeBox, {
    project,
    generation: treeGeneration,
    onOpenFile: (filePath) => void openFilePane(filePath, project),
  });
}

async function hideFileTree() {
  filesProjectId = null;
  const filesBox = document.getElementById("sb-files");
  if (filesBox !== null) filesBox.hidden = true;
  await refreshSidebar();
}

// ---------------------------------------------------------------------------
// 数据操作（projects.js 迁入——添加三模式 / 编辑 / 删除 / 设活动 / 新建任务）
// ---------------------------------------------------------------------------

/** 新建任务：无项目时引导添加；有项目时选择 + 设活动 + 重启指引。 */
async function createTask(project) {
  const ok = await confirmDialog(
    `新建任务「${project.name}」：将把该项目设为活动工作区。当前 host 是单会话架构——重启后（桌面壳重开或终端重跑 aegent）新会话即以 ${project.folders[0] ?? ""} 启动，第一句话会自动命名任务。`,
  );
  if (ok !== true) return;
  await setActiveProject(project);
}

/** 顶部「新建任务」入口：无项目 → 添加对话框；有项目 → 项目选择。 */
export async function newTaskFlow() {
  const projects = sortedProjects();
  if (projects.length === 0) {
    await openAddDialog();
    return;
  }
  const select = document.createElement("select");
  select.className = "input";
  for (const project of projects) {
    const opt = document.createElement("option");
    opt.value = project.id;
    opt.textContent = project.name;
    select.appendChild(opt);
  }
  await new Promise((resolve) => {
    openDialog({
      title: "新建任务",
      description: "选择项目并设为活动工作区——重启后新会话即该项目的任务。",
      body: select,
      onClose: () => resolve(null),
      actions: [
        { label: "取消", className: "btn btn-ghost", onClick: () => resolve(null) },
        { label: "设为活动", className: "btn btn-primary", onClick: () => resolve(select.value) },
      ],
    });
  }).then(async (picked) => {
    const project = projects.find((p) => p.id === picked);
    if (project !== undefined) await createTask(project);
  });
}

async function setActiveProject(project) {
  settingsCache.activeProject = project.id;
  project.lastOpenedAt = Date.now();
  dirtySections.add("projects");
  dirtySections.add("activeProject"); // 活动态是独立顶层字段——漏标脏则重启后不生效
  markDirty("projects");
  markDirty("activeProject");
  await flushSettings();
  toast(`已设「${project.name}」为活动项目——重启后新会话以它启动`, "info");
  await refreshSidebar();
}

async function deleteProject(project) {
  // 删除运行保护（pi-desktop ProjectDeleteDialog 语义——后端拒绝前端友好化）
  if (isActive(project) && agentState.busy) {
    toast("该项目有正在运行的任务——请先停止再删除", "warn");
    return;
  }
  const ok = await confirmDialog(
    `删除项目「${project.name}」？只移除项目记录（不删磁盘文件）${isActive(project) ? "；它当前是活动项目，删除后活动态一并清除" : ""}。`,
    { danger: true },
  );
  if (ok !== true) return;
  const projects = (settingsCache.projects ?? []).filter((p) => p.id !== project.id);
  settingsCache.projects = projects;
  if (isActive(project)) {
    settingsCache.activeProject = undefined;
    delete settingsCache.activeProject;
    dirtySections.add("activeProject");
    markDirty("activeProject");
  }
  pinned.delete(project.id);
  writeIdSet(PIN_KEY, pinned);
  manualOrder = manualOrder.filter((id) => id !== project.id);
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(manualOrder));
  } catch {
    // 同上
  }
  dirtySections.add("projects");
  markDirty("projects");
  await flushSettings();
  toast("项目已删除（磁盘文件未动）", "info");
  await refreshSidebar();
}

async function appendProjects(entries, options = {}) {
  const projects = [...(settingsCache.projects ?? [])];
  let added = 0;
  let skipped = 0;
  const existing = new Set(projects.map((p) => normalizePath(p.folders[0] ?? "")));
  for (const entry of entries) {
    const key = normalizePath(entry.folders[0] ?? "");
    if (existing.has(key)) {
      skipped += 1;
      continue;
    }
    existing.add(key);
    projects.push({
      id: projectId(),
      name: entry.name,
      folders: entry.folders,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    });
    added += 1;
  }
  settingsCache.projects = projects;
  dirtySections.add("projects");
  markDirty("projects");
  await flushSettings();
  if (options.silent !== true) {
    toast(
      skipped > 0 ? `已添加 ${String(added)} 个项目（${String(skipped)} 个已存在跳过）` : `已添加 ${String(added)} 个项目`,
      "info",
    );
  }
  await refreshSidebar();
  return { added, skipped };
}

async function openEditDialog(project) {
  const nameInput = document.createElement("input");
  nameInput.className = "input";
  nameInput.type = "text";
  nameInput.value = project.name;
  const foldersInput = document.createElement("textarea");
  foldersInput.className = "textarea";
  foldersInput.rows = 4;
  foldersInput.value = project.folders.join("\n");
  const body = document.createElement("div");
  body.innerHTML = `<p class="hint">项目名</p>`;
  body.appendChild(nameInput);
  const hint2 = document.createElement("p");
  hint2.className = "hint";
  hint2.style.marginTop = "8px";
  hint2.textContent = "工作区目录（每行一个——第一个为主目录）";
  body.append(hint2, foldersInput);
  await new Promise((resolve) => {
    openDialog({
      title: "编辑项目",
      body,
      onClose: () => resolve(null),
      actions: [
        { label: "取消", className: "btn btn-ghost", onClick: () => resolve(null) },
        { label: "保存", className: "btn btn-primary", onClick: () => resolve(true) },
      ],
    });
  }).then(async (picked) => {
    if (picked !== true) return;
    const name = nameInput.value.trim();
    const folders = foldersInput.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");
    if (name === "" || folders.length === 0) {
      toast("名称与至少一个目录都要有", "warn");
      return;
    }
    project.name = name;
    project.folders = folders;
    dirtySections.add("projects");
    markDirty("projects");
    await flushSettings();
    toast("项目已更新", "info");
    await refreshSidebar();
  });
}

function projectId() {
  const c = globalThis.crypto;
  if (c !== undefined && typeof c.randomUUID === "function") {
    return `p-${c.randomUUID().slice(0, 8)}`; // 方法必须在 crypto 上下文上调用（抽出即 Illegal invocation）
  }
  return `p-${String(Date.now())}-${Math.random().toString(36).slice(2, 6)}`;
}

function normalizePath(p) {
  return p.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
}

function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// ---------------------------------------------------------------------------
// 添加项目对话框（三模式全量——projects.js 原样迁入，渲染目标不变）
// ---------------------------------------------------------------------------

async function openAddDialog() {
  const body = document.createElement("div");
  const tabs = document.createElement("div");
  tabs.className = "proj-add-tabs";
  const bodyBox = document.createElement("div");
  body.append(tabs, bodyBox);
  const paint = (mode) => {
    if (mode === "folder") {
      bodyBox.innerHTML = `
        <p class="hint">每行一个本机目录（绝对路径）——多目录会合并为一个项目（第一个为主目录）。</p>
        <textarea class="textarea" data-field="folders" rows="4" placeholder="F:\\work\\my-app"></textarea>
        <p class="hint" style="margin-top:8px">项目名（缺省 = 主目录名）</p>
        <input class="input" data-field="name" type="text" placeholder="自动推导" autocomplete="off" />
      `;
    } else if (mode === "git") {
      bodyBox.innerHTML = `
        <p class="hint">仓库地址（https / git@）——clone 到父目录后即成为项目。</p>
        <input class="input" data-field="url" type="text" placeholder="https://github.com/user/repo.git" autocomplete="off" />
        <p class="hint" style="margin-top:8px">clone 父目录（仓库将落到 父目录/仓库名）</p>
        <input class="input" data-field="parent" type="text" placeholder="F:\\work" autocomplete="off" />
        <p class="hint" style="margin-top:8px">目录名（缺省 = 仓库名推导）</p>
        <input class="input" data-field="cloneName" type="text" placeholder="自动推导" autocomplete="off" />
      `;
    } else {
      bodyBox.innerHTML = `
        <p class="hint">扫描本机其他 AI 工具（Claude Code / Codex / OpenCode / WorkBuddy / Pi / Gemini CLI + 自定义来源）的会话记录——勾选会话导入为任务（按原始目录自动归属项目），或仅把目录建为项目。</p>
        <div class="row-control" style="margin-top:8px"><button type="button" class="btn btn-primary" data-action="import-scan">扫描本机工具</button><span data-field="import-status" class="proj-card-meta"></span></div>
        <div data-field="importSources" class="proj-import-sources"></div>
        <div class="proj-import-list" data-field="importList"><div class="hint">点击上方「扫描本机工具」开始。</div></div>
        <div class="row-control" style="margin-top:8px" data-field="import-actions" hidden>
          <button type="button" class="btn btn-primary" data-action="import-sessions">导入为会话</button>
          <button type="button" class="btn" data-action="import-folders">仅把目录建为项目</button>
        </div>
      `;
      bodyBox.querySelector("[data-action=import-scan]").addEventListener("click", () => void runImportScan(bodyBox));
      bodyBox.querySelector("[data-action=import-sessions]").addEventListener("click", () => void importCheckedSessions(bodyBox));
      bodyBox.querySelector("[data-action=import-folders]").addEventListener("click", () => void importCheckedFolders(bodyBox));
    }
  };
  let mode = "folder";
  for (const tabMode of ["folder", "git", "import"]) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `btn proj-add-tab${tabMode === mode ? " active" : ""}`;
    tab.textContent = { folder: "本机文件夹", git: "Git 仓库", import: "扫描导入" }[tabMode];
    tab.addEventListener("click", () => {
      mode = tabMode;
      for (const t of tabs.querySelectorAll(".proj-add-tab")) t.classList.remove("active");
      tab.classList.add("active");
      paint(mode);
    });
    tabs.appendChild(tab);
  }
  paint(mode);
  await new Promise((resolve) => {
    openDialog({
      title: "添加项目",
      body,
      width: "lg",
      onClose: () => resolve(null),
      actions: [
        { label: "取消", className: "btn btn-ghost", onClick: () => resolve(null) },
        { label: "添加", className: "btn btn-primary", onClick: () => resolve(mode) },
      ],
    });
  }).then(async (picked) => {
    if (picked === null) return;
    const field = (name) => bodyBox.querySelector(`[data-field=${name}]`);
    if (picked === "folder") {
      const folders = (field("folders")?.value ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/^"|"$/g, ""))
        .filter((line) => line !== "");
      if (folders.length === 0) {
        toast("至少填一个目录", "warn");
        return;
      }
      const derived = folders[0].split(/[\\/]/).filter(Boolean).pop() ?? "project";
      const name = (field("name")?.value ?? "").trim() || derived;
      await appendProjects([{ name, folders }]);
      return;
    }
    if (picked === "git") {
      const url = (field("url")?.value ?? "").trim();
      const parentDir = (field("parent")?.value ?? "").trim();
      const cloneName = (field("cloneName")?.value ?? "").trim();
      if (url === "" || parentDir === "") {
        toast("仓库地址与父目录都要填", "warn");
        return;
      }
      toast("clone 中…（大仓库可能较久）", "info");
      const envelope = await sendSettings({
        op: "git-clone",
        url,
        dir: parentDir,
        ...(cloneName !== "" ? { name: cloneName } : {}),
      });
      if (!envelope.ok) {
        toast(`clone 失败：${envelope.error?.message ?? ""}`, "warn");
        return;
      }
      const repoPath = envelope.result.path;
      const projectName = repoPath.split(/[\\/]/).filter(Boolean).pop() ?? "repo";
      await appendProjects([{ name: projectName, folders: [repoPath] }]);
      return;
    }
    // import 模式：对话框确认 = 会话导入（新面板的主路径——目录建项目走
    // "仅把目录建为项目"按钮）
    const checked = [...bodyBox.querySelectorAll(".proj-import-row input[type=checkbox]")].filter(
      (check) => check.checked === true && check.disabled === false,
    );
    if (checked.length === 0) {
      toast("未勾选任何会话", "warn");
      return;
    }
    await importCheckedSessions(bodyBox);
  });
}

async function runImportScan(bodyBox) {
  const listBox = bodyBox.querySelector("[data-field=importList]");
  const statusBox = bodyBox.querySelector("[data-field=import-status]");
  const sourcesBox = bodyBox.querySelector("[data-field=importSources]");
  const actionsBox = bodyBox.querySelector("[data-field=import-actions]");
  if (listBox === null || statusBox === null) return;
  listBox.textContent = "扫描中…（并行探测各工具本地会话库，只读）";
  const envelope = await sendSettings({ op: "import-scan" });
  if (!envelope.ok) {
    listBox.textContent = `扫描失败：${envelope.error?.message ?? ""}`;
    return;
  }
  const { candidates = [], sessions = [], sources = [], customErrors = [] } = envelope.result;
  // 来源徽标行（每源会话数/未检测到/自定义）
  sourcesBox.replaceChildren(
    ...sources.map((s) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent =
        s.sessionCount > 0
          ? `${s.label} ${String(s.sessionCount)}${s.custom === true ? "（自定义）" : ""}`
          : `${s.label} 未检测到${s.note !== undefined ? `——${s.note}` : ""}`;
      return chip;
    }),
  );
  if (customErrors.length > 0) {
    const err = document.createElement("div");
    err.className = "proj-tree-error";
    err.textContent = `自定义来源被拒：${customErrors.join("；")}`;
    sourcesBox.appendChild(err);
  }
  if (sessions.length === 0) {
    listBox.innerHTML = `<div class="hint">没扫到会话——各工具都未安装或没有历史记录。</div>`;
    actionsBox.hidden = true;
    return;
  }
  // 会话按 projectPath 归组（组头全选 + 会话行勾选/预览）
  const groups = new Map();
  for (const session of sessions) {
    const key = session.projectPath ?? "(未定位目录)";
    const list = groups.get(key) ?? [];
    list.push(session);
    groups.set(key, list);
  }
  const existingPaths = new Set(
    (settingsCache?.projects ?? []).map((p) => normalizePath(p.folders[0] ?? "")),
  );
  listBox.replaceChildren(
    ...[...groups.entries()].map(([cwd, groupSessions]) => {
      const box = document.createElement("div");
      box.className = "proj-import-group";
      const head = document.createElement("label");
      head.className = "proj-import-group-head";
      const groupCheck = document.createElement("input");
      groupCheck.type = "checkbox";
      groupCheck.checked = true;
      groupCheck.addEventListener("change", () => {
        for (const rowCheck of box.querySelectorAll(".proj-import-row input[type=checkbox]")) {
          rowCheck.checked = groupCheck.checked;
        }
      });
      const headText = document.createElement("span");
      const already = existingPaths.has(normalizePath(cwd));
      headText.innerHTML = `<b>${escapeHtml(cwd)}</b> <span class="proj-card-meta">${String(groupSessions.length)} 会话${already ? " · 已是项目" : ""}</span>`;
      head.append(groupCheck, headText);
      box.appendChild(head);
      for (const session of groupSessions) {
        const row = document.createElement("label");
        row.className = "proj-import-row";
        row.style.paddingLeft = "20px";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = true;
        const copy = document.createElement("span");
        copy.className = "proj-import-copy";
        copy.innerHTML = `${escapeHtml(session.title)} <span class="proj-card-meta">${session.source} · ${new Date(session.updatedAt).toLocaleString("zh-CN")} · ${String(session.messageCount)} 条</span>`;
        const previewLink = document.createElement("button");
        previewLink.type = "button";
        previewLink.className = "btn btn-ghost";
        previewLink.textContent = "预览";
        previewLink.addEventListener("click", (ev) => {
          ev.preventDefault();
          void previewImportedSession(session);
        });
        row.append(check, copy, previewLink);
        row.dataset.source = session.source;
        row.dataset.externalId = session.externalId;
        row.dataset.projectPath = session.projectPath ?? "";
        box.appendChild(row);
      }
      return box;
    }),
  );
  actionsBox.hidden = false;
  statusBox.textContent = `共 ${String(sessions.length)} 条会话`;
}

/** 勾选会话 → op import-sessions（幂等账+事件流重建+按原始目录归属项目）。 */
async function importCheckedSessions(bodyBox) {
  const rows = [...bodyBox.querySelectorAll(".proj-import-row")].filter((row) => {
    const check = row.querySelector("input[type=checkbox]");
    return check !== null && check.checked === true;
  });
  if (rows.length === 0) {
    toast("未勾选任何会话", "warn");
    return;
  }
  const statusBox = bodyBox.querySelector("[data-field=import-status]");
  if (statusBox !== null) statusBox.textContent = "导入中…（逐条转换写入会话库）";
  const importItems = rows.map((row) => ({
    source: row.dataset.source,
    externalId: row.dataset.externalId,
    ...(row.dataset.projectPath !== "" && row.dataset.projectPath !== undefined ? { projectPath: row.dataset.projectPath } : {}),
  }));
  const envelope = await sendSettings({ op: "import-sessions", importItems });
  if (!envelope.ok) {
    toast(`导入失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  const { imported = 0, skipped = 0, failed = 0 } = envelope.result;
  toast(`导入 ${String(imported)} 条会话（${String(skipped)} 条已存在跳过${failed > 0 ? `，${String(failed)} 条失败` : ""}）——导入的会话已按目录归属项目`, imported > 0 ? "info" : "warn");
  // 已导行禁用（防重复勾选——幂等账在服务端兜底）
  for (const row of rows) {
    const check = row.querySelector("input[type=checkbox]");
    if (check !== null) {
      check.checked = false;
      check.disabled = true;
    }
  }
  await refreshSidebar();
}

/** 勾选会话的原始目录 → 建项目（不导内容）。 */
async function importCheckedFolders(bodyBox) {
  const rows = [...bodyBox.querySelectorAll(".proj-import-row")].filter((row) => {
    const check = row.querySelector("input[type=checkbox]");
    return check !== null && check.checked === true;
  });
  const cwds = new Set(rows.map((row) => row.dataset.projectPath).filter((p) => p !== undefined && p !== ""));
  if (cwds.size === 0) {
    toast("勾选的会话没有可定位的目录", "warn");
    return;
  }
  await appendProjects(
    [...cwds].map((cwd) => ({ name: cwd.split(/[\\/]/).filter(Boolean).pop() ?? "project", folders: [cwd] })),
  );
}

/** B1 会话预览：convert 单会话 → 对话渲染（用户/助手/工具折叠）。 */
async function previewImportedSession(session) {
  const envelope = await sendSettings({ op: "import-preview", source: session.source, path: session.externalId });
  if (!envelope.ok) {
    toast(`预览失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  const messages = envelope.result.messages ?? [];
  const body = document.createElement("div");
  body.className = "proj-import-preview";
  for (const message of messages.slice(0, 200)) {
    const line = document.createElement("div");
    line.className = `proj-import-msg proj-import-msg-${message.role}`;
    if (message.role === "tool") {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `🔧 ${message.toolName ?? "tool"}${message.toolError === true ? "（错误）" : ""}`;
      const pre = document.createElement("pre");
      pre.className = "proj-preview-code";
      pre.textContent = `${message.toolArgs !== undefined ? JSON.stringify(message.toolArgs, null, 1).slice(0, 500) : ""}\n→ ${String(message.toolResult ?? "").slice(0, 800)}`;
      details.append(summary, pre);
      line.appendChild(details);
    } else {
      const who = document.createElement("div");
      who.className = "proj-import-msg-who";
      who.textContent = message.role === "user" ? "用户" : "助手";
      const text = document.createElement("div");
      text.textContent = String(message.text ?? "").slice(0, 1200);
      line.append(who, text);
    }
    body.appendChild(line);
  }
  openDialog({
    title: `预览：${session.title}`,
    body,
    width: "lg",
    actions: [{ label: "关闭", className: "btn" }],
  });
}

// ---------------------------------------------------------------------------
// 小件
// ---------------------------------------------------------------------------

function sectionHead(title, actionLabel, onAction, actionTitle = "") {
  const head = document.createElement("div");
  head.className = "sb-section-head";
  const label = document.createElement("span");
  label.className = "sb-section-title";
  label.textContent = title;
  head.appendChild(label);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sb-section-action";
  btn.textContent = actionLabel;
  btn.title = actionTitle || actionLabel;
  btn.addEventListener("click", onAction);
  head.appendChild(btn);
  return head;
}

function emptyGuide() {
  const guide = document.createElement("button");
  guide.type = "button";
  guide.className = "sb-empty-guide";
  guide.innerHTML = `<div class="sb-empty-title">还没有项目</div><div class="sb-empty-desc">添加本机文件夹 / Git 仓库 / 扫描其他工具的项目记录</div>`;
  guide.addEventListener("click", () => void openAddDialog());
  return guide;
}
