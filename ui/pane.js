/**
 * 切换面板宿主（T-P3-156 方案 C——需求一.4/五.2）：右侧栏窗口，与「查看
 * 文件」同一位置 Tab 化。zcode 同构物 = workspaceSidePane 纯函数状态机 +
 * AnimatedSidePanePanel 单点分派（本文件为其 1999→纯 DOM 精简版）：
 *
 * - 状态 = {tabs:[{id,type,title,payload}], activeId}，open/activate/close/
 *   toggle 全部纯函数作用于状态后统一 paint（单点渲染，无各面板自管开关）。
 * - Tab 打开时冻结归属（payload 快照）——会话/项目切换不串内容。
 * - 内置渲染器注册表：`registerPane(type, {title, icon, render})`——布局批
 *   内置 file（文件查看迁入）；审查/浏览器/辅助对话/Git/子代理由功能批 /
 *   面板批经同一注册点接入（扩展不开分派分支，zcode resolveRenderer 语义）。
 * - zcode 开合规则：面板展开时右上角「切换面板」钮隐藏，关闭由面板自身
 *   close 承担（WorkspaceHeaderActionSection.tsx:70-77 同款）。
 * - 宽度拖拽两段式：拖拽中只写 CSS 变量，松手才持久化 localStorage
 *   （WorkspaceShellLayout.tsx:539-557 同构）；双击分隔条重置默认宽
 *   （pi-desktop WorkPanel.tsx:434-446 同款）。
 */

import { sendSettings } from "./api.js";
import { toast } from "./feedback.js";
import { openMenu, onSectionRefresh } from "./views/settings/core.js";
import { renderFilePreview } from "./views/projects-files.js";

const PANE_WIDTH_KEY = "aegent.paneWidth";
const DEFAULT_PANE_WIDTH = 420;

let state = { tabs: [], activeId: null };
let previousActiveId = null;
let seq = 0;
let root = null; // #pane-root
let toggleBtn = null; // #pane-toggle-btn

/** 内置渲染器注册表（type → {title, icon, render(body, tab)}）。 */
const renderers = new Map();

/** 文件查看（布局批内置）：projects-files.renderFilePreview 迁入——md
 * 预览/源码双模式 + 双路径复制 + 在资源管理器打开（onBack 缺省=面板无返回）。 */
renderers.set("file", {
  title: (tab) => fileNameOf(tab.payload.filePath),
  icon: "📄",
  render: (body, tab) =>
    renderFilePreview(body, {
      filePath: tab.payload.filePath,
      project: tab.payload.project,
    }),
});

/** 注册面板类型（后续批次接入点——重复注册覆盖，便于热替换调试）。 */
export function registerPane(type, definition) {
  renderers.set(type, definition);
}

// ---------------------------------------------------------------------------
// 状态机（纯函数 + 单点 paint）
// ---------------------------------------------------------------------------

export function openPane(type, payload = {}, options = {}) {
  const existing = state.tabs.find((t) => t.type === type && samePayload(t.payload, payload));
  if (existing !== undefined) {
    activatePane(existing.id);
    return existing.id;
  }
  const def = renderers.get(type);
  if (def === undefined) {
    toast(`未知面板类型：${type}`, "warn");
    return null;
  }
  const tab = {
    id: `pane-${String(++seq)}`,
    type,
    title: options.title ?? (typeof def.title === "function" ? def.title({ payload }) : def.title),
    icon: def.icon ?? "▣",
    payload,
  };
  state.tabs.push(tab);
  state.activeId = tab.id;
  paint();
  return tab.id;
}

export function activatePane(id) {
  if (!state.tabs.some((t) => t.id === id)) return;
  state.activeId = id;
  paint();
}

export function closePane(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const wasActive = state.activeId === id;
  const closing = state.tabs.find((t) => t.id === id);
  state.tabs.splice(idx, 1);
  if (wasActive) {
    // 关闭激活 tab → 落到相邻 tab（zcode syncSubagentSessionSidePaneTabs
    // 的落点语义）；空了就收起面板
    const next = state.tabs[idx] ?? state.tabs[idx - 1];
    state.activeId = next?.id ?? null;
    if (state.activeId === null) renderers.get(closing.type)?.onBlur?.(closing); // 全关：资源清理钩子
  }
  paint();
}

/** 按 payload 前缀清理失效 tab（子代理结束/项目删除等——功能批消费）。 */
export function prunePanes(predicate) {
  const before = state.tabs.length;
  state.tabs = state.tabs.filter((t) => !predicate(t));
  if (!state.tabs.some((t) => t.id === state.activeId)) {
    state.activeId = state.tabs.at(-1)?.id ?? null;
  }
  if (state.tabs.length !== before) paint();
}

export function togglePane(force) {
  const show = force ?? root.hidden;
  if (show && state.activeId === null && state.tabs.length > 0) {
    state.activeId = state.tabs.at(-1).id;
  }
  root.hidden = !show;
  paint(); // 空面板也渲染（+ 菜单与引导空态——切面板钮的空态展开）
  syncToggleBtn();
}

export function paneIsOpen() {
  return root !== null && !root.hidden;
}

/** 面板是否已有某类型 tab（侧栏/进度弹窗的入口态判定用）。 */
export function paneHas(type) {
  return state.tabs.some((t) => t.type === type);
}

function samePayload(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function fileNameOf(filePath) {
  const parts = String(filePath).split(/[\\/]/);
  return parts.at(-1) ?? filePath;
}

// ---------------------------------------------------------------------------
// 渲染（Tab 条 + 激活 tab 内容体 + 左缘拖宽条）
// ---------------------------------------------------------------------------

export function initPane(paneRoot, toggleButton) {
  root = paneRoot;
  toggleBtn = toggleButton;
  restoreWidth();
  paint();
  syncToggleBtn();
  toggleBtn.addEventListener("click", () => togglePane());
  initResize();
  // settings 保存后重渲染激活 Tab（活动项目切换 → Git/浏览器面板的工作区
  // 随动；fireSectionRefresh 由 flushSettings 统一广播——sidebar 切活动/
  // 设置页改配置共用同一联动面）
  onSectionRefresh(() => {
    if (root !== null && !root.hidden) paint();
  });
}

function paint() {
  if (root === null) return;
  const previous = state.tabs.find((t) => t.id === previousActiveId);
  root.replaceChildren();
  if (state.tabs.length === 0) {
    // 空宿主：保留「+」菜单（切换面板钮展开时可见内置面板清单）——
    // hidden 态仍整面板收起（togglePane 控制）
    if (root.hidden) {
      syncToggleBtn();
      previousActiveId = null;
      return;
    }
    const emptyBar = document.createElement("div");
    emptyBar.className = "pane-tabbar";
    emptyBar.appendChild(addMenuButton());
    root.appendChild(emptyBar);
    const hint = document.createElement("div");
    hint.className = "pane-empty-hint";
    hint.textContent = "从「+」打开面板（审查 / 浏览器 / 辅助对话 / Git）；文件树点文件也会在这里预览。";
    root.appendChild(hint);
    syncToggleBtn();
    previousActiveId = null;
    return;
  }
  root.hidden = false;

  const tabbar = document.createElement("div");
  tabbar.className = "pane-tabbar";
  for (const tab of state.tabs) {
    tabbar.appendChild(tabButton(tab));
  }
  tabbar.appendChild(addMenuButton()); // 「+」内置面板清单（需求五.2——内置：审查/浏览器/辅助对话/Git）
  root.appendChild(tabbar);

  const active = state.tabs.find((t) => t.id === state.activeId);
  if (active === undefined) return;
  syncToggleBtn(); // 开合态随 paint 单点同步（open/close/toggle 全走此路）
  // 激活/失焦钩子（浏览器面板的对齐/隐藏等壳侧资源随焦点切换——T-P3-156 Q）
  if (previousActiveId !== null && previousActiveId !== active.id) {
    const prevDef = state.tabs.find((t) => t.id === previousActiveId);
    if (prevDef !== undefined) renderers.get(prevDef.type)?.onBlur?.(prevDef);
  }
  previousActiveId = active.id;
  const body = document.createElement("div");
  body.className = "pane-body";
  const def = renderers.get(active.type);
  if (def === undefined) {
    body.textContent = `面板渲染器缺失：${active.type}`;
  } else {
    // render 允许 async（文件读取/子代理投影）——异常落 body 不炸面板
    try {
      const result = def.render(body, active);
      if (result instanceof Promise) {
        result.catch((e) => {
          console.error("面板渲染失败", active.type, e);
          body.textContent = `面板加载出错：${e?.message ?? String(e)}`;
        });
      }
    } catch (e) {
      console.error("面板渲染失败", active.type, e);
      body.textContent = `面板加载出错：${e?.message ?? String(e)}`;
    }
  }
  root.appendChild(body);
}

/** 内置面板清单（+ 菜单）——browser 由 pane-browser.js 注册（桌面壳）；
 * 未注册类型不出现（web 端无浏览器内核面）。 */
function addMenuButton() {
  const CATALOG = [
    { type: "review", label: "🔍 审查" },
    { type: "browser", label: "🌐 浏览器" },
    { type: "assistant", label: "💬 辅助对话" },
    { type: "git", label: "⑂ Git 管理" },
  ];
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pane-add-btn";
  btn.title = "打开面板（审查/浏览器/辅助对话/Git）";
  btn.textContent = "+";
  btn.addEventListener("click", () => {
    openMenu(btn, CATALOG.filter((item) => renderers.has(item.type)).map((item) => ({
      label: item.label,
      onClick: () => openPane(item.type, {}),
    })));
  });
  return btn;
}

function tabButton(tab) {
  const btn = document.createElement("div");
  btn.className = `pane-tab${tab.id === state.activeId ? " active" : ""}`;
  btn.title = tab.title;
  const label = document.createElement("span");
  label.className = "pane-tab-label";
  label.textContent = `${tab.icon} ${tab.title}`;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "pane-tab-close";
  close.textContent = "✕";
  close.title = "关闭（中键同效）";
  close.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closePane(tab.id);
  });
  btn.append(label, close);
  btn.addEventListener("click", () => activatePane(tab.id));
  btn.addEventListener("auxclick", (ev) => {
    if (ev.button === 1) closePane(tab.id); // 中键关闭（pi-desktop WorkPanel 同款）
  });
  return btn;
}

// ---------------------------------------------------------------------------
// 拖宽（左缘分隔条；拖拽写 CSS 变量 / 松手持久化 / 双击重置）
// ---------------------------------------------------------------------------

function restoreWidth() {
  const saved = Number(localStorage.getItem(PANE_WIDTH_KEY));
  if (Number.isFinite(saved) && saved >= 280) {
    document.documentElement.style.setProperty("--pane-width", `${saved}px`);
  }
}

function initResize() {
  const bar = document.createElement("div");
  bar.className = "pane-resizer";
  bar.title = "拖拽调整面板宽度（双击重置）";
  root.prepend(bar);
  bar.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    bar.classList.add("dragging");
    const onMove = (move) => {
      const width = Math.min(720, Math.max(280, window.innerWidth - move.clientX - 16));
      document.documentElement.style.setProperty("--pane-width", `${width}px`);
    };
    const onUp = () => {
      bar.classList.remove("dragging");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const current = document.documentElement.style.getPropertyValue("--pane-width");
      try {
        localStorage.setItem(PANE_WIDTH_KEY, current.trim());
      } catch {
        // 存储不可用——宽度退化为会话内有效
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
  bar.addEventListener("dblclick", () => {
    document.documentElement.style.removeProperty("--pane-width");
    try {
      localStorage.removeItem(PANE_WIDTH_KEY);
    } catch {
      // 同上——退化可接受
    }
    paint();
  });
}

/** 开合规则：需求一.4 要求右上角「切换面板」**固定显示**——仅在面板展开
 * 时隐藏（关闭由面板 close 承担，zcode 同款）；收起态恒显（无 Tab 时点击
 * 给引导提示，不消失）。 */
function syncToggleBtn() {
  if (toggleBtn === null) return;
  toggleBtn.hidden = paneIsOpen();
}

// ---------------------------------------------------------------------------
// 文件查看入口（供侧栏文件树/工具卡引用）——活动项目缺省取 settings 缓存
// ---------------------------------------------------------------------------

/** 打开文件查看 Tab。project 缺省 = 当前活动项目（settings.projects 命中
 * activeProject），都不在则报 toast（fs-gateway 白名单以项目根为准）。 */
export async function openFilePane(filePath, projectOverride) {
  const project = projectOverride ?? (await activeProject());
  if (project === null) {
    toast("先在左侧栏选择项目（文件读取以项目根为边界）", "warn");
    return null;
  }
  return openPane("file", { filePath, projectId: project.id, project });
}

async function activeProject() {
  const { settingsCache } = await import("./state.js");
  const id = settingsCache?.activeProject;
  if (id === undefined) return null;
  return (settingsCache.projects ?? []).find((p) => p.id === id) ?? null;
}

/** 兜底：面板内「在资源管理器中打开」（fs-shell reveal——host 域白名单）。 */
export async function revealPath(target) {
  const envelope = await sendSettings({ op: "fs-shell", path: target, action: "reveal" });
  if (!envelope.ok) toast(`打开失败：${envelope.error?.message ?? ""}`, "warn");
}
