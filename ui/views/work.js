/**
 * U15/T-P3-117 工作面板视图（T-P3-134 · UI 批次 A④ 从 app.js 原样迁入）——
 * 四 Tab（文件树/变更评审/子代理监控/协作）。变更与委派数据源 =
 * query op:"review"（纯函数从流直答）；文件树 = op:"files"（@ 补全缓存复用）
 * + op:"file" 点击预览；turn_settled 时面板挂载则自动刷新（订阅制）。
 * U27/T-P3-131 协作 Tab：会话间往来事实（流投影——session/collab）。
 */

import { sendQuery, ensureFileCache } from "../api.js";
import { icon, injectIcons } from "../icons.js";
import { getSessionId, subscribeTurnSettled } from "../state.js";

const TEMPLATE = `
<aside id="workpanel" aria-label="工作面板">
  <header class="page-head">
    <h2 class="tab-title">工作面板</h2>
    <button id="work-close" type="button" class="btn btn-ghost">返回对话</button>
  </header>
  <nav id="work-tabs">
    <button type="button" data-worktab="files" class="work-tab active"><span data-icon="folder" data-icon-size="14"></span> 文件</button>
    <button type="button" data-worktab="review" class="work-tab"><span data-icon="search" data-icon-size="14"></span> 变更评审</button>
    <button type="button" data-worktab="subagent" class="work-tab"><span data-icon="bot" data-icon-size="14"></span> 子代理</button>
    <!-- U27/T-P3-131 协作 Tab：会话间往来事实（流投影——session/collab） -->
    <button type="button" data-worktab="collab" class="work-tab"><span data-icon="link2" data-icon-size="14"></span> 协作</button>
  </nav>
  <div class="page-body">
    <section data-worktab-body="files">
      <div id="work-filetree" class="work-tree"></div>
      <p id="work-tree-hint" class="hint"></p>
      <div id="work-preview-box" hidden>
        <header class="preview-head">
          <span id="work-preview-path"></span>
          <button id="work-preview-close" type="button" class="btn btn-ghost">收起</button>
        </header>
        <pre id="work-preview" class="card-args"></pre>
      </div>
    </section>
    <section data-worktab-body="review" hidden>
      <p id="work-review-summary" class="hint"></p>
      <ul id="work-review-list"></ul>
      <p class="hint">从事件流提取（write/edit/apply-patch 显式路径 + bash 的 rm/重定向推断——via 列标注来源）；失败调用不计入。</p>
    </section>
    <section data-worktab-body="subagent" hidden>
      <table id="work-delegation-table" class="table">
        <thead>
          <tr><th>任务</th><th>子会话</th><th>状态</th><th>耗时</th></tr>
        </thead>
        <tbody></tbody>
      </table>
      <p id="work-delegation-hint" class="hint"></p>
    </section>
    <section data-worktab-body="collab" hidden>
      <table id="work-collab-table" class="table">
        <thead>
          <tr><th>方向</th><th>对端会话</th><th>类型</th><th>状态</th><th>结果/错误</th></tr>
        </thead>
        <tbody></tbody>
      </table>
      <p class="hint">会话间派任务/消息往来的流内事实（session/collab 事件投影）；权限快照随派发固化——后续设置变更不影响排队/在途任务。</p>
    </section>
  </div>
</aside>
`;

let workActiveTab = "files";
let lastReviewReport = null; // 变更/委派共用一次 review 拉取
let unsubscribeTurnSettled = null;

function setWorkTab(tab) {
  workActiveTab = tab;
  for (const btn of document.querySelectorAll("#work-tabs .work-tab")) {
    btn.classList.toggle("active", btn.dataset.worktab === tab);
  }
  for (const sec of document.querySelectorAll("#workpanel [data-worktab-body]")) {
    sec.hidden = sec.dataset.worktabBody !== tab;
  }
}

async function fetchReviewReport() {
  const envelope = await sendQuery({ sessionId: getSessionId() || "-", op: "review" });
  // op:"review" 回执为 { review: report } 包裹形（server.test 钉死）——批 A
  // 迁 UI 时直取 result 系既有形状错位（走查暴露的顺手修正，host wire 不动）
  return envelope.ok ? (envelope.result?.review ?? null) : null;
}

function renderReviewReport(report) {
  if (!report) return;
  if (document.getElementById("work-review-summary") === null) return; // 已卸载
  const ops = report.operations ?? [];
  const writes = ops.filter((o) => o.op === "write").length;
  const edits = ops.filter((o) => o.op === "edit").length;
  const deletes = ops.filter((o) => o.op === "delete").length;
  document.getElementById("work-review-summary").textContent =
    `本会话 ${report.changes.length} 个文件被触碰：写入 ${writes} · 修改 ${edits} · 删除 ${deletes}`;
  const list = document.getElementById("work-review-list");
  list.replaceChildren();
  for (const c of report.changes) {
    const li = document.createElement("li");
    li.className = `review-item review-${c.op}`;
    const badge = document.createElement("span");
    badge.className = "review-badge";
    badge.textContent = c.op === "write" ? "写入" : c.op === "edit" ? "修改" : "删除";
    const path = document.createElement("code");
    path.textContent = c.path;
    const via = document.createElement("span");
    via.className = "hint";
    via.textContent = `via ${c.via}`;
    li.append(badge, path, via);
    list.appendChild(li);
  }
  if (report.changes.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "（本会话暂无文件写操作——agent 改动后自动刷新）";
    list.appendChild(li);
  }

  /** 状态单元格（T-P3-157 批 3：状态字形 → icons.js 节点+词）。 */
  const statusCell = (status, runningWord) => {
    const spec = { completed: ["checkCircle", "完成", "icon-ok"], failed: ["xCircle", "失败", "icon-err"], cancelled: ["ban", "取消", "icon-warn"], running: ["loader", runningWord, "icon-spin"] }[status];
    const span = document.createElement("span");
    span.className = "ac-label";
    if (spec === undefined) {
      span.textContent = status === "queued" ? "排队中" : (runningWord ?? "—");
      return span;
    }
    span.append(icon(spec[0], { cls: `icon-sm ${spec[2]}`.trim() }), document.createTextNode(` ${spec[1]}`));
    return span;
  };

  const body = document.querySelector("#work-delegation-table tbody");
  body.replaceChildren();
  for (const d of report.delegations ?? []) {
    const tr = document.createElement("tr");
    for (const [i, text] of [
      d.description || "（无描述）",
      d.subagentSessionId ?? "—",
      null, // 状态列——节点组合（见下）
      d.durationMs !== undefined ? `${(d.durationMs / 1000).toFixed(1)}s` : "—",
    ].entries()) {
      const td = document.createElement("td");
      if (i === 2) {
        const badge = statusCell(d.status, "进行中");
        const code = d.errorCode ? `（${d.errorCode}）` : "";
        badge.appendChild(document.createTextNode(code));
        td.appendChild(badge);
      } else {
        td.textContent = text;
      }
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  if ((report.delegations ?? []).length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "（本会话暂无子代理委派——task 工具调用后可见）";
    tr.appendChild(td);
    body.appendChild(tr);
  }
  document.getElementById("work-delegation-hint").textContent =
    "委派状态/耗时取 task 调用与结算的流内事实（H1/H2 面）；点击子代理 Tab 查看一览。";

  // U27/T-P3-131：协作往来（流投影——session/collab 事件）
  const collabBody = document.querySelector("#work-collab-table tbody");
  collabBody.replaceChildren();
  for (const c of report.collaborations ?? []) {
    const tr = document.createElement("tr");
    const dir = c.direction === "outgoing" ? "→ 派出" : "← 收到";
    const outcome = c.result ?? c.error ?? "—";
    for (const [i, text] of [dir, c.peerSessionId, c.kind, null, outcome].entries()) {
      const td = document.createElement("td");
      if (i === 3) {
        td.appendChild(statusCell(c.status, "进行中"));
      } else {
        td.textContent = text;
      }
      tr.appendChild(td);
    }
    collabBody.appendChild(tr);
  }
  if ((report.collaborations ?? []).length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = "（本会话暂无协作往来——跨会话派任务后可见）";
    tr.appendChild(td);
    collabBody.appendChild(tr);
  }
}

async function refreshWorkReview() {
  lastReviewReport = await fetchReviewReport();
  renderReviewReport(lastReviewReport);
}

function renderFileTree(entries, truncated) {
  const tree = document.getElementById("work-filetree");
  if (tree === null) return; // 回包晚于导航——丢弃
  tree.replaceChildren();
  // 全量清单按目录深度缩进成树（条目上限 1000 已在 host 侧防呆）
  for (const e of entries) {
    const row = document.createElement("div");
    row.className = "tree-row";
    const depth = e.path.split("/").length - (e.dir ? 2 : 1);
    row.style.paddingLeft = `${Math.max(0, depth) * 14 + 4}px`;
    if (e.dir) {
      row.classList.add("tree-dir");
      row.append(icon("folder", { cls: "icon-sm" }), document.createTextNode(` ${e.path.split("/").filter(Boolean).pop() ?? e.path}/`));
    } else {
      row.classList.add("tree-file");
      row.append(icon("file", { cls: "icon-sm" }), document.createTextNode(` ${e.path.split("/").pop()}`));
      row.addEventListener("click", () => void previewWorkspaceFile(e.path));
    }
    tree.appendChild(row);
  }
  if (entries.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "（workspace 无可列举文件——检查 --workspace 或 sandbox 档）";
    tree.appendChild(p);
  }
  document.getElementById("work-tree-hint").textContent = truncated
    ? "文件清单超上限 1000 条已截断（大目录树提示）——可输入完整路径到输入区用 @ 补全定位。"
    : `共 ${entries.length} 项——点击文件预览内容。`;
}

async function previewWorkspaceFile(relPath) {
  const box = document.getElementById("work-preview-box");
  const pre = document.getElementById("work-preview");
  const label = document.getElementById("work-preview-path");
  label.textContent = relPath;
  pre.textContent = "读取中…";
  box.hidden = false;
  const envelope = await sendQuery({ sessionId: getSessionId() || "-", op: "file", path: relPath });
  if (pre === null || !pre.isConnected) return; // 回包晚于导航——丢弃
  if (!envelope.ok) {
    pre.textContent = `预览不可用：${envelope.error?.message ?? ""}`;
    return;
  }
  const f = envelope.result;
  pre.textContent = f.truncated ? `${f.content}\n…（超 512KB 只读前缀）` : f.content;
}

export async function render(container, route) {
  container.innerHTML = TEMPLATE;
  injectIcons(container); // tab 静态 data-icon 占位注入（T-P3-157 批 3）
  document.getElementById("work-close").addEventListener("click", () => {
    location.hash = "#chat";
  });
  document.getElementById("work-preview-close").addEventListener("click", () => {
    document.getElementById("work-preview-box").hidden = true;
  });
  for (const btn of document.querySelectorAll("#work-tabs .work-tab")) {
    btn.addEventListener("click", () => setWorkTab(btn.dataset.worktab));
  }
  // 深链 #work/<tab>：直达指定 Tab（记忆的 activeTab 优先级低于显式深链）
  if (route?.tab) workActiveTab = route.tab;
  setWorkTab(workActiveTab);
  // turn_settled 自动刷新（原"面板可见则刷新"的订阅制等价面——挂载期生效）
  unsubscribeTurnSettled = subscribeTurnSettled(() => void refreshWorkReview());
  const files = await ensureFileCache(getSessionId()); // 与 @ 补全同一会话期缓存
  if (files && document.getElementById("work-filetree") !== null) {
    renderFileTree(files.entries ?? [], files.truncated === true);
  }
  await refreshWorkReview();
}

export function unmount() {
  if (unsubscribeTurnSettled !== null) {
    unsubscribeTurnSettled();
    unsubscribeTurnSettled = null;
  }
}
