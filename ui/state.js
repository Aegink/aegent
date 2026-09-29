/**
 * aegent ui 共享状态（T-P3-134 · UI 批次 A③ 共享层下沉——单向被依赖防环：
 * views/* → state.js，共享层互不 import；此处只依赖纯逻辑模块 keymap.js）。
 * 可变绑定经存取函数改写（ESM 导入绑定只读）；对象内字段照旧直接改——
 * 视图代码原样消费 settingsCache 等导入绑定（live binding 读到最新值）。
 */

import { createKeymap } from "./keymap.js";

// —— 设置缓存（settings 信封 get/update 回填；对象内字段全站直接改写）
export let settingsCache = null;
export function setSettingsCache(v) {
  settingsCache = v;
}

// —— 会话 id（host 侧生成——hello/query 回执元数据回填；"" = 未连接）
export let sessionIdValue = null;
export function getSessionId() {
  return sessionIdValue ?? "";
}
export function setSessionId(v) {
  sessionIdValue = v;
}

// —— 最近一条用户输入（错误重试交互的重发面——turn/end error 卡的按钮）
export let lastUserPrompt = "";
export function setLastUserPrompt(v) {
  lastUserPrompt = v;
}

// —— U16 提示词模板补全的加载标记（settings get 一次缓存）
export let promptsCacheLoaded = false;
export function markPromptsLoaded() {
  promptsCacheLoaded = true;
}

// —— 主题应用原语（状态 → DOM：外观段变化的全端一致写入点；入口启动时
//    也调用一次——修复"保存过亮色的用户要开一次设置才切主题"的启动缺口）
export function applyTheme(theme) {
  document.body.dataset.theme = theme === "light" ? "light" : "dark";
}

// —— U25 键位表：settings.shortcuts 就绪/更新后由设置域 rebuild；分发面读取
let keymapBindings = createKeymap(null);
export function rebuildKeymap() {
  keymapBindings = createKeymap(settingsCache?.shortcuts);
}
export function getKeymapBindings() {
  return keymapBindings;
}

// —— N5 通知的跨域共享：入口消费信封 push（徽标常显），通知视图订阅渲染
export const notifications = [];
const notifyListeners = new Set();
export function subscribeNotify(fn) {
  notifyListeners.add(fn);
  return () => notifyListeners.delete(fn);
}
export function emitNotify() {
  for (const fn of notifyListeners) fn();
}
export function updateNotifyBadge() {
  const badge = document.getElementById("notify-badge");
  if (badge === null) return;
  badge.hidden = notifications.length === 0;
  badge.textContent = String(notifications.length);
}

// —— turn 结算的跨域事件（工作面板开着时随轮结算自动刷新——变更/委派是
//    流投影重算便宜；视图挂载期订阅，卸载期退订）
const turnSettledListeners = new Set();
export function subscribeTurnSettled(fn) {
  turnSettledListeners.add(fn);
  return () => turnSettledListeners.delete(fn);
}
export function emitTurnSettled() {
  for (const fn of turnSettledListeners) fn();
}

// —— 聊天流重建回调（history/search 的"查看 = 只读恢复视图"入口消费——
//    由入口注册自身实现，依赖方向保持 views → state 单向）
export const hooks = {};
