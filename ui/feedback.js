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

export function scrollBottom() {
  const stream = streamEl();
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

export function toast(text, kind) {
  const area = document.getElementById("toast-area");
  if (lastToast.text === text && document.contains(lastToast.el)) {
    lastToast.count += 1;
    lastToast.badge.textContent = ` ×${lastToast.count}`;
    clearTimeout(lastToast.timer);
    lastToast.timer = setTimeout(() => {
      lastToast.el?.remove();
      lastToast = { text: "", el: null, count: 0, badge: null, timer: 0 };
    }, 4000);
    return lastToast.el;
  }
  const t = document.createElement("div");
  t.className = "toast";
  const badge = document.createElement("span");
  badge.className = "line-dedup-count";
  t.append(icon(KIND_ICONS[kind] ?? "bell", { cls: "icon-sm" }), document.createTextNode(` ${text}`), badge);
  area.appendChild(t);
  const handle = { text, el: t, count: 1, badge, timer: 0 };
  handle.timer = setTimeout(() => {
    t.remove();
    if (lastToast.el === t) lastToast = { text: "", el: null, count: 0, badge: null, timer: 0 };
  }, 4000);
  lastToast = handle;
  return t;
}
