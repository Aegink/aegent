/**
 * 终端面板（T-P3-156 方案 P——需求五.1「下方显示当前工作区终端」）：底部
 * 抽屉（右上角「终端」钮开合，高度记忆）；xterm.js（vendor UMD）+ host
 * node-pty（settings op terminal-create/input/resize + terminal-data/
 * terminal-exit notification 下行）。per-workspace 会话隔离（活动项目一个
 * PTY，切换项目切会话不杀进程——zcode Terminal.tsx 保活三件套的裁剪版）。
 */

import { sendSettings, IS_DESKTOP } from "./api.js";
import { settingsCache } from "./state.js";
import { toast } from "./feedback.js";

const HEIGHT_KEY = "aegent.terminalHeight";
const DEFAULT_HEIGHT_VH = 30;

let drawer = null; // #terminal-drawer
let terminalBtn = null; // #terminal-btn（右上角）
let xterm = null;
let fitAddon = null;
let currentSessionId = null; // 壳侧 PTY id（=活动项目根或 "-"）
let attachedSession = null;
let outputHandler = null;
let exitHandler = null;

export function initTerminalPane() {
  drawer = document.getElementById("terminal-drawer");
  terminalBtn = document.getElementById("terminal-btn");
  if (drawer === null || terminalBtn === null) return;
  const saved = Number(localStorage.getItem(HEIGHT_KEY));
  if (Number.isFinite(saved) && saved >= 120) {
    drawer.style.height = `${Math.min(window.innerHeight * 0.7, saved)}px`;
  }
  terminalBtn.hidden = !IS_DESKTOP; // web 端无 PTY 面——按钮不出现
  terminalBtn.addEventListener("click", () => toggleTerminal());
  // WS 下行（terminal-data/terminal-exit）——app.js handleEnvelope 的
  // notification 分支转发（import 循环防呆：经 CustomEvent 解耦）
  window.addEventListener("terminal:data", (ev) => {
    if (xterm !== null && ev.detail?.id === attachedSession) xterm.write(String(ev.detail.data ?? ""));
  });
  window.addEventListener("terminal:exit", (ev) => {
    if (ev.detail?.id !== attachedSession) return;
    if (xterm !== null) xterm.write(`\r\n\x1b[33m[进程已退出 code ${String(ev.detail.exitCode)}——点「关闭」重开]\x1b[0m\r\n`);
  });
}

export function toggleTerminal(force) {
  if (drawer === null) return;
  const show = force ?? drawer.hidden;
  if (show) {
    if (!IS_DESKTOP) {
      toast("终端需要桌面版（PTY 面在壳进程）", "warn");
      return;
    }
    drawer.hidden = false;
    terminalBtn.classList.add("active");
    void ensureSession();
    // fit 延一帧（布局稳定后）
    requestAnimationFrame(() => fitTerm());
  } else {
    drawer.hidden = true;
    terminalBtn.classList.remove("active");
  }
}

function activeWorkspace() {
  const project = (settingsCache?.projects ?? []).find((p) => p.id === settingsCache?.activeProject);
  return project?.folders[0] ?? null;
}

/** 确保当前工作区的 PTY 会话 + xterm 实例（切换项目=新会话，旧的不杀）。 */
async function ensureSession() {
  const cwd = activeWorkspace();
  const sid = cwd ?? "(home)";
  currentSessionId = sid;
  if (xterm === null) mountXterm();
  if (attachedSession === sid) return;
  attachedSession = sid;
  xterm.reset();
  xterm.writeln(`\x1b[36m—— aegent 终端 · ${cwd ?? "用户主目录"} ——\x1b[0m`);
  try {
    const envelope = await sendSettings({ op: "terminal-create", id: sid, cwd: cwd ?? "" });
    if (!envelope.ok) {
      xterm.writeln(`\x1b[31m终端创建失败：${envelope.error?.message ?? ""}\x1b[0m`);
      return;
    }
    xterm.writeln(envelope.result?.reused === true ? "（复用既有会话）" : "");
    fitTerm();
  } catch (e) {
    xterm.writeln(`\x1b[31m终端创建失败：${e?.message ?? ""}\x1b[0m`);
  }
}

function mountXterm() {
  drawer.replaceChildren();
  // 工具条：拖高把手 + 关闭
  const grip = document.createElement("div");
  grip.className = "terminal-grip";
  grip.title = "拖拽调整终端高度（双击重置）";
  const bar = document.createElement("div");
  bar.className = "terminal-bar";
  const label = document.createElement("span");
  label.className = "terminal-label";
  label.textContent = "终端";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-ghost terminal-close";
  closeBtn.textContent = "✕ 关闭";
  closeBtn.addEventListener("click", () => toggleTerminal(false));
  bar.append(label, closeBtn);
  const host = document.createElement("div");
  host.className = "terminal-host";
  drawer.append(grip, bar, host);

  const term = new window.Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "var(--font-mono, monospace)",
    theme: document.body.dataset.theme === "light" ? TERMINAL_LIGHT : TERMINAL_DARK,
    scrollback: 5000,
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  term.onData((data) => {
    if (attachedSession === null) return;
    void sendSettings({ op: "terminal-input", id: attachedSession, data }).catch(() => {});
  });
  term.onResize(({ cols, rows }) => {
    if (attachedSession === null) return;
    void sendSettings({ op: "terminal-resize", id: attachedSession, cols, rows }).catch(() => {});
  });
  xterm = term;
  fitAddon = fit;

  // 拖高（两段式——写内联高、松手持久化）
  grip.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    const startY = ev.clientY;
    const startH = drawer.getBoundingClientRect().height;
    const onMove = (move) => {
      const h = Math.min(window.innerHeight * 0.7, Math.max(120, startH + (startY - move.clientY)));
      drawer.style.height = `${h}px`;
      fitTerm();
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try {
        localStorage.setItem(HEIGHT_KEY, String(Math.round(drawer.getBoundingClientRect().height)));
      } catch {
        // 存储不可用——高度会话内有效
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
  grip.addEventListener("dblclick", () => {
    drawer.style.height = "";
    try {
      localStorage.removeItem(HEIGHT_KEY);
    } catch {
      // 同上
    }
    fitTerm();
  });
  window.addEventListener("resize", () => fitTerm());
  void fit;
}

function fitTerm() {
  if (fitAddon === null || drawer?.hidden !== false) return;
  try {
    fitAddon.fit();
  } catch {
    // 容器不可见时的 fit 异常——忽略
  }
}

// 暗/亮两套配色（zcode 主题随 html class 实时合并的裁剪版——theme.css token 对齐）
const TERMINAL_DARK = {
  background: "#16181d",
  foreground: "#e6e6e6",
  cursor: "#4daafc",
  selectionBackground: "#2a3b5d",
};
const TERMINAL_LIGHT = {
  background: "#ffffff",
  foreground: "#24292f",
  cursor: "#0969da",
  selectionBackground: "#b6d7ff",
};

// 主题切换时重挂配色（body[data-theme] 变化无事件——轮询太重，切换瞬间由
// 外观设置的 applyTheme 经 CustomEvent 通知；此处被动监听）
window.addEventListener("aegent:theme", () => {
  if (xterm === null) return;
  xterm.options.theme = document.body.dataset.theme === "light" ? TERMINAL_LIGHT : TERMINAL_DARK;
});

export function disposeTerminal() {
  if (fitAddon !== null) {
    fitAddon = null;
  }
  xterm = null;
  attachedSession = null;
}
