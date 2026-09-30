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
//    也调用一次——修复"保存过亮色的用户要开一次设置才切主题"的启动缺口）。
//    T-P3-141 批次升级为全量外观应用（applyAppearance）——applyTheme 保持
//    旧签名兼容（theme 参数忽略，全部以 settingsCache.appearance 为准）。
let systemThemeMedia = null;
let scheduleTimer = null;
let appliedPluginTheme; // 已注入 CSS 的插件主题（变更才取回——防每次 flush 重取）

/** 跟随系统档的解析（matchMedia——opencode desktop / zcode 同款）。 */
function systemResolved() {
  if (systemThemeMedia === null && typeof matchMedia === "function") {
    systemThemeMedia = matchMedia("(prefers-color-scheme: dark)");
    systemThemeMedia.addEventListener?.("change", () => {
      if (settingsCache?.appearance?.themeMode === "system") applyAppearance();
    });
  }
  return systemThemeMedia?.matches === true ? "light" : "dark";
}

function parseHm(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? ""));
  if (m === null) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 按时间表档解析（pideck schedule 同构——跨午夜区间合法）。 */
function scheduleResolved(a) {
  const light = parseHm(a.scheduleLightStart) ?? 7 * 60;
  const dark = parseHm(a.scheduleDarkStart) ?? 19 * 60;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (light === dark) return "dark";
  if (light < dark) return minutes >= light && minutes < dark ? "light" : "dark";
  return minutes >= light || minutes < dark ? "light" : "dark"; // 跨午夜：light [22:00,24)∪[0,06)
}

function scheduleNextBoundaryMs(a) {
  const light = parseHm(a.scheduleLightStart) ?? 7 * 60;
  const dark = parseHm(a.scheduleDarkStart) ?? 19 * 60;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const until = (target) => (target - minutes + 1440) % 1440;
  return Math.min(until(light), until(dark)) * 60 * 1000;
}

/** 字体栈：自定义首选族 + CJK 回退链（防中文落宋体——theme.css 缺省栈同纪律）。 */
function fontStack(custom, mono) {
  const safe = String(custom).replace(/[";{}]/g, "").trim();
  if (safe === "") return undefined;
  return mono
    ? `${safe}, ui-monospace, Consolas, "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", monospace`
    : `${safe}, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif`;
}

/** 背景图层（pideck 壁纸同位：#view-root 首子层，遮罩透明度=图片可见度）。 */
function applyBackgroundLayer(a) {
  const root = document.getElementById("view-root");
  if (root === null) return;
  let layer = root.querySelector(":scope > .app-bg-layer");
  const url = typeof a.backgroundImage === "string" ? a.backgroundImage : "";
  if (url === "") {
    layer?.remove();
    return;
  }
  if (layer === null) {
    layer = document.createElement("div");
    layer.className = "app-bg-layer";
    root.prepend(layer);
  }
  layer.style.backgroundImage = `url("${url}")`;
  layer.style.opacity = String(Math.min(100, Math.max(0, a.backgroundImageOpacity ?? 60)) / 100);
}

/** 插件主题 CSS 注入（pi-desktop plugin:<id> 同位——host op 取回正文注入
      <style>；失败/清除均回退基础主题，不静默保留旧注入）。 */
export async function syncPluginTheme() {
  const want = settingsCache?.appearance?.pluginTheme;
  const existing = document.getElementById("aegent-plugin-theme");
  if (want === undefined || want === "") {
    existing?.remove();
    delete document.body.dataset.pluginTheme;
    appliedPluginTheme = undefined;
    return;
  }
  if (want === appliedPluginTheme && existing !== null) return;
  try {
    const { sendSettings } = await import("./api.js");
    const envelope = await sendSettings({ op: "plugin-theme-css", name: want });
    if (envelope.ok && typeof envelope.result?.css === "string" && envelope.result.css !== "") {
      let style = existing;
      if (style === null) {
        style = document.createElement("style");
        style.id = "aegent-plugin-theme";
        document.head.appendChild(style);
      }
      style.textContent = envelope.result.css;
      document.body.dataset.pluginTheme = want;
      appliedPluginTheme = want;
    } else {
      existing?.remove();
      delete document.body.dataset.pluginTheme;
      appliedPluginTheme = undefined;
      if (!envelope.ok) console.warn(`插件主题「${want}」载入失败：${envelope.error?.message ?? ""}`);
    }
  } catch (e) {
    existing?.remove();
    delete document.body.dataset.pluginTheme;
    appliedPluginTheme = undefined;
    console.warn(`插件主题「${want}」载入异常：${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 外观全量应用（设置保存 flush 与启动时都会走到——pideck applyAppearanceAttributes 同位）。 */
export function applyAppearance() {
  const a = settingsCache?.appearance ?? {};
  // 1) 主题模式 → 解析档（system 跟随 OS / schedule 按时间表 / 其余显式；
  //    旧档无 themeMode 时回退 theme 字段——兼容零破坏）
  const mode = a.themeMode ?? (a.theme !== undefined ? a.theme : "dark");
  const resolved =
    mode === "system" ? systemResolved() : mode === "schedule" ? scheduleResolved(a) : mode;
  document.body.dataset.theme = resolved === "light" ? "light" : "dark";
  // 2) 皮肤 / 强调色（data 属性——pideck 三属性同构；缺省移除属性=默认色板）
  if (a.skin) document.body.dataset.appearance = a.skin;
  else delete document.body.dataset.appearance;
  if (a.accent) document.body.dataset.accent = a.accent;
  else delete document.body.dataset.accent;
  // 3) 消息流外观开关（class 挂 body——CSS 块见 theme.css）
  document.body.classList.toggle("hide-reasoning", a.chatShowReasoning === false);
  document.body.classList.toggle("chat-wide", a.chatContentWidth === "wide");
  document.body.classList.toggle("chat-full", a.chatContentWidth === "full");
  document.body.classList.toggle("no-anim", a.animations === false);
  document.body.classList.toggle("daltonized", a.colorBlindFriendly === true);
  // 4) 字号 / 字体（token 基准覆写——calc 刻度全站联动；缺省移除=文件缺省）
  const rootStyle = document.documentElement.style;
  if (a.uiFontSize !== undefined) rootStyle.setProperty("--ui-font-size", `${String(a.uiFontSize)}px`);
  else rootStyle.removeProperty("--ui-font-size");
  const baseStack = fontStack(a.fontBase, false);
  if (baseStack !== undefined) rootStyle.setProperty("--font-ui", baseStack);
  else rootStyle.removeProperty("--font-ui");
  const monoStack = fontStack(a.fontMono, true);
  if (monoStack !== undefined) rootStyle.setProperty("--font-mono", monoStack);
  else rootStyle.removeProperty("--font-mono");
  // 5) 背景图 / 插件主题（异步面——fire-and-forget，失败回退不阻断）
  applyBackgroundLayer(a);
  void syncPluginTheme();
  // 6) 按时间表：重挂边界定时器（唤醒式——pideck 同款，非轮询）
  if (scheduleTimer !== null) {
    clearTimeout(scheduleTimer);
    scheduleTimer = null;
  }
  if (mode === "schedule") {
    scheduleTimer = setTimeout(() => applyAppearance(), Math.min(scheduleNextBoundaryMs(a) + 1000, 2_147_000_000));
  }
}

export function applyTheme(theme) {
  void theme; // 兼容旧签名——现在全部以 settingsCache.appearance 为准
  applyAppearance();
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
