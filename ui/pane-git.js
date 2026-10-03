/**
 * Git 管理面板（T-P3-156 方案 R——需求五.2 内置 Git 管理）：状态头（分支/
 * 领先落后/未提交数）+变更列表（staged/unstaged 分组+diff 查看）+stage/
 * unstage/commit+最近提交 log。数据面 = settings op git-status/git-diff/
 * git-stage/git-commit/git-log（panel-ops——cwd 取活动项目根，白名单边界）。
 * 写操作（stage/commit）经 settings op（host 侧不持租约校验——git 是工作区
 * 面不是会话命令；风险边界=项目根白名单+操作可见 diff）。
 */

import { sendSettings } from "./api.js";
import { settingsCache } from "./state.js";
import { toast } from "./feedback.js";
import { registerPane } from "./pane.js";
import { fileIcon } from "./views/projects-files.js";

/** 活动项目根（git 面板的工作区——无活动项目时禁用态）。 */
function activeRoot() {
  const project = (settingsCache?.projects ?? []).find((p) => p.id === settingsCache?.activeProject);
  return project?.folders[0] ?? null;
}

/** 状态快照缓存（面板内刷新共用——diff 展开保持不重排）。 */
let snapshot = null;

registerPane("git", {
  title: () => "⑂ Git",
  icon: "⑂",
  render: (body) => {
    body.replaceChildren();
    const root = activeRoot();
    if (root === null) {
      body.innerHTML = `<div class="empty-state"><div class="empty-title">未选择项目</div><div class="empty-desc">Git 面板以活动项目为工作区——左侧栏先设活动项目。</div></div>`;
      return;
    }
    const head = document.createElement("div");
    head.className = "git-head";
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "btn btn-ghost";
    refreshBtn.textContent = "↻ 刷新";
    head.append(refreshBtn);

    const statusBox = document.createElement("div");
    statusBox.className = "git-status-box";
    const commitBox = document.createElement("div");
    commitBox.className = "git-commit-box";
    const listBox = document.createElement("div");
    listBox.className = "git-list";
    const logBox = document.createElement("div");
    logBox.className = "git-log-box";

    body.append(head, statusBox, commitBox, listBox, logBox);

    const paintStatus = () => {
      if (snapshot === null) return;
      statusBox.replaceChildren();
      statusBox.innerHTML = `<div class="git-branch">⑂ ${escapeHtml(snapshot.branch)} <span class="git-ahead-behind">↑${escapeHtml(snapshot.ahead)} ↓${escapeHtml(snapshot.behind)}</span> · ${String(snapshot.changes.length)} 个变更</div>`;
      const groups = [
        ["已暂存", snapshot.changes.filter((c) => c.staged)],
        ["未暂存", snapshot.changes.filter((c) => !c.staged)],
      ];
      for (const [label, changes] of groups) {
        if (changes.length === 0) continue;
        const groupHead = document.createElement("div");
        groupHead.className = "git-group-head";
        const allBtn = document.createElement("button");
        allBtn.type = "button";
        allBtn.className = "btn btn-ghost git-mini-btn";
        allBtn.textContent = label === "已暂存" ? "全部取消暂存" : "全部暂存";
        allBtn.addEventListener("click", () => {
          void stageAll(changes.map((c) => c.file), label === "已暂存");
        });
        groupHead.append(Object.assign(document.createElement("span"), { textContent: label }), allBtn);
        listBox.appendChild(groupHead);
        for (const change of changes) {
          listBox.appendChild(changeRow(change, label === "已暂存"));
        }
      }
      if (snapshot.changes.length === 0) {
        listBox.innerHTML = `<div class="git-empty">工作区干净——没有未提交变更</div>`;
      }
      paintCommitBox();
      void paintLog();
    };

    const paintCommitBox = () => {
      commitBox.replaceChildren();
      const hasStaged = (snapshot?.changes ?? []).some((c) => c.staged);
      const input = document.createElement("input");
      input.className = "input";
      input.type = "text";
      input.placeholder = hasStaged ? "提交信息（提交已暂存变更）…" : "先暂存变更再提交";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      btn.textContent = "提交";
      btn.disabled = !hasStaged;
      btn.addEventListener("click", () => {
        const message = input.value.trim();
        if (message === "") {
          toast("提交信息不能为空", "warn");
          return;
        }
        void (async () => {
          try {
            await gitCall("git-commit", { cwd: root, message });
            toast("已提交", "info");
            await refresh();
          } catch (e) {
            toast(`提交失败：${e?.message ?? ""}`, "warn");
          }
        })();
      });
      commitBox.append(input, btn);
    };

    const paintLog = async () => {
      logBox.replaceChildren(Object.assign(document.createElement("div"), { textContent: "提交历史加载中…", className: "git-empty" }));
      try {
        const result = await gitCall("git-log", { cwd: root });
        logBox.replaceChildren();
        const headLine = document.createElement("div");
        headLine.className = "git-group-head";
        headLine.textContent = "最近提交";
        logBox.appendChild(headLine);
        for (const commit of result.commits ?? []) {
          const row = document.createElement("div");
          row.className = "git-log-row";
          row.innerHTML = `<code>${escapeHtml(commit.hash)}</code> <span>${escapeHtml(commit.subject)}</span><span class="git-log-meta">${escapeHtml(commit.author)} · ${escapeHtml(commit.date)}</span>`;
          logBox.appendChild(row);
        }
      } catch {
        logBox.replaceChildren(Object.assign(document.createElement("div"), { textContent: "提交历史不可用（非 git 目录？）", className: "git-empty" }));
      }
    };

    const changeRow = (change, isStaged) => {
      const row = document.createElement("div");
      row.className = "git-change-row";
      const toggle = document.createElement("details");
      toggle.className = "git-change-details";
      const summary = document.createElement("summary");
      summary.innerHTML = `${fileIcon(change.file)} <span class="git-change-file">${escapeHtml(change.file)}</span>`;
      const actions = document.createElement("span");
      actions.className = "git-change-actions";
      const stageBtn = document.createElement("button");
      stageBtn.type = "button";
      stageBtn.className = "btn btn-ghost git-mini-btn";
      stageBtn.textContent = isStaged ? "取消暂存" : "暂存";
      stageBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void stageAll([change.file], isStaged);
      });
      actions.appendChild(stageBtn);
      summary.appendChild(actions);
      const diffPre = document.createElement("pre");
      diffPre.className = "git-diff-pre";
      diffPre.textContent = "diff 加载中…";
      toggle.append(summary, diffPre);
      toggle.addEventListener("toggle", () => {
        if (!toggle.open || diffPre.dataset.loaded === "1") return;
        void (async () => {
          try {
            const result = await gitCall("git-diff", { cwd: root, file: change.file, staged: isStaged });
            diffPre.textContent = result.text || "（无差异——可能是 untracked 文件）";
            diffPre.dataset.loaded = "1";
          } catch (e) {
            diffPre.textContent = `diff 失败：${e?.message ?? ""}`;
          }
        })();
      });
      row.appendChild(toggle);
      return row;
    };

    const stageAll = async (files, unstage) => {
      try {
        await gitCall("git-stage", { cwd: root, files, unstage });
        await refresh();
      } catch (e) {
        toast(`暂存操作失败：${e?.message ?? ""}`, "warn");
      }
    };

    const refresh = async () => {
      statusBox.innerHTML = `<div class="git-empty">读取中…</div>`;
      try {
        snapshot = await gitCall("git-status", { cwd: root });
        paintStatus();
      } catch (e) {
        statusBox.innerHTML = `<div class="git-empty">git 状态不可用：${escapeHtml(String(e?.message ?? ""))}</div>`;
        listBox.replaceChildren();
        commitBox.replaceChildren();
        logBox.replaceChildren();
      }
    };
    refreshBtn.addEventListener("click", () => void refresh());
    void refresh();
  },
});

async function gitCall(op, payload) {
  // settings 信封（panel 域 op——sendSettings 同链路）
  const { sendSettings: send } = await import("./api.js");
  const envelope = await send({ op, ...payload });
  if (!envelope.ok) throw new Error(envelope.error?.message ?? "git op 失败");
  return envelope.result ?? {};
}

function escapeHtml(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
