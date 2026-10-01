/**
 * 插件中心 · 创建 tab（T-P3-148 H/J——四模板脚手架 + dev 市场登记的 UI 面）：
 * 模板单选（radiogroup——pi-desktop 模板选择对话框形态）+ 名称/描述表单 →
 * op:plugin-scaffold（生成 + dev 市场登记 + 预检一次）→ 结果面板（文件清单/
 * 清单预览/校验回执）→「去安装」按钮接主视图审批链（生成不自动装载——
 * pi pluginCreateFromTemplate 同语义）。
 */

import { sendSettings } from "../../api.js";
import { toast } from "../../feedback.js";
import { t } from "../../i18n.js";

const TEMPLATES = [
  { id: "view-basic", title: "视图", desc: "插件页内受控渲染的面板（contributes.views + HTML 入口）" },
  { id: "agent-tool", title: "智能体工具", desc: "给模型登记一个工具（SDK onActivate → registerTool）" },
  { id: "skill-pack", title: "技能包", desc: "向系统提示注入技能文档（contributes.skills）" },
  { id: "full", title: "全部能力", desc: "命令 + 技能 + 视图 + 工具 + 设置（并集示范）" },
];

export const CREATE_HTML = `
<div class="plugin-create">
  <div class="group-title">从模板创建插件</div>
  <p class="hint">生成到 &lt;工作区&gt;/plugins/&lt;名称&gt;/ 并登记本地 dev 市场；生成不自动装载——确认安装走「已安装」审批链。</p>
  <div id="plugin-template-list" class="plugin-template-list" role="radiogroup" aria-label="模板"></div>
  <div class="form-grid plugin-create-form">
    <label>插件名（slug）<input id="plugin-create-name" class="input" type="text" placeholder="如 my-plugin" autocomplete="off" /></label>
    <label>描述（可选）<input id="plugin-create-desc" class="input" type="text" placeholder="一句话描述" autocomplete="off" /></label>
  </div>
  <div class="row-control" style="gap:8px">
    <button id="plugin-create-run" type="button" class="btn btn-primary">生成插件</button>
  </div>
  <div id="plugin-create-result"></div>
</div>
`;

export function bindCreate(host) {
  let selected = "view-basic";
  const listBox = host.querySelector("#plugin-template-list");
  if (listBox !== null) {
    listBox.replaceChildren(
      ...TEMPLATES.map((tpl) => {
        const label = document.createElement("label");
        label.className = "plugin-template-card";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "plugin-template";
        radio.value = tpl.id;
        radio.checked = tpl.id === selected;
        radio.addEventListener("change", () => {
          selected = tpl.id;
        });
        const copy = document.createElement("span");
        copy.className = "row-copy";
        copy.innerHTML = `<span class="row-title">${t(tpl.title)}</span><span class="row-desc">${t(tpl.desc)}</span>`;
        label.append(radio, copy);
        return label;
      }),
    );
  }
  host.querySelector("#plugin-create-run")?.addEventListener("click", () => void runCreate(host));
}

async function runCreate(host) {
  const name = host.querySelector("#plugin-create-name")?.value.trim() ?? "";
  const description = host.querySelector("#plugin-create-desc")?.value.trim() ?? "";
  const template = host.querySelector("input[name='plugin-template']:checked")?.value ?? "view-basic";
  if (name === "") {
    toast("插件名必填（slug 形状）", "warn");
    return;
  }
  const result = host.querySelector("#plugin-create-result");
  const runBtn = host.querySelector("#plugin-create-run");
  if (runBtn !== null) {
    runBtn.disabled = true;
    runBtn.textContent = "生成中…";
  }
  try {
    const envelope = await sendSettings({
      op: "plugin-scaffold",
      name,
      template,
      ...(description !== "" ? { pluginDescription: description } : {}),
    });
    if (result === null) return;
    if (!envelope.ok) {
      result.replaceChildren(failBox("生成失败", envelope.error?.message ?? ""));
      return;
    }
    const r = envelope.result;
    const checkOk = r.check?.ok === true;
    const box = document.createElement("div");
    box.className = "card-box";
    const head = document.createElement("div");
    head.className = "row-title";
    head.textContent = `已生成：${r.dir}`;
    box.appendChild(head);
    const files = document.createElement("div");
    files.className = "row-desc";
    files.textContent = `文件：${r.files.join("、")}`;
    box.appendChild(files);
    const market = document.createElement("div");
    market.className = "row-desc";
    market.textContent = `dev 市场：${r.marketplace?.marketplacePath ?? ""}（${r.marketplace?.marketplaceName ?? ""}）`;
    box.appendChild(market);
    const checkLine = document.createElement("div");
    checkLine.className = checkOk ? "row-desc" : "row-desc error-text";
    checkLine.textContent = checkOk
      ? "预检通过（plugin-check）——可直接安装。"
      : `预检未过：${r.check?.error ?? ""}`;
    box.appendChild(checkLine);
    const actions = document.createElement("div");
    actions.className = "row-control";
    const installBtn = document.createElement("button");
    installBtn.type = "button";
    installBtn.className = "btn btn-primary";
    installBtn.textContent = "去安装（审批确认）";
    installBtn.addEventListener("click", () => {
      host.dispatchEvent(new CustomEvent("plugin-create:install", { detail: { name, dir: r.dir } }));
    });
    actions.appendChild(installBtn);
    box.appendChild(actions);
    result.replaceChildren(box);
  } finally {
    if (runBtn !== null) {
      runBtn.disabled = false;
      runBtn.textContent = "生成插件";
    }
  }
}

function failBox(title, message) {
  const box = document.createElement("div");
  box.className = "card-box";
  const head = document.createElement("div");
  head.className = "row-title error-text";
  head.textContent = title;
  const desc = document.createElement("div");
  desc.className = "row-desc error-text";
  desc.textContent = message;
  box.append(head, desc);
  return box;
}
