/**
 * 基础设置组（T-P3-135 · UI 批次 B③④——providers/credentials/permission/
 * sandbox/appearance/profiles 六分节）：行式卡母版（row-list/row 消费
 * components.css）+ 供应商连接测试模态（opencode dialog-connect-provider
 * 形态：服务名/地址/格式下拉/模型 + probe 状态行；key 不入此模态——凭据
 * 独立分节 U2 分界）。数据面逻辑原样：providers 段整体替换/默认标记/
 * 会话期切换（model/switch）/健康探测（op:probe + 10s 节流）/profiles
 * applyProfile 批量写生效段（providers 清单不动）。
 */

import { sendRequest, sendSettings } from "../../api.js";
import { settingsCache, getSessionId, applyTheme } from "../../state.js";
import { appendLine, toast } from "../../feedback.js";
import {
  markDirty,
  dirtySections,
  openDialog,
  rowEl,
  rowCopyEl,
  rowControl,
  btnEl,
  emptyState,
  chipEl,
} from "./core.js";

export const SECTIONS_HTML = `
<section data-section="providers">
  <div class="section-head">
    <h2 class="section-title">供应商</h2>
    <button id="provider-add" type="button" class="btn btn-primary">添加供应商</button>
  </div>
  <div id="provider-list" class="row-list"></div>
  <p class="hint">默认标记 = 启动装配选中的供应商（新会话生效）。↑↓ 顺序 = 故障转移优先级（J15 队列序）。API key 请在「凭据」分节录入（独立存储零明文）。</p>
</section>
<section data-section="credentials">
  <div class="section-head"><h2 class="section-title">凭据</h2></div>
  <form id="credential-form" class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">录入凭据</div>
        <div class="row-desc">provider 名 + API key（不回显）——经 settings 信封 credentials-set 落独立存储</div>
      </div>
      <div class="row-control cred-inline">
        <input id="credential-provider" class="input" type="text" placeholder="provider 名" autocomplete="off" />
        <input id="credential-key" class="input" type="password" placeholder="API key（不回显）" autocomplete="off" />
        <button type="submit" class="btn btn-primary">保存</button>
        <button id="credential-delete" type="button" class="btn btn-danger">删除</button>
      </div>
    </div>
  </form>
  <div id="credential-list" class="row-list"></div>
  <p class="hint">凭据独立存储（Windows 经 DPAPI 加密），永不写入配置文件与日志。语音（STT）的 key 也在此以 provider 名 <code>stt</code> 录入。</p>
</section>
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
// 供应商：清单（行式卡）+ 连接测试模态 + 健康探测（J16 probe——节流原样）
// ---------------------------------------------------------------------------

/** 编辑态（非 null = 模态在修改既有条目）。 */
let editingProviderName = null;

/** 健康探测结果缓存（UI 侧节流——每 provider 10s 内复用上次结果）。 */
const providerHealth = {};
const HEALTH_THROTTLE_MS = 10_000;

const HEALTH_TONE = { operational: "var(--success)", degraded: "var(--warning)", unreachable: "var(--destructive)" };

function healthDot(name) {
  const health = providerHealth[name];
  if (health === undefined) return null;
  const dot = document.createElement("span");
  dot.className = "status-dot dot-sm";
  dot.style.setProperty("--dot-color", HEALTH_TONE[health.status] ?? "var(--text-subtlest)");
  dot.title = health.message ?? health.status;
  return dot;
}

function renderProviderList() {
  const list = document.getElementById("provider-list");
  if (list === null) return; // 视图已卸载（异步回包晚于导航——静默丢弃）
  list.replaceChildren();
  const providers = settingsCache?.providers ?? [];
  if (providers.length === 0) {
    list.appendChild(emptyState("暂无供应商条目", "点右上「添加供应商」建档；key 在「凭据」分节录入"));
    return;
  }
  for (const entry of providers) {
    const row = rowEl();
    const isDefault = settingsCache?.defaultProvider === entry.name;
    const health = providerHealth[entry.name];
    const titleEl = document.createElement("div");
    titleEl.className = "row-title title-btn";
    titleEl.append(document.createTextNode(entry.name));
    const dot = healthDot(entry.name);
    if (dot !== null) titleEl.appendChild(dot);
    if (isDefault) titleEl.appendChild(chipEl("默认", true));
    const descText =
      `${entry.adapter ?? "openai"}${entry.model ? ` · ${entry.model}` : ""}` +
      `${entry.baseUrl ? ` · ${entry.baseUrl}` : ""}` +
      `${health && health.message ? ` · ${health.message}` : ""}`;
    const descEl = document.createElement("div");
    descEl.className = "row-desc";
    descEl.textContent = descText;
    const copy = rowCopyEl(titleEl, descEl);
    // 默认标记（启动装配选中——新会话生效）
    const defaultBtn = btnEl(isDefault ? "★ 默认" : "设为默认", "btn", "启动装配选中（新会话生效）");
    if (isDefault) defaultBtn.classList.add("active-mark");
    defaultBtn.addEventListener("click", () => {
      settingsCache.defaultProvider = entry.name;
      dirtySections.add("defaultProvider");
      renderProviderList();
      markDirty("defaultProvider");
    });
    // U5/T-P3-104：会话期切换（J6——model/switch 请求，立即受理新 turn 生效）
    const switchBtn = btnEl("本会话切换", "btn", "当前会话立即切到该条目（新 turn 生效）");
    switchBtn.addEventListener("click", async () => {
      const sid = getSessionId();
      if (sid === "") {
        appendLine("会话未连接，无法切换（新会话将以默认供应商启动）", "warn");
        return;
      }
      const envelope = await sendRequest(sid, {
        type: "model/switch",
        identity: { provider: entry.adapter ?? "openai", modelId: entry.model ?? settingsCache.defaultModel ?? "" },
      });
      if (envelope.ok) {
        appendLine(`已切换到 ${entry.adapter ?? "openai"}:${entry.model}（当前轮结束后新 turn 生效）`, "meta");
      } else {
        appendLine(`切换被拒：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
      }
    });
    // U5：健康徽标（J16 probeProvider 消费——可达性探测不触碰熔断器；10s 节流）
    const healthBtn = btnEl("测健康", "btn", "探测条目可达性（不触碰熔断器）");
    healthBtn.addEventListener("click", () => void probeHealth(entry.name));
    // U19/T-P3-121：故障转移优先级排序（数组序 = J15 队列序——可见可调）
    const orderIndex = providers.indexOf(entry);
    const moveBtn = (label2, delta) => {
      const b = btnEl(label2, "btn btn-icon", delta < 0 ? "故障转移优先级：上移" : "故障转移优先级：下移");
      b.disabled = delta < 0 ? orderIndex === 0 : orderIndex === providers.length - 1;
      b.addEventListener("click", () => {
        const arr = [...settingsCache.providers];
        const j = orderIndex + delta;
        [arr[orderIndex], arr[j]] = [arr[j], arr[orderIndex]];
        settingsCache.providers = arr;
        dirtySections.add("providers");
        renderProviderList();
        markDirty("providers");
      });
      return b;
    };
    const editBtn = btnEl("编辑", "btn", "编辑该条目（连接测试模态）");
    editBtn.addEventListener("click", () => openProviderDialog(entry));
    const delBtn = btnEl("删除", "btn btn-danger");
    delBtn.addEventListener("click", () => {
      settingsCache.providers = settingsCache.providers.filter((p) => p.name !== entry.name);
      if (isDefault) settingsCache.defaultProvider = undefined;
      dirtySections.add("providers");
      renderProviderList();
      markDirty("providers");
    });
    row.append(copy, rowControl(defaultBtn, switchBtn, healthBtn, moveBtn("↑", -1), moveBtn("↓", 1), editBtn, delBtn));
    list.appendChild(row);
    // U5：编辑（点击条目名 → 连接测试模态回填——providers 段替换保存）
    titleEl.title = "点击编辑该条目";
    titleEl.addEventListener("click", () => openProviderDialog(entry));
  }
}

async function probeHealth(name, statusEl) {
  const cached = providerHealth[name];
  const now = Date.now();
  if (cached && now - cached.at < HEALTH_THROTTLE_MS) {
    if (statusEl !== undefined) writeProbeStatus(statusEl, providerHealth[name]);
    return;
  }
  const envelope = await sendSettings({ op: "probe", provider: name });
  if (envelope.ok) {
    const health = envelope.result.health;
    providerHealth[name] = { ...health, at: now };
    appendLine(`健康探测 ${name}：${health.message}`, health.status === "operational" ? "roster" : "warn");
  } else {
    providerHealth[name] = { status: "unreachable", message: envelope.error?.message ?? "探测失败", at: now, success: false };
    appendLine(`健康探测 ${name} 失败：${envelope.error?.message ?? ""}`, "warn");
  }
  if (statusEl !== undefined) writeProbeStatus(statusEl, providerHealth[name]);
  renderProviderList();
}

function writeProbeStatus(el, health) {
  if (el === null) return;
  el.textContent = health === undefined ? "未测试" : `${health.message ?? health.status}`;
  el.classList.toggle("probe-ok", health?.status === "operational");
  el.classList.toggle("probe-bad", health !== undefined && health.status !== "operational");
}

/**
 * 连接测试模态（dialog-connect-provider 形态：服务名/地址/格式下拉/模型
 * + probe 状态行）。probe 按 settings 已存条目名探测——新增未保存时禁测
 * （数据面约束，记档）；key 不在此模态（凭据分节 U2 分界）。
 */
function openProviderDialog(entry) {
  editingProviderName = entry?.name ?? null;
  const holder = document.createElement("div");
  holder.innerHTML = `
  <form id="provider-form">
    <div class="form-grid">
      <label>服务名<input id="provider-name" class="input" type="text" placeholder="名称（如 main）" autocomplete="off" /></label>
      <label>格式（适配器）
        <select id="provider-adapter" class="select">
          <option value="openai">openai 兼容</option>
          <option value="anthropic">anthropic</option>
        </select>
      </label>
      <label>地址 Base URL<input id="provider-baseurl" class="input" type="text" placeholder="Base URL" autocomplete="off" /></label>
      <label>模型<input id="provider-model" class="input" type="text" placeholder="模型" autocomplete="off" /></label>
    </div>
    <p id="provider-probe-status" class="hint probe-line">未测试（保存后可测连接；探测不触碰熔断器）</p>
  </form>`;
  const form = holder.firstElementChild;
  if (entry !== undefined) {
    form.querySelector("#provider-name").value = entry.name;
    form.querySelector("#provider-adapter").value = entry.adapter ?? "openai";
    form.querySelector("#provider-baseurl").value = entry.baseUrl ?? "";
    form.querySelector("#provider-model").value = entry.model ?? "";
  }
  openDialog({
    title: entry !== undefined ? `编辑供应商：${entry.name}` : "添加供应商",
    body: form,
    actions: [
      entry !== undefined
        ? {
            label: "测连接",
            className: "btn",
            close: false,
            onClick: async () => void (await probeHealth(entry.name, form.querySelector("#provider-probe-status"))),
          }
        : null,
      { label: "取消", className: "btn btn-ghost" },
      {
        label: "保存",
        className: "btn btn-primary",
        onClick: () => saveProviderFromDialog(),
      },
    ].filter((a) => a !== null),
  });
}

function saveProviderFromDialog() {
  const name = document.getElementById("provider-name").value.trim();
  if (name === "" || !/^[A-Za-z0-9_.-]{1,64}$/.test(name)) {
    toast("供应商名必填（小写字母数字 . _ -，≤64 字符）", "warn");
    return;
  }
  const entry = {
    name,
    adapter: document.getElementById("provider-adapter").value,
    ...(document.getElementById("provider-baseurl").value.trim() !== ""
      ? { baseUrl: document.getElementById("provider-baseurl").value.trim() }
      : {}),
    ...(document.getElementById("provider-model").value.trim() !== ""
      ? { model: document.getElementById("provider-model").value.trim() }
      : {}),
  };
  const rest = (settingsCache.providers ?? []).filter(
    (p) => p.name !== name && p.name !== editingProviderName,
  );
  settingsCache.providers = [...rest, entry];
  if (!settingsCache.defaultProvider || settingsCache.defaultProvider === editingProviderName) {
    settingsCache.defaultProvider = name;
  }
  editingProviderName = null;
  renderProviderList();
  markDirty("providers");
  toast(`供应商已保存：${name}（新会话生效）`, "info");
}

// ---------------------------------------------------------------------------
// 凭据清单（行式——名称 + 掩码 + 更新时间）
// ---------------------------------------------------------------------------

function renderCredentialList(credentials) {
  const list = document.getElementById("credential-list");
  if (list === null) return;
  list.replaceChildren();
  if (credentials.length === 0) {
    list.appendChild(emptyState("暂无已存凭据", "上方录入 provider 名与 key（Windows 经 DPAPI 加密）"));
    return;
  }
  for (const meta of credentials) {
    const row = rowEl();
    const titleEl = document.createElement("div");
    titleEl.className = "row-title";
    titleEl.textContent = meta.name;
    const descEl = document.createElement("div");
    descEl.className = "row-desc";
    descEl.textContent = `${meta.masked ?? ""}（更新于 ${meta.updatedAt}）`;
    row.append(rowCopyEl(titleEl, descEl));
    list.appendChild(row);
  }
}

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
  renderProviderList();
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
    delBtn.addEventListener("click", () => {
      if (!window.confirm(`删除配置档「${p.name}」？`)) return;
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
  document.getElementById("provider-add").addEventListener("click", () => openProviderDialog(undefined));

  // 凭据（U2 的 UI 面——key 经 settings 信封 credentials-set，不落配置文件）
  document.getElementById("credential-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const provider = document.getElementById("credential-provider").value.trim();
    const key = document.getElementById("credential-key").value;
    if (provider === "" || key === "") return;
    const envelope = await sendSettings({ op: "credentials-set", provider, key });
    document.getElementById("credential-key").value = "";
    if (envelope.ok) {
      appendLine(`凭据已保存：${provider} ${envelope.result.masked}`, "meta");
      const creds = await sendSettings({ op: "credentials-list" });
      if (creds.ok) renderCredentialList(creds.result.credentials ?? []);
    } else {
      appendLine(`凭据保存失败：${envelope.error?.message ?? ""}`, "warn");
    }
  });

  document.getElementById("credential-delete").addEventListener("click", async () => {
    const provider = document.getElementById("credential-provider").value.trim();
    if (provider === "") return;
    const envelope = await sendSettings({ op: "credentials-delete", provider });
    if (envelope.ok) {
      appendLine(`凭据已删除：${provider}`, "meta");
      const creds = await sendSettings({ op: "credentials-list" });
      if (creds.ok) renderCredentialList(creds.result.credentials ?? []);
    }
  });

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
  renderProviderList();
  renderProfileList();
}

/** 凭据清单刷新（壳 open 拉取 credentials-list 后调用）。 */
export function refreshCredentials() {
  void sendSettings({ op: "credentials-list" }).then((creds) => {
    if (creds.ok && document.getElementById("credential-list") !== null) {
      renderCredentialList(creds.result.credentials ?? []);
    }
  });
}
