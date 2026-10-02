/**
 * 指令中心域（T-P3-151 A~E——从 system.js 迁出的重构面）：
 * - A1 左树右编辑两栏：五文件位（全局/项目 AGENTS.md、项目/用户规则、记忆索引）
 *   + 宿主防护只读组；每节点徽标（存在性/字符数），不存在条目引导创建；
 * - A2 装配预览条：instructions-list 的 assembly（F2 收集链真实顺序）；
 * - B1 规则三列卡（allow/ask/deny 分组，两层装配序）+ B2 新建模态
 *   （instruction-append dryRun 预览后落盘）+ B3 规则测试器
 *   （instruction-test-rule 真实求值）+ B5 lint 逐行（一键注释禁用）；
 * - D1 从项目生成 AGENTS.md（组装初始化提示词进对话——agent 起草后回来核对）；
 * - D2 模板 chips（编辑器整体填充）；
 * - E1 保存语义明示（保存后新会话生效——当前会话仍用旧规矩）。
 * 数据面 op：instructions-list / instruction-save / instruction-append /
 * instruction-test-rule（载荷校验在 host 协议层）。
 */

import { sendSettings } from "../../api.js";
import { appendLine, toast } from "../../feedback.js";
import { openDialog, confirmDialog } from "./core.js";

// ---------------------------------------------------------------------------
// 常量（节点/模板/工具集）
// ---------------------------------------------------------------------------

const NODE_DEFS = [
  { key: "global-agents", label: "全局 AGENTS.md", hint: "~/.aegent/AGENTS.md · 所有工作区生效（最远层）" },
  { key: "project-agents", label: "项目 AGENTS.md", hint: "<workspace>/AGENTS.md · 就近覆盖全局" },
  { key: "project-rules", label: "项目规则 rules.txt", hint: "<workspace>/.aegent/rules.txt · 项目级权限规则" },
  { key: "user-rules", label: "用户规则 rules.txt", hint: "~/.aegent/rules.txt · 用户级权限规则（首匹配胜·前）" },
  { key: "memory", label: "记忆索引 MEMORY.md", hint: "~/.aegent/memory/MEMORY.md · 持久记忆（装配末层）" },
];

const RULE_TARGETS = new Set(["user-rules", "project-rules"]);

/** D2 模板库（点选整体填充——T-P3-145 chips 交互同款）。 */
const INSTR_TEMPLATES = {
  "project-agents": [
    { label: "代码风格", text: "## 代码风格\n- 缩进与命名遵循现有代码\n\n## 提交约定\n- " },
    { label: "测试要求", text: "## 测试要求\n- 修复前先写复现用例\n- 改动后运行现有测试\n" },
    { label: "安全红线", text: "## 安全红线\n- 不提交密钥与凭据\n- 外部输入先校验后使用\n" },
  ],
  "global-agents": [
    { label: "通用偏好", text: "## 通用偏好\n- 中文回复\n- 先结论后理由\n" },
    { label: "汇报格式", text: "## 汇报格式\n- 做了什么 / 为什么 / 如何验证 / 剩余风险\n" },
  ],
  "user-rules": [
    { label: "常用放行", text: "# 每行：<规则> -> <allow|ask|deny>\nBash(git status) -> allow\nBash(git diff*) -> allow\n" },
    { label: "Git 保护", text: "Bash(git push --force*) -> deny\nBash(git reset --hard) -> deny\n" },
    { label: "危险禁止", text: "Bash(rm -rf*) -> deny\nBash(sudo*) -> deny\n" },
  ],
  "project-rules": [
    { label: "项目放行", text: "# 项目级规则（用户层优先）\nBash(npm test*) -> allow\nBash(npm run lint) -> allow\n" },
    { label: "构建保护", text: "Bash(rm -rf dist*) -> deny\n" },
  ],
  memory: [{ label: "索引骨架", text: "# 记忆索引\n- [偏好](preferences.md) — 交互偏好摘录\n" }],
};

/** 测试器/新建对话框的常用工具集（registry 小写名 + 大写惯用形状均可——匹配大小写宽容）。 */
const COMMON_TOOLS = ["bash", "read", "edit", "write", "webfetch", "glob", "grep", "task", "apply_patch"];

// ---------------------------------------------------------------------------
// 状态与数据
// ---------------------------------------------------------------------------

let view = null; // instructions-list 回包
let selected = "project-agents"; // 当前节点
let rulesTab = "rules"; // 规则节点右栏 tab（rules | source）
let dirty = new Set(); // 已编辑未保存的 target 集

function el(id) {
  return document.getElementById(id);
}

async function fetchView() {
  const envelope = await sendSettings({ op: "instructions-list" });
  if (!envelope.ok) {
    throw new Error(envelope.error?.message ?? "指令面不可用");
  }
  view = envelope.result;
}

/** 节点 key → instructions-list 字段名映射（装配序 key 与 view 字段名不同源）。 */
const VIEW_FIELD = {
  "global-agents": "global",
  "project-agents": "project",
  "project-rules": "projectRules",
  "user-rules": "rules",
  memory: "memory",
};

function slotOf(target) {
  const field = VIEW_FIELD[target];
  if (view === null || field === undefined) return { path: "", exists: false, content: "" };
  return view[field] ?? { path: "", exists: false, content: "" };
}

// ---------------------------------------------------------------------------
// 渲染：左树 + 装配预览
// ---------------------------------------------------------------------------

function renderTree() {
  const list = el("instr-tree-list");
  if (list === null) return;
  list.replaceChildren();
  for (const def of NODE_DEFS) {
    const slot = slotOf(def.key);
    const item = document.createElement("button");
    item.type = "button";
    item.className = `instr-node${selected === def.key ? " active" : ""}${dirty.has(def.key) ? " dirty" : ""}`;
    const name = document.createElement("span");
    name.className = "instr-node-label";
    name.textContent = def.label;
    const badge = document.createElement("span");
    badge.className = `chip ${slot.exists ? "chip-ok" : "chip-warn"}`;
    badge.textContent = slot.exists ? `${slot.content.length} 字` : "未创建";
    item.append(name, badge);
    item.title = def.hint;
    item.addEventListener("click", () => {
      selected = def.key;
      renderAll();
    });
    list.appendChild(item);
  }
  const host = document.createElement("button");
  host.type = "button";
  host.className = `instr-node${selected === "host" ? " active" : ""}`;
  const hostName = document.createElement("span");
  hostName.className = "instr-node-label";
  hostName.textContent = "宿主内置防护";
  const lock = document.createElement("span");
  lock.className = "chip";
  lock.textContent = "🔒 只读";
  host.append(hostName, lock);
  host.title = "policy 链宿主面（危险命令/保护路径等）——不可覆盖";
  host.addEventListener("click", () => {
    selected = "host";
    renderAll();
  });
  list.appendChild(host);
}

function renderAssembly() {
  const box = el("instr-assembly");
  if (box === null) return;
  box.replaceChildren();
  if (view === null) return;
  const title = document.createElement("div");
  title.className = "instr-assembly-title";
  title.textContent = "新会话装配序";
  box.appendChild(title);
  for (const step of view.assembly.order) {
    const row = document.createElement("div");
    row.className = "instr-assembly-row";
    const dot = document.createElement("span");
    dot.className = `dot ${step.exists ? "dot-ok" : "dot-miss"}`;
    const label = document.createElement("span");
    label.textContent = step.key;
    const chars = document.createElement("span");
    chars.className = "instr-assembly-chars";
    chars.textContent = step.exists ? `${step.chars} 字` : "缺席";
    row.append(dot, label, chars);
    row.title = step.path;
    box.appendChild(row);
  }
  const note = document.createElement("div");
  note.className = "hint";
  note.textContent = view.assembly.note;
  box.appendChild(note);
}

// ---------------------------------------------------------------------------
// 渲染：右栏（编辑器 / 规则视图 / 宿主防护）
// ---------------------------------------------------------------------------

function renderEditor() {
  const def = NODE_DEFS.find((n) => n.key === selected);
  const slot = slotOf(selected);
  el("instr-editor-title").textContent = def?.label ?? selected;
  el("instr-editor-path").textContent = slot.path;
  el("instr-editor-hint").textContent = def?.hint ?? "";
  const ta = el("instr-editor-text");
  ta.value = slot.content;
  ta.disabled = selected === "host";
  updateCharCount();
  const templateRow = el("instr-templates");
  templateRow.replaceChildren();
  for (const tpl of INSTR_TEMPLATES[selected] ?? []) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip chip-btn";
    chip.textContent = `模板：${tpl.label}`;
    chip.addEventListener("click", () => {
      ta.value = tpl.text;
      dirty.add(selected);
      updateCharCount();
    });
    templateRow.appendChild(chip);
  }
  const genBtn = el("instr-generate");
  genBtn.hidden = selected !== "project-agents";
  el("instr-editor-effective").textContent = "保存后新会话生效——当前会话仍使用旧规矩。";
}

function updateCharCount() {
  const ta = el("instr-editor-text");
  const count = el("instr-editor-count");
  const size = ta.value.length;
  count.textContent = `${size} 字符`;
  count.classList.toggle("error-text", size > 32_000);
  if (size > 32_000) count.textContent += "（超 32KB——装配面可能截断，建议拆分）";
}

async function saveSelected() {
  const target = selected;
  const content = el("instr-editor-text").value;
  const ok = await confirmDialog(
    "确认保存？保存后新会话生效（当前会话仍使用旧规矩；覆盖写入）。",
    { title: "保存指令", confirmLabel: "保存" },
  );
  if (!ok) return;
  const envelope = await sendSettings({ op: "instruction-save", target, content });
  if (!envelope.ok) {
    appendLine(`指令保存失败：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  dirty.delete(target);
  await refresh();
  toast("已保存（新会话生效）", "info");
}

// ---------------------------------------------------------------------------
// 规则视图（B1/B2/B3/B5）
// ---------------------------------------------------------------------------

function ruleRow(rule, layer) {
  const row = document.createElement("div");
  row.className = `rule-row${rule.invalid ? " rule-invalid" : ""}`;
  const raw = document.createElement("code");
  raw.className = "rule-raw";
  raw.textContent = rule.raw;
  const meta = document.createElement("span");
  meta.className = "rule-meta";
  meta.textContent = `${layer === "user" ? "用户" : "项目"} · 第 ${rule.line ?? "?"} 行${rule.invalid ? " · 语法畸形（永不命中）" : ""}`;
  row.append(raw, meta);
  row.title = rule.invalid ? "解析失败——规则保留但永不命中，可在源码编辑修复" : rule.raw;
  return row;
}

function renderRules() {
  const box = el("instr-rules-view");
  box.replaceChildren();
  if (view === null) return;
  for (const layer of view.ruleSets.layers) {
    const card = document.createElement("div");
    card.className = "card-box rules-layer-card";
    const head = document.createElement("div");
    head.className = "instr-head";
    head.textContent = `${layer.layer === "user" ? "用户层" : "项目层"}（${layer.layer === "user" ? "首匹配胜·前" : "后"}）—— ${layer.path}`;
    card.appendChild(head);
    const cols = document.createElement("div");
    cols.className = "rules-cols";
    for (const action of ["allow", "ask", "deny"]) {
      const col = document.createElement("div");
      col.className = `rules-col rules-col-${action}`;
      const h = document.createElement("div");
      h.className = "rules-col-title";
      h.textContent = action;
      col.appendChild(h);
      const rules = layer.rules.filter((r) => r.action === action);
      if (rules.length === 0) {
        const empty = document.createElement("div");
        empty.className = "hint";
        empty.textContent = "（无）";
        col.appendChild(empty);
      }
      for (const rule of rules) col.appendChild(ruleRow(rule, layer.layer));
      cols.appendChild(col);
    }
    card.appendChild(cols);
    // B5 lint 逐行
    if (layer.issues.length > 0) {
      const lint = document.createElement("div");
      lint.className = "rules-lint";
      for (const issue of layer.issues.slice(0, 8)) {
        const row = document.createElement("div");
        row.className = "rule-row rule-invalid";
        const msg = document.createElement("span");
        msg.className = "rule-raw";
        msg.textContent = `第 ${issue.line} 行：${issue.message}`;
        const fix = document.createElement("button");
        fix.type = "button";
        fix.className = "btn btn-xs";
        fix.textContent = "注释禁用";
        fix.addEventListener("click", () => void disableLine(layer.layer, issue.line));
        row.append(msg, fix);
        lint.appendChild(row);
      }
      if (layer.issues.length > 8) {
        const more = document.createElement("div");
        more.className = "hint";
        more.textContent = `…共 ${layer.issues.length} 条问题（源码编辑查看全部）`;
        lint.appendChild(more);
      }
      card.appendChild(lint);
    }
    box.appendChild(card);
  }
  const hostCard = document.createElement("div");
  hostCard.className = "card-box rules-layer-card";
  const hostHead = document.createElement("div");
  hostHead.className = "instr-head";
  hostHead.textContent = "宿主内置防护（规则链独立环节——任何层级不可覆盖）";
  hostCard.appendChild(hostHead);
  for (const p of view.ruleSets.hostProtections) {
    const row = document.createElement("div");
    row.className = "rule-row";
    const name = document.createElement("code");
    name.className = "rule-raw";
    name.textContent = `🔒 ${p.name}`;
    const desc = document.createElement("span");
    desc.className = "rule-meta";
    desc.textContent = p.description;
    row.append(name, desc);
    hostCard.appendChild(row);
  }
  box.appendChild(hostCard);
  renderTester();
}

function renderTester() {
  const box = el("instr-tester");
  if (box === null || box.dataset.bound === "1") return;
  box.dataset.bound = "1";
}

async function runTester() {
  const tool = el("instr-test-tool").value.trim();
  const argText = el("instr-test-args").value.trim();
  let ruleArgs;
  if (argText !== "") {
    try {
      const parsed = JSON.parse(argText);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("须为对象");
      ruleArgs = parsed;
    } catch {
      el("instr-test-result").innerHTML = "";
      const bad = document.createElement("div");
      bad.className = "hint error-text";
      bad.textContent = "参数须为 JSON 对象（如 {\"command\": \"git status\"}）";
      el("instr-test-result").appendChild(bad);
      return;
    }
  }
  const envelope = await sendSettings({ op: "instruction-test-rule", tool, ...(ruleArgs !== undefined ? { ruleArgs } : {}) });
  const out = el("instr-test-result");
  out.replaceChildren();
  if (!envelope.ok) {
    out.textContent = `✘ ${envelope.error?.message ?? "测试失败"}`;
    out.className = "card-args error-text";
    return;
  }
  const v = envelope.result;
  const head = document.createElement("div");
  head.className = `rule-row verdict-${v.action}`;
  head.innerHTML = `<span class="rule-raw">结果：<b>${v.action}</b></span>`;
  out.appendChild(head);
  if (v.hit !== undefined) {
    const hit = document.createElement("div");
    hit.className = "rule-row";
    hit.innerHTML = `<code class="rule-raw"></code><span class="rule-meta"></span>`;
    hit.querySelector("code").textContent = v.hit.raw;
    hit.querySelector(".rule-meta").textContent =
      `${v.hit.layer === "user" ? "用户" : "项目"}层 · 第 ${v.hit.line ?? "?"} 行`;
    out.appendChild(hit);
  }
  for (const step of v.steps) {
    const row = document.createElement("div");
    row.className = "rule-row";
    row.innerHTML = `<span class="rule-meta"></span>`;
    row.querySelector(".rule-meta").textContent =
      `${step.layer === "user" ? "用户" : "项目"}层：${step.total} 条规则 · ${step.matched ? "命中" : "未命中"}`;
    out.appendChild(row);
  }
  const note = document.createElement("div");
  note.className = "hint";
  note.textContent = v.note;
  out.appendChild(note);
}

/** B5 一键注释禁用：读层文本→目标行加 # 前缀→整写回（instruction-save）。 */
async function disableLine(layer, line) {
  const target = layer === "user" ? "user-rules" : "project-rules";
  const content = slotOf(target).content;
  const lines = content.split(/\r?\n/);
  const idx = line - 1;
  const original = lines[idx];
  if (original === undefined) return;
  lines[idx] = original.trimStart().startsWith("#") ? original : `# ${original}`;
  const ok = await confirmDialog(`将第 ${line} 行注释禁用：\n${original}`, { title: "注释禁用规则行", confirmLabel: "禁用" });
  if (!ok) return;
  const envelope = await sendSettings({ op: "instruction-save", target, content: lines.join("\n") });
  if (!envelope.ok) {
    toast(`禁用失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  await refresh();
  toast("已注释禁用（新会话生效）", "info");
}

/** B2 新建规则模态。 */
function openRuleDialog() {
  const defaultLayer = selected === "project-rules" ? "project-rules" : "user-rules";
  const body = document.createElement("div");
  body.innerHTML = `
    <label class="field-label">规则行</label>
    <input id="rule-new-raw" class="input input-wide" placeholder="如 Bash(git status) 或 Edit(*.ts)" />
    <label class="field-label">动作</label>
    <select id="rule-new-action" class="input">
      <option value="allow">allow（放行）</option>
      <option value="ask">ask（每次确认）</option>
      <option value="deny">deny（禁止）</option>
    </select>
    <label class="field-label">写入层</label>
    <select id="rule-new-layer" class="input">
      <option value="user-rules"${defaultLayer === "user-rules" ? " selected" : ""}>用户层 ~/.aegent/rules.txt</option>
      <option value="project-rules"${defaultLayer === "project-rules" ? " selected" : ""}>项目层 .aegent/rules.txt</option>
    </select>
    <p class="hint">常用工具：${COMMON_TOOLS.join(" / ")}（或任意注册名；大小写不敏感）</p>
    <p id="rule-new-preview" class="hint"></p>
  `;
  openDialog({
    title: "新建规则",
    description: "生成一行「规则 -> 动作」追加到所选层文件（追加，不覆盖既有内容）。",
    width: "md",
    body,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      {
        label: "预览并保存",
        className: "btn btn-primary",
        // 闭包持有 body 引用——onClick 时模态 DOM 已 detach，getElementById
        // 拿 null 静默 return（T-P3-146/148 同款坑第三次，教训记录在案）
        onClick: () => void submitRuleDialog(body),
      },
    ],
  });
}

async function submitRuleDialog(root) {
  const rawInput = root?.querySelector("#rule-new-raw") ?? null;
  const actionSel = root?.querySelector("#rule-new-action") ?? null;
  const layerSel = root?.querySelector("#rule-new-layer") ?? null;
  const preview = root?.querySelector("#rule-new-preview") ?? null;
  if (rawInput === null || actionSel === null || layerSel === null) return;
  const raw = rawInput.value.trim();
  if (raw === "") {
    preview.textContent = "✘ 规则行不能为空";
    return;
  }
  const target = layerSel.value;
  const kind = "rule";
  const content = `${raw} -> ${actionSel.value}`;
  // dryRun 预览（host 归一+重复检测），确认后落盘
  const dry = await sendSettings({ op: "instruction-append", target, kind, content, dryRun: true });
  if (!dry.ok) {
    preview.textContent = `✘ ${dry.error?.message ?? "校验失败"}`;
    return;
  }
  if (dry.result.duplicate === true) {
    preview.textContent = "✘ 目标层已有等价规则行（同规则同动作）——改判请先删旧行";
    return;
  }
  const ok = await confirmDialog(
    `将写入 ${target === "user-rules" ? "~/.aegent/rules.txt" : "<workspace>/.aegent/rules.txt"}：\n${dry.result.line}`,
    { title: "确认追加规则", confirmLabel: "写入" },
  );
  if (!ok) return;
  const saved = await sendSettings({ op: "instruction-append", target, kind, content, dryRun: false });
  if (!saved.ok) {
    toast(`写入失败：${saved.error?.message ?? ""}`, "warn");
    return;
  }
  await refresh();
  toast("规则已写入（新会话生效）", "info");
}

// ---------------------------------------------------------------------------
// D1 从项目生成 AGENTS.md
// ---------------------------------------------------------------------------

/** 组装初始化提示词进对话（agent 起草写入工作区——回来本页核对保存）。 */
function generateProjectAgents() {
  const prompt = [
    "请为本项目起草/改进 AGENTS.md（工作区根）。要求：",
    "1. 先调查：README、根清单文件（package.json/pyproject.toml 等）、构建与测试配置、CI 脚本、既有指令文件（AGENTS.md/CLAUDE.md/.cursorrules）；",
    "2. 只写「不告诉 AI 就会做错」的高信号内容：精确命令、跑单个测试的方式、命令顺序、monorepo 边界、工具链 quirks；",
    "3. 排除泛泛之谈、教程、文件树复述；宁缺毋滥；",
    "4. 若 AGENTS.md 已存在：原地改进（保留既有正确约定）而非整文件重写；",
    "5. 写完报告改动摘要。完成后请到 设置→指令中心 核对保存。",
  ].join("\n");
  const promptInput = document.getElementById("prompt-input");
  if (promptInput === null || !(promptInput instanceof HTMLTextAreaElement)) {
    toast("找不到输入框（请从主界面打开设置）", "warn");
    return;
  }
  promptInput.value = prompt;
  promptInput.dispatchEvent(new Event("input", { bubbles: true }));
  promptInput.focus();
  toast("初始化提示词已填入输入框——回车发送让 agent 起草", "info");
}

// ---------------------------------------------------------------------------
// 挂载与总渲染
// ---------------------------------------------------------------------------

function renderAll() {
  renderTree();
  renderAssembly();
  const isRulesNode = RULE_TARGETS.has(selected);
  const isHost = selected === "host";
  const showEditor = !isHost && (!isRulesNode || rulesTab === "source");
  el("instr-editor-pane").hidden = !showEditor;
  el("instr-rules-pane").hidden = !isRulesNode || rulesTab !== "rules";
  el("instr-host-pane").hidden = !isHost;
  el("instr-tabs").hidden = !isRulesNode;
  if (isRulesNode) {
    el("instr-tab-rules").classList.toggle("active", rulesTab === "rules");
    el("instr-tab-source").classList.toggle("active", rulesTab === "source");
    if (rulesTab === "rules") renderRules();
  }
  if (showEditor) renderEditor();
  if (isHost) renderHostPane();
}

function renderHostPane() {
  const box = el("instr-host-pane");
  if (box === null || view === null) return;
  box.replaceChildren();
  for (const p of view.ruleSets.hostProtections) {
    const row = document.createElement("div");
    row.className = "rule-row";
    row.innerHTML = `<code class="rule-raw"></code><span class="rule-meta"></span>`;
    row.querySelector("code").textContent = `🔒 ${p.name}`;
    row.querySelector(".rule-meta").textContent = p.description;
    box.appendChild(row);
  }
}

function bindOnce() {
  if (el("instr-root")?.dataset.bound === "1") return;
  const root = el("instr-root");
  if (root === null) return;
  root.dataset.bound = "1";
  el("instr-editor-save").addEventListener("click", () => void saveSelected());
  el("instr-editor-text").addEventListener("input", () => {
    dirty.add(selected);
    updateCharCount();
  });
  el("instr-generate").addEventListener("click", generateProjectAgents);
  el("instr-rule-new").addEventListener("click", openRuleDialog);
  el("instr-test-run").addEventListener("click", () => void runTester());
  el("instr-tab-rules").addEventListener("click", () => {
    rulesTab = "rules";
    renderAll();
  });
  el("instr-tab-source").addEventListener("click", () => {
    rulesTab = "source";
    renderAll();
  });
  // 测试器工具下拉的参数占位提示
  el("instr-test-tool").addEventListener("change", (ev) => {
    const tool = ev.target.value;
    el("instr-test-args").placeholder =
      tool === "bash" ? '{"command": "git status"}' : '{"path": "src/a.ts"}';
  });
}

/** 拉数据并全量重渲（打开时/保存后调用）。 */
export async function refresh() {
  const root = el("instr-root");
  if (root === null) return;
  bindOnce();
  try {
    await fetchView();
    el("instr-error").textContent = "";
    renderAll();
  } catch (e) {
    el("instr-error").textContent = `指令面不可用：${e.message}`;
  }
}

export const SECTION_HTML = `
<section data-section="instructions" id="instr-root">
  <div class="section-head"><h2 class="section-title">指令中心</h2></div>
  <p class="hint">「给 AI 的规矩」管理中心——规矩文件层级 + 权限规则 + 记忆 + 生效透明度。左树选节点，右侧编辑或管理规则。</p>
  <p id="instr-error" class="hint error-text"></p>
  <div class="instr-layout">
    <aside class="instr-side">
      <div id="instr-assembly" class="card-box instr-assembly"></div>
      <div id="instr-tree-list" class="instr-tree"></div>
    </aside>
    <div class="instr-main">
      <div id="instr-editor-pane" class="card-box instr-card">
        <div class="instr-head"><span id="instr-editor-title"></span><span id="instr-editor-count" class="hint"></span></div>
        <p class="hint" id="instr-editor-path"></p>
        <p class="hint" id="instr-editor-hint"></p>
        <div id="instr-templates" class="chips-row"></div>
        <textarea id="instr-editor-text" class="textarea mono" rows="14" spellcheck="false"></textarea>
        <div class="form-actions">
          <button id="instr-editor-save" class="btn btn-primary" type="button">保存</button>
          <button id="instr-generate" class="btn" type="button" hidden>从项目生成</button>
        </div>
        <p class="hint" id="instr-editor-effective"></p>
      </div>
      <div id="instr-tabs" class="instr-tabs" hidden>
        <button id="instr-tab-rules" class="btn tab-btn" type="button">规则列表</button>
        <button id="instr-tab-source" class="btn tab-btn" type="button">源码编辑</button>
        <button id="instr-rule-new" class="btn btn-primary tab-btn" type="button">＋ 新建规则</button>
      </div>
      <div id="instr-rules-pane" class="instr-rules-pane" hidden>
        <div id="instr-tester" class="card-box instr-card">
          <div class="instr-head">规则测试器——输入一次真实调用，看三层规则如何裁决</div>
          <div class="tester-row">
            <select id="instr-test-tool" class="input">
              ${COMMON_TOOLS.map((t) => `<option value="${t}">${t}</option>`).join("")}
            </select>
            <input id="instr-test-args" class="input input-wide" placeholder='{"command": "git status"}' />
            <button id="instr-test-run" class="btn btn-primary" type="button">测试</button>
          </div>
          <div id="instr-test-result" class="card-args"></div>
        </div>
        <div id="instr-rules-view"></div>
      </div>
      <div id="instr-host-pane" class="card-box instr-card" hidden>
        <div class="instr-head">宿主内置防护（只读）</div>
      </div>
    </div>
  </div>
</section>
`;
