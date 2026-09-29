/**
 * Agent 能力组（T-P3-135 · UI 批次 B⑤⑥⑧——mcp/skills/subagents/prompts/
 * enhancement/plugins/speech 七分节）：
 * - mcp：36px 图标座 + 包边状态点（绿=已启用/红=最近检测失败/灰=停用）
 *   + 44×24 开关 + 命令行等宽 + transport/工具数 chips（McpServerList 形态；
 *   向导两步保留下沉为分步卡——mcp-check 校验原样）；
 * - skills/subagents/prompts：分组卡片 + 空状态虚线框引导 + 工具数徽标 +
 *   顶部搜索框；
 * - plugins：市场式卡片行（图标座 + 名称/来源 tag + 描述 + 右侧操作组 +
 *   错误行红文本——InstalledPluginsPanel 形态🔴只学行为；安装表单下沉模态）；
 * - enhancement/speech：行式卡。
 * 数据面逻辑原样（op:skills-list/skill-save/subagents-list/plugins-list/
 * mcp-check 增删改与即改即存链全保留）。
 */

import { sendSettings, ensureMetaCache } from "../../api.js";
import { settingsCache, getSessionId } from "../../state.js";
import { appendLine, toast } from "../../feedback.js";
import { icon } from "../../icons.js";
import {
  markDirty,
  dirtySections,
  openDialog,
  confirmDialog,
  rowEl,
  rowCopyEl,
  rowControl,
  btnEl,
  emptyState,
  chipEl,
  switchEl,
} from "./core.js";

export const SECTIONS_HTML = `
<section data-section="mcp">
  <div class="section-head">
    <h2 class="section-title">MCP 服务器</h2>
    <button id="mcp-add" type="button" class="btn btn-primary">添加 server</button>
  </div>
  <div id="mcp-list" class="row-list"></div>
  <div id="mcp-wizard" class="card-box" hidden>
    <div id="mcp-step1">
      <div class="form-grid">
        <label>类型
          <select id="mcp-type" class="select">
            <option value="stdio">stdio（本地命令）</option>
            <option value="http" disabled>http（mcp 域暂未支持——随 HTTP transport 扩展）</option>
          </select>
        </label>
        <label>名称（工具前缀）<input id="mcp-name" class="input" type="text" placeholder="不含 __" autocomplete="off" /></label>
        <label>启动命令<input id="mcp-command" class="input" type="text" placeholder="如 node" autocomplete="off" /></label>
        <label>参数<input id="mcp-args" class="input" type="text" placeholder="空格分隔，如 /path/server.js" autocomplete="off" /></label>
      </div>
      <div class="form-actions"><button id="mcp-next" type="button" class="btn btn-primary">下一步：测连接</button></div>
    </div>
    <div id="mcp-step2" hidden>
      <p id="mcp-check-result" class="hint">未测试</p>
      <div class="form-actions">
        <button id="mcp-test" type="button" class="btn">测连接</button>
        <button id="mcp-save" type="button" class="btn btn-primary" disabled>保存</button>
        <button id="mcp-back" type="button" class="btn btn-ghost">上一步</button>
      </div>
    </div>
  </div>
  <p class="hint">启停即时落档，新会话生效（子进程装配期连接注册；单 server 失败不影响启动）。状态点：绿 = 已启用、红 = 最近一次测连接失败、灰 = 已停用。</p>
</section>
<section data-section="skills">
  <div class="section-head">
    <h2 class="section-title">技能</h2>
    <div class="section-tools">
      <input id="skill-search" class="input input-search" type="text" placeholder="搜索技能…" autocomplete="off" />
      <button id="skill-new" type="button" class="btn btn-primary">新建技能</button>
    </div>
  </div>
  <div id="skill-list" class="row-list"></div>
  <div id="skill-editor" class="card-box" hidden>
    <div class="form-grid">
      <label>技能名（slug）<input id="skill-name" class="input" type="text" placeholder="小写字母数字开头，可含 . - _" autocomplete="off" /></label>
      <label>描述<input id="skill-desc" class="input" type="text" placeholder="清单与系统提示显示用" autocomplete="off" /></label>
    </div>
    <div class="hint">工具集（可选——勾选该技能声明的工作工具）</div>
    <div id="skill-tools" class="chip-picker"></div>
    <textarea id="skill-body" class="textarea" rows="6" placeholder="技能正文（写入 SKILL.md 的 frontmatter 之后——给模型看的操作指引）"></textarea>
    <div class="form-actions">
      <button id="skill-save" type="button" class="btn btn-primary">保存技能</button>
      <button id="skill-cancel" type="button" class="btn btn-ghost">取消</button>
    </div>
  </div>
  <h3 class="group-title">来源目录</h3>
  <div id="skill-roots" class="row-list"></div>
  <form id="skill-root-form" class="form-inline">
    <input id="skill-root-path" class="input" type="text" placeholder="附加技能来源目录（绝对路径）" autocomplete="off" />
    <button type="submit" class="btn">添加来源</button>
  </form>
  <p class="hint">workspace 主目录（.zcode/skills）恒为首个来源；附加目录的技能同样出现在清单。停用 = 从新会话装配剔除（清单/系统提示/skill_load 三面一致）；技能正文上限 128KB。</p>
</section>
<section data-section="subagents">
  <div class="section-head">
    <h2 class="section-title">子智能体</h2>
    <div class="section-tools">
      <input id="subagent-search" class="input input-search" type="text" placeholder="搜索子代理…" autocomplete="off" />
      <button id="subagent-new" type="button" class="btn btn-primary">新建自定义子代理</button>
    </div>
  </div>
  <div id="subagent-list"></div>
  <div id="subagent-editor" class="card-box" hidden>
    <div class="form-grid">
      <label>预设名（slug）<input id="subagent-name" class="input" type="text" placeholder="小写字母数字- _，task 调用标识" autocomplete="off" /></label>
      <label>描述<input id="subagent-desc" class="input" type="text" placeholder="一句话说明" autocomplete="off" /></label>
    </div>
    <textarea id="subagent-prompt" class="textarea" rows="4" placeholder="身份提示（这个子代理是谁、怎么干活——追加进子会话系统提示）"></textarea>
    <div class="hint">工具集（可选——勾选后该预设只能用这些工具）</div>
    <div id="subagent-tools" class="chip-picker"></div>
    <div class="form-grid form-grid-3">
      <label>模型条目<input id="subagent-provider" class="input" type="text" placeholder="（缺省继承父会话）" autocomplete="off" /></label>
      <label>模型 id<input id="subagent-model" class="input" type="text" placeholder="（条目/主模型回退）" autocomplete="off" /></label>
      <label>故障转移候选<input id="subagent-fallbacks" class="input" type="text" placeholder="条目名逗号分隔（J15）" autocomplete="off" /></label>
    </div>
    <div class="form-actions">
      <button id="subagent-save" type="button" class="btn btn-primary">保存预设</button>
      <button id="subagent-cancel" type="button" class="btn btn-ghost">取消</button>
    </div>
  </div>
  <p class="hint">内置预设可在 task 工具中以 subagent_type 调用（如 explorer / code-reviewer）；停用的内置保留在清单里（开关是开回的路径）。工具集 chips = 该预设可用的工具声明面（H3/H5 降级面之上再收窄）。</p>
</section>
<section data-section="prompts">
  <div class="section-head">
    <h2 class="section-title">提示词模板</h2>
    <div class="section-tools">
      <input id="prompt-search" class="input input-search" type="text" placeholder="搜索模板…" autocomplete="off" />
      <button id="prompt-new" type="button" class="btn btn-primary">新建模板</button>
    </div>
  </div>
  <div id="prompt-list" class="row-list"></div>
  <p class="hint">模板在输入区 / 补全中列出（📝），选中即填入输入框；变量占位符保留手改。系统级人格预设（persona）不在此管理。</p>
</section>
<section data-section="enhancement">
  <div class="section-head"><h2 class="section-title">辅助模型</h2></div>
  <p class="hint">判官/摘要等增强任务的模型独立配置（ADR 0121——"哪个模型做辅助工作、带多少推理"）；缺省回退主模型链（任务 model → 条目 model → 默认模型）。</p>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">判官（C42 两阶段复核）·供应商条目</div>
        <div class="row-desc">providers 条目名——未配置时判官落回人</div>
      </div>
      <div class="row-control"><input id="enh-judge-provider" class="input input-wide" type="text" placeholder="（未配置——判官落回人）" autocomplete="off" /></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">判官 · 模型与推理档</div>
        <div class="row-desc">模型 id 留空 = 回退条目/默认模型</div>
      </div>
      <div class="row-control">
        <input id="enh-judge-model" class="input" type="text" placeholder="（回退条目/默认模型）" autocomplete="off" />
        <select id="enh-judge-reasoning" class="select">
          <option value="">（未设置）</option>
          <option value="minimal">minimal</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">摘要（F5 上下文压缩）·供应商条目</div>
        <div class="row-desc">providers 条目名——未配置时用主模型</div>
      </div>
      <div class="row-control"><input id="enh-summarizer-provider" class="input input-wide" type="text" placeholder="（未配置——用主模型）" autocomplete="off" /></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">摘要 · 模型与推理档</div>
        <div class="row-desc">模型 id 留空 = 回退条目/默认模型</div>
      </div>
      <div class="row-control">
        <input id="enh-summarizer-model" class="input" type="text" placeholder="（回退条目/默认模型）" autocomplete="off" />
        <select id="enh-summarizer-reasoning" class="select">
          <option value="">（未设置）</option>
          <option value="minimal">minimal</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </div>
    </div>
  </div>
</section>
<section data-section="plugins">
  <div class="section-head">
    <h2 class="section-title">插件</h2>
    <button id="plugin-add" type="button" class="btn btn-primary">安装插件</button>
  </div>
  <div id="plugin-list" class="row-list"></div>
  <p class="hint">进程内插件目录约定：plugin.json（清单：name/trust/capabilities）+ index.js（入口，default 导出 AegentPlugin）。停用保留在清单；装载失败不影响启动（never-fail）。新会话生效。</p>
</section>
<section data-section="speech">
  <div class="section-head"><h2 class="section-title">语音【实验性】</h2></div>
  <p class="hint">语音转文字（STT）——输入区 🎤 按钮录音后转写填入输入框；真实端点联调随 U8（配置在位即可用）。</p>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">STT 端点根</div>
        <div class="row-desc">OpenAI 协议转写端点（如 https://api.openai.com/v1）</div>
      </div>
      <div class="row-control"><input id="stt-baseurl" class="input input-wide" type="text" placeholder="（未配置——语音输入不可用）" autocomplete="off" /></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">转写模型</div>
        <div class="row-desc">如 whisper-1</div>
      </div>
      <div class="row-control"><input id="stt-model" class="input" type="text" placeholder="如 whisper-1" autocomplete="off" /></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">语言提示（BCP-47 可选）</div>
        <div class="row-desc">如 zh（缺省自动检测）</div>
      </div>
      <div class="row-control"><input id="stt-language" class="input input-num" type="text" placeholder="如 zh" autocomplete="off" /></div>
    </div>
  </div>
  <p class="hint">端点 API key 请在「凭据」分节以 provider 名 <code>stt</code> 录入（零明文，同 U2 通道）。</p>
</section>
`;

// ---------------------------------------------------------------------------
// U17/T-P3-119 MCP 管理向导 + 统一面板（连接校验走 settings op:"mcp-check"）
// ---------------------------------------------------------------------------

let editingMcpName = null;
let mcpWizardEntry = null; // 向导当前编辑的 {name, command, args}
let mcpTestOk = false;
/** 最近一次测连接失败的 server 名（清单状态点红——装配期结果不在清单数据面，记档）。 */
const mcpCheckFailures = new Set();

function mcpIconBadge(name, enabled) {
  const badge = document.createElement("span");
  badge.className = "icon-badge";
  badge.appendChild(icon("plug"));
  const dot = document.createElement("span");
  dot.className = "status-dot";
  const failed = mcpCheckFailures.has(name);
  dot.style.setProperty("--dot-color", !enabled ? "var(--text-subtlest)" : failed ? "var(--destructive)" : "var(--success)");
  dot.title = !enabled ? "已停用" : failed ? "最近一次测连接失败" : "已启用（装配期连接）";
  badge.appendChild(dot);
  return badge;
}

function renderMcpList() {
  const list = document.getElementById("mcp-list");
  if (list === null) return;
  list.replaceChildren();
  const servers = settingsCache?.mcp ?? [];
  if (servers.length === 0) {
    list.appendChild(emptyState("无 MCP server", "点右上「添加 server」走向导（两步：参数 → 测连接）"));
    return;
  }
  for (const s of servers) {
    const row = rowEl();
    const enabled = s.enabled !== false;
    const titleEl = document.createElement("div");
    titleEl.className = "row-title title-btn";
    titleEl.textContent = s.name;
    const descEl = document.createElement("div");
    descEl.className = "row-desc mono";
    descEl.textContent = `${s.command}${(s.args ?? []).length > 0 ? ` ${(s.args ?? []).join(" ")}` : ""}`;
    const copy = rowCopyEl(titleEl, descEl);
    const tools = document.createElement("div");
    tools.className = "row-chips";
    tools.appendChild(chipEl(s.transport === "ws" ? "ws" : "stdio"));
    titleEl.style.cursor = "pointer";
    titleEl.title = "点击编辑该 server";
    titleEl.addEventListener("click", () => {
      editingMcpName = s.name;
      openMcpWizard(s);
    });
    const toggle = switchEl(enabled, (checked) => {
      // 缺省启用（enabled 缺省 true）：停用写 false、启用删字段回缺省
      settingsCache.mcp = (settingsCache.mcp ?? []).map((x) => {
        if (x.name !== s.name) return x;
        if (!checked) return { ...x, enabled: false };
        const { enabled: _omit, ...rest } = x;
        return rest;
      });
      if (!checked) mcpCheckFailures.delete(s.name);
      dirtySections.add("mcp");
      renderMcpList();
      markDirty("mcp");
    }, `启停 MCP server ${s.name}`);
    const delBtn = btnEl("删除", "btn btn-danger");
    delBtn.addEventListener("click", async () => {
      if (!(await confirmDialog(`删除 MCP server「${s.name}」？装载清单将移除该条目。`, { title: "删除 MCP server", confirmLabel: "删除", danger: true }))) return;
      settingsCache.mcp = (settingsCache.mcp ?? []).filter((x) => x.name !== s.name);
      mcpCheckFailures.delete(s.name);
      dirtySections.add("mcp");
      renderMcpList();
      markDirty("mcp");
    });
    row.append(mcpIconBadge(s.name, enabled), copy, rowControl(tools, toggle, delBtn));
    list.appendChild(row);
  }
}

function openMcpWizard(entry) {
  mcpWizardEntry = entry ?? null;
  mcpTestOk = false;
  document.getElementById("mcp-wizard").hidden = false;
  document.getElementById("mcp-step1").hidden = false;
  document.getElementById("mcp-step2").hidden = true;
  document.getElementById("mcp-save").disabled = true;
  document.getElementById("mcp-check-result").textContent = "未测试";
  document.getElementById("mcp-name").value = entry?.name ?? "";
  document.getElementById("mcp-command").value = entry?.command ?? "";
  document.getElementById("mcp-args").value = (entry?.args ?? []).join(" ");
  document.getElementById("mcp-wizard").scrollIntoView({ block: "nearest" });
}

// ---------------------------------------------------------------------------
// U22/T-P3-125 技能管理：清单（多根扫描 + 停用开关 + 搜索）+ 编辑器写回
// ---------------------------------------------------------------------------

/** 技能清单缓存（open 时刷新——文件系统面，不与会话期缓存混用）。 */
let skillsView = null;
let editingSkillName = null; // 非 null = 编辑器在改既有技能（同名覆盖）
const skillToolsSelected = new Set();
let skillFilter = "";

function skillMatches(s) {
  if (skillFilter === "") return true;
  const q = skillFilter.toLowerCase();
  return s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q);
}

async function refreshSkillsList() {
  const envelope = await sendSettings({ op: "skills-list" });
  const list = document.getElementById("skill-list");
  if (list === null) return; // 视图已卸载（异步回包晚于导航——静默丢弃）
  list.replaceChildren();
  if (!envelope.ok) {
    list.appendChild(emptyState("技能清单不可用", envelope.error?.message ?? ""));
    return;
  }
  skillsView = envelope.result;
  const visible = skillsView.skills.filter(skillMatches);
  if (visible.length === 0) {
    list.appendChild(
      skillsView.skills.length === 0
        ? emptyState("无技能", "点右上「新建技能」，或在 workspace/.zcode/skills 下放 SKILL.md 自动发现")
        : emptyState("无匹配技能", `没有名称/描述含「${skillFilter}」的技能`),
    );
  }
  for (const s of visible) {
    const row = rowEl();
    const disabled = skillsView.disabled.includes(s.name);
    const badge = document.createElement("span");
    badge.className = "icon-badge";
    badge.appendChild(icon("sparkles"));
    const titleEl = document.createElement("div");
    titleEl.className = "row-title";
    titleEl.textContent = s.name;
    const isWorkspace = s.origin === skillsView.roots[0];
    if (!isWorkspace) titleEl.appendChild(chipEl("外部来源"));
    if (disabled) titleEl.appendChild(chipEl("已停用"));
    const descEl = document.createElement("div");
    descEl.className = "row-desc";
    descEl.textContent = s.description;
    const copy = rowCopyEl(titleEl, descEl);
    // 工具集 chips（技能声明的工具集——清单元数据展示）
    const toolsRow = document.createElement("div");
    toolsRow.className = "row-chips";
    for (const t of s.tools ?? []) toolsRow.appendChild(chipEl(t));
    const toggle = switchEl(!disabled, (checked) => {
      const cur = new Set(settingsCache.skills?.disabled ?? []);
      if (checked) cur.delete(s.name);
      else cur.add(s.name);
      settingsCache.skills = { ...(settingsCache.skills ?? {}), ...(cur.size > 0 ? { disabled: [...cur] } : {}) };
      dirtySections.add("skills");
      markDirty("skills");
      void refreshSkillsList();
    }, `启停技能 ${s.name}`);
    const editBtn = btnEl("编辑", "btn", "打开技能编辑器（写回 SKILL.md）");
    editBtn.addEventListener("click", () => {
      void openSkillEditor(s);
    });
    row.append(badge, copy, rowControl(toolsRow, toggle, editBtn));
    list.appendChild(row);
  }
  for (const d of skillsView.diagnostics) {
    const row = rowEl();
    const warnEl = document.createElement("div");
    warnEl.className = "row-copy";
    const t = document.createElement("div");
    t.className = "row-desc error-text";
    t.textContent = `诊断 [${d.code}] ${d.path}——${d.message}`;
    warnEl.appendChild(t);
    row.append(warnEl);
    list.appendChild(row);
  }
}

function renderSkillRoots() {
  const list = document.getElementById("skill-roots");
  if (list === null) return;
  list.replaceChildren();
  const roots = settingsCache?.skills?.roots ?? [];
  if (roots.length === 0) {
    list.appendChild(emptyState("无附加来源", "workspace 主目录恒在——附加目录的技能同样自动发现"));
    return;
  }
  for (const r of roots) {
    const row = rowEl();
    const descEl = document.createElement("div");
    descEl.className = "row-desc mono";
    descEl.textContent = r;
    const delBtn = btnEl("删除", "btn btn-danger");
    delBtn.addEventListener("click", () => {
      settingsCache.skills = {
        ...(settingsCache.skills ?? {}),
        roots: roots.filter((x) => x !== r),
      };
      if ((settingsCache.skills.roots ?? []).length === 0) delete settingsCache.skills.roots;
      dirtySections.add("skills");
      renderSkillRoots();
      markDirty("skills");
      void refreshSkillsList();
    });
    row.append(descEl, rowControl(delBtn));
    list.appendChild(row);
  }
}

async function openSkillEditor(skill) {
  editingSkillName = skill?.name ?? null;
  skillToolsSelected.clear();
  // 工具集候选 = ready 协议的注册表工具名（meta 会话期缓存——无会话时为空）
  const meta = (await ensureMetaCache(getSessionId())) ?? { tools: [], skills: [] };
  const box = document.getElementById("skill-tools");
  if (box === null) return;
  box.replaceChildren();
  for (const t of meta.tools) {
    const chip = document.createElement("button");
    chip.type = "button";
    const selected = skill?.tools?.includes(t) ?? false;
    if (selected) skillToolsSelected.add(t);
    chip.className = selected ? "chip-ui active" : "chip-ui";
    chip.textContent = t;
    chip.addEventListener("click", () => {
      if (skillToolsSelected.has(t)) {
        skillToolsSelected.delete(t);
        chip.classList.remove("active");
      } else {
        skillToolsSelected.add(t);
        chip.classList.add("active");
      }
    });
    box.appendChild(chip);
  }
  document.getElementById("skill-name").value = skill?.name ?? "";
  document.getElementById("skill-desc").value = skill?.description ?? "";
  document.getElementById("skill-body").value = skill?.body ?? "";
  document.getElementById("skill-editor").hidden = false;
  document.getElementById("skill-new").hidden = true;
}

// ---------------------------------------------------------------------------
// U23/T-P3-126 子智能体管理：内置/自定义分组卡（开关/工具徽标/搜索）+ CRUD
// ---------------------------------------------------------------------------

let subagentsView = null; // subagents-list 缓存（open 时刷新）
let editingSubagentName = null; // 非 null = 编辑既有条目（同名覆盖）
const subagentToolsSelected = new Set();
let subagentFilter = "";

function subagentMatches(d) {
  if (subagentFilter === "") return true;
  const q = subagentFilter.toLowerCase();
  return (
    d.name.toLowerCase().includes(q) ||
    (d.description ?? "").toLowerCase().includes(q)
  );
}

/** 分组块（组标题 + 行卡容器）。 */
function groupBlock(title, hintBadge) {
  const wrap = document.createElement("div");
  wrap.className = "subagent-group";
  const head = document.createElement("div");
  head.className = "group-title";
  head.textContent = title;
  if (hintBadge !== undefined) {
    const b = document.createElement("span");
    b.className = "badge";
    b.textContent = hintBadge;
    head.appendChild(b);
  }
  const list = document.createElement("div");
  list.className = "row-list";
  wrap.append(head, list);
  return { wrap, list };
}

function subagentRow(d, opts) {
  const row = rowEl();
  const badge = document.createElement("span");
  badge.className = "icon-badge";
  badge.appendChild(icon("bot"));
  const titleEl = document.createElement("div");
  titleEl.className = "row-title";
  titleEl.textContent = d.name;
  const descEl = document.createElement("div");
  descEl.className = "row-desc";
  const extra =
    opts.kindLabel +
    (d.modelProvider ? `［模型 ${d.modelProvider}${d.model ? `/${d.model}` : ""}］` : "");
  descEl.textContent = `${d.description ?? ""}${extra}`;
  const copy = rowCopyEl(titleEl, descEl);
  // 工具数徽标（声明面收窄的可见性——H3/H5 降级面之上再收窄）
  const toolsRow = document.createElement("div");
  toolsRow.className = "row-chips";
  if ((d.tools ?? []).length > 0) {
    toolsRow.appendChild(chipEl(`${d.tools.length} 工具`));
  }
  const control = [];
  if (opts.toggle !== undefined) control.push(opts.toggle);
  const editBtn = btnEl("编辑", "btn");
  editBtn.addEventListener("click", opts.onEdit);
  control.push(editBtn);
  if (opts.onDelete !== undefined) {
    const delBtn = btnEl("删除", "btn btn-danger");
    delBtn.addEventListener("click", opts.onDelete);
    control.push(delBtn);
  }
  row.append(badge, copy, rowControl(toolsRow, ...control));
  return row;
}

function renderSubagentList() {
  const list = document.getElementById("subagent-list");
  if (list === null) return;
  list.replaceChildren();
  if (subagentsView === null) return;
  const builtins = subagentsView.builtins.filter(subagentMatches);
  const customs = subagentsView.custom.filter(subagentMatches);
  if (builtins.length === 0 && customs.length === 0) {
    list.appendChild(
      emptyState(
        subagentsView.builtins.length === 0 ? "无子代理" : "无匹配子代理",
        subagentsView.builtins.length === 0
          ? "五内置预设装配面在位——右上新建自定义子代理"
          : `没有名称/描述含「${subagentFilter}」的子代理`,
      ),
    );
    return;
  }
  const builtinGroup = groupBlock("内置预设", `${builtins.length}`);
  for (const b of builtins) {
    const toggle = switchEl(b.enabled, (checked) => {
      // 停用 = 写同名覆盖记录（enabled:false——最简形状）；启用 = 移除记录
      const defs = (settingsCache.subagents ?? []).filter((d) => d.name !== b.name);
      if (!checked) defs.push({ name: b.name, enabled: false });
      settingsCache.subagents = defs;
      dirtySections.add("subagents");
      markDirty("subagents");
      void refreshSubagentsList();
    }, `启停内置预设 ${b.name}`);
    builtinGroup.list.appendChild(
      subagentRow(b, {
        kindLabel: b.overridden ? "（内置·已自定义覆盖）" : "（内置）",
        toggle,
        onEdit: () => openSubagentEditor(b, true),
      }),
    );
  }
  const customGroup = groupBlock("自定义", `${customs.length}`);
  for (const c of customs) {
    customGroup.list.appendChild(
      subagentRow(c, {
        kindLabel: "（自定义）",
        onEdit: () => openSubagentEditor(c, false),
        onDelete: async () => {
          if (!(await confirmDialog(`删除自定义子代理「${c.name}」？task 调用将不再可用。`, { title: "删除子代理", confirmLabel: "删除", danger: true }))) return;
          settingsCache.subagents = (settingsCache.subagents ?? []).filter((d) => d.name !== c.name);
          dirtySections.add("subagents");
          markDirty("subagents");
          void refreshSubagentsList();
        },
      }),
    );
  }
  list.append(builtinGroup.wrap, customGroup.wrap);
}

async function refreshSubagentsList() {
  const envelope = await sendSettings({ op: "subagents-list" });
  const list = document.getElementById("subagent-list");
  if (list === null) return;
  if (!envelope.ok) {
    list.replaceChildren();
    list.appendChild(emptyState("子代理清单不可用", envelope.error?.message ?? ""));
    return;
  }
  subagentsView = envelope.result;
  renderSubagentList();
}

async function openSubagentEditor(def, isBuiltin) {
  editingSubagentName = def.name;
  subagentToolsSelected.clear();
  const meta = (await ensureMetaCache(getSessionId())) ?? { tools: [], skills: [] };
  const box = document.getElementById("subagent-tools");
  if (box === null) return;
  box.replaceChildren();
  for (const t of meta.tools) {
    const chip = document.createElement("button");
    chip.type = "button";
    const selected = def.tools?.includes(t) ?? false;
    if (selected) subagentToolsSelected.add(t);
    chip.className = selected ? "chip-ui active" : "chip-ui";
    chip.textContent = t;
    chip.addEventListener("click", () => {
      if (subagentToolsSelected.has(t)) {
        subagentToolsSelected.delete(t);
        chip.classList.remove("active");
      } else {
        subagentToolsSelected.add(t);
        chip.classList.add("active");
      }
    });
    box.appendChild(chip);
  }
  document.getElementById("subagent-name").value = def.name ?? "";
  document.getElementById("subagent-desc").value = def.description ?? "";
  document.getElementById("subagent-prompt").value = def.prompt ?? "";
  document.getElementById("subagent-provider").value = def.modelProvider ?? "";
  document.getElementById("subagent-model").value = def.model ?? "";
  document.getElementById("subagent-fallbacks").value = (def.fallbacks ?? []).join(", ");
  document.getElementById("subagent-editor").hidden = false;
  document.getElementById("subagent-new").hidden = true;
  document.getElementById("subagent-editor").scrollIntoView({ block: "nearest" });
}

// ---------------------------------------------------------------------------
// U16/T-P3-118 提示词模板库（settings prompts 段整段替换——upsert 同名原位
// 替换）+ 顶部搜索 + 空状态引导；新增/编辑下沉模态（prompt-form 随模态）
// ---------------------------------------------------------------------------

let editingPromptName = null;
let promptFilter = "";

function renderPromptList() {
  const list = document.getElementById("prompt-list");
  if (list === null) return;
  list.replaceChildren();
  const prompts = settingsCache?.prompts ?? [];
  const visible = prompts.filter((p) => {
    if (promptFilter === "") return true;
    const q = promptFilter.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.description ?? "").toLowerCase().includes(q) ||
      p.content.toLowerCase().includes(q)
    );
  });
  if (visible.length === 0) {
    list.appendChild(
      prompts.length === 0
        ? emptyState("提示词库为空", "点右上「新建模板」建档——输入区 / 补全即可调用")
        : emptyState("无匹配模板", `没有含「${promptFilter}」的模板`),
    );
    return;
  }
  for (const p of visible) {
    const row = rowEl();
    const titleEl = document.createElement("div");
    titleEl.className = "row-title title-btn";
    titleEl.textContent = p.name;
    const descEl = document.createElement("div");
    descEl.className = "row-desc clamp-2";
    descEl.textContent = `${p.description ? `${p.description}——` : ""}${p.content}`;
    row.append(rowCopyEl(titleEl, descEl));
    const editBtn = btnEl("编辑", "btn", "点击编辑该模板");
    editBtn.addEventListener("click", () => openPromptDialog(p));
    const delBtn = btnEl("删除", "btn btn-danger");
    delBtn.addEventListener("click", async () => {
      if (!(await confirmDialog(`删除提示词模板「${p.name}」？/ 补全中将不再出现。`, { title: "删除模板", confirmLabel: "删除", danger: true }))) return;
      settingsCache.prompts = (settingsCache.prompts ?? []).filter((x) => x.name !== p.name);
      if (editingPromptName === p.name) editingPromptName = null;
      dirtySections.add("prompts");
      renderPromptList();
      markDirty("prompts");
    });
    row.append(rowControl(editBtn, delBtn));
    list.appendChild(row);
    titleEl.title = "点击编辑该模板";
    titleEl.addEventListener("click", () => openPromptDialog(p));
  }
}

function openPromptDialog(p) {
  editingPromptName = p?.name ?? null;
  const holder = document.createElement("div");
  holder.innerHTML = `
  <form id="prompt-form">
    <div class="form-grid">
      <label>模板名（斜杠调用标识）<input id="prompt-name" class="input" type="text" placeholder="如 review" autocomplete="off" /></label>
      <label>描述（可选）<input id="prompt-desc" class="input" type="text" placeholder="清单显示用" autocomplete="off" /></label>
    </div>
    <textarea id="prompt-content" class="textarea" rows="5" placeholder="模板正文（{{var}} 为变量占位符）"></textarea>
  </form>`;
  const form = holder.firstElementChild;
  if (p !== undefined) {
    form.querySelector("#prompt-name").value = p.name;
    form.querySelector("#prompt-desc").value = p.description ?? "";
    form.querySelector("#prompt-content").value = p.content;
  }
  openDialog({
    title: p !== undefined ? `编辑模板：${p.name}` : "新建提示词模板",
    description: "模板名即输入区 / 补全的调用标识；正文 {{var}} 为变量占位符（选中后保留手改）。",
    width: "md",
    body: form,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      { label: "保存", className: "btn btn-primary", onClick: () => savePromptFromDialog() },
    ],
  });
}

function savePromptFromDialog() {
  const name = document.getElementById("prompt-name").value.trim();
  const desc = document.getElementById("prompt-desc").value.trim();
  const content = document.getElementById("prompt-content").value;
  if (name === "" || content.trim() === "") {
    toast("模板名与正文必填", "warn");
    return;
  }
  const prompts = (settingsCache.prompts ?? []).filter((x) => x.name !== name);
  prompts.push({ name, content, ...(desc !== "" ? { description: desc } : {}) });
  settingsCache.prompts = prompts;
  editingPromptName = null;
  dirtySections.add("prompts");
  renderPromptList();
  markDirty("prompts");
  toast("模板已保存（/ 补全可调用）", "info");
}

// ---------------------------------------------------------------------------
// U18/T-P3-120 辅助模型三字段即改即存（enhancement 段整段合并——两任务互不覆盖）
// ---------------------------------------------------------------------------

function enhancementInputHandler(prefix, taskName, field) {
  document.getElementById(`${prefix}-${field}`).addEventListener("change", () => {
    const cur = settingsCache.enhancement?.[taskName] ?? {};
    const provider = document.getElementById(`${prefix}-provider`).value.trim();
    const model = document.getElementById(`${prefix}-model`).value.trim();
    const reasoning = document.getElementById(`${prefix}-reasoning`).value;
    const next = {};
    if (provider !== "") next.provider = provider;
    if (model !== "") next.model = model;
    if (reasoning !== "") next.reasoning = reasoning;
    settingsCache.enhancement = {
      ...(settingsCache.enhancement ?? {}),
      ...(Object.keys(next).length > 0 ? { [taskName]: next } : {}),
    };
    // 空配置 = 删除该任务条目（回退主模型链）
    if (Object.keys(next).length === 0) {
      const rest = { ...(settingsCache.enhancement ?? {}) };
      delete rest[taskName];
      settingsCache.enhancement = Object.keys(rest).length > 0 ? rest : undefined;
    }
    dirtySections.add("enhancement");
    markDirty("enhancement");
  });
}

// ---------------------------------------------------------------------------
// U26/T-P3-129 语音设置（实验性）：STT 配置即改即存（录音链在入口
// app.js——Composer 域）；空配置 = 删除 stt 段（回退缺省）
// ---------------------------------------------------------------------------

function sttInputHandler(field) {
  document.getElementById(`stt-${field}`).addEventListener("change", () => {
    const baseUrl = document.getElementById("stt-baseurl").value.trim();
    const model = document.getElementById("stt-model").value.trim();
    const language = document.getElementById("stt-language").value.trim();
    const next = {};
    if (baseUrl !== "") next.baseUrl = baseUrl;
    if (model !== "") next.model = model;
    if (language !== "") next.language = language;
    if (Object.keys(next).length < 2) {
      settingsCache.stt = undefined;
      delete settingsCache.stt;
    } else {
      settingsCache.stt = next;
    }
    dirtySections.add("stt");
    markDirty("stt");
  });
}

// ---------------------------------------------------------------------------
// T-P3-133 插件管理：市场式卡片行 + 安装模态（inprocess 目录 / ws URL）
// ---------------------------------------------------------------------------

async function refreshPluginsList() {
  const envelope = await sendSettings({ op: "plugins-list" });
  const list = document.getElementById("plugin-list");
  if (list === null) return;
  list.replaceChildren();
  if (!envelope.ok) {
    list.appendChild(emptyState("插件清单不可用", envelope.error?.message ?? ""));
    return;
  }
  const plugins = envelope.result;
  if (plugins.length === 0) {
    list.appendChild(emptyState("未安装插件", "点右上「安装插件」——进程内目录或进程外 ws URL（先校验）"));
    return;
  }
  for (const p of plugins) {
    const row = rowEl();
    const badge = document.createElement("span");
    badge.className = "icon-badge";
    badge.appendChild(icon("plug"));
    const titleEl = document.createElement("div");
    titleEl.className = "row-title";
    titleEl.textContent = p.name;
    titleEl.appendChild(chipEl(p.transport === "ws" ? "进程外 ws" : "进程内"));
    if (p.manifest) titleEl.appendChild(chipEl(`trust: ${p.manifest.trust}`));
    if (!p.enabled) titleEl.appendChild(chipEl("已停用"));
    const descEl = document.createElement("div");
    descEl.className = "row-desc clamp-2";
    descEl.textContent = p.error !== undefined ? `⚠ ${p.error}` : `→ ${p.source}`;
    if (p.error !== undefined) descEl.classList.add("error-text"); // 错误行红文本
    const copy = rowCopyEl(titleEl, descEl);
    const capsRow = document.createElement("div");
    capsRow.className = "row-chips";
    if (p.error === undefined && p.manifest) {
      for (const c of p.manifest.capabilities ?? []) capsRow.appendChild(chipEl(c));
    }
    const toggle = switchEl(p.enabled, (checked) => {
      // 停用写 enabled:false、启用删键回缺省（mcp 启停同模式）
      const defs = (settingsCache.plugins ?? []).map((d) => {
        if (d.name !== p.name) return d;
        if (checked) {
          const { enabled: _omit, ...rest } = d;
          return rest;
        }
        return { ...d, enabled: false };
      });
      settingsCache.plugins = defs;
      dirtySections.add("plugins");
      markDirty("plugins");
      void refreshPluginsList();
    }, `启停插件 ${p.name}`);
    const delBtn = btnEl("删除", "btn btn-danger", "从装载清单移除（不删除插件目录文件）");
    delBtn.addEventListener("click", async () => {
      if (!(await confirmDialog(`从装载清单移除插件「${p.name}」？（不删除插件目录文件）`, { title: "移除插件", confirmLabel: "移除", danger: true }))) return;
      settingsCache.plugins = (settingsCache.plugins ?? []).filter((d) => d.name !== p.name);
      dirtySections.add("plugins");
      markDirty("plugins");
      void refreshPluginsList();
    });
    row.append(badge, copy, rowControl(capsRow, toggle, delBtn));
    list.appendChild(row);
  }
}

function openPluginInstallDialog() {
  const holder = document.createElement("div");
  holder.innerHTML = `
  <form id="plugin-form">
    <div class="form-grid">
      <label>装载方式
        <select id="plugin-transport" class="select">
          <option value="inprocess">进程内（目录：plugin.json + index.js）</option>
          <option value="ws">进程外（ws:// URL——I4 不可信隔离）</option>
        </select>
      </label>
      <label>插件名<input id="plugin-name" class="input" type="text" placeholder="唯一，不含 __" autocomplete="off" /></label>
      <label>装载源<input id="plugin-source" class="input" type="text" placeholder="目录绝对路径 或 ws://…" autocomplete="off" /></label>
    </div>
    <label class="check-line"><input id="plugin-allowtools" type="checkbox" /> ws 插件工具登记（不受信来源默认 deny——显式放行才登记工具）</label>
  </form>`;
  const form = holder.firstElementChild;
  openDialog({
    title: "安装插件（先校验）",
    description: "进程内 = 本地目录（plugin.json + index.js，受信面）；ws = 进程外不可信隔离（I4，工具登记默认 deny）。",
    width: "md",
    body: form,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      { label: "安装", className: "btn btn-primary", onClick: () => void installPluginFromDialog() },
    ],
  });
}

async function installPluginFromDialog() {
  const name = document.getElementById("plugin-name").value.trim();
  const source = document.getElementById("plugin-source").value.trim();
  const transport = document.getElementById("plugin-transport").value;
  const allowTools = document.getElementById("plugin-allowtools").checked;
  if (name === "" || source === "" || name.includes("__")) {
    toast("插件名（不含 __）与装载源必填", "warn");
    return;
  }
  // 安装先校验（I9 安装期全量——plugins-list 拉取后核对重名与形状）
  const preview = await sendSettings({ op: "plugins-list" });
  const existing = (settingsCache.plugins ?? []).find((d) => d.name === name);
  if (existing !== undefined && existing.enabled !== false) {
    toast(`插件名已存在：${name}`, "warn");
    return;
  }
  // 先落档（settings patch）——装载期再校验（never-fail），诊断随清单可见
  const defs = (settingsCache.plugins ?? []).filter((d) => d.name !== name);
  defs.push({
    name,
    source,
    ...(transport !== "inprocess" ? { transport } : {}),
    ...(allowTools ? { allowTools: true } : {}),
  });
  settingsCache.plugins = defs;
  dirtySections.add("plugins");
  markDirty("plugins");
  toast(`插件已加入装载清单：${name}（新会话生效）`, "info");
  void refreshPluginsList();
  void preview;
}

// ---------------------------------------------------------------------------
// 挂载 / 回填
// ---------------------------------------------------------------------------

export function bind() {
  document.getElementById("mcp-add").addEventListener("click", () => {
    editingMcpName = null;
    openMcpWizard(null);
  });
  document.getElementById("mcp-next").addEventListener("click", () => {
    const name = document.getElementById("mcp-name").value.trim();
    const command = document.getElementById("mcp-command").value.trim();
    const args = document.getElementById("mcp-args").value.trim().split(/\s+/).filter((a) => a !== "");
    if (name === "" || name.includes("__") || command === "") {
      toast("名称（不含 __）与启动命令必填", "warn");
      return;
    }
    mcpWizardEntry = { name, command, ...(args.length > 0 ? { args } : {}) };
    document.getElementById("mcp-step1").hidden = true;
    document.getElementById("mcp-step2").hidden = false;
  });
  document.getElementById("mcp-back").addEventListener("click", () => {
    document.getElementById("mcp-step2").hidden = true;
    document.getElementById("mcp-step1").hidden = false;
  });
  document.getElementById("mcp-test").addEventListener("click", () => {
    if (mcpWizardEntry === null) return;
    const resultEl = document.getElementById("mcp-check-result");
    resultEl.textContent = "测试中…（最长 8 秒）";
    void sendSettings({
      op: "mcp-check",
      name: mcpWizardEntry.name,
      command: mcpWizardEntry.command,
      ...(mcpWizardEntry.args !== undefined ? { args: mcpWizardEntry.args } : {}),
    }).then((envelope) => {
      if (resultEl.isConnected === false) return; // 视图已卸载
      if (!envelope.ok) {
        resultEl.textContent = `校验不可用：${envelope.error?.message ?? ""}`;
        return;
      }
      const check = envelope.result.check;
      if (check.ok) {
        mcpTestOk = true;
        mcpCheckFailures.delete(mcpWizardEntry.name);
        document.getElementById("mcp-save").disabled = false;
        resultEl.textContent = `✔ 连接成功（协议 ${check.protocolVersion}，${(check.tools ?? []).length} 个工具）`;
      } else {
        mcpCheckFailures.add(mcpWizardEntry.name);
        resultEl.textContent = `✘ 连接失败：${check.error?.message ?? ""}`;
      }
      renderMcpList(); // 状态点随检测结果刷新
    });
  });
  document.getElementById("mcp-save").addEventListener("click", () => {
    if (mcpWizardEntry === null || !mcpTestOk) return;
    // 重名校验（对其他条目——本条目编辑改名时以 editingMcpName 排除自身）
    const conflict = (settingsCache.mcp ?? []).some(
      (x) => x.name === mcpWizardEntry.name && x.name !== editingMcpName,
    );
    if (conflict) {
      toast("server 名已存在", "warn");
      return;
    }
    let list = (settingsCache.mcp ?? []).filter(
      (x) => x.name !== mcpWizardEntry.name && x.name !== editingMcpName,
    );
    list.push(mcpWizardEntry);
    settingsCache.mcp = list;
    editingMcpName = null;
    document.getElementById("mcp-wizard").hidden = true;
    dirtySections.add("mcp");
    renderMcpList();
    markDirty("mcp");
  });

  document.getElementById("skill-search").addEventListener("input", (ev) => {
    skillFilter = ev.target.value.trim();
    void refreshSkillsList();
  });
  document.getElementById("skill-new").addEventListener("click", () => {
    void openSkillEditor(null);
  });
  document.getElementById("skill-cancel").addEventListener("click", () => {
    document.getElementById("skill-editor").hidden = true;
    document.getElementById("skill-new").hidden = false;
    editingSkillName = null;
  });
  document.getElementById("skill-save").addEventListener("click", async () => {
    const name = document.getElementById("skill-name").value.trim();
    const description = document.getElementById("skill-desc").value.trim();
    const body = document.getElementById("skill-body").value;
    if (name === "" || description === "" || body.trim() === "") {
      toast("技能名、描述与正文必填", "warn");
      return;
    }
    const envelope = await sendSettings({
      op: "skill-save",
      skill: {
        name,
        description,
        body,
        ...(skillToolsSelected.size > 0 ? { tools: [...skillToolsSelected] } : {}),
      },
    });
    if (!envelope.ok) {
      appendLine(`技能保存失败：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
      return;
    }
    // 改名保存 = 旧名技能不再被停用名单管着（名单按名匹配——同步清理）
    if (editingSkillName !== null && editingSkillName !== name) {
      const cur = (settingsCache.skills?.disabled ?? []).filter((x) => x !== editingSkillName);
      settingsCache.skills = { ...(settingsCache.skills ?? {}), ...(cur.length > 0 ? { disabled: cur } : {}) };
      if (cur.length === 0) delete settingsCache.skills.disabled;
      dirtySections.add("skills");
      markDirty("skills");
    }
    const editor = document.getElementById("skill-editor");
    if (editor === null) return; // 保存回包晚于导航——缓存已写，无需 UI 收尾
    editor.hidden = true;
    document.getElementById("skill-new").hidden = false;
    editingSkillName = null;
    appendLine(`技能已保存：${name}（新会话装配生效）`, "meta");
    toast("技能已保存", "info");
    void refreshSkillsList();
  });
  document.getElementById("skill-root-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const p = document.getElementById("skill-root-path").value.trim();
    if (p === "") return;
    const roots = settingsCache.skills?.roots ?? [];
    if (roots.includes(p)) {
      toast("该来源目录已在清单", "warn");
      return;
    }
    settingsCache.skills = { ...(settingsCache.skills ?? {}), roots: [...roots, p] };
    document.getElementById("skill-root-path").value = "";
    dirtySections.add("skills");
    renderSkillRoots();
    markDirty("skills");
    void refreshSkillsList();
  });

  document.getElementById("subagent-search").addEventListener("input", (ev) => {
    subagentFilter = ev.target.value.trim();
    renderSubagentList();
  });
  document.getElementById("subagent-new").addEventListener("click", () => {
    openSubagentEditor({ name: "", description: "", prompt: "" }, false);
  });
  document.getElementById("subagent-cancel").addEventListener("click", () => {
    document.getElementById("subagent-editor").hidden = true;
    document.getElementById("subagent-new").hidden = false;
    editingSubagentName = null;
  });
  document.getElementById("subagent-save").addEventListener("click", () => {
    const name = document.getElementById("subagent-name").value.trim();
    const description = document.getElementById("subagent-desc").value.trim();
    const prompt = document.getElementById("subagent-prompt").value;
    const provider = document.getElementById("subagent-provider").value.trim();
    const model = document.getElementById("subagent-model").value.trim();
    const fallbacks = document.getElementById("subagent-fallbacks").value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    if (name === "" || description === "" || prompt.trim() === "") {
      toast("预设名、描述与身份提示必填", "warn");
      return;
    }
    const entry = {
      name,
      description,
      prompt,
      ...(subagentToolsSelected.size > 0 ? { tools: [...subagentToolsSelected] } : {}),
      ...(provider !== "" ? { modelProvider: provider } : {}),
      ...(model !== "" ? { model } : {}),
      ...(fallbacks.length > 0 ? { fallbacks } : {}),
    };
    const defs = (settingsCache.subagents ?? []).filter(
      (d) => d.name !== name && d.name !== editingSubagentName,
    );
    defs.push(entry);
    settingsCache.subagents = defs;
    document.getElementById("subagent-editor").hidden = true;
    document.getElementById("subagent-new").hidden = false;
    editingSubagentName = null;
    dirtySections.add("subagents");
    markDirty("subagents");
    toast("子代理预设已保存（新会话生效）", "info");
    void refreshSubagentsList();
  });

  document.getElementById("prompt-search").addEventListener("input", (ev) => {
    promptFilter = ev.target.value.trim();
    renderPromptList();
  });
  document.getElementById("prompt-new").addEventListener("click", () => openPromptDialog(undefined));

  enhancementInputHandler("enh-judge", "judge", "provider");
  enhancementInputHandler("enh-judge", "judge", "model");
  enhancementInputHandler("enh-judge", "judge", "reasoning");
  enhancementInputHandler("enh-summarizer", "summarizer", "provider");
  enhancementInputHandler("enh-summarizer", "summarizer", "model");
  enhancementInputHandler("enh-summarizer", "summarizer", "reasoning");
  sttInputHandler("baseurl");
  sttInputHandler("model");
  sttInputHandler("language");

  document.getElementById("plugin-add").addEventListener("click", () => openPluginInstallDialog());
}

export function fill() {
  // U18/T-P3-120：辅助模型分节回填（缺省回退主模型链——空输入 = 未配置）
  const task = (name) => settingsCache?.enhancement?.[name] ?? {};
  document.getElementById("enh-judge-provider").value = task("judge").provider ?? "";
  document.getElementById("enh-judge-model").value = task("judge").model ?? "";
  document.getElementById("enh-judge-reasoning").value = task("judge").reasoning ?? "";
  document.getElementById("enh-summarizer-provider").value = task("summarizer").provider ?? "";
  document.getElementById("enh-summarizer-model").value = task("summarizer").model ?? "";
  document.getElementById("enh-summarizer-reasoning").value = task("summarizer").reasoning ?? "";
  // U26/T-P3-129：STT 分节回填（空输入 = 未配置——语音输入不可用）
  document.getElementById("stt-baseurl").value = settingsCache?.stt?.baseUrl ?? "";
  document.getElementById("stt-model").value = settingsCache?.stt?.model ?? "";
  document.getElementById("stt-language").value = settingsCache?.stt?.language ?? "";
  renderMcpList();
  renderPromptList();
  renderSkillRoots();
}

/** 打开时异步清单刷新（壳 open 委派——文件系统面每次打开刷新）。 */
export function refreshLists() {
  void refreshSkillsList(); // U22：技能清单（文件系统面——每次打开刷新）
  void refreshSubagentsList(); // U23：子代理清单（内置+自定义——每次打开刷新）
  void refreshPluginsList(); // T-P3-133：插件清单（安装期校验诊断——每次打开刷新）
}
