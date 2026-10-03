/**
 * 快捷键域（T-P3-152——从 system.js 迁出的重构面，instructions.js 同款模式）：
 * - A1/A2 分组四列清单：动作名/键位 kbd 胶囊/输入区内可达徽标/来源徽标（默认|
 *   已自定义）+ 单行重置（JetBrains Reset Shortcuts 先例——仅清该行覆盖）；
 * - B1 录制确认流改键（VS Code 三步流）：捕获态按下组合 → 待确认（Enter 落盘
 *   /Esc 取消/再按新组合重新捕获），确认才写 settings.shortcuts；
 * - **冲突实时检查**（用户点名需求）：捕获态按下组合的瞬间显示占用者（阻断）；
 *   清单渲染时逐行 detectConflict 标红历史冲突；
 * - B2 录制搜索（Record Keys 先例）：搜索框旁键盘按钮 → 按组合过滤"这个键被
 *   谁占用"；
 * - 全局恢复默认保留。
 * 数据面：settings.shortcuts 部分覆盖（keymap.js ACTIONS 注册表 + 覆盖合并）。
 */

import {
  ACTIONS,
  ACTION_GROUPS,
  ACTION_LABELS,
  createKeymap,
  detectConflict,
  eventToCombo,
  usableInInput,
} from "../../keymap.js";
import { settingsCache } from "../../state.js";
import { icon } from "../../icons.js";
import { markDirty, dirtySections } from "./core.js";

let capturingAction = null; // 非 null = 捕获态（下一次按键成为待确认组合）
let capturedCombo = null; // 待确认组合（Enter 确认 / Esc 取消 / 重按替换）
let capturedReserved = false; // 待确认组合的保留键标记
let shortcutFilter = "";
let recordingSearch = false; // B2 录制搜索态

function el(id) {
  return document.getElementById(id);
}

function comboCaps(combo) {
  const box = document.createElement("span");
  box.className = "combo-caps";
  for (const part of combo.split("+")) {
    const k = document.createElement("kbd");
    k.className = "kbd";
    k.textContent = part;
    box.appendChild(k);
  }
  if (combo === "") box.appendChild(document.createTextNode("（未绑定）"));
  return box;
}

function rowEl() {
  const row = document.createElement("div");
  row.className = "row";
  return row;
}

function rowCopyEl(titleEl, descEl) {
  const copy = document.createElement("div");
  copy.className = "row-copy";
  copy.append(titleEl, descEl);
  return copy;
}

function rowControl(...children) {
  const control = document.createElement("div");
  control.className = "row-control";
  control.append(...children);
  return control;
}

function btnEl(text, className) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = text;
  return btn;
}

function shortcutMatches(label, action, combo) {
  if (shortcutFilter === "") return true;
  // 录制搜索：过滤器已被替换为规范 combo——只按键位匹配（B2）
  if (recordingSearch === false && shortcutFilter.startsWith("@key:")) {
    return combo === shortcutFilter.slice(5);
  }
  const q = shortcutFilter.toLowerCase();
  return label.toLowerCase().includes(q) || action.toLowerCase().includes(q) || combo.toLowerCase().includes(q);
}

/** 分组渲染（A2）+ 四列行 + 实时冲突标红。 */
function renderShortcutList() {
  const list = el("shortcut-list");
  if (list === null) return;
  const status = el("shortcut-status");
  list.replaceChildren();
  const bindings = createKeymap(settingsCache?.shortcuts);
  let visible = 0;
  for (const group of ACTION_GROUPS) {
    const actions = Object.entries(ACTION_LABELS).filter(([action]) => {
      if (ACTIONS[action]?.group !== group) return false; // 组归属（防重复渲染）
      const combo = action === "send" ? "Enter" : bindings[action];
      if (combo === undefined) return false; // 注册表外未知动作
      return shortcutMatches(ACTION_LABELS[action], action, combo);
    });
    // 组内过滤后非空才渲染组头（send 固定行随"输入与流"组展示）
    if (actions.length === 0) continue;
    const head = document.createElement("div");
    head.className = "shortcut-group";
    head.textContent = group;
    list.appendChild(head);
    for (const [action] of actions) {
      const label = ACTION_LABELS[action];
      visible++;
      const isFixed = action === "send";
      const combo = isFixed ? "Enter" : bindings[action] ?? "";
      const row = rowEl();
      const titleEl = document.createElement("div");
      titleEl.className = "row-title";
      titleEl.textContent = label;
      // 来源徽标（默认 | 已自定义）
      const source = document.createElement("span");
      const isCustom = !isFixed && settingsCache?.shortcuts?.[action] !== undefined;
      source.className = `chip ${isCustom ? "chip-ok" : ""}`;
      source.textContent = isCustom ? "已自定义" : "默认";
      titleEl.appendChild(source);
      // 实时冲突标红（历史档冲突可见——保存面阻断新冲突）
      const conflictInfo = !isFixed ? detectConflict(combo, bindings, action) : {};
      const descEl = document.createElement("div");
      descEl.className = "row-desc";
      const notes = [];
      if (conflictInfo.conflict !== undefined) {
        notes.push(`与「${ACTION_LABELS[conflictInfo.conflict]}」冲突`);
        row.classList.add("row-conflict");
      }
      if (conflictInfo.reserved === true) {
        notes.push("浏览器保留键——提示不拦截，请自测");
      }
      descEl.textContent =
        notes.join("；") ||
        (isFixed
          ? "核心交互固定不可改"
          : usableInInput(combo)
            ? "输入框内也可用（带修饰键/Escape）"
            : "仅输入框外生效");
      if (conflictInfo.conflict !== undefined) descEl.classList.add("error-text");
      const control = rowControl(comboCaps(combo));
      if (!isFixed) {
        if (capturingAction === action) {
          const captureBtn = btnEl(capturedCombo ?? "按键…", "btn active-mark");
          captureBtn.title = "按新组合（Enter 确认 / Esc 取消）";
          control.appendChild(captureBtn);
        } else {
          const editBtn = btnEl("修改", "btn");
          editBtn.addEventListener("click", () => {
            capturingAction = action;
            capturedCombo = null;
            capturedReserved = false;
            if (status !== null) {
              status.textContent = `捕获中：为「${label}」按新组合，Enter 确认（Esc 取消）`;
            }
            renderShortcutList();
          });
          control.appendChild(editBtn);
        }
        if (isCustom) {
          // 单行重置（JetBrains Reset Shortcuts——仅清该行覆盖）
          const resetBtn = btnEl("重置", "btn");
          resetBtn.title = "清除该行的自定义绑定，恢复默认键位";
          resetBtn.addEventListener("click", () => {
            const overrides = { ...(settingsCache.shortcuts ?? {}) };
            delete overrides[action];
            settingsCache.shortcuts = overrides;
            markDirty("shortcuts");
            dirtySections.add("shortcuts");
            if (capturingAction === action) {
              capturingAction = null;
              capturedCombo = null;
            }
            if (status !== null) status.textContent = `已重置「${label}」为默认键位。`;
            renderShortcutList();
          });
          control.appendChild(resetBtn);
        }
      }
      row.append(rowCopyEl(titleEl, descEl), control);
      list.appendChild(row);
    }
  }
  if (visible === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = recordingSearch
      ? "没有动作绑定该组合。"
      : `没有名称含「${shortcutFilter}」的动作`;
    list.appendChild(empty);
  }
}

/**
 * 捕获态键监听（捕获阶段抢先于分发监听——render 时挂载/unmount 时移除）。
 * T-P3-152 状态机：capturing（无 combo）→ 按组合 → 待确认（实时冲突检查：
 * 冲突即显示占用者并停在捕获态；无冲突进入待确认）→ Enter 落盘 / Esc 取消 /
 * 重按新组合替换待确认。
 */
export function shortcutCaptureKeydown(ev) {
  // B2 录制搜索态：捕获一按即过滤，不落盘
  if (recordingSearch) {
    if (ev.key === "Escape") {
      recordingSearch = false;
      const box = el("shortcut-search");
      if (box !== null) box.value = "";
      shortcutFilter = "";
      setSearchIconActive(false);
      renderShortcutList();
      ev.preventDefault();
      ev.stopImmediatePropagation();
      return;
    }
    const combo = eventToCombo(ev);
    if (combo === null) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    recordingSearch = false;
    setSearchIconActive(false);
    const box = el("shortcut-search");
    if (box !== null) box.value = `键位 ${combo}`;
    shortcutFilter = `@key:${combo}`;
    const status = el("shortcut-status");
    if (status !== null) status.textContent = `录制搜索：${combo}`;
    renderShortcutList();
    return;
  }
  if (capturingAction === null) return;
  // Esc：待确认态取消整个捕获；捕获空态同样取消
  if (ev.key === "Escape") {
    capturingAction = null;
    capturedCombo = null;
    const status = el("shortcut-status");
    if (status !== null) status.textContent = "已取消捕获。";
    renderShortcutList();
    ev.preventDefault();
    ev.stopImmediatePropagation(); // 同元素冒泡阶段的分发监听也须拦（T-P3-152 走查根治）
    return;
  }
  const combo = eventToCombo(ev);
  if (combo === null) return;
  // Enter：确认落盘（待确认态才有效）
  if (ev.key === "Enter" && capturedCombo !== null) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    const overrides = { ...(settingsCache.shortcuts ?? {}) };
    overrides[capturingAction] = capturedCombo;
    settingsCache.shortcuts = overrides;
    markDirty("shortcuts");
    dirtySections.add("shortcuts");
    const status = el("shortcut-status");
    const reservedNote = capturedReserved ? "（浏览器保留键——提示不拦截）" : "";
    if (status !== null) {
      status.textContent = `${ACTION_LABELS[capturingAction]} → ${capturedCombo}${reservedNote}`;
    }
    capturingAction = null;
    capturedCombo = null;
    capturedReserved = false;
    renderShortcutList();
    return;
  }
  // 其它键：成为新待确认组合——实时冲突检查（用户点名：按下瞬间显示占用者）
  ev.preventDefault();
  ev.stopImmediatePropagation();
  const bindings = createKeymap(settingsCache?.shortcuts);
  const conflict = detectConflict(combo, bindings, capturingAction);
  const status = el("shortcut-status");
  if (conflict.conflict !== undefined) {
    // 冲突阻断：停在捕获态（可换键/Esc 取消），实时显示占用者
    capturedCombo = null;
    capturedReserved = false;
    if (status !== null) {
      status.textContent = `${combo} 已被「${ACTION_LABELS[conflict.conflict]}」占用——换一个组合（Esc 取消）`;
    }
    renderShortcutList();
    return;
  }
  capturedCombo = combo;
  capturedReserved = conflict.reserved === true;
  if (status !== null) {
    status.textContent = `待确认：${ACTION_LABELS[capturingAction]} → ${combo}${capturedReserved ? "（浏览器保留键——提示不拦截）" : ""}——Enter 确认，重按新组合替换，Esc 取消`;
  }
  renderShortcutList();
}

function setSearchIconActive(active) {
  const btn = el("shortcut-record");
  if (btn !== null) btn.classList.toggle("active-mark", active);
}

/** 挂载绑定（section 首次插入 DOM 后调用一次——system.js bind 委派）。 */
export function bind() {
  const search = el("shortcut-search");
  if (search === null || search.dataset.bound === "1") return;
  search.dataset.bound = "1";
  search.addEventListener("input", (ev) => {
    // 录制搜索结果（@key: 前缀）被手动编辑则退回文本搜索
    shortcutFilter = ev.target.value.trim();
    renderShortcutList();
  });
  el("shortcut-record").addEventListener("click", () => {
    recordingSearch = !recordingSearch;
    setSearchIconActive(recordingSearch);
    const status = el("shortcut-status");
    if (status !== null) {
      status.textContent = recordingSearch
        ? "录制搜索：按下要查找的组合（Esc 取消）"
        : "已退出录制搜索。";
    }
    if (!recordingSearch) renderShortcutList();
  });
  el("shortcut-reset").addEventListener("click", () => {
    if (settingsCache?.shortcuts === undefined || Object.keys(settingsCache.shortcuts).length === 0) {
      if (status()) status().textContent = "当前无自定义绑定——已是默认键位。";
      return;
    }
    settingsCache.shortcuts = {};
    markDirty("shortcuts");
    dirtySections.add("shortcuts");
    capturingAction = null;
    capturedCombo = null;
    if (status()) status().textContent = "已恢复默认键位。";
    renderShortcutList();
  });
  renderShortcutList();
}

function status() {
  return el("shortcut-status");
}

/** fill（壳回填）/ 重渲入口。 */
export function render() {
  renderShortcutList();
}

/** 卸载收束（壳 unmount 委派——捕获态不跨视图存活）。 */
export function unmount() {
  capturingAction = null;
  capturedCombo = null;
  capturedReserved = false;
  recordingSearch = false;
}

export const SECTION_HTML = `
<section data-section="shortcuts">
  <div class="section-head">
    <h2 class="section-title">快捷键</h2>
    <div class="section-tools">
      <input id="shortcut-search" class="input input-search" type="text" placeholder="搜索动作…" autocomplete="off" />
      <button id="shortcut-record" type="button" class="btn" title="录制搜索——按下组合查找占用的动作"><span data-icon="keyboard" data-icon-size="14"></span> 录制搜索</button>
      <button id="shortcut-reset" type="button" class="btn">恢复默认键位</button>
    </div>
  </div>
  <div id="shortcut-list" class="row-list"></div>
  <p id="shortcut-status" class="hint">点击「修改」→ 按新组合 → Enter 确认（Esc 取消）；冲突会实时显示占用者。非输入区按 ? 可随时呼出速查面板。</p>
  <p class="hint">发送键（Enter）为核心交互固定不可改；会话切换/新建会话无对应面（单会话 host 模型——历史侧栏即切换入口，记档）。键位随「导入与导出」配置包迁移。</p>
</section>
`;
