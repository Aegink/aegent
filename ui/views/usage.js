/**
 * U12/T-P3-111 统计页（T-P3-135 · UI 批次 B⑩ 重做——ZCode usage-stats 形态
 * 的方案 A 手绘复刻：摘要卡行 grid-cols-5 + Intl compact + tabular-nums +
 * 近 7/30 日胶囊切换 + SVG 趋势线〔六色板 --chart-N/网格虚线/图例色点/单档
 * hover 竖线——recharts 级 tooltip 简化记档〕+ 活跃热力图〔aspect-square
 * rounded-[4px] 五档 --heat-N + 月份标签行〕+ 模型甜甜圈）。数据源 =
 * query op:"usage" 单源（byDay/byModel 为批 B⑩ host 侧定形——方案 §1.2
 * 缺口收口，server e2e 钉死）；上下文检查器/成本表/按轮表既有面保留。
 */

import { sendQuery } from "../api.js";
import { getSessionId } from "../state.js";

const TEMPLATE = `
<aside id="usage-panel" aria-label="统计">
  <div class="settings-page">
    <header class="tab-header">
      <h1 class="tab-title">统计</h1>
      <button id="usage-close" type="button" class="btn btn-ghost">关闭</button>
    </header>
    <div class="tab-body">
      <section>
        <div class="section-head"><h2 class="section-title">概览</h2></div>
        <div id="usage-summary" class="stat-cards"></div>
      </section>
      <section>
        <div class="section-head">
          <h2 class="section-title">每日趋势</h2>
          <div id="usage-range" class="tabs-pill" role="tablist">
            <button type="button" class="tab-trigger active" data-range="7">近 7 日</button>
            <button type="button" class="tab-trigger" data-range="30">近 30 日</button>
          </div>
        </div>
        <div class="card-box trend-wrap">
          <svg id="usage-trend" role="img" aria-label="每日 token 用量趋势"></svg>
          <div id="trend-tip" class="trend-tip"></div>
          <div id="trend-legend" class="legend-row"></div>
        </div>
      </section>
      <section>
        <div class="section-head">
          <h2 class="section-title">活跃热力</h2>
          <span class="hint">近 26 周 · 每日 token 五档</span>
        </div>
        <div class="heatmap-box">
          <div id="usage-heatmap" class="heatmap-grid"></div>
          <div id="heatmap-months" class="heatmap-months"></div>
        </div>
      </section>
      <section>
        <div class="section-head"><h2 class="section-title">模型占比</h2></div>
        <div class="donut-wrap card-box">
          <svg id="usage-donut" width="180" height="180" role="img" aria-label="按模型 token 占比"></svg>
          <div id="donut-legend" class="donut-legend"></div>
        </div>
      </section>
      <section>
        <div class="section-head"><h2 class="section-title">辅助任务分账</h2></div>
        <table id="task-usage-table">
          <thead>
            <tr><th>任务</th><th>模型</th><th>次数</th><th>总 token</th></tr>
          </thead>
          <tbody></tbody>
        </table>
        <p id="task-usage-empty" class="hint">暂无记录——标题生成、回复润色等辅助功能被使用后，用量会归因显示在这里。</p>
      </section>
      <section>
        <div class="section-head"><h2 class="section-title">上下文检查器</h2></div>
        <div class="ctx-meter"><div id="ctx-meter-fill"></div></div>
        <p id="ctx-text" class="hint"></p>
        <p id="compaction-text" class="hint"></p>
      </section>
      <section>
        <div class="section-head"><h2 class="section-title">成本统计（按会话）</h2></div>
        <table id="cost-table">
          <thead>
            <tr><th>会话</th><th>轮数</th><th>总 token</th><th>成本</th></tr>
          </thead>
          <tbody></tbody>
        </table>
        <p id="cost-hint" class="hint"></p>
      </section>
      <section>
        <div class="section-head"><h2 class="section-title">按轮用量（本会话）</h2></div>
        <table id="turn-table">
          <thead>
            <tr><th>轮</th><th>请求</th><th>输入</th><th>输出</th><th>缓存命中</th><th>成本</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </section>
    </div>
  </div>
</aside>
`;

const compactFmt = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

function fmtTokens(n) {
  if (!Number.isFinite(n)) return "—";
  return compactFmt.format(n);
}

function fmtCost(usd) {
  if (!Number.isFinite(usd)) return "—";
  return `$${usd.toFixed(4)}`;
}

function localDayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// —— 摘要卡行（grid-cols-5：累计 token/累计成本/会话/轮数/峰值日）——
function renderSummary(u) {
  const box = document.getElementById("usage-summary");
  if (box === null) return;
  const sessions = u.sessions ?? [];
  const costs = u.costs ?? [];
  const days = u.byDay ?? [];
  const totalTokens = sessions.reduce((s, x) => s + (x.totalTokens ?? 0), 0);
  const totalCost = costs.reduce((s, x) => s + (x.costUsd ?? 0), 0);
  const totalTurns = sessions.reduce((s, x) => s + (x.requests ?? 0), 0);
  const peakDay = days.reduce((m, d) => Math.max(m, d.totalTokens ?? 0), 0);
  const cards = [
    { label: "累计 token", value: sessions.length === 0 ? "—" : fmtTokens(totalTokens) },
    { label: "累计成本", value: totalCost > 0 ? fmtCost(totalCost) : "—" },
    { label: "会话数", value: sessions.length === 0 ? "—" : String(sessions.length) },
    { label: "轮数", value: sessions.length === 0 ? "—" : fmtTokens(totalTurns) },
    { label: "峰值日 token", value: days.length === 0 ? "—" : fmtTokens(peakDay) },
  ];
  box.replaceChildren();
  for (const c of cards) {
    const card = document.createElement("div");
    card.className = "stat-card";
    const v = document.createElement("div");
    v.className = "stat-value";
    v.textContent = c.value;
    const l = document.createElement("div");
    l.className = "stat-label";
    l.textContent = c.label;
    card.append(v, l);
    box.appendChild(card);
  }
}

// —— SVG 趋势线（两序列：输入 --chart-1 / 输出 --chart-2；平滑曲线 = 中点
//    二次贝塞尔；网格虚线 + 单档 hover 竖线提示——方案 A 交互简化记档）——
let usageData = null;
let trendRange = 7;

function renderTrend() {
  const svg = document.getElementById("usage-trend");
  const tip = document.getElementById("trend-tip");
  if (svg === null || usageData === null) return;
  const days = usageData.byDay ?? [];
  const byDayMap = new Map(days.map((d) => [d.day, d]));
  // 近 N 日窗口（空日补 0——趋势线连续）
  const points = [];
  const today = new Date();
  for (let i = trendRange - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = localDayKey(d);
    const row = byDayMap.get(key);
    points.push({
      day: key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      input: row?.inputTokens ?? 0,
      output: row?.outputTokens ?? 0,
      total: row?.totalTokens ?? 0,
    });
  }
  const width = Math.max(svg.parentElement?.clientWidth ?? 600, 320);
  const height = 180;
  const pad = { l: 48, r: 12, t: 14, b: 24 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const maxVal = Math.max(1, ...points.map((p) => p.input + p.output));
  const x = (i) => pad.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => pad.t + ih - (v / maxVal) * ih;
  const ns = "http://www.w3.org/2000/svg";
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", String(height));
  svg.replaceChildren();
  const el = (tag, attrs) => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };
  // 网格虚线（3 条 + 刻度值——Intl compact）
  for (let g = 0; g <= 3; g++) {
    const vy = pad.t + (ih * g) / 3;
    const value = maxVal * (1 - g / 3);
    svg.append(
      el("line", { x1: pad.l, y1: vy, x2: width - pad.r, y2: vy, stroke: "var(--border)", "stroke-dasharray": "4 4", "stroke-width": 1 }),
      el("text", { x: pad.l - 8, y: vy + 4, "text-anchor": "end", "font-size": 10, fill: "var(--text-subtlest)" }),
    );
    svg.lastChild.textContent = fmtTokens(value);
  }
  // x 轴日期标签（首/中/尾——去重）
  for (const i of [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])]) {
    const t = el("text", { x: x(i), y: height - 6, "text-anchor": "middle", "font-size": 10, fill: "var(--text-subtlest)" });
    t.textContent = points[i].label;
    svg.appendChild(t);
  }
  // 平滑 path（中点二次贝塞尔）
  const smoothPath = (pick) => {
    const pts = points.map((p, i) => [x(i), y(pick(p))]);
    if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;
    let dPath = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1][0] + pts[i][0]) / 2;
      const my = (pts[i - 1][1] + pts[i][1]) / 2;
      dPath += ` Q ${pts[i - 1][0]} ${pts[i - 1][1]} ${mx} ${my} T ${pts[i][0]} ${pts[i][1]}`;
    }
    return dPath;
  };
  svg.append(
    el("path", { d: smoothPath((p) => p.input), fill: "none", stroke: "var(--chart-1)", "stroke-width": 2, "stroke-linecap": "round" }),
    el("path", { d: smoothPath((p) => p.output), fill: "none", stroke: "var(--chart-2)", "stroke-width": 2, "stroke-linecap": "round" }),
  );
  // hover 竖线（单档提示：日期 + 输入/输出/合计——绝对定位 div tip）
  const guide = el("line", { y1: pad.t, y2: pad.t + ih, stroke: "var(--border-hover)", "stroke-width": 1, visibility: "hidden" });
  svg.appendChild(guide);
  svg.onmousemove = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * width;
    const idx = Math.max(0, Math.min(points.length - 1, Math.round(((px - pad.l) / iw) * (points.length - 1))));
    const p = points[idx];
    guide.setAttribute("x1", String(x(idx)));
    guide.setAttribute("x2", String(x(idx)));
    guide.setAttribute("visibility", "visible");
    if (tip !== null) {
      tip.style.display = "block";
      tip.style.left = `${(x(idx) / width) * rect.width + 10}px`;
      tip.style.top = "8px";
      tip.textContent = `${p.day} · 输入 ${fmtTokens(p.input)} / 输出 ${fmtTokens(p.output)} / 合计 ${fmtTokens(p.total)}`;
    }
  };
  svg.onmouseleave = () => {
    guide.setAttribute("visibility", "hidden");
    if (tip !== null) tip.style.display = "none";
  };
  // 图例（色点 + 序列名——六色板前两色）
  const legend = document.getElementById("trend-legend");
  if (legend !== null) {
    legend.replaceChildren();
    for (const [color, label] of [["var(--chart-1)", "输入 token"], ["var(--chart-2)", "输出 token"]]) {
      const item = document.createElement("span");
      const dot = document.createElement("span");
      dot.className = "legend-dot";
      dot.style.setProperty("--legend-color", color);
      item.append(dot, document.createTextNode(label));
      legend.appendChild(item);
    }
  }
}

// —— 热力图（近 26 周按周列——aspect-square 格子五档 + 月份标签行）——
function renderHeatmap() {
  const grid = document.getElementById("usage-heatmap");
  const months = document.getElementById("heatmap-months");
  if (grid === null || usageData === null) return;
  const byDayMap = new Map((usageData.byDay ?? []).map((d) => [d.day, d.totalTokens ?? 0]));
  const today = new Date();
  // 对齐周列（行 0 = 周日）：end = 本周周六，start = 26 周前的周日（27 列首）
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const start = new Date(end);
  start.setDate(start.getDate() - 26 * 7 - 6);
  const maxVal = Math.max(1, ...(usageData.byDay ?? []).map((d) => d.totalTokens ?? 0));
  grid.replaceChildren();
  if (months !== null) months.replaceChildren();
  const colWidth = 15; // 13px 格 + 2px 列距
  const cursor = new Date(start);
  let lastMonth = -1;
  // 27 列 × 7 行逐日推进（未来日期留空不画——位置由 gridColumn/gridRow 定）
  for (let i = 0; i < 27 * 7; i++) {
    const col = Math.floor(i / 7);
    const row = i % 7;
    if (cursor <= today) {
      const key = localDayKey(cursor);
      const v = byDayMap.get(key) ?? 0;
      // 五档：0 → heat-0；>0 按占比四档
      const level = v === 0 ? 0 : v / maxVal <= 0.25 ? 1 : v / maxVal <= 0.5 ? 2 : v / maxVal <= 0.75 ? 3 : 4;
      const cell = document.createElement("div");
      cell.className = "heatmap-cell";
      cell.style.background = `var(--heat-${level})`;
      cell.style.gridColumn = String(col + 1);
      cell.style.gridRow = String(row + 1);
      cell.title = `${key} · ${fmtTokens(v)} token`;
      grid.appendChild(cell);
      if (row === 0 && cursor.getMonth() !== lastMonth && months !== null) {
        const span = document.createElement("span");
        span.textContent = `${cursor.getMonth() + 1}月`;
        span.style.left = `${col * colWidth}px`;
        months.appendChild(span);
        lastMonth = cursor.getMonth();
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
}

// —— 辅助任务分账（T-P3-147 F：request/header aux 聚合的表格渲染）——
const TASK_LABELS = { polish: "润色", title: "会话标题", "enhancement-test": "配置测试" };
function renderTaskUsage(rows) {
  const tbody = document.querySelector("#task-usage-table tbody");
  const empty = document.getElementById("task-usage-empty");
  if (tbody === null) return;
  tbody.replaceChildren();
  if (empty !== null) empty.hidden = rows.length > 0;
  for (const r of rows) {
    const tr = document.createElement("tr");
    const td1 = document.createElement("td");
    td1.textContent = TASK_LABELS[r.purpose] ?? r.purpose;
    const td2 = document.createElement("td");
    td2.textContent = `${r.provider} · ${r.modelId}`;
    const td3 = document.createElement("td");
    td3.textContent = String(r.requests);
    const td4 = document.createElement("td");
    td4.textContent = String(r.totalTokens);
    tr.append(td1, td2, td3, td4);
    tbody.appendChild(tr);
  }
}

// —— 模型甜甜圈（stroke-dasharray 分段——六色板循环，>6 归"其他"）——
function renderDonut() {
  const svg = document.getElementById("usage-donut");
  const legend = document.getElementById("donut-legend");
  if (svg === null || usageData === null) return;
  const models = usageData.byModel ?? [];
  const total = models.reduce((s, m) => s + (m.totalTokens ?? 0), 0);
  const ns = "http://www.w3.org/2000/svg";
  svg.replaceChildren();
  if (legend !== null) legend.replaceChildren();
  if (total === 0) {
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", "90");
    text.setAttribute("y", "95");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", 12);
    text.setAttribute("fill", "var(--text-subtlest)");
    text.textContent = "暂无数据";
    svg.appendChild(text);
    return;
  }
  const r = 64;
  const circumference = 2 * Math.PI * r;
  // 前 5 模型 + 其余归"其他"（六色板第 6 色）
  const top = models.slice(0, 5);
  const rest = models.slice(5);
  const segs = [...top.map((m) => ({ label: m.modelId, value: m.totalTokens }))];
  if (rest.length > 0) segs.push({ label: `其他（${rest.length}）`, value: rest.reduce((s, m) => s + (m.totalTokens ?? 0), 0) });
  let offset = 0;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const frac = seg.value / total;
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", "90");
    circle.setAttribute("cy", "90");
    circle.setAttribute("r", String(r));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", CHART_COLORS[i % CHART_COLORS.length]);
    circle.setAttribute("stroke-width", "22");
    circle.setAttribute("stroke-dasharray", `${frac * circumference} ${circumference}`);
    circle.setAttribute("stroke-dashoffset", String(-offset * circumference));
    circle.setAttribute("transform", "rotate(-90 90 90)");
    circle.setAttribute("stroke-linecap", "butt");
    const title = document.createElementNS(ns, "title");
    title.textContent = `${seg.label} · ${fmtTokens(seg.value)} token（${Math.round(frac * 100)}%）`;
    circle.appendChild(title);
    svg.appendChild(circle);
    offset += frac;
  }
  const center = document.createElementNS(ns, "text");
  center.setAttribute("x", "90");
  center.setAttribute("y", "86");
  center.setAttribute("text-anchor", "middle");
  center.setAttribute("font-size", 16);
  center.setAttribute("font-weight", 600);
  center.setAttribute("fill", "var(--text)");
  center.textContent = fmtTokens(total);
  const sub = document.createElementNS(ns, "text");
  sub.setAttribute("x", "90");
  sub.setAttribute("y", "104");
  sub.setAttribute("text-anchor", "middle");
  sub.setAttribute("font-size", 10);
  sub.setAttribute("fill", "var(--text-subtlest)");
  sub.textContent = "token";
  svg.append(center, sub);
  if (legend !== null) {
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const item = document.createElement("div");
      item.className = "legend-item";
      const dot = document.createElement("span");
      dot.className = "legend-dot";
      dot.style.setProperty("--legend-color", CHART_COLORS[i % CHART_COLORS.length]);
      const name = document.createElement("span");
      name.textContent = seg.label;
      const val = document.createElement("span");
      val.className = "legend-value";
      val.textContent = `${fmtTokens(seg.value)} · ${Math.round((seg.value / total) * 100)}%`;
      item.append(dot, name, val);
      legend.appendChild(item);
    }
  }
}

// T-P3-165 需求 5：用量页失效重拉（idle=turn 末落盘完成——页面开着时
// 自动刷新，不再"对话了页面恒旧"；监听模块级只挂一次，元素消失即跳过）
let idleHooked = false;
let lastContainer = null;

export async function render(container) {
  lastContainer = container;
  if (!idleHooked) {
    idleHooked = true;
    window.addEventListener("agent:idle", () => {
      if (lastContainer !== null && lastContainer.isConnected && location.hash === "#usage") {
        void render(lastContainer);
      }
    });
  }
  container.innerHTML = TEMPLATE;
  document.getElementById("usage-close").addEventListener("click", () => {
    location.hash = "#chat";
  });
  for (const btn of document.querySelectorAll("#usage-range .tab-trigger")) {
    btn.addEventListener("click", () => {
      trendRange = Number(btn.dataset.range) || 7;
      for (const b of document.querySelectorAll("#usage-range .tab-trigger")) {
        b.classList.toggle("active", b === btn);
      }
      renderTrend();
    });
  }
  const envelope = await sendQuery({ sessionId: getSessionId() || "-", op: "usage" });
  if (document.getElementById("ctx-text") === null) return; // 回包晚于导航——丢弃
  if (!envelope.ok) {
    // 无库等类型化拒绝：统计四区空态降级（空数据渲染器各自呈现"暂无"形态）
    usageData = { byDay: [], byModel: [], sessions: [], costs: [], currentSession: {}, byTask: [] };
    renderSummary(usageData);
    renderTrend();
    renderHeatmap();
    renderDonut();
    renderTaskUsage([]);
    document.getElementById("ctx-text").textContent = `用量面不可用：${envelope.error?.message ?? ""}`;
    document.getElementById("compaction-text").textContent = "";
    document.getElementById("cost-hint").textContent = "";
    return;
  }
  const u = envelope.result;
  usageData = u;

  // —— 摘要卡 + 趋势 + 热力 + 甜甜圈 + 按任务分账（批 B⑩/T-P3-147 F）——
  renderSummary(u);
  renderTrend();
  renderHeatmap();
  renderDonut();
  renderTaskUsage(u.byTask ?? []);

  // 上下文检查器：末轮 totalTokens ≈ 当前窗口占用（E17/F 族事实投影）
  const ctx = u.contextWindow ?? 0;
  const used = u.currentSession?.contextTokens ?? 0;
  const pct = ctx > 0 ? Math.min(100, Math.round((used / ctx) * 100)) : 0;
  document.getElementById("ctx-meter-fill").style.width = `${pct}%`;
  document.getElementById("ctx-meter-fill").classList.toggle("ctx-hot", pct >= 80);
  document.getElementById("ctx-text").textContent =
    `≈ ${fmtTokens(used)} / ${fmtTokens(ctx)} token（${pct}%）——取本会话末轮计量`;
  const comp = u.currentSession?.compaction ?? { total: 0, failures: [] };
  document.getElementById("compaction-text").textContent =
    comp.total === 0
      ? "本会话尚无压缩"
      : `已压缩 ${comp.total} 次${comp.failures.length > 0 ? `（${comp.failures.length} 次失败）` : ""}`;

  // 成本统计页：按会话（token 全库聚合 + 成本 = 计价表驱动——未配置如实缺席）
  const costBody = document.querySelector("#cost-table tbody");
  costBody.replaceChildren();
  const sessionRows = u.sessions ?? [];
  for (const s of sessionRows) {
    const cost = (u.costs ?? []).find((c) => c.sessionId === s.sessionId);
    const tr = document.createElement("tr");
    for (const text of [s.sessionId, String(s.requests), fmtTokens(s.totalTokens), cost ? fmtCost(cost.costUsd) : "—"]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }
    costBody.appendChild(tr);
  }
  if (sessionRows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "（库中无用量数据——带 --db 跑会话后可见）";
    tr.appendChild(td);
    costBody.appendChild(tr);
  }
  document.getElementById("cost-hint").textContent =
    (u.costs ?? []).length === 0
      ? "成本未显示：settings.json 的 pricing 段未配置模型价格（表驱动计价，无价格不虚构）。"
      : "成本 = settings 计价表 × token 用量（四类分列计价）。";

  // 按轮用量（本会话）——costs.byTurn 关联成本
  const turnBody = document.querySelector("#turn-table tbody");
  turnBody.replaceChildren();
  const turnCosts = new Map((u.costs ?? []).find((c) => c.sessionId === getSessionId())?.byTurn.map((t) => [t.turn, t.costUsd]) ?? []);
  for (const t of u.currentSession?.turns ?? []) {
    const tr = document.createElement("tr");
    for (const text of [
      String(t.turn),
      String(t.requests),
      fmtTokens(t.inputTokens),
      fmtTokens(t.outputTokens),
      t.cacheHitRate !== undefined ? `${Math.round(t.cacheHitRate * 100)}%` : "—",
      turnCosts.has(t.turn) ? fmtCost(turnCosts.get(t.turn)) : "—",
    ]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }
    turnBody.appendChild(tr);
  }
}
