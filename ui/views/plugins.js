/**
 * 插件中心视图（T-P3-148 O/P/Q——从 settings 分节升为独立一级页面；
 * 形态母版：pi-desktop PluginsPage 双 tab + InstalledPluginsPanel 分组固定序
 * + PluginDetailSheet 右侧滑入 + PluginDialogs 权限审查分组配色，只学行为；
 * 市场/创建 tab 的母版与 op 对齐 zcode PluginStorePage / plugin-creator）。
 *
 * 页面结构：页头（标题 + ⋯ 收纳低频动作）+ tab 工具条（已安装/市场/创建）
 * + 分 tab 内容。数据面 = op:plugins-list（装载清单 + 安装期校验诊断）+
 * op:plugin-check（安装前真实 manifest 预览——审批数据源）+ op:market
 * （市场域动作闭集）+ op:plugin-scaffold（四模板生成）；启停/移除/设置值写
 * settings plugins 段即改即存（markDirty("plugins")——agents.js 既有链路）。
 *
 * 分组（pi 四组裁剪：更新组经市场「检查更新」承载）：故障 → 启用 → 停用。
 * 详情 sheet：右侧滑入 560px（pi 母版），分区 = 头部 → 状态 → 关于 → 贡献物
 * 分区（命令/技能/视图/MCP/设置/订阅——zcode ComponentGroups 固定顺序）→
 * 设置表单（F：类型化控件，sensitive 掩码输入）→ 操作区。审批（Q）：风险
 * 三档（hooks=高 / MCP·工具=中 / 其余=低）+ untrusted 警示。
 */

import { sendSettings, invalidateMetaCache } from "../api.js";
import { settingsCache, setSettingsCache } from "../state.js";
import { toast } from "../feedback.js";
import { t } from "../i18n.js";
import { icon, injectIcons } from "../icons.js";
import {
  markDirty,
  dirtySections,
  flushSettings,
  openDialog,
  openMenu,
  confirmDialog,
  rowEl,
  rowCopyEl,
  rowControl,
  btnEl,
  emptyState,
  chipEl,
  switchEl,
} from "./settings/core.js";
import { CREATE_HTML, bindCreate } from "./settings/plugin-create-tab.js";
import { MARKET_HTML, bindMarket, refreshSources } from "./settings/plugin-market-tab.js";

let activeTab = "installed";
let searchQuery = "";
let listCache = [];

const TEMPLATE = `
<aside id="plugins-panel" aria-label="插件中心">
  <header class="page-head">
    <h2 class="tab-title">插件中心</h2>
    <div class="page-head-actions">
      <button id="plugin-install" type="button" class="btn btn-primary">安装插件</button>
      <button id="plugin-more" type="button" class="btn btn-ghost" aria-label="更多操作">…</button>
    </div>
  </header>
  <div class="page-body">
    <div class="plugins-toolbar">
      <div id="plugin-tabs" class="tabs-pill" role="tablist" aria-label="插件分区"></div>
      <input id="plugin-search" class="input" type="text" placeholder="搜索已安装插件…" autocomplete="off" />
    </div>
    <div id="plugin-tab-installed">
      <div id="plugin-list" class="row-list"></div>
      <p class="hint">进程内插件目录约定：plugin.json（清单：name/trust/capabilities/contributes）+ index.js（入口，default 导出 AegentPlugin）。停用保留在清单；装载失败不影响启动（never-fail）。新会话生效。</p>
    </div>
    <div id="plugin-tab-market" hidden>${MARKET_HTML}</div>
    <div id="plugin-tab-create" hidden>${CREATE_HTML}</div>
  </div>
</aside>
`;

/** tab 注册表（计数徽标随数据面活算——pi PluginsPage tab 徽标同形态）。 */
const TABS = [
  { id: "installed", label: "已安装", count: () => listCache.length },
  { id: "market", label: "市场", count: () => null },
  { id: "create", label: "创建", count: () => null },
];

function renderTabs() {
  const box = document.getElementById("plugin-tabs");
  if (box === null) return;
  box.replaceChildren(
    ...TABS.map((tab) => {
      const count = tab.count();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `tab-trigger${activeTab === tab.id ? " active" : ""}`;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(activeTab === tab.id));
      btn.textContent = count === null ? t(tab.label) : `${t(tab.label)}（${String(count)}）`;
      btn.addEventListener("click", () => switchTab(tab.id));
      return btn;
    }),
  );
}

function switchTab(id) {
  activeTab = id;
  renderTabs();
  const show = (elId, visible) => {
    const el = document.getElementById(elId);
    if (el !== null) el.hidden = !visible;
  };
  show("plugin-tab-installed", id === "installed");
  show("plugin-tab-market", id === "market");
  show("plugin-tab-create", id === "create");
  const search = document.getElementById("plugin-search");
  if (search !== null) search.hidden = id !== "installed"; // 只藏搜索框——父容器含 tab 胶囊，藏父会让 tab 消失（走查抓出）
  if (id === "installed") void refreshPluginsList();
  if (id === "market") void refreshSources(document.getElementById("plugin-tab-market"));
}

async function refreshPluginsList() {
  const envelope = await sendSettings({ op: "plugins-list" });
  const list = document.getElementById("plugin-list");
  if (list === null) return;
  list.replaceChildren();
  if (!envelope.ok) {
    listCache = [];
    renderTabs();
    list.appendChild(emptyState("插件清单不可用", envelope.error?.message ?? ""));
    return;
  }
  listCache = envelope.result;
  renderTabs();
  const query = searchQuery.trim().toLowerCase();
  const filtered = query === ""
    ? listCache
    : listCache.filter((p) =>
        [p.name, p.source, p.manifest?.description ?? ""].join(" ").toLowerCase().includes(query),
      );
  if (filtered.length === 0) {
    list.appendChild(
      query === ""
        ? emptyState("未安装插件", "点右上「安装插件」装本地目录（先审批），或到「市场」「创建」tab")
        : emptyState("没有匹配的插件", "换个搜索词试试"),
    );
    return;
  }
  // 分组固定顺序：故障 → 启用 → 停用（pi InstalledPluginsPanel 四组裁剪）
  const groups = [
    { key: "attention", label: "需要处理", test: (p) => p.error !== undefined },
    { key: "active", label: "已启用", test: (p) => p.error === undefined && p.enabled },
    { key: "disabled", label: "已停用", test: (p) => p.error === undefined && !p.enabled },
  ];
  for (const group of groups) {
    const items = filtered.filter(group.test);
    if (items.length === 0) continue;
    const head = document.createElement("div");
    head.className = "group-title";
    head.textContent = `${group.label}（${String(items.length)}）`;
    list.appendChild(head);
    for (const p of items) list.appendChild(pluginRow(p));
  }
}

/** host 直接落盘（市场安装/卸载）后的 settingsCache 重拉——防旧快照写回；
 * meta 缓存同步失效（热加载后 / 补全的工具/命令清单须重拉）。 */
async function resyncSettingsCache() {
  invalidateMetaCache();
  const envelope = await sendSettings({ op: "get" });
  if (envelope.ok) setSettingsCache(envelope.result.settings);
}

function writePlugins(defs) {
  settingsCache.plugins = defs;
  dirtySections.add("plugins");
  markDirty("plugins");
  invalidateMetaCache(); // 热加载改了工具/命令清单——补全数据源重拉
}

async function setEnabled(p, checked) {
  const defs = (settingsCache.plugins ?? []).map((d) => {
    if (d.name !== p.name) return d;
    if (checked) {
      const { enabled: _omit, ...rest } = d;
      return rest;
    }
    return { ...d, enabled: false };
  });
  writePlugins(defs);
  await flushSettings(); // 先落盘再刷清单（与 commitInstall 同防抖竞态）
  void refreshPluginsList();
}

function pluginRow(p) {
  const row = rowEl();
  const badge = document.createElement("span");
  badge.className = "icon-badge";
  badge.appendChild(icon(p.error !== undefined ? "alert" : "plug"));
  const titleEl = document.createElement("div");
  titleEl.className = "row-title";
  titleEl.textContent = p.name;
  titleEl.appendChild(chipEl(p.transport === "ws" ? "进程外 ws" : "进程内"));
  if (p.manifest?.version !== undefined) titleEl.appendChild(chipEl(`v${p.manifest.version}`));
  if (p.manifest) titleEl.appendChild(chipEl(`trust: ${p.manifest.trust}`));
  if (p.marketplace !== undefined) titleEl.appendChild(chipEl(`市场: ${p.marketplace}`));
  if (!p.enabled) titleEl.appendChild(chipEl("已停用"));
  const descEl = document.createElement("div");
  descEl.className = "row-desc clamp-2";
  descEl.textContent =
    p.error !== undefined ? p.error : p.manifest?.description ?? `→ ${p.source}`;
  if (p.error !== undefined) descEl.classList.add("error-text");
  const copy = rowCopyEl(titleEl, descEl);
  // 可折叠贡献物（<details>——pi PluginRowDetails 防行高爆炸同款）
  const copyBox = document.createElement("div");
  copyBox.className = "row-copy-box";
  copyBox.append(copy);
  const contrib = contributionChips(p.manifest);
  if (contrib !== null) {
    const details = document.createElement("details");
    details.className = "row-details";
    const summary = document.createElement("summary");
    summary.textContent = "贡献物";
    details.append(summary, contrib);
    copyBox.appendChild(details);
  }
  const toggle = switchEl(p.enabled, (checked) => setEnabled(p, checked), `启停插件 ${p.name}`);
  const detailBtn = btnEl("详情", "btn", "查看清单与贡献物、编辑插件设置");
  detailBtn.addEventListener("click", () => openDetail(p));
  const moreBtn = btnEl("…", "btn btn-ghost", "更多操作");
  moreBtn.addEventListener("click", () => {
    const items = [{ label: "编辑设置", onClick: () => openDetail(p, true) }];
    if (p.marketplace !== undefined) {
      items.push({
        label: "卸载（删除缓存副本）",
        danger: true,
        onClick: async () => {
          if (!(await confirmDialog(`从市场卸载插件「${p.name}」？（删除缓存副本与装载条目）`, { title: "卸载插件", confirmLabel: "卸载", danger: true }))) return;
          const envelope = await sendSettings({ op: "market", action: "uninstall", marketplace: p.marketplace, name: p.name });
          if (!envelope.ok) {
            toast(`卸载失败：${envelope.error?.message ?? ""}`, "error");
            return;
          }
          dirtySections.delete("plugins"); // 丢弃旧快照的防抖写回（否则复活已卸载条目——走查实测）
          await resyncSettingsCache();
          toast(`已卸载：${p.name}`, "info");
          void refreshPluginsList();
        },
      });
    }
    items.push({
      label: "从装载清单移除",
      danger: true,
      onClick: async () => {
        if (!(await confirmDialog(`从装载清单移除插件「${p.name}」？（不删除插件目录文件）`, { title: "移除插件", confirmLabel: "移除", danger: true }))) return;
        writePlugins((settingsCache.plugins ?? []).filter((d) => d.name !== p.name));
        void refreshPluginsList();
      },
    });
    openMenu(moreBtn, items);
  });
  row.append(badge, copyBox, rowControl(detailBtn, toggle, moreBtn));
  return row;
}

/** 贡献物 chips 行（清单贡献计数——详情 sheet 的折叠预览）。 */
function contributionChips(manifest) {
  const c = manifest?.contributes;
  const theme = manifest?.theme;
  if (c === undefined && theme === undefined) return null;
  const box = document.createElement("div");
  box.className = "row-chips";
  const push = (text) => box.appendChild(chipEl(text));
  if ((c?.commands?.length ?? 0) > 0) push(`命令 ${String(c.commands.length)}`);
  if ((c?.skills?.length ?? 0) > 0) push(`技能 ${String(c.skills.length)}`);
  if ((c?.views?.length ?? 0) > 0) push(`视图 ${String(c.views.length)}`);
  if ((c?.mcpServers?.length ?? 0) > 0) push(`MCP ${String(c.mcpServers.length)}`);
  if ((c?.settings?.length ?? 0) > 0) push(`设置 ${String(c.settings.length)}`);
  if ((c?.subscriptions?.length ?? 0) > 0) push(`订阅 ${String(c.subscriptions.length)}`);
  if (theme !== undefined) push(`主题：${theme.name ?? manifest.name}`);
  return box.children.length === 0 ? null : box;
}

// ---------------------------------------------------------------------------
// 详情 sheet（P——pi PluginDetailSheet 右侧滑入母版；zcode 组件分区固定序）
// ---------------------------------------------------------------------------

const CONTRIB_SECTIONS = [
  { key: "commands", label: "命令", descOf: (x) => x.description ?? x.argumentHint ?? "" },
  { key: "skills", label: "技能", descOf: (x) => (typeof x === "string" ? x : "") },
  { key: "views", label: "视图", descOf: (x) => x.title ?? "" },
  { key: "mcpServers", label: "MCP 服务器", descOf: (x) => x.command ?? "" },
  { key: "settings", label: "设置项", descOf: (x) => x.description ?? "" },
  { key: "subscriptions", label: "订阅事件", descOf: (x) => (typeof x === "string" ? x : "") },
];

/**
 * 受控视图渲染（C——pi plugin-view-host 的 iframe 等价物）：sandbox
 * "allow-scripts"（无 allow-same-origin = 唯一源，无宿主 DOM/存储访问）+
 * CSP meta（宿主注入，connect-src 'none' 出网收敛）+ srcdoc。主题初始态经
 * window.__AEGENT_VIEW__（宿主注入），后续 aegent:appearance 消息。
 */
function openPluginView(p, viewId, title) {
  const box = document.createElement("div");
  box.className = "card-box";
  const head = document.createElement("div");
  head.className = "row-title";
  head.textContent = `视图：${title}`;
  const closeView = btnEl("关闭视图", "btn btn-ghost", "销毁 iframe");
  const frameWrap = document.createElement("div");
  frameWrap.className = "plugin-view-frame";
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("title", `插件视图 ${title}`);
  frameWrap.appendChild(frame);
  const loading = document.createElement("div");
  loading.className = "row-desc";
  loading.textContent = "加载中…";
  frameWrap.appendChild(loading);
  closeView.addEventListener("click", () => {
    box.remove();
  });
  head.append(closeView);
  box.append(head, frameWrap);
  void (async () => {
    const base = document.documentElement.dataset.appearance === "light" ? "light" : "dark";
    const envelope = await sendSettings({ op: "plugin-view-html", name: p.name, view: viewId, base });
    if (!envelope.ok) {
      loading.textContent = `视图加载失败：${envelope.error?.message ?? ""}`;
      loading.classList.add("error-text");
      return;
    }
    const r = envelope.result;
    loading.remove();
    frame.srcdoc = r.html;
    frame.addEventListener("load", () => {
      frame.contentWindow?.postMessage({ type: "aegent:appearance", base, locale: document.documentElement.lang || "zh-CN" }, "*");
    }, { once: true });
  })();
  return box;
}

function openDetail(p, focusSettings = false) {
  const manifest = p.manifest;
  const layer = document.createElement("div");
  layer.className = "plugin-sheet-layer";
  const panel = document.createElement("div");
  panel.className = "plugin-sheet";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `插件详情 ${p.name}`);

  const close = () => {
    window.removeEventListener("keydown", onEsc, true);
    layer.remove();
  };
  const onEsc = (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    }
  };
  layer.addEventListener("click", (ev) => {
    if (ev.target === layer) close();
  });
  window.addEventListener("keydown", onEsc, true);

  const head = document.createElement("div");
  head.className = "plugin-sheet-head";
  const monogram = document.createElement("span");
  monogram.className = "icon-badge";
  monogram.appendChild(icon("plug"));
  const headCopy = document.createElement("div");
  headCopy.className = "row-copy";
  const headTitle = document.createElement("div");
  headTitle.className = "row-title";
  headTitle.textContent = p.name;
  const headMeta = document.createElement("div");
  headMeta.className = "row-desc";
  headMeta.textContent = `${p.name}${manifest?.version !== undefined ? ` · v${manifest.version}` : ""} · trust: ${manifest?.trust ?? (p.transport === "ws" ? "untrusted" : "?")}`;
  headCopy.append(headTitle, headMeta);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "dialog-close";
  closeBtn.setAttribute("aria-label", "关闭");
  closeBtn.appendChild(icon("close"));
  closeBtn.addEventListener("click", close);
  head.append(monogram, headCopy, closeBtn);

  const body = document.createElement("div");
  body.className = "plugin-sheet-body";

  const status = document.createElement("div");
  status.className = `row-desc${p.error !== undefined ? " error-text" : ""}`;
  status.textContent =
    p.error !== undefined
      ? `装载诊断：${p.error}`
      : p.enabled
        ? "已启用（新会话生效的改动以清单为准）"
        : "已停用（清单保留——开关是开回的路径）";
  body.appendChild(status);

  if (manifest?.description !== undefined) {
    const about = document.createElement("p");
    about.className = "hint";
    about.textContent = manifest.description;
    body.appendChild(about);
  }
  const srcLine = document.createElement("p");
  srcLine.className = "hint mono-hint";
  srcLine.textContent = `来源：${p.source}${p.marketplace !== undefined ? ` · 市场 ${p.marketplace}` : ""}`;
  body.appendChild(srcLine);

  // 贡献物分区（固定顺序 + 权威数量——zcode SECTION_ORDER 形态）
  const contribs = manifest?.contributes;
  for (const section of CONTRIB_SECTIONS) {
    const items = contribs?.[section.key];
    if (items === undefined || (Array.isArray(items) && items.length === 0)) continue;
    const list = Array.isArray(items) ? items : [];
    const sec = document.createElement("div");
    sec.className = "plugin-sheet-sec";
    const secTitle = document.createElement("div");
    secTitle.className = "group-title";
    secTitle.textContent = `${section.label}（${String(list.length)}）`;
    sec.appendChild(secTitle);
    for (const item of list) {
      const line = document.createElement("div");
      line.className = "row";
      const name =
        typeof item === "string" ? item : (item.name ?? item.id ?? item.serverName ?? "");
      const nameEl = document.createElement("div");
      nameEl.className = "row-title";
      // 命令=短名调用语义（/hi）；技能名已带 `<插件>/` 命名空间（扫描层拼装）
      nameEl.textContent = section.key === "commands" ? name : section.key === "skills" ? `${p.name}/${name}` : name;
      const desc = section.descOf(item);
      const copy = document.createElement("div");
      copy.className = "row-copy";
      copy.append(nameEl);
      if (desc !== "") {
        const descEl = document.createElement("div");
        descEl.className = "row-desc clamp-2";
        descEl.textContent = desc;
        copy.appendChild(descEl);
      }
      line.append(copy);
      // C：视图条目带「打开」——sheet 内受控 iframe 渲染（sandbox 无同源）
      if (section.key === "views") {
        const viewBtn = btnEl("打开", "btn", "在受控沙箱内渲染视图（无宿主句柄、出网被 CSP 收敛）");
        viewBtn.addEventListener("click", () => {
          const existing = body.querySelector(".plugin-view-host");
          if (existing !== null) existing.remove();
          const host = document.createElement("div");
          host.className = "plugin-view-host";
          host.appendChild(openPluginView(p, name, item.title ?? name));
          sec.after(host);
        });
        line.append(rowControl(viewBtn));
      }
      sec.appendChild(line);
    }
    body.appendChild(sec);
  }
  if (manifest?.theme !== undefined) {
    const sec = document.createElement("div");
    sec.className = "plugin-sheet-sec";
    sec.innerHTML = `<div class="group-title">主题</div><div class="row-desc">随清单 theme 贡献——外观与语言页的「插件主题」下拉消费（T-P3-141 面）。</div>`;
    body.appendChild(sec);
  }

  // 设置表单（F——contributes.settings 类型化控件；sensitive 掩码）
  const settingsSchema = contribs?.settings ?? [];
  const entry = (settingsCache.plugins ?? []).find((d) => d.name === p.name) ?? {};
  if (settingsSchema.length > 0) {
    const sec = document.createElement("div");
    sec.className = "plugin-sheet-sec";
    sec.innerHTML = `<div class="group-title">插件设置（${String(settingsSchema.length)}）</div>`;
    const current = entry.options ?? {};
    for (const item of settingsSchema) {
      const line = rowEl();
      const copy = rowCopyEl(
        Object.assign(document.createElement("div"), { className: "row-title", textContent: item.name }),
        Object.assign(document.createElement("div"), {
          className: "row-desc",
          textContent: `${item.description ?? ""}${item.required === true ? "（必填）" : ""}`,
        }),
      );
      const value = current[item.name];
      let input;
      if (item.type === "boolean") {
        input = switchEl(value === true, () => {}, `插件设置 ${item.name}`);
      } else if (item.type === "select") {
        const sel = document.createElement("select");
        sel.className = "select";
        for (const choice of item.choices ?? []) {
          const opt = document.createElement("option");
          opt.value = String(choice);
          opt.textContent = String(choice);
          if (Object.is(choice, value)) opt.selected = true;
          sel.appendChild(opt);
        }
        input = sel;
      } else {
        input = document.createElement("input");
        input.className = "input";
        input.type = item.sensitive === true ? "password" : item.type === "number" ? "number" : "text";
        input.value = value === undefined || value === null ? "" : String(value);
        input.placeholder = item.sensitive === true && value === undefined ? "（未配置）" : "";
        input.autocomplete = "off";
      }
      input.dataset.pluginSetting = item.name;
      line.append(copy, rowControl(input));
      sec.appendChild(line);
    }
    const saveBtn = btnEl("保存设置", "btn btn-primary", "写入 settings plugins[].options（新会话生效）");
    saveBtn.addEventListener("click", () => {
      const next = {};
      for (const item of settingsSchema) {
        const el = sec.querySelector(`[data-plugin-setting="${item.name}"]`);
        if (el === null) continue;
        let v;
        if (item.type === "boolean") v = el.checked;
        else if (item.type === "number") v = el.value === "" ? undefined : Number(el.value);
        else v = el.value === "" ? undefined : el.value;
        if (v !== undefined && !(item.type === "select" && !(item.choices ?? []).some((c) => Object.is(c, v)))) {
          next[item.name] = v;
        }
      }
      const defs = (settingsCache.plugins ?? []).map((d) =>
        d.name === p.name ? { ...d, options: next } : d,
      );
      writePlugins(defs);
      toast(`插件「${p.name}」设置已保存并热生效`, "info");
      void refreshPluginsList();
    });
    sec.appendChild(saveBtn);
    body.appendChild(sec);
    if (focusSettings) setTimeout(() => saveBtn.scrollIntoView({ block: "center" }), 50);
  }

  const foot = document.createElement("div");
  foot.className = "plugin-sheet-foot";
  const footToggle = switchEl(p.enabled, (checked) => {
    setEnabled(p, checked);
    status.textContent = checked ? "已启用（新会话生效）" : "已停用（清单保留）";
  }, `启停插件 ${p.name}`);
  const removeBtn = btnEl("移除", "btn btn-danger", "从装载清单移除（不删除插件目录文件）");
  removeBtn.addEventListener("click", async () => {
    if (!(await confirmDialog(`从装载清单移除插件「${p.name}」？（不删除插件目录文件）`, { title: "移除插件", confirmLabel: "移除", danger: true }))) return;
    writePlugins((settingsCache.plugins ?? []).filter((d) => d.name !== p.name));
    close();
    void refreshPluginsList();
  });
  const packBtn = btnEl("打包", "btn", "store-only zip（dist/<名>-<版本>.aegentplug）+ sha256——本地分享用");
  packBtn.addEventListener("click", () => void (async () => {
    const envelope = await sendSettings({ op: "plugin-pack", dir: p.source });
    if (!envelope.ok) {
      toast(`打包失败：${envelope.error?.message ?? ""}`, "error");
      return;
    }
    const r = envelope.result;
    toast(`已打包：${r.file}（${String(r.fileCount)} 文件 · sha256 ${r.sha256.slice(0, 12)}…）`, "info");
  })());
  foot.append(footToggle, packBtn, removeBtn);

  panel.append(head, body, foot);
  layer.appendChild(panel);
  document.body.appendChild(layer);
}

// ---------------------------------------------------------------------------
// 安装 + 审批（Q——pi PluginDialogs 风险三档分组 + untrusted 警示）
// ---------------------------------------------------------------------------

/** 贡献面风险分级（审批对话框配色数据面）：hooks=高 / MCP·工具=中 / 其余=低。 */
function riskGroups(manifest) {
  const groups = { high: [], medium: [], low: [] };
  for (const h of manifest?.hooks ?? []) groups.high.push(`hook:${h.point}`);
  if (manifest?.contributes?.mcpServers?.length) groups.medium.push(`MCP server ×${String(manifest.contributes.mcpServers.length)}`);
  if ((manifest?.capabilities ?? []).includes("registerTool")) groups.medium.push("登记智能体工具");
  if ((manifest?.capabilities ?? []).includes("subscribe")) groups.medium.push("订阅会话事件");
  for (const c of manifest?.contributes?.commands ?? []) groups.low.push(`命令 ${manifest.name}/${c.name ?? c.file ?? ""}`);
  if (manifest?.contributes?.skills?.length) groups.low.push(`技能 ×${String(manifest.contributes.skills.length)}`);
  if (manifest?.contributes?.views?.length) groups.low.push(`视图 ×${String(manifest.contributes.views.length)}`);
  if (manifest?.theme !== undefined) groups.low.push("主题 CSS");
  return groups;
}

const RISK_LABELS = { high: "高风险", medium: "中风险", low: "低风险" };

function openApprovalDialog({ name, check, transport, onConfirm }) {
  const manifest = check.manifest;
  const body = document.createElement("div");
  if (manifest?.trust === "untrusted" || transport === "ws") {
    const warn = document.createElement("div");
    warn.className = "plugin-risk warn";
    warn.textContent = "不受信插件：工具登记默认拒绝（ws 需显式勾选放行），卸载随时可撤。";
    body.appendChild(warn);
  }
  const groups = riskGroups(manifest);
  let any = false;
  for (const tier of ["high", "medium", "low"]) {
    const items = groups[tier];
    if (items.length === 0) continue;
    any = true;
    const box = document.createElement("div");
    box.className = `plugin-risk risk-${tier}`;
    const head = document.createElement("div");
    head.className = "plugin-risk-title";
    head.textContent = `${RISK_LABELS[tier]}（${String(items.length)}）`;
    box.appendChild(head);
    const chips = document.createElement("div");
    chips.className = "row-chips";
    for (const item of items) chips.appendChild(chipEl(item));
    box.appendChild(chips);
    body.appendChild(box);
  }
  if (!any) {
    const none = document.createElement("div");
    none.className = "row-desc";
    none.textContent = "该插件未声明任何能力贡献（如纯资源插件）。";
    body.appendChild(none);
  }
  if (transport === "ws" || manifest?.trust === "untrusted") {
    const line = document.createElement("label");
    line.className = "check-line";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = "plugin-allowtools";
    cb.checked = true; // 审批即授权面：默认放行工具登记（pi-desktop 授权语义——插件必须实际生效）
    line.append(cb, document.createTextNode(" 登记其工具（默认勾选；执行照常走会话审批——随时可停用插件）"));
    body.appendChild(line);
  }
  openDialog({
    title: `安装「${name}」？`,
    description: manifest?.description ?? "先审查该插件能做什么——高风险贡献在你接受前不会安装。",
    width: "md",
    body,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      {
        label: "接受并安装",
        className: "btn btn-primary",
        onClick: () =>
          onConfirm({
            allowTools: Boolean(body.querySelector("#plugin-allowtools")?.checked),
          }),
      },
    ],
  });
}

function openPluginInstallDialog(prefill) {
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
  </form>`;
  const form = holder.firstElementChild;
  // 统一安装入口（用户反馈②）：右上角按钮 / 更多菜单 / 创建 tab 共用本对话框
  if (prefill?.name !== undefined) form.querySelector("#plugin-name").value = prefill.name;
  if (prefill?.source !== undefined) form.querySelector("#plugin-source").value = prefill.source;
  openDialog({
    title: "安装插件（先校验后审批）",
    description: "进程内 = 本地目录（plugin.json + index.js，安装前拉真实清单审批）；ws = 进程外不可信隔离（I4）。",
    width: "md",
    body: form,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      { label: "校验并审批", className: "btn btn-primary", onClick: () => void installPluginFromDialog(form) },
    ],
  });
}

async function installPluginFromDialog(form) {
  // openDialog 先 close 再 onClick——DOM 已 detach，必须闭包持有 form 引用
  // （T-P3-146 记档同款坑，T-P3-148 走查复验命中）
  const name = form.querySelector("#plugin-name")?.value.trim() ?? "";
  const source = form.querySelector("#plugin-source")?.value.trim() ?? "";
  const transport = form.querySelector("#plugin-transport")?.value ?? "inprocess";
  if (name === "" || source === "" || name.includes("__")) {
    toast("插件名（不含 __）与装载源必填", "warn");
    return;
  }
  const existing = (settingsCache.plugins ?? []).find((d) => d.name === name);
  if (existing !== undefined && existing.enabled !== false) {
    toast(`插件名已存在：${name}`, "warn");
    return;
  }
  if (transport === "inprocess") {
    // Q 审批链：先 plugin-check 拉真实清单 → 审批对话框 → 确认才落档
    const envelope = await sendSettings({ op: "plugin-check", dir: source });
    if (!envelope.ok) {
      toast(`校验失败：${envelope.error?.message ?? ""}`, "error");
      return;
    }
    const check = envelope.result;
    if (!check.ok) {
      toast(`清单校验失败：${check.error ?? ""}`, "error");
      return;
    }
    if (check.manifest?.name !== undefined && check.manifest.name !== name) {
      toast(`清单名不一致：plugin.json 是「${check.manifest.name}」`, "warn");
      return;
    }
    openApprovalDialog({ name, check, transport, onConfirm: ({ allowTools }) => commitInstall(name, source, transport, allowTools === true) });
    return;
  }
  // ws：无清单文件——审批面按"不受信隔离"固定警示呈现
  try {
    const url = new URL(source);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("协议须为 ws:// 或 wss://");
    if (url.host === "") throw new Error("缺少 host");
  } catch (e) {
    toast(`ws URL 不合法：${e instanceof Error ? e.message : String(e)}`, "error");
    return;
  }
  openApprovalDialog({ name, check: { ok: true }, transport: "ws", onConfirm: ({ allowTools }) => commitInstall(name, source, "ws", allowTools === true) });
}

async function commitInstall(name, source, transport, allowTools) {
  const defs = (settingsCache.plugins ?? []).filter((d) => d.name !== name);
  defs.push({
    name,
    source,
    ...(transport !== "inprocess" ? { transport } : {}),
    ...(allowTools ? { allowTools: true } : {}),
  });
  writePlugins(defs);
  toast(`插件「${name}」已安装并热生效（工具/命令立即可用）`, "info");
  switchTab("installed");
  await flushSettings(); // 先落盘再刷清单（plugins-list 读盘——防抖竞态）
  void refreshPluginsList();
}

// ---------------------------------------------------------------------------
// 挂载 / 卸载
// ---------------------------------------------------------------------------

export async function render(container, route) {
  container.innerHTML = TEMPLATE;
  injectIcons(container);
  if (route?.tab === "market" || route?.tab === "create") activeTab = route.tab;
  else if (route?.tab === "installed") activeTab = "installed";
  document.getElementById("plugin-install")?.addEventListener("click", () => openPluginInstallDialog());
  document.getElementById("plugin-more")?.addEventListener("click", (ev) => {
    openMenu(ev.currentTarget, [
      { label: "安装本地目录 / ws 插件", onClick: () => openPluginInstallDialog() },
      { label: "检查市场插件更新", onClick: () => switchTab("market") },
    ]);
  });
  document.getElementById("plugin-search")?.addEventListener("input", (ev) => {
    searchQuery = ev.target.value;
    void refreshPluginsList();
  });
  // 创建 tab 的"前往安装"→ 统一安装对话框（预填生成结果——用户反馈②：
  // 全应用只有一条安装链入口），不自动装载
  document.getElementById("plugin-tab-create")?.addEventListener("plugin-create:install", (ev) => {
    openPluginInstallDialog({ name: ev.detail.name, source: ev.detail.dir });
  });
  // 市场安装成功 → 已装清单刷新
  document.getElementById("plugin-tab-market")?.addEventListener("market:installed", () => {
    void (async () => {
      dirtySections.delete("plugins"); // host 落盘了 plugins 条目——弃 UI 旧快照
      await resyncSettingsCache();
      void refreshPluginsList();
      // 市场卡片三态刷新（已安装/更新——用户反馈③）
      if (activeTab === "market") await refreshSources(document.getElementById("plugin-tab-market"));
    })();
  });
  bindMarket(document.getElementById("plugin-tab-market"), () => listCache);
  bindCreate(document.getElementById("plugin-tab-create"));
  renderTabs();
  switchTab(activeTab);
}

export function unmount() {
  // 详情 sheet/对话框随 body 直挂层自收束（Esc/遮罩）；无持久监听
}
