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

import { sendQuery, sendSettings, invalidateMetaCache, IS_DESKTOP } from "./api.js";

/** 桌面壳 Tauri command 直调（pane-browser.js 同款——不引壳运行时）。 */
function tauriInvoke(cmd, args) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args);
}

import { settingsCache, setSettingsCache, getSessionId, setSessionId, hooks, applyAppearance } from "./state.js";
import { toast, appendLine } from "./feedback.js";
import { openMenu, confirmDialog, openDialog, markDirty, dirtySections, flushSettings, onSectionRefresh, upgradeSelects } from "./views/settings/core.js";
import { renderFileTree, copyText } from "./views/projects-files.js";
import { openFilePane } from "./pane.js";
import { icon, injectIcons } from "./icons.js";

// ---------------------------------------------------------------------------
// 本地偏好（置顶 / 手动顺序 / 展开——localStorage 持久化）
// ---------------------------------------------------------------------------

const PIN_KEY = "aegent.pinnedProjects";
const ORDER_KEY = "aegent.projectOrder";
const EXPAND_KEY = "aegent.expandedProjects";
// 任务行会话元数据（T-P3-165 需求 2——pi-desktop sidebarPreferences 同构：
// pinned/archived 是 renderer 本地元数据不动内核；归档默认隐藏）
const TASK_META_KEY = "aegent.sessionMeta";
const SHOW_ARCHIVED_KEY = "aegent.showArchivedTasks";

function readTaskMeta() {
  try {
    const raw = JSON.parse(localStorage.getItem(TASK_META_KEY) ?? "{}");
    return raw !== null && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeTaskMeta() {
  try {
    localStorage.setItem(TASK_META_KEY, JSON.stringify(taskMeta));
  } catch {
    // 存储不可用——置顶/归档退化为会话内有效
  }
}

let taskMeta = readTaskMeta();
let showArchivedTasks = false;
try {
  showArchivedTasks = JSON.parse(localStorage.getItem(SHOW_ARCHIVED_KEY) ?? "false") === true;
} catch {
  showArchivedTasks = false;
}

function taskPinned(sid) {
  return taskMeta[sid]?.pinned === true;
}

function taskArchived(sid) {
  return taskMeta[sid]?.archived === true;
}

// 两段式删除武装表（pi-desktop armedDelete 同语义——3s 内二次点击才真删）
const armedDeletes = new Set();
function deleteArmed(sid) {
  const hit = armedDeletes.delete(sid);
  if (hit) return true;
  armedDeletes.add(sid);
  setTimeout(() => armedDeletes.delete(sid), 3000);
  return false;
}

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
let expandBootstrapped = false; // 活动项目默认展开——会话内只做一次

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
  // T-P3-170：多会话实时刷新——任一会话的轮边界/审批态变化 → 节流刷侧栏
  //（任务行状态点/标题/最近会话跟上；text-delta 不发脏标记——频率受控）
  let dirtyTimer = null;
  window.addEventListener("sb:tasks-dirty", () => {
    if (dirtyTimer !== null) return;
    dirtyTimer = setTimeout(() => {
      dirtyTimer = null;
      void refreshSidebar();
    }, 500);
  });
  // 首拉不在此处——sendSettings 依赖已建立的 WS（api.js send 为 null 时
  // 抛），由 app.js 的 hello 握手回执触发首次 refreshSidebar（连接就绪时点）
}

/** 全量刷新（settings 变更 / 会话信号 / 启动——冷启动强制拉 settings）。 */
export async function refreshSidebar() {
  if (settingsCache === null) {
    invalidateMetaCache();
    const envelope = await sendSettings({ op: "get" });
    if (envelope.ok) {
      setSettingsCache(envelope.result.settings);
      applyAppearance(); // T-P3-157：启动首拉后应用外观（此前仅设置保存路径生效——重启必回暗色）
    }
  }
  // 活动项目默认展开（会话内一次——首次使用无展开记录时；此后用户手动
  // 折叠不被反复撑开）。zcode 任务列表常显语义：对话时项目下任务行可见，
  // 运行呼吸点才有舞台。
  if (!expandBootstrapped && settingsCache?.activeProject) {
    expandBootstrapped = true;
    if (expandedProjects.size === 0) {
      expandedProjects.add(settingsCache.activeProject);
      writeIdSet(EXPAND_KEY, expandedProjects);
    }
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
  box.replaceChildren();
  if (project !== undefined) {
    box.append(icon("folder", { cls: "icon-sm" }), document.createTextNode(` ${project.name}`));
  }
  if (current !== undefined && (current.title ?? "") !== "") {
    if (project !== undefined) box.appendChild(document.createTextNode(" · "));
    box.appendChild(document.createTextNode(current.title));
  }
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
  caret.className = `sb-caret${expanded ? " open" : ""}`;
  caret.replaceChildren(icon("chevronDown", { cls: "icon-sm" }));
  const dirIcon = expanded ? icon("folderOpen", { cls: "icon-sm" }) : icon("folder", { cls: "icon-sm" });
  const iconWrap = document.createElement("span");
  iconWrap.className = "sb-icon";
  iconWrap.replaceChildren(dirIcon);
  const name = document.createElement("span");
  name.className = "sb-label";
  name.textContent = project.name;
  name.title = project.folders[0] ?? "";
  head.append(caret, iconWrap, name);
  if (isActive(project)) {
    head.appendChild(chipEl("活动", "sb-chip-active"));
  }
  if (pinned.has(project.id)) {
    const pinChip = chipEl("", "sb-chip-pin");
    pinChip.replaceChildren(icon("pin", { cls: "icon-sm" }));
    head.appendChild(pinChip);
  }
  if (project.missing === true) {
    head.appendChild(chipEl("missing", "sb-chip-missing"));
  }
  if (!expanded && running) {
    head.appendChild(chipEl("", "sb-chip-running")); // 折叠态呼吸圆点=仍有 Agent 在跑
  }

  // hover 浮层：+ 新建任务 / ⋯ 菜单（pideck 行尾浮层——absolute 不占布局）
  const hover = document.createElement("div");
  hover.className = "sb-hover-actions";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "sb-hover-btn";
  addBtn.replaceChildren(icon("plus", { cls: "icon-sm" }));
  addBtn.setAttribute("aria-label", "添加");
  addBtn.title = "新建任务（设为活动工作区）";
  addBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    void createTask(project);
  });
  const filesBtn = document.createElement("button");
  filesBtn.type = "button";
  filesBtn.className = "sb-hover-btn";
  filesBtn.replaceChildren(icon("folderOpen", { cls: "icon-sm" }));
  filesBtn.title = "查看文件（文件树）";
  filesBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    void showFileTree(project.id);
  });
  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "sb-hover-btn";
  moreBtn.replaceChildren(icon("more", { cls: "icon-sm" }));
  moreBtn.setAttribute("aria-label", "更多操作");
  moreBtn.title = "项目操作";
  moreBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    openMenu(moreBtn, projectMenuItems(project));
  });
  hover.append(addBtn, filesBtn, moreBtn);
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

  // — 展开区：任务列表（查看文件入口收敛到行尾悬浮钮/⋯菜单——T-P3-158 反馈 3） —
  if (expanded) {
    caret.classList.add("open");
    const taskBox = document.createElement("div");
    taskBox.className = "sb-tasks";
    taskBox.textContent = "任务加载中…";
    row.appendChild(taskBox);
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
      // T-P3-165 需求 2（pi 排序菜单的 Show archived 迁到项目菜单——发现性优先）
      label: showArchivedTasks ? "隐藏已归档任务" : "显示已归档任务",
      onClick: () => {
        showArchivedTasks = !showArchivedTasks;
        try {
          localStorage.setItem(SHOW_ARCHIVED_KEY, JSON.stringify(showArchivedTasks));
        } catch {
          // 存储不可用——开关会话内有效
        }
        void paintProjects();
      },
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
  // 归档默认隐藏（pi archiveSession 语义——"显示已归档任务"开关在项目菜单）
  const tasks = (envelope.result.tasks ?? [])
    .filter((t) => showArchivedTasks || taskArchived(t.sessionId) !== true)
    .sort((a, b) => {
      const pin = Number(taskPinned(b.sessionId)) - Number(taskPinned(a.sessionId));
      if (pin !== 0) return pin;
      return b.updatedTs - a.updatedTs;
    });
  if (tasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sb-tasks-empty";
    empty.textContent = showArchivedTasks ? "没有任务" : "还没有任务——项目行 + 号直接新建";
    taskBox.appendChild(empty);
    return;
  }
  for (const task of tasks) {
    taskBox.appendChild(taskRow(task));
  }
  // 展开任务的项目顺带刷 topbar（当前会话标题可能刚生成）
  refreshTopbar();
}

/** 任务行全功能菜单（T-P3-165 需求 2——pi-desktop openSessionRowMenu 同
 *  构：重命名/置顶/归档/从此处分支/复制对话 ID/打开会话路径/删除；删除
 *  两段式武装 3s；菜单项图标 lucide 语义名）。 */
function taskMenuItems(task, refresh) {
  const sid = task.sessionId;
  return [
    { label: "重命名任务", icon: "edit", onClick: () => void renameTask(task) },
    {
      label: taskPinned(sid) ? "取消置顶" : "置顶",
      icon: "pin",
      onClick: () => {
        const meta = (taskMeta[sid] = taskMeta[sid] ?? {});
        meta.pinned = meta.pinned !== true;
        writeTaskMeta();
        void refresh();
      },
    },
    {
      label: taskArchived(sid) ? "恢复任务" : "归档",
      icon: taskArchived(sid) ? "archiveRestore" : "archive",
      onClick: () => {
        const meta = (taskMeta[sid] = taskMeta[sid] ?? {});
        meta.archived = meta.archived !== true;
        writeTaskMeta();
        void refresh();
      },
    },
    { label: "从此处分支", icon: "gitFork", onClick: () => void forkTaskSession(task) },
    {
      label: "复制对话 ID",
      icon: "copy",
      onClick: () => {
        void copyText(sid)
          .then(() => toast("对话 ID 已复制", "info"))
          .catch(() => toast("复制失败——浏览器未授权剪贴板", "warn"));
      },
    },
    { label: "打开会话路径", icon: "folder", onClick: () => void openSessionPath(task) },
    {
      label: "删除任务",
      icon: "trash",
      danger: true,
      keepOpen: true,
      onClick: (btn) => {
        // 两段式武装（pi armedDelete：第一次点仅变红改文案，3s 内再点真删）
        if (deleteArmed(sid)) {
          void deleteTask(task);
          return;
        }
        btn.classList.add("armed");
        btn.replaceChildren(icon("trash", { cls: "icon-sm" }), document.createTextNode(" 确认删除？"));
      },
    },
  ];
}

function taskRow(task) {
  const row = document.createElement("div");
  row.className = "sb-task-row";
  const isCurrent = task.sessionId === getSessionId();
  // 行首状态槽（pi-desktop sidebar-session-status 归一：待审批 > 运行 >
  // 空闲无色——空闲保留透明占位点，行首对齐不跳）。
  // T-P3-170：状态源 = 全会话状态表（后台任务的实时运行/待审态也可见）；
  // 当前会话兜底全局态（恢复视图重放无 live 广播的窗口）。
  const st = window.__sessionStates?.[task.sessionId] ?? {};
  const awaiting = st.awaiting === true || (isCurrent && agentState2.awaiting === true);
  const busy = st.busy === true || (isCurrent && agentState.busy === true);
  const dot = document.createElement("span");
  dot.className = "sb-task-dot";
  if (awaiting) {
    dot.classList.add("awaiting");
    dot.title = "等待你的审批/答复";
  } else if (busy) {
    dot.classList.add("busy");
    dot.title = "运行中";
  } else {
    dot.title = isCurrent ? "当前会话" : "历史任务";
  }
  const title = document.createElement("span");
  title.className = "sb-label";
  title.textContent = task.title !== "" ? task.title : task.sessionId;
  const meta = document.createElement("span");
  meta.className = "sb-task-meta";
  meta.textContent = new Date(task.updatedTs).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  row.append(dot, title, meta);
  if (isCurrent) row.classList.add("current");
  if (taskPinned(task.sessionId)) {
    // pi thread-item-pin：标题前置小图钉
    const pin = document.createElement("span");
    pin.className = "sb-task-pin";
    pin.replaceChildren(icon("pin", { cls: "icon-sm" }));
    row.append(pin);
  }
  const refresh = () => {
    const box = row.parentElement;
    if (box !== null && box.classList.contains("sb-tasks")) {
      // 就地重排（pin/archive 切换——不整树重拉，避免滚动位丢失）
      box.replaceChildren();
      void loadTasks(box, { id: row.closest(".sb-project")?.dataset.id ?? "" });
    }
  };
  // hover ⋯ 钮（pi thread-item-status 同位——hover/focus 显隐）
  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "sb-row-more";
  moreBtn.setAttribute("aria-label", "任务操作");
  moreBtn.title = "任务操作";
  moreBtn.replaceChildren(icon("more", { cls: "icon-sm" }));
  moreBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    openMenu(moreBtn, taskMenuItems(task, refresh));
  });
  row.appendChild(moreBtn);
  row.addEventListener("click", () => void switchToSession(task.sessionId));
  row.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    openMenu(row, taskMenuItems(task, refresh));
  });
  return row;
}

/**
 * 分支会话（T-P3-156 方案 I——需求三.4）：session/fork（E5 内核——
 * store.fork 复制历史+lineage 事件，forked 回执经 W 消费刷侧栏）。
 * 切点语义：after = 复制全部历史到新会话（默认）；atSeq = 从指定序号前
 * 分叉（高级）。内核只从 idle 会话分叉——运行中当前会话入口会类型化拒绝
 * （toast 如实呈现）。
 */
async function forkTaskSession(task) {
  const modeSelect = document.createElement("select");
  modeSelect.className = "input";
  for (const [value, label] of [
    ["after", "复制全部历史（最新状态后分叉）"],
    ["at", "从指定轮前分叉（填事件序号 atSeq）"],
  ]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    modeSelect.appendChild(opt);
  }
  const seqInput = document.createElement("input");
  seqInput.className = "input";
  seqInput.type = "text";
  seqInput.placeholder = "atSeq（事件序号，切点前的历史不进新会话）";
  seqInput.hidden = true;
  modeSelect.addEventListener("change", () => {
    seqInput.hidden = modeSelect.value !== "at";
  });
  const body = document.createElement("div");
  body.append(modeSelect, seqInput);
  await new Promise((resolve) => {
    openDialog({
      title: `分支会话：「${task.title !== "" ? task.title : task.sessionId}」`,
      description: "fork 会复制所选历史为新会话（原会话不动）；forked 回执后新会话出现在「最近会话」。",
      body,
      onClose: () => resolve(null),
      actions: [
        { label: "取消", className: "btn btn-ghost", onClick: () => resolve(null) },
        { label: "创建分支", className: "btn btn-primary", onClick: () => resolve(true) },
      ],
    });
  }).then(async (picked) => {
    if (picked !== true) return;
    const request = { type: "session/fork", targetId: task.sessionId };
    if (modeSelect.value === "at") {
      const atSeq = Number(seqInput.value.trim());
      if (!Number.isInteger(atSeq) || atSeq <= 0) {
        toast("atSeq 需为正整数（可在日志/事件里看序号）", "warn");
        return;
      }
      request.position = "before";
      request.atSeq = atSeq;
    } else {
      request.position = "after";
    }
    try {
      const sid = getSessionId();
      if (sid === "") {
        toast("会话未就绪（fork 请求经当前 host 会话路由）", "warn");
        return;
      }
      const { sendRequest } = await import("./api.js");
      await sendRequest(sid, request);
      // forked 回执（notification）在 app.js W 分支：toast + 刷侧栏
    } catch (e) {
      toast(`fork 失败：${e?.message ?? ""}`, "warn");
    }
  });
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
  sessionsCache = (envelope.result.sessions ?? [])
    .filter((s) => showArchivedTasks || taskArchived(s.sessionId) !== true)
    .sort((a, b) => (b.updatedTs ?? 0) - (a.updatedTs ?? 0));
  // 置顶分区（T-P3-166 需求 3——pi sidebar-pinned-sessions 同构：跨项目
  // 集中展示置顶会话；仅当有 pin 时渲染，从最近会话清单抽出）
  const pinnedSessions = sessionsCache.filter((s) => taskPinned(s.sessionId));
  if (pinnedSessions.length > 0) {
    const pinBox = document.createElement("div");
    pinBox.className = "sb-pinned";
    const pinHead = document.createElement("div");
    pinHead.className = "sb-section-title";
    pinHead.textContent = "置顶";
    pinBox.appendChild(pinHead);
    for (const session of pinnedSessions.slice(0, 10)) {
      pinBox.appendChild(sessionRow(session, map));
    }
    box.appendChild(pinBox);
  }
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
  if (taskPinned(session.sessionId)) {
    const pin = document.createElement("span");
    pin.className = "sb-task-pin";
    pin.replaceChildren(icon("pin", { cls: "icon-sm" }));
    row.append(pin);
  }
  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "sb-row-more";
  moreBtn.setAttribute("aria-label", "会话操作");
  moreBtn.replaceChildren(icon("more", { cls: "icon-sm" }));
  moreBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    openMenu(moreBtn, historyMenuItems(session));
  });
  row.appendChild(moreBtn);
  row.addEventListener("click", () => {
    markRead(session.sessionId, Date.now());
    void switchToSession(session.sessionId);
  });
  row.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    openMenu(row, historyMenuItems(session));
  });
  return row;
}

/** 最近会话行菜单（T-P3-166 需求 3：置顶/归档入列——跨项目置顶分区的
 *  数据入口；taskMeta 本地元数据与项目任务列表共用）。 */
function historyMenuItems(session) {
  const sid = session.sessionId;
  return [
    { label: "查看（只读恢复视图）", onClick: () => void restoreSessionView(sid).then(() => { location.hash = "#chat"; }) },
    {
      label: taskPinned(sid) ? "取消置顶" : "置顶",
      icon: "pin",
      onClick: () => {
        const meta = (taskMeta[sid] = taskMeta[sid] ?? {});
        meta.pinned = meta.pinned !== true;
        writeTaskMeta();
        void paintHistory();
      },
    },
    {
      label: taskArchived(sid) ? "恢复会话" : "归档",
      icon: taskArchived(sid) ? "archiveRestore" : "archive",
      onClick: () => {
        const meta = (taskMeta[sid] = taskMeta[sid] ?? {});
        meta.archived = meta.archived !== true;
        writeTaskMeta();
        void paintHistory();
      },
    },
    { label: "分支会话（fork 历史快照）", icon: "gitFork", onClick: () => void forkSession(session) },
    { label: "复制会话 ID", icon: "copy", onClick: () => void copyText(sid, "已复制会话 ID") },
    { label: "打开会话路径", icon: "folder", onClick: () => void openSessionPath({ sessionId: sid }) },
    { label: "删除会话", icon: "trash", danger: true, keepOpen: true, onClick: (btn) => {
        if (deleteArmed(sid)) {
          void deleteSession(session);
          return;
        }
        btn.classList.add("armed");
        btn.replaceChildren(icon("trash", { cls: "icon-sm" }), document.createTextNode(" 确认删除？"));
      } },
  ];
}

/** 会话级 fork（同 forkTaskSession——入口在「最近会话」分段）。 */
async function forkSession(session) {
  await forkTaskSession({ sessionId: session.sessionId, title: session.title ?? "" });
}

/** 任务真切换（T-P3-170 单 host 多会话——pi-desktop selectSession 同语义）：
 *  切换 = 纯前端换会话（同 WS 连接，不换进程不重连，毫秒级）；各任务的
 *  child 进程独立存活 = 多任务真并发互不影响；事件流按会话归属分发
 *  （app.js handleEnvelope——后台任务切走后侧栏状态点仍实时更新）。
 *  web 端与桌面端同模型零差异。 */
export async function switchToSession(sessionId) {
  if (sessionId === getSessionId()) {
    location.hash = "#chat";
    return;
  }
  setSessionId(sessionId);
  window.__viewOnlySession = null; // 切换即当前会话（可写）——只读查看态清除
  location.hash = "#chat";
  hooks.resetStreamView();
  // 后台在跑的任务切进来：恢复视图重放无 live 标志——busy 态先从状态表
  // 回放（renderHistory 内 showRecoveryIfInterrupted 对未闭合轮再补盲；
  // 先置位才能让发送/停止钮与队列投影不误判空闲）
  window.__agentBusy = window.__sessionStates?.[sessionId]?.busy === true;
  window.dispatchEvent(new CustomEvent(window.__agentBusy ? "agent:busy" : "agent:idle"));
  const view = await sendQuery({ sessionId, op: "events" });
  if (view.ok) {
    hooks.renderHistory(view.result.events ?? []);
  } else {
    toast(`会话恢复失败：${view.error?.message ?? ""}`, "warn");
  }
  await refreshSidebar();
}

/** 只读恢复（「最近会话」菜单入口保留——resetStream 后 renderHistory，
 *  不切换会话身份）。 */
async function restoreSessionView(sessionId) {
  // T-P3-161：只读视图标记——非当前会话的查看态禁用「编辑/重发」等写操作
  //（编辑回溯作用于当前连接会话，跨会话错位防护）
  window.__viewOnlySession = sessionId === getSessionId() ? null : sessionId;
  const view = await sendQuery({ sessionId, op: "events" });
  if (!view.ok) {
    toast(`查看失败：${view.error?.message ?? ""}`, "warn");
    return;
  }
  hooks.resetStreamView();
  hooks.renderHistory(view.result.events ?? []);
  appendLine("── 只读视图：点击侧栏任务行可切换为当前会话 ──", "warn");
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
  label.append(icon("folder", { cls: "icon-sm" }), document.createTextNode(` ${project.name}`));
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
  // 恢复两分段可见性（showFileTree 切走时把它们 hidden 了——漏恢复即
  // "返回后侧栏空白"（用户反馈 1 根因）；refreshSidebar 的 paintProjects
  // 只管内容渲染不管容器 hidden 态）
  const projBox = document.getElementById("sb-projects");
  const histBox = document.getElementById("sb-history");
  if (projBox !== null) projBox.hidden = false;
  if (histBox !== null) histBox.hidden = false;
  await refreshSidebar();
}

// ---------------------------------------------------------------------------
// 数据操作（projects.js 迁入——添加三模式 / 编辑 / 删除 / 设活动 / 新建任务）
// ---------------------------------------------------------------------------

/** 新建任务（T-P3-170 多会话版——pi newSession 同语义：**无弹窗直接开、
 *  新建立现**）：host 端 task-create op 落库会话行 + 项目归属（毫秒级）→
 *  侧栏立现新任务行 → 直接进入。不再重启 host——同项目/跨项目多任务并发
 *  互不影响（单 host 多 child 模型），web 端同链路零差异。 */
async function createTask(project) {
  await persistActiveProject(project);
  const created = await sendSettings({ op: "task-create", projectId: project.id });
  if (!created.ok) {
    toast(`新任务创建失败：${created.error?.message ?? ""}`, "warn");
    return;
  }
  const sid = created.result?.sessionId;
  await refreshSidebar();
  if (typeof sid === "string" && sid !== "") await switchToSession(sid);
}

/** 顶部「新建任务」入口（快捷键/命令动作保留）：无项目 → 添加；有项目 →
 *  项目选择弹窗后直开。侧栏常驻按钮已退役——日常入口是项目行 + 号。 */
export async function newTaskFlow() {
  const projects = sortedProjects();
  if (projects.length === 0) {
    await openAddDialog();
    return;
  }
  const select = document.createElement("select");
  select.className = "select"; // 挂 upgradeSelects 桥接（P-041——原生 select 视觉退役）
  for (const project of projects) {
    const opt = document.createElement("option");
    opt.value = project.id;
    opt.textContent = project.name;
    select.appendChild(opt);
  }
  await new Promise((resolve) => {
    openDialog({
      title: "新建任务",
      description: "选择要在哪个项目下开启新任务。",
      body: select,
      onClose: () => resolve(null),
      actions: [
        { label: "取消", className: "btn btn-ghost", onClick: () => resolve(null) },
        { label: "开启新任务", className: "btn btn-primary", onClick: () => resolve(select.value) },
      ],
    });
    upgradeSelects(document.body); // P-041：模态内 select 桥接自绘下拉（openDialog 同步挂载 body——扫描幂等）
  }).then(async (picked) => {
    const project = projects.find((p) => p.id === picked);
    if (project !== undefined) await createTask(project);
  });
}

/** 活动项目写盘（flushSettings 落 settings.json——新 host 启动读取）。 */
async function persistActiveProject(project) {
  settingsCache.activeProject = project.id;
  project.lastOpenedAt = Date.now();
  dirtySections.add("projects");
  dirtySections.add("activeProject"); // 活动态是独立顶层字段——漏标脏则重启后不生效
  markDirty("projects");
  markDirty("activeProject");
  await flushSettings();
}

/** 仅切活动项目（项目菜单"设为活动"——不重启 host，重启后生效语义保留）。 */
async function setActiveProject(project) {
  await persistActiveProject(project);
  toast(`已设「${project.name}」为活动项目——下次打开 aegent 以它开启新对话`, "info");
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
        <p class="hint">每行一个本机目录——多目录会合并为一个项目（第一个为主目录）。</p>
        <textarea class="textarea" data-field="folders" rows="4" placeholder="F:\\work\\my-app"></textarea>
        ${IS_DESKTOP
          ? `<div class="row-control" style="margin-top:8px"><button type="button" class="btn" data-action="pick-folder"><span data-icon="folderOpen" data-icon-size="14"></span> 选择文件夹…</button></div>`
          : `<p class="hint">桌面版支持系统文件夹选择器；网页版请粘贴路径。</p>`}
        <p class="hint" style="margin-top:8px">项目名（缺省 = 主目录名）</p>
        <input class="input" data-field="name" type="text" placeholder="自动推导" autocomplete="off" />
      `;
      const pickBtn = bodyBox.querySelector("[data-action=pick-folder]");
      if (pickBtn !== null) {
        pickBtn.addEventListener("click", async () => {
          try {
            const picked = await tauriInvoke("pick_folder");
            if (picked === null || picked === undefined || picked === "") return;
            const box = bodyBox.querySelector("[data-field=folders]");
            const lines = box.value.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
            if (!lines.includes(picked)) lines.push(picked); // 多目录合并语义——重复选择去重
            box.value = lines.join("\n");
          } catch (e) {
            toast(`选择文件夹失败：${e?.message ?? e}`, "warn");
          }
        });
      }
      injectIcons(bodyBox);
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
  // T-P3-167 需求 3（用户裁决回迁）：项目导入统一放在添加项目弹窗的扫描
  // 导入 tab——比独立页更顺手；#import 一体化页保留为全量视角入口
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
      summary.append(
        icon("wrench", { cls: "icon-sm" }),
        document.createTextNode(` ${message.toolName ?? "tool"}${message.toolError === true ? "（错误）" : ""}`),
      );
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
