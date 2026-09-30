/**
 * 基础设置组（T-P3-135 · UI 批次 B③④；T-P3-137 供应商分节迁出为独立
 * 子模块 providers.js——本文件保留 credentials/permission/sandbox/
 * appearance/profiles 五分节）：行式卡母版（row-list/row 消费
 * components.css）。数据面逻辑原样：providers 段整体替换语义在 providers
 * 模块、profiles applyProfile 批量写生效段在此。
 */

import { sendSettings } from "../../api.js";
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
  <div class="group-title">决策规则 <span id="perm-rule-count" class="badge">0</span></div>
  <p class="hint">工具调用的放行/询问/拒绝规则——<strong>按声明顺序首条匹配生效</strong>，全部不命中则默认询问。存于 <code id="perm-rules-path"></code>，保存后<strong>新会话装配生效</strong>。全文编辑在「指令中心」。</p>
  <div id="perm-rules-list" class="row-list"></div>
  <div class="perm-add-row">
    <input id="perm-rule-add" class="input" type="text" placeholder="新规则式样，如 Bash(git *) 或 write(src/**)" autocomplete="off" />
    <select id="perm-rule-action" class="select" aria-label="动作">
      <option value="allow">allow（放行）</option>
      <option value="ask">ask（询问）</option>
      <option value="deny">deny（拒绝）</option>
    </select>
    <button id="perm-rule-append" type="button" class="btn">＋ 添加规则</button>
  </div>
  <div id="perm-rules-lint" class="perm-lint"></div>
  <div class="group-title">规则试配器</div>
  <p class="hint">输入一条工具调用（如 <code>Bash(git status)</code>），按声明顺序预览会命中哪条规则——仅语法层预览，实际裁决以内核策略链为准。</p>
  <div class="perm-add-row">
    <input id="perm-test-input" class="input" type="text" placeholder="工具调用，如 Bash(git status)" autocomplete="off" />
    <button id="perm-test-run" type="button" class="btn">试配</button>
  </div>
  <div id="perm-test-result" class="perm-lint"></div>
  <div class="group-title">策略链（内核固定顺序）</div>
  <div class="row-list">
    <div class="row"><div class="row-copy"><div class="row-title">① 决策规则</div><div class="row-desc">上面清单——首条匹配的规则决定 allow / ask / deny</div></div></div>
    <div class="row"><div class="row-copy"><div class="row-title">② 内置保护</div><div class="row-desc">危险命令清单、系统目录保护名、IMDS/SSRF 黑名单——内核内置，独立于规则（deny 不可被规则覆盖绕过）</div></div></div>
    <div class="row"><div class="row-copy"><div class="row-title">③ 审批</div><div class="row-desc">裁决为 ask 的操作挂起等你审批（超时 = 上面的毫秒数，拒绝收尾）；allow 直接放行、deny 直接拒绝</div></div></div>
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
// 决策规则管理（权限档页 v2——结构化视图 + 快速添加 + 行删除 + 试配预览）：
// 读走 instructions-list（rules 槽 content+lint issues），写走
// instructionSave("user-rules")（host 原子替换写回 ~/.aegent/rules.txt）——
// 内核下次会话装配真实消费（agent-child loadUserRuleSources）。全文编辑
// 在指令中心（避免双编辑器功能重复）。
// ---------------------------------------------------------------------------

let permRulesContent = ""; // 当前编辑缓冲（添加/删行即时改，保存统一写回）

/** 与 src/policy/rule-loader.ts parseRulesText 同构的前端解析（预览面）。 */
function parseRulesLines(text) {
  const lines = [];
  const issues = [];
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(.+?)\s*->\s*(allow|ask|deny)\s*$/.exec(line);
    if (m === null) {
      issues.push({ line: index + 1, message: `行不合 "<规则> -> <allow|ask|deny>" 形状：${line.slice(0, 80)}` });
      continue;
    }
    lines.push({ raw: line, rule: m[1].trim(), action: m[2], line: index + 1 });
  }
  return { lines, issues };
}

function renderPolicyRules() {
  const list = document.getElementById("perm-rules-list");
  if (list === null) return;
  list.replaceChildren();
  const { lines, issues } = parseRulesLines(permRulesContent);
  const count = document.getElementById("perm-rule-count");
  if (count !== null) count.textContent = String(lines.length);
  if (lines.length === 0 && issues.length === 0) {
    list.appendChild(emptyState("暂无规则", "全部工具调用走默认询问——用下方输入添加第一条规则"));
    return;
  }
  for (const r of lines) {
    const row = rowEl();
    const titleEl = document.createElement("div");
    titleEl.className = "row-title mono";
    titleEl.textContent = r.rule;
    titleEl.appendChild(chipEl(r.action, r.action !== "deny"));
    const descEl = document.createElement("div");
    descEl.className = "row-desc";
    descEl.textContent = `第 ${r.line} 行`;
    const delBtn = btnEl("✕", "btn btn-icon", `删除规则 ${r.rule}`);
    delBtn.addEventListener("click", () => {
      // 按行号移除原文行（保留其它行原样——含注释与空行）
      const kept = permRulesContent.split(/\r?\n/).filter((_, i) => i + 1 !== r.line);
      permRulesContent = kept.join("\n");
      renderPolicyRules();
    });
    row.append(rowCopyEl(titleEl, descEl), rowControl(delBtn));
    list.appendChild(row);
  }
  const lint = document.getElementById("perm-rules-lint");
  if (lint !== null) {
    lint.replaceChildren();
    for (const issue of issues) {
      const p = document.createElement("div");
      p.className = "perm-lint-bad";
      p.textContent = `⚠ 第 ${issue.line} 行：${issue.message}`;
      lint.appendChild(p);
    }
  }
}

async function refreshPolicyRules() {
  const envelope = await sendSettings({ op: "instructions-list" });
  const pathEl = document.getElementById("perm-rules-path");
  if (pathEl !== null) {
    pathEl.textContent = envelope.ok ? envelope.result.rules.path : "（指令面不可用）";
  }
  if (!envelope.ok) {
    toast(`规则读取失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  permRulesContent = envelope.result.rules.content ?? "";
  renderPolicyRules();
}

async function savePolicyRules(nextContent) {
  const envelope = await sendSettings({
    op: "instruction-save",
    target: "user-rules",
    content: nextContent,
  });
  if (envelope.ok) {
    permRulesContent = nextContent;
    renderPolicyRules();
    toast("决策规则已保存（新会话装配生效）", "info");
  } else {
    toast(`规则保存失败：${envelope.error?.message ?? ""}`, "warn");
  }
}

/** 规则试配（语法层预览——通配 * 命中；与 evaluate.ts 的双维通配同方言）。 */
function wildcardMatch(pattern, value) {
  const re = new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(value);
}

function testRuleMatch(input) {
  const m = /^(.+?)\s*->\s*(allow|ask|deny)\s*$/.exec(input);
  const callRule = m !== null ? m[1].trim() : input.trim();
  const paren = /^([^(]+)\s*\((.*)\)\s*$/.exec(callRule);
  const callTool = (paren !== null ? paren[1] : callRule).trim();
  const callArgs = paren !== null && paren[2] !== "" ? paren[2] : undefined;
  const { lines } = parseRulesLines(permRulesContent);
  for (const r of lines) {
    const rp = /^([^(]+)\s*\((.*)\)\s*$/.exec(r.rule);
    const ruleTool = (rp !== null ? rp[1] : r.rule).trim();
    const ruleArgs = rp !== null && rp[2] !== "" ? rp[2] : undefined;
    const toolHit = ruleTool.endsWith(":*")
      ? callTool.startsWith(ruleTool.slice(0, -2))
      : wildcardMatch(ruleTool, callTool);
    if (!toolHit) continue;
    if (ruleArgs !== undefined) {
      if (callArgs === undefined || !wildcardMatch(ruleArgs, callArgs)) continue;
    }
    return { hit: r, callTool, callArgs };
  }
  return { hit: undefined, callTool, callArgs };
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
  // 决策规则管理（权限档页 v2——结构化视图读写 user-rules 文件位）
  document.getElementById("perm-rule-append").addEventListener("click", () => {
    const input = document.getElementById("perm-rule-add");
    const action = document.getElementById("perm-rule-action").value;
    const rule = input.value.trim();
    if (rule === "") {
      toast("输入规则式样", "warn");
      return;
    }
    if (!/^(.+?)\s*->\s*(allow|ask|deny)\s*$/.test(`${rule} -> ${action}`)) {
      toast("规则式样不合法（示例：Bash(git *)）", "warn");
      return;
    }
    const next = permRulesContent.endsWith("\n") || permRulesContent === ""
      ? `${permRulesContent}${rule} -> ${action}\n`
      : `${permRulesContent}\n${rule} -> ${action}\n`;
    void savePolicyRules(next);
    input.value = "";
  });
  document.getElementById("perm-test-run").addEventListener("click", () => {
    const input = document.getElementById("perm-test-input");
    const out = document.getElementById("perm-test-result");
    if (out === null) return;
    const value = input.value.trim();
    if (value === "") return;
    const { hit, callTool, callArgs } = testRuleMatch(value);
    out.replaceChildren();
    const p = document.createElement("div");
    p.className = hit !== undefined ? "perm-lint-ok" : "perm-lint";
    p.textContent =
      hit !== undefined
        ? `「${callTool}${callArgs !== undefined ? `(${callArgs})` : ""}」命中第 ${hit.line} 行规则 ${hit.rule} -> ${hit.action}`
        : `「${callTool}${callArgs !== undefined ? `(${callArgs})` : ""}」未命中任何规则——默认询问（ask）`;
    out.appendChild(p);
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
  void refreshPolicyRules(); // 决策规则清单（读 user-rules 文件位）
  document.getElementById("sandbox-network").value = settingsCache?.sandbox?.network ?? "";
  document.getElementById("sandbox-workspace").value = settingsCache?.sandbox?.workspace ?? "";
  document.getElementById("sandbox-db").value = settingsCache?.sandbox?.db ?? "";
  document.getElementById("appearance-theme").value = settingsCache?.appearance?.theme ?? "dark";
  document.getElementById("appearance-language").value = settingsCache?.appearance?.language ?? "zh-CN";
  renderProfileList();
}
