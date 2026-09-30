/**
 * 基础设置组（T-P3-135 · UI 批次 B③④；T-P3-137 供应商分节迁出为独立
 * 子模块 providers.js——本文件保留 credentials/permission/sandbox/
 * appearance/profiles 五分节）：行式卡母版（row-list/row 消费
 * components.css）。数据面逻辑原样：providers 段整体替换语义在 providers
 * 模块、profiles applyProfile 批量写生效段在此。
 */

import { settingsCache, applyTheme } from "../../state.js";
import { toast } from "../../feedback.js";
import {
  markDirty,
  dirtySections,
  fireSectionRefresh,
  rowEl,
  rowCopyEl,
  rowControl,
  btnEl,
  emptyState,
  chipEl,
  confirmDialog,
} from "./core.js";
import { refreshCredentials as refreshProviderCredentials } from "./providers.js";

export const SECTIONS_HTML = `
<section data-section="permission">
  <div class="section-head"><h2 class="section-title">权限档</h2></div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">审批超时（毫秒）</div>
        <div class="row-desc">写操作等待用户审批的时长——超时按拒绝处理</div>
      </div>
      <div class="row-control"><input id="perm-timeout" class="input input-num" type="number" min="1000" step="1000" /></div>
    </div>
  </div>
</section>
<section data-section="sandbox">
  <div class="section-head"><h2 class="section-title">沙箱档</h2></div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">网络档</div>
        <div class="row-desc">工作区进程的网络访问档（allow 放行 / deny 拒绝）</div>
      </div>
      <div class="row-control">
        <select id="sandbox-network" class="select">
          <option value="">（未设置）</option>
          <option value="allow">allow</option>
          <option value="deny">deny</option>
        </select>
      </div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">工作区</div>
        <div class="row-desc">沙箱可见的 workspace 目录</div>
      </div>
      <div class="row-control"><input id="sandbox-workspace" class="input input-wide" type="text" placeholder="（未设置）" autocomplete="off" /></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">事件库</div>
        <div class="row-desc">事件库文件路径</div>
      </div>
      <div class="row-control"><input id="sandbox-db" class="input input-wide" type="text" placeholder="（未设置）" autocomplete="off" /></div>
    </div>
  </div>
</section>
<section data-section="appearance">
  <div class="section-head"><h2 class="section-title">外观与语言</h2></div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">主题</div>
        <div class="row-desc">暗色 / 亮色（全端 CSS 变量换值，即改即存）</div>
      </div>
      <div class="row-control">
        <select id="appearance-theme" class="select">
          <option value="dark">暗色</option>
          <option value="light">亮色</option>
        </select>
      </div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">语言</div>
        <div class="row-desc">界面语言</div>
      </div>
      <div class="row-control">
        <select id="appearance-language" class="select">
          <option value="zh-CN">中文</option>
          <option value="en">English</option>
        </select>
      </div>
    </div>
  </div>
</section>
<section data-section="profiles">
  <div class="section-head"><h2 class="section-title">场景配置档</h2></div>
  <div id="profile-list" class="row-list"></div>
  <form id="profile-form" class="card-box form-grid">
    <input id="profile-name" class="input" type="text" placeholder="档名（如 coding / cheap）" autocomplete="off" />
    <input id="profile-provider" class="input" type="text" placeholder="默认供应商条目名" autocomplete="off" />
    <input id="profile-model" class="input" type="text" placeholder="默认模型（可选）" autocomplete="off" />
    <input id="profile-timeout" class="input" type="number" min="1000" step="1000" placeholder="审批超时 ms（可选）" />
    <select id="profile-network" class="select">
      <option value="">网络档：跟随全局（可选）</option>
      <option value="allow">allow</option>
      <option value="deny">deny</option>
    </select>
    <div class="form-actions">
      <button id="profile-snapshot" type="button" class="btn">填入当前生效值</button>
      <button type="submit" class="btn btn-primary">建档</button>
    </div>
  </form>
  <p class="hint">建档 = 保存命名组合；切换 = 批量写回默认供应商/模型/权限/沙箱生效段（providers 清单不动；在途轮不受影响——新 turn 生效，J6 同款）。供应商列表的 ↑↓ 顺序 = 故障转移优先级（J15）。</p>
</section>
`;

// ---------------------------------------------------------------------------
// Profiles（U19/T-P3-121）：组合档清单 + applyProfile 批量写生效段
// ---------------------------------------------------------------------------

export function applyProfileValues(p) {
  // 切换 = 批量写生效段（applyProfile 同语义——UI 侧呈现层实现）
  settingsCache.defaultProvider = p.defaultProvider;
  settingsCache.defaultModel = p.defaultModel;
  settingsCache.permission = p.permission ?? settingsCache.permission;
  settingsCache.sandbox = p.sandbox ?? settingsCache.sandbox;
  settingsCache.activeProfile = p.name;
  for (const sec of ["defaultProvider", "defaultModel", "permission", "sandbox", "activeProfile"]) {
    dirtySections.add(sec);
  }
  renderProfileList();
  fireSectionRefresh(); // 默认项卡在 providers 分节——Profiles 切换后联动刷新
  markDirty("defaultProvider");
  markDirty("defaultModel");
  markDirty("permission");
  markDirty("sandbox");
  markDirty("activeProfile");
}

function renderProfileList() {
  const list = document.getElementById("profile-list");
  if (list === null) return;
  list.replaceChildren();
  const profiles = settingsCache?.profiles ?? [];
  if (profiles.length === 0) {
    list.appendChild(emptyState("无配置档", "下方表单建档，或先「填入当前生效值」再存"));
    renderProfileQuick();
    return;
  }
  for (const p of profiles) {
    const row = rowEl();
    const isActive = settingsCache?.activeProfile === p.name;
    const titleEl = document.createElement("div");
    titleEl.className = "row-title";
    titleEl.textContent = p.name;
    if (isActive) titleEl.appendChild(chipEl("当前", true));
    const descEl = document.createElement("div");
    descEl.className = "row-desc";
    descEl.textContent = `→ ${p.defaultProvider}${p.defaultModel ? `/${p.defaultModel}` : ""}${p.sandbox?.network ? `（网络 ${p.sandbox.network}）` : ""}`;
    const applyBtn = btnEl(isActive ? "★ 当前" : "切换", isActive ? "btn active-mark" : "btn");
    applyBtn.addEventListener("click", () => {
      applyProfileValues(p);
    });
    const delBtn = btnEl("删除", "btn btn-danger");
    delBtn.addEventListener("click", async () => {
      if (!(await confirmDialog(`删除配置档「${p.name}」？切换记录不可恢复。`, { title: "删除配置档", confirmLabel: "删除", danger: true }))) return;
      settingsCache.profiles = (settingsCache.profiles ?? []).filter((x) => x.name !== p.name);
      if (settingsCache.activeProfile === p.name) settingsCache.activeProfile = undefined;
      dirtySections.add("profiles");
      dirtySections.add("activeProfile");
      renderProfileList();
      markDirty("profiles");
      markDirty("activeProfile");
    });
    row.append(rowCopyEl(titleEl, descEl), rowControl(applyBtn, delBtn));
    list.appendChild(row);
  }
  renderProfileQuick();
}

// 侧栏底部快速切换器（#profile-quick 在骨架侧栏——常驻元素，无卸载护栏需要）
function renderProfileQuick() {
  const sel = document.getElementById("profile-quick");
  const profiles = settingsCache?.profiles ?? [];
  sel.hidden = profiles.length === 0;
  sel.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "场景";
  sel.appendChild(placeholder);
  for (const p of profiles) {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = `${settingsCache?.activeProfile === p.name ? "★ " : ""}${p.name}`;
    sel.appendChild(opt);
  }
}

/** 侧栏快速切换入口（app.js 经动态 import 调用——设置域归属本域）。 */
export function applyQuickProfile(name) {
  const p = (settingsCache?.profiles ?? []).find((x) => x.name === name);
  if (p !== undefined) {
    applyProfileValues(p);
    toast(`已切换配置档：${p.name}`, "info");
  }
}

// ---------------------------------------------------------------------------
// 挂载 / 回填
// ---------------------------------------------------------------------------

export function bind() {
  // 即改即存：字段改动 → 缓存 + 标脏（防抖合并）
  document.getElementById("perm-timeout").addEventListener("change", (ev) => {
    const ms = Number(ev.target.value);
    settingsCache.permission = { ...settingsCache.permission, ...(Number.isFinite(ms) && ms > 0 ? { approvalTimeoutMs: ms } : {}) };
    markDirty("permission");
  });
  document.getElementById("sandbox-network").addEventListener("change", (ev) => {
    settingsCache.sandbox = { ...settingsCache.sandbox, ...(ev.target.value !== "" ? { network: ev.target.value } : {}) };
    markDirty("sandbox");
  });
  for (const [id, field] of [["sandbox-workspace", "workspace"], ["sandbox-db", "db"]]) {
    document.getElementById(id).addEventListener("change", (ev) => {
      const value = ev.target.value.trim();
      settingsCache.sandbox = { ...settingsCache.sandbox, ...(value !== "" ? { [field]: value } : {}) };
      markDirty("sandbox");
    });
  }
  document.getElementById("appearance-theme").addEventListener("change", (ev) => {
    settingsCache.appearance = { ...settingsCache.appearance, theme: ev.target.value };
    applyTheme(ev.target.value);
    markDirty("appearance");
  });
  document.getElementById("appearance-language").addEventListener("change", (ev) => {
    settingsCache.appearance = { ...settingsCache.appearance, language: ev.target.value };
    markDirty("appearance");
  });

  document.getElementById("profile-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = document.getElementById("profile-name").value.trim();
    const provider = document.getElementById("profile-provider").value.trim();
    const model = document.getElementById("profile-model").value.trim();
    const timeoutRaw = document.getElementById("profile-timeout").value;
    const network = document.getElementById("profile-network").value;
    if (name === "" || provider === "") return;
    const entry = {
      name,
      defaultProvider: provider,
      ...(model !== "" ? { defaultModel: model } : {}),
      ...(timeoutRaw !== "" ? { permission: { approvalTimeoutMs: Number(timeoutRaw) } } : {}),
      ...(network !== "" ? { sandbox: { network } } : {}),
    };
    const profiles = (settingsCache.profiles ?? []).filter((x) => x.name !== name);
    profiles.push(entry);
    settingsCache.profiles = profiles;
    document.getElementById("profile-name").value = "";
    dirtySections.add("profiles");
    renderProfileList();
    markDirty("profiles");
  });

  document.getElementById("profile-snapshot").addEventListener("click", () => {
    document.getElementById("profile-provider").value = settingsCache?.defaultProvider ?? "";
    document.getElementById("profile-model").value = settingsCache?.defaultModel ?? "";
    document.getElementById("profile-timeout").value =
      settingsCache?.permission?.approvalTimeoutMs ?? "";
    document.getElementById("profile-network").value = settingsCache?.sandbox?.network ?? "";
  });
}

export function fill() {
  document.getElementById("perm-timeout").value =
    settingsCache?.permission?.approvalTimeoutMs ?? "";
  document.getElementById("sandbox-network").value = settingsCache?.sandbox?.network ?? "";
  document.getElementById("sandbox-workspace").value = settingsCache?.sandbox?.workspace ?? "";
  document.getElementById("sandbox-db").value = settingsCache?.sandbox?.db ?? "";
  document.getElementById("appearance-theme").value = settingsCache?.appearance?.theme ?? "dark";
  document.getElementById("appearance-language").value = settingsCache?.appearance?.language ?? "zh-CN";
  renderProfileList();
}
