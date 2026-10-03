/**
 * 会话树面板（T-P3-156 方案 J——fork 血统可视化）：数据源 = query
 * op:"events" 流内 session/fork 标记（store.ts fork 落流——parentSessionId/
 * position/cutSeq）；形态 = pi tree-selector 的 DOM 裁剪版：当前会话为根，
 * 逐 fork 节点缩进呈现（父会话·切点·时间），点击节点 = 只读恢复该会话。
 * 数据边界：谱系回溯经 events 逐级上溯（每级一次 query，深度 ≤5 防环）。
 */

import { sendQuery } from "./api.js";
import { getSessionId, hooks } from "./state.js";
import { appendLine } from "./feedback.js";
import { registerPane } from "./pane.js";
import { icon } from "./icons.js";

const MAX_DEPTH = 5;

/** 单会话的 fork 标记（流内 session/fork 事件）。 */
async function fetchForkMarks(sessionId) {
  const envelope = await sendQuery({ sessionId, op: "events" });
  if (!envelope.ok) return { ok: false, marks: [], count: 0 };
  const events = envelope.result?.events ?? [];
  return {
    ok: true,
    marks: events.filter((e) => e.type === "session/fork"),
    count: events.length,
  };
}

registerPane("tree", {
  title: () => "会话树",
  icon: "gitFork",
  render: (body) => {
    body.replaceChildren();
    const head = document.createElement("div");
    head.className = "review-pane-head";
    const title = document.createElement("span");
    title.className = "subagent-pane-title";
    title.append(icon("gitFork", { cls: "icon-sm" }), document.createTextNode(" 会话树（fork 分支历史——点击节点只读回看）"));
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "btn btn-ghost";
    refresh.textContent = "↻ 刷新";
    head.append(title, refresh);
    const box = document.createElement("div");
    box.className = "review-pane-body";
    body.append(head, box);

    const renderTree = async () => {
      box.textContent = "谱系读取中…";
      const rootId = getSessionId();
      if (rootId === "") {
        box.textContent = "会话未就绪";
        return;
      }
      box.replaceChildren();
      // 递归上溯血统（当前会话 → 每层取其 session/fork 标记的 parentSessionId）
      const chain = []; // {sessionId, marks, count}
      let cursor = rootId;
      for (let depth = 0; depth < MAX_DEPTH; depth++) {
        const info = await fetchForkMarks(cursor);
        if (!info.ok) break;
        chain.push({ sessionId: cursor, marks: info.marks, count: info.count });
        const parent = info.marks.at(-1)?.parentSessionId;
        if (typeof parent !== "string" || parent === "") break;
        cursor = parent;
      }
      // 从根（最老祖先）向下渲染
      box.replaceChildren();
      for (let i = chain.length - 1; i >= 0; i--) {
        const node = chain[i];
        const depth = chain.length - 1 - i;
        const row = document.createElement("div");
        row.className = `tree-node${node.sessionId === rootId ? " current" : ""}`;
        row.style.paddingLeft = `${8 + depth * 18}px`;
        const caret = document.createElement("span");
        caret.className = "sb-caret open";
        caret.replaceChildren(icon("chevronDown", { cls: "icon-sm" }));
        const label = document.createElement("span");
        label.className = "sb-label";
        label.append(icon("gitFork", { cls: "icon-sm" }), document.createTextNode(` ${node.sessionId.slice(0, 12)}…（${String(node.count)} 条事件）`));
        label.title = node.sessionId;
        row.append(caret, label);
        if (node.sessionId !== rootId) {
          row.title = "点击只读回看该会话";
          row.addEventListener("click", () => {
            location.hash = "#chat";
            void (async () => {
              const view = await sendQuery({ sessionId: node.sessionId, op: "events" });
              if (!view.ok) {
                appendLine(`回看失败：${view.error?.message ?? ""}`, "warn");
                return;
              }
              hooks.resetStreamView();
              hooks.renderHistory(view.result.events ?? []);
              appendLine("── 只读视图：续聊请执行 aegent sessions resume " + node.sessionId + " ──", "warn");
            })();
          });
        } else {
          row.appendChild(chipCurrent());
        }
        box.appendChild(row);
        // 该节点的分支子会话（position/cutSeq 摘要行）
        for (const mark of node.marks) {
          const branch = document.createElement("div");
          branch.className = "tree-branch";
          branch.style.paddingLeft = `${8 + (depth + 1) * 18}px`;
          branch.textContent = `↳ 分支自 ${mark.position ?? "?"}（切点 seq ${String(mark.cutSeq ?? "?")}）——${String(mark.childSessionId ?? mark.sessionId ?? "").slice(0, 12)}`;
          box.appendChild(branch);
        }
      }
      if (chain.length === 1 && chain[0].marks.length === 0) {
        const empty = document.createElement("div");
        empty.className = "sb-tasks-empty";
        empty.style.padding = "10px";
        empty.textContent = "当前会话没有 fork 血统——在左侧栏任务/会话右键「分支会话」后这里会长出树。";
        box.appendChild(empty);
      }
    };
    refresh.addEventListener("click", () => void renderTree());
    void renderTree();
  },
});

function chipCurrent() {
  const chip = document.createElement("span");
  chip.className = "sb-chip sb-chip-active";
  chip.textContent = "当前";
  return chip;
}
