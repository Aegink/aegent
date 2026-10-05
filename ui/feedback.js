/**
 * aegent ui 跨视图 DOM 原语（T-P3-134 · UI 批次 A③ 共享层下沉）——无依赖的
 * 呈现层小件：聊天流日志行、Toast 轻提示、通用格式化。视图与入口共同消费，
 * 不 import 其他共享层（直接 getElementById 取骨架元素）；唯一例外 icons.js
 * （同为叶子模块——T-P3-157 批 3 toast 图标节点化）。
 */
import { icon } from "./icons.js";

function streamEl() {
  return document.getElementById("stream");
}

export function lineEl(text, cls = "") {
  const div = document.createElement("div");
  div.className = `line ${cls}`.trim();
  div.textContent = text;
  return div;
}

// 同文错误行去重窗口（P-009——同一错误 5s 内连发只聚合计数，不刷屏）
const recentLines = new Map(); // text -> { el, count, badge, timer }

export function appendLine(text, cls = "") {
  const stream = streamEl();
  const recent = recentLines.get(text);
  if (recent !== undefined && document.contains(recent.el)) {
    recent.count += 1;
    recent.badge.textContent = ` ×${recent.count}`;
    clearTimeout(recent.timer);
    recent.timer = setTimeout(() => recentLines.delete(text), 5000);
    scrollBottom();
    return recent.el;
  }
  const el = lineEl(text, cls);
  // 警告/错误行：聚合计数位 + 关闭钮（可清理——zcode 错误行可行动语义）
  if (cls.includes("warn") || cls.includes("error")) {
    const meta = { el, count: 1, badge: document.createElement("span"), timer: 0 };
    meta.badge.className = "line-dedup-count";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "line-close";
    close.title = "关闭这条提示";
    close.setAttribute("aria-label", "关闭提示");
    close.replaceChildren(icon("close", { cls: "icon-sm" }));
    close.addEventListener("click", () => {
      recentLines.delete(text);
      el.remove();
    });
    el.append(meta.badge, close);
    meta.timer = setTimeout(() => recentLines.delete(text), 5000);
    recentLines.set(text, meta);
  }
  stream.appendChild(el);
  scrollBottom();
  return el;
}

// —— T-P3-173 滚动跟随状态机（zcode timelineScrollAnchor 同构——用户上滚
// 读历史不被流式拽回；离底 48px 容差内算贴底）：
let scrollFollowing = true;
let scrollJumpBtn = null;

/** 用户手势判定（wheel/touch/key——程序化 scrollTop 不改变跟随态）。 */
function installScrollGuards() {
  const stream = streamEl();
  stream.addEventListener("wheel", (ev) => {
    if (ev.deltaY < 0) {
      scrollFollowing = false; // 上滚=离场读历史
      paintJumpBtn();
      return;
    }
    const atBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 48;
    if (atBottom) {
      scrollFollowing = true; // 下滚到近底=回归跟随
      paintJumpBtn();
    }
  }, { passive: true });
  stream.addEventListener("touchmove", () => {
    const atBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 48;
    if (!atBottom) {
      scrollFollowing = false;
      paintJumpBtn();
    }
  }, { passive: true });
  stream.addEventListener("scroll", () => {
    // 手势松手后的惯性滚动到位 → 恢复跟随
    if (!scrollFollowing && stream.scrollHeight - stream.scrollTop - stream.clientHeight < 8) {
      scrollFollowing = true;
      paintJumpBtn();
    }
  }, { passive: true });
}

function paintJumpBtn() {
  const stream = streamEl();
  if (scrollFollowing) {
    scrollJumpBtn?.remove();
    scrollJumpBtn = null;
    return;
  }
  if (scrollJumpBtn !== null && scrollJumpBtn.isConnected) return;
  const chatView = stream.parentElement;
  if (chatView === null) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "scroll-jump-btn";
  btn.textContent = "↓ 回到底部";
  btn.addEventListener("click", () => {
    scrollFollowing = true;
    stream.scrollTop = stream.scrollHeight;
    btn.remove();
    scrollJumpBtn = null;
  });
  chatView.appendChild(btn);
  scrollJumpBtn = btn;
}

/** 发送动作强制重新钉底（zcode D151——用户主动发起新轮=意图在最新）。 */
export function pinScrollToBottom() {
  scrollFollowing = true;
  paintJumpBtn();
  const stream = streamEl();
  stream.scrollTop = stream.scrollHeight;
}

let scrollGuardsInstalled = false;

export function scrollBottom() {
  const stream = streamEl();
  if (!scrollGuardsInstalled) {
    scrollGuardsInstalled = true;
    installScrollGuards();
  }
  if (!scrollFollowing) return; // 跟随解除——新内容不拽回
  stream.scrollTop = stream.scrollHeight;
}

export function oneLine(text, limit = 400) {
  const flat = String(text).replace(/\r?\n/g, " ⏎ ");
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

export function fmtTime(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return "?";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 统一时间格式（P-038/P-045——全站唯一：YYYY-MM-DD HH:MM:SS 本地时区；
 *  消费 Date | ms 时间戳 | ISO 字符串）。 */
export function fmtDateTime(input) {
  if (input === undefined || input === null || input === "") return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// —— N5 分型的 kind 图标（Toast 与通知清单共用同一套分型——视觉一致）。
// T-P3-157 批 3：值由 emoji 字形改为 icons.js 语义名（消费方用 icon(name)
// 组节点——不能再用字符串拼接）。
export const KIND_ICONS = {
  approval_pending: "pause",
  turn_settled: "checkCircle",
  job_settled: "settings",
  surface_changed: "link2",
  computer_operation: "monitor",
};

// 同文 toast 合并窗口（P-055——同文案 3s 内重复弹只叠计数）
let lastToast = { text: "", el: null, count: 0, badge: null, timer: 0 };

const TOAST_MS = 3000; // T-P3-172：zcode 3000ms（托盘挂起时 WebView timer 冻结——点按即关兜底）

export function toast(text, kind, action) {
  const area = document.getElementById("toast-area");
  if (lastToast.text === text && document.contains(lastToast.el)) {
    lastToast.count += 1;
    lastToast.badge.textContent = ` ×${lastToast.count}`;
    clearTimeout(lastToast.timer);
    lastToast.timer = setTimeout(() => {
      lastToast.el?.remove();
      lastToast = { text: "", el: null, count: 0, badge: null, timer: 0 };
    }, TOAST_MS);
    return lastToast.el;
  }
  const t = document.createElement("div");
  t.className = "toast";
  t.title = "点击关闭";
  const badge = document.createElement("span");
  badge.className = "line-dedup-count";
  t.append(icon(KIND_ICONS[kind] ?? "bell", { cls: "icon-sm" }), document.createTextNode(` ${text}`), badge);
  // T-P3-173（A3）：动作按钮——通知从"看了就没了"变可行动
  if (action && typeof action.label === "string" && typeof action.onClick === "function") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = action.label;
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      t.remove();
      action.onClick();
    });
    t.appendChild(btn);
  }
  // T-P3-172（zcode 通知样式）：可点按关闭（托盘挂起 timer 冻结时的兜底出口）
  t.addEventListener("click", () => {
    t.remove();
    if (lastToast.el === t) lastToast = { text: "", el: null, count: 0, badge: null, timer: 0 };
  });
  area.appendChild(t);
  const handle = { text, el: t, count: 1, badge, timer: 0 };
  handle.timer = setTimeout(() => {
    t.remove();
    if (lastToast.el === t) lastToast = { text: "", el: null, count: 0, badge: null, timer: 0 };
  }, TOAST_MS);
  lastToast = handle;
  return t;
}
