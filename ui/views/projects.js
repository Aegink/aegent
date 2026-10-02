/**
 * 项目中心视图（T-P3-150 D1/D2——从 settings 分节升为独立一级页面；
 * 交互母版 pi-desktop ProjectsPage/ProjectDetailPanel，🔴只学行为）。
 *
 * 页面结构：页头（标题 + 添加项目）+ 两栏——左 = 项目列表（搜索 + 卡片行
 * + 右键菜单：设为活动/编辑/在资源管理器打开/删除）或文件树（查看文件态）；
 * 右 = 项目详情（信息头 + 操作行 + 任务区）或文件预览。
 *
 * 数据面：settings.projects 段（T-P3-150 A1 模型：{id,name,folders[],
 * createdAt,lastOpenedAt}——即改即存 markDirty("projects")）+ op:fs-tree/
 * fs-read/fs-shell（文件面——边界在 host fs-gateway）+ op:git-clone（A3）
 * + op:import-scan（A4 发现级扫描）+ op:project-tasks / op:session-rename /
 * settings op:session-delete（B1/B2 任务面）。
 *
 * 任务语义（单会话架构的诚实版）：任务 = 归属项目的会话（host 在首条用户
 * 话语时按当时 activeProject 自动归属——B1）；「新建任务」= 设该项目为活动
 * + 重启指引（动态换 workspace 重启记档）；首句自动命名 = 标题管线既有
 * 面（首条消息截断回退 + generated 不覆盖 custom——B3 零新增）。
 */

import { sendSettings, invalidateMetaCache } from "../api.js";
import { settingsCache, setSettingsCache } from "../state.js";
import { toast } from "../feedback.js";
import {
  markDirty,
  dirtySections,
  openDialog,
  confirmDialog,
  openMenu,
  flushSettings,
} from "./settings/core.js";
import { relativePathTo, renderFileTree, renderFilePreview, fileIcon, copyText } from "./projects-files.js";

let activeProjectId = null; // 当前右栏详情/文件树的项目
let leftMode = "projects"; // "projects" | "files"
let generation = 0; // 文件树代次（切项目/退回列表递增——旧响应丢弃）
let searchQuery = "";
let previewPath = null; // 文件预览态（右栏）

const TEMPLATE = `
<div class="proj-page" id="proj-page">
  <header class="tab-header">
    <h1 class="tab-title">项目</h1>
    <button id="proj-add" type="button" class="btn btn-primary">添加项目</button>
  </header>
  <div class="proj-layout">
    <aside class="proj-side" id="proj-side"></aside>
    <main class="proj-main" id="proj-main"></main>
  </div>
</div>
`;

export async function render(container) {
  container.innerHTML = TEMPLATE;
  // 独立页冷加载：settingsCache 可能尚未拉取（直达 #projects 不经设置页
  // open()）——强制重拉一次（invalidate+get），列表/详情才有数据面
  invalidateMetaCache();
  const envelope = await sendSettings({ op: "get" });
  if (envelope.ok) setSettingsCache(envelope.result.settings);
  container.querySelector("#proj-add").addEventListener("click", () => void openAddDialog());
  await renderLeft();
  await renderMain();
}

// ---------------------------------------------------------------------------
// 左栏：项目列表 / 文件树
// ---------------------------------------------------------------------------

async function renderLeft() {
  const side = document.getElementById("proj-side");
  if (side === null) return;
  if (leftMode === "files") {
    await renderFilesLeft(side);
    return;
  }
  side.innerHTML = `
    <input id="proj-search" class="input" type="text" placeholder="搜索项目…" autocomplete="off" />
    <div id="proj-list" class="proj-list"></div>
  `;
  const search = side.querySelector("#proj-search");
  search.value = searchQuery;
  search.addEventListener("input", () => {
    searchQuery = search.value.trim().toLowerCase();
    void paintProjectList();
  });
  await paintProjectList();
}

/** 文件树态左栏：返回项目列表 + 懒加载树（projects-files.renderFileTree）。 */
async function renderFilesLeft(side) {
  const project = currentProject();
  if (project === null) {
    leftMode = "projects";
    await renderLeft();
    return;
  }
  const back = document.createElement("button");
  back.type = "button";
  back.className = "btn btn-ghost";
  back.textContent = "← 返回项目列表";
  back.addEventListener("click", () => {
    generation += 1;
    leftMode = "projects";
    previewPath = null;
    void renderLeft();
    void renderMain();
  });
  const treeBox = document.createElement("div");
  treeBox.className = "proj-list";
  side.replaceChildren(back, treeBox);
  await renderFileTree(treeBox, {
    project,
    generation,
    onOpenFile: (filePath) => {
      previewPath = filePath;
      void renderMain();
    },
  });
}

async function paintProjectList() {
  const list = document.getElementById("proj-list");
  if (list === null) return;
  const projects = sortedProjects();
  list.replaceChildren();
  if (projects.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div class="empty-title">还没有项目</div><div class="empty-desc">添加本机文件夹 / clone Git 仓库 / 扫描其他工具的项目记录。</div>`;
    list.appendChild(empty);
    return;
  }
  for (const project of projects) {
    if (searchQuery !== "" && !`${project.name} ${project.folders[0] ?? ""}`.toLowerCase().includes(searchQuery)) continue;
    list.appendChild(projectCard(project));
  }
}

function sortedProjects() {
  const projects = [...(settingsCache?.projects ?? [])];
  projects.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || a.name.localeCompare(b.name));
  return projects;
}

function isActive(project) {
  return settingsCache?.activeProject === project.id;
}

function projectCard(project) {
  const primary = project.folders[0] ?? "";
  const card = document.createElement("div");
  card.className = `proj-card${isActive(project) ? " active" : ""}`;
  card.dataset.id = project.id;
  const name = document.createElement("div");
  name.className = "proj-card-name";
  name.textContent = project.name;
  const pathLine = document.createElement("div");
  pathLine.className = "proj-card-path";
  pathLine.textContent = primary;
  pathLine.title = primary;
  const meta = document.createElement("div");
  meta.className = "proj-card-meta";
  meta.textContent = `${project.folders.length > 1 ? `${String(project.folders.length)} 个目录 · ` : ""}${
    project.lastOpenedAt !== undefined ? new Date(project.lastOpenedAt).toLocaleDateString("zh-CN") : ""
  }`;
  card.append(name, pathLine, meta);
  if (isActive(project)) {
    const badge = document.createElement("span");
    badge.className = "chip";
    badge.textContent = "活动";
    name.appendChild(badge);
  }
  card.addEventListener("click", () => {
    activeProjectId = project.id;
    leftMode = "projects";
    previewPath = null;
    void renderLeft();
    void renderMain();
  });
  card.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    openMenu(card, projectMenuItems(project));
  });
  return card;
}

function projectMenuItems(project) {
  return [
    {
      label: isActive(project) ? "当前活动项目" : "设为活动",
      onClick: () => void setActiveProject(project),
    },
    { label: "编辑项目", onClick: () => void openEditDialog(project) },
    {
      label: "在资源管理器中打开",
      onClick: () => void sendSettings({ op: "fs-shell", path: project.folders[0] ?? "", action: "reveal" }).then((envelope) => {
        if (!envelope.ok) toast(`打开失败：${envelope.error?.message ?? ""}`, "warn");
      }),
    },
    { label: "删除项目", danger: true, onClick: () => void deleteProject(project) },
  ];
}

// ---------------------------------------------------------------------------
// 右栏：项目详情（任务区）/ 文件预览
// ---------------------------------------------------------------------------

async function renderMain() {
  const main = document.getElementById("proj-main");
  if (main === null) return;
  if (previewPath !== null) {
    const project = currentProject();
    if (project === null) {
      previewPath = null;
    } else {
      await renderFilePreview(main, {
        filePath: previewPath,
        project,
        onBack: () => {
          previewPath = null;
          void renderMain();
        },
      });
      return;
    }
  }
  const project = currentProject();
  if (project === null) {
    main.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">选择一个项目</div>
        <div class="empty-desc">左侧选择项目查看任务与文件；或点右上「添加项目」。</div>
      </div>
    `;
    return;
  }
  await paintProjectDetail(main, project);
}

function currentProject() {
  return (settingsCache?.projects ?? []).find((p) => p.id === activeProjectId) ?? null;
}

async function paintProjectDetail(main, project) {
  const primary = project.folders[0] ?? "";
  main.replaceChildren();

  const head = document.createElement("div");
  head.className = "proj-detail-head";
  const title = document.createElement("h2");
  title.className = "proj-detail-title";
  title.textContent = project.name;
  const pathLine = document.createElement("div");
  pathLine.className = "proj-card-path";
  pathLine.textContent = primary;
  const branchLine = document.createElement("div");
  branchLine.className = "proj-card-meta";
  branchLine.textContent = "分支：读取中…";
  head.append(title, pathLine, branchLine);

  const actions = document.createElement("div");
  actions.className = "row-control";
  actions.style.gap = "8px";
  const openFiles = document.createElement("button");
  openFiles.type = "button";
  openFiles.className = "btn btn-primary";
  openFiles.textContent = "查看文件";
  openFiles.addEventListener("click", () => {
    generation += 1;
    leftMode = "files";
    void renderLeft();
  });
  const setActive = document.createElement("button");
  setActive.type = "button";
  setActive.className = "btn";
  setActive.textContent = isActive(project) ? "当前活动项目" : "设为活动";
  setActive.disabled = isActive(project);
  setActive.addEventListener("click", () => void setActiveProject(project));
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "btn";
  edit.textContent = "编辑";
  edit.addEventListener("click", () => void openEditDialog(project));
  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn btn-ghost";
  del.textContent = "删除";
  del.addEventListener("click", () => void deleteProject(project));
  actions.append(openFiles, setActive, edit, del);

  const taskHead = document.createElement("div");
  taskHead.className = "proj-detail-section";
  taskHead.innerHTML = `<div class="row-title">任务</div>`;
  const taskActions = document.createElement("div");
  taskActions.className = "row-control";
  taskActions.style.gap = "8px";
  const newTask = document.createElement("button");
  newTask.type = "button";
  newTask.className = "btn";
  newTask.textContent = "新建任务";
  newTask.addEventListener("click", () => void createTask(project));
  taskActions.appendChild(newTask);
  const taskList = document.createElement("div");
  taskList.className = "proj-task-list";
  taskList.textContent = "加载中…";

  main.append(head, actions, taskHead, taskActions, taskList);

  // 分支徽标（读 .git/HEAD——host project-branch op）
  const branchEnvelope = await sendSettings({ op: "project-branch", path: primary });
  branchLine.textContent = `分支：${branchEnvelope.ok ? (branchEnvelope.result.branch ?? "（非 git 目录）") : "读取失败"}`;

  await paintTasks(taskList, project);
}

async function paintTasks(taskList, project) {
  const envelope = await sendSettings({ op: "project-tasks", projectId: project.id });
  taskList.replaceChildren();
  if (!envelope.ok) {
    taskList.textContent = `任务加载失败：${envelope.error?.message ?? ""}`;
    return;
  }
  const tasks = (envelope.result.tasks ?? []).slice().sort((a, b) => b.updatedTs - a.updatedTs);
  if (tasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div class="empty-desc">该项目还没有任务——「新建任务」后开始的第一段对话会自动归属到这里，首句话即任务名。</div>`;
    taskList.appendChild(empty);
    return;
  }
  for (const task of tasks) {
    taskList.appendChild(taskRow(task));
  }
}

function taskRow(task) {
  const row = document.createElement("div");
  row.className = "proj-task-row";
  const title = document.createElement("div");
  title.className = "proj-task-title";
  title.textContent = task.title !== "" ? task.title : task.sessionId;
  const meta = document.createElement("div");
  meta.className = "proj-card-meta";
  meta.textContent = `${new Date(task.updatedTs).toLocaleString("zh-CN")} · ${String(task.eventCount)} 条事件`;
  row.append(title, meta);
  row.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    openMenu(row, [
      {
        label: "重命名",
        onClick: () => void renameTask(task),
      },
      {
        label: "查看（只读恢复视图）",
        onClick: () => {
          location.hash = "#history";
        },
      },
      { label: "删除任务", danger: true, onClick: () => void deleteTask(task) },
    ]);
  });
  return row;
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
        {
          label: "重命名",
          className: "btn btn-primary",
          onClick: () => resolve(input.value.trim()),
        },
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
  await rerenderAll();
}

async function deleteTask(task) {
  const ok = await confirmDialog(`删除任务「${task.title !== "" ? task.title : task.sessionId}」？该会话的事件记录将一并删除，不可恢复。`);
  if (ok !== true) return;
  const envelope = await sendSettings({ op: "session-delete", sessionId: task.sessionId });
  if (!envelope.ok) {
    toast(`删除失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  toast("任务已删除", "info");
  await rerenderAll();
}

/**
 * 新建任务（单会话架构诚实版）：把该项目设为活动——host 在新会话首条用户
 * 话语时自动归属；重启后（桌面壳重开 / 终端重跑 aegent）新会话即该项目的
 * 任务。动态换 workspace 重启 agent 进程记档（架构级改动）。
 */
async function createTask(project) {
  const ok = await confirmDialog(
    `新建任务「${project.name}」：将把该项目设为活动工作区。当前 host 是单会话架构——重启后（桌面壳重开或终端重跑 aegent）新会话即以 ${project.folders[0] ?? ""} 启动，第一句话会自动命名任务。`,
  );
  if (ok !== true) return;
  await setActiveProject(project);
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
  await rerenderAll();
}

async function deleteProject(project) {
  const ok = await confirmDialog(`删除项目「${project.name}」？只移除项目记录（不删磁盘文件）${isActive(project) ? "；它当前是活动项目，删除后活动态一并清除" : ""}。`);
  if (ok !== true) return;
  const projects = (settingsCache.projects ?? []).filter((p) => p.id !== project.id);
  settingsCache.projects = projects;
  if (isActive(project)) {
    settingsCache.activeProject = undefined;
    delete settingsCache.activeProject;
    dirtySections.add("activeProject");
    markDirty("activeProject");
  }
  if (activeProjectId === project.id) {
    activeProjectId = null;
    previewPath = null;
  }
  dirtySections.add("projects");
  markDirty("projects");
  await flushSettings();
  toast("项目已删除（磁盘文件未动）", "info");
  await rerenderAll();
}

// ---------------------------------------------------------------------------
// 添加对话框（三模式）/ 编辑对话框
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
        {
          label: "添加",
          className: "btn btn-primary",
          onClick: () => resolve(mode),
        },
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
      skipped > 0 ? `已添加 ${String(added)} 个项目（${String(skipped)} 个已存在跳过）` : `已添加「${String(added)}」个项目`,
      "info",
    );
  }
  await rerenderAll();
  return { added, skipped };
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
        {
          label: "保存",
          className: "btn btn-primary",
          onClick: () => resolve(true),
        },
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
    await rerenderAll();
  });
}

async function rerenderAll() {
  await renderLeft();
  await renderMain();
}
