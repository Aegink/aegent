/**
 * 插件中心 · 市场 tab（T-P3-148 K/L/M/N——git 仓库 + marketplace.json = 市场
 * 的 UI 面）：源管理（添加/刷新/移除——zcode PluginStoreSourcesDialog 行形态
 * ：名称 + N 插件 · 上次刷新 + 失败红行；官方源禁删不适用——我们无内置源）
 * + 源插件列表（行卡 + 安装按钮 → 主视图审批链）+ 更新检查（⋯ 菜单入口）。
 * 全部操作走 op:market（action 闭集）——长耗时 git 操作带 loading 态与诚实
 * 错误回执。
 */

import { sendSettings } from "../../api.js";
import { toast } from "../../feedback.js";
import { t } from "../../i18n.js";
import { openDialog, btnEl, emptyState, chipEl } from "./core.js";

export const MARKET_HTML = `
<div class="plugin-market">
  <div class="plugins-toolbar">
    <div class="group-title">市场源</div>
    <div class="row-control">
      <button id="market-updates" type="button" class="btn">检查更新</button>
      <button id="market-add" type="button" class="btn btn-primary">添加市场源</button>
    </div>
  </div>
  <div id="market-source-list" class="row-list"></div>
  <div id="market-plugins-area"></div>
</div>
`;

export function bindMarket(host, getInstalled) {
  host.querySelector("#market-add")?.addEventListener("click", () => openAddSourceDialog(host));
  host.querySelector("#market-updates")?.addEventListener("click", () => void checkUpdates(host));
  // 已装状态提供器（主视图传 listCache——卡片三态判定面）
  host.__getInstalled = getInstalled ?? (() => []);
  void refreshSources(host);
}

export async function refreshSources(host, selectId = null) {
  const list = host.querySelector("#market-source-list");
  if (list === null) return;
  list.replaceChildren(emptyState("市场源加载中…", ""));
  const envelope = await sendSettings({ op: "market", action: "list" });
  list.replaceChildren();
  if (!envelope.ok) {
    list.appendChild(emptyState("市场清单不可用", envelope.error?.message ?? ""));
    return;
  }
  const marketplaces = envelope.result.marketplaces ?? [];
  if (marketplaces.length === 0) {
    list.appendChild(
      emptyState(
        "还没有市场源",
        "添加一个 git 仓库（含 marketplace.json 索引）或本地目录即可当插件市场；插件中心创建的插件会自动登记进工作区 dev 市场。",
      ),
    );
    return;
  }
  for (const m of marketplaces) {
    list.appendChild(sourceRow(host, m));
  }
  const target = selectId ?? marketplaces[0]?.id;
  if (target !== undefined && target !== null) {
    await showMarketPlugins(host, target);
  }
}

function sourceRow(host, m) {
  const row = document.createElement("div");
  row.className = "row";
  const copy = document.createElement("div");
  copy.className = "row-copy";
  const title = document.createElement("div");
  title.className = "row-title";
  title.textContent = m.name;
  title.appendChild(chipEl(m.source?.type === "git" ? "git" : "本地"));
  if (m.pluginCount !== undefined) title.appendChild(chipEl(`${String(m.pluginCount)} 插件`));
  const meta = document.createElement("div");
  meta.className = "row-desc";
  const updated = m.lastUpdated !== undefined ? ` · 上次刷新 ${new Date(m.lastUpdated).toLocaleString()}` : "";
  meta.textContent = `${m.source?.url ?? m.source?.path ?? ""}${updated}`;
  copy.append(title, meta);
  if (m.lastRefreshFailure !== undefined) {
    const fail = document.createElement("div");
    fail.className = "row-desc error-text";
    fail.textContent = `⚠ 刷新失败：${m.lastRefreshFailure.message}`;
    copy.appendChild(fail);
  }
  const selectBtn = btnEl("浏览", "btn", "查看此市场的插件");
  selectBtn.addEventListener("click", () => void showMarketPlugins(host, m.id));
  const refreshBtn = btnEl("刷新", "btn", m.source?.type === "git" ? "ls-remote 比对远端，有变化才重拉" : "重读本地清单");
  refreshBtn.addEventListener("click", () => void refreshOne(host, m.id));
  const removeBtn = btnEl("移除", "btn btn-danger", "移除市场源（已装插件不受影响——各自卸载）");
  removeBtn.addEventListener("click", async () => {
    const { confirmDialog } = await import("./core.js");
    if (!(await confirmDialog(`移除市场源「${m.name}」？（已安装的插件不受影响）`, { title: "移除市场源", confirmLabel: "移除", danger: true }))) return;
    const envelope = await sendSettings({ op: "market", action: "remove", marketplace: m.id });
    if (!envelope.ok) {
      toast(`移除失败：${envelope.error?.message ?? ""}`, "error");
      return;
    }
    toast(`市场源已移除：${m.name}`, "info");
    await refreshSources(host);
  });
  row.append(copy, Object.assign(document.createElement("div"), { className: "row-control" }));
  row.lastChild.append(selectBtn, refreshBtn, removeBtn);
  return row;
}

async function refreshOne(host, id) {
  toast("刷新中…（git 源先 ls-remote 比对）", "info");
  const envelope = await sendSettings({ op: "market", action: "refresh", marketplace: id });
  if (!envelope.ok) {
    toast(`刷新失败：${envelope.error?.message ?? ""}`, "error");
  } else {
    const r = envelope.result.refreshed;
    toast(r.changed ? `市场已更新（${String(r.pluginCount)} 插件）` : "远端无变化", "info");
  }
  await refreshSources(host, id);
}

async function showMarketPlugins(host, id) {
  const area = host.querySelector("#market-plugins-area");
  if (area === null) return;
  area.replaceChildren(emptyState("插件清单加载中…", ""));
  const envelope = await sendSettings({ op: "market", action: "plugins", marketplace: id });
  area.replaceChildren();
  if (!envelope.ok) {
    area.appendChild(emptyState("市场插件不可用", envelope.error?.message ?? ""));
    return;
  }
  const plugins = envelope.result.plugins ?? [];
  // 卡片三态判定（用户反馈③）：对照已装清单——同市场同名 = 已装；市场条目
  // 版本高于已装 manifest.version = 有更新（semver-lite 前端比对）
  const installed = (host.__getInstalled?.() ?? []).filter((p) => p.marketplace === id);
  const installedByName = new Map(installed.map((p) => [p.name, p]));
  const head = document.createElement("div");
  head.className = "group-title";
  head.textContent = `市场插件（${String(plugins.length)}）`;
  area.appendChild(head);
  if (plugins.length === 0) {
    area.appendChild(emptyState("此市场还没有插件条目", "在市场仓库的 marketplace.json 的 plugins 数组里加条目"));
    return;
  }
  const list = document.createElement("div");
  list.className = "row-list";
  for (const p of plugins) {
    list.appendChild(marketPluginRow(host, id, p, installedByName.get(p.name)));
  }
  area.appendChild(list);
}

function marketVersion(p) {
  return p.versions?.find((v) => v.yanked !== true)?.version ?? p.version ?? p.manifestVersion;
}

function isNewerUiVersion(candidate, current) {
  const parse = (v) => {
    const m = String(v ?? "").match(/^(\d+)\.(\d+)\.(\d+)/);
    return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const a = parse(candidate);
  const b = parse(current);
  if (a === null || b === null) return candidate !== current;
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

function marketPluginRow(host, marketId, p, installed) {
  const row = document.createElement("div");
  row.className = "row";
  const badge = document.createElement("span");
  badge.className = "icon-badge";
  badge.textContent = (p.name[0] ?? "?").toUpperCase();
  const copy = document.createElement("div");
  copy.className = "row-copy";
  const title = document.createElement("div");
  title.className = "row-title";
  title.textContent = p.name;
  title.appendChild(chipEl(p.source?.type === "git" ? "git 源" : "本地"));
  const marketVer = marketVersion(p);
  if (p.manifestVersion !== undefined) title.appendChild(chipEl(`v${p.manifestVersion}`));
  else if (marketVer !== undefined) title.appendChild(chipEl(`v${marketVer}`));
  if (installed !== undefined) title.appendChild(chipEl("已安装"));
  const desc = document.createElement("div");
  desc.className = "row-desc clamp-2";
  desc.textContent = p.description ?? `${p.source?.url ?? p.source?.path ?? ""}`;
  copy.append(title, desc);
  const control = Object.assign(document.createElement("div"), { className: "row-control" });
  const installedVersion = installed?.manifest?.version;
  const hasUpdate = installed !== undefined && marketVer !== undefined && isNewerUiVersion(marketVer, installedVersion);
  if (installed === undefined) {
    const installBtn = btnEl("安装", "btn btn-primary", "物化来源 → 校验清单 → 原子激活进装载清单（热生效）");
    installBtn.addEventListener("click", () => void installOne(host, marketId, p.name, installBtn));
    control.append(installBtn);
  } else if (hasUpdate) {
    const updateBtn = btnEl(`更新到 v${marketVer}`, "btn btn-primary", "重物化覆盖安装（保留启停与设置，热生效）");
    updateBtn.addEventListener("click", () => void installOne(host, marketId, p.name, updateBtn, "更新"));
    control.append(updateBtn);
  } else {
    const done = btnEl("已安装", "btn", "本市场插件已安装——启停/卸载在「已安装」tab");
    done.disabled = true;
    control.append(done);
  }
  row.append(badge, copy, control);
  return row;
}

async function installOne(host, marketId, name, btn, verb = "安装") {
  if (btn !== null) {
    btn.disabled = true;
    btn.textContent = verb === "更新" ? "更新中…（git 源需 clone）" : "安装中…（git 源需 clone）";
  }
  try {
    const envelope = await sendSettings({ op: "market", action: "install", marketplace: marketId, name });
    if (!envelope.ok) {
      toast(`${verb}失败：${envelope.error?.message ?? ""}`, "error");
      return;
    }
    const r = envelope.result.installed;
    toast(verb === "更新" ? `插件已更新：${r.name} v${r.version}（热生效）` : `插件已安装：${r.name} v${r.version}（热生效）`, "info");
    host.dispatchEvent(new CustomEvent("market:installed", { detail: { marketplace: marketId } }));
  } finally {
    if (btn !== null) {
      btn.disabled = false;
      btn.textContent = verb;
    }
  }
}

async function checkUpdates(host) {
  const envelope = await sendSettings({ op: "market", action: "updates" });
  if (!envelope.ok) {
    toast(`更新检查失败：${envelope.error?.message ?? ""}`, "error");
    return;
  }
  const updates = envelope.result.updates ?? [];
  if (updates.length === 0) {
    toast("全部市场插件都是最新", "info");
    return;
  }
  const body = document.createElement("div");
  for (const u of updates) {
    const line = document.createElement("div");
    line.className = "row";
    const copy = document.createElement("div");
    copy.className = "row-copy";
    copy.innerHTML = `<div class="row-title">${u.name}</div><div class="row-desc">${u.marketplace} · v${u.installedVersion} → v${u.availableVersion}</div>`;
    const btn = btnEl("更新", "btn btn-primary", "重物化覆盖安装（保留启停与设置）");
    btn.addEventListener("click", () => {
      void (async () => {
        const e2 = await sendSettings({ op: "market", action: "install", marketplace: u.marketplace, name: u.name });
        toast(e2.ok ? `已更新：${u.name}` : `更新失败：${e2.error?.message ?? ""}`, e2.ok ? "info" : "error");
        dlg.close();
        host.dispatchEvent(new CustomEvent("market:installed"));
      })();
    });
    line.append(copy, Object.assign(document.createElement("div"), { className: "row-control" }));
    line.lastChild.append(btn);
    body.appendChild(line);
  }
  const dlg = openDialog({
    title: `可更新插件（${String(updates.length)}）`,
    description: "版本轴比对（市场快照条目 version vs 已装版本）——git 市场先在源上点刷新才有新版本可见。",
    width: "md",
    body,
    actions: [{ label: "关闭", className: "btn btn-ghost" }],
  });
}

/** 添加市场源（单输入框——zcode AddMarketplaceSourceDialog 形态：多协议自动识别）。 */
function openAddSourceDialog(host) {
  const body = document.createElement("div");
  const label = document.createElement("label");
  label.className = "form-grid";
  label.innerHTML = `<label>市场源（git 仓库 URL / owner/repo / 本地目录）<input id="market-source-input" class="input" type="text" placeholder="https://github.com/you/plugin-market.git 或 本地目录" autocomplete="off" /></label>`;
  body.appendChild(label);
  const err = document.createElement("div");
  err.className = "row-desc error-text";
  err.hidden = true;
  body.appendChild(err);
  const dlg = openDialog({
    title: "添加插件市场",
    description: "市场 = 一个含 marketplace.json 索引的 git 仓库或本地目录；条目 source 支持相对路径与 git 远端。",
    width: "md",
    body,
    actions: [
      { label: "取消", className: "btn btn-ghost" },
      {
        label: "添加",
        className: "btn btn-primary",
        onClick: () =>
          void (async () => {
            const input = body.querySelector("#market-source-input");
            const value = input?.value.trim() ?? "";
            if (value === "") return;
            err.hidden = true;
            const envelope = await sendSettings({ op: "market", action: "add", source: value });
            if (!envelope.ok) {
              err.hidden = false;
              err.textContent = `添加失败：${envelope.error?.message ?? ""}`;
              return;
            }
            const r = envelope.result.added;
            toast(`市场已添加：${r.name}（${String(r.pluginCount)} 插件）`, "info");
            dlg.close();
            await refreshSources(host, r.id);
          })(),
      },
    ],
  });
  setTimeout(() => body.querySelector("#market-source-input")?.focus(), 50);
}
