/**
 * 关于中心域（T-P3-155——「关于」分节升级为四卡组）：
 * - 版本与构建：about-info op 读 build-info.json（构建期注入：版本+git SHA+
 *   构建时间——qwen generate-git-commit-info 模式），硬编码删除；
 * - 环境与路径：环境行+四路径（配置/日志/事件库/工作区——**不含凭据路径**）
 *   +打开按钮+「复制诊断信息」（zcode 字段集精简版）；
 * - 更新检查：check-update op（GitHub Releases API+8s 超时软降级——codex
 *   updates.rs 锚；便携版语义=打开 Releases 页引导下载，下载安装归壳域 P2）；
 * - 入口与反馈：仓库/Issues/Releases/License/THIRD_PARTY 链接+issue 预填
 *   环境参数（pi-desktop buildBugReportUrl 锚）。
 */

import { sendSettings } from "../../api.js";
import { toast } from "../../feedback.js";

export const SECTION_HTML = `
<section data-section="about">
  <div class="section-head"><h2 class="section-title">关于中心</h2></div>
  <div class="row-list" id="about-build"></div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">环境与路径</div>
        <div class="row-desc">诊断排查的一眼看面——路径不含凭据文件</div>
      </div>
      <div class="row-control"><button id="about-copy-diag" type="button" class="btn">复制诊断信息</button></div>
    </div>
    <div id="about-env-rows"></div>
  </div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title" id="about-update-title">更新检查</div>
        <div class="row-desc" id="about-update-desc">对照 GitHub Releases 检查新版本（便携版=引导下载，安装归桌面壳）</div>
      </div>
      <div class="row-control">
        <button id="about-check-update" type="button" class="btn">检查更新</button>
        <button id="about-open-releases" type="button" class="btn">打开 Releases 页</button>
      </div>
    </div>
  </div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">入口与反馈</div>
        <div class="row-desc">报问题前建议先在日志中心导出诊断包（已脱敏）</div>
      </div>
    </div>
    <div id="about-links"></div>
  </div>
</section>
`;

const LICENSE_NOTE = "本应用以 AGPL-3.0 许可开源；第三方组件见 THIRD_PARTY.md。";

function el(id) {
  return document.getElementById(id);
}

function linkRow(label, url, hint) {
  const row = document.createElement("div");
  row.className = "row";
  const copy = document.createElement("div");
  copy.className = "row-copy";
  const title = document.createElement("div");
  title.className = "row-title";
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.textContent = label;
  title.appendChild(a);
  copy.appendChild(title);
  if (hint !== undefined) {
    const d = document.createElement("div");
    d.className = "row-desc";
    d.textContent = hint;
    copy.appendChild(d);
  }
  row.appendChild(copy);
  return row;
}

function pathRow(label, value) {
  const row = document.createElement("div");
  row.className = "row";
  const copy = document.createElement("div");
  copy.className = "row-copy";
  const title = document.createElement("div");
  title.className = "row-title";
  title.textContent = label;
  const desc = document.createElement("div");
  desc.className = "row-desc";
  desc.textContent = value !== "" ? value : "（未启用）";
  copy.append(title, desc);
  row.appendChild(copy);
  if (value !== "") {
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "btn";
    openBtn.textContent = "打开";
    openBtn.addEventListener("click", () => {
      void (async () => {
        const envelope = await sendSettings({ op: "open-path", path: value });
        if (!envelope.ok) toast(`打开失败：${envelope.error?.message ?? ""}`, "warn");
      })();
    });
    const control = document.createElement("div");
    control.className = "row-control";
    control.appendChild(openBtn);
    row.appendChild(control);
  }
  return row;
}

let infoLoaded = false;

async function loadInfo() {
  if (infoLoaded) return;
  const envelope = await sendSettings({ op: "about-info" });
  if (!envelope.ok) {
    toast(`关于信息读取失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  infoLoaded = true;
  const { build, env, paths, diagnosticsText } = envelope.result;
  // 卡 1 版本与构建
  const buildBox = el("about-build");
  if (buildBox !== null) {
    buildBox.replaceChildren();
    const title = document.createElement("div");
    title.className = "row-title";
    title.textContent = `aegent v${build.version}`;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "当前";
    title.insertBefore(badge, title.firstChild);
    const desc = document.createElement("div");
    desc.className = "row-desc";
    desc.textContent = `构建 ${build.gitCommit} · ${build.buildTime} · 本地优先的 agent 工作台（事件即真相）`;
    const copy = document.createElement("div");
    copy.className = "row-copy";
    copy.append(title, desc);
    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(copy);
    buildBox.appendChild(row);
  }
  // 卡 2 环境与路径
  const envBox = el("about-env-rows");
  if (envBox !== null) {
    envBox.replaceChildren();
    const envRow = document.createElement("div");
    envRow.className = "row";
    const envCopy = document.createElement("div");
    envCopy.className = "row-copy";
    const envTitle = document.createElement("div");
    envTitle.className = "row-title";
    envTitle.textContent = "运行环境";
    const envDesc = document.createElement("div");
    envDesc.className = "row-desc";
    envDesc.textContent = `${env.platform} ${env.osRelease}（${env.arch}）· Node ${env.nodeVersion} · RSS ${env.memoryRssMb}MB · 已运行 ${env.uptimeMin} 分钟`;
    envCopy.append(envTitle, envDesc);
    envRow.appendChild(envCopy);
    envBox.append(envRow, pathRow("配置文件", paths.settings), pathRow("日志目录", paths.logs), pathRow("事件库", paths.db), pathRow("工作区", paths.workspace));
    el("about-copy-diag")?.addEventListener("click", () => {
      void navigator.clipboard.writeText(diagnosticsText).then(() => toast("诊断信息已复制（不含凭据路径）", "info"));
    });
  }
}

async function checkUpdate(manual) {
  const btn = el("about-check-update");
  if (btn !== null) {
    btn.disabled = true;
    btn.textContent = manual ? "检查中…" : "检查中…";
  }
  const envelope = await sendSettings({ op: "check-update" });
  if (btn !== null) {
    btn.disabled = false;
    btn.textContent = "检查更新";
  }
  if (!envelope.ok) {
    if (manual) toast(`检查失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  const r = envelope.result;
  localStorage.setItem("aegent.update.lastCheck", new Date().toISOString());
  const desc = el("about-update-desc");
  if (r.status === "available") {
    if (desc !== null) desc.textContent = `发现新版本 v${r.latest}（当前 v${r.current}）——点「打开 Releases 页」下载`;
    if (manual) toast(`发现新版本 v${r.latest}`, "info");
  } else if (r.status === "up-to-date") {
    if (desc !== null) desc.textContent = `已是最新版本（v${r.current}）`;
    if (manual) toast("已是最新版本", "info");
  } else {
    if (desc !== null) desc.textContent = `检查失败：${r.reason ?? "网络不可达"}（不影响使用——稍后再试）`;
    if (manual) toast(`检查失败：${r.reason ?? ""}`, "warn");
  }
  const last = localStorage.getItem("aegent.update.lastCheck");
  if (desc !== null && last !== null) {
    desc.textContent += ` · 上次检查 ${new Date(last).toLocaleString()}`;
  }
}

export function bind() {
  el("about-check-update")?.addEventListener("click", () => void checkUpdate(true));
  el("about-open-releases")?.addEventListener("click", () => {
    window.open("https://github.com/Aegink/aegent/releases", "_blank", "noreferrer");
  });
  const links = el("about-links");
  if (links !== null) {
    links.replaceChildren(
      linkRow("GitHub 仓库", "https://github.com/Aegink/aegent", "源码与文档（AGPL-3.0）"),
      linkRow("问题反馈", "https://github.com/Aegink/aegent/issues", "报问题时建议附诊断包与诊断信息"),
      linkRow("Releases", "https://github.com/Aegink/aegent/releases", "版本发布与下载"),
      linkRow("License（AGPL-3.0）", "https://github.com/Aegink/aegent/blob/main/LICENSE", LICENSE_NOTE),
      linkRow("第三方组件", "https://github.com/Aegink/aegent/blob/main/THIRD_PARTY.md", "THIRD_PARTY.md 登记与许可分级"),
    );
  }
  void loadInfo();
  void checkUpdate(false); // 打开关于中心时静默查一次（待澄清 2 裁决）
}

export function fill() {
  // 关于中心无表单回填（全动态渲染）
}
