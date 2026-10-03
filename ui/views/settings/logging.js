/**
 * 日志中心域（T-P3-154——「日志」分节升级为四卡组）：
 * - 查看器：日期下拉（近 14 天文件）+级别（≥语义）+category+关键词+刷新
 *   +表格（时间/级别徽标/通道/分类/消息）+行展开 data+分页（pideck
 *   LogViewer 形态，查询在 host 侧 log-query 纯函数层）；
 * - 设置：级别热更（info 常驻——设置即存即生效）/保留天数/目录显示/打开目录；
 * - 分片日志：rawLogDir 输入框（旧有面原样保留+定位说明）；
 * - 诊断包：log-export zip（doctor 报告+近 N 天通道日志逐行脱敏）。
 */

import { sendSettings } from "../../api.js";
import { settingsCache } from "../../state.js";
import { appendLine, toast } from "../../feedback.js";
import { markDirty } from "./core.js";

const LEVELS = ["debug", "info", "warn", "error"];
const LEVEL_BADGE = { debug: "deb", info: "inf", warn: "wrn", error: "err" };
const RETENTION_CHOICES = [
  ["14", "14 天"],
  ["30", "30 天"],
  ["90", "90 天"],
  ["0", "永久"],
];

export const SECTION_HTML = `
<section data-section="logging">
  <div class="section-head"><h2 class="section-title">日志中心</h2></div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">日志查看器</div>
        <div class="row-desc">host/agent/ui 三通道按日文件；级别为下限语义（info 显示 info 及以上）</div>
      </div>
      <div class="row-control"><button id="log-refresh" type="button" class="btn">刷新</button></div>
    </div>
  </div>
  <div class="log-filter-row">
    <select id="log-date" class="select"><option value="">最近文件</option></select>
    <select id="log-level" class="select"><option value="">全部级别</option><option value="debug">debug 及以上</option><option value="info">info 及以上</option><option value="warn">warn 及以上</option><option value="error">仅 error</option></select>
    <select id="log-category" class="select"><option value="">全部分类</option></select>
    <input id="log-keyword" class="input" type="text" placeholder="关键词（消息/数据）" autocomplete="off" />
  </div>
  <div id="log-files" class="hint"></div>
  <div id="log-table" class="transfer-list"></div>
  <div class="log-pager">
    <button id="log-prev" type="button" class="btn">上一页</button>
    <span id="log-pageinfo" class="hint"></span>
    <button id="log-next" type="button" class="btn">下一页</button>
  </div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">日志级别（热更）</div>
        <div class="row-desc">info 常驻够排查；debug 全量仅在排障时临时开（量大）</div>
      </div>
      <div class="row-control">
        <select id="log-level-setting" class="select" data-setting="logging">
          <option value="info">info（默认）</option><option value="debug">debug</option><option value="warn">warn</option><option value="error">error</option>
        </select>
      </div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">保留天数</div>
        <div class="row-desc">按日文件超期自动清理（0=永久；清理在写入路径顺带做）</div>
      </div>
      <div class="row-control">
        <select id="log-retention" class="select" data-setting="logging">
          ${RETENTION_CHOICES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">诊断包导出</div>
        <div class="row-desc">zip = doctor 报告 + 近保留期通道日志（<b>逐行脱敏</b>：只留时间/级别/通道/分类/消息——数据原文与分片绝不外发）</div>
      </div>
      <div class="row-control"><button id="log-export" type="button" class="btn">导出诊断包</button></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">原始分片日志目录</div>
        <div class="row-desc">模型原始流分片（raw-日期.jsonl，token 级回放用）——日常排障看上方查看器</div>
      </div>
      <div class="row-control"><input id="logging-rawdir" class="input input-wide" type="text" placeholder="（未设置——不写原始分片）" autocomplete="off" /></div>
    </div>
  </div>
</section>
`;

// —— 查看器状态（分节内存活；卸载即弃） ——

let currentPage = 1;
let totalPages = 1;
let expandedLine = null;

function el(id) {
  return document.getElementById(id);
}

function fmtTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function runQuery() {
  const table = el("log-table");
  if (table === null) return;
  const envelope = await sendSettings({
    op: "log-query",
    log: {
      date: el("log-date")?.value ?? "",
      level: el("log-level")?.value ?? "",
      category: el("log-category")?.value ?? "",
      keyword: el("log-keyword")?.value ?? "",
      page: currentPage,
      pageSize: 50,
    },
  });
  table.replaceChildren();
  if (!envelope.ok) {
    table.textContent = `查询失败：${envelope.error?.message ?? ""}`;
    return;
  }
  const result = envelope.result;
  // 日期/分类下拉填充（保留当前选择）
  const dateSel = el("log-date");
  if (dateSel !== null) {
    const cur = dateSel.value;
    dateSel.replaceChildren(
      new Option("最近文件", ""),
      ...result.dates.map((d) => new Option(`${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}`, d.date)),
    );
    dateSel.value = cur;
  }
  const catSel = el("log-category");
  if (catSel !== null) {
    const cur = catSel.value;
    catSel.replaceChildren(new Option("全部分类", ""), ...result.categories.map((c) => new Option(c, c)));
    catSel.value = cur;
  }
  el("log-files").textContent = `文件：${result.files.map((f) => `${f.name}（${fmtBytes(f.sizeBytes)}）`).join("、") || "（尚无日志）"}`;
  totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  currentPage = result.page;
  el("log-pageinfo").textContent = `${result.total} 行 · 第 ${currentPage}/${totalPages} 页`;
  for (const row of result.rows) {
    const key = `${row.ts}|${row.msg}`;
    const line = document.createElement("div");
    line.className = `transfer-row log-line log-line-${LEVEL_BADGE[row.level] ?? "inf"}`;
    const badge = document.createElement("span");
    badge.className = `checkup-badge log-badge-${LEVEL_BADGE[row.level] ?? "inf"}`;
    badge.textContent = row.level.slice(0, 1).toUpperCase();
    const copy = document.createElement("span");
    copy.className = "transfer-row-copy";
    copy.textContent = `${fmtTime(row.ts)}${row.channel !== undefined ? ` [${row.channel}]` : ""}${row.category !== undefined ? ` (${row.category})` : ""} ${row.msg}`;
    line.append(badge, copy);
    line.addEventListener("click", () => {
      expandedLine = expandedLine === key ? null : key;
      void runQuery(); // 展开态切换——重渲染
    });
    if (expandedLine === key && row.data !== undefined) {
      const detail = document.createElement("pre");
      detail.className = "log-detail";
      detail.textContent = JSON.stringify(row.data, null, 2);
      line.appendChild(detail);
    }
    table.appendChild(line);
  }
  if (result.rows.length === 0) {
    table.textContent = "（无命中行——试试放宽级别/关键词，或检查日期）";
  }
}

function bindViewer() {
  el("log-refresh")?.addEventListener("click", () => {
    currentPage = 1;
    void runQuery();
  });
  for (const id of ["log-date", "log-level", "log-category"]) {
    el(id)?.addEventListener("change", () => {
      currentPage = 1;
      void runQuery();
    });
  }
  el("log-keyword")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      currentPage = 1;
      void runQuery();
    }
  });
  el("log-prev")?.addEventListener("click", () => {
    if (currentPage > 1) currentPage -= 1;
    void runQuery();
  });
  el("log-next")?.addEventListener("click", () => {
    if (currentPage < totalPages) currentPage += 1;
    void runQuery();
  });
}

// —— 设置面（级别热更/保留天数） ——

function bindSettings() {
  const levelSel = el("log-level-setting");
  const retentionSel = el("log-retention");
  if (levelSel !== null) {
    levelSel.addEventListener("change", () => {
      // 级别热更：段级 patch 即存即生效（host reconfigureLogging）
      void (async () => {
        const envelope = await sendSettings({
          op: "update",
          patch: { logging: { ...(settingsCache?.logging ?? {}), level: levelSel.value } },
        });
        if (!envelope.ok) {
          toast(`级别保存失败：${envelope.error?.message ?? ""}`, "warn");
          return;
        }
        toast(`日志级别已切为 ${levelSel.value}（热更生效）`, "info");
      })();
    });
  }
  if (retentionSel !== null) {
    retentionSel.addEventListener("change", () => {
      void (async () => {
        const envelope = await sendSettings({
          op: "update",
          patch: { logging: { ...(settingsCache?.logging ?? {}), retentionDays: Number(retentionSel.value) } },
        });
        if (!envelope.ok) {
          toast(`保留天数保存失败：${envelope.error?.message ?? ""}`, "warn");
          return;
        }
        toast(`保留天数已更新（超期文件将在下次写入时清理）`, "info");
      })();
    });
  }
  el("log-export")?.addEventListener("click", async () => {
    const ok = await confirmDialog("导出诊断包？zip 内含 doctor 报告与近保留期日志（已逐行脱敏——数据原文与分片不含在内）。", {
      title: "导出诊断包",
      confirmLabel: "导出",
    });
    if (!ok) return;
    const envelope = await sendSettings({ op: "log-export" });
    if (!envelope.ok) {
      toast(`导出失败：${envelope.error?.message ?? ""}`, "warn");
      return;
    }
    const { filename, base64 } = envelope.result;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    appendLine(`诊断包已导出：${filename}`, "meta");
    toast("诊断包已导出（已脱敏——可安全附在问题反馈里）", "info");
  });
}

// —— 挂载 / 回填 ——

export function bind() {
  bindViewer();
  bindSettings();
  el("logging-rawdir")?.addEventListener("change", () => markDirty("logging"));
  void runQuery(); // 打开分节即查询最近文件
}

export function fill() {
  const rawDir = el("logging-rawdir");
  if (rawDir !== null) rawDir.value = settingsCache?.logging?.rawLogDir ?? "";
  const levelSel = el("log-level-setting");
  if (levelSel !== null) levelSel.value = settingsCache?.logging?.level ?? "info";
  const retentionSel = el("log-retention");
  if (retentionSel !== null) retentionSel.value = String(settingsCache?.logging?.retentionDays ?? 14);
}

/** 打开日志目录（设置行点击——复用 host op）。 */
export async function openLogDir() {
  await sendSettings({ op: "log-open-dir" });
}

/** 深链/外部打开日志目录确认（导出面预留）。 */
export function confirmClearLogs() {
  void openDialog({
    title: "日志",
    description: "日志按日文件自动滚动与清理——无需手动维护。",
    width: "sm",
    actions: [{ label: "知道了", className: "btn btn-primary" }],
  });
}
