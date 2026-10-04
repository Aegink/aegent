/**
 * 任务列表面板（T-P3-164 需求 8——zcode 任务列表同构）：右侧面板展示
 * 本轮 todo 三态（todo_write 实时投影）+ 当前动作。对话中首次收到
 * todo_write 时自动打开（用户诉求"对话了右侧出现任务列表"）；数据源
 * 与右上角进度弹窗同源（progress-dock todosCache）。
 */

import { registerPane } from "./pane.js";
import { getTodos, getRunningTool } from "./progress-dock.js";
import { icon } from "./icons.js";

let body = null; // 激活面板的内容容器（render 注入）

function rowOf(t, cls) {
  const row = document.createElement("div");
  row.className = `progress-todo ${cls}`;
  row.textContent = t.content;
  return row;
}

function paint() {
  if (body === null || !body.isConnected) return;
  body.replaceChildren();
  const todos = getTodos();
  const tool = getRunningTool();
  if (tool !== "") {
    const toolRow = document.createElement("div");
    toolRow.className = "tasks-panel-tool";
    toolRow.textContent = `当前动作：${tool}`;
    body.appendChild(toolRow);
  }
  if (todos.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tasks-panel-empty";
    empty.textContent = "本轮还没有任务清单——AI 拆解任务后会显示在这里。";
    body.appendChild(empty);
    return;
  }
  const done = todos.filter((t) => t.status === "completed");
  const doing = todos.filter((t) => t.status === "in_progress");
  const waiting = todos.filter((t) => t.status !== "completed" && t.status !== "in_progress");
  const head = document.createElement("div");
  head.className = "progress-todos-head";
  head.textContent = `进程  ${String(done.length)}/${String(todos.length)}`;
  body.appendChild(head);
  for (const t of doing) body.appendChild(rowOf(t, "doing"));
  for (const t of waiting) body.appendChild(rowOf(t, "waiting"));
  for (const t of done) body.appendChild(rowOf(t, "done"));
}

registerPane("tasks", {
  title: () => "任务列表",
  icon: "listChecks",
  render(target) {
    body = target;
    paint();
    window.addEventListener("todos:updated", paint);
  },
  // 面板关闭/切走时解绑（pane.js onBlur 定义层钩子——多实例防泄漏）
  onBlur: () => {
    window.removeEventListener("todos:updated", paint);
    body = null;
  },
});

// todo 实时投影 → 面板重绘 + 首次自动打开（zcode 任务列表随对话出现语义）
window.addEventListener("todos:updated", () => {
  void import("./pane.js").then((m) => {
    if (!m.paneHas("tasks") && getTodos().length > 0) {
      m.openPane("tasks", {});
      return;
    }
    paint();
  });
});
