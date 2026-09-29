/**
 * 快捷键注册表（U25/T-P3-128——KeyboardShortcutsSection 行为锚，🔴 只学
 * 行为）：清单可查（DEFAULT_KEYMAP）、可自定义绑定（settings.shortcuts
 * 覆盖）、冲突提示（注册表内冲突 + 浏览器保留键——提示不拦截，卡内定形）。
 *
 * 纯逻辑模块（无 DOM 依赖——src/diagnostics/keymap.test.ts 直测）：
 *   - combo 规范化：修饰键顺序固定 Ctrl < Alt < Shift < Meta，键名取
 *     e.key 规范形式（字母大写、"F1.."/"Escape"/",".. 原名）——同一物理
 *     按键在注册表内唯一表示，冲突检测与持久化都建立在规范串上；
 *   - 覆盖合并：settings.shortcuts（action → combo）只覆盖列出的 action，
 *     未列出的用默认（部分覆盖语义——升级加新键位时用户旧档不失效）；
 *   - 冲突检测：注册表内两 action 同 combo = 冲突（阻断保存）；浏览器
 *     保留键 = 提示（WebView 内 Ctrl 组合多数可达，保留面随宿主差异——
 *     不拦截，UI 提示用户自测）。
 *
 * 卡面映射记档：U25 原文"面板开合/发送/搜索/会话切换/新建会话"——
 * 发送键（Enter）是核心交互不进自定义面（清单展示"固定"）；会话切换/
 * 新建会话无对应 UI 面（host 单会话模型）——映射为会话历史开合（切换
 * 入口），新建会话记档 YAGNI。
 */

/** 默认键位表（action → combo 规范串）。 */
export const DEFAULT_KEYMAP = {
  settings: "Ctrl+,",
  find: "Ctrl+F",
  search: "Ctrl+Shift+F",
  "close-find": "Escape",
  history: "Ctrl+H",
  work: "Ctrl+J",
  usage: "Ctrl+U",
  notify: "Ctrl+B",
};

/** action 的中文说明（清单展示面）。 */
export const ACTION_LABELS = {
  settings: "设置面板开合",
  find: "会话内搜索",
  search: "跨会话搜索",
  "close-find": "关闭搜索条",
  history: "会话历史（切换入口）",
  work: "工作面板开合",
  usage: "用量面板开合",
  notify: "通知中心开合",
  send: "发送（固定，不可改）",
};

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
