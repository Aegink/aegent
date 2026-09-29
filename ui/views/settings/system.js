/**
 * 数据与系统组（T-P3-135 · UI 批次 B⑦⑨——projects/instructions/shortcuts/
 * transfer/logging/about 六分节）：
 * - shortcuts：kbd 键位胶囊 + 绑定行 + 顶部搜索过滤（ShortcutBindingRow
 *   形态；捕获态交互原样——冲突阻断/保留键提示语义不动）；
 * - projects：行式卡 + 建档模态（project-form 下沉——CRUD 原样）；
 * - instructions：三文件位编辑器卡（保存确认保持原生 confirm——卡面⑨
 *   "其余 confirm 保持"）；transfer：导入确认面模态化（.dialog 替代原生
 *   confirm——不可信输入逐项列出后确认的三层防线不变）；
 * - logging/about：行式卡。
 * 数据面逻辑原样（instructions-list/instruction-save/import/project CRUD/
 * shortcuts 段 + 捕获态改绑全保留）。
 */

import { sendSettings } from "../../api.js";
import { ACTION_LABELS, createKeymap, detectConflict, eventToCombo } from "../../keymap.js";
import {
  settingsCache,
  setSettingsCache,
  markPromptsLoaded,
  applyTheme,
  rebuildKeymap,
} from "../../state.js";
import { appendLine, toast } from "../../feedback.js";
import {
  markDirty,
  dirtySections,
  flushSettings,
  openDialog,
  confirmDialog,
  refillFormsAfterImport,
  rowEl,
  rowCopyEl,
  rowControl,
  btnEl,
  emptyState,
  chipEl,
} from "./core.js";

export const SECTIONS_HTML = `
<section data-section="projects">
  <div class="section-head">
    <h2 class="section-title">项目</h2>
    <button id="project-add" type="button" class="btn btn-primary">新建项目</button>
  </div>
  <div id="project-list" class="row-list"></div>
  <p class="hint">设为活动 = 新会话以该项目 workspace 启动（当前会话不受影响）。</p>
</section>
<section data-section="instructions">
  <div class="section-head"><h2 class="section-title">指令中心</h2></div>
  <p class="hint">层级（全局 → 项目就近覆盖）与规则文件（C22 user 档）集中编辑；保存前有确认面，新会话生效。</p>
  <div class="card-box instr-card">
    <div class="instr-head">项目 AGENTS.md（<span id="instr-project-path">workspace</span>）</div>
    <textarea id="instr-project" class="textarea" rows="5" placeholder="（项目级指令——F2 收集链最近层）"></textarea>
    <div class="form-actions">
      <button class="instr-save btn btn-primary" data-target="project-agents" type="button">保存项目指令</button>
      <button class="instr-tpl btn" data-target="project-agents" type="button">插入模板</button>
    </div>
  </div>
  <div class="card-box instr-card">
    <div class="instr-head">全局 AGENTS.md（~/.aegent/AGENTS.md——最远层）</div>
    <textarea id="instr-global" class="textarea" rows="5" placeholder="（全局指令——所有 workspace 生效）"></textarea>
    <div class="form-actions">
      <button class="instr-save btn btn-primary" data-target="global-agents" type="button">保存全局指令</button>
      <button class="instr-tpl btn" data-target="global-agents" type="button">插入模板</button>
    </div>
  </div>
  <div class="card-box instr-card">
    <div class="instr-head">用户级规则（~/.aegent/rules.txt——每行 \`<code>规则 -&gt; allow|deny</code>\`）</div>
    <textarea id="instr-rules" class="textarea" rows="5" placeholder="# 注释行；如：Bash(git status) -> allow"></textarea>
    <p id="instr-rules-lint" class="hint"></p>
    <div class="form-actions">
      <button class="instr-save btn btn-primary" data-target="user-rules" type="button">保存用户规则</button>
      <button class="instr-tpl btn" data-target="user-rules" type="button">插入模板</button>
    </div>
  </div>
</section>
<section data-section="shortcuts">
  <div class="section-head">
    <h2 class="section-title">快捷键</h2>
    <div class="section-tools">
      <input id="shortcut-search" class="input input-search" type="text" placeholder="搜索动作…" autocomplete="off" />
      <button id="shortcut-reset" type="button" class="btn">恢复默认键位</button>
    </div>
  </div>
  <div id="shortcut-list" class="row-list"></div>
  <p id="shortcut-status" class="hint">点击「修改」进入捕获态——按新组合即改即存；Esc 取消捕获。</p>
  <p class="hint">发送键（Enter）为核心交互固定不可改；会话切换/新建会话无对应面（单会话 host 模型——历史侧栏即切换入口，记档）。</p>
</section>
<section data-section="transfer">
  <div class="section-head"><h2 class="section-title">导入与导出</h2></div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">导出配置包</div>
        <div class="row-desc">配置包不含凭据——换机请在各供应商条目重新录入 key</div>
      </div>
      <div class="row-control">
        <button id="export-btn" type="button" class="btn">导出</button>
        <span id="export-status" class="hint"></span>
      </div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">导入配置包</div>
        <div class="row-desc">导入前自动备份（settings.json.bak.0~4 滚动 5 份）；摘要确认后才覆盖</div>
      </div>
      <div class="row-control"><input id="import-file" type="file" accept=".json,application/json" class="input input-file" /></div>
    </div>
  </div>
  <pre id="import-preview" class="card-args" hidden></pre>
  <p id="import-summary" class="hint"></p>
  <button id="import-apply" type="button" class="btn btn-primary" hidden>确认导入（覆盖当前配置）</button>
</section>
<section data-section="logging">
  <div class="section-head"><h2 class="section-title">日志</h2></div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">原始分片日志目录</div>
        <div class="row-desc">对应 --raw-log-dir：设置后新会话起记录原始响应分片（排障用）</div>
      </div>
      <div class="row-control"><input id="logging-rawdir" class="input input-wide" type="text" placeholder="（未设置——不写原始分片）" autocomplete="off" /></div>
    </div>
  </div>
</section>
<section data-section="about">
  <div class="section-head"><h2 class="section-title">关于</h2></div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">aegent <span class="badge">v0.1.0</span></div>
        <div class="row-desc">本地优先的 agent 工作台（事件即真相；配置即本页）</div>
      </div>
    </div>
  </div>
</section>
`;

// ---------------------------------------------------------------------------
// U11/T-P3-110 项目页：项目档 CRUD（projects 段整体替换）+ 设为活动
// ---------------------------------------------------------------------------

function renderProjectList() {
  const list = document.getElementById("project-list");
  if (list === null) return;
  list.replaceChildren();
  const projects = settingsCache?.projects ?? [];
  if (projects.length === 0) {
    list.appendChild(emptyState("无项目", "点右上「新建项目」建档——设为活动后新会话以该项目 workspace 启动"));
    return;
  }
  for (const p of projects) {
    const row = rowEl();
    const isActive = settingsCache?.activeProject === p.name;
    const titleEl = document.createElement("div");
    titleEl.className = "row-title";
    titleEl.textContent = p.name;
    if (isActive) titleEl.appendChild(chipEl("活动", true));
    const descEl = document.createElement("div");
    descEl.className = "row-desc mono";
    descEl.textContent = `${p.workspace}${p.instructions ? "（含指令）" : ""}`;
    const activateBtn = btnEl(isActive ? "★ 活动" : "设为活动", isActive ? "btn active-mark" : "btn", "新会话以该项目 workspace 启动");
    activateBtn.addEventListener("click", () => {
      settingsCache.activeProject = p.name;
      dirtySections.add("activeProject");
      renderProjectList();
      markDirty("activeProject");
    });
    const editBtn = btnEl("编辑", "btn");
    editBtn.addEventListener("click", () => openProjectDialog(p));
    const delBtn = btnEl("删除", "btn btn-danger");
    delBtn.addEventListener("click", async () => {
      if (!(await confirmDialog(`删除项目「${p.name}」？项目档与指令内容将一并移除。`, { title: "删除项目", confirmLabel: "删除", danger: true }))) return;
      settingsCache.projects = settingsCache.projects.filter((x) => x.name !== p.name);
      if (settingsCache.activeProject === p.name) settingsCache.activeProject = undefined;
      dirtySections.add("projects");
      dirtySections.add("activeProject");
      renderProjectList();
      markDirty("projects");
      markDirty("activeProject");
    });
    row.append(rowCopyEl(titleEl, descEl), rowControl(activateBtn, editBtn, delBtn));
    list.appendChild(row);
    titleEl.style.cursor = "pointer";
    titleEl.title = "点击编辑该项目";
    titleEl.addEventListener("click", () => openProjectDialog(p));
  }
}

let editingProjectName = null;

function openProjectDialog(p) {
  editingProjectName = p?.name ?? null;
  const holder = document.createElement("div");
  holder.innerHTML = `
  <form id="project-form">
    <div class="form-grid">
      <label>项目名<input id="project-name" class="input" type="text" placeholder="项目名" autocomplete="off" /></label>
      <label>workspace 目录<input id="project-workspace" class="input" type="text" placeholder="workspace 目录" autocomplete="off" /></label>
    </div>
    <label class="dialog-field">项目级指令（可选）
      <textarea id="project-instructions" class="textarea" rows="3" placeholder="追加进该项目会话的指令（F2 收集链）"></textarea>
    </label>
  </form>`;
  const form = holder.firstElementChild;
  if (p !== undefined) {
    form.querySelector("#project-name").value = p.name;
    form.querySelector("#project-workspace").value = p.workspace;
    form.querySelector("#project-instructions").value = p.instructions ?? "";
  }
  openDialog({
    title: p !== undefined ? `编辑项目：${p.name}` : "新建项目",
    description: "设为活动后，新会话以该项目 workspace 启动（当前会话不受影响）。",
    width: "md",
    body: form,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      { label: "保存", className: "btn btn-primary", onClick: () => saveProjectFromDialog() },
    ],
  });
}

function saveProjectFromDialog() {
  const name = document.getElementById("project-name").value.trim();
  const workspace = document.getElementById("project-workspace").value.trim();
  const instructions = document.getElementById("project-instructions").value.trim();
  if (name === "" || workspace === "") {
    toast("项目名与 workspace 必填", "warn");
    return;
  }
  const entry = { name, workspace, ...(instructions !== "" ? { instructions } : {}) };
  const rest = (settingsCache.projects ?? []).filter((p2) => p2.name !== name && p2.name !== editingProjectName);
  settingsCache.projects = [...rest, entry];
  editingProjectName = null;
  renderProjectList();
  markDirty("projects");
  toast(`项目已保存：${name}`, "info");
}

// ---------------------------------------------------------------------------
// U24/T-P3-127 指令中心：全局/项目 AGENTS.md + 用户规则文件（C22 project/
// user 档文件位）——查看/编辑/保存确认 + 规则 lint + 模板插入辅助。
// ---------------------------------------------------------------------------

const INSTR_TARGETS = {
  "project-agents": "instr-project",
  "global-agents": "instr-global",
  "user-rules": "instr-rules",
};
const INSTR_TARGET_LABEL = {
  "project-agents": "项目 AGENTS.md",
  "global-agents": "全局 AGENTS.md",
  "user-rules": "用户级规则 rules.txt",
};
const INSTR_TEMPLATES = {
  "project-agents": "## 代码风格\n- 缩进与命名遵循现有代码\n\n## 提交约定\n- ",
  "global-agents": "## 通用偏好\n- 中文回复\n- 先结论后理由\n",
  "user-rules": "# 每行：<规则> -> <allow|ask|deny>\nBash(git status) -> allow\nBash(git push) -> deny\n",
};

async function refreshInstructions() {
  const envelope = await sendSettings({ op: "instructions-list" });
  if (document.getElementById("instr-project") === null) return;
  if (!envelope.ok) {
    document.getElementById("instr-rules-lint").textContent =
      `指令面不可用：${envelope.error?.message ?? ""}`;
    return;
  }
  const v = envelope.result;
  document.getElementById("instr-project").value = v.project.content;
  document.getElementById("instr-global").value = v.global.content;
  document.getElementById("instr-rules").value = v.rules.content;
  document.getElementById("instr-project-path").textContent =
    v.project.path.split(/[\\/]/).slice(0, -1).join("/");
  renderRulesLint(v.rules.issues ?? []);
}

function renderRulesLint(issues) {
  const el = document.getElementById("instr-rules-lint");
  if (el === null) return;
  if (issues.length === 0) {
    el.textContent = "规则 lint：无问题（合法行全部装载）";
    return;
  }
  el.textContent = `规则 lint：${issues.length} 行未装载——${issues
    .slice(0, 5)
    .map((i) => `第 ${i.line} 行 ${i.message}`)
    .join("；")}${issues.length > 5 ? "…" : ""}`;
}

async function openInstructionsOnce() {
  // 指令分节只在设置打开时拉一次（保存后局部刷新；视图重挂载 = 重新拉取
  // ——GET 只读面，重挂载语义下以最新内容呈现）
  if (!document.getElementById("instr-project").dataset.loaded) {
    await refreshInstructions();
    const el = document.getElementById("instr-project");
    if (el !== null) el.dataset.loaded = "1";
  }
}

// ---------------------------------------------------------------------------
// U25/T-P3-128 快捷键分节：kbd 胶囊绑定行（搜索过滤）+ 捕获态改绑 + 冲突提示
// ---------------------------------------------------------------------------

let capturingAction = null; // 非 null = 捕获态（下一次按键即新绑定）
let capturedCombo = null; // 捕获到的规范 combo（未保存）
let shortcutFilter = "";

/** combo → kbd 胶囊组（ShortcutBindingRow 形态——每键一枚）。 */
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

function shortcutMatches(label, action) {
  if (shortcutFilter === "") return true;
  const q = shortcutFilter.toLowerCase();
  return label.toLowerCase().includes(q) || action.toLowerCase().includes(q);
}

function renderShortcutList() {
  const list = document.getElementById("shortcut-list");
  if (list === null) return;
  const status = document.getElementById("shortcut-status");
  list.replaceChildren();
  const bindings = createKeymap(settingsCache?.shortcuts);
  let visible = 0;
  for (const [action, label] of Object.entries(ACTION_LABELS)) {
    if (!shortcutMatches(label, action)) continue;
    visible++;
    const row = rowEl();
    const titleEl = document.createElement("div");
    titleEl.className = "row-title";
    titleEl.textContent = label;
    const descEl = document.createElement("div");
    descEl.className = "row-desc";
    const conflictInfo = action !== "send" ? detectConflict(bindings[action] ?? "", bindings, action) : {};
    const notes = [];
    if (conflictInfo.conflict !== undefined) {
      notes.push(`⚠ 与「${ACTION_LABELS[conflictInfo.conflict]}」冲突`);
    }
    if (conflictInfo.reserved === true) {
      notes.push("浏览器保留键——提示不拦截，请自测");
    }
    descEl.textContent = action === "send" ? "核心交互固定不可改" : notes.join("；") || "点击「修改」按新组合（Esc 取消）";
    if (notes.length > 0) descEl.classList.add("error-text");
    const caps = comboCaps(action === "send" ? "Enter" : bindings[action] ?? "");
    const control = rowControl(caps);
    if (action !== "send") {
      const editBtn = btnEl("修改", "btn");
      if (capturingAction === action) {
        editBtn.textContent = capturedCombo ?? "按键…";
        editBtn.className = "btn active-mark";
      } else {
        editBtn.addEventListener("click", () => {
          capturingAction = action;
          capturedCombo = null;
          status.textContent = `捕获中：为「${label}」按新组合（Esc 取消）`;
          renderShortcutList();
        });
      }
      control.appendChild(editBtn);
    }
    row.append(rowCopyEl(titleEl, descEl), control);
    list.appendChild(row);
  }
  if (visible === 0) {
    list.appendChild(emptyState("无匹配动作", `没有名称含「${shortcutFilter}」的快捷键动作`));
  }
}

/** 捕获态键监听（捕获阶段抢先于分发监听——render 时挂载/unmount 时移除）。 */
export function shortcutCaptureKeydown(ev) {
  if (capturingAction === null) return;
  // 捕获态：Esc 空手取消；纯修饰键等待；组合转规范 combo 后即存
  if (ev.key === "Escape") {
    capturingAction = null;
    capturedCombo = null;
    const status = document.getElementById("shortcut-status");
    if (status !== null) {
      status.textContent = "点击「修改」进入捕获态——按新组合即改即存；Esc 取消捕获。";
    }
    renderShortcutList();
    ev.preventDefault();
    ev.stopPropagation();
    return;
  }
  const combo = eventToCombo(ev);
  if (combo === null) return;
  ev.preventDefault();
  ev.stopPropagation();
  const bindings = createKeymap(settingsCache?.shortcuts);
  const conflict = detectConflict(combo, bindings, capturingAction);
  const statusEl = document.getElementById("shortcut-status");
  if (conflict.conflict !== undefined) {
    if (statusEl !== null) {
      statusEl.textContent = `✘ ${combo} 已被「${ACTION_LABELS[conflict.conflict]}」占用——换一个组合（Esc 取消）`;
    }
    renderShortcutList();
    return; // 冲突阻断保存
  }
  const reservedNote = conflict.reserved === true ? "（浏览器保留键——提示不拦截）" : "";
  // 保存覆盖（部分覆盖语义——settings.shortcuts 段）
  const overrides = { ...(settingsCache.shortcuts ?? {}) };
  overrides[capturingAction] = combo;
  settingsCache.shortcuts = overrides;
  dirtySections.add("shortcuts");
  markDirty("shortcuts");
  if (statusEl !== null) {
    statusEl.textContent = `✔ ${ACTION_LABELS[capturingAction]} → ${combo}${reservedNote}`;
  }
  capturingAction = null;
  capturedCombo = null;
  renderShortcutList();
}

/** 卸载收束（壳 unmount 委派——捕获态不跨视图存活）。 */
export function unmount() {
  capturingAction = null;
  capturedCombo = null;
}

// ---------------------------------------------------------------------------
// U20/T-P3-122 导入导出与深链分享（导出零凭据；导入必确认——模态化）
// ---------------------------------------------------------------------------

function buildExportText() {
  const payload = {
    version: 1,
    kind: "aegent-settings-export",
    exportedAt: new Date().toISOString(),
    settings: settingsCache,
  };
  const text = JSON.stringify(payload, null, 2);
  if (text.includes('"apiKey"')) throw new Error("导出包含 apiKey 字段（拒绝导出）");
  return text;
}

// 摘要行（与 src/session/settings-transfer.ts summarizePackage 同语义——UI 侧呈现层）
export function summarizeImported(s) {
  const lines = [`供应商条目 ${(s.providers ?? []).length} 个（默认 ${s.defaultProvider ?? "未设置"}）`];
  if (s.defaultModel !== undefined) lines.push(`默认模型 ${s.defaultModel}`);
  if (s.permission?.approvalTimeoutMs !== undefined) lines.push(`审批超时 ${s.permission.approvalTimeoutMs}ms`);
  if (s.sandbox?.network !== undefined) lines.push(`网络档 ${s.sandbox.network}`);
  if ((s.projects ?? []).length > 0) lines.push(`项目 ${s.projects.length} 个`);
  if ((s.prompts ?? []).length > 0) lines.push(`提示词模板 ${s.prompts.length} 个`);
  if ((s.mcp ?? []).length > 0) lines.push(`MCP server ${s.mcp.length} 个`);
  if ((s.profiles ?? []).length > 0) lines.push(`配置档 ${s.profiles.length} 个`);
  return lines;
}

export async function applyImportedSettingsObject(importedSettings) {
  const envelope = await sendSettings({ op: "import", settings: importedSettings });
  if (!envelope.ok) {
    appendLine(`导入失败：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
    return false;
  }
  setSettingsCache(envelope.result.settings);
  markPromptsLoaded();
  applyTheme(settingsCache.appearance?.theme);
  rebuildKeymap(); // U25：导入后键位同步
  // 设置视图未挂载时跳过表单回填（下次打开设置全量重拉——无信息丢失）；
  // 挂载中经壳注册的回填回调全量刷新（同原 fillSettingsForm 语义）
  if (document.getElementById("provider-list") !== null) refillFormsAfterImport();
  return true;
}

/** 模态化导入确认（.dialog 替代原生 confirm——摘要逐项列出后确认）。 */
function confirmImportDialog(summaryText, onConfirm) {
  openDialog({
    title: "确认导入",
    description: `${summaryText}\n\n导入前自动备份当前配置（settings.json.bak.0~4 滚动 5 份）；配置包不含凭据。`,
    width: "md",
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      { label: "确认导入（覆盖当前配置）", className: "btn btn-primary", onClick: onConfirm },
    ],
  });
}

/** 深链确认钩子的设置域实现（app.js 经动态 import 委派——宿主接线面）。 */
export async function applyDeepLink(encodedData) {
  try {
    const text = decodeURIComponent(encodedData);
    const parsed = JSON.parse(text);
    if (parsed?.kind !== "aegent-settings-export") throw new Error("kind 不符");
    const summary = summarizeImported(parsed.settings ?? {}).join("；");
    confirmImportDialog(`收到深链分享配置，将导入：\n${summary}`, () => {
      void applyImportedSettingsObject(parsed.settings).then(() => toast("配置导入完成", "info"));
    });
    return "accepted";
  } catch (e) {
    appendLine(`深链导入失败：${e.message}`, "warn");
    return "rejected";
  }
}

// ---------------------------------------------------------------------------
// 挂载 / 回填 / 打开拉取
// ---------------------------------------------------------------------------

export function bind() {
  document.getElementById("project-add").addEventListener("click", () => openProjectDialog(undefined));

  for (const btn of document.querySelectorAll(".instr-save")) {
    btn.addEventListener("click", async () => {
      const target = btn.dataset.target;
      const content = document.getElementById(INSTR_TARGETS[target]).value;
      // 保存确认面（U24 卡面要求——覆盖用户文件前显式确认；批 B 走查反馈统一为模态）
      if (!(await confirmDialog(`确认保存到「${INSTR_TARGET_LABEL[target]}」？保存后新会话生效（覆盖写入）。`, { title: "保存指令", confirmLabel: "保存" }))) return;
      const envelope = await sendSettings({ op: "instruction-save", target, content });
      if (!envelope.ok) {
        appendLine(`指令保存失败：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
        return;
      }
      appendLine(`指令已保存：${envelope.result.path}`, "meta");
      toast(`${INSTR_TARGET_LABEL[target]} 已保存（新会话生效）`, "info");
      if (target === "user-rules") await refreshInstructions();
    });
  }

  for (const btn of document.querySelectorAll(".instr-tpl")) {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      const ta = document.getElementById(INSTR_TARGETS[target]);
      ta.value = ta.value === "" ? (INSTR_TEMPLATES[target] ?? "") : `${ta.value}\n${INSTR_TEMPLATES[target] ?? ""}`;
      ta.focus();
    });
  }

  document.getElementById("shortcut-search").addEventListener("input", (ev) => {
    shortcutFilter = ev.target.value.trim();
    renderShortcutList();
  });

  document.getElementById("shortcut-reset").addEventListener("click", async () => {
    if (!(await confirmDialog("恢复全部默认键位？所有自定义绑定将被清除。", { title: "恢复默认键位", confirmLabel: "恢复默认" }))) return;
    settingsCache.shortcuts = {};
    delete settingsCache.shortcuts;
    dirtySections.add("shortcuts");
    markDirty("shortcuts");
    document.getElementById("shortcut-status").textContent = "已恢复默认键位。";
    renderShortcutList();
  });

  document.getElementById("export-btn").addEventListener("click", () => {
    if (settingsCache === null) {
      document.getElementById("export-status").textContent = "设置未加载——先打开设置读取";
      return;
    }
    try {
      const text = buildExportText();
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aegent-settings-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      document.getElementById("export-status").textContent = "已导出（不含凭据）";
    } catch (e) {
      document.getElementById("export-status").textContent = `导出失败：${e.message}`;
    }
  });

  document.getElementById("import-file").addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (file === undefined) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      const previewEl = document.getElementById("import-preview");
      const summaryEl = document.getElementById("import-summary");
      const applyBtn = document.getElementById("import-apply");
      if (previewEl === null || summaryEl === null || applyBtn === null) return;
      try {
        const parsed = JSON.parse(text);
        if (parsed?.kind !== "aegent-settings-export") throw new Error("kind 不符（须为 aegent-settings-export 配置包）");
        const summary = summarizeImported(parsed.settings ?? {});
        previewEl.textContent = text.length > 4000 ? `${text.slice(0, 4000)}\n…（截断预览）` : text;
        previewEl.hidden = false;
        summaryEl.textContent = `导入将变更：${summary.join("；")}`;
        summaryEl.dataset.ok = "1";
        applyBtn.hidden = false;
        applyBtn.dataset.payload = text; // 确认后才上送（确认面 = C 族防线的用户侧延伸）
      } catch (e) {
        previewEl.hidden = true;
        applyBtn.hidden = true;
        summaryEl.textContent = `✘ 导入包不可用：${e.message}`;
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("import-apply").addEventListener("click", (ev) => {
    const payload = ev.target.dataset.payload;
    if (payload === undefined) return;
    const parsed = JSON.parse(payload);
    const summary = summarizeImported(parsed.settings ?? {}).join("；");
    // 导入必确认（cc-switch deeplink 三确认行为锚——不可信输入逐项列出后确认；
    // 批 B⑨：确认面模态化——.dialog 替代原生 confirm）
    confirmImportDialog(`导入将变更：${summary}`, async () => {
      const ok = await applyImportedSettingsObject(parsed.settings);
      if (ok) {
        ev.target.hidden = true;
        const summaryEl = document.getElementById("import-summary");
        if (summaryEl !== null) summaryEl.textContent = "✔ 导入完成（备份已滚动）";
        toast("配置导入完成", "info");
      }
    });
  });

  // U25：捕获态键监听（render 时挂载——unmount 时移除）
  window.addEventListener("keydown", shortcutCaptureKeydown, true);
}

export function fill() {
  document.getElementById("logging-rawdir").value = settingsCache?.logging?.rawLogDir ?? "";
  renderProjectList();
  renderShortcutList();
}

/** 指令中心打开时拉一次（壳 open 委派）。 */
export function refreshInstructionsOnce() {
  void openInstructionsOnce();
}
