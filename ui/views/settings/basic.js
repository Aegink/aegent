/**
 * 基础设置组（T-P3-135 · UI 批次 B③④；T-P3-137 供应商分节迁出为独立
 * 子模块 providers.js——本文件保留 credentials/permission/sandbox/
 * appearance/profiles 五分节）：行式卡母版（row-list/row 消费
 * components.css）。数据面逻辑原样：providers 段整体替换语义在 providers
 * 模块、profiles applyProfile 批量写生效段在此。
 */

import { sendSettings } from "../../api.js";
import { settingsCache, applyTheme, applyAppearance, getSessionId } from "../../state.js";
import { sendRequest } from "../../api.js";
import { toast } from "../../feedback.js";
import { t, applyLocalePreference } from "../../i18n.js";
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
  switchEl,
} from "./core.js";
import { refreshCredentials as refreshProviderCredentials } from "./providers.js";

/** 行标题构造（rowCopyEl 的标题位——本文件多处复用）。 */
function rowTitleEl(text) {
  const el = document.createElement("div");
  el.className = "row-title";
  el.textContent = text;
  return el;
}

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
  <div class="section-head"><h2 class="section-title" data-i18n="外观与语言">外观与语言</h2></div>

  <div class="group-title" data-i18n="主题与外观">主题与外观</div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title" data-i18n="主题模式">主题模式</div>
        <div class="row-desc" data-i18n="跟随系统深浅色自动切换（推荐）">跟随系统深浅色自动切换（推荐）</div>
      </div>
      <div class="row-control">
        <select id="appearance-theme-mode" class="select">
          <option value="system" data-i18n="跟随系统">跟随系统</option>
          <option value="dark" data-i18n="暗色">暗色</option>
          <option value="light" data-i18n="亮色">亮色</option>
          <option value="schedule" data-i18n="按时间表">按时间表</option>
        </select>
      </div>
    </div>
    <div class="row" id="appearance-schedule-light-row" hidden>
      <div class="row-copy">
        <div class="row-title" data-i18n="浅色开始">浅色开始</div>
        <div class="row-desc" data-i18n="跨午夜区间合法（如 22:00 → 06:00）">跨午夜区间合法（如 22:00 → 06:00）</div>
      </div>
      <div class="row-control"><input id="appearance-schedule-light" class="input" type="time" value="07:00" /></div>
    </div>
    <div class="row" id="appearance-schedule-dark-row" hidden>
      <div class="row-copy">
        <div class="row-title" data-i18n="暗色开始">暗色开始</div>
      </div>
      <div class="row-control"><input id="appearance-schedule-dark" class="input" type="time" value="19:00" /></div>
    </div>
  </div>
  <div class="group-title" data-i18n="皮肤">皮肤</div>
  <p class="hint" data-i18n="皮肤决定整套界面色板（随主题模式给出暗/亮变体）">皮肤决定整套界面色板（随主题模式给出暗/亮变体）</p>
  <div id="appearance-skin-list" class="tile-list"></div>
  <div class="group-title" data-i18n="强调色">强调色</div>
  <p class="hint" data-i18n="强调色影响主色、焦点环、链接与图表首色">强调色影响主色、焦点环、链接与图表首色</p>
  <div id="appearance-accent-list" class="row-list"></div>
  <div class="group-title" data-i18n="插件主题">插件主题</div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title" data-i18n="插件主题">插件主题</div>
        <div class="row-desc" data-i18n="主题由插件贡献（插件管理页安装）——停用插件即回退基础主题">主题由插件贡献（插件管理页安装）——停用插件即回退基础主题</div>
      </div>
      <div class="row-control">
        <select id="appearance-plugin-theme" class="select">
          <option value="" data-i18n="不使用">不使用</option>
        </select>
      </div>
    </div>
  </div>

  <div class="group-title" data-i18n="语言">语言</div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title" data-i18n="界面语言">界面语言</div>
        <div class="row-desc" data-i18n="切换后整页刷新生效（未翻译文案暂显示中文）">切换后整页刷新生效（未翻译文案暂显示中文）</div>
      </div>
      <div class="row-control">
        <select id="appearance-language" class="select">
          <option value="system" data-i18n="跟随系统">跟随系统</option>
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
        </select>
      </div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title" data-i18n="回复语言">回复语言</div>
        <div class="row-desc" data-i18n="内核输出语言——与界面语言分离（qwen outputLanguage 同构）">内核输出语言——与界面语言分离（qwen outputLanguage 同构）</div>
      </div>
      <div class="row-control">
        <select id="appearance-output-language" class="select">
          <option value="auto" data-i18n="自动跟随">自动跟随</option>
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
        </select>
      </div>
    </div>
  </div>
  <p class="hint" data-i18n="模型始终用该语言回复（代码与标识符除外）；自动 = 跟随你的输入">模型始终用该语言回复（代码与标识符除外）；自动 = 跟随你的输入</p>

  <div class="group-title" data-i18n="字体与字号">字体与字号</div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title" data-i18n="界面字号">界面字号</div>
        <div class="row-desc" data-i18n="只缩放文字（间距/图标不缩放——zcode 安全缩放同款）">只缩放文字（间距/图标不缩放——zcode 安全缩放同款）</div>
      </div>
      <div class="row-control" id="appearance-font-size"></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title" data-i18n="界面字体">界面字体</div>
      </div>
      <div class="row-control">
        <select id="appearance-font-base-select" class="select">
          <option value="" data-i18n="默认">默认</option>
          <option value="sans" data-i18n="无衬线">无衬线</option>
          <option value="serif" data-i18n="衬线">衬线</option>
          <option value="custom" data-i18n="自定义">自定义</option>
        </select>
      </div>
    </div>
    <div class="row" id="appearance-font-base-row" hidden>
      <div class="row-copy"><div class="row-title"></div></div>
      <div class="row-control"><input id="appearance-font-base" class="input input-wide" type="text" data-i18n-placeholder="输入字体名，如 Consolas" placeholder="输入字体名，如 Consolas" autocomplete="off" /></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title" data-i18n="等宽字体（代码/终端）">等宽字体（代码/终端）</div>
      </div>
      <div class="row-control">
        <select id="appearance-font-mono-select" class="select">
          <option value="" data-i18n="默认">默认</option>
          <option value="custom" data-i18n="自定义">自定义</option>
        </select>
      </div>
    </div>
    <div class="row" id="appearance-font-mono-row" hidden>
      <div class="row-copy"><div class="row-title"></div></div>
      <div class="row-control"><input id="appearance-font-mono" class="input input-wide" type="text" data-i18n-placeholder="自定义字体名，如 JetBrains Mono" placeholder="自定义字体名，如 JetBrains Mono" autocomplete="off" /></div>
    </div>
  </div>
  <p class="hint" data-i18n="自定义字体自动追加中文回退链（防中文落宋体）">自定义字体自动追加中文回退链（防中文落宋体）</p>

  <div class="group-title" data-i18n="消息流">消息流</div>
  <div id="appearance-stream-list" class="row-list"></div>

  <div class="group-title" data-i18n="无障碍">无障碍</div>
  <div id="appearance-a11y-list" class="row-list"></div>

  <div class="group-title" data-i18n="背景图">背景图</div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title" data-i18n="背景图">背景图</div>
        <div class="row-desc" data-i18n="背景图只铺对话区（内容面保持底色——浮层可读性优先）；png/jpeg/webp ≤ 3MB">背景图只铺对话区（内容面保持底色——浮层可读性优先）；png/jpeg/webp ≤ 3MB</div>
      </div>
      <div class="row-control">
        <input id="appearance-bg-file" type="file" accept="image/png,image/jpeg,image/webp" hidden />
        <button id="appearance-bg-pick" type="button" class="btn" data-i18n="选择图片…">选择图片…</button>
        <button id="appearance-bg-clear" type="button" class="btn btn-danger" data-i18n="清除">清除</button>
      </div>
    </div>
    <div class="row" id="appearance-bg-opacity-row" hidden>
      <div class="row-copy">
        <div class="row-title" data-i18n="图片可见度">图片可见度</div>
      </div>
      <div class="row-control"><input id="appearance-bg-opacity" class="input" type="range" min="10" max="100" step="5" value="60" /></div>
    </div>
  </div>
</section>
<section data-section="profiles">
  <div class="section-head"><h2 class="section-title">场景配置档</h2></div>
  <div id="profile-list" class="row-list"></div>
  <form id="profile-form" class="card-box form-grid">
    <input id="profile-name" class="input" type="text" placeholder="档名（如 coding / cheap）" autocomplete="off" />
    <select id="profile-provider" class="select" aria-label="供应商">
      <option value="">选择供应商…</option>
    </select>
    <select id="profile-model" class="select" aria-label="默认模型">
      <option value="">默认模型（可选）</option>
    </select>
    <select id="profile-mode" class="select" aria-label="权限模式">
      <option value="">权限模式：不捆绑（可选）</option>
      <option value="ask">权限：每次询问</option>
      <option value="accept-edits">权限：自动批编辑</option>
      <option value="read-only">权限：只读</option>
      <option value="auto">权限：全自动</option>
      <option value="unattended">权限：无人值守</option>
    </select>
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
    <div id="profile-resource-list" class="profile-resources"></div>
    <div class="form-actions">
      <button id="profile-snapshot" type="button" class="btn">填入当前生效值</button>
      <button type="submit" class="btn btn-primary">建档</button>
    </div>
  </form>
  <p class="hint">建档 = 保存命名组合（供应商/模型下拉选自注册表）。<strong>资源捆绑</strong>：每组可单独开「捆绑」并勾选成员——未开的组切换时<strong>不动</strong>，开了的组按勾选落盘（MCP/插件=启用集，技能=停用名单；资源新会话生效）；「填入当前生效值」= 三组全部按当前状态拍入。切换 = 批量写回生效段 + <strong>当前会话热应用</strong>（权限/沙箱/模型即时）；<strong>切走前自动把当前状态存回旧档</strong>（无损往返）。行内「编辑」回填表单可改任意字段，「复制」克隆一份。</p>
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
// 外观（T-P3-141 批次 A~F——pideck 三属性 + zcode i18n/pi-desktop 字号同构；
// 皮肤/强调色闭集与 ui/theme.css 的 data-appearance/data-accent 块同源——
// 前端零构建链复制，改动需两侧同步）。改字段即 applyAppearance 即时预览
//（codex/opencode picker 的"改即见效"），500ms 防抖统一落盘。
// ---------------------------------------------------------------------------

const SKIN_PRESETS = [
  { id: "", label: "默认", chips: ["#171717", "#262626", "#0ea5e9", "#e5e5e5"] },
  { id: "catppuccin", label: "Catppuccin", chips: ["#1e1e2e", "#313244", "#89b4fa", "#cdd6f4"] },
  { id: "tokyonight", label: "Tokyonight", chips: ["#1a1b26", "#24283b", "#7aa2f7", "#c0caf5"] },
  { id: "nord", label: "Nord", chips: ["#2e3440", "#3b4252", "#88c0d0", "#eceff4"] },
  { id: "solarized", label: "Solarized", chips: ["#002b36", "#073642", "#268bd2", "#eee8d5"] },
];
const ACCENT_PRESETS = [
  { id: "", color: "#0ea5e9", label: "Sky" },
  { id: "green", color: "#22c55e", label: "Green" },
  { id: "violet", color: "#a78bfa", label: "Violet" },
  { id: "amber", color: "#f59e0b", label: "Amber" },
  { id: "rose", color: "#fb7185", label: "Rose" },
  { id: "cyan", color: "#22d3ee", label: "Cyan" },
];
const FONT_SIZES = [12, 14, 16, 18];

function setAppearanceField(field, value) {
  settingsCache.appearance = { ...(settingsCache.appearance ?? {}), [field]: value };
  applyAppearance(); // 即时预览——保存走 markDirty 防抖
  markDirty("appearance");
}

function renderSkinList() {
  const box = document.getElementById("appearance-skin-list");
  if (box === null) return;
  box.replaceChildren();
  const current = settingsCache?.appearance?.skin ?? "";
  for (const skin of SKIN_PRESETS) {
    const row = rowEl();
    const titleEl = rowTitleEl(skin.label);
    if (current === skin.id) titleEl.appendChild(chipEl(t("当前"), true));
    const chips = document.createElement("span");
    chips.className = "skin-chips";
    for (const color of skin.chips) {
      const dot = document.createElement("span");
      dot.className = "skin-chip";
      dot.style.background = color;
      chips.appendChild(dot);
    }
    titleEl.appendChild(chips);
    const useBtn = btnEl(current === skin.id ? t("使用中") : t("启用"), "btn", `切换皮肤 ${skin.label}`);
    useBtn.disabled = current === skin.id;
    useBtn.addEventListener("click", () => {
      setAppearanceField("skin", skin.id);
      renderSkinList();
    });
    // desc 位给色板预览文案（rowCopyEl 双节点契约——缺省 append undefined 陷阱）
    row.append(
      rowCopyEl(titleEl, Object.assign(document.createElement("div"), { className: "row-desc" })),
      rowControl(useBtn),
    );
    box.appendChild(row);
  }
}

function renderAccentList() {
  const box = document.getElementById("appearance-accent-list");
  if (box === null) return;
  box.replaceChildren();
  const row = rowEl();
  const wrap = document.createElement("div");
  wrap.className = "accent-swatches";
  const current = settingsCache?.appearance?.accent ?? "";
  for (const preset of ACCENT_PRESETS) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = `accent-swatch${current === preset.id ? " active" : ""}`;
    swatch.style.background = preset.color;
    swatch.title = preset.label;
    swatch.setAttribute("aria-label", preset.label);
    swatch.addEventListener("click", () => {
      setAppearanceField("accent", preset.id);
      renderAccentList();
    });
    wrap.appendChild(swatch);
  }
  row.append(
    rowCopyEl(rowTitleEl(t("强调色")), Object.assign(document.createElement("div"), { className: "row-desc" })),
    rowControl(wrap),
  );
  box.appendChild(row);
}

function renderFontSize() {
  const box = document.getElementById("appearance-font-size");
  if (box === null) return;
  box.replaceChildren();
  const current = settingsCache?.appearance?.uiFontSize ?? 14;
  const wrap = document.createElement("div");
  wrap.className = "font-size-seg";
  const labels = { 12: t("小"), 14: t("标准"), 16: t("大"), 18: t("特大") };
  for (const size of FONT_SIZES) {
    const btn = btnEl(labels[size], `btn${current === size ? " active-mark" : ""}`, `UI 字号 ${size}px`);
    btn.disabled = current === size;
    btn.addEventListener("click", () => {
      setAppearanceField("uiFontSize", size);
      renderFontSize();
    });
    wrap.appendChild(btn);
  }
  box.appendChild(wrap);
}

function renderToggleRow(box, titleKey, descKey, field, checked, extra) {
  const row = rowEl();
  const titleEl = rowTitleEl(t(titleKey));
  const desc = document.createElement("div");
  desc.className = "row-desc";
  desc.textContent = t(descKey);
  const toggle = switchEl(checked, (next) => {
    setAppearanceField(field, next);
    renderStreamAndA11y();
    if (extra) extra(next);
  }, t(titleKey));
  row.append(rowCopyEl(titleEl, desc), rowControl(toggle));
  box.appendChild(row);
}

function renderStreamAndA11y() {
  const stream = document.getElementById("appearance-stream-list");
  if (stream !== null) {
    stream.replaceChildren();
    const a = settingsCache?.appearance ?? {};
    renderToggleRow(stream, "显示推理过程", "关闭后隐藏模型推理段（数据仍保留，随时可开回）", "chatShowReasoning", a.chatShowReasoning !== false);
    renderToggleRow(stream, "显示时间戳", "每条消息气泡尾部显示发送时间", "showTimestamps", a.showTimestamps === true);
    // 会话宽度（三档 select）
    const widthRow = rowEl();
    const widthSel = document.createElement("select");
    widthSel.className = "select";
    widthSel.setAttribute("aria-label", t("会话宽度"));
    for (const [value, label] of [
      ["default", t("标准（820px）")],
      ["wide", t("宽（1100px）")],
      ["full", t("全宽")],
    ]) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      widthSel.appendChild(o);
    }
    widthSel.value = a.chatContentWidth ?? "default";
    widthSel.addEventListener("change", () => {
      setAppearanceField("chatContentWidth", widthSel.value);
    });
    widthRow.append(
      rowCopyEl(rowTitleEl(t("会话宽度"))),
      rowControl(widthSel),
    );
    stream.appendChild(widthRow);
    renderToggleRow(stream, "动效", "关闭全部过渡与动画（含系统 reduce-motion 偏好）", "animations", a.animations !== false);
  }
  const a11y = document.getElementById("appearance-a11y-list");
  if (a11y !== null) {
    a11y.replaceChildren();
    renderToggleRow(
      a11y,
      "色盲友好色板",
      "图表/轨迹/状态色改用蓝橙安全对（Okabe-Ito——claude daltonized 同位）",
      "colorBlindFriendly",
      settingsCache?.appearance?.colorBlindFriendly === true,
    );
  }
}

async function refreshPluginThemeOptions() {
  const sel = document.getElementById("appearance-plugin-theme");
  if (sel === null) return;
  const envelope = await sendSettings({ op: "plugins-list" });
  // plugins-list 回执 = 诊断数组本身（非 {plugins:[...]} 包装）
  const plugins = envelope.ok ? envelope.result ?? [] : [];
  const themes = (Array.isArray(plugins) ? plugins : []).filter(
    (p) => p.enabled && p.manifest?.theme !== undefined,
  );
  sel.replaceChildren();
  const none = document.createElement("option");
  none.value = "";
  none.textContent = t("不使用");
  sel.appendChild(none);
  for (const p of themes) {
    const o = document.createElement("option");
    o.value = p.name;
    o.textContent = p.manifest.theme.name ?? p.name;
    sel.appendChild(o);
  }
  sel.value = settingsCache?.appearance?.pluginTheme ?? "";
}

function syncScheduleRows() {
  const mode = settingsCache?.appearance?.themeMode ?? "dark";
  const schedule = document.getElementById("appearance-theme-mode")?.value === "schedule";
  void mode;
  document.getElementById("appearance-schedule-light-row").hidden = !schedule;
  document.getElementById("appearance-schedule-dark-row").hidden = !schedule;
}

function syncFontRows() {
  const baseSel = document.getElementById("appearance-font-base-select");
  const monoSel = document.getElementById("appearance-font-mono-select");
  document.getElementById("appearance-font-base-row").hidden = baseSel?.value !== "custom";
  document.getElementById("appearance-font-mono-row").hidden = monoSel?.value !== "custom";
}

// ---------------------------------------------------------------------------
// Profiles（U19/T-P3-121）：组合档清单 + applyProfile 批量写生效段
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Profiles v2（T-P3-142——cc-switch ProfilePayload 同构）：供应商/模型下拉选 +
// 权限模式捆绑 + 三态资源快照 + 切换热应用（config/refresh + model/switch 既有
// 通道）+ 切走自动重拍旧档（无损往返）。
// ---------------------------------------------------------------------------

/** 权限模式五档标签（PERMISSION_MODE_UI 的 id→label 映射——摘要徽标用）。 */
const PROFILE_MODE_LABELS = Object.fromEntries(PERMISSION_MODE_UI.map((m) => [m.name, m.label]));

/** wire 身份收敛（settings.ts adapterForAssembly 同源复制——responses 回退 openai）。 */
const PROFILE_ADAPTER_WIRE = {
  openai: "openai",
  "openai-responses": "openai",
  anthropic: "anthropic",
  google: "google",
};

function profileEntryModels(entry) {
  return entry?.models ?? (entry?.model !== undefined ? [{ id: entry.model }] : []);
}

/**
 * 自动重拍（B 批次——cc-switch autosave-resnapshot 同构）：把当前生效状态
 * 存回指定档（供应商/模型/权限模式/超时/沙箱/网络 + 资源三槽快照）——
 * 用户在其它页的调整切走时不丢、回来状态一致。
 */
function snapshotCurrentIntoProfile(entry) {
  entry.defaultProvider = settingsCache.defaultProvider;
  entry.defaultModel = settingsCache.defaultModel;
  entry.permission = {
    ...(settingsCache.permission ?? {}),
    approvalTimeoutMs: settingsCache.permission?.approvalTimeoutMs,
    mode: settingsCache.permission?.mode,
  };
  entry.sandbox = {
    ...(entry.sandbox ?? {}),
    network: settingsCache.sandbox?.network,
    mode: settingsCache.sandbox?.mode,
  };
  entry.mcpEnabled = (settingsCache.mcp ?? []).filter((s) => s.enabled !== false).map((s) => s.name);
  entry.skillsDisabled = [...(settingsCache.skills?.disabled ?? [])];
  entry.pluginsEnabled = (settingsCache.plugins ?? []).filter((x) => x.enabled === true).map((x) => x.name);
  dirtySections.add("profiles");
}

/** 热应用 patch（A 批次——只含场景真正捆绑的维度；mode 预设自带的沙箱值
 *  被场景自身的 sandbox.mode 覆盖）。 */
function profileHotPatch(p) {
  const patch = {};
  const modeVals = p.permission?.mode !== undefined ? PERMISSION_MODE_VALUES[p.permission.mode] : undefined;
  if (modeVals !== undefined) {
    patch.approvalMode = modeVals.approvalMode;
    patch.unattended = modeVals.unattended;
  }
  const sandboxMode = p.sandbox?.mode ?? modeVals?.sandboxMode;
  if (sandboxMode !== undefined) patch.sandboxMode = sandboxMode;
  if (p.permission?.approvalTimeoutMs !== undefined) {
    patch.approvalTimeoutMs = p.permission.approvalTimeoutMs;
  }
  return patch;
}

/** 场景热应用（A 批次）：权限/沙箱走 config/refresh、模型走 J6
 *  model/switch——全部既有通道纯接线；失败逐项降级不互相阻断。 */
async function hotApplyProfile(p) {
  const sid = getSessionId();
  if (sid === "") {
    toast(`场景已切换：${p.name}（新会话生效）`, "info");
    return;
  }
  const notes = [];
  const patch = profileHotPatch(p);
  if (Object.keys(patch).length > 0) {
    try {
      await sendRequest(sid, { type: "config/refresh", patch });
      notes.push("权限/沙箱即时生效");
    } catch {
      notes.push("权限/沙箱热切失败（新会话生效）");
    }
  }
  const entry = (settingsCache.providers ?? []).find((x) => x.name === p.defaultProvider);
  const modelId = p.defaultModel ?? profileEntryModels(entry)[0]?.id;
  if (entry !== undefined && modelId !== undefined && entry.enabled !== false) {
    try {
      await sendRequest(sid, {
        type: "model/switch",
        identity: { provider: PROFILE_ADAPTER_WIRE[entry.adapter ?? "openai"] ?? "openai", modelId },
      });
      notes.push("模型已切换");
    } catch {
      notes.push("模型热切失败（新会话生效）");
    }
  }
  notes.push("MCP/技能/插件新会话生效");
  toast(`场景已切换：${p.name}（${notes.join("；")}）`, "info");
}

export function applyProfileValues(p) {
  // B：切走前把当前生效状态存回旧档（无损往返——activeProfile 空或同名跳过）
  const profiles = settingsCache.profiles ?? [];
  const previous = profiles.find((x) => x.name === settingsCache.activeProfile);
  if (previous !== undefined && previous.name !== p.name) {
    snapshotCurrentIntoProfile(previous);
  }
  // A：批量写生效段（三态——undefined 槽不动）
  settingsCache.defaultProvider = p.defaultProvider;
  settingsCache.defaultModel = p.defaultModel;
  settingsCache.permission = { ...(settingsCache.permission ?? {}), ...(p.permission ?? {}) };
  settingsCache.sandbox = p.sandbox ?? settingsCache.sandbox;
  if (p.mcpEnabled !== undefined) {
    settingsCache.mcp = (settingsCache.mcp ?? []).map((s) => ({
      ...s,
      enabled: p.mcpEnabled.includes(s.name),
    }));
  }
  if (p.skillsDisabled !== undefined) {
    settingsCache.skills = { ...(settingsCache.skills ?? {}), disabled: [...p.skillsDisabled] };
  }
  if (p.pluginsEnabled !== undefined) {
    settingsCache.plugins = (settingsCache.plugins ?? []).map((x) => ({
      ...x,
      enabled: p.pluginsEnabled.includes(x.name),
    }));
  }
  settingsCache.activeProfile = p.name;
  for (const sec of ["defaultProvider", "defaultModel", "permission", "sandbox", "profiles", "mcp", "skills", "plugins", "activeProfile"]) {
    dirtySections.add(sec);
  }
  renderProfileList();
  fireSectionRefresh(); // 默认项卡在 providers 分节——Profiles 切换后联动刷新
  markDirty("defaultProvider");
  markDirty("defaultModel");
  markDirty("permission");
  markDirty("sandbox");
  markDirty("profiles");
  markDirty("activeProfile");
  void hotApplyProfile(p);
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
    // T-P3-142：完整捆绑摘要徽标（供应商/模型/权限/超时/沙箱/网络/资源计数）
    const bits = [`→ ${p.defaultProvider}${p.defaultModel ? `/${p.defaultModel}` : ""}`];
    if (p.permission?.mode !== undefined) bits.push(`权限 ${PROFILE_MODE_LABELS[p.permission.mode] ?? p.permission.mode}`);
    if (p.permission?.approvalTimeoutMs !== undefined) bits.push(`超时 ${String(p.permission.approvalTimeoutMs)}ms`);
    if (p.sandbox?.mode !== undefined) bits.push(`沙箱 ${p.sandbox.mode}`);
    if (p.sandbox?.network !== undefined) bits.push(`网络 ${p.sandbox.network}`);
    if (p.mcpEnabled !== undefined) bits.push(`MCP ${String(p.mcpEnabled.length)}`);
    if (p.skillsDisabled !== undefined) bits.push(`技能停 ${String(p.skillsDisabled.length)}`);
    if (p.pluginsEnabled !== undefined) bits.push(`插件 ${String(p.pluginsEnabled.length)}`);
    descEl.textContent = bits.join(" · ");
    const applyBtn = btnEl(isActive ? "★ 当前" : "切换", isActive ? "btn active-mark" : "btn");
    applyBtn.addEventListener("click", () => {
      applyProfileValues(p);
    });
    // 走查反馈"功能简陋"：编辑（回填表单改任意字段含资源捆绑）+ 复制（克隆）
    const editBtn = btnEl("编辑", "btn");
    editBtn.addEventListener("click", () => {
      loadProfileIntoForm(p);
    });
    const copyBtn = btnEl("复制", "btn");
    copyBtn.addEventListener("click", () => {
      let copyName = `${p.name}-副本`;
      for (let i = 2; (settingsCache.profiles ?? []).some((x) => x.name === copyName); i++) {
        copyName = `${p.name}-副本${String(i)}`;
      }
      const clone = JSON.parse(JSON.stringify(p));
      clone.name = copyName;
      settingsCache.profiles = [...(settingsCache.profiles ?? []), clone];
      dirtySections.add("profiles");
      renderProfileList();
      markDirty("profiles");
      toast(`已复制为「${copyName}」`, "info");
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
    row.append(rowCopyEl(titleEl, descEl), rowControl(applyBtn, editBtn, copyBtn, delBtn));
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

/** 侧栏快速切换入口（app.js 经动态 import 调用——设置域归属本域；toast 由
 *  hotApplyProfile 统一发——双入口不重复）。 */
export function applyQuickProfile(name) {
  const p = (settingsCache?.profiles ?? []).find((x) => x.name === name);
  if (p !== undefined) {
    applyProfileValues(p);
  }
}

/** 建档表单的供应商下拉（注册表实列——手输名字拼错静默失效的根治）。 */
function renderProfileProviderOptions() {
  const sel = document.getElementById("profile-provider");
  if (sel === null) return;
  const current = sel.value;
  sel.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "选择供应商…";
  sel.appendChild(placeholder);
  for (const p of settingsCache?.providers ?? []) {
    if (p.enabled === false) continue;
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.value = current;
}

/** 建档表单的模型下拉（随供应商级联——entryModels 同构）。 */
function renderProfileModelOptions(providerName) {
  const sel = document.getElementById("profile-model");
  if (sel === null) return;
  sel.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "默认模型（可选）";
  sel.appendChild(placeholder);
  const entry = (settingsCache?.providers ?? []).find((x) => x.name === providerName);
  for (const m of profileEntryModels(entry)) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.id;
    sel.appendChild(opt);
  }
}

// —— 资源捆绑配置面（走查反馈"插件/MCP/技能没有可配置"——三组显式 chips）：
// 组级「捆绑」开关 + 成员勾选；三态 = 组未开（切换不动）/ 开了按勾选落盘。
const profileResourceState = {
  mcp: { bundled: false, names: [] },
  skills: { bundled: false, names: [] }, // 停用名单语义：勾上 = 该技能在此场景停用
  plugins: { bundled: false, names: [] },
};
let profileSkillsCache = null; // skills-list 全量技能名（分节打开时拉取）

function resourceUnion(known, stateNames) {
  return [...new Set([...(known ?? []), ...(stateNames ?? [])])];
}

function renderProfileResources() {
  const box = document.getElementById("profile-resource-list");
  if (box === null) return;
  box.replaceChildren();
  const groups = [
    {
      key: "mcp",
      label: "MCP 服务器（启用集）",
      desc: "捆绑后：勾选的服务启用，未勾选停用",
      known: (settingsCache?.mcp ?? []).map((s) => s.name),
    },
    {
      key: "skills",
      label: "技能（停用名单）",
      desc: "捆绑后：勾选的技能停用，未勾选可用",
      known: profileSkillsCache ?? [],
    },
    {
      key: "plugins",
      label: "插件（启用集）",
      desc: "捆绑后：勾选的插件启用，未勾选停用",
      known: (settingsCache?.plugins ?? []).map((x) => x.name),
    },
  ];
  for (const group of groups) {
    const state = profileResourceState[group.key];
    const cell = document.createElement("div");
    cell.className = "res-group";
    const head = document.createElement("div");
    head.className = "res-group-head";
    const title = document.createElement("div");
    title.className = "row-title";
    title.textContent = group.label;
    const desc = document.createElement("div");
    desc.className = "row-desc";
    desc.textContent = group.desc;
    const toggle = switchEl(state.bundled, (next) => {
      state.bundled = next;
      renderProfileResources();
    }, `捆绑${group.label}`);
    head.append(title, toggle);
    cell.append(head, desc);
    if (state.bundled) {
      const chips = document.createElement("div");
      chips.className = "res-chips";
      const all = resourceUnion(group.known, state.names);
      if (all.length === 0) {
        const empty = document.createElement("span");
        empty.className = "res-empty";
        empty.textContent = "（当前无可用成员）";
        chips.appendChild(empty);
      }
      for (const name of all) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `res-chip${state.names.includes(name) ? " on" : ""}`;
        chip.textContent = name;
        chip.addEventListener("click", () => {
          state.names = state.names.includes(name)
            ? state.names.filter((n) => n !== name)
            : [...state.names, name];
          renderProfileResources();
        });
        chips.appendChild(chip);
      }
      cell.appendChild(chips);
    }
    box.appendChild(cell);
  }
}

/** 技能名清单（skills-list op——分节打开时拉取；失败不炸面，chips 退化） */
async function refreshProfileSkills() {
  try {
    const envelope = await sendSettings({ op: "skills-list" });
    if (envelope.ok) {
      profileSkillsCache = (envelope.result?.skills ?? []).map((s) => s.name);
      renderProfileResources();
    }
  } catch {
    profileSkillsCache = null;
  }
}

/** 资源状态 → 三态快照（未捆绑的组不出现在 entry——切换时不动）。 */
function profileResourceSnapshot() {
  return {
    ...(profileResourceState.mcp.bundled ? { mcpEnabled: [...profileResourceState.mcp.names] } : {}),
    ...(profileResourceState.skills.bundled ? { skillsDisabled: [...profileResourceState.skills.names] } : {}),
    ...(profileResourceState.plugins.bundled ? { pluginsEnabled: [...profileResourceState.plugins.names] } : {}),
  };
}

/** 编辑回填（走查反馈——场景可改任意字段含资源捆绑）。 */
function loadProfileIntoForm(p) {
  document.getElementById("profile-name").value = p.name;
  renderProfileProviderOptions();
  document.getElementById("profile-provider").value = p.defaultProvider;
  renderProfileModelOptions(p.defaultProvider);
  document.getElementById("profile-model").value = p.defaultModel ?? "";
  document.getElementById("profile-mode").value = p.permission?.mode ?? "";
  document.getElementById("profile-timeout").value = p.permission?.approvalTimeoutMs ?? "";
  document.getElementById("profile-network").value = p.sandbox?.network ?? "";
  document.getElementById("profile-sandbox-mode").value = p.sandbox?.mode ?? "";
  profileResourceState.mcp = { bundled: p.mcpEnabled !== undefined, names: [...(p.mcpEnabled ?? [])] };
  profileResourceState.skills = { bundled: p.skillsDisabled !== undefined, names: [...(p.skillsDisabled ?? [])] };
  profileResourceState.plugins = { bundled: p.pluginsEnabled !== undefined, names: [...(p.pluginsEnabled ?? [])] };
  renderProfileResources();
  document.getElementById("profile-name").scrollIntoView({ block: "center" });
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
  // —— 外观（T-P3-141）：模式/时间表/皮肤/强调色/插件主题/语言/字号字体/
  // 消息流开关/背景图——全部即改即存（applyAppearance 即时预览 + 防抖落盘）
  document.getElementById("appearance-theme-mode").addEventListener("change", (ev) => {
    setAppearanceField("themeMode", ev.target.value);
    // 显式档同步 theme 兼容字段（旧 UI/旧档零破坏——applyAppearance 语义）
    if (ev.target.value === "dark" || ev.target.value === "light") {
      settingsCache.appearance = { ...(settingsCache.appearance ?? {}), theme: ev.target.value };
    }
    syncScheduleRows();
  });
  document.getElementById("appearance-schedule-light").addEventListener("change", (ev) => {
    setAppearanceField("scheduleLightStart", ev.target.value);
  });
  document.getElementById("appearance-schedule-dark").addEventListener("change", (ev) => {
    setAppearanceField("scheduleDarkStart", ev.target.value);
  });
  document.getElementById("appearance-plugin-theme").addEventListener("change", (ev) => {
    setAppearanceField("pluginTheme", ev.target.value);
    toast(t("外观已应用"), "info");
  });
  document.getElementById("appearance-language").addEventListener("change", (ev) => {
    settingsCache.appearance = { ...(settingsCache.appearance ?? {}), language: ev.target.value };
    markDirty("appearance");
    // i18n 切换：保存 flush（500ms）后整页刷新——零构建链的全量生效面
    applyLocalePreference(ev.target.value);
    toast(t("语言已切换，正在刷新…"), "info");
    setTimeout(() => location.reload(), 900);
  });
  document.getElementById("appearance-output-language").addEventListener("change", (ev) => {
    setAppearanceField("outputLanguage", ev.target.value);
  });
  document.getElementById("appearance-font-base-select").addEventListener("change", (ev) => {
    const v = ev.target.value;
    if (v === "") setAppearanceField("fontBase", "");
    else if (v === "sans") setAppearanceField("fontBase", "system-ui, sans-serif");
    else if (v === "serif") setAppearanceField("fontBase", "Georgia, 'Times New Roman', serif");
    syncFontRows();
  });
  document.getElementById("appearance-font-base").addEventListener("change", (ev) => {
    setAppearanceField("fontBase", ev.target.value.trim());
  });
  document.getElementById("appearance-font-mono-select").addEventListener("change", (ev) => {
    if (ev.target.value === "") setAppearanceField("fontMono", "");
    syncFontRows();
  });
  document.getElementById("appearance-font-mono").addEventListener("change", (ev) => {
    setAppearanceField("fontMono", ev.target.value.trim());
  });
  document.getElementById("appearance-bg-pick").addEventListener("click", () => {
    document.getElementById("appearance-bg-file").click();
  });
  document.getElementById("appearance-bg-file").addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (file === undefined) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      toast(t("仅支持 png/jpeg/webp 图片"), "warn");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast(t("图片超过 3MB 上限"), "warn");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAppearanceField("backgroundImage", String(reader.result ?? ""));
      document.getElementById("appearance-bg-opacity-row").hidden = false;
    };
    reader.readAsDataURL(file);
    ev.target.value = "";
  });
  document.getElementById("appearance-bg-clear").addEventListener("click", () => {
    setAppearanceField("backgroundImage", "");
    document.getElementById("appearance-bg-opacity-row").hidden = true;
  });
  document.getElementById("appearance-bg-opacity").addEventListener("input", (ev) => {
    setAppearanceField("backgroundImageOpacity", Number(ev.target.value));
  });

  // —— 场景档 v2（T-P3-142）：供应商/模型下拉级联 + 档名校验（D 批次）+
  // 资源捆绑显式配置（三态：组未开 = 不动 / 开了按勾选落盘）
  document.getElementById("profile-provider").addEventListener("change", (ev) => {
    renderProfileModelOptions(ev.target.value);
  });
  document.getElementById("profile-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = document.getElementById("profile-name").value.trim();
    const provider = document.getElementById("profile-provider").value;
    const model = document.getElementById("profile-model").value;
    const mode = document.getElementById("profile-mode").value;
    const timeoutRaw = document.getElementById("profile-timeout").value;
    const network = document.getElementById("profile-network").value;
    const sandboxMode = document.getElementById("profile-sandbox-mode").value;
    // D 批次：档名校验（≤40 字符 + 禁文件名保留字符——为未来文件化留安全边界，
    // 中文名合法）
    if (name === "" || provider === "") {
      toast("档名与供应商必填", "warn");
      return;
    }
    if (name.length > 40 || /[\\/:*?"<>|\u0000-\u001f]/.test(name)) {
      toast("档名不合法（≤40 字符，禁 \\ / : * ? \" < > |）", "warn");
      return;
    }
    const permissionPatch =
      mode !== "" || timeoutRaw !== ""
        ? {
            permission: {
              ...(mode !== "" ? { mode } : {}),
              ...(timeoutRaw !== "" ? { approvalTimeoutMs: Number(timeoutRaw) } : {}),
            },
          }
        : {};
    const sandboxPatch =
      network !== "" || sandboxMode !== ""
        ? {
            sandbox: {
              ...(network !== "" ? { network } : {}),
              ...(sandboxMode !== "" ? { mode: sandboxMode } : {}),
            },
          }
        : {};
    const entry = {
      name,
      defaultProvider: provider,
      ...(model !== "" ? { defaultModel: model } : {}),
      ...permissionPatch,
      ...sandboxPatch,
      // C 批次：资源三态——组开了「捆绑」才落盘（undefined = 切换不动）
      ...profileResourceSnapshot(),
    };
    const profiles = (settingsCache.profiles ?? []).filter((x) => x.name !== name);
    profiles.push(entry);
    settingsCache.profiles = profiles;
    document.getElementById("profile-name").value = "";
    dirtySections.add("profiles");
    renderProfileList();
    markDirty("profiles");
    toast(`已保存场景：${name}`, "info");
  });

  document.getElementById("profile-snapshot").addEventListener("click", () => {
    document.getElementById("profile-provider").value = settingsCache?.defaultProvider ?? "";
    renderProfileModelOptions(settingsCache?.defaultProvider ?? "");
    document.getElementById("profile-model").value = settingsCache?.defaultModel ?? "";
    document.getElementById("profile-mode").value = settingsCache?.permission?.mode ?? "";
    document.getElementById("profile-timeout").value =
      settingsCache?.permission?.approvalTimeoutMs ?? "";
    document.getElementById("profile-network").value = settingsCache?.sandbox?.network ?? "";
    document.getElementById("profile-sandbox-mode").value = settingsCache?.sandbox?.mode ?? "";
    // C 批次：资源三组全开并按当前状态拍入（cc-switch snapshot_current 同构）
    profileResourceState.mcp = {
      bundled: true,
      names: (settingsCache?.mcp ?? []).filter((s) => s.enabled !== false).map((s) => s.name),
    };
    profileResourceState.skills = {
      bundled: true,
      names: [...(settingsCache?.skills?.disabled ?? [])],
    };
    profileResourceState.plugins = {
      bundled: true,
      names: (settingsCache?.plugins ?? []).filter((x) => x.enabled === true).map((x) => x.name),
    };
    renderProfileResources();
    toast("已填入当前生效值（含 MCP/技能/插件捆绑快照）", "info");
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
  // —— 外观（T-P3-141）回填：模式/时间表/插件主题选项/字号字体/开关族
  document.getElementById("appearance-theme-mode").value =
    settingsCache?.appearance?.themeMode ?? settingsCache?.appearance?.theme ?? "dark";
  document.getElementById("appearance-schedule-light").value =
    settingsCache?.appearance?.scheduleLightStart ?? "07:00";
  document.getElementById("appearance-schedule-dark").value =
    settingsCache?.appearance?.scheduleDarkStart ?? "19:00";
  syncScheduleRows();
  renderSkinList();
  renderAccentList();
  renderFontSize();
  renderStreamAndA11y();
  void refreshPluginThemeOptions();
  document.getElementById("appearance-language").value =
    settingsCache?.appearance?.language ?? "system";
  document.getElementById("appearance-output-language").value =
    settingsCache?.appearance?.outputLanguage ?? "auto";
  const fontBase = settingsCache?.appearance?.fontBase ?? "";
  document.getElementById("appearance-font-base-select").value =
    fontBase === "" ? "" : fontBase.includes("serif") && !fontBase.includes("sans") ? "serif" : "custom";
  document.getElementById("appearance-font-base").value = fontBase;
  const fontMono = settingsCache?.appearance?.fontMono ?? "";
  document.getElementById("appearance-font-mono-select").value = fontMono === "" ? "" : "custom";
  document.getElementById("appearance-font-mono").value = fontMono;
  syncFontRows();
  document.getElementById("appearance-bg-opacity").value =
    String(settingsCache?.appearance?.backgroundImageOpacity ?? 60);
  document.getElementById("appearance-bg-opacity-row").hidden =
    (settingsCache?.appearance?.backgroundImage ?? "") === "";
  // 场景档 v2 回填：供应商/模型/权限模式下拉（级联）+ 资源捆绑配置面
  renderProfileProviderOptions();
  document.getElementById("profile-provider").value = "";
  renderProfileModelOptions("");
  document.getElementById("profile-mode").value = "";
  renderProfileResources();
  void refreshProfileSkills(); // 技能名清单（异步——回来自动重渲 chips）
  renderProfileList();
}
