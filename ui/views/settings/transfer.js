/**
 * 数据中心域（T-P3-153——「导入与导出」分节升级为五功能卡组）：
 * - 配置包 v2：选择性导出（八域勾选——host export-settings op 权威建包，
 *   UI 只管域标签与勾选）+ 部分包域合并导入 + 版本迁移（host 侧）；
 * - 备份中心：列表/立即备份/恢复（恢复前 safety 滚动）/删除 + 周期自动
 *   备份（T-P3-174 批次 4——开关/间隔/保留即改即存，host 侧定时 tick）；
 * - WebDAV 云同步（批次 4——cc-switch 行为锚：配置+测试连接+两段式上传/
 *   下载确认，密码进凭据库不上屏）；
 * - 会话库整库导出（批次 4——.sqlite 在线备份 / .sql 可重放脚本）；
 * - 会话数据：md/html/json 三格式导出（默认脱敏）+ JSON 包回导（幂等账）；
 * - 分享：导出模态内生成 aegent://import 深链（接收端 window.aegentApplyDeepLink）；
 * - 配置体检：七项只读检查，fail/warn 行点击跳对应设置分节。
 * 危险防线沿 cc-switch 行为锚：导入必确认（摘要+风险标注）、恢复前自动备份。
 */

import { sendSettings, IS_DESKTOP } from "../../api.js";
import { settingsCache, setSettingsCache, markPromptsLoaded, applyTheme, rebuildKeymap } from "../../state.js";
import { appendLine, toast } from "../../feedback.js";
import { icon } from "../../icons.js";
import { flushSettings, openDialog, refillFormsAfterImport, switchEl } from "./core.js";

/** 桌面壳 Tauri command 直调（sidebar.js 同款——不引壳运行时）。 */
function tauriInvoke(cmd, args) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args);
}

// —— 导出域标签（host TRANSFER_DOMAINS 的展示层映射——顺序即勾选序；id 闭集同源）——
const EXPORT_DOMAINS = [
  { id: "providers", label: "供应商", desc: "条目 / 默认供应商与模型 / 配置档" },
  { id: "prompts", label: "提示词", desc: "内联模板与附加源配置" },
  { id: "mcp", label: "MCP", desc: "服务器条目（env 值随包——确认再分享）" },
  { id: "projects", label: "项目", desc: "项目清单" },
  { id: "appearance", label: "外观", desc: "主题 / 皮肤 / 字号 / 语言" },
  { id: "keymap", label: "快捷键", desc: "键位覆盖" },
  { id: "enhancement", label: "辅助模型", desc: "判官 / 摘要 / 润色配置" },
  { id: "advanced", label: "高级与行为", desc: "权限档 / 沙箱 / 日志 / 定价 / 技能 / 子代理 / 语音 / 插件" },
];

export const SECTION_HTML = `
<section data-section="transfer">
  <div class="section-head"><h2 class="section-title">数据中心</h2></div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">导出配置包</div>
        <div class="row-desc">按域勾选导出（缺省全部）；配置包不含凭据——可生成分享链接或下载文件</div>
      </div>
      <div class="row-control"><button id="export-open" type="button" class="btn">导出…</button></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">导入配置包</div>
        <div class="row-desc">导入前自动备份（bak.0~4 滚动）；部分包只覆盖所含域，摘要确认后才变更</div>
      </div>
      <div class="row-control"><button id="import-open" type="button" class="btn">导入…</button></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">一体化会话导入</div>
        <div class="row-desc">扫描本机 AI 工具（Claude Code / Codex / OpenCode / ZCode 等），来源卡选择 + 项目分组勾选 + 原始记录预览后批量导入</div>
      </div>
      <div class="row-control"><a class="btn" href="#import">打开导入页</a></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">备份中心</div>
        <div class="row-desc">导入与恢复前自动滚动备份最近 5 份；可随时手动备份并一键恢复</div>
      </div>
      <div class="row-control"><button id="backup-now" type="button" class="btn">立即备份</button></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">周期自动备份</div>
        <div class="row-desc">host 侧定时滚动（与手动备份共用 bak 序号）；间隔自上次备份起算，重启无损</div>
      </div>
      <div class="row-control" id="backup-auto-control">
        <select id="backup-auto-hours" class="input" title="备份间隔">
          <option value="6">每 6 小时</option>
          <option value="12">每 12 小时</option>
          <option value="24">每天</option>
          <option value="72">每 3 天</option>
          <option value="168">每周</option>
        </select>
        <input id="backup-auto-keep" class="input" type="number" min="1" max="50" style="width:72px" title="保留份数" />
        <span id="backup-auto-switch-slot"></span>
      </div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title" id="webdav-title">WebDAV 云同步</div>
        <div class="row-desc" id="webdav-desc">配置快照手动同步到网盘（坚果云/InfiniCloud 等）；密码进凭据库不上屏；上传/下载前必确认</div>
      </div>
      <div class="row-control"><button id="webdav-open" type="button" class="btn">配置…</button></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">导出会话库</div>
        <div class="row-desc">全部会话事件的整库备份：.sqlite（可直接打开）或 .sql（可重放脚本）；导出过程不影响使用</div>
      </div>
      <div class="row-control"><button id="db-export-open" type="button" class="btn">导出…</button></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">会话数据</div>
        <div class="row-desc">聊天页「导出」按钮或历史页「导出」出 md/html/json；本机导出的 JSON 包可在历史页回导为新会话</div>
      </div>
      <div class="row-control"><button id="session-import-open" type="button" class="btn">回导会话 JSON…</button></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">配置体检</div>
        <div class="row-desc">只读检查：供应商引用与凭据 / MCP / 提示词源 / 备份健康 / 键位冲突</div>
      </div>
      <div class="row-control"><button id="checkup-run" type="button" class="btn">运行体检</button></div>
    </div>
  </div>
  <div id="backup-list" class="transfer-list"></div>
  <div id="checkup-rows" class="transfer-list"></div>
</section>
`;

// ---------------------------------------------------------------------------
// 工具面
// ---------------------------------------------------------------------------

function downloadText(text, filename) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 摘要行（与 host summarizePackage 同语义的 UI 呈现层——容部分包缺域）。 */
export function summarizeImported(s) {
  const lines = [`供应商条目 ${(s.providers ?? []).length} 个（默认 ${s.defaultProvider ?? "未设置"}）`];
  if (s.defaultModel !== undefined) lines.push(`默认模型 ${s.defaultModel}`);
  if (s.permission?.approvalTimeoutMs !== undefined) lines.push(`审批超时 ${s.permission.approvalTimeoutMs}ms`);
  if (s.sandbox?.network !== undefined) lines.push(`网络档 ${s.sandbox.network}`);
  if ((s.projects ?? []).length > 0) lines.push(`项目 ${s.projects.length} 个`);
  if (Array.isArray(s.prompts) && s.prompts.length > 0) lines.push(`提示词模板 ${s.prompts.length} 个`);
  else if (!Array.isArray(s.prompts) && s.prompts?.roots?.length) lines.push(`提示词模板附加源 ${s.prompts.roots.length} 个`);
  if ((s.mcp ?? []).length > 0) lines.push(`MCP server ${s.mcp.length} 个`);
  if ((s.profiles ?? []).length > 0) lines.push(`配置档 ${s.profiles.length} 个`);
  return lines;
}

/** 风险标注（D2——cc-switch deeplinkRisk 锚：内网端点 + 敏感 env 键黄标）。 */
const PRIVATE_ENDPOINT_RE = /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]|\[fc|\[fd)/i;
const SENSITIVE_ENV_RE = /(key|token|secret|password|passwd)/i;

function riskLines(pkg) {
  const warns = [];
  const settings = pkg?.settings ?? {};
  for (const p of settings.providers ?? []) {
    if (typeof p?.baseUrl === "string" && PRIVATE_ENDPOINT_RE.test(p.baseUrl)) {
      warns.push(`供应商「${p.name}」为内网/本机端点（${p.baseUrl}）——仅在本机网络可用`);
    }
  }
  for (const m of settings.mcp ?? []) {
    for (const key of Object.keys(m?.env ?? {})) {
      if (SENSITIVE_ENV_RE.test(key)) {
        warns.push(`MCP「${m.name}」环境变量 ${key} 疑似敏感值——确认来源可信`);
      }
    }
  }
  return warns;
}

async function applyImportedPackageText(text) {
  const envelope = await sendSettings({ op: "import", settings: JSON.parse(text) });
  if (!envelope.ok) {
    appendLine(`导入失败：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
    return false;
  }
  setSettingsCache(envelope.result.settings);
  markPromptsLoaded();
  applyTheme(settingsCache.appearance?.theme);
  rebuildKeymap(); // U25：导入后键位同步
  if (document.getElementById("provider-list") !== null) refillFormsAfterImport();
  return true;
}

// ---------------------------------------------------------------------------
// A 域：配置包 v2（选择性导出 + 部分包导入确认）
// ---------------------------------------------------------------------------

function openExportDialog() {
  const body = document.createElement("div");
  const grid = document.createElement("div");
  grid.className = "export-domain-grid";
  for (const d of EXPORT_DOMAINS) {
    const label = document.createElement("label");
    label.className = "export-domain-item";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    box.value = d.id;
    const text = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = d.label;
    const desc = document.createElement("small");
    desc.textContent = d.desc;
    text.append(strong, desc);
    label.append(box, text);
    grid.appendChild(label);
  }
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "零凭据保证：配置包永不携带 apiKey（凭据走各自的录入面）。";
  body.append(grid, hint);
  const collect = () => [...grid.querySelectorAll("input:checked")].map((b) => b.value);
  const generate = async (selected) => {
    await flushSettings(); // 导出前冲刷未保存的段级编辑——磁盘态即导出态
    const envelope = await sendSettings(selected.length === EXPORT_DOMAINS.length
      ? { op: "export-settings" }
      : { op: "export-settings", domains: selected });
    if (!envelope.ok) {
      toast(`导出失败：${envelope.error?.message ?? ""}`, "warn");
      return null;
    }
    return envelope.result;
  };
  openDialog({
    title: "导出配置包",
    description: "勾选要带走的域（全部勾选 = 整包）",
    width: "md",
    body,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      {
        label: "复制分享链接",
        className: "btn",
        onClick: async () => {
          const result = await generate(collect());
          if (result === null) return;
          const link = `aegent://import?data=${encodeURIComponent(result.text)}`;
          await navigator.clipboard.writeText(link);
          if (link.length > 50_000) toast(`分享链接已复制（${Math.round(link.length / 1024)} KB——偏长，建议改用文件分享）`, "warn");
          else toast("分享链接已复制——发送给对方后在 aegent 内打开即可导入", "info");
        },
      },
      {
        label: "下载配置包",
        className: "btn btn-primary",
        onClick: async () => {
          const result = await generate(collect());
          if (result === null) return;
          downloadText(result.text, `aegent-settings-${new Date().toISOString().slice(0, 10)}.json`);
          toast(`已导出（${result.summary[0] ?? "空配置"}——不含凭据）`, "info");
        },
      },
    ],
  });
}

/** 导入确认（摘要 + 风险标注逐项列出后确认——不可信输入防线）。 */
function confirmImportDialog(pkg, summaryText, onConfirm) {
  const warns = riskLines(pkg);
  const detail = [summaryText, ...warns].join("\n");
  openDialog({
    title: "确认导入",
    description: `${detail}\n\n导入前自动备份当前配置（bak.0~4 滚动 5 份）；配置包不含凭据。`,
    width: "md",
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      { label: pkg.partial === true ? "确认导入（仅覆盖所含域）" : "确认导入（覆盖当前配置）", className: "btn btn-primary", onClick: onConfirm },
    ],
  });
}

function openImportDialog() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        toast(`导入包不可用：${e.message}`, "warn");
        return;
      }
      if (parsed?.kind !== "aegent-settings-export") {
        toast("导入包 kind 不符（须为 aegent-settings-export 配置包）", "warn");
        return;
      }
      const summary = summarizeImported(parsed.settings ?? {}).join("；");
      const scope = parsed.partial === true ? `部分包（域：${(parsed.domains ?? []).join("、")}）` : "整包";
      confirmImportDialog(parsed, `收到${scope}，将变更：${summary}`, async () => {
        const ok = await applyImportedPackageText(text);
        if (ok) toast("配置导入完成（备份已滚动）", "info");
      });
    };
    reader.readAsText(file);
  });
  input.click();
}

// ---------------------------------------------------------------------------
// 深链接收（app.js window.aegentApplyDeepLink 委派——aegent://import?data=）
// ---------------------------------------------------------------------------

export async function applyDeepLink(encodedData) {
  try {
    const parsed = JSON.parse(decodeURIComponent(encodedData));
    if (parsed?.kind !== "aegent-settings-export") throw new Error("kind 不符");
    const summary = summarizeImported(parsed.settings ?? {}).join("；");
    confirmImportDialog(parsed, `收到深链分享配置，将变更：${summary}`, async () => {
      const ok = await applyImportedPackageText(JSON.stringify(parsed));
      if (ok) toast("配置导入完成", "info");
    });
    return "accepted";
  } catch (e) {
    appendLine(`深链导入失败：${e.message}`, "warn");
    return "rejected";
  }
}

// 旧入口兼容（settings.js 壳转发面——U20 消费方零破坏）
export async function applyImportedSettingsObject(importedSettings) {
  return applyImportedPackageText(
    typeof importedSettings === "string" ? importedSettings : JSON.stringify(importedSettings),
  );
}

// ---------------------------------------------------------------------------
// B 域：备份中心
// ---------------------------------------------------------------------------

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// —— 周期自动备份（T-P3-174 批次 4：settings.backup 三键即改即存）——

function renderBackupAuto() {
  const slot = document.getElementById("backup-auto-switch-slot");
  const hoursSel = document.getElementById("backup-auto-hours");
  const keepInput = document.getElementById("backup-auto-keep");
  if (slot === null || hoursSel === null || keepInput === null) return;
  const cfg = settingsCache?.backup ?? {};
  hoursSel.value = String(cfg.intervalHours ?? 24);
  keepInput.value = String(cfg.keep ?? 5);
  slot.replaceChildren(switchEl(cfg.auto === true, (next) => void saveBackupAuto(next), "周期自动备份"));
  hoursSel.disabled = cfg.auto !== true;
  keepInput.disabled = cfg.auto !== true;
}

async function saveBackupAuto(auto) {
  const hours = Number(document.getElementById("backup-auto-hours")?.value ?? 24);
  const keep = Number(document.getElementById("backup-auto-keep")?.value ?? 5);
  const envelope = await sendSettings({
    op: "update",
    patch: { backup: { auto, intervalHours: hours, keep } },
  });
  if (!envelope.ok) {
    toast(`保存失败：${envelope.error?.message ?? ""}`, "warn");
    renderBackupAuto();
    return;
  }
  setSettingsCache(envelope.result.settings);
  toast(auto ? `周期自动备份已开启（每 ${hours} 小时，保留 ${keep} 份）` : "周期自动备份已关闭", "info");
}

// —— WebDAV 云同步（批次 4：配置模态 + 两段式上传/下载确认）——

function webdavConfigOf() {
  return settingsCache?.webdav ?? {};
}

function renderWebdavRow() {
  const desc = document.getElementById("webdav-desc");
  const cfg = webdavConfigOf();
  if (desc === null) return;
  if (!cfg.url) {
    desc.textContent = "配置快照手动同步到网盘（坚果云/InfiniCloud 等）；未配置——点「配置…」开始";
    return;
  }
  const when = cfg.lastSyncAt ? new Date(cfg.lastSyncAt).toLocaleString() : "尚未同步";
  const err = cfg.lastError ? `；上次错误：${cfg.lastError}` : "";
  desc.textContent = `${cfg.url}${cfg.remoteRoot ? ` · ${cfg.remoteRoot}` : ""} —— 上次同步：${when}${err}`;
}

function openWebdavDialog() {
  const cfg = webdavConfigOf();
  const holder = document.createElement("div");
  holder.innerHTML = `
    <label class="export-domain-item"><span>服务地址（http(s)://…）</span></label>
    <input id="wd-url" class="input" type="text" placeholder="https://dav.jianguoyun.com/dav/" value="${cfg.url ?? ""}" />
    <label class="export-domain-item"><span>账号</span></label>
    <input id="wd-user" class="input" type="text" autocomplete="off" value="${cfg.username ?? ""}" />
    <label class="export-domain-item"><span>密码（保存后进凭据库，不回显）</span></label>
    <input id="wd-pass" class="input" type="password" autocomplete="new-password" placeholder="${cfg.url ? "留空 = 沿用已存密码" : ""}" />
    <label class="export-domain-item"><span>远端目录（缺省 aegent-sync）</span></label>
    <input id="wd-root" class="input" type="text" placeholder="aegent-sync" value="${cfg.remoteRoot ?? ""}" />
    <p class="hint" id="wd-hint">测试连接不落任何数据；坚果云请用「第三方应用密码」且地址须在 /dav/ 下。</p>`;
  const busy = (on, label) => {
    const btns = holder.closest("dialog")?.querySelectorAll("button") ?? [];
    for (const b of btns) b.disabled = on;
    const hint = holder.querySelector("#wd-hint");
    if (hint !== null) hint.textContent = on ? label : "";
  };
  const readForm = () => ({
    url: holder.querySelector("#wd-url").value.trim(),
    username: holder.querySelector("#wd-user").value.trim(),
    password: holder.querySelector("#wd-pass").value,
    remoteRoot: holder.querySelector("#wd-root").value.trim(),
  });
  const saveConfig = async () => {
    const f = readForm();
    if (f.url === "" || !/^https?:\/\//i.test(f.url)) {
      toast("服务地址须为 http(s) 地址", "warn");
      return false;
    }
    const patch = { webdav: { url: f.url, ...(f.username ? { username: f.username } : {}), ...(f.remoteRoot ? { remoteRoot: f.remoteRoot } : {}) } };
    const envelope = await sendSettings({ op: "update", patch });
    if (!envelope.ok) {
      toast(`保存失败：${envelope.error?.message ?? ""}`, "warn");
      return false;
    }
    setSettingsCache(envelope.result.settings);
    renderWebdavRow(); // 行卡状态行即刷（desc 显示 url/上次同步）
    if (f.password !== "") {
      const cred = await sendSettings({ op: "credentials-set", provider: "webdav", key: f.password });
      if (!cred.ok) {
        toast(`密码保存失败：${cred.error?.message ?? ""}`, "warn");
        return false;
      }
    }
    return true;
  };
  openDialog({
    title: "WebDAV 云同步",
    description: "同步对象 = 配置快照（不含凭据——零凭据纪律）。上传 = 本地覆盖云端；下载 = 云端覆盖本地，两者均需确认。",
    width: "md",
    body: holder,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      {
        label: "测试连接",
        className: "btn",
        onClick: async () => {
          if (!(await saveConfig())) return;
          busy(true, "连接中…");
          const envelope = await sendSettings({ op: "webdav-test" });
          busy(false);
          toast(envelope.ok ? (envelope.result.message ?? "连接成功") : `连接失败：${envelope.error?.message ?? ""}`, envelope.ok ? "info" : "warn");
        },
      },
      {
        label: "上传（本地优先）",
        className: "btn",
        onClick: async () => {
          if (!(await saveConfig())) return;
          await webdavSyncFlow("up");
        },
      },
      {
        label: "下载（远端优先）",
        className: "btn btn-primary",
        onClick: async () => {
          if (!(await saveConfig())) return;
          await webdavSyncFlow("down");
        },
      },
    ],
  });
}

/** 两段式同步流：探测远端 → 确认框（双方信息）→ 执行 → 状态刷新。 */
async function webdavSyncFlow(action) {
  const first = await sendSettings({ op: "webdav-sync", action });
  if (!first.ok) {
    toast(`同步失败：${first.error?.message ?? ""}`, "warn");
    return;
  }
  if (first.result.needsConfirm !== true) {
    toast(first.result.message, "info");
    renderWebdavRow();
    return;
  }
  const remote = first.result.remote;
  const remoteLine = remote
    ? `云端已有数据：${remote.deviceName} · ${new Date(remote.createdAt).toLocaleString()}`
    : "云端暂无同步数据";
  const isUp = action === "up";
  const ok = await new Promise((resolve) => {
    openDialog({
      title: isUp ? "确认上传到云端" : "确认从云端恢复",
      description: isUp
        ? `${remoteLine}\n上传将以本机当前配置覆盖云端${remote ? "（云端旧快照将被替换）" : ""}。`
        : `${remoteLine}\n恢复将以云端配置覆盖本机当前配置（覆盖前不做本地备份——请确认当前配置可丢弃）。`,
      width: "sm",
      onClose: () => resolve(false),
      actions: [
        { label: "取消", className: "btn btn-ghost", onClick: () => resolve(false) },
        { label: isUp ? "确认上传" : "确认恢复", className: "btn btn-primary", onClick: () => resolve(true) },
      ],
    });
  });
  if (!ok) return;
  const second = await sendSettings({ op: "webdav-sync", action, confirm: true });
  if (!second.ok) {
    toast(`同步失败：${second.error?.message ?? ""}`, "warn");
    renderWebdavRow();
    return;
  }
  toast(second.result.message, "info");
  renderWebdavRow();
  if (!isUp) {
    // 远端配置已应用——刷新全局面（导入同款收尾）
    const got = await sendSettings({ op: "get" });
    if (got.ok) {
      setSettingsCache(got.result.settings);
      markPromptsLoaded();
      applyTheme(settingsCache.appearance?.theme);
      rebuildKeymap();
    }
  }
}

// —— 会话库整库导出（批次 4：.sqlite / .sql 二选一，落 pick_folder 目录）——

function openDbExportDialog() {
  const holder = document.createElement("div");
  holder.innerHTML = `
    <div class="export-format-row">
      <label class="export-domain-item"><input type="radio" name="db-export-format" value="sqlite" checked /><span><strong>.sqlite</strong><small>SQLite 整库文件（在线备份——可独立打开）</small></span></label>
      <label class="export-domain-item"><input type="radio" name="db-export-format" value="sql" /><span><strong>.sql</strong><small>可重放 SQL 脚本（人可读、跨版本重建）</small></span></label>
    </div>
    <p class="hint" id="db-export-dir-hint">选择导出目录后执行。</p>`;
  const dlg = openDialog({
    title: "导出会话库",
    description: "把全部会话事件整库导出到本地目录（文件名带时间戳，不覆盖旧导出）。",
    width: "md",
    body: holder,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      {
        label: "选择目录并导出",
        className: "btn btn-primary",
        onClick: async () => {
          if (!IS_DESKTOP) {
            toast("导出目录选择需要桌面壳（浏览器面不可用）", "warn");
            return;
          }
          let dir;
          try {
            dir = await tauriInvoke("pick_folder");
          } catch {
            toast("目录选择不可用", "warn");
            return;
          }
          if (!dir || typeof dir !== "string") return; // 用户取消
          const format = holder.querySelector("input[name=db-export-format]:checked")?.value ?? "sqlite";
          toast("导出中…", "info");
          try {
            const envelope = await sendSettings({ op: "db-export", dir, format });
            if (!envelope.ok) {
              toast(`导出失败：${envelope.error?.message ?? ""}`, "warn");
              return;
            }
            const r = envelope.result;
            toast(`已导出 ${fmtBytes(r.bytes)} → ${r.path}`, "info");
            dlg.close();
          } catch (e) {
            toast(`导出失败：${e instanceof Error ? e.message : String(e)}`, "warn");
          }
        },
      },
    ],
  });
}

export async function renderBackups() {
  const box = document.getElementById("backup-list");
  if (box === null) return;
  const envelope = await sendSettings({ op: "settings-backup-list" });
  box.replaceChildren();
  if (!envelope.ok) return;
  const backups = envelope.result.backups ?? [];
  if (backups.length === 0) return;
  for (const b of backups) {
    const rowEl = document.createElement("div");
    rowEl.className = "transfer-row";
    const copy = document.createElement("span");
    copy.className = "transfer-row-copy";
    copy.textContent = `bak.${b.index} · ${new Date(b.mtimeMs).toLocaleString()} · ${fmtBytes(b.sizeBytes)}`;
    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "btn";
    restoreBtn.textContent = "恢复";
    restoreBtn.addEventListener("click", () => void restoreBackup(b.index));
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-danger";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", () => void deleteBackup(b.index));
    rowEl.append(copy, restoreBtn, delBtn);
    box.appendChild(rowEl);
  }
}

async function restoreBackup(index) {
  const ok = await new Promise((resolve) => {
    openDialog({
      title: `恢复备份 bak.${index}`,
      description: "恢复将覆盖当前配置。恢复前会自动备份当前配置（滚动入 bak.0），可再次恢复回来。",
      width: "sm",
      onClose: () => resolve(false),
      actions: [
        { label: "取消", className: "btn btn-ghost", onClick: () => resolve(false) },
        { label: "确认恢复", className: "btn btn-primary", onClick: () => resolve(true) },
      ],
    });
  });
  if (!ok) return;
  const envelope = await sendSettings({ op: "settings-backup-restore", index });
  if (!envelope.ok) {
    toast(`恢复失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  setSettingsCache(envelope.result.settings);
  markPromptsLoaded();
  applyTheme(settingsCache.appearance?.theme);
  rebuildKeymap();
  if (document.getElementById("provider-list") !== null) refillFormsAfterImport();
  toast("备份已恢复（恢复前配置已滚动入 bak.0）", "info");
  void renderBackups();
}

async function deleteBackup(index) {
  const ok = await new Promise((resolve) => {
    openDialog({
      title: `删除备份 bak.${index}`,
      description: "该备份将被永久删除，此操作无法撤销。",
      width: "sm",
      onClose: () => resolve(false),
      actions: [
        { label: "取消", className: "btn btn-ghost", onClick: () => resolve(false) },
        { label: "确认删除", className: "btn btn-danger", onClick: () => resolve(true) },
      ],
    });
  });
  if (!ok) return;
  const envelope = await sendSettings({ op: "settings-backup-delete", index });
  if (!envelope.ok) {
    toast(`删除失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  toast(`备份 bak.${index} 已删除`, "info");
  void renderBackups();
}

// ---------------------------------------------------------------------------
// C 域：会话导出 / 回导
// ---------------------------------------------------------------------------

/** 会话导出模态（聊天页「导出」与历史页「导出」共用入口）。 */
export function openSessionExportDialog(sessionId) {
  if (sessionId === undefined || sessionId === null || sessionId === "") {
    toast("当前无活动会话——先发起对话或从历史页选择", "warn");
    return;
  }
  const body = document.createElement("div");
  const label = document.createElement("label");
  label.className = "export-domain-item";
  const redactBox = document.createElement("input");
  redactBox.type = "checkbox";
  redactBox.checked = true; // 默认脱敏开（待澄清 2 裁决）
  const text = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = "脱敏密钥";
  const desc = document.createElement("small");
  desc.textContent = "sk-/github/AWS/Bearer 等密钥形态打码";
  text.append(strong, desc);
  label.append(redactBox, text);
  const formatWrap = document.createElement("div");
  formatWrap.className = "export-format-row";
  for (const [value, name, descText] of [
    ["md", "Markdown", "人类阅读"],
    ["html", "HTML", "自包含网页（带主题）"],
    ["json", "JSON", "机器可回导（aegent 会话包）"],
  ]) {
    const opt = document.createElement("label");
    opt.className = "export-domain-item";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "session-export-format";
    radio.value = value;
    radio.checked = value === "md";
    const span = document.createElement("span");
    const s1 = document.createElement("strong");
    s1.textContent = name;
    const s2 = document.createElement("small");
    s2.textContent = descText;
    span.append(s1, s2);
    opt.append(radio, span);
    formatWrap.appendChild(opt);
  }
  body.append(formatWrap, label);
  openDialog({
    title: "导出会话",
    description: "导出当前会话的完整对话（含工具调用与结果）",
    width: "md",
    body,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      {
        label: "导出",
        className: "btn btn-primary",
        onClick: async () => {
          const format = body.querySelector("input[name=session-export-format]:checked")?.value ?? "md";
          const envelope = await sendSettings({
            op: "session-export",
            sessionId,
            format,
            ...(redactBox.checked ? {} : { redact: false }),
          });
          if (!envelope.ok) {
            toast(`导出失败：${envelope.error?.message ?? ""}`, "warn");
            return;
          }
          downloadText(envelope.result.text, envelope.result.filename);
          toast(`已导出 ${envelope.result.messageCount} 条消息（${envelope.result.filename}）`, "info");
        },
      },
    ],
  });
}

/** 会话 JSON 包回导（数据中心卡 + 历史页共用——确认后经幂等账入历史）。 */
export function openSessionImportDialog() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      let pkg;
      try {
        pkg = JSON.parse(text);
      } catch (e) {
        toast(`会话包不可用：${e.message}`, "warn");
        return;
      }
      if (pkg?.kind !== "aegent-session-export") {
        toast("会话包 kind 不符（须为 aegent-session-export）", "warn");
        return;
      }
      const title = pkg.session?.title ?? "导入的会话";
      openDialog({
        title: "回导会话",
        description: `「${title}」共 ${(pkg.messages ?? []).length} 条消息，将作为新会话写入历史（同一包重复回导会自动跳过）。`,
        width: "sm",
        actions: [
          { label: "取消", className: "btn btn-ghost" },
          {
            label: "确认回导",
            className: "btn btn-primary",
            onClick: async () => {
              const envelope = await sendSettings({ op: "session-import", content: text });
              if (!envelope.ok) {
                toast(`回导失败：${envelope.error?.message ?? ""}`, "warn");
                return;
              }
              if (envelope.result.skipped === true) toast("该会话包已导入过（幂等跳过）", "info");
              else toast(`已回导 ${envelope.result.messageCount} 条消息——见会话历史`, "info");
            },
          },
        ],
      });
    };
    reader.readAsText(file);
  });
  input.click();
}

// ---------------------------------------------------------------------------
// E 域：配置体检
// ---------------------------------------------------------------------------

async function runCheckup() {
  const box = document.getElementById("checkup-rows");
  if (box === null) return;
  box.replaceChildren();
  const envelope = await sendSettings({ op: "settings-checkup" });
  if (!envelope.ok) {
    toast(`体检失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  // 体检徽标（T-P3-157 批 3：字形映射 → 图标语义名，消费方 icon() 节点化）
  const badgeIcon = { ok: "checkCircle", warn: "alert", fail: "xCircle" };
  for (const row of envelope.result.rows ?? []) {
    const rowEl = document.createElement(row.section !== undefined ? "button" : "div");
    rowEl.className = `transfer-row checkup-${row.level}`;
    if (row.section !== undefined) {
      rowEl.type = "button";
      rowEl.title = "点击前往对应设置分节";
      rowEl.addEventListener("click", () => {
        document.querySelector(`#settings-panel .nav-item[data-nav="${row.section}"]`)?.click();
      });
    }
    const badge = document.createElement("span");
    badge.className = `checkup-badge checkup-badge-${row.level}`;
    badge.className = `transfer-badge ${row.level === "ok" ? "icon-ok" : row.level === "warn" ? "icon-warn" : "icon-err"}`;
    badge.replaceChildren(icon(badgeIcon[row.level] ?? "circleHelp", { cls: "icon-sm" }));
    const copy = document.createElement("span");
    copy.className = "transfer-row-copy";
    copy.textContent = `${row.item}：${row.detail}`;
    rowEl.append(badge, copy);
    box.appendChild(rowEl);
  }
  const fails = (envelope.result.rows ?? []).filter((r) => r.level === "fail").length;
  const warns = (envelope.result.rows ?? []).filter((r) => r.level === "warn").length;
  toast(fails > 0 ? `体检完成：${fails} 项异常、${warns} 项建议` : warns > 0 ? `体检完成：${warns} 项建议` : "体检完成：全部通过", fails > 0 ? "warn" : "info");
}

// ---------------------------------------------------------------------------
// 挂载
// ---------------------------------------------------------------------------

export function bind() {
  document.getElementById("export-open")?.addEventListener("click", openExportDialog);
  document.getElementById("import-open")?.addEventListener("click", openImportDialog);
  document.getElementById("backup-now")?.addEventListener("click", async () => {
    const envelope = await sendSettings({ op: "settings-backup-create" });
    if (!envelope.ok) {
      toast(`备份失败：${envelope.error?.message ?? ""}`, "warn");
      return;
    }
    toast("已备份（当前配置滚动入 bak.0）", "info");
    void renderBackups();
  });
  document.getElementById("backup-auto-hours")?.addEventListener("change", () => {
    if (settingsCache?.backup?.auto === true) void saveBackupAuto(true); // 开着时改间隔即存
  });
  document.getElementById("backup-auto-keep")?.addEventListener("change", () => {
    if (settingsCache?.backup?.auto === true) void saveBackupAuto(true);
  });
  document.getElementById("webdav-open")?.addEventListener("click", openWebdavDialog);
  document.getElementById("db-export-open")?.addEventListener("click", openDbExportDialog);
  document.getElementById("session-import-open")?.addEventListener("click", openSessionImportDialog);
  document.getElementById("checkup-run")?.addEventListener("click", () => void runCheckup());
  void renderBackups(); // 打开设置即呈现既有备份
  renderBackupAuto();
  renderWebdavRow();
}
