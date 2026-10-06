/**
 * 定时任务管理卡（C1 补口——调度域装配的 UI 消费面）：cron 任务的清单/
 * 添加/删除。数据面 = settings op cron-list/cron-add/cron-remove（host
 * 调度运行时每分钟 tick，到期任务把 prompt 投递主会话执行——事件照常落
 * 流）。触发语义与表达式语法（5 段 vixie 子集）说明见 host scheduler-ops。
 */

import { sendSettings } from "../../api.js";
import { toast } from "../../feedback.js";
import { confirmDialog } from "./core.js";

export const SECTION_HTML = `
<section data-section="automation">
  <div class="section-head"><h2 class="section-title">定时任务</h2></div>
  <p class="hint">按 cron 表达式定时向当前主会话投递提示词（host 每分钟检查一次；事件照常进会话流，可回退可审计）。表达式 = 分 时 日 月 周（<code>*</code> / 数字 / 逗号列表 / <code>a-b</code> 范围 / <code>*/n</code> 步进；日与周为 OR 语义）。</p>
  <div class="group-title">任务清单</div>
  <div class="row-list" id="cron-task-list"></div>
  <div class="group-title">添加任务</div>
  <div class="row-list">
    <div class="row">
      <div class="row-copy">
        <div class="row-title">cron 表达式</div>
        <div class="row-desc">如 <code>0 9 * * 1-5</code>（工作日每天 09:00）。</div>
      </div>
      <div class="row-control"><input id="cron-add-expr" class="input" type="text" placeholder="0 9 * * 1-5" style="width: 160px" /></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">触发提示词</div>
        <div class="row-desc">到期时投递给主会话的内容（会触发完整的模型轮与工具执行）。</div>
      </div>
      <div class="row-control"><input id="cron-add-prompt" class="input" type="text" placeholder="汇总昨天的会话与用量" style="width: 260px" /></div>
    </div>
    <div class="row">
      <div class="row-copy">
        <div class="row-title">确认添加</div>
        <div class="row-desc">入库后下一分钟节拍起生效；删除即停。</div>
      </div>
      <div class="row-control"><button id="cron-add-btn" class="btn btn-primary" type="button">添加</button></div>
    </div>
  </div>
</section>
`;

/** 单任务行（expr + prompt 摘要 + 上次触发时间 + 删除）。 */
function taskRow(task) {
  const row = document.createElement("div");
  row.className = "row";
  const copy = document.createElement("div");
  copy.className = "row-copy";
  const title = document.createElement("div");
  title.className = "row-title";
  title.textContent = task.expr;
  const desc = document.createElement("div");
  desc.className = "row-desc";
  const promptBrief = String(task.prompt ?? "").length > 60 ? `${String(task.prompt).slice(0, 60)}…` : String(task.prompt ?? "");
  const fired = task.lastFiredAt === null || task.lastFiredAt === undefined ? "从未触发" : `上次触发 ${new Date(task.lastFiredAt).toLocaleString()}`;
  desc.textContent = `${promptBrief} · ${fired}`;
  copy.append(title, desc);
  const control = document.createElement("div");
  control.className = "row-control";
  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn";
  del.textContent = "删除";
  del.addEventListener("click", () => void removeTask(task.id, task.expr));
  control.appendChild(del);
  row.append(copy, control);
  return row;
}

export async function refresh() {
  const list = document.getElementById("cron-task-list");
  if (list === null) return; // 分节未挂载
  const envelope = await sendSettings({ op: "cron-list" });
  list.replaceChildren();
  if (!envelope.ok) {
    const fail = document.createElement("div");
    fail.className = "row";
    fail.textContent = `清单不可用：${envelope.error?.message ?? ""}`;
    list.appendChild(fail);
    return;
  }
  const tasks = envelope.result?.tasks ?? [];
  if (tasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "row";
    empty.textContent = "（暂无定时任务——下方表单添加）";
    list.appendChild(empty);
    return;
  }
  for (const task of tasks) list.appendChild(taskRow(task));
}

async function removeTask(id, expr) {
  const ok = await confirmDialog(`删除定时任务「${expr}」？`, { confirmLabel: "删除", danger: true });
  if (ok !== true) return;
  const envelope = await sendSettings({ op: "cron-remove", id });
  if (!envelope.ok) {
    toast(`删除失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  toast("已删除", "info");
  void refresh();
}

export function bind() {
  const addBtn = document.getElementById("cron-add-btn");
  if (addBtn === null) return;
  addBtn.addEventListener("click", async () => {
    const exprInput = document.getElementById("cron-add-expr");
    const promptInput = document.getElementById("cron-add-prompt");
    if (exprInput === null || promptInput === null) return;
    const expr = exprInput.value.trim();
    const prompt = promptInput.value.trim();
    if (expr === "" || prompt === "") {
      toast("表达式与提示词都要填", "warn");
      return;
    }
    const envelope = await sendSettings({ op: "cron-add", expr, prompt });
    if (!envelope.ok) {
      toast(`添加失败：${envelope.error?.message ?? ""}`, "warn");
      return;
    }
    exprInput.value = "";
    promptInput.value = "";
    toast("定时任务已添加（下一分钟节拍起生效）", "info");
    void refresh();
  });
}
