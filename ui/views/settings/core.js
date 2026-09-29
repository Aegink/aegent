/**
 * 设置域共享层（T-P3-135 · UI 批次 B① 拆分产物）——保存时序 + 模态基座 +
 * 行式卡构造原语。markDirty/dirtySections/flushSettings 自 settings.js 壳
 * 下沉（保存时序是全分节共享面：段级 patch + 500ms 防抖合并——原 app.js
 * 体语义原样）；openDialog 是 .dialog 组件类的接线 helper（导入确认/供应商
 * 连接测试等模态共用——批 B④/⑨ 确认面模态化的形态基座）。
 */

import { sendSettings } from "../../api.js";
import { settingsCache, setSettingsCache, applyTheme, rebuildKeymap } from "../../state.js";
import { appendLine } from "../../feedback.js";

// ---------------------------------------------------------------------------
// 保存时序（即改即存：段级 patch，500ms 防抖合并——原 settings.js 壳体原样）
// ---------------------------------------------------------------------------

let saveTimer = null;
export const dirtySections = new Set();

/** 改动 → 标脏 → 防抖合并成一次段级 update（即改即存的保存时序）。 */
export function markDirty(section) {
  dirtySections.add(section);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSettings, 500);
}

export async function flushSettings() {
  if (dirtySections.size === 0 || settingsCache === null) return;
  const patch = {};
  for (const section of dirtySections) {
    if (section === "defaultProvider") {
      patch.defaultProvider = settingsCache.defaultProvider;
    } else if (section === "projects" || section === "prompts") {
      patch[section] = settingsCache[section] ?? []; // 数组段缺省发空数组（对象段才发 {}）
    } else {
      patch[section] = settingsCache[section] ?? {};
    }
  }
  dirtySections.clear();
  const envelope = await sendSettings({ op: "update", patch });
  if (envelope.ok) {
    setSettingsCache(envelope.result.settings);
    applyTheme(settingsCache.appearance?.theme);
    rebuildKeymap(); // U25：shortcuts 段保存后键位同步
  } else {
    appendLine(`设置保存失败：${envelope.error?.message ?? ""}`, "warn");
  }
}

// ---------------------------------------------------------------------------
// 导入成功后的全量回填（壳 render 时注册——避免 system 同层 import basic/
// agents 的同层依赖；applyImportedSettingsObject 成功后经此全量刷新表单）
// ---------------------------------------------------------------------------

let refillForms = null;

export function setRefillForms(fn) {
  refillForms = fn;
}

export function refillFormsAfterImport() {
  if (refillForms !== null) refillForms();
}

// ---------------------------------------------------------------------------
// 模态基座（.dialog 组件类接线——title + body 节点 + actions 按钮；Esc/遮罩
// 点击关闭。overlay 挂 document.body——设置视图卸载时随壳收束，也支持
// 视图未挂载时的深链确认调用）
// ---------------------------------------------------------------------------

/**
 * 打开模态。body：文本字符串或 DOM 节点（表单模态传构造好的 form）。
 * actions：{ label, className?, close?（默认 true——点击后关模态）, onClick? }。
 * 返回 { close }（程序化关闭——保存成功后的收尾）。
 */
export function openDialog({ title, body, actions = [] }) {
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  const dialog = document.createElement("div");
  dialog.className = "dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const titleEl = document.createElement("div");
  titleEl.className = "dialog-title";
  titleEl.textContent = title;
  const bodyEl = document.createElement("div");
  bodyEl.className = "dialog-body";
  if (typeof body === "string") {
    bodyEl.textContent = body;
  } else if (body instanceof Node) {
    bodyEl.appendChild(body);
  }
  const actionsEl = document.createElement("div");
  actionsEl.className = "dialog-actions";
  const escHandler = (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  };
  const close = () => {
    window.removeEventListener("keydown", escHandler, true);
    overlay.remove();
  };
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  window.addEventListener("keydown", escHandler, true);
  for (const a of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = a.className ?? "btn";
    btn.textContent = a.label;
    btn.addEventListener("click", () => {
      if (a.close !== false) close();
      void a.onClick?.();
    });
    actionsEl.appendChild(btn);
  }
  dialog.append(titleEl, bodyEl, actionsEl);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  return { close };
}

// ---------------------------------------------------------------------------
// 行式卡构造原语（opencode settings-v2 行母版的 DOM 面——row-list/row 消费
// components.css 组件类；title 13px/530、desc 13px/440 muted 的两级文案）
// ---------------------------------------------------------------------------

/** 行容器（.row——行间 0.5px 分隔由 CSS 兄弟选择器落）。 */
export function rowEl() {
  const row = document.createElement("div");
  row.className = "row";
  return row;
}

/** 行文案两级（row-title + 可选 row-desc——flex:1 占位，min-width:0 截断）。 */
export function rowCopy(title, desc) {
  const copy = document.createElement("div");
  copy.className = "row-copy";
  const t = document.createElement("div");
  t.className = "row-title";
  t.textContent = title;
  copy.appendChild(t);
  if (desc !== undefined) {
    const d = document.createElement("div");
    d.className = "row-desc";
    d.textContent = desc;
    copy.appendChild(d);
  }
  return copy;
}

/** 行文案的扩展变体（title 节点自行构造——名称行可带 badge/chip 内联）。 */
export function rowCopyEl(titleNode, descNode) {
  const copy = document.createElement("div");
  copy.className = "row-copy";
  copy.append(titleNode, descNode);
  return copy;
}

/** 控件槽（右对齐——按钮/开关/下拉的落位）。 */
export function rowControl(...nodes) {
  const box = document.createElement("div");
  box.className = "row-control";
  box.append(...nodes.filter((n) => n !== null));
  return box;
}

/** 小按钮（.btn 基类 + 可选变体；title 提示走原生属性）。 */
export function btnEl(label, className = "btn", title = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = label;
  if (title !== "") b.title = title;
  return b;
}

/** 空状态（虚线框——title + desc 两级）。 */
export function emptyState(title, desc) {
  const box = document.createElement("div");
  box.className = "empty-state";
  const t = document.createElement("div");
  t.className = "empty-title";
  t.textContent = title;
  box.appendChild(t);
  if (desc !== undefined) {
    const d = document.createElement("div");
    d.className = "empty-desc";
    d.textContent = desc;
    box.appendChild(d);
  }
  return box;
}

/** chip（.chip-ui——名称行内元信息：来源/transport/工具数）。 */
export function chipEl(text, active = false) {
  const chip = document.createElement("span");
  chip.className = active ? "chip-ui active" : "chip-ui";
  chip.textContent = text;
  return chip;
}

/**
 * 开关（.switch 44×24 胶囊——checked 态即启用；change 回调接业务原样）。
 * aria-label 供可访问性与走查。
 */
export function switchEl(checked, onChange, label) {
  const wrap = document.createElement("label");
  wrap.className = "switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  if (label) input.setAttribute("aria-label", label);
  input.addEventListener("change", () => onChange(input.checked));
  const track = document.createElement("span");
  track.className = "switch-track";
  wrap.append(input, track);
  return wrap;
}
