/**
 * 输入 Tab 栏 + 排队条（T-P3-156 方案 K/L；T-P3-159 需求 3/4/5 重构）。
 *
 * L（需求四：附件/权限/用量/模型常驻可见）：
 * - 附件 pill：隐藏 file input（multiple）→ 既有 addAttachment 链（10MB/件、
 *   8 件/消息限额不变）；图片能力提示（方案 N）在打磨批接线。
 * - 权限档 pill：五档菜单（PERMISSION_MODE_UI 与 kernel/session-config
 *   同源复制——basic.js 导出）→ applyPermissionMode（settings 持久化 +
 *   config/refresh 会话内即时生效，回执 toast 在 app.js 的 W 消费）。
 * - 上下文 % pill（gauge 图标）：数据源 = query op:"usage"（hello 后与每轮结算后由
 *   app.js 拉取并推入 refreshContextUsage）——≥80% 橙、≥95% 红（qwen
 *   ContextUsageDisplay 阈值语义）；点击弹锚定浮层小面板（不再开模态）。
 * - 模型 pill：锚定浮层选择器（搜索 + 按供应商分组 + 当前勾选——zcode
 *   模型面板形态）→ model/switch（写命令持约；回执经事件流 renderEvent 呈现）。
 *
 * K（需求三：排队条——只在「执行中插话」时出现）：
 * - 内核忙时发送的 prompt 自动入队（agent-process admission：忙 → queue.ts
 *   enqueue 返 accepted）——排队条是**本地投影**：仅 queued 非空才渲染，
 *   宽度与输入框同宽（同 max-width 820 居中）——正常发送不再出现任何弹窗。
 * - turn/start 时投影 FIFO 出队一条（内核 drain 语义——该条已在跑）；
 *   idle（队列排空）/prompt_returned（中止退回）清零。
 * - 撤回 = cancel{cause:{kind:"user"}}——中止后剩余排队经 prompt_returned
 *   回填输入框（app.js W 消费）。
 * - 立即发送 = steer{expectedTurn, content}（输入框当前内容注入在途轮
 *   ——不打断，内核 turn 边界插入；排队消息仍在轮末自动发送）。
 * - 发送/停止按钮实时态（需求五）归 app.js updateSendBtnState——本模块
 *   导出 stopCurrentTurn 供其停止模式调用。
 */

import { sendQuery, sendRequest } from "./api.js";
import { getSessionId, settingsCache } from "./state.js";
import { toast } from "./feedback.js";
import { icon } from "./icons.js";
import { openMenu, openPopover } from "./views/settings/core.js";

let input = null;
let queueBar = null;
let ctxPill = null;
let permPill = null;
let modelPill = null;
let attachBtn = null;
let fileInput = null;

/** 排队投影（本地摘要——内核队列的展示面，非控制面）。存全文（编辑/撤回
 *  语义需要原文），展示端再截断。 */
const queued = [];
/** 当前轮号（turn/start 记录——steer 的 expectedTurn）。 */
let currentTurn = 0;
/** 上下文用量缓存（op:usage 推入）。 */
let usageInfo = { contextTokens: 0, contextWindow: 0 };
/** 会话思考档覆盖（thinking/set 回执记忆——内存态与内核同生命周期）。 */
let currentThinking;

/** 当前会话模型的 spec（settingsCache.providers × modelId——思考档默认值
 *  与 thinkingLevels 白名单的数据源）。 */
function currentModelSpec() {
  const current = settingsCache?.model?.identity?.modelId;
  if (current === undefined || current === "") return undefined;
  for (const provider of settingsCache?.providers ?? []) {
    for (const model of provider.models ?? []) {
      if (modelIdOf(model) === current) return model;
    }
  }
  return undefined;
}

/** 生效思考档 = 会话覆盖（thinking/set）?? 模型默认档（spec.reasoning）。 */
function effectiveThinking() {
  if (currentThinking !== undefined) return currentThinking;
  return currentModelSpec()?.reasoning;
}

const ALL_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function initComposerBar(deps) {
  input = deps.input;
  queueBar = document.getElementById("queue-bar");
  ctxPill = document.getElementById("ctx-pill");
  permPill = document.getElementById("perm-pill");
  modelPill = document.getElementById("model-pill");
  attachBtn = document.getElementById("attach-add-btn");
  fileInput = document.getElementById("attach-file-input");

  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    for (const file of fileInput.files ?? []) {
      deps.addAttachment(file); // 既有附件链（限额/预览/revoke 全复用）
    }
    fileInput.value = ""; // 同一文件可重复添加（用户再选同名文件不失效）
  });

  permPill.addEventListener("click", () => void openPermissionMenu());
  modelPill.addEventListener("click", () => void openModelMenu());
  ctxPill.addEventListener("click", () => void openUsageDetail());

  paintQueueBar();
  paintPermPill();
  paintModelPill();
  paintCtxPill();

  // 运行态事件兜底（与 sidebar/progress-dock 同模式——app.js 广播；
  // notifyTurnStarted/notifyIdle 是主路径，事件监听防状态漏同步）
  window.addEventListener("agent:busy", () => paintQueueBar());
  window.addEventListener("agent:idle", () => paintQueueBar());
  // settings 缓存就绪/更新后重绘 pill（init 时缓存尚空——首拉在 sidebar 首刷）
  window.addEventListener("settings:cache-updated", () => {
    paintPermPill();
    paintModelPill();
    paintCtxPill();
  });
}

// ---------------------------------------------------------------------------
// 运行态通知（app.js 事件转发进来——模块间解耦经显式调用）
// ---------------------------------------------------------------------------

/** turn/start：轮号记录 + 投影 FIFO 出队一条（内核 drain——该条已在跑）+
 *  排队条重绘。 */
export function notifyTurnStarted(turn) {
  currentTurn = Number(turn) || currentTurn;
  if (queued.length > 0) queued.shift();
  paintQueueBar();
}

/** idle：队列已被内核排空（idle 只在队列空时宣告）——投影清零。 */
export function notifyIdle() {
  queued.splice(0, queued.length);
  paintQueueBar();
}

/** prompt_returned：中止退回（app.js 已回填输入框）——投影清零。 */
export function notifyPromptReturned() {
  queued.splice(0, queued.length);
  paintQueueBar();
}

/** 发送时 agent 忙 → 本条进了内核队列（投影摘要）。由 app.js submitPrompt 调。 */
export function notifyQueued(content) {
  queued.push(String(content));
  paintQueueBar();
}

export function isAgentBusy() {
  return queueBar !== null && queueBar.dataset.busy === "1";
}

function oneLineOf(text) {
  const s = String(text).replace(/\s+/g, " ").trim();
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

// ---------------------------------------------------------------------------
// K：排队条渲染与动作（T-P3-159 需求 3——仅插话时出现；同输入框宽度；
//    行 = 排队原文一行省略；条动作 = 立即发送（steer 输入框内容）+ 撤回）
// ---------------------------------------------------------------------------

function paintQueueBar() {
  if (queueBar === null) return;
  const busy = window.__agentBusy === true;
  queueBar.dataset.busy = busy ? "1" : "0";
  queueBar.replaceChildren();
  if (queued.length === 0) {
    queueBar.hidden = true;
    return; // 正常发送/空闲执行：无排队内容 = 不出现任何弹窗（需求三）
  }
  queueBar.hidden = false;

  const head = document.createElement("div");
  head.className = "queue-head";
  const status = document.createElement("span");
  status.className = "queue-status";
  status.append(
    icon("loader", { cls: "icon-sm icon-spin" }),
    document.createTextNode(` 排队 ${String(queued.length)} 条`),
  );
  const hint = document.createElement("span");
  hint.className = "queue-hint";
  hint.title = "排队消息将在本轮结束后自动逐条发送；在输入框写入新内容可点「立即发送」插队注入当前轮。";
  hint.textContent = "轮末自动发送";
  head.append(status, hint);
  queueBar.appendChild(head);

  const list = document.createElement("div");
  list.className = "queue-rows";
  for (const text of queued) {
    const row = document.createElement("div");
    row.className = "queue-row";
    row.title = text;
    row.textContent = oneLineOf(text);
    list.appendChild(row);
  }
  queueBar.appendChild(list);

  if (busy) {
    const actions = document.createElement("div");
    actions.className = "queue-actions";
    // 立即发送：输入框当前内容 steer 注入在途轮（不打断——codex steer 语义）
    const sendNow = document.createElement("button");
    sendNow.type = "button";
    sendNow.className = "queue-btn queue-btn-primary";
    sendNow.textContent = "立即发送";
    sendNow.title = "把输入框当前内容立即注入当前轮（AI 在下一步间隙即可看到——不打断执行）";
    sendNow.addEventListener("click", () => void steerNow());
    // 撤回：cancel（中止后剩余排队经 prompt_returned 回填输入框）
    const recall = document.createElement("button");
    recall.type = "button";
    recall.className = "queue-btn";
    recall.textContent = "撤回";
    recall.title = "停止当前轮并把排队消息退回输入框";
    recall.addEventListener("click", () => void cancelTurn());
    actions.append(sendNow, recall);
    queueBar.appendChild(actions);
  }
}

async function steerNow() {
  const content = input.value.trim();
  if (content === "") {
    toast("输入框为空——先写要插入的内容，再点「立即发送」", "warn");
    return;
  }
  const sid = getSessionId();
  if (sid === "" || currentTurn <= 0) {
    toast("当前没有执行中的轮次可注入", "warn");
    return;
  }
  try {
    await sendRequest(sid, { type: "steer", expectedTurn: currentTurn, content });
    input.value = "";
    input.dispatchEvent(new Event("input"));
    toast("已注入当前轮（steer）——AI 在下一步间隙即可看到", "info");
  } catch (e) {
    toast(`注入失败：${e?.message ?? ""}`, "warn");
  }
}

/** 停止当前轮（导出——app.js 发送按钮停止模式与排队条「撤回」共用）。 */
export async function stopCurrentTurn() {
  const sid = getSessionId();
  if (sid === "") return;
  try {
    await sendRequest(sid, { type: "cancel", cause: { kind: "user" } });
    toast("已请求中止——剩余排队输入将退回输入框", "info");
  } catch (e) {
    toast(`中止失败：${e?.message ?? ""}`, "warn");
  }
}

// ---------------------------------------------------------------------------
// L：权限档 pill（五档菜单——basic.js 同源导出）
// ---------------------------------------------------------------------------

async function openPermissionMenu() {
  const basic = await import("./views/settings/basic.js");
  const current = settingsCache?.permission?.mode ?? "ask";
  openMenu(permPill, basic.PERMISSION_MODE_UI.map((mode) => ({
    label: `${mode.label}——${mode.desc}`,
    icon: mode.name === current ? "check" : undefined, // 当前档=勾选标（zcode「选中=打勾」语义）
    onClick: () => void basic.applyPermissionMode(mode.name),
  })));
}

function paintPermPill() {
  if (permPill === null) return;
  const current = settingsCache?.permission?.mode ?? "ask";
  const labels = { ask: "每次询问", "accept-edits": "自动批编辑", "read-only": "只读", auto: "全自动", unattended: "无人值守" };
  permPill.replaceChildren(icon("shield", { cls: "icon-sm" }), document.createTextNode(` ${labels[current] ?? current}`));
}

/** settings 保存/切档回执后由 app.js 调（pill 文案随档位刷新）。 */
export function notifyPermissionChanged() {
  paintPermPill();
}

// ---------------------------------------------------------------------------
// L：模型·供应商 pill（model/switch——写命令持约）
// ---------------------------------------------------------------------------

/** models[] 条目是 ProviderModelSpec 对象（settings.ts:75——id 必带/alias 可选），
 *  兼容旧 string 形态；直插模板串会渲染 "[object Object]"（P-020）。 */
function modelLabel(model) {
  if (typeof model === "string") return model;
  return model?.alias ?? model?.id ?? model?.name ?? "";
}

/** wire 的 model/switch.identity.modelId 要字符串 id——对象形态取 id。 */
function modelIdOf(model) {
  if (typeof model === "string") return model;
  return model?.id ?? model?.name ?? "";
}

/** 模型选择器（T-P3-160 需求 2——两级：供应商一级 → 模型二级，pi/zcode
 *  层级菜单语义；锚定浮层、当前项勾选、底部「新供应商/管理模型」直达设置）。 */
async function openModelMenu() {
  const providers = settingsCache?.providers ?? [];
  const currentModel = settingsCache?.model?.identity?.modelId;
  if (providers.length === 0) {
    toast("尚未配置任何供应商/模型——设置「供应商」分节添加后可用", "warn");
    return;
  }
  openPopover(modelPill, {
    width: 340,
    build: (panel, close) => {
      const body = document.createElement("div");
      body.className = "model-picker-list";
      const paintProviders = () => {
        body.replaceChildren();
        const title = document.createElement("div");
        title.className = "model-picker-group";
        title.textContent = "选择供应商";
        body.appendChild(title);
        for (const provider of providers) {
          const count = (provider.models ?? []).length;
          const row = document.createElement("button");
          row.type = "button";
          row.className = "model-picker-row has-children";
          const name = document.createElement("span");
          name.className = "model-picker-name";
          name.textContent = provider.name ?? provider.id ?? provider.baseUrl;
          const meta = document.createElement("span");
          meta.className = "model-picker-meta";
          meta.textContent = `${String(count)} 个模型`;
          row.append(name, meta);
          row.addEventListener("click", () => paintModels(provider));
          body.appendChild(row);
        }
        const foot = document.createElement("div");
        foot.className = "model-picker-foot";
        // T-P3-162 需求 1：一级只有「管理模型」入口（供应商列表已动态
        // 承载既配名字——点击进对应二级模型+思考度选择）
        const manage = document.createElement("button");
        manage.type = "button";
        manage.className = "model-picker-row";
        manage.textContent = "管理模型";
        manage.title = "打开设置 → 供应商（新增供应商/配置模型都在那里）";
        manage.addEventListener("click", () => {
          close();
          location.hash = "#settings/providers";
        });
        foot.appendChild(manage);
        body.appendChild(foot);
      };
      const paintModels = (provider) => {
        body.replaceChildren();
        const back = document.createElement("button");
        back.type = "button";
        back.className = "model-picker-back";
        back.append(icon("chevronUp", { cls: "icon-sm" }), document.createTextNode(` ${provider.name ?? provider.id ?? ""}`));
        back.title = "返回供应商列表";
        back.addEventListener("click", paintProviders);
        body.appendChild(back);
        const models = provider.models ?? [];
        if (models.length === 0) {
          const empty = document.createElement("div");
          empty.className = "queue-hint";
          empty.textContent = "该供应商尚未配置模型";
          body.appendChild(empty);
        }
        for (const model of models) {
          const id = modelIdOf(model);
          const row = document.createElement("button");
          row.type = "button";
          row.className = "model-picker-row";
          const name = document.createElement("span");
          name.className = "model-picker-name";
          name.textContent = modelLabel(model);
          row.appendChild(name);
          if (id !== "" && id === currentModel) {
            row.classList.add("current");
            row.appendChild(icon("check", { cls: "icon-sm" }));
          }
          row.addEventListener("click", () => {
            close();
            void switchModel(provider, id);
          });
          body.appendChild(row);
        }
        // T-P3-163 需求 3：思考度档位按模型动态（spec.thinkingLevels 白名单
        // ——内置目录标注的该模型支持档；无配置 = 全集）；omit=请求不带思考
        // 参数；当前高亮 = 会话覆盖 ?? 模型默认档（spec.reasoning）
        const spec = currentModelSpec();
        const levels = Array.isArray(spec?.thinkingLevels) && spec.thinkingLevels.length > 0
          ? spec.thinkingLevels
          : [...ALL_THINKING_LEVELS];
        const effective = effectiveThinking();
        const THINKING = [
          ["omit", "不传"],
          ...levels.map((lv) => [lv, lv]),
          ...(effective !== undefined && effective !== "omit" && !levels.includes(effective)
            ? [[effective, effective]]
            : []),
        ];
        const seg = document.createElement("div");
        seg.className = "thinking-seg";
        const segHead = document.createElement("div");
        segHead.className = "model-picker-group";
        segHead.textContent = "思考度";
        seg.appendChild(segHead);
        const segRow = document.createElement("div");
        segRow.className = "thinking-row";
        for (const [value, label] of THINKING) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = `thinking-chip${effective === value ? " current" : ""}`;
          chip.textContent = label;
          chip.title = value === "omit" ? "请求不带思考参数（跟服务端默认）" : `思考档 ${value}`;
          chip.addEventListener("click", () => {
            close();
            void setThinking(value);
          });
          segRow.appendChild(chip);
        }
        seg.appendChild(segRow);
        body.appendChild(seg);
      };
      paintProviders();
      panel.append(body);
    },
  });
}

/** 会话思考档切换（thinking/set 写命令持约——回执经 thinking_set 通知）。 */
async function setThinking(level) {
  const sid = getSessionId();
  if (sid === "") {
    toast("会话未就绪", "warn");
    return;
  }
  try {
    await sendRequest(sid, { type: "thinking/set", level });
    // 回执面（thinking_set 通知）会再刷新一次——这里乐观先行
    currentThinking = level;
    paintModelPill();
  } catch (e) {
    toast(`思考档设置失败：${e?.message ?? ""}`, "warn");
  }
}

/** thinking_set 回执（app.js notification 分支转发）——档位记忆 + pill 重绘。 */
export function notifyThinkingSet(level) {
  currentThinking = level;
  paintModelPill();
}

async function switchModel(provider, modelId) {
  const sid = getSessionId();
  if (sid === "") {
    toast("会话未就绪", "warn");
    return;
  }
  const providerId = provider.id ?? provider.name ?? provider.baseUrl;
  try {
    await sendRequest(sid, { type: "model/switch", identity: { provider: providerId, modelId } });
    modelPill.replaceChildren(icon("cpu", { cls: "icon-sm" }), document.createTextNode(` ${modelId}`));
    toast(`模型已切换：${providerId} / ${modelId}（下一轮起生效）`, "info");
  } catch (e) {
    toast(`切换失败：${e?.message ?? ""}（需要写租约）`, "warn");
  }
}

function paintModelPill() {
  if (modelPill === null) return;
  const eff = effectiveThinking();
  const thinkingLabel = eff !== undefined
    ? (eff === "omit" ? " · 不传" : ` · ${eff}`)
    : "";
  const currentModel = settingsCache?.model?.identity?.modelId;
  if (currentModel !== undefined && currentModel !== "") {
    modelPill.replaceChildren(icon("cpu", { cls: "icon-sm" }), document.createTextNode(` ${currentModel}${thinkingLabel}`));
    return;
  }
  const first = settingsCache?.providers?.[0];
  const firstModel = first?.models?.[0];
  if (first !== undefined && firstModel !== undefined) {
    const label = modelLabel(firstModel);
    modelPill.replaceChildren(icon("cpu", { cls: "icon-sm" }), document.createTextNode(` ${label}${thinkingLabel}`));
    modelPill.title = `当前缺省：${first.name ?? first.id ?? ""} / ${label}${thinkingLabel}（点击切换本次会话模型与思考度）`;
  }
}

// ---------------------------------------------------------------------------
// L：上下文 % pill（op:usage 拉取推入——app.js 在 hello 后与轮结算后调用）
// ---------------------------------------------------------------------------

export async function refreshContextUsage() {
  const sid = getSessionId();
  if (sid === "") return;
  const envelope = await sendQuery({ sessionId: sid, op: "usage" });
  if (!envelope.ok) return;
  const u = envelope.result ?? {};
  usageInfo = {
    contextTokens: u.currentSession?.contextTokens ?? 0,
    contextWindow: u.contextWindow ?? 0,
  };
  paintCtxPill();
}

function paintCtxPill() {
  if (ctxPill === null) return;
  const { contextTokens, contextWindow } = usageInfo;
  const pct = contextWindow > 0 ? Math.min(100, Math.round((contextTokens / contextWindow) * 100)) : 0;
  ctxPill.replaceChildren(icon("gauge", { cls: "icon-sm" }), document.createTextNode(` ${String(pct)}%`));
  ctxPill.classList.toggle("ctx-warn", pct >= 80 && pct < 95);
  ctxPill.classList.toggle("ctx-hot", pct >= 95);
}

async function openUsageDetail() {
  // T-P3-159 需求 4：用量明细改锚定小浮层（原为居中模态——体积与位置
  // 都超出「从原点击位置展开」的预期）
  const { contextTokens, contextWindow } = usageInfo;
  const pct = contextWindow > 0 ? Math.round((contextTokens / contextWindow) * 100) : 0;
  const fmt = (n) => new Intl.NumberFormat("zh-CN", { notation: n >= 10000 ? "compact" : "standard" }).format(n);
  openPopover(ctxPill, {
    width: 320,
    build: (panel, close) => {
      const row1 = document.createElement("div");
      row1.className = "usage-detail-row";
      const k1 = document.createElement("span");
      k1.textContent = "本会话上下文占用";
      const v1 = document.createElement("b");
      v1.textContent = `${fmt(contextTokens)} / ${fmt(contextWindow)} token（${String(pct)}%）`;
      row1.append(k1, v1);
      const row2 = document.createElement("div");
      row2.className = "usage-detail-row";
      const k2 = document.createElement("span");
      k2.textContent = "数据口径";
      const v2 = document.createElement("span");
      v2.textContent = "本会话末轮计量";
      row2.append(k2, v2);
      const actions = document.createElement("div");
      actions.className = "usage-detail-actions";
      const openUsage = document.createElement("button");
      openUsage.type = "button";
      openUsage.className = "btn btn-primary";
      openUsage.textContent = "打开用量页";
      openUsage.addEventListener("click", () => {
        close();
        location.hash = "#usage";
      });
      actions.appendChild(openUsage);
      panel.append(row1, row2, actions);
    },
  });
}
