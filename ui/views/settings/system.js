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
import * as instructions from "./instructions.js";
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
} from "./core.js";

const instructionsSection = instructions.SECTION_HTML;

export const SECTIONS_HTML = `
<section data-section="projects">
  <div class="section-head">
    <h2 class="section-title">项目</h2>
    <a class="btn btn-primary" href="#projects">前往项目中心</a>
  </div>
  <p class="hint">项目域已升级为独立页面（工作区/任务/文件树/添加三模式）——点上方按钮直达，或侧栏「项目」。</p>
</section>
${instructionsSection}<section data-section="shortcuts">
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
// T-P3-150 D1：项目 CRUD 迁独立页 views/projects.js（工作区/任务/文件树/
// 添加三模式）——本分节只留跳转卡；项目指令仍走下方指令中心（instr-project）。

// ---------------------------------------------------------------------------
// U24/T-P3-127 指令中心：全局/项目 AGENTS.md + 用户规则文件（C22 project/
// user 档文件位）——查看/编辑/保存确认 + 规则 lint + 模板插入辅助。
// ---------------------------------------------------------------------------

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
  renderShortcutList();
}

/** 指令中心打开时拉一次（壳 open 委派——逻辑在 instructions 域文件）。 */
export function refreshInstructionsOnce() {
  void instructions.refresh();
}
