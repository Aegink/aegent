/**
 * U14/T-P3-103 设置中心视图（T-P3-134 · UI 批次 A④ 从 app.js 原样迁入）。
 * 十九个 data-section 与 settings 模块一一对应（T-P3-132 补日志、T-P3-110 补
 * 项目、T-P3-133 补插件）；逻辑照搬不重写（批 B 才逐分节重做形态），既有
 * id/data-* 钩子全保留。批 A 布局落位：左侧二级分类导航三组（基础设置/
 * Agent 能力/数据与系统）+ 分节内容双栏（opencode settings-v2 骨架形态）。
 * 视图契约：render(container, params) + unmount()（关面板前收尾保存）。
 */

import { sendRequest, sendSettings, ensureMetaCache } from "../api.js";
import {
  settingsCache,
  setSettingsCache,
  getSessionId,
  markPromptsLoaded,
  rebuildKeymap,
  applyTheme,
} from "../state.js";
import { appendLine, toast } from "../feedback.js";
import { go } from "../router.js";
import { ACTION_LABELS, createKeymap, detectConflict, eventToCombo } from "../keymap.js";

// —— 二级分类导航三组（方案 §三批 A：基础设置/Agent 能力/数据与系统）
const NAV_GROUPS = [
  {
    title: "基础设置",
    sections: [
      ["providers", "供应商"],
      ["credentials", "凭据"],
      ["permission", "权限档"],
      ["sandbox", "沙箱档"],
      ["appearance", "外观与语言"],
      ["profiles", "场景配置档"],
    ],
  },
  {
    title: "Agent 能力",
    sections: [
      ["mcp", "MCP 服务器"],
      ["skills", "技能"],
      ["subagents", "子智能体"],
      ["prompts", "提示词模板"],
      ["enhancement", "辅助模型"],
      ["plugins", "插件"],
      ["speech", "语音【实验性】"],
    ],
  },
  {
    title: "数据与系统",
    sections: [
      ["projects", "项目"],
      ["instructions", "指令中心"],
      ["shortcuts", "快捷键"],
      ["transfer", "导入与导出"],
      ["logging", "日志"],
      ["about", "关于"],
    ],
  },
];

const NAV_HTML = NAV_GROUPS.map(
  (group) =>
    `<div class="nav-group-title">${group.title}</div>` +
    group.sections
      .map(([id, label]) => `<button type="button" class="nav-item" data-nav="${id}">${label}</button>`)
      .join(""),
).join("");

const TEMPLATE = `
<aside id="settings-panel" aria-label="设置中心">
  <header class="settings-head">
    <span>设置</span>
    <button id="settings-close" type="button">关闭</button>
  </header>
  <div class="settings-layout">
    <nav class="settings-nav" aria-label="设置分类">${NAV_HTML}</nav>
    <div class="settings-body">
      <section data-section="providers">
        <h2>供应商</h2>
        <ul id="provider-list"></ul>
        <form id="provider-form">
          <input id="provider-name" type="text" placeholder="名称（如 main）" autocomplete="off" />
          <select id="provider-adapter">
            <option value="openai">openai 兼容</option>
            <option value="anthropic">anthropic</option>
          </select>
          <input id="provider-baseurl" type="text" placeholder="Base URL" autocomplete="off" />
          <input id="provider-model" type="text" placeholder="模型" autocomplete="off" />
          <button type="submit">新增</button>
        </form>
        <p class="hint">默认标记 = 启动装配选中的供应商（新会话生效）。↑↓ 顺序 = 故障转移优先级（J15 队列序）。</p>
      </section>
      <section data-section="credentials">
        <h2>凭据</h2>
        <form id="credential-form">
          <input id="credential-provider" type="text" placeholder="provider 名" autocomplete="off" />
          <input id="credential-key" type="password" placeholder="API key（不回显）" autocomplete="off" />
          <button type="submit">保存</button>
          <button id="credential-delete" type="button">删除</button>
        </form>
        <ul id="credential-list"></ul>
        <p class="hint">凭据独立存储（Windows 经 DPAPI 加密），永不写入配置文件与日志。</p>
      </section>
      <section data-section="permission">
        <h2>权限档</h2>
        <label>审批超时（毫秒）<input id="perm-timeout" type="number" min="1000" step="1000" /></label>
      </section>
      <section data-section="sandbox">
        <h2>沙箱档</h2>
        <label>网络档
          <select id="sandbox-network">
            <option value="">（未设置）</option>
            <option value="allow">allow</option>
            <option value="deny">deny</option>
          </select>
        </label>
        <label>工作区<input id="sandbox-workspace" type="text" placeholder="（未设置）" /></label>
        <label>事件库<input id="sandbox-db" type="text" placeholder="（未设置）" /></label>
      </section>
      <section data-section="appearance">
        <h2>外观与语言</h2>
        <label>主题
          <select id="appearance-theme">
            <option value="dark">暗色</option>
            <option value="light">亮色</option>
          </select>
        </label>
        <label>语言
          <select id="appearance-language">
            <option value="zh-CN">中文</option>
            <option value="en">English</option>
          </select>
        </label>
      </section>
      <section data-section="logging">
        <h2>日志</h2>
        <label>原始分片日志目录<input id="logging-rawdir" type="text" placeholder="（未设置——不写原始分片）" /></label>
        <p class="hint">对应 --raw-log-dir：设置后新会话起记录原始响应分片（排障用）。</p>
      </section>
      <section data-section="projects">
        <h2>项目</h2>
        <ul id="project-list"></ul>
        <form id="project-form">
          <input id="project-name" type="text" placeholder="项目名" autocomplete="off" />
          <input id="project-workspace" type="text" placeholder="workspace 目录" autocomplete="off" />
          <textarea id="project-instructions" rows="2" placeholder="项目级指令（可选）"></textarea>
          <button type="submit">新增</button>
        </form>
        <p class="hint">设为活动 = 新会话以该项目 workspace 启动（当前会话不受影响）。</p>
      </section>
      <!-- U16/T-P3-118 提示词模板库：用户自建/编辑/删除（settings prompts 段）+
           Composer / 补全调用（选中填入输入框，{{var}} 占位符保留手改） -->
      <section data-section="prompts">
        <h2>提示词模板</h2>
        <ul id="prompt-list"></ul>
        <form id="prompt-form">
          <input id="prompt-name" type="text" placeholder="模板名（斜杠调用标识）" autocomplete="off" />
          <input id="prompt-desc" type="text" placeholder="描述（可选）" autocomplete="off" />
          <textarea id="prompt-content" rows="3" placeholder="模板正文（{{var}} 为变量占位符）"></textarea>
          <button type="submit">新增</button>
        </form>
        <p class="hint">模板在输入区 / 补全中列出（📝），选中即填入输入框；变量占位符保留手改。系统级人格预设（persona）不在此管理。</p>
      </section>
      <!-- U22/T-P3-125 技能管理：清单（卡片：名称/描述/来源标记/工具集
           chips/启用开关）+ 编辑器（写回 workspace 技能目录 SKILL.md）+
           来源目录管理（RepoManager 形态本地化——附加根清单/增删） -->
      <section data-section="skills">
        <h2>技能</h2>
        <ul id="skill-list"></ul>
        <div id="skill-editor" hidden>
          <input id="skill-name" type="text" placeholder="技能名（slug：小写字母数字开头，可含 . - _）" autocomplete="off" />
          <input id="skill-desc" type="text" placeholder="描述（清单与系统提示显示用）" autocomplete="off" />
          <div class="hint">工具集（可选——勾选该技能声明的工作工具）</div>
          <div id="skill-tools"></div>
          <textarea id="skill-body" rows="6" placeholder="技能正文（写入 SKILL.md 的 frontmatter 之后——给模型看的操作指引）"></textarea>
          <button id="skill-save" type="button">保存技能</button>
          <button id="skill-cancel" type="button">取消</button>
        </div>
        <button id="skill-new" type="button">新建技能</button>
        <hr />
        <h3>来源目录</h3>
        <ul id="skill-roots"></ul>
        <form id="skill-root-form">
          <input id="skill-root-path" type="text" placeholder="附加技能来源目录（绝对路径）" autocomplete="off" />
          <button type="submit">添加来源</button>
        </form>
        <p class="hint">workspace 主目录（.zcode/skills）恒为首个来源；附加目录的技能同样出现在清单。停用 = 从新会话装配剔除（清单/系统提示/skill_load 三面一致）；技能正文上限 128KB。</p>
      </section>
      <!-- U23/T-P3-126 子智能体管理：内置五预设卡（开关/工具 chips/覆盖
           编辑）+ 用户自定义 CRUD + per-subagent 模型与 fallback 链
           （SubagentModelPicker/SubagentFallbackModels 行为锚） -->
      <section data-section="subagents">
        <h2>子智能体</h2>
        <ul id="subagent-list"></ul>
        <p class="hint">内置预设可在 task 工具中以 subagent_type 调用（如 explorer / code-reviewer）；停用的内置保留在清单里（开关是开回的路径）。工具集 chips = 该预设可用的工具声明面（H3/H5 降级面之上再收窄）。</p>
        <div id="subagent-editor" hidden>
          <input id="subagent-name" type="text" placeholder="预设名（slug：小写字母数字- _，task 调用标识）" autocomplete="off" />
          <input id="subagent-desc" type="text" placeholder="描述" autocomplete="off" />
          <textarea id="subagent-prompt" rows="4" placeholder="身份提示（这个子代理是谁、怎么干活——追加进子会话系统提示）"></textarea>
          <div class="hint">工具集（可选——勾选后该预设只能用这些工具）</div>
          <div id="subagent-tools"></div>
          <label>模型条目（providers 条目名——独立模型面，缺省回退父会话模型）
            <input id="subagent-provider" type="text" placeholder="（缺省继承父会话）" autocomplete="off" /></label>
          <label>模型 id（可选——覆盖条目缺省模型）
            <input id="subagent-model" type="text" placeholder="（条目/主模型回退）" autocomplete="off" /></label>
          <label>故障转移候选（providers 条目名，逗号分隔——J15 消费面）
            <input id="subagent-fallbacks" type="text" placeholder="（可选）" autocomplete="off" /></label>
          <button id="subagent-save" type="button">保存预设</button>
          <button id="subagent-cancel" type="button">取消</button>
        </div>
        <button id="subagent-new" type="button">新建自定义子代理</button>
      </section>
      <!-- U24/T-P3-127 指令中心：全局/项目级指令文件与用户规则文件的
           集中管理（C22 project/user 两档的文件位 UI 面）——查看/编辑/
           保存确认 + 规则 lint + 模板插入辅助 -->
      <section data-section="instructions">
        <h2>指令中心</h2>
        <p class="hint">层级（全局 → 项目就近覆盖）与规则文件（C22 user 档）集中编辑；保存前有确认面，新会话生效。</p>
        <h3>项目 AGENTS.md（<span id="instr-project-path">workspace</span>）</h3>
        <textarea id="instr-project" rows="5" placeholder="（项目级指令——F2 收集链最近层）"></textarea>
        <button class="instr-save" data-target="project-agents" type="button">保存项目指令</button>
        <button class="instr-tpl" data-target="project-agents" type="button">插入模板</button>
        <h3>全局 AGENTS.md（~/.aegent/AGENTS.md——最远层）</h3>
        <textarea id="instr-global" rows="5" placeholder="（全局指令——所有 workspace 生效）"></textarea>
        <button class="instr-save" data-target="global-agents" type="button">保存全局指令</button>
        <button class="instr-tpl" data-target="global-agents" type="button">插入模板</button>
        <h3>用户级规则（~/.aegent/rules.txt——每行 \`<code>规则 -&gt; allow|deny</code>\`）</h3>
        <textarea id="instr-rules" rows="5" placeholder="# 注释行；如：Bash(git status) -> allow"></textarea>
        <p id="instr-rules-lint" class="hint"></p>
        <button class="instr-save" data-target="user-rules" type="button">保存用户规则</button>
        <button class="instr-tpl" data-target="user-rules" type="button">插入模板</button>
      </section>
      <!-- U25/T-P3-128 快捷键系统：清单可查 + 自定义绑定（点击捕获按键）
           + 冲突提示（注册表冲突阻断 / 浏览器保留键提示不拦截） -->
      <section data-section="shortcuts">
        <h2>快捷键</h2>
        <ul id="shortcut-list"></ul>
        <p id="shortcut-status" class="hint">点击绑定进入捕获态——按新组合即改即存；Esc 取消捕获。</p>
        <button id="shortcut-reset" type="button">恢复默认键位</button>
        <p class="hint">发送键（Enter）为核心交互固定不可改；会话切换/新建会话无对应面（单会话 host 模型——历史侧栏即切换入口，记档）。</p>
      </section>
      <!-- U26/T-P3-129 语音设置（实验性）：STT 引擎配置（OpenAI 协议
           端点复用——P4 消费端）；TTS 播报最小面不落（卡内定形记档） -->
      <section data-section="speech">
        <h2>语音【实验性】</h2>
        <p class="hint">语音转文字（STT）——输入区 🎤 按钮录音后转写填入输入框；真实端点联调随 U8（配置在位即可用）。</p>
        <label>STT 端点根<input id="stt-baseurl" type="text" placeholder="（未配置——语音输入不可用）如 https://api.openai.com/v1" autocomplete="off" /></label>
        <label>转写模型<input id="stt-model" type="text" placeholder="如 whisper-1" autocomplete="off" /></label>
        <label>语言提示（BCP-47 可选）<input id="stt-language" type="text" placeholder="如 zh（缺省自动检测）" autocomplete="off" /></label>
        <p class="hint">端点 API key 请在「凭据」分节以 provider 名 <code>stt</code> 录入（零明文，同 U2 通道）。</p>
      </section>
      <!-- T-P3-133 插件管理：清单（transport/trust 徽标/错误行/启停/删除）
           + 安装表单（inprocess 目录 / ws URL）——I4/I5/I9 管理面延伸；
           市场远程渠道不建（YAGNI 裁决——本地/ws 安装最小化） -->
      <section data-section="plugins">
        <h2>插件</h2>
        <ul id="plugin-list"></ul>
        <form id="plugin-form">
          <label>装载方式
            <select id="plugin-transport">
              <option value="inprocess">进程内（目录：plugin.json + index.js）</option>
              <option value="ws">进程外（ws:// URL——I4 不可信隔离）</option>
            </select>
          </label>
          <input id="plugin-name" type="text" placeholder="插件名（唯一，不含 __）" autocomplete="off" />
          <input id="plugin-source" type="text" placeholder="装载源（目录绝对路径 或 ws://…）" autocomplete="off" />
          <label class="hint">ws 插件工具登记开关（不受信来源默认 deny——显式放行才登记工具）
            <input id="plugin-allowtools" type="checkbox" /></label>
          <button id="plugin-add" type="button">安装（先校验）</button>
        </form>
        <p class="hint">进程内插件目录约定：plugin.json（清单：name/trust/capabilities）+ index.js（入口，default 导出 AegentPlugin）。停用保留在清单；装载失败不影响启动（never-fail）。新会话生效。</p>
      </section>
      <!-- U17/T-P3-119 MCP 管理向导：分步添加（类型→参数→校验→保存）+
           统一面板（清单/启停/编辑/删除）；连接校验走 settings op:mcp-check -->
      <section data-section="mcp">
        <h2>MCP 服务器</h2>
        <ul id="mcp-list"></ul>
        <div id="mcp-wizard" hidden>
          <div id="mcp-step1">
            <label>类型
              <select id="mcp-type">
                <option value="stdio">stdio（本地命令）</option>
                <option value="http" disabled>http（mcp 域暂未支持——随 HTTP transport 扩展）</option>
              </select>
            </label>
            <input id="mcp-name" type="text" placeholder="名称（工具前缀，不含 __）" autocomplete="off" />
            <input id="mcp-command" type="text" placeholder="启动命令（如 node）" autocomplete="off" />
            <input id="mcp-args" type="text" placeholder="参数（空格分隔，如 /path/server.js）" autocomplete="off" />
            <button id="mcp-next" type="button">下一步：测连接</button>
          </div>
          <div id="mcp-step2" hidden>
            <p id="mcp-check-result" class="hint">未测试</p>
            <button id="mcp-test" type="button">测连接</button>
            <button id="mcp-save" type="button" disabled>保存</button>
            <button id="mcp-back" type="button">上一步</button>
          </div>
        </div>
        <button id="mcp-add" type="button">添加 server</button>
        <p class="hint">启停即时落档，新会话生效（子进程装配期连接注册；单 server 失败不影响启动）。</p>
      </section>
      <!-- U18/T-P3-120 辅助模型配置卡：判官/摘要任务与主对话模型分离
           （EnhancementModelCard / ADR 0121 行为锚）——缺省回退主模型 -->
      <section data-section="enhancement">
        <h2>辅助模型</h2>
        <p class="hint">判官/摘要等增强任务的模型独立配置（ADR 0121——"哪个模型做辅助工作、带多少推理"）；缺省回退主模型链（任务 model → 条目 model → 默认模型）。</p>
        <h3>判官（C42 两阶段复核）</h3>
        <label>供应商条目<input id="enh-judge-provider" type="text" placeholder="（未配置——判官落回人）" autocomplete="off" /></label>
        <label>模型<input id="enh-judge-model" type="text" placeholder="（回退条目/默认模型）" autocomplete="off" /></label>
        <label>推理档位
          <select id="enh-judge-reasoning">
            <option value="">（未设置）</option>
            <option value="minimal">minimal</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <h3>摘要（F5 上下文压缩摘要）</h3>
        <label>供应商条目<input id="enh-summarizer-provider" type="text" placeholder="（未配置——用主模型）" autocomplete="off" /></label>
        <label>模型<input id="enh-summarizer-model" type="text" placeholder="（回退条目/默认模型）" autocomplete="off" /></label>
        <label>推理档位
          <select id="enh-summarizer-reasoning">
            <option value="">（未设置）</option>
            <option value="minimal">minimal</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
      </section>
      <!-- U19/T-P3-121 Profiles 配置档：命名场景组合（provider+模型+权限+沙箱）
           切换 = 批量写生效段（applyProfile patch——providers 清单不动）；
           供应商列表 ↑↓ 排序 = 故障转移优先级（J15 队列序消费面） -->
      <section data-section="profiles">
        <h2>场景配置档</h2>
        <ul id="profile-list"></ul>
        <form id="profile-form">
          <input id="profile-name" type="text" placeholder="档名（如 coding / cheap）" autocomplete="off" />
          <input id="profile-provider" type="text" placeholder="默认供应商条目名" autocomplete="off" />
          <input id="profile-model" type="text" placeholder="默认模型（可选）" autocomplete="off" />
          <input id="profile-timeout" type="number" min="1000" step="1000" placeholder="审批超时 ms（可选）" />
          <select id="profile-network">
            <option value="">网络档：跟随全局（可选）</option>
            <option value="allow">allow</option>
            <option value="deny">deny</option>
          </select>
          <button id="profile-snapshot" type="button">填入当前生效值</button>
          <button type="submit">建档</button>
        </form>
        <p class="hint">建档 = 保存命名组合；切换 = 批量写回默认供应商/模型/权限/沙箱生效段（providers 清单不动；在途轮不受影响——新 turn 生效，J6 同款）。供应商列表的 ↑↓ 顺序 = 故障转移优先级（J15）。</p>
      </section>
      <!-- U20/T-P3-122 导入导出与深链分享：导出包零凭据 + 导入必确认
           （不可信输入面——摘要逐项列出后 confirm）+ 深链钩子 -->
      <section data-section="transfer">
        <h2>导入与导出</h2>
        <button id="export-btn" type="button">导出配置包</button>
        <span id="export-status" class="hint"></span>
        <hr />
        <label>选择配置包<input id="import-file" type="file" accept=".json,application/json" /></label>
        <pre id="import-preview" class="card-args" hidden></pre>
        <p id="import-summary" class="hint"></p>
        <button id="import-apply" type="button" hidden>确认导入（覆盖当前配置）</button>
        <p class="hint">导入前自动备份（settings.json.bak.0~4 滚动 5 份）；配置包不含凭据——换机请在各供应商条目重新录入 key。</p>
      </section>
      <section data-section="about">
        <h2>关于</h2>
        <p>aegent 0.1.0 —— 本地优先的 agent 工作台（事件即真相；配置即本页）。</p>
      </section>
    </div>
  </div>
</aside>
`;

// ---------------------------------------------------------------------------
// 设置域状态与保存时序（即改即存：段级 patch，500ms 防抖合并——原 app.js 体）
// ---------------------------------------------------------------------------

let saveTimer = null;
const dirtySections = new Set();

/** 改动 → 标脏 → 防抖合并成一次段级 update（即改即存的保存时序）。 */
function markDirty(section) {
  dirtySections.add(section);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSettings, 500);
}

async function flushSettings() {
  if (dirtySections.size === 0 || settingsCache === null) return;
  const patch = {};
  for (const section of dirtySections) {
    if (section === "defaultProvider") {
      patch.defaultProvider = settingsCache.defaultProvider;
    } else if (section === "projects" || section === "prompts") {
      patch[section] = settingsCache[section] ?? []; // 数组段缺省发空数组（对象段才发 {}）
    } else {
      patch[section] = settingsCache[section] ?? {};
    }
  }
  dirtySections.clear();
  const envelope = await sendSettings({ op: "update", patch });
  if (envelope.ok) {
    setSettingsCache(envelope.result.settings);
    applyTheme(settingsCache.appearance?.theme);
    rebuildKeymap(); // U25：shortcuts 段保存后键位同步
  } else {
    appendLine(`设置保存失败：${envelope.error?.message ?? ""}`, "warn");
  }
}

function renderProviderList() {
  const list = document.getElementById("provider-list");
  if (list === null) return; // 视图已卸载（异步回包晚于导航——静默丢弃）
  list.replaceChildren();
  for (const entry of settingsCache?.providers ?? []) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    const isDefault = settingsCache?.defaultProvider === entry.name;
    const health = providerHealth[entry.name];
    const dot = health ? { operational: "●", degraded: "◐", unreachable: "○" }[health.status] ?? "" : "";
    label.textContent =
      `${dot} ${entry.name}（${entry.adapter ?? "openai"}${entry.model ? ` · ${entry.model}` : ""}）` +
      (health && health.message ? ` ${health.message}` : "");
    const defaultBtn = document.createElement("button");
    defaultBtn.type = "button";
    defaultBtn.textContent = isDefault ? "★ 默认" : "设为默认";
    defaultBtn.className = isDefault ? "default-mark" : "";
    defaultBtn.addEventListener("click", () => {
      settingsCache.defaultProvider = entry.name;
      dirtySections.add("defaultProvider");
      renderProviderList();
      markDirty("defaultProvider");
    });
    // U5/T-P3-104：会话期切换（J6——model/switch 请求，立即受理新 turn 生效）
    const switchBtn = document.createElement("button");
    switchBtn.type = "button";
    switchBtn.textContent = "本会话切换";
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
    const healthBtn = document.createElement("button");
    healthBtn.type = "button";
    healthBtn.textContent = "测健康";
    healthBtn.addEventListener("click", () => void probeHealth(entry.name));
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", () => {
      settingsCache.providers = settingsCache.providers.filter((p) => p.name !== entry.name);
      if (isDefault) settingsCache.defaultProvider = undefined;
      dirtySections.add("providers");
      renderProviderList();
      markDirty("providers");
    });
    // U19/T-P3-121：故障转移优先级排序（数组序 = J15 队列序——可见可调）
    const orderIndex = settingsCache.providers.indexOf(entry);
    const moveBtn = (label2, delta) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label2;
      b.disabled =
        delta < 0 ? orderIndex === 0 : orderIndex === settingsCache.providers.length - 1;
      b.title = delta < 0 ? "故障转移优先级：上移" : "故障转移优先级：下移";
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
    li.append(
      label,
      defaultBtn,
      switchBtn,
      healthBtn,
      moveBtn("↑", -1),
      moveBtn("↓", 1),
      delBtn,
    );
    list.appendChild(li);
    // U5：编辑（点击条目名 → 表单回填 → 提交 = 条目更新，providers 段替换）
    label.style.cursor = "pointer";
    label.title = "点击编辑该条目";
    label.addEventListener("click", () => {
      editingProviderName = entry.name;
      document.getElementById("provider-name").value = entry.name;
      document.getElementById("provider-adapter").value = entry.adapter ?? "openai";
      document.getElementById("provider-baseurl").value = entry.baseUrl ?? "";
      document.getElementById("provider-model").value = entry.model ?? "";
      document.querySelector('#provider-form button[type="submit"]').textContent = "保存修改";
    });
  }
}

/** 编辑态（非 null = 表单在修改既有条目）。 */
let editingProviderName = null;

/** 健康探测结果缓存（UI 侧节流——每 provider 10s 内复用上次结果）。 */
const providerHealth = {};
const HEALTH_THROTTLE_MS = 10_000;

async function probeHealth(name) {
  const cached = providerHealth[name];
  const now = Date.now();
  if (cached && now - cached.at < HEALTH_THROTTLE_MS) return;
  const envelope = await sendSettings({ op: "probe", provider: name });
  if (envelope.ok) {
    const health = envelope.result.health;
    providerHealth[name] = { ...health, at: now };
    appendLine(`健康探测 ${name}：${health.message}`, health.status === "operational" ? "roster" : "warn");
  } else {
    providerHealth[name] = { status: "unreachable", message: envelope.error?.message ?? "探测失败", at: now, success: false };
    appendLine(`健康探测 ${name} 失败：${envelope.error?.message ?? ""}`, "warn");
  }
  renderProviderList();
}

function renderCredentialList(credentials) {
  const list = document.getElementById("credential-list");
  if (list === null) return;
  list.replaceChildren();
  for (const meta of credentials) {
    const li = document.createElement("li");
    li.textContent = `${meta.name}  ${meta.masked ?? ""}（更新于 ${meta.updatedAt}）`;
    list.appendChild(li);
  }
}

function fillSettingsForm() {
  document.getElementById("perm-timeout").value =
    settingsCache?.permission?.approvalTimeoutMs ?? "";
  document.getElementById("sandbox-network").value = settingsCache?.sandbox?.network ?? "";
  document.getElementById("sandbox-workspace").value = settingsCache?.sandbox?.workspace ?? "";
  document.getElementById("sandbox-db").value = settingsCache?.sandbox?.db ?? "";
  document.getElementById("appearance-theme").value = settingsCache?.appearance?.theme ?? "dark";
  document.getElementById("appearance-language").value = settingsCache?.appearance?.language ?? "zh-CN";
  document.getElementById("logging-rawdir").value = settingsCache?.logging?.rawLogDir ?? "";
  renderProviderList();
  renderProjectList();
  renderPromptList();
  renderMcpList();
  renderProfileList();
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
}

// U18：辅助模型三字段即改即存（enhancement 段整段合并——两任务互不覆盖）
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

// —— U26/T-P3-129 语音设置（实验性）：STT 配置即改即存（录音链在入口
//    app.js——Composer 域）；空配置 = 删除 stt 段（回退缺省）
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

// —— U19/T-P3-121 Profiles 组合档 + 故障转移优先级排序
function applyProfileValues(p) {
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
  for (const p of profiles) {
    const li = document.createElement("li");
    li.className = "profile-item";
    const isActive = settingsCache?.activeProfile === p.name;
    const label = document.createElement("span");
    label.textContent = `${isActive ? "★ " : ""}${p.name} → ${p.defaultProvider}${p.defaultModel ? `/${p.defaultModel}` : ""}${p.sandbox?.network ? `（网络 ${p.sandbox.network}）` : ""}`;
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.textContent = isActive ? "★ 当前" : "切换";
    applyBtn.className = isActive ? "default-mark" : "";
    applyBtn.addEventListener("click", () => {
      applyProfileValues(p);
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.className = "danger";
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
    li.append(label, applyBtn, delBtn);
    list.appendChild(li);
  }
  if (profiles.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "（无配置档——填表单或先填入当前生效值再建档）";
    list.appendChild(li);
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

/** 侧栏快速切换入口（app.js 经动态 import 调用——设置域归属本模块）。 */
export function applyQuickProfile(name) {
  const p = (settingsCache?.profiles ?? []).find((x) => x.name === name);
  if (p !== undefined) {
    applyProfileValues(p);
    toast(`已切换配置档：${p.name}`, "info");
  }
}

// —— U20/T-P3-122 导入导出与深链分享（导出零凭据；导入必确认——不可信输入）
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
function summarizeImported(s) {
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

async function applyImportedSettingsObject(importedSettings) {
  const envelope = await sendSettings({ op: "import", settings: importedSettings });
  if (!envelope.ok) {
    appendLine(`导入失败：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
    return false;
  }
  setSettingsCache(envelope.result.settings);
  markPromptsLoaded();
  applyTheme(settingsCache.appearance?.theme);
  rebuildKeymap(); // U25：导入后键位同步
  // 设置视图未挂载时跳过表单回填（下次 openSettings 全量重拉——无信息丢失）
  if (document.getElementById("provider-list") !== null) fillSettingsForm();
  return true;
}

/** 深链确认钩子的设置域实现（app.js 经动态 import 委派——宿主接线面）。 */
export async function applyDeepLink(encodedData) {
  try {
    const text = decodeURIComponent(encodedData);
    const parsed = JSON.parse(text);
    if (parsed?.kind !== "aegent-settings-export") throw new Error("kind 不符");
    const summary = summarizeImported(parsed.settings ?? {}).join("；");
    if (!window.confirm(`收到深链分享配置，确认导入？\n\n${summary}`)) return "dismissed";
    void applyImportedSettingsObject(parsed.settings).then(() => toast("配置导入完成", "info"));
    return "accepted";
  } catch (e) {
    appendLine(`深链导入失败：${e.message}`, "warn");
    return "rejected";
  }
}

// ---------------------------------------------------------------------------
// U11/T-P3-110 项目页：项目档 CRUD（projects 段整体替换）+ 设为活动
// ---------------------------------------------------------------------------

function renderProjectList() {
  const list = document.getElementById("project-list");
  if (list === null) return;
  list.replaceChildren();
  for (const p of settingsCache?.projects ?? []) {
    const li = document.createElement("li");
    const isActive = settingsCache?.activeProject === p.name;
    const label = document.createElement("span");
    label.textContent = `${isActive ? "★ " : ""}${p.name} → ${p.workspace}${p.instructions ? "（含指令）" : ""}`;
    const activateBtn = document.createElement("button");
    activateBtn.type = "button";
    activateBtn.textContent = isActive ? "★ 活动" : "设为活动";
    activateBtn.className = isActive ? "default-mark" : "";
    activateBtn.addEventListener("click", () => {
      settingsCache.activeProject = p.name;
      dirtySections.add("activeProject");
      renderProjectList();
      markDirty("activeProject");
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.className = "danger";
    delBtn.addEventListener("click", () => {
      settingsCache.projects = settingsCache.projects.filter((x) => x.name !== p.name);
      if (settingsCache.activeProject === p.name) settingsCache.activeProject = undefined;
      dirtySections.add("projects");
      dirtySections.add("activeProject");
      renderProjectList();
      markDirty("projects");
      markDirty("activeProject");
    });
    li.append(label, activateBtn, delBtn);
    list.appendChild(li);
    label.style.cursor = "pointer";
    label.title = "点击编辑该项目";
    label.addEventListener("click", () => {
      editingProjectName = p.name;
      document.getElementById("project-name").value = p.name;
      document.getElementById("project-workspace").value = p.workspace;
      document.getElementById("project-instructions").value = p.instructions ?? "";
      document.querySelector('#project-form button[type="submit"]').textContent = "保存修改";
    });
  }
}

let editingProjectName = null;

// —— U16/T-P3-118 提示词模板库（settings prompts 段整段替换——upsert 同名原位替换）
let editingPromptName = null;

function renderPromptList() {
  const list = document.getElementById("prompt-list");
  if (list === null) return;
  list.replaceChildren();
  for (const p of settingsCache?.prompts ?? []) {
    const li = document.createElement("li");
    li.className = "prompt-item";
    const label = document.createElement("span");
    label.textContent = `📝 ${p.name}${p.description ? `——${p.description}` : ""}`;
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.className = "danger";
    delBtn.addEventListener("click", () => {
      if (!window.confirm(`删除提示词模板「${p.name}」？`)) return;
      settingsCache.prompts = (settingsCache.prompts ?? []).filter((x) => x.name !== p.name);
      if (editingPromptName === p.name) editingPromptName = null;
      dirtySections.add("prompts");
      renderPromptList();
      markDirty("prompts");
    });
    li.append(label, delBtn);
    list.appendChild(li);
    label.style.cursor = "pointer";
    label.title = "点击编辑该模板";
    label.addEventListener("click", () => {
      editingPromptName = p.name;
      document.getElementById("prompt-name").value = p.name;
      document.getElementById("prompt-desc").value = p.description ?? "";
      document.getElementById("prompt-content").value = p.content;
      document.querySelector('#prompt-form button[type="submit"]').textContent = "保存修改";
    });
  }
  if ((settingsCache?.prompts ?? []).length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "（库为空——新增模板后在输入区 / 补全中调用）";
    list.appendChild(li);
  }
}

// —— U17/T-P3-119 MCP 管理向导 + 统一面板（连接校验走 settings op:"mcp-check"）
let editingMcpName = null;
let mcpWizardEntry = null; // 向导当前编辑的 {name, command, args}
let mcpTestOk = false;

function renderMcpList() {
  const list = document.getElementById("mcp-list");
  if (list === null) return;
  list.replaceChildren();
  for (const s of settingsCache?.mcp ?? []) {
    const li = document.createElement("li");
    li.className = "mcp-item";
    const label = document.createElement("span");
    label.textContent = `🔌 ${s.name} → ${s.command}${(s.args ?? []).length > 0 ? ` ${(s.args ?? []).join(" ")}` : ""}${s.enabled === false ? "（已停用）" : ""}`;
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.textContent = s.enabled === false ? "启用" : "停用";
    toggleBtn.addEventListener("click", () => {
      // 缺省启用（enabled 缺省 true）：停用写 false、启用删字段回缺省
      settingsCache.mcp = (settingsCache.mcp ?? []).map((x) => {
        if (x.name !== s.name) return x;
        if (x.enabled === false) {
          const { enabled: _omit, ...rest } = x;
          return rest;
        }
        return { ...x, enabled: false };
      });
      dirtySections.add("mcp");
      renderMcpList();
      markDirty("mcp");
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.className = "danger";
    delBtn.addEventListener("click", () => {
      if (!window.confirm(`删除 MCP server「${s.name}」？`)) return;
      settingsCache.mcp = (settingsCache.mcp ?? []).filter((x) => x.name !== s.name);
      dirtySections.add("mcp");
      renderMcpList();
      markDirty("mcp");
    });
    li.append(label, toggleBtn, delBtn);
    list.appendChild(li);
    label.style.cursor = "pointer";
    label.title = "点击编辑该 server";
    label.addEventListener("click", () => {
      editingMcpName = s.name;
      openMcpWizard(s);
    });
  }
  if ((settingsCache?.mcp ?? []).length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "（无 MCP server——点「添加 server」走向导）";
    list.appendChild(li);
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
}

// ---------------------------------------------------------------------------
// U22/T-P3-125 技能管理：清单（多根扫描 + 停用开关）+ 编辑器写回
//（op:"skill-save"）+ 来源目录 CRUD（settings skills.roots 段）。
// ---------------------------------------------------------------------------

/** 技能清单缓存（open 时刷新——文件系统面，不与会话期缓存混用）。 */
let skillsView = null;
let editingSkillName = null; // 非 null = 编辑器在改既有技能（同名覆盖）
const skillToolsSelected = new Set();

async function refreshSkillsList() {
  const envelope = await sendSettings({ op: "skills-list" });
  const list = document.getElementById("skill-list");
  if (list === null) return; // 视图已卸载（异步回包晚于导航——静默丢弃）
  list.replaceChildren();
  if (!envelope.ok) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = `技能清单不可用：${envelope.error?.message ?? ""}`;
    list.appendChild(li);
    return;
  }
  skillsView = envelope.result;
  for (const s of skillsView.skills) {
    const li = document.createElement("li");
    li.className = "skill-item";
    const label = document.createElement("span");
    const isWorkspace = s.origin === skillsView.roots[0];
    const disabled = skillsView.disabled.includes(s.name);
    label.textContent = `✨ ${s.name}${isWorkspace ? "" : "（外部来源）"}${disabled ? "（已停用）" : ""}——${s.description}`;
    // 启用开关（停用名单进 settings.skills.disabled——新会话装配生效）
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.textContent = disabled ? "启用" : "停用";
    toggleBtn.addEventListener("click", () => {
      const cur = new Set(settingsCache.skills?.disabled ?? []);
      if (cur.has(s.name)) cur.delete(s.name);
      else cur.add(s.name);
      settingsCache.skills = { ...(settingsCache.skills ?? {}), ...(cur.size > 0 ? { disabled: [...cur] } : {}) };
      dirtySections.add("skills");
      markDirty("skills");
      void refreshSkillsList();
    });
    // 工具集 chips（技能声明的工具集——清单元数据展示）
    const toolsRow = document.createElement("span");
    toolsRow.className = "skill-tools";
    for (const t of s.tools ?? []) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = t;
      toolsRow.appendChild(chip);
    }
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "编辑";
    editBtn.addEventListener("click", () => {
      void openSkillEditor(s);
    });
    li.append(label, toolsRow, toggleBtn, editBtn);
    list.appendChild(li);
  }
  if (skillsView.skills.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "（无技能——新建或添加来源目录；workspace/.zcode/skills 下的 SKILL.md 自动发现）";
    list.appendChild(li);
  }
  for (const d of skillsView.diagnostics) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = `诊断 [${d.code}] ${d.path}——${d.message}`;
    list.appendChild(li);
  }
}

function renderSkillRoots() {
  const list = document.getElementById("skill-roots");
  if (list === null) return;
  list.replaceChildren();
  const roots = settingsCache?.skills?.roots ?? [];
  for (const r of roots) {
    const li = document.createElement("li");
    li.textContent = r;
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.className = "danger";
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
    li.appendChild(delBtn);
    list.appendChild(li);
  }
  if (roots.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "（无附加来源——workspace 主目录恒在）";
    list.appendChild(li);
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
    chip.className = selected ? "chip active" : "chip";
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
// U23/T-P3-126 子智能体管理：内置五预设卡（开关/工具 chips/覆盖编辑）+
// 用户自定义 CRUD + per-subagent 模型与 fallback 链（settings subagents 段）。
// ---------------------------------------------------------------------------

let subagentsView = null; // subagents-list 缓存（open 时刷新）
let editingSubagentName = null; // 非 null = 编辑既有条目（同名覆盖）
const subagentToolsSelected = new Set();

async function refreshSubagentsList() {
  const envelope = await sendSettings({ op: "subagents-list" });
  const list = document.getElementById("subagent-list");
  if (list === null) return;
  list.replaceChildren();
  if (!envelope.ok) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = `子代理清单不可用：${envelope.error?.message ?? ""}`;
    list.appendChild(li);
    return;
  }
  subagentsView = envelope.result;
  for (const b of subagentsView.builtins) {
    const li = document.createElement("li");
    li.className = "skill-item";
    const label = document.createElement("span");
    label.textContent = `🤖 ${b.name}（内置）——${b.description}${b.enabled ? "" : "（已停用）"}${b.overridden ? "（已自定义覆盖）" : ""}`;
    const toolsRow = document.createElement("span");
    toolsRow.className = "skill-tools";
    for (const t of b.tools ?? []) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = t;
      toolsRow.appendChild(chip);
    }
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.textContent = b.enabled ? "停用" : "启用";
    toggleBtn.addEventListener("click", () => {
      // 停用 = 写同名覆盖记录（enabled:false——最简形状）；启用 = 移除记录
      const defs = (settingsCache.subagents ?? []).filter((d) => d.name !== b.name);
      if (b.enabled) defs.push({ name: b.name, enabled: false });
      settingsCache.subagents = defs;
      dirtySections.add("subagents");
      markDirty("subagents");
      void refreshSubagentsList();
    });
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "编辑";
    editBtn.addEventListener("click", () => openSubagentEditor(b, true));
    li.append(label, toolsRow, toggleBtn, editBtn);
    list.appendChild(li);
  }
  for (const c of subagentsView.custom) {
    const li = document.createElement("li");
    li.className = "skill-item";
    const label = document.createElement("span");
    label.textContent = `🤖 ${c.name}（自定义）——${c.description ?? ""}${c.modelProvider ? `［模型 ${c.modelProvider}${c.model ? `/${c.model}` : ""}］` : ""}`;
    const toolsRow = document.createElement("span");
    toolsRow.className = "skill-tools";
    for (const t of c.tools ?? []) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = t;
      toolsRow.appendChild(chip);
    }
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "编辑";
    editBtn.addEventListener("click", () => openSubagentEditor(c, false));
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.className = "danger";
    delBtn.addEventListener("click", () => {
      if (!window.confirm(`删除自定义子代理「${c.name}」？`)) return;
      settingsCache.subagents = (settingsCache.subagents ?? []).filter((d) => d.name !== c.name);
      dirtySections.add("subagents");
      markDirty("subagents");
      void refreshSubagentsList();
    });
    li.append(label, toolsRow, editBtn, delBtn);
    list.appendChild(li);
  }
}

async function openSubagentEditor(def, isBuiltin) {
  editingSubagentName = isBuiltin ? def.name : def.name;
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
    chip.className = selected ? "chip active" : "chip";
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

// —— U25/T-P3-128 快捷键分节：清单（可查）+ 捕获态改绑（自定义）+
// 冲突提示（注册表冲突阻断 / 保留键提示不拦截）
let capturingAction = null; // 非 null = 捕获态（下一次按键即新绑定）
let capturedCombo = null; // 捕获到的规范 combo（未保存）

function renderShortcutList() {
  const list = document.getElementById("shortcut-list");
  if (list === null) return;
  const status = document.getElementById("shortcut-status");
  list.replaceChildren();
  const bindings = createKeymap(settingsCache?.shortcuts);
  for (const [action, label] of Object.entries(ACTION_LABELS)) {
    const li = document.createElement("li");
    li.className = "skill-item";
    const name = document.createElement("span");
    const fixed = action === "send";
    const combo = fixed ? "Enter" : bindings[action] ?? "";
    name.textContent = `⌨ ${label}：${combo}${fixed ? "（固定）" : ""}`;
    li.appendChild(name);
    const conflictInfo = !fixed ? detectConflict(combo, bindings, action) : {};
    if (conflictInfo.conflict !== undefined) {
      const warn = document.createElement("span");
      warn.className = "hint";
      warn.textContent = `⚠ 与「${ACTION_LABELS[conflictInfo.conflict]}」冲突`;
      li.appendChild(warn);
    }
    if (conflictInfo.reserved === true) {
      const warn = document.createElement("span");
      warn.className = "hint";
      warn.textContent = "（浏览器保留键——提示不拦截，请自测）";
      li.appendChild(warn);
    }
    if (!fixed) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      if (capturingAction === action) {
        editBtn.textContent = capturedCombo ?? "按键…";
        editBtn.className = "default-mark";
      } else {
        editBtn.textContent = "修改";
        editBtn.addEventListener("click", () => {
          capturingAction = action;
          capturedCombo = null;
          status.textContent = `捕获中：为「${label}」按新组合（Esc 取消）`;
          renderShortcutList();
        });
      }
      li.appendChild(editBtn);
    }
    list.appendChild(li);
  }
}

/** 捕获态键监听（捕获阶段抢先于分发监听——render 时挂载/unmount 时移除）。 */
function shortcutCaptureKeydown(ev) {
  if (capturingAction === null) return;
  // 捕获态：Esc 空手取消；纯修饰键等待；组合转规范 combo 后即存
  if (ev.key === "Escape") {
    capturingAction = null;
    capturedCombo = null;
    const status = document.getElementById("shortcut-status");
    if (status !== null) {
      status.textContent = "点击绑定进入捕获态——按新组合即改即存；Esc 取消捕获。";
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

// —— T-P3-133 插件管理：清单（安装期校验诊断 + 启停/删除）+ 安装表单
//（inprocess 目录 / ws URL——settings plugins 段，新会话装载生效）

async function refreshPluginsList() {
  const envelope = await sendSettings({ op: "plugins-list" });
  const list = document.getElementById("plugin-list");
  if (list === null) return;
  list.replaceChildren();
  if (!envelope.ok) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = `插件清单不可用：${envelope.error?.message ?? ""}`;
    list.appendChild(li);
    return;
  }
  const plugins = envelope.result;
  for (const p of plugins) {
    const li = document.createElement("li");
    li.className = "skill-item";
    const label = document.createElement("span");
    const trustTag = p.manifest ? `［trust: ${p.manifest.trust}］` : "";
    label.textContent = `🔌 ${p.name}（${p.transport === "ws" ? "进程外 ws" : "进程内"}）${trustTag}${p.enabled ? "" : "（已停用）"} → ${p.source}`;
    li.appendChild(label);
    if (p.error) {
      const err = document.createElement("span");
      err.className = "hint";
      err.textContent = `⚠ ${p.error}`;
      li.appendChild(err);
    } else if (p.manifest) {
      const caps = document.createElement("span");
      caps.className = "skill-tools";
      for (const c of p.manifest.capabilities ?? []) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = c;
        caps.appendChild(chip);
      }
      li.appendChild(caps);
    }
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.textContent = p.enabled ? "停用" : "启用";
    toggleBtn.addEventListener("click", () => {
      // 停用写 enabled:false、启用删键回缺省（mcp 启停同模式）
      const defs = (settingsCache.plugins ?? []).map((d) => {
        if (d.name !== p.name) return d;
        if (d.enabled === false) {
          const { enabled: _omit, ...rest } = d;
          return rest;
        }
        return { ...d, enabled: false };
      });
      settingsCache.plugins = defs;
      dirtySections.add("plugins");
      markDirty("plugins");
      void refreshPluginsList();
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.className = "danger";
    delBtn.addEventListener("click", () => {
      if (!window.confirm(`从装载清单移除插件「${p.name}」？（不删除插件目录文件）`)) return;
      settingsCache.plugins = (settingsCache.plugins ?? []).filter((d) => d.name !== p.name);
      dirtySections.add("plugins");
      markDirty("plugins");
      void refreshPluginsList();
    });
    li.append(toggleBtn, delBtn);
    list.appendChild(li);
  }
  if (plugins.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "（未安装插件——填表单安装：进程内目录或进程外 ws URL）";
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// 视图生命周期：render（挂载 + 事件绑定 + open 数据拉取）/ unmount（收尾保存）
// ---------------------------------------------------------------------------

/** 二级分类导航：滚动定位 + 激活态（深链 #settings/<section> 同入口）。 */
function navigateToSection(sectionId) {
  const section = document.querySelector(`#settings-panel [data-section="${sectionId}"]`);
  if (section === null) return;
  for (const btn of document.querySelectorAll("#settings-panel .settings-nav .nav-item")) {
    btn.classList.toggle("active", btn.dataset.nav === sectionId);
  }
  section.scrollIntoView({ block: "start" });
}

async function open() {
  const envelope = await sendSettings({ op: "get" });
  if (!envelope.ok) {
    appendLine(`设置读取失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  setSettingsCache(envelope.result.settings);
  markPromptsLoaded();
  applyTheme(settingsCache.appearance?.theme);
  rebuildKeymap(); // U25：键位表随 settings 就绪
  fillSettingsForm();
  renderShortcutList();
  const creds = await sendSettings({ op: "credentials-list" });
  if (creds.ok) renderCredentialList(creds.result.credentials ?? []);
  renderSkillRoots();
  void refreshSkillsList(); // U22：技能清单（文件系统面——每次打开刷新）
  void refreshSubagentsList(); // U23：子代理清单（内置+自定义——每次打开刷新）
  void refreshPluginsList(); // T-P3-133：插件清单（安装期校验诊断——每次打开刷新）
  void openInstructionsOnce(); // U24：指令中心（打开时拉一次，保存后局部刷新）
}

function bindEvents() {
  document.getElementById("settings-close").addEventListener("click", () => {
    go("chat"); // unmount 收尾保存（原"关面板前 flushSettings"语义）
  });

  // 二级分类导航
  for (const btn of document.querySelectorAll("#settings-panel .settings-nav .nav-item")) {
    btn.addEventListener("click", () => navigateToSection(btn.dataset.nav));
  }

  // 供应商新增/编辑（providers 段整体替换——列表语义）
  document.getElementById("provider-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = document.getElementById("provider-name").value.trim();
    if (name === "" || !/^[A-Za-z0-9_.-]{1,64}$/.test(name)) return;
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
    document.getElementById("provider-form").reset();
    document.querySelector('#provider-form button[type="submit"]').textContent = "新增";
    renderProviderList();
    markDirty("providers");
  });

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
  // U14/T-P3-132（#28）：日志分节（E14 原始分片目录持久化位——即改即存）
  document.getElementById("logging-rawdir").addEventListener("change", (ev) => {
    const value = ev.target.value.trim();
    settingsCache.logging = { ...settingsCache.logging, ...(value !== "" ? { rawLogDir: value } : {}) };
    markDirty("logging");
  });

  enhancementInputHandler("enh-judge", "judge", "provider");
  enhancementInputHandler("enh-judge", "judge", "model");
  enhancementInputHandler("enh-judge", "judge", "reasoning");
  enhancementInputHandler("enh-summarizer", "summarizer", "provider");
  enhancementInputHandler("enh-summarizer", "summarizer", "model");
  enhancementInputHandler("enh-summarizer", "summarizer", "reasoning");
  sttInputHandler("baseurl");
  sttInputHandler("model");
  sttInputHandler("language");

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
    // 导入必确认（cc-switch deeplink 三确认行为锚——不可信输入逐项列出后确认）
    if (!window.confirm(`确认导入以下配置并覆盖当前值？\n\n${summary}\n\n（导入前自动备份当前配置）`)) return;
    void applyImportedSettingsObject(parsed.settings).then((ok) => {
      if (ok) {
        ev.target.hidden = true;
        const summaryEl = document.getElementById("import-summary");
        if (summaryEl !== null) summaryEl.textContent = "✔ 导入完成（备份已滚动）";
        toast("配置导入完成", "info");
      }
    });
  });

  document.getElementById("project-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = document.getElementById("project-name").value.trim();
    const workspace = document.getElementById("project-workspace").value.trim();
    const instructions = document.getElementById("project-instructions").value.trim();
    if (name === "" || workspace === "") return;
    const entry = { name, workspace, ...(instructions !== "" ? { instructions } : {}) };
    const rest = (settingsCache.projects ?? []).filter((p) => p.name !== name && p.name !== editingProjectName);
    settingsCache.projects = [...rest, entry];
    editingProjectName = null;
    document.getElementById("project-form").reset();
    document.querySelector('#project-form button[type="submit"]').textContent = "新增";
    renderProjectList();
    markDirty("projects");
  });

  document.getElementById("prompt-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = document.getElementById("prompt-name").value.trim();
    const desc = document.getElementById("prompt-desc").value.trim();
    const content = document.getElementById("prompt-content").value;
    if (name === "" || content.trim() === "") return;
    const prompts = (settingsCache.prompts ?? []).filter((x) => x.name !== name);
    prompts.push({ name, content, ...(desc !== "" ? { description: desc } : {}) });
    settingsCache.prompts = prompts;
    editingPromptName = null;
    document.getElementById("prompt-name").value = "";
    document.getElementById("prompt-desc").value = "";
    document.getElementById("prompt-content").value = "";
    document.querySelector('#prompt-form button[type="submit"]').textContent = "新增";
    dirtySections.add("prompts");
    renderPromptList();
    markDirty("prompts");
  });

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
        document.getElementById("mcp-save").disabled = false;
        resultEl.textContent = `✔ 连接成功（协议 ${check.protocolVersion}，${(check.tools ?? []).length} 个工具）`;
      } else {
        resultEl.textContent = `✘ 连接失败：${check.error?.message ?? ""}`;
      }
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

  for (const btn of document.querySelectorAll(".instr-save")) {
    btn.addEventListener("click", async () => {
      const target = btn.dataset.target;
      const content = document.getElementById(INSTR_TARGETS[target]).value;
      // 保存确认面（U24 卡面要求——覆盖用户文件前显式确认）
      if (!window.confirm(`确认保存到「${INSTR_TARGET_LABEL[target]}」？\n（保存后新会话生效；目标：覆盖写入）`)) return;
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

  document.getElementById("shortcut-reset").addEventListener("click", () => {
    if (!window.confirm("恢复全部默认键位？（清除所有自定义绑定）")) return;
    settingsCache.shortcuts = {};
    delete settingsCache.shortcuts;
    dirtySections.add("shortcuts");
    markDirty("shortcuts");
    document.getElementById("shortcut-status").textContent = "已恢复默认键位。";
    renderShortcutList();
  });

  document.getElementById("plugin-add").addEventListener("click", async () => {
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
    const nameInput = document.getElementById("plugin-name");
    if (nameInput === null) return; // 回包晚于导航——缓存已写，无需 UI 收尾
    nameInput.value = "";
    document.getElementById("plugin-source").value = "";
    dirtySections.add("plugins");
    markDirty("plugins");
    toast(`插件已加入装载清单：${name}（新会话生效）`, "info");
    void refreshPluginsList();
    void preview;
  });

  // U25：捕获态键监听（render 时挂载——unmount 时移除）
  window.addEventListener("keydown", shortcutCaptureKeydown, true);
}

export async function render(container, route) {
  container.innerHTML = TEMPLATE;
  bindEvents();
  await open();
  // 深链 #settings/<section>：就位后滚动定位
  if (route?.section) navigateToSection(route.section);
}

export function unmount() {
  void flushSettings(); // 关面板前收尾保存（原 settings-close 语义——导航通用化）
  window.removeEventListener("keydown", shortcutCaptureKeydown, true);
  capturingAction = null; // 捕获态不跨视图存活
  capturedCombo = null;
}
