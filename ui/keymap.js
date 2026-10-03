/**
 * 快捷键注册表（U25/T-P3-128 · T-P3-152 升级为动作注册表——KeyboardShortcuts
 * Section 行为锚）：清单可查、可自定义绑定（settings.shortcuts 覆盖）、冲突
 * 实时检测（注册表内冲突 + 浏览器保留键）、分组/来源/作用域元数据（VS Code
 * 键位编辑器四列行先例）。
 *
 * 纯逻辑模块（无 DOM 依赖——src/diagnostics/keymap.test.ts 直测）：
 *   - combo 规范化：修饰键顺序固定 Ctrl < Alt < Shift < Meta，键名取
 *     e.key 规范形式（字母大写、"F1.."/"Escape"/",".. 原名）——同一物理
 *     按键在注册表内唯一表示，冲突检测与持久化都建立在规范串上；
 *   - 覆盖合并：settings.shortcuts（action → combo）只覆盖列出的 action，
 *     未列出的用默认（部分覆盖语义——升级加新键位时用户旧档不失效）；
 *   - 冲突检测：注册表内两 action 同 combo = 冲突（阻断保存）；浏览器
 *     保留键 = 提示（WebView 内 Ctrl 组合多数可达，保留面随宿主差异——
 *     不拦截，UI 提示用户自测）；
 *   - inInput 作用域（T-P3-152 派生列）：键位带修饰键或为 Escape 的动作
 *     在输入框焦点内可达（打字安全），纯单键动作输入区外专属——由 combo
 *     派生（usableInInput），不另设动作字段（when 全体系记档 P2）。
 *
 * 卡面映射记档：U25 原文"面板开合/发送/搜索/会话切换/新建会话"——
 * 发送键（Enter）是核心交互不进自定义面（清单展示"固定"）；会话切换/
 * 新建会话无对应 UI 面（host 单会话模型）——映射为会话历史开合（切换
 * 入口），新建会话记档 YAGNI。T-P3-152 动作扩容（8→17）：聚焦输入框/
 * 复制最后回复/清空输入/滚动到顶/底/项目页/插件页直达/租约切换/? 速查——
 * 全部以 app.js KEYMAP_HANDLERS 真实能力为准。
 */

/**
 * 动作注册表（元数据：label 显示名 / group 分组 / default 默认键位 /
 * fixed=true 核心交互不进自定义面）。分组语义（T-P3-152 A2）：
 *   - 导航：跨页跳转与切换入口
 *   - 视图与面板：面板/搜索条开合
 *   - 输入与流：输入框、消息流与租约
 */
export const ACTIONS = {
  // 导航
  history: { label: "定位最近会话（侧栏）", group: "导航", default: "Ctrl+H" },
  search: { label: "跨会话搜索", group: "导航", default: "Ctrl+Shift+F" },
  "goto-projects": { label: "定位项目列表（侧栏）", group: "导航", default: "Ctrl+Shift+P" },
  "goto-plugins": { label: "打开插件页", group: "导航", default: "Ctrl+Shift+U" },
  usage: { label: "用量面板开合", group: "导航", default: "Ctrl+U" },
  notify: { label: "通知中心开合", group: "导航", default: "Ctrl+B" },
  "new-task": { label: "新建任务", group: "导航", default: "Ctrl+Shift+N" },
  // 视图与面板
  settings: { label: "设置面板开合", group: "视图与面板", default: "Ctrl+," },
  work: { label: "工作面板开合（深链）", group: "视图与面板", default: "Ctrl+J" },
  pane: { label: "切换面板开合", group: "视图与面板", default: "Ctrl+Alt+P" },
  find: { label: "会话内搜索", group: "视图与面板", default: "Ctrl+F" },
  "close-find": { label: "关闭搜索条", group: "视图与面板", default: "Escape" },
  // 输入与流
  "focus-input": { label: "聚焦输入框", group: "输入与流", default: "Ctrl+I" },
  "clear-input": { label: "清空输入框", group: "输入与流", default: "Ctrl+Shift+Delete" },
  "copy-last-reply": { label: "复制最后回复", group: "输入与流", default: "Ctrl+Shift+Y" },
  "scroll-top": { label: "滚动到顶部", group: "输入与流", default: "Ctrl+Home" },
  "scroll-bottom": { label: "滚动到底部", group: "输入与流", default: "Ctrl+End" },
  "toggle-lease": { label: "取得/释放写租约", group: "输入与流", default: "Ctrl+Shift+L" },
  cheatsheet: { label: "快捷键速查面板", group: "视图与面板", default: "?" },
  send: { label: "发送（固定，不可改）", group: "输入与流", default: "Enter", fixed: true },
};

/** 默认键位表（action → combo 规范串；fixed 动作不进可改绑表）。 */
export const DEFAULT_KEYMAP = Object.fromEntries(
  Object.entries(ACTIONS)
    .filter(([, def]) => def.fixed !== true)
    .map(([action, def]) => [action, def.default]),
);

/** action 的中文说明（清单展示面——兼容旧消费面）。 */
export const ACTION_LABELS = Object.fromEntries(
  Object.entries(ACTIONS).map(([action, def]) => [action, def.label]),
);

/** 动作分组序（清单渲染顺序——send 固定行在组内最后）。 */
export const ACTION_GROUPS = ["导航", "视图与面板", "输入与流"];

/** 浏览器/宿主常见保留键（提示不拦截——卡内定形）。 */
export const RESERVED_COMBOS = new Set([
  "Ctrl+N",
  "Ctrl+T",
  "Ctrl+W",
  "Ctrl+Tab",
  "Ctrl+L",
  "Ctrl+D",
  "Ctrl+S",
  "Ctrl+P",
  "Ctrl+R",
  "F5",
  "F11",
  "F12",
]);

/**
 * 作用域派生（T-P3-152 B3 降级版）：键位带修饰键或为 Escape → 输入框
 * 焦点内可达（打字安全）；纯单键动作输入区外专属。when 全体系记档 P2。
 */
export function usableInInput(combo) {
  const idx = combo.lastIndexOf("+");
  if (idx === -1) return combo === "Escape"; // 纯单键——Escape 特例
  return idx > 0; // 有修饰键前缀（排除 "+key" 畸形）
}

/** 修饰键规范化顺序（Ctrl < Alt < Shift < Meta）。 */
const MOD_ORDER = { ctrl: 0, alt: 1, shift: 2, meta: 3 };

/** 键名的规范形式（字母大写；其余保留 e.key 原名——"Escape"/","/"F1"）。 */
function normalizeKeyName(key) {
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/**
 * KeyboardEvent → 规范 combo 串（如 "Ctrl+Shift+F"）。无键名的纯修饰
 * 按键返回 null（不构成绑定）。
 */
export function eventToCombo(e) {
  const key = normalizeKeyName(e.key ?? "");
  if (key === "" || ["Control", "Alt", "Shift", "Meta"].includes(key)) return null;
  const mods = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Meta");
  mods.sort((a, b) => MOD_ORDER[a.toLowerCase()] - MOD_ORDER[b.toLowerCase()]);
  return `${[...mods, key].join("+")}`;
}

/** 组合串解析（规范化方向——重复/乱序修饰键归一）。 */
export function formatCombo(parts) {
  const mods = parts.slice(0, -1).map((m) => m.toLowerCase());
  const unique = [...new Set(mods)].sort((a, b) => MOD_ORDER[a] - MOD_ORDER[b]);
  const labels = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "Meta" };
  return `${[...unique.map((m) => labels[m]), normalizeKeyName(parts[parts.length - 1])].join("+")}`;
}

/**
 * 冲突检测：①注册表内冲突——除 selfAction 外已有 action 绑定同 combo；
 * ②保留键提示——combo 在 RESERVED_COMBOS（提示不拦截）。返回
 * { conflict?: action, reserved?: true }。
 */
export function detectConflict(combo, bindings, selfAction) {
  const result = {};
  for (const [action, bound] of Object.entries(bindings)) {
    if (action === selfAction) continue;
    if (bound === combo) result.conflict = action;
  }
  if (RESERVED_COMBOS.has(combo)) result.reserved = true;
  return result;
}

/**
 * 键位表合并（settings.shortcuts 部分覆盖 → 完整 bindings）；非法覆盖值
 * （非字符串/空串）忽略——坏档不炸键位面。
 */
export function createKeymap(overrides) {
  const bindings = { ...DEFAULT_KEYMAP };
  for (const [action, combo] of Object.entries(overrides ?? {})) {
    if (typeof combo === "string" && combo.trim() !== "" && action in bindings) {
      bindings[action] = combo;
    }
  }
  return bindings;
}

/**
 * 事件分发（注册表的消费面）：命中的 action 返回，未命中返回 null。
 * 输入区内（inInput）只放行两类——带修饰键的组合（打字中 Ctrl+F 仍可
 * 搜索，既有行为）与无修饰键的 Escape（关搜索条）；其余单键还给编辑。
 */
export function resolveAction(bindings, e, { inInput = false } = {}) {
  const combo = eventToCombo(e);
  if (combo === null) return null;
  if (inInput) {
    const hasMods = combo.slice(0, combo.lastIndexOf("+")).length > 0;
    if (!hasMods && combo !== "Escape") return null;
  }
  for (const [action, bound] of Object.entries(bindings)) {
    if (bound === combo) return action;
  }
  return null;
}
