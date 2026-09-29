/**
 * U12/T-P3-111 用量视图（T-P3-134 · UI 批次 A④ 从 app.js 原样迁入）——
 * 上下文检查器（占用/占比/压缩）+ 成本统计页（按会话/按轮——J21 消费端，
 * 纯 DOM 表，数据源 = query op:"usage" 单源）。批 B 升级为统计页可视化。
 */

import { sendQuery } from "../api.js";
import { getSessionId } from "../state.js";

const TEMPLATE = `
<aside id="usage-panel" aria-label="用量与上下文">
  <header class="settings-head">
    <span>用量与上下文</span>
    <button id="usage-close" type="button">关闭</button>
  </header>
  <div class="settings-body">
    <section class="usage-section">
      <h2>上下文检查器</h2>
      <div class="ctx-meter"><div id="ctx-meter-fill"></div></div>
      <p id="ctx-text" class="hint"></p>
      <p id="compaction-text" class="hint"></p>
    </section>
    <section class="usage-section">
      <h2>成本统计（按会话）</h2>
      <table id="cost-table">
        <thead>
          <tr><th>会话</th><th>轮数</th><th>总 token</th><th>成本</th></tr>
        </thead>
        <tbody></tbody>
      </table>
      <p id="cost-hint" class="hint"></p>
    </section>
    <section class="usage-section">
      <h2>按轮用量（本会话）</h2>
      <table id="turn-table">
        <thead>
          <tr><th>轮</th><th>请求</th><th>输入</th><th>输出</th><th>缓存命中</th><th>成本</th></tr>
        </thead>
        <tbody></tbody>
      </table>
    </section>
  </div>
</aside>
`;

function fmtTokens(n) {
  if (!Number.isFinite(n)) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtCost(usd) {
  if (!Number.isFinite(usd)) return "—";
  return `$${usd.toFixed(4)}`;
}

export async function render(container) {
  container.innerHTML = TEMPLATE;
  document.getElementById("usage-close").addEventListener("click", () => {
    location.hash = "#chat";
  });
  const envelope = await sendQuery({ sessionId: getSessionId() || "-", op: "usage" });
  if (document.getElementById("ctx-text") === null) return; // 回包晚于导航——丢弃
  if (!envelope.ok) {
    document.getElementById("ctx-text").textContent = `用量面不可用：${envelope.error?.message ?? ""}`;
    document.getElementById("compaction-text").textContent = "";
    document.getElementById("cost-hint").textContent = "";
    return;
  }
  const u = envelope.result;

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
