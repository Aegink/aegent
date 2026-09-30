/**
 * Agent 能力组（T-P3-135 · UI 批次 B⑤⑥⑧——mcp/skills/subagents/prompts/
 * enhancement/plugins/speech 七分节）：
 * - mcp（T-P3-143 v2）：36px 图标座 + 四态状态点（绿=测过成功/红=测过失败/
 *   灰=停用/无点=启用未测）+ 44×24 开关 + 命令行等宽 + transport/工具数/
 *   含 env/导入来源 chips + 行级「测试」（真握手）+ 双形式向导（表单 | JSON
 *   三形状粘贴——zcode McpServerForm 同构）+ 外部配置导入模态（zcode
 *   ExternalAgentImportDialog 行为锚：全选/计数/刷新/重名跳过）；
 * - skills/subagents/prompts：分组卡片 + 空状态虚线框引导 + 工具数徽标 +
 *   顶部搜索框；
 * - plugins：市场式卡片行（图标座 + 名称/来源 tag + 描述 + 右侧操作组 +
 *   错误行红文本——InstalledPluginsPanel 形态🔴只学行为；安装表单下沉模态）；
 * - enhancement/speech：行式卡。
 * 数据面逻辑原样（op:skills-list/skill-save/subagents-list/plugins-list/
 * mcp-check/mcp-import-scan 增删改与即改即存链全保留）。
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
    <div class="section-tools">
      <button id="mcp-import" type="button" class="btn">导入外部配置</button>
      <button id="mcp-add" type="button" class="btn btn-primary">添加 server</button>
    </div>
  </div>
  <div id="mcp-list" class="row-list"></div>
  <div id="mcp-wizard" class="card-box" hidden>
    <div id="mcp-step1">
      <div class="mcp-mode-row">
        <span class="mcp-mode-title" id="mcp-wizard-title">新建 MCP server</span>
        <div class="mcp-mode-seg" role="tablist" aria-label="新建形式">
          <button id="mcp-mode-form" type="button" class="seg-btn active">表单</button>
          <button id="mcp-mode-json" type="button" class="seg-btn">JSON</button>
        </div>
      </div>
      <div id="mcp-form-mode">
        <div class="form-grid">
          <label>类型
            <select id="mcp-type" class="select">
              <option value="stdio">stdio（本地命令）</option>
              <option value="http" disabled>http（内核暂未支持——随 HTTP transport 扩展）</option>
            </select>
          </label>
          <label>名称（工具前缀）<input id="mcp-name" class="input" type="text" placeholder="不含 __" autocomplete="off" /></label>
          <label>启动命令<input id="mcp-command" class="input" type="text" placeholder="如 npx" autocomplete="off" /></label>
          <label>参数（空格分隔）<input id="mcp-args" class="input" type="text" placeholder="空格分隔，如 -y @modelcontextprotocol/server-memory" autocomplete="off" /></label>
          <label>超时 MS（可选）<input id="mcp-timeout" class="input" type="number" min="1000" step="500" placeholder="缺省 10000" autocomplete="off" /></label>
        </div>
        <details class="mcp-adv">
          <summary>环境变量（可选）</summary>
          <textarea id="mcp-env" class="textarea" rows="3" placeholder='{"MY_API_KEY": "your-key"}（JSON 对象，随条目落档）'></textarea>
          <p id="mcp-env-error" class="hint error-text" hidden></p>
        </details>
      </div>
      <div id="mcp-json-mode" hidden>
        <textarea id="mcp-json" class="textarea mono" rows="8" placeholder='{
  "my-mcp-server": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-memory"]
  }
}'></textarea>
        <p class="hint">支持直接粘贴 <code>{"server-name": {...}}</code>、<code>{"mcpServers": {"server-name": {...}}}</code> 或裸配置对象（含 command）；一次添加一个 server，远程（url 型）暂不支持。</p>
        <p id="mcp-json-error" class="hint error-text" hidden></p>
      </div>
      <div class="form-actions"><button id="mcp-next" type="button" class="btn btn-primary">下一步：测连接</button></div>
    </div>
    <div id="mcp-step2" hidden>
      <p id="mcp-check-result" class="hint">未测试</p>
      <div id="mcp-check-tools" class="row-chips" hidden></div>
      <div class="form-actions">
        <button id="mcp-test" type="button" class="btn">测连接</button>
        <button id="mcp-save" type="button" class="btn btn-primary" disabled>保存</button>
        <button id="mcp-back" type="button" class="btn btn-ghost">上一步</button>
      </div>
    </div>
  </div>
  <p class="hint">启停即时落档，新会话生效（子进程装配期连接注册；单 server 失败不影响启动）。「测试」= 真 spawn + 握手 + 列工具：绿点 = 最近测试成功、红 = 失败、无点 = 启用但未测试、灰 = 已停用；工具数与工具名（前 24）随测试结果显示。环境变量与超时随条目落档。</p>
</section>
<section data-section="skills">
  <div class="section-head">
    <h2 class="section-title">技能</h2>
    <div class="section-tools">
      <input id="skill-search" class="input input-search" type="text" placeholder="搜索技能…" autocomplete="off" />
      <button id="skill-import" type="button" class="btn">导入技能</button>
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
    <div id="skill-bytes" class="skill-bytes"></div>
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
  <p class="hint">workspace 主目录（.zcode/skills）恒为首个来源；附加目录的技能同样出现在清单。停用 = 从新会话装配剔除（清单/系统提示/skill_load 三面一致）；技能正文上限 128KB（超 80% 计数器变黄）。「导入技能」扫 Claude Code / Codex / .agents 等外部源整目录复制（同名跳过绝不覆盖）；删除 = 删技能目录（含附属资源，受控根护栏）。</p>
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
  <p class="hint">端点 API key 在「供应商」页底部"预存密钥"区以 <code>stt</code> 录入（零明文，DPAPI 加密）。</p>
</section>
`;

// ---------------------------------------------------------------------------
// T-P3-143 MCP 管理：列表（行级测试 / 四态状态点 / 工具数·env·来源徽章）+
// 双形式向导（表单 | JSON 三形状粘贴——zcode McpServerForm 同构）+ 外部配置
// 导入模态（mcp-import-scan 扫描 → 勾选 → 并入 settings.mcp，随保存落档）。
// 连接校验数据面 = op:"mcp-check"（probeServer 真握手，env/timeoutMs 随载荷）
// ---------------------------------------------------------------------------

let editingMcpName = null;
let mcpWizardEntry = null; // 向导当前编辑的 {name, command, args?, env?, timeoutMs?}
let mcpTestOk = false;
let mcpMode = "form"; // 向导当前形式："form" | "json"
/** 最近一次测试失败的 server 名（行状态点红）。 */
const mcpCheckFailures = new Set();
/** 最近一次测试结果（name → {ok, toolCount, toolNames, protocolVersion}——内存面，不落 settings）。 */
const mcpCheckResults = new Map();
/** 行级测试进行中（防重入）。 */
const mcpTesting = new Set();
/** 导入来源徽章（name → 来源 label——内存面，不落 settings）。 */
const mcpImportSource = new Map();

/** 行状态点四态（zcode 状态语义同构）：绿=测过成功 / 红=测过失败 / 灰=停用 / 无点=启用未测。 */
function mcpIconBadge(name, enabled) {
  const badge = document.createElement("span");
  badge.className = "icon-badge";
  badge.appendChild(icon("plug"));
  const failed = mcpCheckFailures.has(name);
  const ok = mcpCheckResults.get(name)?.ok === true;
  if (enabled && (ok || failed)) {
    const dot = document.createElement("span");
    dot.className = "status-dot";
    dot.style.setProperty("--dot-color", ok ? "var(--success)" : "var(--destructive)");
    dot.title = ok ? "已启用（最近测试成功）" : "最近一次测试失败";
    badge.appendChild(dot);
  } else if (!enabled) {
    const dot = document.createElement("span");
    dot.className = "status-dot";
    dot.style.setProperty("--dot-color", "var(--text-subtlest)");
    dot.title = "已停用";
    badge.appendChild(dot);
  } // 启用但未测试——无点（badge title 交代语义）
  badge.title = enabled
    ? ok
      ? "已启用（最近测试成功）"
      : failed
        ? "最近一次测试失败"
        : "已启用（未测试——行内「测试」真握手）"
    : "已停用";
  return badge;
}

/** 测试一行（行级真实测试——同一 mcp-check 数据面，env/timeoutMs 随载荷）。 */
function testMcpEntry(entry, onDone) {
  mcpTesting.add(entry.name);
  void sendSettings({
    op: "mcp-check",
    name: entry.name,
    command: entry.command,
    ...(entry.args !== undefined ? { args: entry.args } : {}),
    ...(entry.env !== undefined ? { env: entry.env } : {}),
    ...(entry.timeoutMs !== undefined ? { timeoutMs: entry.timeoutMs } : {}),
  }).then((envelope) => {
    mcpTesting.delete(entry.name);
    onDone(envelope);
  });
}

/** 测试结果落内存面 + 回执（成功/失败两态——toolNames 前 24 截断）。 */
function recordMcpCheck(name, envelope) {
  if (!envelope.ok) return { ok: false, message: envelope.error?.message ?? "校验不可用" };
  const check = envelope.result.check;
  if (check.ok) {
    const tools = check.tools ?? [];
    mcpCheckResults.set(name, {
      ok: true,
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
      protocolVersion: check.protocolVersion,
    });
    mcpCheckFailures.delete(name);
    return { ok: true, tools, protocolVersion: check.protocolVersion };
  }
  mcpCheckResults.delete(name);
  mcpCheckFailures.add(name);
  return { ok: false, message: check.error?.message ?? "连接失败" };
}

/** 工具数徽标（title = 前 24 个工具名一览——pi-desktop 形态）。 */
function mcpToolChip(name) {
  const result = mcpCheckResults.get(name);
  if (result === undefined || !result.ok) return null;
  const chip = chipEl(`${result.toolCount} 工具`);
  const preview = (result.toolNames ?? []).slice(0, 24).join(", ");
  chip.title =
    preview === ""
      ? "该 server 未声明工具"
      : (result.toolNames ?? []).length > 24
        ? `${preview} …（共 ${String(result.toolCount)} 个）`
        : preview;
  return chip;
}

function renderMcpList() {
  const list = document.getElementById("mcp-list");
  if (list === null) return;
  list.replaceChildren();
  const servers = settingsCache?.mcp ?? [];
  if (servers.length === 0) {
    const empty = emptyState("无 MCP server", "手动建档，或从 Claude / Codex / Cursor 等外部工具的配置一键导入");
    const actions = document.createElement("div");
    actions.className = "empty-actions";
    const addBtn = btnEl("添加 server", "btn btn-primary");
    addBtn.addEventListener("click", () => {
      editingMcpName = null;
      openMcpWizard(null);
    });
    const importBtn = btnEl("导入外部配置", "btn");
    importBtn.addEventListener("click", () => void openMcpImportDialog());
    actions.append(addBtn, importBtn);
    empty.appendChild(actions);
    list.appendChild(empty);
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
    const toolChip = mcpToolChip(s.name);
    if (toolChip !== null) tools.appendChild(toolChip);
    if (Object.keys(s.env ?? {}).length > 0) {
      const envChip = chipEl("含 env");
      envChip.title = `环境变量键：${Object.keys(s.env).join(", ")}（值不显示）`;
      tools.appendChild(envChip);
    }
    if (mcpImportSource.has(s.name)) {
      const srcChip = chipEl(`导入自 ${mcpImportSource.get(s.name)}`);
      srcChip.title = "导入来源（本次应用内记忆，不落档）";
      tools.appendChild(srcChip);
    }
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
    const testBtn = btnEl(mcpTesting.has(s.name) ? "测试中…" : "测试", "btn", "真 spawn + 握手 + 列工具");
    testBtn.disabled = mcpTesting.has(s.name);
    testBtn.addEventListener("click", () => {
      testMcpEntry(s, (envelope) => {
        if (testBtn.isConnected === false) return; // 视图已卸载
        const outcome = recordMcpCheck(s.name, envelope);
        if (envelope.ok === false) {
          toast(`测试不可用：${outcome.message}`, "warn");
        } else if (outcome.ok) {
          toast(`✔ ${s.name}：${outcome.tools.length} 个工具（协议 ${outcome.protocolVersion}）`, "info");
        } else {
          toast(`✘ ${s.name}：${outcome.message}`, "warn");
        }
        renderMcpList();
      });
    });
    const delBtn = btnEl("删除", "btn btn-danger");
    delBtn.addEventListener("click", async () => {
      if (!(await confirmDialog(`删除 MCP server「${s.name}」？装载清单将移除该条目。`, { title: "删除 MCP server", confirmLabel: "删除", danger: true }))) return;
      settingsCache.mcp = (settingsCache.mcp ?? []).filter((x) => x.name !== s.name);
      mcpCheckFailures.delete(s.name);
      mcpCheckResults.delete(s.name);
      mcpImportSource.delete(s.name);
      dirtySections.add("mcp");
      renderMcpList();
      markDirty("mcp");
    });
    const editBtn = btnEl("编辑", "btn", "打开向导修改该 server（名称/命令/参数/环境变量/超时）");
    editBtn.addEventListener("click", () => {
      editingMcpName = s.name;
      openMcpWizard(s);
    });
    row.append(mcpIconBadge(s.name, enabled), copy, rowControl(tools, testBtn, toggle, editBtn, delBtn));
    list.appendChild(row);
  }
}

// —— 向导：双形式（表单 | JSON——zcode 分段切换同构） ——

/** 表单模式当前字段的原始读取（envRaw 未解析——校验在提交面）。 */
function mcpFormRaw() {
  return {
    name: document.getElementById("mcp-name").value.trim(),
    command: document.getElementById("mcp-command").value.trim(),
    args: document.getElementById("mcp-args").value.trim().split(/\s+/).filter((a) => a !== ""),
    timeoutRaw: document.getElementById("mcp-timeout").value.trim(),
    envRaw: document.getElementById("mcp-env").value.trim(),
  };
}

/** JSON → 表单回填（名称空 = 裸配置形状——沿用表单名称字段现值）。 */
function fillMcpFormFromEntry(name, entry) {
  if (name !== "") document.getElementById("mcp-name").value = name;
  document.getElementById("mcp-command").value = entry.command;
  document.getElementById("mcp-args").value = (entry.args ?? []).join(" ");
  document.getElementById("mcp-env").value =
    entry.env !== undefined ? JSON.stringify(entry.env, null, 2) : "";
  document.getElementById("mcp-timeout").value =
    entry.timeoutMs !== undefined ? String(entry.timeoutMs) : "";
  document.getElementById("mcp-env-error").hidden = true;
}

/** 环境变量文本域解析（空 = undefined；非对象/非字符串值 → error）。 */
function parseMcpEnvText(text) {
  if (text === "") return { env: undefined };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "环境变量不是合法 JSON" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "环境变量须为对象（{\"KEY\": \"value\"}）" };
  }
  const env = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== "string") return { error: `环境变量 ${k} 的值须为字符串` };
    env[k] = v;
  }
  return { env: Object.keys(env).length > 0 ? env : undefined };
}

/**
 * JSON 粘贴三形状解析（zcode jsonDraftToForm 同构）：
 * {"name": {...}} / {"mcpServers": {"name": {...}}}（多条报错）/ 裸 config
 * （含 command——名称回退表单名称字段）。url 型 → 明确报错（内核仅 stdio）。
 */
function parseMcpJsonDraft(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "须为 JSON 对象" };
  }
  let name;
  let config;
  if (parsed.mcpServers !== undefined) {
    if (parsed.mcpServers === null || typeof parsed.mcpServers !== "object" || Array.isArray(parsed.mcpServers)) {
      return { error: "mcpServers 须为对象" };
    }
    const entries = Object.entries(parsed.mcpServers);
    if (entries.length === 0) return { error: "mcpServers 为空" };
    if (entries.length > 1) return { error: `一次只添加一个 server（mcpServers 含 ${entries.length} 个）` };
    [name, config] = entries[0];
  } else if (typeof parsed.command === "string" || typeof parsed.url === "string") {
    config = parsed; // 裸配置——名称取表单名称字段
  } else {
    const entries = Object.entries(parsed);
    const first = entries[0];
    if (entries.length !== 1 || first === undefined || first[1] === null || typeof first[1] !== "object" || Array.isArray(first[1])) {
      return { error: '无法识别的形状（支持 {"name": {...}} / {"mcpServers": {...}} / 裸配置对象）' };
    }
    [name, config] = first;
  }
  if (typeof config !== "object" || config === null) return { error: "server 配置须为对象" };
  if (typeof config.command !== "string" || config.command.trim() === "") {
    if (typeof config.url === "string" && config.url !== "") {
      return { error: "远程 server（url 型）暂不支持——内核仅 stdio" };
    }
    return { error: "配置缺少 command" };
  }
  const args =
    Array.isArray(config.args) && config.args.every((a) => typeof a === "string")
      ? config.args
      : undefined;
  const timeoutMs =
    typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
      ? config.timeoutMs
      : undefined;
  let env;
  if (config.env !== undefined) {
    if (config.env === null || typeof config.env !== "object" || Array.isArray(config.env)) {
      return { error: "env 须为对象" };
    }
    env = {};
    for (const [k, v] of Object.entries(config.env)) {
      if (typeof v !== "string") return { error: `env.${k} 的值须为字符串` };
      env[k] = v;
    }
    if (Object.keys(env).length === 0) env = undefined;
  }
  return {
    name: typeof name === "string" ? name.trim() : "",
    entry: {
      command: config.command,
      ...(args !== undefined && args.length > 0 ? { args } : {}),
      ...(env !== undefined ? { env } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    },
  };
}

function setMcpMode(mode) {
  mcpMode = mode;
  const formMode = mode === "form";
  document.getElementById("mcp-form-mode").hidden = !formMode;
  document.getElementById("mcp-json-mode").hidden = formMode;
  document.getElementById("mcp-mode-form").classList.toggle("active", formMode);
  document.getElementById("mcp-mode-json").classList.toggle("active", !formMode);
}

function openMcpWizard(entry) {
  mcpWizardEntry = entry ?? null;
  mcpTestOk = false;
  document.getElementById("mcp-wizard").hidden = false;
  document.getElementById("mcp-step1").hidden = false;
  document.getElementById("mcp-step2").hidden = true;
  document.getElementById("mcp-save").disabled = true;
  document.getElementById("mcp-check-result").textContent = "未测试";
  document.getElementById("mcp-check-tools").hidden = true;
  document.getElementById("mcp-wizard-title").textContent =
    entry !== null ? `编辑 MCP server：${entry.name}` : "新建 MCP server";
  document.getElementById("mcp-name").value = entry?.name ?? "";
  document.getElementById("mcp-command").value = entry?.command ?? "";
  document.getElementById("mcp-args").value = (entry?.args ?? []).join(" ");
  document.getElementById("mcp-timeout").value =
    entry?.timeoutMs !== undefined ? String(entry.timeoutMs) : "";
  document.getElementById("mcp-env").value =
    entry?.env !== undefined ? JSON.stringify(entry.env, null, 2) : "";
  document.getElementById("mcp-env-error").hidden = true;
  document.getElementById("mcp-json").value = "";
  document.getElementById("mcp-json-error").hidden = true;
  setMcpMode("form");
  document.getElementById("mcp-wizard").scrollIntoView({ block: "nearest" });
}

// —— 外部配置导入模态（mcp-import-scan 扫描 → 勾选 → 并入 settings.mcp） ——

async function openMcpImportDialog() {
  const holder = document.createElement("div");
  holder.innerHTML = `
    <div class="mcp-import-head">
      <label class="check-line"><input id="mcp-imp-all" type="checkbox" checked /> 全选</label>
      <span id="mcp-imp-count" class="hint">已选 0/0</span>
      <button id="mcp-imp-refresh" type="button" class="btn">刷新</button>
    </div>
    <div id="mcp-imp-list" class="mcp-import-list"><p class="hint">扫描中…</p></div>
    <p class="hint">候选只读不写——导入并入下方清单（同名跳过），随设置「保存」落档。来源文件路径见各分组头。</p>`;
  let scan = null; // 最近一次扫描结果（刷新按钮重扫）
  const listBox = holder.querySelector("#mcp-imp-list");
  const countEl = holder.querySelector("#mcp-imp-count");

  function syncCount() {
    const boxes = [...listBox.querySelectorAll("input[data-candidate]")];
    const picked = boxes.filter((b) => b.checked).length;
    countEl.textContent = `已选 ${picked}/${boxes.length}`;
    holder.querySelector("#mcp-imp-all").checked = boxes.length > 0 && picked === boxes.length;
  }

  function renderScan() {
    listBox.replaceChildren();
    if (scan === null) {
      listBox.appendChild(document.createTextNode("扫描中…"));
      return;
    }
    if (scan.candidates.length === 0) {
      listBox.appendChild(emptyState("未发现可导入的 MCP server", "没有检出候选——来源状态见下方明细"));
    }
    // 候选分组（按来源 label）——组头 = 来源名 + 文件路径；行 = 勾选 + 名 + 命令
    const bySource = new Map();
    for (const c of scan.candidates) {
      if (!bySource.has(c.sourceLabel)) bySource.set(c.sourceLabel, []);
      bySource.get(c.sourceLabel).push(c);
    }
    for (const [label, items] of bySource) {
      const head = document.createElement("div");
      head.className = "group-title";
      head.textContent = `${label}（${items.length}）`;
      listBox.appendChild(head);
      for (const c of items) {
        const line = document.createElement("label");
        line.className = "check-line mcp-imp-line";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = true;
        box.dataset.candidate = c.name;
        box.addEventListener("change", syncCount);
        const nameEl = document.createElement("span");
        nameEl.className = "row-title";
        nameEl.textContent = c.name;
        const cmdEl = document.createElement("span");
        cmdEl.className = "row-desc mono";
        cmdEl.textContent = `${c.config.command}${(c.config.args ?? []).length > 0 ? ` ${(c.config.args ?? []).join(" ")}` : ""}`;
        line.append(box, nameEl, cmdEl);
        if (c.warning !== undefined) {
          line.title = c.warning;
        }
        listBox.appendChild(line);
      }
    }
    // 来源明细（未检出/跳过/错误——每源一行报告不静默）
    const detail = document.createElement("p");
    detail.className = "hint";
    const bits = [];
    for (const src of scan.sources) {
      if (!src.exists) continue;
      const flags = [];
      if (src.error !== undefined) flags.push(`错误：${src.error}`);
      if ((src.skipped ?? 0) > 0) flags.push(`跳过 ${src.skipped} 个（远程/停用/重名/坏条目）`);
      if (flags.length > 0) bits.push(`${src.label}（${src.path}）：${flags.join("；")}`);
    }
    detail.textContent = bits.length > 0 ? bits.join("\n") : "";
    detail.hidden = bits.length === 0;
    listBox.appendChild(detail);
    syncCount();
  }

  async function rescan() {
    scan = null;
    renderScan();
    const envelope = await sendSettings({ op: "mcp-import-scan" });
    if (!listBox.isConnected) return; // 模态已关
    if (!envelope.ok) {
      listBox.replaceChildren();
      listBox.appendChild(emptyState("扫描不可用", envelope.error?.message ?? ""));
      return;
    }
    scan = envelope.result;
    renderScan();
  }

  holder.querySelector("#mcp-imp-all").addEventListener("change", (ev) => {
    const checked = ev.target.checked;
    for (const box of listBox.querySelectorAll("input[data-candidate]")) box.checked = checked;
    syncCount();
  });
  holder.querySelector("#mcp-imp-refresh").addEventListener("click", () => void rescan());

  openDialog({
    title: "导入外部 Agent MCP 服务器",
    description:
      "扫描 Claude Code / Claude Desktop / Codex CLI / Cursor / OpenCode / Qwen Code / Trae / 通用 .agents / 工作区 .mcp.json 落盘的 MCP 配置（只读）。",
    width: "lg",
    body: holder,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      {
        label: "导入所选",
        className: "btn btn-primary",
        onClick: () => {
          if (scan === null) {
            toast("扫描尚未完成", "warn");
            return;
          }
          const boxes = [...holder.querySelectorAll("input[data-candidate]")];
          const picked = new Set(boxes.filter((b) => b.checked).map((b) => b.dataset.candidate));
          const existing = new Set((settingsCache.mcp ?? []).map((x) => x.name));
          const next = [...(settingsCache.mcp ?? [])];
          let imported = 0;
          let skipped = 0;
          for (const c of scan.candidates) {
            if (!picked.has(c.name)) continue;
            if (existing.has(c.name) || next.some((x) => x.name === c.name)) {
              skipped++; // 目标清单同名——zcode sameNameExists 语义
              continue;
            }
            next.push({
              name: c.name,
              command: c.config.command,
              ...(c.config.args !== undefined ? { args: c.config.args } : {}),
              ...(c.config.env !== undefined ? { env: c.config.env } : {}),
            });
            mcpImportSource.set(c.name, c.sourceLabel);
            imported++;
          }
          if (imported > 0) {
            settingsCache.mcp = next;
            dirtySections.add("mcp");
            renderMcpList();
            markDirty("mcp");
          }
          toast(
            imported === 0 && skipped === 0
              ? "未选择可导入项"
              : `已导入 ${imported} 个${skipped > 0 ? `（跳过重名 ${skipped} 个）` : ""}${imported > 0 ? "——保存设置后落档" : ""}`,
            imported > 0 ? "info" : "warn",
          );
        },
      },
    ],
  });
  void rescan();
}

// ---------------------------------------------------------------------------
// U22/T-P3-125 技能管理：清单（多根扫描 + 停用开关 + 搜索）+ 编辑器写回
// T-P3-144 v2：外部源导入（scan/apply）/ 行级删除（受控根护栏在 host）/
// Reveal / 新建种子模板 / 字节计数器 / 外部来源保存确认 / 根计数与诊断折叠
// ---------------------------------------------------------------------------

/** 技能清单缓存（open 时刷新——文件系统面，不与会话期缓存混用）。 */
let skillsView = null;
let editingSkillName = null; // 非 null = 编辑器在改既有技能（同名覆盖）
let editingSkillOrigin = null; // 编辑目标的来源根（外部来源保存确认面）
let skillBodyTouched = false; // 正文是否用户手写过（种子模板门控）
const skillToolsSelected = new Set();
let skillFilter = "";

/** 正文上限（与 host MAX_SKILL_BODY_BYTES 同值——pi-desktop SkillEditorSheet 同源）。 */
const SKILL_BODY_MAX_BYTES = 128 * 1024;

function skillMatches(s) {
  if (skillFilter === "") return true;
  const q = skillFilter.toLowerCase();
  return s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q);
}

/** 正文字节计数（pi-desktop 形态：>80% 黄、超限红 + 保存禁用）。 */
function updateSkillBytes() {
  const el = document.getElementById("skill-bytes");
  if (el === null) return;
  const n = new TextEncoder().encode(document.getElementById("skill-body").value).length;
  el.textContent = n >= 1024 ? `${(n / 1024).toFixed(1)}KB / 128KB` : `${n}B / 128KB`;
  el.classList.toggle("warn", n > SKILL_BODY_MAX_BYTES * 0.8 && n <= SKILL_BODY_MAX_BYTES);
  el.classList.toggle("over", n > SKILL_BODY_MAX_BYTES);
  document.getElementById("skill-save").disabled = n > SKILL_BODY_MAX_BYTES;
}

/** C：种子模板（pi-desktop skillTemplate 同语义——"空编辑器教不会格式"）。 */
function skillSeedBody(name) {
  return `## 何时使用\n\n<「${name}」解决什么问题、什么时候该用它——一句话给模型判断依据>\n\n## 步骤\n\n1. \n\n## 注意\n\n- \n`;
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
    const revealBtn = btnEl("目录", "btn", "打开技能所在文件夹");
    revealBtn.addEventListener("click", () => {
      void sendSettings({ op: "skill-reveal", path: s.filePath }).then((envelope) => {
        if (!envelope.ok) toast(`打开失败：${envelope.error?.message ?? ""}`, "warn");
      });
    });
    const delBtn = btnEl("删除", "btn btn-danger", "删除技能目录（含附属资源——受控根护栏在 host）");
    delBtn.addEventListener("click", async () => {
      if (!(await confirmDialog(`删除技能「${s.name}」？将删除其技能目录（含附属资源），不可恢复。`, { title: "删除技能", confirmLabel: "删除", danger: true }))) return;
      const envelope = await sendSettings({ op: "skill-delete", path: s.filePath });
      if (!envelope.ok) {
        toast(`删除失败：${envelope.error?.message ?? ""}`, "warn");
        return;
      }
      // 停用名单按名匹配——已删技能的停用记录同步清理
      const cur = (settingsCache.skills?.disabled ?? []).filter((x) => x !== s.name);
      settingsCache.skills = { ...(settingsCache.skills ?? {}), ...(cur.length > 0 ? { disabled: cur } : {}) };
      if (cur.length === 0 && settingsCache.skills !== undefined) delete settingsCache.skills.disabled;
      dirtySections.add("skills");
      markDirty("skills");
      toast(`技能已删除：${s.name}`, "info");
      void refreshSkillsList();
    });
    row.append(badge, copy, rowControl(toolsRow, toggle, editBtn, revealBtn, delBtn));
    list.appendChild(row);
  }
  if (skillsView.diagnostics.length > 0) {
    // 诊断折叠汇总（zcode 琥珀横幅形态的轻量版——量小时一行可展开）
    const details = document.createElement("details");
    details.className = "skill-diag";
    const summary = document.createElement("summary");
    summary.textContent = `诊断（${skillsView.diagnostics.length}）`;
    details.appendChild(summary);
    for (const d of skillsView.diagnostics) {
      const row = rowEl();
      const warnEl = document.createElement("div");
      warnEl.className = "row-copy";
      const t = document.createElement("div");
      t.className = "row-desc error-text";
      t.textContent = `[${d.code}] ${d.path}——${d.message}`;
      warnEl.appendChild(t);
      row.append(warnEl);
      details.appendChild(row);
    }
    list.appendChild(details);
  }
  renderSkillRoots(); // 技能计数随清单刷新（skillsView.roots 序对应已就绪）
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
  for (let i = 0; i < roots.length; i++) {
    const r = roots[i];
    // 技能计数（E）：settingsCache roots 序对应 skillsView.roots[1..]
    // （首根 = workspace 主技能目录）；skillsView 未加载时无计数
    const originDir = skillsView?.roots?.[i + 1];
    const count =
      originDir !== undefined
        ? (skillsView?.skills ?? []).filter((s) => s.origin === originDir).length
        : undefined;
    const row = rowEl();
    const descEl = document.createElement("div");
    descEl.className = "row-desc mono";
    descEl.textContent = count !== undefined ? `${r}（${count} 个技能）` : r;
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
  editingSkillOrigin = skill?.origin ?? null;
  skillBodyTouched = (skill?.body ?? "") !== ""; // 既有技能 = 已有正文——种子不触发
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
  updateSkillBytes();
  document.getElementById("skill-editor").hidden = false;
  document.getElementById("skill-new").hidden = true;
}

// ---------------------------------------------------------------------------
// T-P3-144 外部技能源导入模态（scan/apply——形态复用 MCP 导入模态基座）
// ---------------------------------------------------------------------------

function fmtSkillBytes(n) {
  return n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`;
}

async function openSkillImportDialog() {
  const holder = document.createElement("div");
  holder.innerHTML = `
    <div class="mcp-import-head">
      <label class="check-line"><input id="skill-imp-all" type="checkbox" checked /> 全选</label>
      <span id="skill-imp-count" class="hint">已选 0/0</span>
      <button id="skill-imp-refresh" type="button" class="btn">刷新</button>
    </div>
    <div id="skill-imp-list" class="mcp-import-list"><p class="hint">扫描中…</p></div>
    <p class="hint">候选只读不写——导入 = 整目录复制进工作区技能主目录（同名跳过，绝不覆盖）；单文件技能自动转成 &lt;名&gt;/SKILL.md 目录形状。</p>`;
  let scan = null; // 最近一次扫描结果（刷新按钮重扫）
  const listBox = holder.querySelector("#skill-imp-list");
  const countEl = holder.querySelector("#skill-imp-count");

  function syncCount() {
    const boxes = [...listBox.querySelectorAll("input[data-idx]")];
    const picked = boxes.filter((b) => b.checked).length;
    countEl.textContent = `已选 ${picked}/${boxes.length}`;
    holder.querySelector("#skill-imp-all").checked = boxes.length > 0 && picked === boxes.length;
  }

  function renderScan() {
    listBox.replaceChildren();
    if (scan === null) {
      listBox.appendChild(document.createTextNode("扫描中…"));
      return;
    }
    if (scan.candidates.length === 0) {
      listBox.appendChild(emptyState("未发现可导入的技能", "没有检出候选——来源状态见下方明细"));
    }
    const bySource = new Map();
    for (let i = 0; i < scan.candidates.length; i++) {
      const c = scan.candidates[i];
      if (!bySource.has(c.sourceLabel)) bySource.set(c.sourceLabel, []);
      bySource.get(c.sourceLabel).push([c, i]);
    }
    for (const [label, items] of bySource) {
      const head = document.createElement("div");
      head.className = "group-title";
      head.textContent = `${label}（${items.length}）`;
      listBox.appendChild(head);
      for (const [c, idx] of items) {
        const line = document.createElement("label");
        line.className = "check-line mcp-imp-line";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = true;
        box.dataset.idx = String(idx);
        box.addEventListener("change", syncCount);
        const nameEl = document.createElement("span");
        nameEl.className = "row-title";
        nameEl.textContent = c.name;
        const descEl = document.createElement("span");
        descEl.className = "row-desc";
        descEl.textContent = `${c.description ?? "（无描述）"} · ${fmtSkillBytes(c.bytes)}${c.kind === "file" ? " · 单文件" : ""}`;
        line.append(box, nameEl, descEl);
        if (c.warning !== undefined) line.title = c.warning;
        listBox.appendChild(line);
      }
    }
    const detail = document.createElement("p");
    detail.className = "hint";
    const bits = [];
    for (const src of scan.sources) {
      if (!src.exists) continue;
      const flags = [];
      if (src.error !== undefined) flags.push(`错误：${src.error}`);
      if ((src.skipped ?? 0) > 0) flags.push(`跳过 ${src.skipped} 个（空正文/重名）`);
      if (flags.length > 0) bits.push(`${src.label}（${src.dir}）：${flags.join("；")}`);
    }
    detail.textContent = bits.length > 0 ? bits.join("\n") : "";
    detail.hidden = bits.length === 0;
    listBox.appendChild(detail);
    syncCount();
  }

  async function rescan() {
    scan = null;
    renderScan();
    const envelope = await sendSettings({ op: "skill-import-scan" });
    if (!listBox.isConnected) return; // 模态已关
    if (!envelope.ok) {
      listBox.replaceChildren();
      listBox.appendChild(emptyState("扫描不可用", envelope.error?.message ?? ""));
      return;
    }
    scan = envelope.result;
    renderScan();
  }

  holder.querySelector("#skill-imp-all").addEventListener("change", (ev) => {
    const checked = ev.target.checked;
    for (const box of listBox.querySelectorAll("input[data-idx]")) box.checked = checked;
    syncCount();
  });
  holder.querySelector("#skill-imp-refresh").addEventListener("click", () => void rescan());

  openDialog({
    title: "导入外部 Agent 技能",
    description:
      "扫描 Claude Code / Codex CLI / 通用 .agents / OpenCode / Qwen / Trae / Kiro / Roo / Windsurf / 工作区生态位落盘的技能目录（只读）。",
    width: "lg",
    body: holder,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      {
        label: "导入所选",
        className: "btn btn-primary",
        onClick: async () => {
          if (scan === null) {
            toast("扫描尚未完成", "warn");
            return;
          }
          const boxes = [...holder.querySelectorAll("input[data-idx]")];
          const items = boxes
            .filter((b) => b.checked)
            .map((b) => scan.candidates[Number(b.dataset.idx)])
            .filter((c) => c !== undefined)
            .map((c) => ({ name: c.name, sourcePath: c.sourcePath, kind: c.kind }));
          if (items.length === 0) {
            toast("未选择可导入项", "warn");
            return;
          }
          const envelope = await sendSettings({ op: "skill-import-apply", items });
          if (!envelope.ok) {
            toast(`导入不可用：${envelope.error?.message ?? ""}`, "warn");
            return;
          }
          const r = envelope.result;
          toast(
            `已导入 ${r.imported.length} 个${r.skipped.length > 0 ? `（跳过同名 ${r.skipped.length} 个）` : ""}${r.failed.length > 0 ? `，失败 ${r.failed.length} 个` : ""}`,
            r.imported.length > 0 ? "info" : "warn",
          );
          if (r.failed.length > 0) {
            appendLine(`技能导入失败明细：${r.failed.map((f) => `${f.name}——${f.error}`).join("；")}`, "warn");
          }
          if (r.imported.length > 0) void refreshSkillsList();
        },
      },
    ],
  });
  void rescan();
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
  document.getElementById("mcp-import").addEventListener("click", () => void openMcpImportDialog());
  // 双形式切换：form → json 生成草稿（当前表单字段序列化）；json → form
  // 解析回填（失败留在 JSON 模式并显示错误——比弹回更可诊断）
  document.getElementById("mcp-mode-form").addEventListener("click", () => {
    if (mcpMode === "form") return;
    const text = document.getElementById("mcp-json").value.trim();
    if (text === "") {
      setMcpMode("form");
      return;
    }
    const parsed = parseMcpJsonDraft(text);
    const jsonErrorEl = document.getElementById("mcp-json-error");
    if (parsed.error !== undefined) {
      jsonErrorEl.textContent = parsed.error;
      jsonErrorEl.hidden = false;
      return; // 转换失败留在 JSON 模式
    }
    fillMcpFormFromEntry(parsed.name, parsed.entry);
    setMcpMode("form");
  });
  document.getElementById("mcp-mode-json").addEventListener("click", () => {
    if (mcpMode === "json") return;
    const raw = mcpFormRaw();
    const { env } = parseMcpEnvText(raw.envRaw);
    const config = {
      ...(raw.command !== "" ? { command: raw.command } : {}),
      ...(raw.args.length > 0 ? { args: raw.args } : {}),
      ...(env !== undefined ? { env } : {}),
      ...(raw.timeoutRaw !== "" && Number(raw.timeoutRaw) > 0 ? { timeoutMs: Number(raw.timeoutRaw) } : {}),
    };
    let draft = {};
    if (raw.name !== "") {
      draft = { [raw.name]: config };
    } else if (raw.command !== "") {
      draft = config;
    }
    document.getElementById("mcp-json").value =
      Object.keys(draft).length > 0 ? JSON.stringify(draft, null, 2) : "";
    document.getElementById("mcp-json-error").hidden = true;
    setMcpMode("json");
  });
  document.getElementById("mcp-next").addEventListener("click", () => {
    const envErrorEl = document.getElementById("mcp-env-error");
    const jsonErrorEl = document.getElementById("mcp-json-error");
    envErrorEl.hidden = true;
    jsonErrorEl.hidden = true;
    if (mcpMode === "form") {
      const raw = mcpFormRaw();
      if (raw.name === "" || raw.name.includes("__") || raw.command === "") {
        toast("名称（不含 __）与启动命令必填", "warn");
        return;
      }
      const { env, error } = parseMcpEnvText(raw.envRaw);
      if (error !== undefined) {
        envErrorEl.textContent = error;
        envErrorEl.hidden = false;
        return;
      }
      const timeoutNumber = raw.timeoutRaw === "" ? undefined : Number(raw.timeoutRaw);
      if (raw.timeoutRaw !== "" && (!Number.isFinite(timeoutNumber) || timeoutNumber <= 0)) {
        toast("超时须为正数（ms）", "warn");
        return;
      }
      mcpWizardEntry = {
        name: raw.name,
        command: raw.command,
        ...(raw.args.length > 0 ? { args: raw.args } : {}),
        ...(env !== undefined ? { env } : {}),
        ...(timeoutNumber !== undefined ? { timeoutMs: timeoutNumber } : {}),
      };
    } else {
      const text = document.getElementById("mcp-json").value;
      if (text.trim() === "") {
        toast("粘贴 JSON 配置", "warn");
        return;
      }
      const parsed = parseMcpJsonDraft(text);
      if (parsed.error !== undefined) {
        jsonErrorEl.textContent = parsed.error;
        jsonErrorEl.hidden = false;
        return;
      }
      const name = parsed.name !== "" ? parsed.name : document.getElementById("mcp-name").value.trim();
      if (name === "" || name.includes("__")) {
        jsonErrorEl.textContent = '缺少 server 名（JSON 键名，或表单模式先填名称）——且不能含 "__"';
        jsonErrorEl.hidden = false;
        return;
      }
      mcpWizardEntry = { name, ...parsed.entry };
    }
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
    const toolsBox = document.getElementById("mcp-check-tools");
    resultEl.textContent = "测试中…";
    toolsBox.hidden = true;
    testMcpEntry(mcpWizardEntry, (envelope) => {
      if (resultEl.isConnected === false) return; // 视图已卸载
      if (!envelope.ok) {
        resultEl.textContent = `校验不可用：${envelope.error?.message ?? ""}`;
        return;
      }
      const outcome = recordMcpCheck(mcpWizardEntry.name, envelope);
      if (outcome.ok) {
        mcpTestOk = true;
        document.getElementById("mcp-save").disabled = false;
        resultEl.textContent = `✔ 连接成功（协议 ${outcome.protocolVersion}，${outcome.tools.length} 个工具）`;
        toolsBox.replaceChildren(...outcome.tools.slice(0, 24).map((t) => chipEl(t.name)));
        toolsBox.hidden = outcome.tools.length === 0;
        toolsBox.title = outcome.tools.length > 24 ? "仅显示前 24 个工具名" : "";
      } else {
        resultEl.textContent = `✘ 连接失败：${outcome.message}`;
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
    // 改名保存：测试结果/来源徽章随名迁移（内存面键同步）
    if (editingMcpName !== null && editingMcpName !== mcpWizardEntry.name) {
      if (mcpCheckResults.has(editingMcpName)) {
        mcpCheckResults.set(mcpWizardEntry.name, mcpCheckResults.get(editingMcpName));
        mcpCheckResults.delete(editingMcpName);
      }
      mcpCheckFailures.delete(editingMcpName);
      if (mcpImportSource.has(editingMcpName)) {
        mcpImportSource.set(mcpWizardEntry.name, mcpImportSource.get(editingMcpName));
        mcpImportSource.delete(editingMcpName);
      }
    }
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
  document.getElementById("skill-import").addEventListener("click", () => void openSkillImportDialog());
  document.getElementById("skill-new").addEventListener("click", () => {
    void openSkillEditor(null);
  });
  // C：种子模板——新建时输入名称且正文未写 → 一次性填充三段骨架
  document.getElementById("skill-name").addEventListener("input", () => {
    if (editingSkillName !== null || skillBodyTouched) return;
    const name = document.getElementById("skill-name").value.trim();
    const bodyEl = document.getElementById("skill-body");
    if (name !== "" && bodyEl.value.trim() === "") {
      bodyEl.value = skillSeedBody(name);
      updateSkillBytes();
    }
  });
  // D：字节计数（正文手写即置 touched——种子不再触发）
  document.getElementById("skill-body").addEventListener("input", () => {
    skillBodyTouched = true;
    updateSkillBytes();
  });
  document.getElementById("skill-cancel").addEventListener("click", () => {
    document.getElementById("skill-editor").hidden = true;
    document.getElementById("skill-new").hidden = false;
    editingSkillName = null;
    editingSkillOrigin = null;
  });
  document.getElementById("skill-save").addEventListener("click", async () => {
    const name = document.getElementById("skill-name").value.trim();
    const description = document.getElementById("skill-desc").value.trim();
    const body = document.getElementById("skill-body").value;
    if (name === "" || description === "" || body.trim() === "") {
      toast("技能名、描述与正文必填", "warn");
      return;
    }
    if (new TextEncoder().encode(body).length > SKILL_BODY_MAX_BYTES) {
      toast(`正文超限（上限 128KB）`, "warn");
      return;
    }
    // D：外部来源技能保存语义澄清——写的是主目录同名副本（原文件不动），
    // 现状静默变副本无感知，先确认（pi-desktop 无此面——来源根只读模型不同）
    if (editingSkillOrigin !== null && editingSkillOrigin !== skillsView?.roots?.[0]) {
      const ok = await confirmDialog(
        `该技能来自外部来源（${editingSkillOrigin}）。\n保存将写入工作区主目录的同名副本（原文件不动）。继续？`,
        { title: "保存外部来源技能", confirmLabel: "保存副本" },
      );
      if (!ok) return;
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
    editingSkillOrigin = null;
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
