/**
 * 基础设置组（T-P3-135 · UI 批次 B③④；T-P3-137 供应商分节迁出为独立
 * 子模块 providers.js——本文件保留 credentials/permission/sandbox/
 * appearance/profiles 五分节）：行式卡母版（row-list/row 消费
 * components.css）。数据面逻辑原样：providers 段整体替换语义在 providers
 * 模块、profiles applyProfile 批量写生效段在此。
 */

import { sendSettings } from "../../api.js";
import { settingsCache, applyTheme, getSessionId } from "../../state.js";
import { sendRequest } from "../../api.js";
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
  <div class="group-title">权限模式</div>
  <p class="hint">全局默认（新会话起效）；保存后当前会话立即热切换（config/refresh 通道）。五档光谱：全问 ←→ 自动批编辑 ←→ 只读 ←→ 全自动 ←→ 无人值守。</p>
  <div id="perm-mode-list" class="tile-list"></div>
  <div class="group-title">审批超时</div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">审批超时（毫秒）</div>
        <div class="row-desc">裁决为"询问"的操作等待审批的时长——超时按拒绝处理</div>
      </div>
      <div class="row-control"><input id="perm-timeout" class="input input-num" type="number" min="1000" step="1000" /></div>
    </div>
  </div>
  <div class="group-title">决策规则 <span id="perm-rule-count" class="badge">0</span></div>
  <p class="hint">工具调用的放行/询问/拒绝规则——<strong>按声明顺序首条匹配生效</strong>，全部不命中则按权限模式裁决。存于 <code id="perm-rules-path"></code>（用户级），项目级 <code>.aegent/rules.txt</code>（若存在）也会装载、排在用户级之后。全文编辑在「指令中心」。</p>
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
  <div class="group-title">工具默认策略 <span class="badge">兜底</span></div>
  <p class="hint">每类工具的兜底动作——生成对应规则追加在清单<strong>末尾</strong>（手写规则在前会优先生效）。</p>
  <div id="perm-tool-defaults" class="row-list"></div>
  <div class="group-title">规则试配器</div>
  <p class="hint">输入一条工具调用（如 <code>Bash(git status)</code>），按声明顺序预览会命中哪条规则——仅语法层预览，实际裁决以内核策略链为准。</p>
  <div class="perm-add-row">
    <input id="perm-test-input" class="input" type="text" placeholder="工具调用，如 Bash(git status)" autocomplete="off" />
    <button id="perm-test-run" type="button" class="btn">试配</button>
  </div>
  <div id="perm-test-result" class="perm-lint"></div>
  <div class="group-title">最近策略拒绝 <span class="badge">当前会话</span></div>
  <div id="perm-audit" class="row-list"></div>
  <div class="form-actions"><button id="perm-audit-refresh" type="button" class="btn">刷新</button></div>
  <div class="group-title">策略链（内核固定顺序）</div>
  <div class="row-list">
    <div class="row"><div class="row-copy"><div class="row-title">① 决策规则</div><div class="row-desc">上面清单——首条匹配的规则决定 allow / ask / deny</div></div></div>
    <div class="row"><div class="row-copy"><div class="row-title">② 权限模式</div><div class="row-desc">当前模式的映射（全自动放行 / 只读拒写类 / 编辑类放行）——deny 规则与内置保护在链上更早，不会被模式绕过</div></div></div>
    <div class="row"><div class="row-copy"><div class="row-title">③ 内置保护</div><div class="row-desc">危险命令清单、系统目录保护名、IMDS/SSRF 黑名单——内核内置</div></div></div>
    <div class="row"><div class="row-copy"><div class="row-title">④ 审批</div><div class="row-desc">裁决为"询问"的操作挂起等你审批（超时 = 上面的毫秒数，拒绝收尾）；allow 直接放行、deny 直接拒绝</div></div></div>
  </div>
</section>
<section data-section="sandbox">
  <div class="section-head"><h2 class="section-title">沙箱档</h2></div>

  <div class="group-title">沙箱模式 <span class="badge">bash / pwsh</span></div>
  <p class="hint">命令子进程的文件效果档——helper 强制面在场时<b>真实生效</b>（受限令牌 + ACL + 进程树管辖）。全局默认（新会话起效）；保存后当前会话立即热切换。缺省 = 全自动（直通）。</p>
  <div id="sandbox-mode-list" class="tile-list"></div>

  <div class="group-title">网络档</div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">网络档</div>
        <div class="row-desc">工具层网络入口（webfetch 等）的放行/拒绝——deny 档与路径守卫、权限链互不影响</div>
      </div>
      <div class="row-control">
        <select id="sandbox-network" class="select">
          <option value="">（未设置）</option>
          <option value="allow">allow（放行）</option>
          <option value="deny">deny（拒绝）</option>
        </select>
      </div>
    </div>
  </div>
  <p class="hint" id="sandbox-network-hint">deny 档当前只承诺工具层拦截；OS 级强制（WFP + 专用账户）需一次性 provision——自检会给出当前强制面与修复命令。allow 档也恒拦云元数据端点（IMDS/SSRF 防护）。</p>

  <div class="group-title">写白名单 <span class="badge">工作区外</span></div>
  <p class="hint">工作区之外的显式可写目录（出口级守卫——任何批准都绕不过）。改动新会话生效。</p>
  <div id="sandbox-whitelist" class="row-list"></div>
  <div class="perm-add-row">
    <input id="sandbox-whitelist-add" class="input" type="text" placeholder="目录绝对路径，如 F:\shared-libs" autocomplete="off" />
    <button id="sandbox-whitelist-append" type="button" class="btn">＋ 添加</button>
  </div>

  <div class="group-title">内置保护 <span class="badge">只读展示</span></div>
  <p class="hint">以下名字/路径在任何档位都被保护（防改配置提权、防凭据外带）——内核内置，不可配置。</p>
  <div id="sandbox-protected" class="row-list"></div>

  <div class="group-title">自检 <span class="badge">doctor</span></div>
  <div id="sandbox-doctor" class="row-list"></div>
  <div class="form-actions"><button id="sandbox-doctor-refresh" type="button" class="btn">运行自检</button></div>

  <div class="group-title">落位</div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">工作区</div>
        <div class="row-desc">沙箱可见的工作区目录（守卫边界基座）</div>
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
    <select id="profile-sandbox-mode" class="select">
      <option value="">沙箱档：跟随全局（可选）</option>
      <option value="read-only">read-only（只读）</option>
      <option value="workspace-write">workspace-write（工作区写入）</option>
      <option value="danger-full-access">danger-full-access（全自动）</option>
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
  renderToolDefaults(); // 工具默认策略下拉（管理段回填）
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
// 权限模式（T-P3-137 八轮 A——五档成套切换：全局默认（settings 持久）+
// 当前会话热切换（config/refresh 通道）。模式目录与 src/kernel/session-config.ts
// PERMISSION_MODES_DIRECTORY 同源——前端零构建链复制，改动需两侧同步）。
// ---------------------------------------------------------------------------

const PERMISSION_MODE_UI = [
  { name: "ask", label: "每次询问", desc: "裁决为询问的操作都挂起等你批（默认，最安全）" },
  { name: "accept-edits", label: "自动批编辑", desc: "编辑/写入/补丁类工具自动放行，其余照问（人在旁边快速迭代）" },
  { name: "read-only", label: "只读", desc: "写类调用直接拒绝——探索代码库、规划实现用" },
  { name: "auto", label: "全自动", desc: "询问全部自动放行（deny 规则与内置保护仍然拦截）" },
  { name: "unattended", label: "无人值守", desc: "询问全部自动拒绝（定时任务/不在场时的安全默认）" },
];
const PERMISSION_MODE_VALUES = {
  ask: { approvalMode: "ask-all", unattended: false },
  "accept-edits": { approvalMode: "accept-edits", unattended: false },
  "read-only": { approvalMode: "read-only", sandboxMode: "read-only", unattended: false },
  auto: { approvalMode: "auto", sandboxMode: "danger-full-access", unattended: false },
  unattended: { approvalMode: "ask-all", unattended: true },
};

function renderPermissionModes() {
  const box = document.getElementById("perm-mode-list");
  if (box === null) return;
  box.replaceChildren();
  const current = settingsCache?.permission?.mode ?? "ask";
  for (const mode of PERMISSION_MODE_UI) {
    const row = rowEl();
    const titleEl = document.createElement("div");
    titleEl.className = "row-title";
    titleEl.textContent = mode.label;
    if (current === mode.name) titleEl.appendChild(chipEl("当前", true));
    const descEl = document.createElement("div");
    descEl.className = "row-desc";
    descEl.textContent = mode.desc;
    const useBtn = btnEl(current === mode.name ? "使用中" : "启用", "btn", `切换到权限模式 ${mode.label}`);
    useBtn.disabled = current === mode.name;
    useBtn.addEventListener("click", () => void applyPermissionMode(mode.name));
    row.append(rowCopyEl(titleEl, descEl), rowControl(useBtn));
    box.appendChild(row);
  }
}

async function applyPermissionMode(name) {
  // 全局默认持久化（新会话起效）+ 当前会话热切换（config/refresh 即时生效）
  settingsCache.permission = { ...(settingsCache.permission ?? {}), mode: name };
  markDirty("permission");
  const sid = getSessionId();
  if (sid !== "") {
    try {
      await sendRequest(sid, { type: "config/refresh", patch: { ...PERMISSION_MODE_VALUES[name] } });
      toast(`权限模式已切换：${name}（当前会话即时生效 + 新会话默认）`, "info");
    } catch {
      toast(`权限模式已保存：${name}（新会话生效——当前会话切换失败）`, "warn");
    }
  } else {
    toast(`权限模式已保存：${name}（新会话生效）`, "info");
  }
  renderPermissionModes();
}

// ---------------------------------------------------------------------------
// 工具默认策略（八轮 D——opencode per-tool permission 的等价糖：每类工具
// 的兜底动作生成规则追加在清单末尾管理段——手写规则在前优先生效）
// ---------------------------------------------------------------------------

const TOOL_DEFAULT_TARGETS = [
  ["bash", "Bash"],
  ["pwsh", "Pwsh"],
  ["edit", "Edit"],
  ["write", "Write"],
  ["webfetch", "WebFetch"],
  ["task", "Task"],
];
const TOOL_DEFAULTS_MARKER = "# --- 工具默认策略（权限档页生成，勿手改） ---";

function parseToolDefaults(content) {
  const out = {};
  let inSection = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === TOOL_DEFAULTS_MARKER) {
      inSection = true;
      continue;
    }
    if (!inSection || line === "" || line.startsWith("#")) continue;
    const m = /^([^(]+?)\s*\(\*\)\s*->\s*(allow|ask|deny)\s*$/.exec(line);
    if (m !== null) out[m[1].trim()] = m[2];
  }
  return out;
}

function buildToolDefaultsSection(defaults) {
  const rows = TOOL_DEFAULT_TARGETS.filter(([key]) => defaults[key] !== undefined && defaults[key] !== "").map(
    ([key, ruleName]) => `${ruleName}(*) -> ${defaults[key]}`,
  );
  if (rows.length === 0) return "";
  return `${TOOL_DEFAULTS_MARKER}\n${rows.join("\n")}\n`;
}

function renderToolDefaults() {
  const box = document.getElementById("perm-tool-defaults");
  if (box === null) return;
  box.replaceChildren();
  const current = parseToolDefaults(permRulesContent);
  for (const [key, ruleName] of TOOL_DEFAULT_TARGETS) {
    const row = rowEl();
    const titleEl = document.createElement("div");
    titleEl.className = "row-title";
    titleEl.textContent = ruleName;
    const descEl = document.createElement("div");
    descEl.className = "row-desc";
    descEl.textContent =
      key === "bash" || key === "pwsh"
        ? "命令执行——兜底动作（编辑类自动批模式对它不生效）"
        : key === "task"
          ? "子任务委派——兜底动作"
          : "兜底动作";
    const sel = document.createElement("select");
    sel.className = "select";
    sel.setAttribute("aria-label", `${ruleName} 默认动作`);
    sel.dataset.tool = key;
    for (const [value, label] of [
      ["", "（未设置）"],
      ["allow", "allow（放行）"],
      ["ask", "ask（询问）"],
      ["deny", "deny（拒绝）"],
    ]) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      sel.appendChild(o);
    }
    sel.value = current[key] ?? "";
    sel.addEventListener("change", () => saveToolDefaults());
    row.append(rowCopyEl(titleEl, descEl), rowControl(sel));
    box.appendChild(row);
  }
}

function saveToolDefaults() {
  const box = document.getElementById("perm-tool-defaults");
  if (box === null) return;
  const defaults = {};
  for (const sel of box.querySelectorAll("select")) {
    if (sel.value !== "") defaults[sel.dataset.tool] = sel.value;
  }
  // 剥离旧管理段 → 追加新段（手写规则区保持原样——首匹配胜下手写优先）
  const stripped = permRulesContent.split(/\r?\n/).filter((l) => {
    if (l.trim() === TOOL_DEFAULTS_MARKER) return false;
    if (l.trim().startsWith("#") || l.trim() === "") return true;
    return !/^[A-Za-z_]+\s*\(\*\)\s*->\s*(allow|ask|deny)\s*$/.test(l.trim()) || parseToolDefaults(permRulesContent)[/^([^(]+?)/.exec(l.trim())?.[1]?.trim() ?? ""] === undefined;
  });
  const base = stripped.join("\n").replace(/\n+$/, "");
  const next = base === "" ? buildToolDefaultsSection(defaults) : `${base}\n${buildToolDefaultsSection(defaults)}`;
  void savePolicyRules(next.endsWith("\n") || next === "" ? next : `${next}\n`);
  renderToolDefaults();
}

// ---------------------------------------------------------------------------
// 审批历史（八轮 E——bridge policy-audit op 扫当前会话流的策略拒绝）
// ---------------------------------------------------------------------------

async function refreshPolicyAudit() {
  const box = document.getElementById("perm-audit");
  if (box === null) return;
  box.replaceChildren();
  const envelope = await sendSettings({ op: "policy-audit" });
  if (!envelope.ok) {
    box.appendChild(emptyState("审批历史不可用", envelope.error?.message ?? ""));
    return;
  }
  const entries = envelope.result.entries ?? [];
  if (entries.length === 0) {
    box.appendChild(emptyState("当前会话没有策略拒绝记录", "被规则/模式拒绝的调用会在这里列出"));
    return;
  }
  for (const e of entries) {
    const row = rowEl();
    const titleEl = document.createElement("div");
    titleEl.className = "row-title mono";
    titleEl.textContent = e.tool;
    // T-P3-140 批次 E：沙箱升级标记（徽标 + 理由——fail-closed 的可见事实）
    if (e.escalation) titleEl.appendChild(chipEl(`沙箱升级→${e.escalation}`, true));
    const descEl = document.createElement("div");
    descEl.className = "row-desc";
    descEl.textContent = e.justification
      ? `${e.reason}（理由：${e.justification} · ${e.time}）`
      : `${e.reason}（${e.time}）`;
    row.append(rowCopyEl(titleEl, descEl));
    box.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// 沙箱档（T-P3-140 批次 A/B/C/D——三档模式卡 + doctor 自检 + 写白名单 +
// 内置保护展示）。模式目录与 src/sandbox/backend.ts SANDBOX_MODES 及
// session-config REFRESHABLE_CONFIG_KEYS 同源——前端零构建链复制，改动需
// 两侧同步。缺省档 = danger-full-access（直通，与既有行为零差）。
// ---------------------------------------------------------------------------

const SANDBOX_MODE_UI = [
  {
    name: "read-only",
    label: "只读",
    desc: "命令以只读令牌运行——工作区与全部路径写拒绝（探索/评估陌生项目）",
  },
  {
    name: "workspace-write",
    label: "工作区写入",
    desc: "仅工作区与私有 temp 可写，其余全盘只读 + 进程树管辖（日常推荐）",
  },
  {
    name: "danger-full-access",
    label: "全自动",
    desc: "无强制（直通）——升级申请面收口；deny 规则与出口守卫仍然拦截",
  },
];

function renderSandboxModes() {
  const box = document.getElementById("sandbox-mode-list");
  if (box === null) return;
  box.replaceChildren();
  const current = settingsCache?.sandbox?.mode ?? "danger-full-access";
  for (const mode of SANDBOX_MODE_UI) {
    const row = rowEl();
    const titleEl = document.createElement("div");
    titleEl.className = "row-title";
    titleEl.textContent = mode.label;
    if (current === mode.name) titleEl.appendChild(chipEl("当前", true));
    const descEl = document.createElement("div");
    descEl.className = "row-desc";
    descEl.textContent = mode.desc;
    const useBtn = btnEl(current === mode.name ? "使用中" : "启用", "btn", `切换沙箱模式 ${mode.label}`);
    useBtn.disabled = current === mode.name;
    useBtn.addEventListener("click", () => void applySandboxMode(mode.name));
    row.append(rowCopyEl(titleEl, descEl), rowControl(useBtn));
    box.appendChild(row);
  }
}

async function applySandboxMode(name) {
  // 全局默认持久化（新会话起效）+ 当前会话热切换（config/refresh 即时生效
  // ——sandboxMode 在 REFRESHABLE_CONFIG_KEYS 白名单，权限模式预设同通道）
  settingsCache.sandbox = { ...(settingsCache.sandbox ?? {}), mode: name };
  markDirty("sandbox");
  const sid = getSessionId();
  if (sid !== "") {
    try {
      await sendRequest(sid, { type: "config/refresh", patch: { sandboxMode: name } });
      toast(`沙箱模式已切换：${name}（当前会话即时生效 + 新会话默认）`, "info");
    } catch {
      toast(`沙箱模式已保存：${name}（新会话生效——当前会话切换失败）`, "warn");
    }
  } else {
    toast(`沙箱模式已保存：${name}（新会话生效）`, "info");
  }
  renderSandboxModes();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制到剪贴板", "info");
  } catch {
    toast("复制失败（WebView 剪贴板不可用）", "warn");
  }
}

const DOCTOR_STATUS_ICON = { ok: "✔", warn: "▲", error: "✘" };

async function refreshSandboxDoctor() {
  const box = document.getElementById("sandbox-doctor");
  if (box === null) return;
  box.replaceChildren();
  const envelope = await sendSettings({ op: "sandbox-doctor" });
  if (!envelope.ok) {
    box.appendChild(emptyState("自检不可用", envelope.error?.message ?? ""));
    return;
  }
  const d = envelope.result;
  // 生效面一览行（模式 × 后端——降级事实常显，不静默）
  const backendLine = d.helperAvailable
    ? "win32 受限令牌 helper（强管辖）"
    : "local 弱兜底（受限档不可用——命令未启动即报错）";
  const modeLine = d.sandboxMode ?? "danger-full-access（缺省）";
  const overview = rowEl();
  const overviewCopy = rowCopyEl(
    Object.assign(document.createElement("div"), {
      className: "row-title",
      textContent: `生效模式：${modeLine}`,
    }),
    Object.assign(document.createElement("div"), {
      className: "row-desc",
      textContent: `强制后端：${backendLine} · helper 路径：${d.helperPath}`,
    }),
  );
  overview.appendChild(overviewCopy);
  box.appendChild(overview);
  for (const check of d.checks ?? []) {
    const row = rowEl();
    const titleEl = document.createElement("div");
    titleEl.className = "row-title";
    titleEl.textContent = `${DOCTOR_STATUS_ICON[check.status] ?? "?"} ${check.title}`;
    const descEl = document.createElement("div");
    descEl.className = "row-desc";
    descEl.textContent = check.details.join("；");
    const controls = [];
    if (check.remediation) {
      const copyBtn = btnEl("复制修复命令", "btn", "复制修复命令到剪贴板");
      copyBtn.addEventListener("click", () => void copyText(check.remediation));
      controls.push(copyBtn);
    }
    row.append(rowCopyEl(titleEl, descEl), rowControl(...controls));
    box.appendChild(row);
  }
  // C 批次：网络档强制面提示随自检联动刷新
  const hint = document.getElementById("sandbox-network-hint");
  if (hint !== null) {
    const netCheck = (d.checks ?? []).find((c) => c.id === "network-isolation");
    const provisioned = netCheck !== undefined && netCheck.status === "ok";
    hint.textContent =
      d.networkPolicy === "deny"
        ? provisioned
          ? "deny 档：工具层拦截 + OS 级强制在位（WFP 按专用账户拦截子进程出站）。"
          : "deny 档：当前只承诺工具层拦截（webfetch 等）——子进程网络不被承诺管住；管理员运行 provision 后升级为 OS 级强制。allow 档也恒拦云元数据端点（IMDS/SSRF 防护）。"
        : `网络档：${d.networkPolicy ?? "未设置（缺省放行）"}——工具层 fetch 可用；IMDS/SSRF 黑名单恒在（独立于档位）。`;
  }
  // D 批次：内置保护只读展示（doctor 载荷同程带回）
  const protectedBox = document.getElementById("sandbox-protected");
  if (protectedBox !== null) {
    protectedBox.replaceChildren();
    const names = d.protectedNames ?? [];
    const row = rowEl();
    row.append(
      rowCopyEl(
        Object.assign(document.createElement("div"), {
          className: "row-title",
          textContent: `保护名清单（${String(names.length)} 项）`,
        }),
        Object.assign(document.createElement("div"), {
          className: "row-desc mono",
          textContent: names.join("、"),
        }),
      ),
    );
    protectedBox.appendChild(row);
  }
}

function renderSandboxWhitelist() {
  const box = document.getElementById("sandbox-whitelist");
  if (box === null) return;
  box.replaceChildren();
  const list = settingsCache?.sandbox?.writeWhitelist ?? [];
  if (list.length === 0) {
    box.appendChild(emptyState("无白名单条目", "工作区外的写入一律拒绝——需要额外可写目录时在此添加"));
    return;
  }
  for (const dir of list) {
    const row = rowEl();
    const titleEl = document.createElement("div");
    titleEl.className = "row-title mono";
    titleEl.textContent = dir;
    const delBtn = btnEl("移除", "btn btn-danger", `移除白名单 ${dir}`);
    delBtn.addEventListener("click", () => {
      settingsCache.sandbox = {
        ...(settingsCache.sandbox ?? {}),
        writeWhitelist: (settingsCache?.sandbox?.writeWhitelist ?? []).filter((w) => w !== dir),
      };
      markDirty("sandbox");
      renderSandboxWhitelist();
    });
    row.append(rowCopyEl(titleEl), rowControl(delBtn));
    box.appendChild(row);
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
    descEl.textContent = `→ ${p.defaultProvider}${p.defaultModel ? `/${p.defaultModel}` : ""}${p.sandbox?.network ? `（网络 ${p.sandbox.network}）` : ""}${p.sandbox?.mode ? `（沙箱 ${p.sandbox.mode}）` : ""}`;
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
  document.getElementById("sandbox-doctor-refresh").addEventListener("click", () => void refreshSandboxDoctor());
  document.getElementById("sandbox-whitelist-append").addEventListener("click", () => {
    const input = document.getElementById("sandbox-whitelist-add");
    const dir = input.value.trim();
    if (dir === "") {
      toast("输入目录绝对路径", "warn");
      return;
    }
    const list = settingsCache?.sandbox?.writeWhitelist ?? [];
    if (list.includes(dir)) {
      toast("该目录已在白名单", "warn");
      return;
    }
    settingsCache.sandbox = { ...(settingsCache.sandbox ?? {}), writeWhitelist: [...list, dir] };
    markDirty("sandbox");
    input.value = "";
    renderSandboxWhitelist();
  });
  document.getElementById("perm-audit-refresh").addEventListener("click", () => void refreshPolicyAudit());
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
    const sandboxMode = document.getElementById("profile-sandbox-mode").value;
    if (name === "" || provider === "") return;
    const sandboxPatch = {
      ...(network !== "" ? { network } : {}),
      ...(sandboxMode !== "" ? { mode: sandboxMode } : {}),
    };
    const entry = {
      name,
      defaultProvider: provider,
      ...(model !== "" ? { defaultModel: model } : {}),
      ...(timeoutRaw !== "" ? { permission: { approvalTimeoutMs: Number(timeoutRaw) } } : {}),
      ...(Object.keys(sandboxPatch).length > 0 ? { sandbox: sandboxPatch } : {}),
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
    document.getElementById("profile-sandbox-mode").value = settingsCache?.sandbox?.mode ?? "";
  });
}

export function fill() {
  document.getElementById("perm-timeout").value =
    settingsCache?.permission?.approvalTimeoutMs ?? "";
  void refreshPolicyRules(); // 决策规则清单（读 user-rules 文件位）
  renderPermissionModes(); // 权限模式卡（settings.permission.mode 当前值）
  void refreshPolicyAudit(); // 审批历史（当前会话流的策略拒绝）
  document.getElementById("sandbox-network").value = settingsCache?.sandbox?.network ?? "";
  document.getElementById("sandbox-workspace").value = settingsCache?.sandbox?.workspace ?? "";
  document.getElementById("sandbox-db").value = settingsCache?.sandbox?.db ?? "";
  renderSandboxModes();
  renderSandboxWhitelist();
  void refreshSandboxDoctor();
  document.getElementById("appearance-theme").value = settingsCache?.appearance?.theme ?? "dark";
  document.getElementById("appearance-language").value = settingsCache?.appearance?.language ?? "zh-CN";
  renderProfileList();
}
