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
import { icon } from "../../icons.js";

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
    // T-P3-137：保存成功即分节列表刷新——settingsCache 已被服务端回包整体
    // 替换（元素对象全新），持有旧行引用的列表必须重渲（闭包引用失效类
    // bug 的根治点——如供应商列表上移/下移后消失）。只刷列表不回填表单
    // （防覆盖用户未保存的输入——refill 仅导入路径）。
    fireSectionRefresh();
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

// 跨分节刷新钩子（同层子模块互不 import 的联动面——如 Profiles 切换写
// defaultProvider 后，providers 分节的默认项卡需要重渲染）
const sectionRefreshHooks = new Set();

export function onSectionRefresh(fn) {
  sectionRefreshHooks.add(fn);
}

export function fireSectionRefresh() {
  for (const fn of sectionRefreshHooks) fn();
}

// ---------------------------------------------------------------------------
// 模态基座（ZCode dialog 形态：遮罩 blur + Header(title+desc)+右上 X 关闭 +
// Footer 右对齐 + 宽度三档 + 入动画；Esc/遮罩/X 均可关闭并回调 onClose）。
// overlay 挂 document.body——设置视图卸载时随壳收束，也支持视图未挂载时的
// 深链确认调用。body 内的原生 select 经 upgradeSelects 自动升级为自定义下拉。
// ---------------------------------------------------------------------------

/**
 * 打开模态。body：文本字符串或 DOM 节点（表单模态传构造好的 form）；
 * description：标题下的说明行（muted）；width："sm"(420)/"md"(520)/
 * "lg"(620)/"xl"(760)；dismissible：false = 只能经 actions 按钮关闭
 * （遮罩点击/Esc/X 全禁——大表单模态防误触丢稿，用户裁决）；onClose：
 * 非 action 关闭路径（X/Esc/遮罩）的回调（confirmDialog 的取消面）；
 * className：附加在 .dialog 上的定制类（如供应商大模态的 dialog-provider）。
 * body 内的原生 select 经 upgradeSelects 自动升级为自定义下拉。
 * 返回 { close }（程序化关闭）。
 */
export function openDialog({ title, description, body, actions = [], width, onClose, dismissible = true, className }) {
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  const widthClass =
    width === "max"
      ? " dialog-max"
      : width === "xl"
        ? " dialog-xl"
        : width === "lg"
          ? " dialog-lg"
          : width === "md"
            ? " dialog-md"
            : "";
  const dialog = document.createElement("div");
  dialog.className = `dialog${widthClass}${className ? ` ${className}` : ""}`;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const header = document.createElement("div");
  header.className = "dialog-header";
  const titleEl = document.createElement("div");
  titleEl.className = "dialog-title";
  titleEl.textContent = title;
  header.appendChild(titleEl);
  if (description !== undefined) {
    const descEl = document.createElement("div");
    descEl.className = "dialog-desc";
    descEl.textContent = description;
    header.appendChild(descEl);
  }
  const bodyEl = document.createElement("div");
  bodyEl.className = "dialog-body";
  if (typeof body === "string") {
    bodyEl.textContent = body;
  } else if (body instanceof Node) {
    bodyEl.appendChild(body);
    upgradeSelects(bodyEl); // 模态内原生 select 升级为自定义下拉
  }
  const footer = document.createElement("div");
  footer.className = "dialog-footer";
  const escHandler = (ev) => {
    if (ev.key === "Escape" && dismissible) {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    }
  };
  const close = (fromAction = false) => {
    window.removeEventListener("keydown", escHandler, true);
    document.body.style.overflow = "";
    overlay.remove();
    if (!fromAction && onClose !== undefined) onClose();
  };
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay && dismissible) close();
  });
  window.addEventListener("keydown", escHandler, true);
  // 打开期间锁定背景滚动（ZCode/shadcn 同款语义）
  document.body.style.overflow = "hidden";
  if (dismissible) {
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "dialog-close";
    closeBtn.setAttribute("aria-label", "关闭");
    closeBtn.appendChild(icon("close"));
    closeBtn.addEventListener("click", () => close());
    dialog.appendChild(closeBtn);
  }
  for (const a of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = a.className ?? "btn";
    btn.textContent = a.label;
    btn.addEventListener("click", () => {
      if (a.close !== false) close(true);
      void a.onClick?.();
    });
    footer.appendChild(btn);
  }
  dialog.append(header, bodyEl, footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  return { close };
}

/** 锚定菜单（… 操作组——pi-desktop 行内菜单形态）：点击项/外部/Esc 关闭。
 *  items：{ label, danger?, onClick? }。返回 close。 */
export function openMenu(anchor, items) {
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  const close = () => {
    document.removeEventListener("click", onDocClick, true);
    window.removeEventListener("keydown", onEsc, true);
    menu.remove();
  };
  const onDocClick = (ev) => {
    if (!menu.contains(ev.target)) close();
  };
  const onEsc = (ev) => {
    if (ev.key === "Escape") close();
  };
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = item.danger === true ? "menu-item menu-item-danger" : "menu-item";
    btn.textContent = item.label;
    btn.addEventListener("click", () => {
      close();
      void item.onClick?.();
    });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  const menuHeight = menu.offsetHeight;
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menuHeight - 8)}px`;
  menu.style.left = `${Math.max(8, rect.right - menu.offsetWidth)}px`;
  setTimeout(() => document.addEventListener("click", onDocClick, true), 0);
  window.addEventListener("keydown", onEsc, true);
  return close;
}

/** 确认对话框（Promise 化——替代原生 window.confirm 的统一形态；danger =
 *  确认按钮红变体用于删除类）。X/Esc/遮罩/取消 均 resolve(false)。 */
export function confirmDialog(message, { title = "确认操作", confirmLabel = "确认", danger = false } = {}) {
  return new Promise((resolve) => {
    openDialog({
      title,
      description: message,
      width: "sm",
      onClose: () => resolve(false),
      actions: [
        { label: "取消", className: "btn btn-ghost", onClick: () => resolve(false) },
        { label: confirmLabel, className: danger ? "btn btn-danger" : "btn btn-primary", onClick: () => resolve(true) },
      ],
    });
  });
}

// ---------------------------------------------------------------------------
// 自定义下拉（ZCode select 形态：触发器 = input 变体 + chevron；面板 =
// rounded 面板 + 选中 check + hover 面。桥接原生 select：DOM 保留原 select
// （隐藏）——id/选项/change 监听/fill() 的 .value 赋值全兼容；实例 value
// setter 拦截使触发器随程序化赋值同步。键盘化选单不取（记档：点选语义）。
// ---------------------------------------------------------------------------

/**
 * 选项清单重建后的面板同步（T-P3-145 修）：upgradeSelects 的面板项是升级
 * 时一次性构建的——运行中 replaceChildren/动态改 options（级联、候选增减）
 * 后必须调本函数，否则浮层显示旧清单/空清单。未桥接（直连原生）= 零操作。
 */
export function refreshSelectPanel(sel) {
  const wrap = sel.closest(".select-wrap");
  if (wrap === null || wrap === undefined) return;
  const panel = wrap.querySelector(".select-panel");
  if (panel === null || panel === undefined) return;
  buildSelectPanelItems(sel, panel);
  const valueText = wrap.querySelector(".select-value-text");
  if (valueText !== null && valueText !== undefined) {
    valueText.textContent = sel.selectedOptions[0]?.textContent ?? "";
  }
  syncPanelSelection(sel, panel);
}

/** 面板项构建（升级与刷新共用——options 全量重扫）。 */
function buildSelectPanelItems(sel, panel) {
  panel.replaceChildren();
  for (const opt of sel.options) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "select-option";
    item.dataset.value = opt.value;
    const label = document.createElement("span");
    label.textContent = opt.textContent;
    item.appendChild(label);
    if (opt.disabled) item.disabled = true;
    item.addEventListener("click", () => {
      sel.value = opt.value; // 实例 setter → syncSelected → change 监听照常
      sel.dispatchEvent(new Event("change", { bubbles: false }));
    });
    panel.appendChild(item);
  }
}

/** 面板选中态与触发器文本同步（change/打开面板/刷新三处共用）。 */
function syncPanelSelection(sel, panel) {
  const wrap = panel.closest(".select-wrap");
  const valueText = wrap?.querySelector(".select-value-text");
  if (valueText !== null && valueText !== undefined) {
    valueText.textContent = sel.selectedOptions[0]?.textContent ?? "";
  }
  for (const item of panel.querySelectorAll(".select-option")) {
    const isSelected = item.dataset.value === sel.value;
    item.classList.toggle("selected", isSelected);
    if (isSelected && !item.querySelector(".select-check")) {
      const check = icon("check");
      check.classList.add("select-check");
      item.appendChild(check);
    } else if (!isSelected) {
      item.querySelector(".select-check")?.remove();
    }
  }
}

export function upgradeSelects(root) {
  for (const sel of root.querySelectorAll("select.select")) {
    if (sel.dataset.upgraded === "1") continue;
    sel.dataset.upgraded = "1";
    const wrap = document.createElement("span");
    wrap.className = "select-wrap";
    sel.parentNode.insertBefore(wrap, sel);
    sel.classList.add("sr-select-native"); // 原生控件隐藏但保留（值语义面）
    wrap.appendChild(sel);

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    const valueText = document.createElement("span");
    valueText.className = "select-value-text";
    const chevron = icon("chevronDown");
    chevron.classList.add("select-chevron");
    trigger.append(valueText, chevron);

    const panel = document.createElement("div");
    panel.className = "select-panel";
    panel.hidden = true;
    buildSelectPanelItems(sel, panel);
    const syncSelected = () => syncPanelSelection(sel, panel);
    sel.addEventListener("change", syncSelected);

    const onDocClick = (ev) => {
      if (!wrap.contains(ev.target)) closePanel();
    };
    const openPanel = () => {
      panel.hidden = false;
      trigger.classList.add("open");
      syncSelected();
      setTimeout(() => document.addEventListener("click", onDocClick, true), 0);
    };
    const closePanel = () => {
      panel.hidden = true;
      trigger.classList.remove("open");
      document.removeEventListener("click", onDocClick, true);
    };
    trigger.addEventListener("click", () => {
      if (panel.hidden) openPanel();
      else closePanel();
    });

    // 实例级 value setter 拦截（fill() 直接 .value = x 时触发器同步——
    // 原型属性被实例属性遮蔽，get/set 转发原生语义）
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    Object.defineProperty(sel, "value", {
      get() {
        return desc.get.call(this);
      },
      set(v) {
        desc.set.call(this, v);
        syncSelected();
      },
      configurable: true,
    });

    // T-P3-146 修：append 必须先于首次 syncSelected——syncPanelSelection 经
    // panel.closest(".select-wrap") 找触发器，panel 未入 wrap 时查不到，
    // 初始触发器文本永远空（模态内预赋值 select 的实测坑）
    wrap.append(trigger, panel);
    syncSelected();
  }
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
