/**
 * U15/T-P3-117 工作面板视图（T-P3-134 · UI 批次 A④ 从 app.js 原样迁入）——
 * 四 Tab（文件树/变更评审/子代理监控/协作）。变更与委派数据源 =
 * query op:"review"（纯函数从流直答）；文件树 = op:"files"（@ 补全缓存复用）
 * + op:"file" 点击预览；turn_settled 时面板挂载则自动刷新（订阅制）。
 * U27/T-P3-131 协作 Tab：会话间往来事实（流投影——session/collab）。
 */

import { sendQuery, sendSettings, ensureFileCache } from "../api.js";
import { t } from "../i18n.js";
import { icon, injectIcons } from "../icons.js";
import { getSessionId, subscribeTurnSettled } from "../state.js";
import { toast } from "../feedback.js";
import { confirmDialog } from "./settings/core.js";

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
    <!-- T-P3-174 批次 4 检查点时间线：E11 git 快照逐轮浏览 + 一键回退 -->
    <button type="button" data-worktab="timeline" class="work-tab"><span data-icon="history" data-icon-size="14"></span> 时间线</button>
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
      <div id="work-review-body"></div>
      <p class="hint">从事件流提取（write/edit/apply-patch 显式路径 + bash 的 rm/重定向推断——via 列标注来源）；失败调用不计入。</p>
    </section>
    <section data-worktab-body="subagent" hidden>
      <div id="work-delegation-body"></div>
      <p id="work-delegation-hint" class="hint"></p>
    </section>
    <section data-worktab-body="collab" hidden>
      <div class="card-box" id="collab-composer">
        <div class="form-grid form-grid-2">
          <label>${t("目标会话")}<select id="collab-target" class="select"></select></label>
          <label>${t("类型")}<select id="collab-kind" class="select">
            <option value="task">${t("task（派任务——完成后回投结果）")}</option>
            <option value="message">${t("message（发消息——同状态机）")}</option>
          </select></label>
        </div>
        <label>${t("内容")}<textarea id="collab-content" class="textarea" rows="3" placeholder="${t("要委托给目标会话的任务/消息……")}"></textarea></label>
        <div class="form-actions">
          <button id="collab-dispatch" type="button" class="btn btn-primary">${t("派发给目标会话")}</button>
          <span id="collab-composer-hint" class="hint"></span>
        </div>
      </div>
      <div id="work-collab-body"></div>
      <p class="hint">${t("会话间派任务/消息往来的流内事实（session/collab 事件投影）；权限快照随派发固化——后续设置变更不影响排队/在途任务。排队中的任务可取消。")}</p>
    </section>
    <section data-worktab-body="timeline" hidden>
      <p id="work-timeline-hint" class="hint"></p>
      <ul id="work-timeline-list" class="transfer-list"></ul>
      <p class="hint">git 检查点在每轮开始前打点（stash 快照）——「改动」= 该检查点与上一检查点之间的统计。回退 = 丢弃当前 tracked 改动并应用该时点快照（untracked 新文件不回退）。</p>
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

// —— T-P3-174 批次 4：检查点时间线（E11 git 快照浏览 + 一键回退）——

async function refreshCheckpointTimeline() {
  const hint = document.getElementById("work-timeline-hint");
  const list = document.getElementById("work-timeline-list");
  if (hint === null || list === null) return; // 已卸载
  const sessionId = getSessionId();
  if (!sessionId) {
    hint.textContent = "当前无会话——发起对话后这里出现 git 检查点时间线。";
    list.replaceChildren();
    return;
  }
  const envelope = await sendSettings({ op: "checkpoint-timeline", sessionId });
  if (!envelope.ok) {
    hint.textContent = `时间线不可用：${envelope.error?.message ?? ""}`;
    list.replaceChildren();
    return;
  }
  const items = envelope.result?.items ?? [];
  if (items.length === 0) {
    hint.textContent = "本会话尚无 git 检查点（git 仓库工作区每轮开始前自动打点；非 git 目录不做检查点）。";
    list.replaceChildren();
    return;
  }
  hint.textContent = `共 ${items.length} 个检查点（每轮开始前打点——即"该轮模型动手前"的状态）`;
  list.replaceChildren();
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "transfer-row";
    const copy = document.createElement("span");
    copy.className = "transfer-row-copy";
    const changes = item.changesUnavailable !== undefined
      ? ` · 改动统计不可得（${item.changesUnavailable}）`
      : item.changesText
        ? ` · ${item.changesText}`
        : "";
    copy.textContent = `turn ${item.turn} · ${new Date(item.ts).toLocaleString()}${changes}`;
    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "btn";
    restoreBtn.textContent = "回退到此处";
    restoreBtn.addEventListener("click", () => void restoreCheckpoint(sessionId, item));
    li.append(copy, restoreBtn);
    list.appendChild(li);
  }
}

async function restoreCheckpoint(sessionId, item) {
  const ok = await confirmDialog(
    "将丢弃工作区当前全部 tracked 改动，并恢复到该轮开始前的 git 快照（untracked 新文件保留；对话历史不变）。此操作不可自动撤销。",
    { title: `回退代码到 turn ${item.turn}`, confirmLabel: "确认回退", danger: true },
  );
  if (!ok) return;
  const envelope = await sendSettings({ op: "checkpoint-restore", sessionId, seq: item.seq });
  if (!envelope.ok) {
    toast(`回退失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  toast(item.ref === null ? "已回退（该时点与 HEAD 一致——已丢弃 tracked 改动）" : "已回退到该轮开始前的快照", "info");
  void refreshCheckpointTimeline();
}

async function fetchReviewReport() {
  const envelope = await sendQuery({ sessionId: getSessionId() || "-", op: "review" });
  // op:"review" 回执为 { review: report } 包裹形（server.test 钉死）——批 A
  // 迁 UI 时直取 result 系既有形状错位（走查暴露的顺手修正，host wire 不动）
  return envelope.ok ? (envelope.result?.review ?? null) : null;
}

// —— A7 可复用重构：评审报告渲染从"写死工作台 DOM id 的私有函数"改为
// 导出的纯构建函数（工作台与 pane-review 两处共用一份逻辑——此前 pane 的
// typeof 检查对未导出函数恒 false，落 JSON 兜底即"有数据恒空白/裸 JSON"）。

/** 状态单元格（T-P3-157 批 3：状态字形 → icons.js 节点+词）。 */
function statusCell(status, runningWord) {
  const spec = { completed: ["checkCircle", "完成", "icon-ok"], failed: ["xCircle", "失败", "icon-err"], cancelled: ["ban", "取消", "icon-warn"], running: ["loader", runningWord, "icon-spin"] }[status];
  const span = document.createElement("span");
  span.className = "ac-label";
  if (spec === undefined) {
    span.textContent = status === "queued" ? "排队中" : (runningWord ?? "—");
    return span;
  }
  span.append(icon(spec[0], { cls: `icon-sm ${spec[2]}`.trim() }), document.createTextNode(` ${spec[1]}`));
  return span;
}

/** 变更清单块（summary 行 + ul.review-list；空态 = 提示行）。 */
export function buildReviewChanges(report) {
  const frag = document.createDocumentFragment();
  if (!report) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "（本会话暂无文件写操作——agent 改动后自动刷新）";
    frag.appendChild(empty);
    return frag;
  }
  const ops = report.operations ?? [];
  const writes = ops.filter((o) => o.op === "write").length;
  const edits = ops.filter((o) => o.op === "edit").length;
  const deletes = ops.filter((o) => o.op === "delete").length;
  const summary = document.createElement("p");
  summary.className = "hint";
  summary.textContent =
    `本会话 ${report.changes.length} 个文件被触碰：写入 ${writes} · 修改 ${edits} · 删除 ${deletes}`;
  frag.appendChild(summary);
  const list = document.createElement("ul");
  list.className = "work-review-list";
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
  frag.appendChild(list);
  return frag;
}

/** 委派状态表（H1/H2 面的流投影）。 */
export function buildDelegationTable(report) {
  const table = document.createElement("table");
  table.className = "work-delegation-table table";
  table.innerHTML = "<thead><tr><th>任务</th><th>子会话</th><th>状态</th><th>耗时</th></tr></thead><tbody></tbody>";
  const body = table.querySelector("tbody");
  for (const d of report?.delegations ?? []) {
    const tr = document.createElement("tr");
    for (const [i, text] of [
      d.description || "（无描述）",
      d.subagentSessionId ?? "—",
      null, // 状态列——节点组合（见 statusCell）
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
  if ((report?.delegations ?? []).length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "（本会话暂无子代理委派——task 工具调用后可见）";
    tr.appendChild(td);
    body.appendChild(tr);
  }
  return table;
}

/** 协作往来表（U27/T-P3-131：session/collab 事件流投影）。 */
export function buildCollabTable(report, onCancel) {
  const table = document.createElement("table");
  table.className = "work-collab-table table";
  table.innerHTML = `<thead><tr><th>${t("方向")}</th><th>${t("对端会话")}</th><th>${t("类型")}</th><th>${t("状态")}</th><th>${t("结果/错误")}</th></tr></thead><tbody></tbody>`;
  const body = table.querySelector("tbody");
  for (const c of report?.collaborations ?? []) {
    const tr = document.createElement("tr");
    const dir = c.direction === "outgoing" ? t("→ 派出") : t("← 收到");
    const outcome = c.result ?? c.error ?? "—";
    for (const [i, text] of [dir, c.peerSessionId, c.kind, null, outcome].entries()) {
      const td = document.createElement("td");
      if (i === 3) {
        td.appendChild(statusCell(c.status, "进行中"));
        // C10：排队中的任务可取消（collab-cancel——取消后 update/report 双流落 fact）
        if (c.status === "queued") {
          const cancelBtn = document.createElement("button");
          cancelBtn.type = "button";
          cancelBtn.className = "btn";
          cancelBtn.textContent = t("取消");
          cancelBtn.onclick = async () => {
            cancelBtn.disabled = true;
            await sendSettings({ op: "collab-cancel", collabId: c.collabId });
            onCancel?.();
          };
          td.appendChild(cancelBtn);
        }
      } else {
        td.textContent = text;
      }
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  if ((report?.collaborations ?? []).length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = t("（本会话暂无协作往来——跨会话派任务后可见）");
    tr.appendChild(td);
    body.appendChild(tr);
  }
  return table;
}

/** C10：协作发起表单接线（目标下拉 + 派发提交；排队行取消在表格内）。 */
export async function wireCollabComposer(onSettled) {
  const targetSelect = document.getElementById("collab-target");
  if (targetSelect === null) return;
  const sessionsEnvelope = await sendQuery({ sessionId: getSessionId() || "-", op: "sessions" });
  const sessions = sessionsEnvelope?.ok ? (sessionsEnvelope.result?.sessions ?? []) : [];
  const current = getSessionId();
  targetSelect.replaceChildren(
    ...sessions
      .filter((s) => s.sessionId !== current)
      .map((s) => {
        const option = document.createElement("option");
        option.value = s.sessionId;
        option.textContent = `${s.title ?? s.sessionId}（${s.sessionId.slice(0, 18)}…）`;
        return option;
      }),
  );
  const hint = document.getElementById("collab-composer-hint");
  document.getElementById("collab-dispatch").onclick = async () => {
    const targetSessionId = targetSelect.value;
    const content = document.getElementById("collab-content").value.trim();
    if (targetSessionId === undefined || targetSessionId === "") {
      hint.textContent = t("没有可选的目标会话（历史会话清单为空）");
      return;
    }
    if (content === "") {
      hint.textContent = t("内容不能为空");
      return;
    }
    const envelope = await sendSettings({
      op: "collab-dispatch",
      sourceSessionId: current,
      targetSessionId,
      kind: document.getElementById("collab-kind").value,
      content,
    });
    if (envelope.ok) {
      hint.textContent = t("已派发：{id}——排队/执行状态见下表", { id: envelope.result?.collabId ?? "" });
      document.getElementById("collab-content").value = "";
    } else {
      hint.textContent = t("派发失败：{msg}", { msg: envelope.error?.message ?? t("未知错误") });
    }
    onSettled?.();
  };
}

function renderReviewReport(report) {
  // 已卸载 guard：工作台路由离开后容器不存在
  if (document.getElementById("work-review-body") === null) return;
  document.getElementById("work-review-body").replaceChildren(buildReviewChanges(report));
  document.getElementById("work-delegation-body").replaceChildren(buildDelegationTable(report));
  document.getElementById("work-delegation-hint").textContent =
    "委派状态/耗时取 task 调用与结算的流内事实（H1/H2 面）；点击子代理 Tab 查看一览。";
  document.getElementById("work-collab-body").replaceChildren(buildCollabTable(report, refreshWorkReview));
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
    btn.addEventListener("click", () => {
      setWorkTab(btn.dataset.worktab);
      if (btn.dataset.worktab === "timeline") void refreshCheckpointTimeline();
    });
  }
  // 深链 #work/<tab>：直达指定 Tab（记忆的 activeTab 优先级低于显式深链）
  if (route?.tab) workActiveTab = route.tab;
  setWorkTab(workActiveTab);
  if (workActiveTab === "timeline") void refreshCheckpointTimeline();
  // turn_settled 自动刷新（原"面板可见则刷新"的订阅制等价面——挂载期生效）
  unsubscribeTurnSettled = subscribeTurnSettled(() => void refreshWorkReview());
  const files = await ensureFileCache(getSessionId()); // 与 @ 补全同一会话期缓存
  if (files && document.getElementById("work-filetree") !== null) {
    renderFileTree(files.entries ?? [], files.truncated === true);
  }
  // C10：协作发起表单接线（目标下拉 + 派发；派发后 refreshWorkReview 刷表）
  void wireCollabComposer(refreshWorkReview);
  await refreshWorkReview();
}

export function unmount() {
  if (unsubscribeTurnSettled !== null) {
    unsubscribeTurnSettled();
    unsubscribeTurnSettled = null;
  }
}
