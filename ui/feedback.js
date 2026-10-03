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

export function appendLine(text, cls = "") {
  const stream = streamEl();
  stream.appendChild(lineEl(text, cls));
  scrollBottom();
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

export function toast(text, kind) {
  const area = document.getElementById("toast-area");
  const t = document.createElement("div");
  t.className = "toast";
  t.append(icon(KIND_ICONS[kind] ?? "bell", { cls: "icon-sm" }), document.createTextNode(` ${text}`));
  area.appendChild(t);
  setTimeout(() => t.remove(), 4000); // 轻提示——不打断（4s 自散）
}
