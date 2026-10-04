/**
 * 一体化会话导入页（T-P3-165 需求 6——用户裁决参考 pi 生态"一体化会话导
 * 入"插件形态；本地无该插件源码，对齐 pideck ImportModals 的信息架构）：
 *
 * 顶部来源卡行（每工具一卡：N 个会话/未检测到/自定义）→ 选中源过滤；
 * 左列项目分组会话树（搜索 + 全选 + 组级全选 + 复选）；右列点选会话即载
 * 原始记录预览（import-preview 按需单会话拉取——模态时代的全量预览延迟
 * 根治）；底部已选计数 + 批量导入（import-sessions 幂等账）+ 已载入消息数。
 *
 * 数据面 = 既有三 op（import-scan / import-preview / import-sessions），
 * 协议零扩展；扫描准确性与截断判定（pideck：>1MB 采样 messageCount=null）
 * 的驱动级修复记档 ⑥.2。
 */

import { sendQuery, sendSettings } from "../api.js";
import { getSessionId, settingsCache } from "../state.js";
import { toast } from "../feedback.js";
import { icon } from "../icons.js";
import { hooks } from "../state.js";

const TEMPLATE = `
<div class="import-page">
  <div class="import-head">
    <div>
      <h2 class="import-title">一体化会话导入</h2>
      <p class="import-sub">扫描本机安装的编程工具，选择来源后勾选会话导入</p>
    </div>
    <button id="imp-rescan" type="button" class="btn btn-primary">扫描本机工具</button>
  </div>
  <div id="imp-sources" class="import-sources"><div class="hint">点击右上「扫描本机工具」开始。</div></div>
  <div id="imp-custom" class="import-custom" hidden></div>
  <div class="import-body">
    <div class="import-left">
      <div class="import-toolbar">
        <input id="imp-search" class="input" type="text" placeholder="搜索标题或项目…" autocomplete="off" />
        <button id="imp-select-all" type="button" class="btn btn-ghost">全选</button>
        <button id="imp-clear" type="button" class="btn btn-ghost">清除</button>
      </div>
      <div id="imp-tree" class="import-tree"><div class="hint">暂无会话。</div></div>
    </div>
    <div class="import-right">
      <div id="imp-preview" class="import-preview"><div class="hint">点击左侧会话查看详细记录。</div></div>
    </div>
  </div>
  <div class="import-foot">
    <span id="imp-count">已选 0 / 0</span>
    <button id="imp-import" type="button" class="btn btn-primary">导入为会话</button>
    <span id="imp-loaded" class="import-loaded"></span>
  </div>
</div>
`;

let scanData = { sources: [], sessions: [], customErrors: [] };
let selectedSource = null; // null = 全部来源
let checked = new Set(); // `${source}\u0000${externalId}`
let importedKeys = new Set(); // 本次已导入（行禁用——幂等账服务端兜底）
let loadedMessages = 0;

export async function render(container) {
  container.innerHTML = TEMPLATE;
  loadedMessages = 0;
  document.getElementById("imp-rescan").addEventListener("click", () => void runScan());
  document.getElementById("imp-select-all").addEventListener("click", () => selectAll(true));
  document.getElementById("imp-clear").addEventListener("click", () => selectAll(false));
  document.getElementById("imp-search").addEventListener("input", () => paintTree());
  document.getElementById("imp-import").addEventListener("click", () => void importChecked());
  await runScan();
}

/** 扫描（import-scan——只读并行探测；结果填来源卡与树）。 */
async function runScan() {
  const sourcesBox = document.getElementById("imp-sources");
  if (sourcesBox === null) return;
  sourcesBox.innerHTML = `<div class="hint">扫描中…（并行探测各工具本地会话库，只读）</div>`;
  const envelope = await sendSettings({ op: "import-scan" });
  if (!envelope.ok) {
    sourcesBox.innerHTML = `<div class="hint">扫描失败：${envelope.error?.message ?? ""}</div>`;
    return;
  }
  scanData = envelope.result;
  checked = new Set();
  selectedSource = null;
  paintSources();
  paintCustom();
  paintTree();
  paintCount();
}

function paintSources() {
  const box = document.getElementById("imp-sources");
  if (box === null) return;
  box.replaceChildren();
  const all = document.createElement("button");
  all.type = "button";
  all.className = `import-source-card${selectedSource === null ? " active" : ""}`;
  const totalCount = scanData.sessions.length;
  all.innerHTML = `<b>全部来源</b><span>${String(totalCount)} 个会话</span>`;
  all.addEventListener("click", () => {
    selectedSource = null;
    paintSources();
    paintTree();
  });
  box.appendChild(all);
  for (const s of scanData.sources) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `import-source-card${selectedSource !== null && selectedSource === s.id ? " active" : ""}`;
    const count = Number(s.sessionCount ?? 0);
    const meta = count > 0 ? `${String(count)} 个会话${s.custom === true ? "（自定义）" : ""}` : "未检测到";
    card.innerHTML = `<b>${escapeHtml(String(s.label ?? s.id ?? "?"))}</b><span>${escapeHtml(meta)}${s.note !== undefined ? ` · ${escapeHtml(String(s.note))}` : ""}</span>`;
    if (count > 0) {
      card.addEventListener("click", () => {
        selectedSource = selectedSource === s.id ? null : s.id;
        paintSources();
        paintTree();
      });
    } else {
      card.disabled = true;
    }
    box.appendChild(card);
  }
}

function paintCustom() {
  const box = document.getElementById("imp-custom");
  if (box === null) return;
  const errs = scanData.customErrors ?? [];
  const customCount = scanData.sources.filter((s) => s.custom === true).length;
  if (errs.length === 0 && customCount === 0) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = `<b>自定义来源</b>（docs/session-import-sources.json 声明式 JSON——只读取数不执行）已加载 ${String(customCount)} 个` +
    (errs.length > 0 ? `；<span class="import-err">被拒：${escapeHtml(errs.join("；"))}</span>` : "");
}

/** 左列项目分组树（搜索过滤 + 组级全选 + 行复选）。 */
function paintTree() {
  const box = document.getElementById("imp-tree");
  if (box === null) return;
  const keyword = (document.getElementById("imp-search")?.value ?? "").trim().toLowerCase();
  box.replaceChildren();
  const groups = new Map();
  for (const session of scanData.sessions) {
    if (selectedSource !== null && session.source !== selectedSource) continue;
    const hay = `${session.title ?? ""} ${session.projectPath ?? ""}`.toLowerCase();
    if (keyword !== "" && !hay.includes(keyword)) continue;
    const key = session.projectPath ?? "(未定位目录)";
    const list = groups.get(key) ?? [];
    list.push(session);
    groups.set(key, list);
  }
  if (groups.size === 0) {
    box.innerHTML = `<div class="hint">没有匹配的会话。</div>`;
    return;
  }
  for (const [cwd, list] of groups) {
    list.sort((a, b) => Date.parse(b.updatedAt ?? 0) - Date.parse(a.updatedAt ?? 0));
    const group = document.createElement("div");
    group.className = "import-group";
    const head = document.createElement("div");
    head.className = "import-group-head";
    const name = document.createElement("span");
    name.className = "import-group-name";
    name.textContent = cwd === "(未定位目录)" ? cwd : (cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd);
    name.title = cwd;
    const count = document.createElement("span");
    count.className = "import-group-count";
    count.textContent = `${String(list.length)} 个会话`;
    const pickAll = document.createElement("button");
    pickAll.type = "button";
    pickAll.className = "btn btn-ghost import-pick-all";
    pickAll.textContent = "全选该项目";
    pickAll.addEventListener("click", () => {
      const keys = list.map((s) => keyOf(s));
      const allIn = keys.every((k) => checked.has(k));
      for (const k of keys) {
        if (allIn) checked.delete(k);
        else if (!importedKeys.has(k)) checked.add(k);
      }
      paintTree();
      paintCount();
    });
    head.append(name, count, pickAll);
    group.appendChild(head);
    for (const session of list) {
      group.appendChild(sessionRow(session));
    }
    box.appendChild(group);
  }
}

function keyOf(session) {
  return `${session.source}\u0000${session.externalId}`;
}

function sessionRow(session) {
  const key = keyOf(session);
  const row = document.createElement("div");
  row.className = "import-session-row";
  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = checked.has(key);
  check.disabled = importedKeys.has(key);
  check.addEventListener("click", (ev) => ev.stopPropagation());
  check.addEventListener("change", () => {
    if (check.checked) checked.add(key);
    else checked.delete(key);
    paintCount();
  });
  const main = document.createElement("div");
  main.className = "import-session-main";
  const title = document.createElement("div");
  title.className = "import-session-title";
  title.textContent = session.title !== "" ? session.title : session.externalId;
  title.title = title.textContent;
  const meta = document.createElement("div");
  meta.className = "import-session-meta";
  meta.textContent = `${formatWhen(session.updatedAt)} · ${String(session.messageCount)} 条消息 · ${String(session.source)}`;
  main.append(title, meta);
  row.append(check, main);
  // 点行 = 预览（import-preview 按需单会话拉取——不复读全量）
  row.addEventListener("click", () => void previewSession(session, row));
  return row;
}

async function previewSession(session, row) {
  for (const el of document.querySelectorAll(".import-session-row.active")) el.classList.remove("active");
  row.classList.add("active");
  const box = document.getElementById("imp-preview");
  if (box === null) return;
  box.innerHTML = `<div class="hint">载入中…</div>`;
  const envelope = await sendSettings({
    op: "import-preview",
    source: session.source,
    path: session.externalId,
  });
  if (!envelope.ok) {
    box.innerHTML = `<div class="hint">预览失败：${escapeHtml(envelope.error?.message ?? "")}</div>`;
    return;
  }
  const messages = envelope.result?.messages ?? [];
  loadedMessages = messages.length;
  box.replaceChildren();
  const head = document.createElement("div");
  head.className = "import-preview-head";
  head.textContent = session.title !== "" ? session.title : session.externalId;
  box.appendChild(head);
  for (const message of messages.slice(0, 400)) {
    const line = document.createElement("div");
    line.className = `import-message ${message.role === "user" ? "is-user" : "is-agent"}`;
    const who = document.createElement("span");
    who.className = "import-message-role";
    who.textContent = message.role === "user" ? "用户" : "AI";
    const text = document.createElement("div");
    text.className = "import-message-text";
    text.textContent = String(message.content ?? "").slice(0, 4000);
    line.append(who, text);
    box.appendChild(line);
  }
  if (messages.length > 400) {
    const more = document.createElement("div");
    more.className = "hint";
    more.textContent = `已截断——共 ${String(messages.length)} 条消息（预览显示前 400 条）`;
    box.appendChild(more);
  }
  const loaded = document.getElementById("imp-loaded");
  if (loaded !== null) loaded.textContent = `已载入 ${String(loadedMessages)} 条消息`;
}

function selectAll(all) {
  if (all) {
    for (const session of scanData.sessions) {
      if (selectedSource !== null && session.source !== selectedSource) continue;
      checked.add(keyOf(session));
    }
  } else {
    checked.clear();
  }
  paintTree();
  paintCount();
}

function paintCount() {
  const el = document.getElementById("imp-count");
  if (el !== null) el.textContent = `已选 ${String(checked.size)} / ${String(scanData.sessions.length)}`;
}

async function importChecked() {
  if (checked.size === 0) {
    toast("未勾选任何会话", "warn");
    return;
  }
  const btn = document.getElementById("imp-import");
  if (btn !== null) btn.disabled = true;
  const importItems = [...checked].map((key) => {
    const [source, externalId] = key.split("\u0000");
    const session = scanData.sessions.find((s) => s.source === source && s.externalId === externalId);
    return {
      source,
      externalId,
      ...(session?.projectPath ? { projectPath: session.projectPath } : {}),
    };
  });
  const envelope = await sendSettings({ op: "import-sessions", importItems });
  if (btn !== null) btn.disabled = false;
  if (!envelope.ok) {
    toast(`导入失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  const { imported = 0, skipped = 0, failed = 0 } = envelope.result;
  toast(
    `导入 ${String(imported)} 条会话（${String(skipped)} 条已存在跳过${failed > 0 ? `，${String(failed)} 条失败` : ""}）`,
    imported > 0 ? "info" : "warn",
  );
  importedKeys = new Set([...checked]);
  checked = new Set();
  paintTree();
  paintCount();
  void hooks.refreshSidebar?.();
  void sendQuery({ sessionId: getSessionId() || "-", op: "sessions" }); // 预热会话清单缓存
}

function formatWhen(iso) {
  const ts = Date.parse(iso ?? "");
  if (!Number.isFinite(ts) || ts <= 0) return "时间未知";
  return new Date(ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
