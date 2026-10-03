/**
 * 审查面板（T-P3-156 方案 S——需求五.2 内置「审查」）：工作台「变更评审」
 * Tab 迁入右侧面板宿主（会话维度的变更/委派报告）；数据源 = query
 * op:"review"（work.js 同源——回执 {review: report} 包裹形）。
 */

import { sendQuery } from "./api.js";
import { getSessionId } from "./state.js";
import { registerPane } from "./pane.js";

registerPane("review", {
  title: () => "🔍 审查",
  icon: "🔍",
  render: (body) => {
    body.replaceChildren();
    const head = document.createElement("div");
    head.className = "review-pane-head";
    const title = document.createElement("span");
    title.className = "subagent-pane-title";
    title.textContent = "🔍 变更评审（本会话产出的文件变更与委派）";
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "btn btn-ghost";
    refresh.textContent = "↻ 刷新";
    head.append(title, refresh);
    const box = document.createElement("div");
    box.className = "review-pane-body";
    body.append(head, box);

    const paint = async () => {
      box.textContent = "读取中…";
      const envelope = await sendQuery({ sessionId: getSessionId() || "-", op: "review" });
      box.replaceChildren();
      if (!envelope.ok) {
        box.textContent = `评审数据不可用：${envelope.error?.message ?? ""}`;
        return;
      }
      const report = envelope.result?.review ?? null;
      if (report === null) {
        box.innerHTML = `<div class="empty-state"><div class="empty-title">暂无变更</div><div class="empty-desc">AI 产出文件变更后这里会出现 diff 审查面。</div></div>`;
        return;
      }
      // 复用 work.js 的报告渲染（模块导出面——无导出则内联摘要版）
      try {
        const work = await import("./views/work.js");
        if (typeof work.renderReviewReport === "function") {
          work.renderReviewReport(box, report);
          return;
        }
      } catch {
        // fallthrough——内联摘要
      }
      const pre = document.createElement("pre");
      pre.className = "card-args";
      pre.textContent = JSON.stringify(report, null, 2);
      box.appendChild(pre);
    };
    refresh.addEventListener("click", () => void paint());
    void paint();
  },
});
