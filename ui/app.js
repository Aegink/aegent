/**
 * aegent ui（K5/K2·T-P1-128）——一份静态资产两个端：Web（浏览器直开 host
 * 地址）与桌面壳（Tauri WebView 加载同一目录）。零构建链零框架（卡序头
 * 约束 1）；协议面 = 端间协议（K8 信封）：hello → query events（恢复视图）
 * → request/lease（写命令持约）→ event/notification（流渲染）。
 *
 * T-P3-134 · UI 批次 A：本文件瘦身为**入口**——WS 生命周期 + 路由启动 +
 * 聊天流主逻辑（会话域）。共享层已下沉：api.js（协议面）/ state.js（共享
 * 状态）/ feedback.js（跨视图 DOM 原语）/ router.js（hash 路由）/ icons.js
 * （图标集）；设置/用量/工作台/通知/历史/搜索迁出为 views/*.js 页面模块
 * （原生动态 import——视图契约 render(container, params) + 可选 unmount）。
 */

// U4/T-P3-107 渲染分层：assistant 走 markdown+高亮管线（render.js——
// 用户输入不走此管线，注入面防呆）；vendor 本地化见 ui/vendor/README.md
import { buildDiffLines, parseDenial, renderMarkdown } from "./render.js";
// U25/T-P3-128 快捷键分发面（注册表本体与清单渲染在 state.js/设置视图）
import { resolveAction } from "./keymap.js";
// 共享层（批 A③ 下沉——单向依赖：app/views → api/state/feedback）
import {
  SURFACE_KIND,
  SURFACE_ID,
  allocRequestId,
  connect,
  sendRaw,
  sendRequest,
  sendQuery,
  sendSettings,
  ensureFileCache,
  ensureMetaCache,
  inflight,
} from "./api.js";
import {
  settingsCache,
  setSettingsCache,
  getSessionId,
  setSessionId,
  lastUserPrompt,
  setLastUserPrompt,
  promptsCacheLoaded,
  markPromptsLoaded,
  notifications,
  emitNotify,
  emitTurnSettled,
  updateNotifyBadge,
  applyTheme,
  rebuildKeymap,
  getKeymapBindings,
  hooks,
} from "./state.js";
import { lineEl, appendLine, scrollBottom, oneLine, toast } from "./feedback.js";
import { applyLocalePreference, t } from "./i18n.js";
import { installGlobalErrorReporters } from "./log-report.js";
// T-P3-156 布局批（方案 A/B/C/E/W）：侧栏两分段 + 切换面板宿主
import { initSidebar, refreshSidebar, newTaskFlow } from "./sidebar.js";
import { initPane, togglePane, registerPane, openPane } from "./pane.js";
// T-P3-156 功能批（方案 K/L/U）：输入 Tab 栏 + 排队条 + 右上角进度弹窗
import {
  initComposerBar,
  notifyTurnStarted,
  notifyIdle as notifyComposerIdle,
  notifyPromptReturned,
  notifyQueued,
  notifyPermissionChanged,
  refreshContextUsage,
} from "./composer-bar.js";
import { initProgressDock, notifyToolCall, notifyEventLine } from "./progress-dock.js";
// T-P3-156 面板批（P/Q/R/S/T）：终端抽屉 + 浏览器/Git/审查/辅助对话四面板
import { initTerminalPane, toggleTerminal } from "./terminal.js";
import { fileIcon as fileIconOf } from "./views/projects-files.js";
import "./pane-browser.js";
import "./pane-git.js";
import "./pane-review.js";
import "./pane-assistant.js";
import "./pane-tree.js";
import { openBrowserPane } from "./pane-browser.js";

installGlobalErrorReporters(); // T-P3-154 A3：全局错误捕获（模块加载即挂——视图崩溃也捕）
import { go, startRouter } from "./router.js";
import { injectIcons } from "./icons.js";
// U26/T-P3-149 录音三态机 + 插入冲突裁决 + chat 通道 wav 转码
import {
  createVoiceCapture,
  resolveVoiceInsertion,
  resampleToWav16k,
  RECORD_MAX_SECONDS_DEFAULT,
} from "./composer-voice.js";

const stream = document.getElementById("stream");
const pending = document.getElementById("pending");
const statusEl = document.getElementById("conn-status");
const surfaceEl = document.getElementById("surface-id");
const leaseEl = document.getElementById("lease-status");
const leaseBtn = document.getElementById("lease-btn");
const input = document.getElementById("prompt-input");
const sendBtn = document.getElementById("send-btn");

surfaceEl.textContent = SURFACE_ID;

let holdsLease = false;

/** 会话 id 读取（state.js 共享态的本地别名——聊天域调用点密集）。 */
function sessionId() {
  return getSessionId();
}

function setLeaseUi(held, holder) {
  holdsLease = held;
  leaseEl.textContent = held ? "写租约：本端" : holder ? `写租约：${holder}` : "写租约：空闲";
  leaseBtn.textContent = held ? "归还写租约" : "取得写租约";
}

leaseBtn.addEventListener("click", () => {
  sendRaw({
    type: "lease",
    op: holdsLease ? "release" : "acquire",
    surfaceId: SURFACE_ID,
  });
});

// ---------------------------------------------------------------------------
// U4/T-P3-107 渲染分层：assistant=markdown 气泡（流式打字回放）、工具=折叠卡
// （callId 成对 + 写操作 diff）、其余=单行摘要（repl renderEventSummary 同源）。
// ---------------------------------------------------------------------------

const STREAM_MAX_MS = 2000;

function endKindText(reason) {
  if (reason === undefined || reason === null) return "?";
  switch (reason.kind) {
    case "completed":
      return "completed";
    case "aborted":
      return `aborted（${reason.cause?.kind ?? "?"}）`;
    case "blocked":
      return "blocked";
    case "error":
      return `error：${reason.error?.code ?? ""} ${reason.error?.message ?? ""}`.trim();
    case "max-tokens":
      return "max-tokens";
    case "interrupted":
      return "interrupted";
    default:
      return reason.kind;
  }
}

/** 流式打字：text-delta 节流追加（rAF 消费 TimedStreamChunk 时间轴——事件
 * 自带流记录即回放输入，零新增 wire 面）；终态换完整 markdown+高亮渲染。
 * onDone = 终态渲染后的装饰回调（时间戳/朗读按钮——textContent/innerHTML
 * 覆盖会清掉先前 append 的子元素，装饰必须等终态后挂载）。 */
function typeStream(bubble, chunks, finalContent, onDone) {
  const deltas = [];
  for (const c of chunks) {
    if (c?.chunk?.type === "text-delta") deltas.push({ t: Number(c.time) || 0, text: String(c.chunk.text ?? "") });
  }
  if (deltas.length === 0) {
    bubble.innerHTML = renderMarkdown(finalContent);
    scrollBottom();
    if (onDone !== undefined) onDone();
    return;
  }
  const t0 = deltas[0].t;
  const total = Math.max((deltas[deltas.length - 1]?.t ?? t0) - t0, 1);
  const speed = total > STREAM_MAX_MS ? STREAM_MAX_MS / total : 1; // 超长流压缩到 ≤2s
  let i = 0;
  let acc = "";
  const start = performance.now();
  const tick = () => {
    const elapsed = (performance.now() - start) / speed;
    while (i < deltas.length && deltas[i].t - t0 <= elapsed) {
      acc += deltas[i].text;
      i++;
    }
    bubble.textContent = acc; // 打字过程纯文本增量追加（不重排）
    scrollBottom();
    if (i < deltas.length) {
      requestAnimationFrame(tick);
    } else {
      bubble.innerHTML = renderMarkdown(finalContent);
      scrollBottom();
      if (onDone !== undefined) onDone();
    }
  };
  requestAnimationFrame(tick);
}

function diffEl(lines) {
  const wrap = document.createElement("div");
  wrap.className = "diff";
  for (const l of lines) {
    const row = document.createElement("div");
    row.className = `diff-row ${l.kind}`;
    row.textContent = l.text;
    wrap.appendChild(row);
  }
  return wrap;
}

/** C55 alternatives 展示（拒绝卡——"被拒之后可以怎么办"编号清单）。 */
function denialEl(denial) {
  const wrap = document.createElement("div");
  wrap.className = "denial";
  const reason = document.createElement("div");
  reason.textContent = `被权限策略拒绝：${denial.reason}`;
  wrap.appendChild(reason);
  if (denial.justification !== undefined) {
    const just = document.createElement("div");
    just.className = "denial-just";
    just.textContent = `规则理由：${denial.justification}`;
    wrap.appendChild(just);
  }
  if (denial.alternatives.length > 0) {
    const head = document.createElement("div");
    head.textContent = "替代做法：";
    const ol = document.createElement("ol");
    for (const alt of denial.alternatives) {
      const li = document.createElement("li");
      li.textContent = alt;
      ol.appendChild(li);
    }
    wrap.append(head, ol);
  }
  return wrap;
}

// T-P3-156 G：工具卡展开态持久化（模块级 Map——zcode toolLayoutOpenState
// 同构：会话内切任务/重放后展开态记忆保持，callId 为键）
const toolOpenState = new Map();

// T-P3-156 反馈 4：工具呈现映射（zcode 对标——动作词+文件类型图标+目录+
// diff 行数徽标；kind = file（读 args.path 出文件名/目录）/ shell（args.command
// mono 呈现）/ plain（默认 args 摘要））
const TOOL_PRESENTATION = {
  read: { icon: "📄", verb: "读取", kind: "file" },
  write: { icon: "✏️", verb: "写入", kind: "file" },
  edit: { icon: "📝", verb: "编辑", kind: "file" },
  apply_patch: { icon: "🩹", verb: "补丁", kind: "plain" },
  bash: { icon: "▶", verb: "终端", kind: "shell" },
  pwsh: { icon: "▶", verb: "终端", kind: "shell" },
  glob: { icon: "📁", verb: "查找文件", kind: "plain" },
  grep: { icon: "🔍", verb: "搜索", kind: "plain" },
  skill_load: { icon: "⚡", verb: "加载技能", kind: "plain" },
  todo_write: { icon: "☑️", verb: "更新待办", kind: "plain" },
  tool_load: { icon: "🧩", verb: "加载工具", kind: "plain" },
  webfetch: { icon: "🌐", verb: "抓取网页", kind: "plain" },
  question: { icon: "❓", verb: "提问", kind: "plain" },
  task: { icon: "🤖", verb: "子代理", kind: "plain" },
  session_query: { icon: "🔎", verb: "会话查询", kind: "plain" },
  session_get: { icon: "🔎", verb: "会话读取", kind: "plain" },
  lsp: { icon: "🔧", verb: "LSP", kind: "plain" },
  plan_enter: { icon: "🗺", verb: "进入规划", kind: "plain" },
  plan_exit: { icon: "🗺", verb: "退出规划", kind: "plain" },
  plugin_create: { icon: "🧩", verb: "创建插件", kind: "plain" },
  plugin_define: { icon: "🧩", verb: "定义插件", kind: "plain" },
};

/** 写入/编辑的行数徽标（zcode +N 对标）：write=新增行数；edit=+/−行数对。 */
function diffBadgeOf(toolName, args) {
  if (args === null) return null;
  if (toolName === "write" && typeof args.content === "string") {
    const n = args.content.split("\n").length;
    return { add: n, del: 0 };
  }
  if (toolName === "edit") {
    const oldLines = typeof args.oldText === "string" ? args.oldText.split("\n").length : 0;
    const newLines = typeof args.newText === "string" ? args.newText.split("\n").length : 0;
    if (oldLines === 0 && newLines === 0) return null;
    return { add: newLines, del: oldLines };
  }
  return null;
}

function buildToolCard(e) {
  const card = document.createElement("details");
  card.className = "tool-card";
  card.dataset.callId = e.callId;
  // G：展开态恢复 + toggle 记忆（用户手动展开/收起优先于自动策略）
  if (toolOpenState.get(e.callId) === true) card.open = true;
  card.addEventListener("toggle", () => {
    toolOpenState.set(e.callId, card.open);
  });
  const summary = document.createElement("summary");
  const args = safeParseArgs(e.arguments);
  const pres = TOOL_PRESENTATION[e.name] ?? { icon: "⚙", verb: e.name, kind: "plain" };
  // 动作词（主色强调——zcode 动词开头语义）
  const name = document.createElement("span");
  name.className = "tool-name";
  name.textContent = e.name; // 纯名（G 聚合的 READONLY 匹配与 minimap 依赖）
  const verb = document.createElement("span");
  verb.className = "tool-verb";
  verb.textContent = `${pres.icon} ${pres.verb}`;
  summary.append(verb, name);
  // 文件类：文件类型图标+文件名+目录（zcode 截图语义——「写入 [js] pane-browser.js ui/ +173」）
  const filePath = args !== null && typeof args.path === "string" ? args.path : "";
  if (pres.kind === "file" && filePath !== "") {
    const parts = filePath.split(/[\/]/);
    const fileName = parts.at(-1) ?? filePath;
    const dir = parts.slice(0, -1).join("/");
    const fileIcon = document.createElement("span");
    fileIcon.className = "tool-file-icon";
    fileIcon.textContent = fileIconOf(fileName);
    const fileNameSpan = document.createElement("span");
    fileNameSpan.className = "tool-file-name";
    fileNameSpan.textContent = fileName;
    summary.append(fileIcon, fileNameSpan);
    if (dir !== "") {
      const dirSpan = document.createElement("span");
      dirSpan.className = "tool-file-dir";
      dirSpan.textContent = dir;
      summary.appendChild(dirSpan);
    }
    const badge = diffBadgeOf(e.name, args);
    if (badge !== null) {
      const diff = document.createElement("span");
      diff.className = "tool-diff-badge";
      diff.innerHTML = `${badge.add > 0 ? `<b class="add">+${String(badge.add)}</b>` : ""}${badge.del > 0 ? ` <b class="del">−${String(badge.del)}</b>` : ""}`;
      summary.appendChild(diff);
    }
  } else {
    const argsSpan = document.createElement("span");
    argsSpan.className = "tool-args";
    const shellCmd = pres.kind === "shell" && args !== null && typeof args.command === "string";
    argsSpan.textContent = shellCmd ? `$ ${oneLine(args.command, 140)}` : oneLine(args !== null ? JSON.stringify(args) : e.arguments, 160);
    if (shellCmd) argsSpan.classList.add("mono");
    summary.append(argsSpan);
  }
  const status = document.createElement("span");
  status.className = "tool-status running";
  status.textContent = "运行中";
  summary.appendChild(status);
  const body = document.createElement("div");
  body.className = "tool-body";
  const argsPre = document.createElement("pre");
  argsPre.className = "card-args";
  argsPre.textContent = args !== null ? JSON.stringify(args, null, 2) : String(e.arguments ?? "");
  body.appendChild(argsPre);
  const diff = args !== null ? buildDiffLines(e.name, args) : null;
  if (diff !== null) body.appendChild(diffEl(diff)); // 写操作 diff 对照
  card.append(summary, body);
  return card;
}

// T-P3-145 G：task/meta 子会话回放入口（task 与 task_wait 结果卡——点击
// 拉子会话事件快照只读回放）；T-P3-156 H：新增「在面板打开」——切换面板
// 内以独立 Tab 呈现子代理会话（渲染与主会话同构，多实例并存）
function attachSubagentView(body, meta) {
  const sessionId = meta?.subagent?.sessionId;
  if (typeof sessionId !== "string" || sessionId === "") return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn subagent-view-btn";
  btn.textContent = "查看子会话过程";
  btn.addEventListener("click", async () => {
    const view = await sendQuery({ sessionId, op: "events" });
    if (!view.ok) {
      appendLine(`子会话查看失败：${view.error?.message ?? ""}`, "warn");
      return;
    }
    hooks.resetStreamView();
    hooks.renderHistory(view.result.events ?? []);
    appendLine(`── 子会话只读视图：${sessionId}（再点一次按钮刷新最新过程）──`, "warn");
    scrollBottom();
  });
  // H：面板形态（同构工作区——只读快照 + 运行中轮询刷新，pane.js 宿主）
  const paneBtn = document.createElement("button");
  paneBtn.type = "button";
  paneBtn.className = "btn subagent-view-btn";
  paneBtn.textContent = "在面板打开";
  paneBtn.title = "右侧切换面板内查看该子代理的完整过程（与主会话同构的多实例视图）";
  paneBtn.addEventListener("click", () => {
    void import("./pane.js").then((m) => m.openPane("subagent", { sessionId }));
  });
  body.append(btn, paneBtn);
}

/** 任务卡状态徽标翻转（结果结算——完成/失败两态，运行中只存在于调用未闭合时）。
 * G：失败原因悬浮——错误摘要挂 summary.title（折叠态 hover 即见原因，
 * zcode showFailureStatus 的 tooltip 语义；展开卡内仍有完整错误原文）。 */
function setToolStatus(card, isError, errorDigest, resultDigest) {
  const status = card.querySelector(".tool-status");
  if (status !== null) {
    status.className = `tool-status ${isError ? "fail" : "done"}`;
    status.textContent = isError ? "✗ 失败" : resultDigest !== undefined && resultDigest !== "" ? `✓ ${resultDigest}` : "✓ 完成";
  }
  const summary = card.querySelector("summary");
  if (summary !== null) {
    summary.title = isError && errorDigest !== undefined && errorDigest !== "" ? `失败原因：${errorDigest}` : "";
  }
}

function settleToolCard(e) {
  const content = e.message?.content ?? "";
  const isError = e.message?.isError === true;
  const existing = stream.querySelector(`details[data-call-id="${CSS.escape(e.callId)}"]`);
  if (existing !== null) {
    existing.classList.toggle("error", isError);
    // 反馈 3：结果摘要（✓ N 行——zcode「查询 · 2 搜索」语义；文本结果按行计量）
    const resultLines = content === "" ? 0 : content.split("\n").length;
    setToolStatus(
      existing,
      isError,
      isError ? oneLine(content, 120) : undefined,
      !isError && resultLines > 0 ? `${String(resultLines)} 行` : undefined,
    );
    const body = existing.querySelector(".tool-body");
    const denial = isError ? parseDenial(content) : null;
    if (denial !== null) {
      body.appendChild(denialEl(denial)); // C55 结构化拒绝面
    } else {
      const resultPre = document.createElement("pre");
      resultPre.className = `card-args ${isError ? "warn" : ""}`.trim();
      resultPre.textContent = content; // 工具结果原样（不渲染 markdown）
      body.appendChild(resultPre);
    }
    attachSubagentView(body, e.meta);
    return null; // 已并入 call 卡——不再追加节点
  }
  // 历史恢复/乱序兜底：result 单独成卡（callId 标注可追溯）
  const card = document.createElement("details");
  card.className = `tool-card result-only ${isError ? "error" : ""}`.trim();
  card.dataset.callId = e.callId;
  const summary = document.createElement("summary");
  summary.textContent = `${isError ? "✗" : "←"} ${oneLine(content, 160)}`;
  if (isError) summary.title = `失败原因：${oneLine(content, 200)}`;
  const body = document.createElement("div");
  body.className = "tool-body";
  const denial = isError ? parseDenial(content) : null;
  if (denial !== null) {
    body.appendChild(denialEl(denial));
  } else {
    const resultPre = document.createElement("pre");
    resultPre.className = `card-args ${isError ? "warn" : ""}`.trim();
    resultPre.textContent = content;
    body.appendChild(resultPre);
  }
  attachSubagentView(body, e.meta);
  card.append(summary, body);
  return card;
}

function attachRetry(el, error) {
  if (lastUserPrompt === "") return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "retry-btn";
  btn.textContent = `↻ 重试上一条（${error?.code ?? "error"}）`;
  btn.addEventListener("click", () => {
    btn.disabled = true;
    void sendRequest(sessionId(), {
      type: "prompt",
      messageId: allocRequestId("m"),
      content: lastUserPrompt,
    });
  });
  el.appendChild(document.createTextNode(" "));
  el.appendChild(btn);
}

// 反馈 3：思考时长回填游标（live 流——下一个事件到达时结算「持续了 N 秒」）
let lastThinking = null;

/** 事件 → DOM 节点（U4 分层版）；null = 不展示或已并入既有卡。 */
function renderEvent(e, options = {}) {
  switch (e.type) {
    case "turn/start":
      // T-P3-156：运行态广播（侧栏状态点 + 进度弹窗事件源）——仅 live 流
      // （历史恢复重放不发，renderHistory 不带 live 标志）。
      // 反馈 4：turn 边界行不再渲染（zcode 对标——聊天流只见内容不见回合噪声）
      if (options.live === true) {
        window.__agentBusy = true;
        notifyTurnStarted(e.turn);
        window.dispatchEvent(new CustomEvent("agent:busy"));
      }
      return null;
    case "turn/end": {
      // 反馈 4：正常结束不渲染；仅失败保留一行（错误原因+重试入口）
      if (e.reason?.kind !== "error") {
        return null; // 正常结束静默（idle 通知承担续跑/进度复位）
      }
      const el = lineEl(`✗ 轮以错误结束（${endKindText(e.reason)}）`, "meta error-line");
      attachRetry(el, e.reason.error); // 错误重试交互
      return el;
    }
    case "user/message": {
      // 用户输入不渲染（注入面防呆——textContent 原样，不走 markdown 管线）
      const el = document.createElement("div");
      el.className = `bubble user ${e.source === "injected" ? "dim" : ""}`.trim();
      // T-P3-146 A：模板调用 chip（原始调用原文——content 是展开后文本，
      // chip 展示用户所打；pi-desktop SlashExpansion 双字段同构）
      if (e.command !== undefined) {
        const chip = document.createElement("span");
        chip.className = "cmd-chip";
        chip.textContent = e.command;
        chip.title = `模板调用原文：${e.command}`;
        el.appendChild(chip);
      }
      const body = document.createElement("span");
      body.className = "bubble-body";
      body.textContent = e.message?.content ?? "";
      el.appendChild(body);
      if (e.source !== "injected") setLastUserPrompt(e.message?.content ?? "");
      appendMsgTime(el, e.ts); // T-P3-141：时间戳开关（设置外观段）
      return el;
    }
    case "assistant/message": {
      const bubble = document.createElement("div");
      bubble.className = `bubble agent ${e.interrupted ? "warn" : ""}`.trim();
      const content = e.message?.content ?? "";
      if (content === "") {
        // 反馈 3：思考行带时长（下一事件到达时回填「持续了 N 秒」——zcode
        // thinking 块时长语义；历史恢复无后续时差则只显示标记）
        const el = lineEl("🧠 思考", "agent thinking");
        lastThinking = { el, ts: Number(e.ts) || Date.now() };
        return el;
      }
      // 终态装饰（时间戳 + 朗读按钮）——流式期间 textContent/innerHTML 覆盖
      // 会清掉子元素，统一在 onDone 后挂载（顺修 T-P3-141 流式时间戳丢失）
      const decorate = () => {
        appendMsgTime(bubble, e.ts);
        const speakBtn = buildSpeakButton(content);
        if (speakBtn !== null) bubble.appendChild(speakBtn);
        bubble.appendChild(buildSaveRuleButton(content)); // T-P3-151 C1
      };
      if (options.live) {
        typeStream(bubble, e.message?.stream ?? [], content, decorate); // 流式打字节流
      } else {
        bubble.innerHTML = renderMarkdown(content); // 恢复视图直接终态
        decorate();
      }
      return bubble;
    }
    case "tool/call":
      // T-P3-156 U：进度弹窗的当前工具行（仅 live 流）
      if (options.live === true) {
        notifyToolCall(e.name ?? "tool", oneLine(JSON.stringify(e.args ?? {}), 60));
        notifyEventLine(`⚙ 调用工具 ${e.name ?? "tool"}`);
      }
      return buildToolCard(e);
    case "tool/result":
      return settleToolCard(e);
    case "compaction":
      return lineEl(`◇ 压缩：${e.reason ?? e.strategy ?? ""}`, "meta");
    case "image/offload":
      return lineEl(`◇ 图片卸载：${(e.targets ?? []).length} 组`, "meta");
    case "surface/attach":
    case "surface/detach":
      return null; // 反馈 4：端面连接事实不进聊天流（通知中心 surface_changed 仍可查）
    default:
      return null; // wire 细节类静默（request/header 等——repl 同款纪律）
  }
}

// —— 日期分隔（批 C 消息流）：事件 ts 的本地日分组——跨日插入分隔条；
// lastStreamDay 随流重建归零（resetStreamView 只读查看共用面）。

/** 时间戳 chip（T-P3-141 外观段"显示时间戳"）：设置关闭时不渲染（渲染期
 *  判定——恢复视图与 live 流一致）；流式气泡在正文后追加。 */
function appendMsgTime(bubble, ts) {
  if (settingsCache?.appearance?.showTimestamps !== true || ts === undefined) return;
  const time = document.createElement("span");
  time.className = "msg-time";
  time.textContent = new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  bubble.appendChild(time);
}
function dayKey(ts) {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// —— T-P3-149 D 消息朗读（agentscope/pi-desktop 语音输出消费端）：
// 气泡终态挂 🔊 按钮 → op tts-synthesize → Blob URL 播放；单实例播放
// （新播放抢占旧播放——agentscope stopAllPlayback 语义），音频不落盘。

let speakAudio = null;
let speakBtnActive = null;

/** markdown 源 → 朗读友好纯文本（代码块/链接/标记符号不进语音）。 */
function stripMarkdownForSpeech(md) {
  return md
    .replace(/```[\s\S]*?```/g, "（代码省略）")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__|~~)/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .trim();
}

function stopSpeaking() {
  if (speakAudio !== null) {
    speakAudio.pause();
    URL.revokeObjectURL(speakAudio.src);
    speakAudio = null;
  }
  if (speakBtnActive !== null) {
    speakBtnActive.textContent = "🔊";
    speakBtnActive.classList.remove("speaking");
    speakBtnActive = null;
  }
}

function buildSpeakButton(content) {
  if (settingsCache?.tts === undefined) return null; // 未配置不渲染（入口隐藏语义）
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "speak-btn";
  btn.title = "朗读这条回复（TTS）";
  btn.textContent = "🔊";
  btn.addEventListener("click", () => void toggleSpeak(btn, content));
  return btn;
}

// —— T-P3-151 C1 会话一键沉淀规矩（Cline /newrule 先例——"把刚才的纠正
// 存为规则"是刚需入口；gemini #26950 append 策略——只追加不覆盖）：

function buildSaveRuleButton(content) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "speak-btn";
  btn.title = "存为规矩（追加到指令文件）";
  btn.textContent = "📌";
  btn.addEventListener("click", () => void openSaveRuleDialog(content));
  return btn;
}

async function openSaveRuleDialog(content) {
  const { confirmDialog } = await import("./views/settings/core.js");
  const defaultText = `## 规矩（来自会话 ${new Date().toISOString().slice(0, 10)}）\n\n${content.trim()}`;
  const draft = window.prompt("编辑要沉淀为规矩的内容（将原样追加到所选文件末尾）：", defaultText.slice(0, 4000));
  if (draft === null || draft.trim() === "") return;
  const target = window.prompt(
    "追加到哪一层？输入序号：\n1 = 项目 AGENTS.md（<workspace>/AGENTS.md）\n2 = 全局 AGENTS.md（~/.aegent/AGENTS.md）\n3 = 记忆索引（~/.aegent/memory/MEMORY.md）",
    "1",
  );
  if (target === null) return;
  const targets = { "1": "project-agents", "2": "global-agents", "3": "memory" };
  const selected = targets[target];
  if (selected === undefined) {
    toast("已取消（无效序号）", "warn");
    return;
  }
  const ok = await confirmDialog(
    `将以下内容追加到「${selected === "project-agents" ? "项目 AGENTS.md" : selected === "global-agents" ? "全局 AGENTS.md" : "记忆索引 MEMORY.md"}」末尾（新会话生效）：\n\n${draft.slice(0, 400)}`,
    { title: "存为规矩", confirmLabel: "追加写入" },
  );
  if (!ok) return;
  const envelope = await sendSettings({ op: "instruction-append", target: selected, kind: "text", content: draft });
  if (!envelope.ok) {
    toast(`写入失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  toast("已存为规矩（新会话生效）", "info");
}

async function toggleSpeak(btn, content) {
  if (speakBtnActive === btn) {
    stopSpeaking(); // 播放中再点 = 停止
    return;
  }
  stopSpeaking(); // 单实例——新播放抢占旧播放
  // 合成文本上限 4000 字符（tts.ts TTS_TEXT_TOO_LONG 同源截断）
  const text = stripMarkdownForSpeech(content).slice(0, 4000);
  if (text === "") return;
  btn.disabled = true;
  try {
    const envelope = await sendSettings({ op: "tts-synthesize", text });
    if (!envelope.ok) {
      const err = envelope.error ?? {};
      toast(`朗读失败：${err.code ?? ""} ${err.message ?? ""}`, "warn");
      return;
    }
    const binary = atob(envelope.result.audioBase64 ?? "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: envelope.result.mediaType ?? "audio/mpeg" }));
    const audio = new Audio(url);
    speakAudio = audio;
    speakBtnActive = btn;
    btn.textContent = "⏹";
    btn.classList.add("speaking");
    audio.addEventListener("ended", () => {
      if (speakAudio === audio) stopSpeaking();
    });
    audio.addEventListener("error", () => {
      if (speakAudio === audio) stopSpeaking();
    });
    void audio.play().catch(() => stopSpeaking());
  } catch (e) {
    toast(`朗读失败：${e instanceof Error ? e.message : String(e)}`, "warn");
  } finally {
    btn.disabled = false;
  }
}

function fmtDateLabel(ts) {
  const d = new Date(ts);
  const now = Date.now();
  const key = dayKey(ts);
  if (key === dayKey(now)) return "今天";
  if (key === dayKey(now - 86_400_000)) return "昨天";
  const year = d.getFullYear() === new Date().getFullYear() ? "" : `${d.getFullYear()}年`;
  return `${year}${d.getMonth() + 1}月${d.getDate()}日`;
}

function dateSepEl(ts) {
  const div = document.createElement("div");
  div.className = "date-sep";
  div.textContent = fmtDateLabel(ts);
  return div;
}

let lastStreamDay = null;

/** 流追加统一入口：先按事件 ts 补日期分隔条，再挂节点（null 守卫在调用侧）。 */
function appendStreamNode(node, e) {
  const key = dayKey(e?.ts);
  if (key !== null && key !== lastStreamDay) {
    lastStreamDay = key;
    stream.appendChild(dateSepEl(e.ts));
  }
  stream.appendChild(node);
}

// —— T-P3-156 G：只读工具聚合（codex Exploring 卡语义）——turn 结束后把
// 该轮内**连续**只读卡（read/grep/glob/ls 类）包进一张「已探索 N 项」聚合
// 卡（点击展开原卡列表——DOM move 保留展开态/结果，不重建节点）。
const READONLY_TOOL_NAMES = new Set([
  "read", "read_file", "readfile", "grep", "glob", "ls", "list", "search",
  "files-list", "code-search", "web-search", "webfetch", "fetch",
]);

function isCollapsedReadonlyRun(node) {
  // 聚合卡自身也按只读延续计——连续运行允许跨聚合（read→聚合→read）
  return node.classList?.contains("readonly-collapsed");
}

function maybeCollapseReadonly() {
  const MIN_RUN = 3;
  // 从流尾向前找最近的 turn/end meta 行 → 上一 turn/start 行 = 本轮区间
  const nodes = [...stream.children];
  let endIdx = -1;
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i].textContent?.startsWith("── turn") && nodes[i].textContent.includes("结束")) {
      endIdx = i;
      break;
    }
  }
  if (endIdx < 0) return;
  let startIdx = 0;
  for (let i = endIdx - 1; i >= 0; i--) {
    if (nodes[i].textContent?.includes("开始")) {
      startIdx = i + 1;
      break;
    }
  }
  // 区间内收集连续只读卡（跳过用户气泡/meta 行；聚合卡延续连续性）
  const run = [];
  for (let i = startIdx; i < endIdx; i++) {
    const node = nodes[i];
    if (node.classList?.contains("tool-card") === true) {
      const name = node.querySelector(".tool-name")?.textContent.replace("⚙ ", "") ?? "";
      const done = node.querySelector(".tool-status.done") !== null;
      const failed = node.classList.contains("error") || node.querySelector(".tool-status.fail") !== null;
      const isSubagent = node.querySelector(".subagent-view-btn") !== null; // task 卡不聚合
      if (done && !failed && !isSubagent && (READONLY_TOOL_NAMES.has(name.toLowerCase()) || isCollapsedReadonlyRun(node))) {
        run.push(node);
        continue;
      }
      if (run.length < MIN_RUN) run.length = 0; // 断续不聚（保序重置）
      else break;
      continue;
    }
    if (node.classList?.contains("bubble") === true || node.classList?.contains("meta-line") === true) continue;
    break; // 其它结构（pending/composer 浮层等）截断
  }
  if (run.length < MIN_RUN) return;
  const wrapper = document.createElement("details");
  wrapper.className = "tool-card readonly-collapsed";
  const summary = document.createElement("summary");
  summary.innerHTML = `<span class="tool-name">⚙ 已探索 ${String(run.length)} 项</span><span class="tool-status done">✓ 完成</span>`;
  wrapper.appendChild(summary);
  const body = document.createElement("div");
  body.className = "tool-body readonly-run-body";
  for (const card of run) body.appendChild(card); // DOM move——节点状态全保留
  wrapper.appendChild(body);
  run[0].before(wrapper);
  maybeCollapseReadonly(); // 递归——区间内更早的连续段继续聚合
}

function renderEventEnvelope(envelope) {
  // 反馈 3：思考时长结算（上一事件是 thinking 且非同一 ts——秒差回填）
  if (lastThinking !== null) {
    const ts = Number(envelope.event?.ts);
    if (Number.isFinite(ts) && ts > lastThinking.ts) {
      const sec = Math.round((ts - lastThinking.ts) / 1000);
      const dur = document.createElement("span");
      dur.className = "think-dur";
      dur.textContent = ` · 持续了 ${String(sec)} 秒`;
      lastThinking.el.appendChild(dur);
    }
    lastThinking = null;
  }
  const node = renderEvent(envelope.event, { live: true });
  if (node !== null) {
    appendStreamNode(node, envelope.event);
    if (envelope.event.type === "turn/end") maybeCollapseReadonly(); // G：只读聚合
    scrollBottom();
    syncChatEmpty(); // 首个可见事件到达 = 欢迎卡让位
  }
  minimapRegister(node, envelope.event); // 小地图登记（含 null 守卫）
}

/** 恢复视图：历史事件一次性渲染（query 快照；此后走 event 流续播）。 */
function renderHistory(events) {
  for (const e of events) {
    const node = renderEvent(e);
    if (node !== null) appendStreamNode(node, e);
    if (e.type === "turn/end") maybeCollapseReadonly(); // G：重放路径同聚合
    minimapRegister(node, e);
  }
  if (events.length > 0) appendLine(`── 已恢复 ${events.length} 条历史事件 ──`, "meta");
  scrollBottom();
  showRecoveryIfInterrupted(events); // U13：M3 启动恢复可视化（流尾未闭合轮）
  syncChatEmpty(); // 批 C：首屏空状态（历史为空 = 欢迎卡）
}

// T-P3-156 Q：聊天流链接点击 → 浏览器面板打开（agent 产出 URL 的意图
// 路由——zcode useAppPanels handleOpenBrowserUrl 同构；Ctrl/Cmd 点击仍走
// 系统行为由浏览器默认接管）
stream.addEventListener("click", (ev) => {
  const anchor = ev.target instanceof Element ? ev.target.closest("a[href]") : null;
  if (anchor === null) return;
  const href = anchor.getAttribute("href") ?? "";
  if (!/^https?:\/\//i.test(href)) return;
  if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
  ev.preventDefault();
  void openBrowserPane(href, href.replace(/^https?:\/\//, "").slice(0, 30));
});

// 代码块复制按钮（U4：事件委托——动态内容免逐个绑）
stream.addEventListener("click", (ev) => {
  const btn = ev.target instanceof Element ? ev.target.closest(".code-copy") : null;
  if (btn === null) return;
  const code = btn.parentElement?.querySelector("code");
  const text = code?.textContent ?? "";
  navigator.clipboard
    ?.writeText(text)
    .then(() => {
      btn.textContent = "已复制";
      setTimeout(() => {
        btn.textContent = "复制";
      }, 1500);
    })
    .catch(() => {
      btn.textContent = "复制失败";
    });
});

function safeParseArgs(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 审批 / 提问卡（notification 面驱动——"任何通道可答"）
// ---------------------------------------------------------------------------

function removeCard(requestId) {
  const card = pending.querySelector(`[data-request-id="${CSS.escape(requestId)}"]`);
  if (card !== null) card.remove();
  if (pending.children.length === 0) {
    pending.classList.remove("active");
    // T-P3-156：待决清空 → 侧栏状态点复位（审批橙点）
    window.dispatchEvent(new CustomEvent("agent:awaiting-clear"));
  }
}

// —— T-P3-151 B4 审批反写：永久档把本次裁决沉淀为规则行（opencode 免写
// 通配符先例——命令前缀自动推导；gemini 收件箱 diff 确认先例——写入前确认）。

/** 从审批载荷推导规则行：命令类取前 2 个 token 加 ` *`，其余裸工具规则。 */
function deriveRuleLine(payload) {
  const tool = typeof payload.tool === "string" && payload.tool.trim() !== "" ? payload.tool.trim() : "Bash";
  const args = payload.args !== null && typeof payload.args === "object" ? payload.args : undefined;
  const command = typeof args?.command === "string" ? args.command.trim() : "";
  if (command !== "") {
    const prefix = command.split(/\s+/).slice(0, 2).join(" ");
    return `${tool}(${prefix} *)`;
  }
  return tool; // 裸工具规则——放行/禁止该工具全部调用
}

async function persistApprovalRule(payload, action) {
  const { confirmDialog } = await import("./views/settings/core.js");
  const rule = deriveRuleLine(payload);
  const ok = await confirmDialog(
    `将把本次裁决沉淀为规则行，写入 ~/.aegent/rules.txt（用户层——所有工作区生效）：\n${rule} -> ${action}\n\n规则对后续所有会话生效（设置→指令中心可复核）。`,
    { title: action === "allow" ? "永久允许并写入规则" : "永久拒绝并写入规则", confirmLabel: "写入规则" },
  );
  if (!ok) return;
  const envelope = await sendSettings({
    op: "instruction-append",
    target: "user-rules",
    kind: "rule",
    content: `${rule} -> ${action}`,
    dryRun: false,
  });
  if (!envelope.ok) {
    toast(`规则写入失败：${envelope.error?.message ?? ""}（本次${action === "allow" ? "放行" : "拒绝"}不受影响）`, "warn");
    return;
  }
  toast(`规则已沉淀：${envelope.result.line}`, "info");
}

function buildCard(name, payload) {
  pending.classList.add("active");
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.requestId = payload.requestId;
  const title = document.createElement("div");
  title.className = "card-title";
  if (name === "approval_requested") {
    title.textContent = `审批请求：${payload.tool}`;
    // C54 审批来源分类 chip + 超时倒计时（审批卡优化——U4/T-P3-107）
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = String(payload.category ?? "tool");
    title.appendChild(chip);
    // T-P3-140 批次 E：沙箱升级徽标（升级目标一眼可见——fail-closed 审批面；
    // escalation 值自带 "sandbox → X" 形状，剥前缀避免与中文标签重复）
    const escArgs = payload.args && typeof payload.args === "object" ? payload.args : undefined;
    if (typeof escArgs?.escalation === "string") {
      const escChip = document.createElement("span");
      escChip.className = "chip chip-warn";
      escChip.textContent = `沙箱升级 ${escArgs.escalation.replace(/^sandbox\s*→\s*/, "→ ")}`;
      title.appendChild(escChip);
    }
    const countdown = document.createElement("span");
    countdown.className = "countdown";
    title.appendChild(countdown);
    const deadline = Date.now() + (Number(payload.timeoutMs) || 0);
    const timer = setInterval(() => {
      if (!countdown.isConnected) {
        clearInterval(timer);
        return;
      }
      countdown.textContent = `${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s`;
    }, 1000);
    // T-P3-140 批次 E：升级理由独立展示行（审批人先读理由再看参数）
    if (typeof escArgs?.justification === "string" && escArgs.justification !== "") {
      const justification = document.createElement("div");
      justification.className = "card-justification";
      justification.textContent = `理由：${escArgs.justification}`;
      card.appendChild(justification);
    }
    const args = document.createElement("pre");
    args.className = "card-args";
    args.textContent = JSON.stringify(payload.args, null, 2);
    card.append(title, args);
    // T-P3-137 八轮 B（用户裁决"不止外观，功能也要一样"——参考 opencode/
    // pi-desktop 审批三选）：allow 带 scope（once=允许一次 / session=本会话
    // 内同类调用不再问——C22 session-runtime 作用域，子进程 approvalCache 记账）
    // T-P3-151 B4：永久档=审批之外再反写规则行到 rules.txt（指令中心可复核）
    const actions = [
      { label: "允许一次", action: "allow", scope: "once", className: "allow" },
      { label: "本会话内允许", action: "allow", scope: "session", className: "allow allow-session" },
      { label: "拒绝", action: "deny", scope: undefined, className: "deny" },
      { label: "永久允许", action: "allow", scope: "always", className: "allow allow-always" },
      { label: "永久拒绝", action: "deny", scope: "always", className: "deny" },
    ];
    for (const { label, action, scope, className } of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.className = className;
      btn.addEventListener("click", async () => {
        if (scope === "always") {
          await persistApprovalRule(payload, action);
        }
        await sendRequest(sessionId(), {
          type: "approve",
          requestId: payload.requestId,
          action,
          ...(scope !== undefined && scope !== "always" ? { scope } : {}),
          source: SURFACE_KIND,
        });
        removeCard(payload.requestId);
      });
      card.appendChild(btn);
    }
  } else if (name === "question_asked") {
    title.textContent = `模型提问`;
    const q = document.createElement("pre");
    q.className = "card-args";
    q.textContent = payload.question ?? "";
    card.append(title, q);
    const answerInput = document.createElement("input");
    answerInput.type = "text";
    answerInput.placeholder = "输入答复（空 = 跳过）";
    const answerBtn = document.createElement("button");
    answerBtn.type = "button";
    answerBtn.textContent = "答复";
    answerBtn.className = "allow";
    answerBtn.addEventListener("click", async () => {
      await sendRequest(sessionId(), {
        type: "question/answer",
        requestId: payload.requestId,
        answer: answerInput.value,
      });
      removeCard(payload.requestId);
    });
    card.append(answerInput, answerBtn);
    answerInput.focus();
  }
  pending.appendChild(card);
}

// ---------------------------------------------------------------------------
// U10/T-P3-109 Composer 升级：多行编辑（Shift+Enter 换行）+ 两类补全
// （@ workspace 清单 / 命令+工具+技能）+ 粘贴图片入 P1 附件链。
// ---------------------------------------------------------------------------

// 多行输入的自动增高（上限 8 行——再长出滚动）
function autoGrow() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 8 * 22)}px`;
}
input.addEventListener("input", autoGrow);

// —— 粘贴图片/音频（clipboard → P1 附件链 attachments；限额与
// attachments/limits.ts 同源：10MB/件、8 件/消息；T-P3-149 E1 起音频三类
// 入册——原样入库，wav/mp3 可直读进 input_audio，webm/mp4 仅转写链可用）
const MAX_ATTACHMENT_BYTES = 10_000_000;
const MAX_ATTACHMENTS_PER_MESSAGE = 8;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const AUDIO_TYPES = new Set(["audio/mp4", "audio/wav", "audio/webm"]);
const pendingAttachments = [];
const attachmentsPreview = document.getElementById("attachments-preview");

function renderAttachmentsPreview() {
  attachmentsPreview.replaceChildren();
  for (const [i, a] of pendingAttachments.entries()) {
    const chip = document.createElement("span");
    chip.className = "attachment-chip";
    const isAudio = AUDIO_TYPES.has(a.mediaType);
    const isText = a.mediaType === "text/plain";
    const icon = isAudio ? "🎵" : isText ? "📝" : "🖼";
    const label = document.createElement("span");
    if (!isAudio && !isText) {
      // N：图片能力提示（降级版——host 模型元数据无 image capabilities 面，
      // P2 接线后此处换 isImageCapable 判定+警示标）
      label.title = "图片需当前模型可识别（多模态）——若发送后报不支持图片错误，请切换模型或改用文件路径引用";
    }
    label.textContent = `${icon} ${a.name ?? (isAudio ? "audio" : isText ? "pasted-text" : "image")}（${Math.ceil((a.data.length * 3) / 4 / 1024)}KB）`;
    // T-P3-156 M：文本 chip 点击查看原文（解码 base64 模态呈现——粘贴
    // 大文本转附件后原文不丢可达）
    if (isText) {
      label.style.cursor = "pointer";
      label.title = "点击查看原文";
      label.addEventListener("click", () => {
        void (async () => {
          const text = atob(a.data ?? "");
          const pre = document.createElement("pre");
          pre.className = "card-args";
          pre.style.maxHeight = "50vh";
          pre.style.overflow = "auto";
          pre.textContent = text;
          const { openDialog } = await import("./views/settings/core.js");
          openDialog({
            title: `附件原文：${a.name ?? "pasted-text"}`,
            body: pre,
            width: "lg",
            actions: [{ label: "恢复为文本", className: "btn btn-primary", onClick: () => true }],
          }).then((picked) => {
            if (picked === true) {
              // 恢复：文本回输入框+chip 移除（M 完整语义——转附件可逆）
              const existing = input.value.trim();
              input.value = existing === "" ? text : `${text}

${existing}`;
              input.dispatchEvent(new Event("input"));
              const idx = pendingAttachments.indexOf(a);
              if (idx >= 0) {
                pendingAttachments.splice(idx, 1);
                renderAttachmentsPreview();
              }
            }
          });
        })();
      });
    }
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "×";
    del.addEventListener("click", () => {
      pendingAttachments.splice(i, 1);
      renderAttachmentsPreview();
    });
    chip.append(label, del);
    attachmentsPreview.appendChild(chip);
  }
}

function addAttachment(file) {
  const isAudio = AUDIO_TYPES.has(file.type);
  const isText = file.type === "text/plain";
  if (!IMAGE_TYPES.has(file.type) && !isAudio && !isText) {
    appendLine(`不支持的附件类型：${file.type}（白名单：png/jpeg/gif/webp + wav/mp4/webm 音频 + text/plain 大文本粘贴）`, "warn");
    return;
  }
  if (pendingAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
    appendLine(`附件数量已达上限（${MAX_ATTACHMENTS_PER_MESSAGE}/消息）`, "warn");
    return;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    appendLine(`附件超过单件上限（${Math.ceil(MAX_ATTACHMENT_BYTES / 1e6)}MB）`, "warn");
    return;
  }
  if (isAudio && file.type !== "audio/wav") {
    appendLine(`音频附件 ${file.type} 不支持模型直读（仅录音转写链可用）；wav 格式可直接发给音频模型`, "warn");
  }
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const result = String(reader.result ?? "");
    const base64 = result.includes(",") ? result.slice(result.indexOf(",") + 1) : result;
    pendingAttachments.push({ mediaType: file.type, data: base64, name: file.name || (isAudio ? "audio" : isText ? "pasted-text" : "pasted-image") });
    renderAttachmentsPreview();
  });
  reader.readAsDataURL(file);
}

input.addEventListener("paste", (ev) => {
  for (const item of ev.clipboardData?.items ?? []) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file !== null && (IMAGE_TYPES.has(file.type) || AUDIO_TYPES.has(file.type))) {
        ev.preventDefault(); // 图片/音频不进文本——入附件链
        addAttachment(file);
      }
    }
  }
});

// T-P3-156 M：大文本粘贴自动转附件（裁决阈值 = >8KB 或 >400 行任一）——
// chip 命名 pasted-<HHMMSS>.txt，点击弹窗查看原文（方案 M 完整语义）；
// 阈值内行为不变（直接进输入框）。
input.addEventListener("paste", (ev) => {
  const text = ev.clipboardData?.getData("text/plain") ?? "";
  if (text === "") return;
  const overBytes = new Blob([text]).size > 8 * 1024;
  const overLines = text.split("\n").length > 400;
  if (!overBytes && !overLines) return;
  ev.preventDefault();
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const name = `pasted-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.txt`;
  const file = new File([text], name, { type: "text/plain" });
  addAttachment(file);
  toast(`粘贴内容过大（${overBytes ? ">8KB" : ">400 行"}）——已转为附件「${name}」（点 chip 可查看原文）`, "info");
});

// —— 两类补全（@ 文件/目录——query op:"files"；/ 命令+工具+技能——
// query op:"meta" 的 ready 清单 + UI 本地命令集）
const autocomplete = document.getElementById("autocomplete");
const UI_COMMANDS = [
  { label: "/cancel", hint: "取消当前轮" },
  { label: "/find", hint: "会话内搜索（Ctrl+F）" },
  { label: "/search", hint: "跨会话搜索" },
  { label: "/history", hint: "会话历史" },
  { label: "/settings", hint: "设置中心" },
  { label: "/help", hint: "列出可用命令" },
];

// —— U16/T-P3-118→T-P3-146：提示词模板的 / 补全数据面（op:"prompts-list"
// 文件域清单——设置页保存后 markPromptsLoaded(false) 失效，下次补全重取）
async function ensurePromptsCache() {
  if (promptsCacheLoaded) return promptsViewCache;
  const envelope = await sendSettings({ op: "prompts-list" });
  if (envelope.ok) {
    promptsViewCache = envelope.result;
    markPromptsLoaded();
  }
  return promptsViewCache;
}
let promptsViewCache = null;

// —— T-P3-146 F：模糊评分（zcode 三档——前缀 > 子串 > 子序列；description
// 命中加权，稳定排序）。
function fuzzyScore(label, description, query) {
  if (query === "") return 100;
  const l = label.toLowerCase();
  const q = query.toLowerCase();
  let score = 0;
  if (l.startsWith(q)) score = 300 - Math.min(l.length - q.length, 50);
  else if (l.includes(q)) score = 200 - Math.min(l.indexOf(q), 50);
  else {
    // 子序列匹配（顺序命中即可——fuzzy 最低档）
    let i = 0;
    for (const ch of l) {
      if (ch === q[i]) i++;
      if (i >= q.length) break;
    }
    if (i >= q.length) score = 100 - Math.min(l.length, 50);
    else return -1;
  }
  if (description !== undefined && description !== null && String(description).toLowerCase().includes(q)) score += 50;
  return score;
}

function templateVarNames(content) {
  return [...new Set([...content.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)].map((m) => m[1]))];
}
let acItems = [];
let acIndex = -1;
let acContext = null; // { trigger, startPos, token }

function detectTrigger() {
  const cursor = input.selectionStart ?? 0;
  const text = input.value.slice(0, cursor);
  // T-P3-146 F：/ 触发收紧为草稿首字符（pi ADR 0024/zcode 同款——句中斜杠
  // 不再误触 URL/路径；模板调用统一"/name args"整条语义）
  const slash = text.match(/^(\/[^\s]*)$/);
  if (slash !== null) {
    return { trigger: "/", startPos: cursor - slash[1].length, token: slash[1] };
  }
  const at = text.match(/(^|\s)(@[^\s]*)$/);
  if (at !== null) {
    return { trigger: "@", startPos: cursor - at[2].length, token: at[2] };
  }
  return null;
}

// —— T-P3-146 F：中文 IME 适配（pi ADR 0231——空草稿首字符"、"自动重写为
// "/"打开命令菜单；组合输入期不干预）
input.addEventListener("compositionend", () => {
  if (input.value === "、" || input.value === "。") {
    input.value = "/";
    input.setSelectionRange(1, 1);
    void updateAutocomplete();
  }
});

function renderAutocomplete() {
  autocomplete.replaceChildren();
  // T-P3-146 F：分组渲染（命令/工具/技能/模板/MCP——zcode 分段面板同款；
  // 组头行不可选，键盘导航跳过）
  const GROUPS = [
    ["command", "命令"],
    ["tool", "工具"],
    ["skill", "技能"],
    ["prompt", "模板"],
    ["mcp-prompt", "MCP"],
  ];
  let lastGroup = null;
  for (const [i, item] of acItems.entries()) {
    if (item.kind !== undefined && GROUPS.some(([g]) => g === item.kind) && item.kind !== lastGroup) {
      lastGroup = item.kind;
      const head = document.createElement("div");
      head.className = "ac-group";
      head.textContent = GROUPS.find(([g]) => g === item.kind)?.[1] ?? "";
      autocomplete.appendChild(head);
    }
    const row = document.createElement("div");
    row.className = `ac-row ${i === acIndex ? "active" : ""}`.trim();
    const label = document.createElement("span");
    label.textContent = `${item.icon} ${item.label}`;
    const hint = document.createElement("span");
    hint.className = "ac-hint";
    // argument-hint 行内展示（有参模板的面板提示——pi/zcode 同款）
    hint.textContent = item.kind === "prompt" && item.argumentHint ? item.argumentHint : (item.hint ?? "");
    row.append(label, hint);
    row.addEventListener("mousedown", (ev) => {
      ev.preventDefault(); // 防 textarea 失焦
      applyCompletion(item);
    });
    autocomplete.appendChild(row);
  }
  autocomplete.hidden = acItems.length === 0;
}

function applyCompletion(item) {
  if (acContext === null) return;
  const before = input.value.slice(0, acContext.startPos);
  const after = input.value.slice(input.selectionStart ?? 0);
  // T-P3-146 A：选中行为分型——有参模板（argumentHint 或正文含 $ 占位）插入
  // "/name " 等用户续打参数（发送时展开）；无参模板整段正文替换（{{var}}
  // 占位保留手改——既有插入流不变）；MCP 模板一律 "/server:prompt "。
  let insert;
  if (item.kind === "dir") insert = item.label;
  else if (item.kind === "prompt") {
    const hasArgs = (item.hints?.length ?? 0) > 0 || (item.argumentHint ?? "") !== "";
    insert = hasArgs ? `/${item.label} ` : (item.content ?? "");
  } else if (item.kind === "mcp-prompt") {
    insert = `/${item.label} `;
  } else insert = `${item.label} `;
  input.value = `${before}${insert}${after}`;
  const pos = (before + insert).length;
  input.setSelectionRange(pos, pos);
  input.focus();
  if (item.kind === "prompt" && (item.vars?.length ?? 0) > 0) {
    toast(`模板含变量 ${item.vars.join("、")}——占位符已保留，请手改`, "info");
  }
  acItems = [];
  acContext = null;
  renderAutocomplete();
  autoGrow();
}

async function updateAutocomplete() {
  const ctx = detectTrigger();
  acContext = ctx;
  if (ctx === null) {
    acItems = [];
    renderAutocomplete();
    return;
  }
  const tokenBody = ctx.token.slice(1).toLowerCase();
  if (ctx.trigger === "@") {
    const files = (await ensureFileCache(sessionId())) ?? { entries: [], truncated: false };
    const hits = files.entries
      .filter((e) => e.path.toLowerCase().includes(tokenBody))
      .slice(0, 8)
      .map((e) => ({ icon: e.dir ? "📁" : "📄", label: e.path, hint: "workspace", kind: e.dir ? "dir" : "file" }));
    acItems = hits;
    if (files.truncated === true) {
      acItems = [
        ...hits,
        { icon: "…", label: "", hint: "清单已截断（可继续输入缩小）", kind: "info" },
      ];
    }
  } else {
    const meta = (await ensureMetaCache(sessionId())) ?? { tools: [], skills: [], prompts: [] };
    const view = await ensurePromptsCache();
    const filePrompts = (view?.prompts ?? []).filter((p) => p.disabled !== true);
    const mcpPrompts = (meta.prompts ?? []).filter((p) => p.source === "mcp");
    const promptPlaceholders = (t) =>
      [...new Set([...t.matchAll(/\$(?:ARGUMENTS|[0-9]+|@|\{@:\d+(?::\d+)?\}|\{@\})/g)].map((m) => m[0]))];
    const candidates = [
      ...UI_COMMANDS.map((c) => ({ icon: "⌘", label: c.label, hint: c.hint, kind: "command" })),
      ...meta.tools.map((t) => ({ icon: "🛠", label: t, hint: "工具", kind: "tool" })),
      ...meta.skills.map((s) => ({ icon: "✨", label: s.name, hint: s.description, kind: "skill" })),
      ...filePrompts.map((p) => ({
        icon: "📝",
        label: p.name,
        hint: p.description ?? "提示词模板",
        argumentHint: p.argumentHint ?? "",
        kind: "prompt",
        content: p.content,
        vars: templateVarNames(p.content),
        hints: promptPlaceholders(p.content),
      })),
      ...mcpPrompts.map((p) => ({
        icon: "🌐",
        label: p.name,
        hint: p.description ?? "MCP prompt",
        kind: "mcp-prompt",
      })),
    ];
    // T-P3-146 F：模糊三档评分 + 组内排序（组头连续性——按组序优先、组内按分）
    const GROUP_ORDER = ["command", "tool", "skill", "prompt", "mcp-prompt"];
    const scored = candidates
      .map((c) => ({ c, s: fuzzyScore(c.label, c.hint, tokenBody), g: GROUP_ORDER.indexOf(c.kind) }))
      .filter((x) => x.s >= 0 && x.g >= 0)
      .sort((a, b) => (a.g - b.g) || (b.s - a.s));
    acItems = scored.slice(0, 10).map((x) => x.c);
    let best = -1;
    let bestScore = -1;
    for (const [i, x] of scored.slice(0, 10).entries()) {
      if (x.s > bestScore) {
        bestScore = x.s;
        best = i;
      }
    }
    acIndex = best;
    renderAutocomplete();
    return;
  }
  acIndex = acItems.length > 0 ? 0 : -1;
  renderAutocomplete();
}

function executeCommand(label) {
  switch (label) {
    case "/cancel":
      void sendRequest(sessionId(), { type: "cancel" });
      appendLine("已请求取消当前轮", "meta");
      break;
    case "/find":
      openFind();
      break;
    case "/search":
      go("search");
      break;
    case "/history":
      openHistory();
      break;
    case "/settings":
      openSettings();
      break;
    case "/help":
      appendLine(`可用命令：${UI_COMMANDS.map((c) => c.label).join("、")}（另有 🛠 工具 / ✨ 技能名称提及——选中即入输入框）`, "meta");
      break;
    default:
      break;
  }
}

// —— 提交：多行（Shift+Enter 换行）/ 斜杠命令拦截 / 未知命令本地拦截
// （T-P3-146 E——codex/kimi 语义：/ 开头的命令形 token 若不是已知命令，
// 本地报错不进模型；去掉斜杠或补建模板后可发）
async function submitPrompt() {
  const content = input.value.trim();
  if (content === "") return;
  const slash = content.match(/^\/([a-z0-9][a-z0-9_:/-]*)$/i) ?? content.match(/^\/([a-z0-9][a-z0-9_:/-]*)[\s\n]/i);
  if (slash !== null) {
    const name = slash[1] ?? "";
    const meta = (await ensureMetaCache(sessionId())) ?? { tools: [], skills: [], prompts: [] };
    const view = await ensurePromptsCache();
    const known =
      UI_COMMANDS.some((c) => c.label === `/${name}`) ||
      meta.tools.includes(name) ||
      meta.skills.some((s) => s.name === name) ||
      (meta.prompts ?? []).some((p) => p.name.toLowerCase() === name.toLowerCase()) ||
      (view?.prompts ?? []).some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!known) {
      toast(`未知命令 /${name}——不是已知命令、模板或工具（去掉斜杠可按普通文本发送）`, "warn");
      return;
    }
  }
  setLastUserPrompt(content);
  input.value = "";
  autoGrow();
  const attachments = pendingAttachments.splice(0, pendingAttachments.length);
  renderAttachmentsPreview();
  // T-P3-156 K：内核忙时 prompt 自动入队（queue.ts enqueue 返 accepted）——
  // UI 侧记录排队投影（等待中条）；idle/prompt_returned 时清零
  if (window.__agentBusy === true) notifyQueued(content);
  void sendRequest(sessionId(), {
    type: "prompt",
    messageId: allocRequestId("m"),
    content,
    ...(attachments.length > 0 ? { attachments } : {}),
  });
}

sendBtn.addEventListener("click", submitPrompt);
input.addEventListener("keydown", (ev) => {
  if (autocomplete.hidden === false && acItems.length > 0) {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      acIndex = (acIndex + 1) % acItems.length;
      renderAutocomplete();
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      acIndex = (acIndex - 1 + acItems.length) % acItems.length;
      renderAutocomplete();
      return;
    }
    if (ev.key === "Enter" || ev.key === "Tab") {
      const item = acItems[acIndex];
      if (item !== undefined && item.kind !== "info") {
        ev.preventDefault();
        // 命令选中 = 直接收尾；Enter 二次提交执行（AC 面关闭）
        applyCompletion(item);
        return;
      }
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      acItems = [];
      acContext = null;
      renderAutocomplete();
      return;
    }
  }
  // 命令提交：Enter 时若输入是完整 UI 命令则本地执行（不发 prompt）
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    const trimmed = input.value.trim();
    if (UI_COMMANDS.some((c) => c.label === trimmed)) {
      input.value = "";
      autoGrow();
      executeCommand(trimmed);
      return;
    }
    submitPrompt();
  }
  // Shift+Enter = textarea 原生换行；输入变化经 input 监听刷新补全
});
// —— T-P3-150 C7 添加到聊天：项目页文件树 → mention 注入输入框（zcode
//    CustomEvent 协议同构面——跨视图唯一通道，插入不自动发送）
window.addEventListener("projects:add-to-chat", (ev) => {
  const mention = ev.detail?.mention;
  if (typeof mention !== "string" || mention === "") return;
  const existing = input.value;
  input.value = existing === "" ? `${mention} ` : `${existing.replace(/\s+$/, "")} ${mention} `;
  autoGrow();
  input.focus();
});

input.addEventListener("input", () => void updateAutocomplete());

// —— U26/T-P3-129 + T-P3-149 语音输入：录音三态机（计时/电平条/上限自动
//    停/Esc 取消/失败冷却）下沉 composer-voice.js（qwen-code VoiceButton /
//    dsh VoiceInput / pideck VoiceTranscriptionControls 三仓同构面）；此处是
//    Composer 消费端：转写请求 + 选区映射落位 + 可选转写润色
const micBtn = document.getElementById("mic-btn");
const voiceStatus = document.getElementById("voice-status");
const voiceTimer = document.getElementById("voice-timer");
const voiceMeter = document.getElementById("voice-meter");
const voiceCancel = document.getElementById("voice-cancel");

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    });
    reader.addEventListener("error", () => reject(new Error("读取录音失败")));
    reader.readAsDataURL(blob);
  });
}

// 录音开始瞬间的输入框快照——resolveVoiceInsertion 冲突裁决基准
let voiceSnapshot = null;

const voiceCapture = createVoiceCapture({
  micBtn,
  statusEl: voiceStatus,
  timerEl: voiceTimer,
  meterEl: voiceMeter,
  cancelBtn: voiceCancel,
  onPhase: (phase) => {
    micBtn.disabled = phase === "transcribing";
  },
  onStop: (blob, mediaType) => void transcribeRecording(blob, mediaType),
});

function voiceMaxSeconds() {
  const raw = Number(settingsCache?.stt?.maxSeconds);
  return Number.isFinite(raw) && raw > 0 ? raw : RECORD_MAX_SECONDS_DEFAULT;
}

// T-P3-153 C：会话导出（composer ⬇ 钮——md/html/json 三格式+默认脱敏；
// 对话框在 views/settings/transfer.js——设置域与历史页共用同一入口）
document.getElementById("chat-export-btn").addEventListener("click", () => {
  void import("./views/settings/transfer.js").then((m) => m.openSessionExportDialog(sessionId()));
});

micBtn.addEventListener("click", () => {
  if (voiceCapture.phase === "transcribing") return;
  if (voiceCapture.phase === "recording") {
    voiceCapture.stop();
    return;
  }
  if (settingsCache?.stt?.baseUrl === undefined || settingsCache?.stt?.model === undefined) {
    toast("语音输入未配置——请先在设置「语音」分节填 STT 端点与模型", "warn");
    return;
  }
  voiceSnapshot = {
    draft: input.value,
    from: input.selectionStart ?? input.value.length,
    to: input.selectionEnd ?? input.value.length,
  };
  voiceCapture.start(voiceMaxSeconds(), settingsCache?.stt?.silenceStop === true).catch((e) => {
    toast(voiceStartErrorMessage(e), "warn");
  });
});

function voiceStartErrorMessage(e) {
  if (e?.code === "VOICE_PERMISSION") return "麦克风权限被拒绝——请在浏览器/系统设置允许后重试";
  if (e?.code === "VOICE_COOLDOWN") return e.message;
  return `麦克风不可用：${e instanceof Error ? e.message : String(e)}`;
}

async function transcribeRecording(blob, mediaType) {
  try {
    // chat 协议通道只收 wav/mp3（OpenAI input_audio 闭集）——webm 系先转 16k wav
    let payload = { mediaType, content: await blobToBase64(blob) };
    if (settingsCache?.stt?.protocol === "chat" && !["audio/wav", "audio/mp3", "audio/mpeg"].includes(mediaType)) {
      const wav = await resampleToWav16k(blob);
      payload = { mediaType: "audio/wav", content: await blobToBase64(wav) };
    }
    const envelope = await sendSettings({
      op: "stt-transcribe",
      ...payload,
    });
    if (!envelope.ok) {
      appendLine(`语音转写失败：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
      voiceCapture.noteFailure();
      return;
    }
    const text = envelope.result.text ?? "";
    await insertTranscription(text);
    voiceCapture.finish();
    toast("已转写填入输入框", "info");
  } catch (e) {
    appendLine(`语音转写失败：${e instanceof Error ? e.message : String(e)}`, "warn");
    voiceCapture.noteFailure();
  }
}

// 转写文本落位：优先选区映射插入（编辑冲突即回退末尾追加——绝不覆盖用
// 户新输入）；开启「转写后润色」时先经辅助模型清理口语（qwen voice-refine
// 语义：超时/失败/防注入守卫一票回退原文，永不阻塞落位）
async function insertTranscription(text) {
  let finalText = text;
  if (settingsCache?.stt?.refineTranscript === true && !/^[/@]/.test(text)) {
    const refined = await refineTranscript(text);
    if (refined !== null) finalText = refined;
  }
  const resolved = resolveVoiceInsertion({
    snapshotDraft: voiceSnapshot?.draft ?? "",
    from: voiceSnapshot?.from ?? 0,
    to: voiceSnapshot?.to ?? 0,
    currentDraft: input.value,
    text: finalText,
  });
  if (resolved !== null) {
    input.value = resolved.value;
    input.setSelectionRange(resolved.caret, resolved.caret);
  } else {
    input.value = input.value === "" ? finalText : `${input.value} ${finalText}`;
    input.setSelectionRange(input.value.length, input.value.length);
    toast("输入框已变化——转写文本已追加到末尾", "info");
  }
  autoGrow();
  input.focus();
}

async function refineTranscript(text) {
  try {
    const envelope = await Promise.race([
      sendRequest(sessionId(), {
        type: "polish",
        requestId: allocRequestId("vr"),
        draft: text,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("润色超时")), 3000)),
    ]);
    if (!envelope.ok) return null;
    const result = envelope.result ?? {};
    if (result.ok !== true || typeof result.text !== "string") return null;
    const refined = result.text.trim();
    // 防注入守卫（qwen voice-refine.ts:77-86）：/·@ 开头或膨胀 >2× 或空 = 弃用
    if (refined === "" || /^[/@]/.test(refined) || refined.length > text.length * 2) return null;
    return refined;
  } catch {
    return null; // 润色永不失败——超时/异常一律回退原文
  }
}

// —— T-P3-146 I 一键润色（pi-desktop prompt-enhancement Composer 消费端）：
// 草稿 → polish 旁路请求 → 润色文本替换输入框；撤销恢复原文（pi 全套的
// 轻量版——竞态保护用 in-flight 禁用 + 会话切换丢弃）。
const polishBtn = document.getElementById("polish-btn");
const polishUndo = document.getElementById("polish-undo");
const polishUndoBtn = document.getElementById("polish-undo-btn");
let polishInFlight = false;
let polishPrevDraft = "";

polishBtn.addEventListener("click", async () => {
  const draft = input.value.trim();
  if (draft === "") {
    toast("输入框为空——先写草稿再润色", "warn");
    return;
  }
  if (draft.startsWith("/")) {
    toast("模板调用（/ 开头）不参与润色", "warn");
    return;
  }
  if (polishInFlight) return;
  polishInFlight = true;
  polishBtn.disabled = true;
  polishBtn.textContent = "⏳";
  try {
    // 兜底超时（polish 无 error 行关联——子进程崩溃时 Promise 会悬挂，
    // 60s 上限保证按钮可恢复）
    const envelope = await Promise.race([
      sendRequest(sessionId(), {
        type: "polish",
        requestId: allocRequestId("p"),
        draft,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("润色请求超时（60s）")), 60_000)),
    ]);
    if (!envelope.ok) {
      toast(`润色失败：${envelope.error?.message ?? envelope.error?.code ?? ""}`, "warn");
      return;
    }
    const result = envelope.result ?? {};
    if (result.ok !== true || typeof result.text !== "string" || result.text === "") {
      toast(`润色失败：${result.error ?? "模型未返回内容"}`, "warn");
      return;
    }
    polishPrevDraft = input.value;
    input.value = result.text;
    autoGrow();
    input.focus();
    polishUndo.hidden = false;
    toast("已润色填入——可撤销恢复原文", "info");
  } catch (e) {
    toast(`润色失败：${e instanceof Error ? e.message : String(e)}`, "warn");
  } finally {
    polishInFlight = false;
    polishBtn.disabled = false;
    polishBtn.textContent = "✨";
  }
});
polishUndoBtn?.addEventListener("click", () => {
  if (polishPrevDraft === "") return;
  input.value = polishPrevDraft;
  polishPrevDraft = "";
  polishUndo.hidden = true;
  autoGrow();
  input.focus();
});
input.addEventListener("input", () => {
  // 撤销面随编辑失效（原文被改动后撤销无意义）
  if (polishPrevDraft !== "" && polishUndo !== null && !polishUndo.hidden) {
    polishPrevDraft = "";
    polishUndo.hidden = true;
  }
});

// ---------------------------------------------------------------------------
// 面板函数（函数名保留——调用点兼容；实现 = 路由跳转，数据拉取在视图模块）
// ---------------------------------------------------------------------------

function openSettings() {
  go("settings");
}

function openUsage() {
  go("usage");
}

/** T-P3-156：历史页退役为侧栏「最近会话」分段——Ctrl+H = 回对话 + 侧栏
 * 定位到最近会话分段（滚动 + 高亮闪一次）。 */
function openHistory() {
  go("chat");
  focusSidebarSection("sb-history");
}

/** T-P3-156：项目页退役为侧栏项目分段——Ctrl+Shift+P 同款定位语义。 */
function openProjects() {
  go("chat");
  focusSidebarSection("sb-projects");
}

function openWorkpanel() {
  go("work");
}

function focusSidebarSection(id) {
  const el = document.getElementById(id);
  if (el === null) return;
  el.scrollIntoView({ block: "start", behavior: "smooth" });
  el.classList.remove("sb-flash");
  // 强制重排后再加类——连续触发也重放闪烁动画
  void el.offsetWidth;
  el.classList.add("sb-flash");
  setTimeout(() => el.classList.remove("sb-flash"), 1200);
}

// ---------------------------------------------------------------------------
// U9/T-P3-108 对话导航与检索：会话内搜索（Ctrl+F 渲染层高亮跳转——
// find-bar 浮层在骨架 index.html）+ 小地图（消息类型着色条 + 点击跳轮）。
// ---------------------------------------------------------------------------

// —— 会话内搜索：命中高亮 + 上下跳转（不落库、不经 host——渲染层文本检索）
const findBar = document.getElementById("find-bar");
const findInput = document.getElementById("find-input");
const findCount = document.getElementById("find-count");
const findHits = [];
let findCursor = -1;

function clearHits() {
  for (const mark of findHits) {
    const parent = mark.parentNode;
    if (parent !== null) {
      mark.replaceWith(...mark.childNodes); // 摘帽还原原文本节点
      parent.normalize();
    }
  }
  findHits.length = 0;
  findCursor = -1;
  findCount.textContent = "";
}

function updateFindUi() {
  findCount.textContent = findHits.length === 0 ? "无命中" : `${findCursor + 1}/${findHits.length}`;
  for (const [i, mark] of findHits.entries()) mark.classList.toggle("active", i === findCursor);
  if (findCursor >= 0) findHits[findCursor].scrollIntoView({ block: "center" });
}

function wrapMatches(node, needle) {
  const value = node.nodeValue ?? "";
  const lower = value.toLowerCase();
  const q = needle.toLowerCase();
  const frag = document.createDocumentFragment();
  let pos = 0;
  let idx = lower.indexOf(q);
  while (idx >= 0) {
    frag.appendChild(document.createTextNode(value.slice(pos, idx)));
    const mark = document.createElement("mark");
    mark.className = "search-hit";
    mark.textContent = value.slice(idx, idx + needle.length);
    frag.appendChild(mark);
    findHits.push(mark);
    pos = idx + needle.length;
    idx = lower.indexOf(q, pos);
  }
  frag.appendChild(document.createTextNode(value.slice(pos)));
  node.parentNode.replaceChild(frag, node);
}

function findInStream(needle) {
  clearHits();
  if (needle !== "") {
    const walker = document.createTreeWalker(stream, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement?.closest(".code-copy") === null &&
        (n.nodeValue ?? "").toLowerCase().includes(needle.toLowerCase())
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    });
    const targets = [];
    while (walker.nextNode()) targets.push(walker.currentNode);
    for (const node of targets) wrapMatches(node, needle);
    findCursor = findHits.length > 0 ? 0 : -1;
  }
  updateFindUi();
}

document.getElementById("find-next").addEventListener("click", () => {
  if (findHits.length === 0) return;
  findCursor = (findCursor + 1) % findHits.length;
  updateFindUi();
});
document.getElementById("find-prev").addEventListener("click", () => {
  if (findHits.length === 0) return;
  findCursor = (findCursor - 1 + findHits.length) % findHits.length;
  updateFindUi();
});
document.getElementById("find-close").addEventListener("click", () => {
  findBar.hidden = true;
  clearHits();
});
findInput.addEventListener("input", () => findInStream(findInput.value.trim()));
findInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    document.getElementById(ev.shiftKey === true ? "find-prev" : "find-next").click();
  }
});

function openFind() {
  findBar.hidden = false;
  findInput.focus();
  findInput.select();
  if (findInput.value.trim() !== "") findInStream(findInput.value.trim());
}

// —— 小地图：消息类型着色条 + 点击跳轮（纯 DOM——展示什么导航什么）。
// 批 C 轨迹六色：现三色扩六类（--traj-* 六色槽——方案 §2.4 trajectory 同构；
// reasoning = 空文本 assistant 段〔模型转入工具调用〕；reasoning-alt 为备用槽）。
const minimap = document.getElementById("minimap");
const MINIMAP_KINDS = {
  "user/message": "mm-user",
  "assistant/message": "mm-agent",
  "tool/call": "mm-toolcall",
  "tool/result": "mm-toolresult",
};
const minimapEntries = [];
let minimapTurn = 0;

function minimapRegister(node, e) {
  let kind = MINIMAP_KINDS[e.type];
  if (kind === undefined) {
    if (e.type === "turn/start") minimapTurn = e.turn;
    return;
  }
  if (e.type === "assistant/message" && (e.message?.content ?? "") === "") {
    kind = "mm-reasoning"; // 推理段（空文本 assistant——转工具调用前）
  }
  if (node === null) return;
  minimapEntries.push({ el: node, turn: minimapTurn });
  const row = document.createElement("div");
  row.className = `mm-row ${kind}`;
  row.dataset.idx = String(minimapEntries.length - 1);
  row.title = `turn ${minimapTurn} · ${e.type}`;
  minimap.appendChild(row);
}

function minimapReset() {
  minimapEntries.length = 0;
  minimapTurn = 0;
  minimap.replaceChildren();
}

minimap.addEventListener("click", (ev) => {
  const row = ev.target instanceof Element ? ev.target.closest(".mm-row") : null;
  if (row === null) return;
  const entry = minimapEntries[Number(row.dataset.idx)];
  if (entry === undefined) return;
  entry.el.scrollIntoView({ block: "start" });
  entry.el.classList.add("mm-flash");
  setTimeout(() => entry.el.classList.remove("mm-flash"), 1200);
});

/** 流视图整体重置（只读查看入口共用——搜索命中摘帽 + 小地图重建）。 */
function resetStreamView() {
  stopSpeaking(); // 朗读随流销毁收束（Blob URL revoke + 按钮复位）
  clearHits();
  minimapReset();
  lastStreamDay = null; // 日期分隔随流重建归零
  stream.replaceChildren();
  syncChatEmpty();
}

// ---------------------------------------------------------------------------
// 批 C 首屏空状态：流为空时展示居中欢迎卡 + 能力快捷入口（empty-state 形态
// 扩展——三点同步：renderHistory / renderEventEnvelope / resetStreamView）。
// ---------------------------------------------------------------------------

const chatEmpty = document.getElementById("chat-empty");

function syncChatEmpty() {
  if (chatEmpty === null) return;
  // 判据 = 存在实质消息节点（气泡/工具卡）——surface 接入等元行不挤走欢迎卡
  chatEmpty.hidden = stream.querySelector(".bubble, .tool-card") !== null;
}

// 能力快捷入口（欢迎卡按钮——路由/聚焦输入，零新协议面）
for (const btn of document.querySelectorAll("#chat-empty [data-empty-action]")) {
  btn.addEventListener("click", () => {
    const action = btn.dataset.emptyAction;
    if (action === "input") {
      input.focus();
      return;
    }
    go(action); // settings/history/search 等路由名
  });
}

// ---------------------------------------------------------------------------
// U13/T-P3-112 五件套（横幅与弹窗面在骨架 index.html）：Toast（feedback.js）
// + 通知中心消费（N5 分型——清单渲染在 views/notify.js）+ 启动恢复横幅
//（M3 诊断 + 一键续跑）+ 更新横幅与
// 发布说明弹窗（U7 消费端——真实更新源 T-P3-114 接线）。
// ---------------------------------------------------------------------------

function consumeN5(payload) {
  notifications.push(payload);
  if (notifications.length > 50) notifications.shift(); // 面板容量防呆
  toast(n5ToastText(payload), payload.kind);
  emitNotify(); // 通知视图挂载期重渲染清单
  updateNotifyBadge(); // 侧栏徽标常显
  // U15：turn 结算 → 工作面板自动刷新（订阅制——面板挂载期生效）
  if (payload.kind === "turn_settled") emitTurnSettled();
}

function n5ToastText(n) {
  const d = n.data ?? {};
  switch (n.kind) {
    case "turn_settled":
      return `turn ${d.turn} 结束`;
    case "approval_pending":
      return d.name === "question_asked" ? "模型有提问待答复" : "有审批待处理";
    case "job_settled":
      return "后台任务已结算";
    case "surface_changed":
      return `端面 ${d.surfaceId ?? ""} ${d.event ?? ""}`;
    case "computer_operation":
      return "屏幕操作回显";
    default:
      return oneLine(JSON.stringify(d), 80);
  }
}

// —— 启动恢复横幅（M3 可视化）：恢复视图流尾存在未闭合轮 → 诊断 + 一键续跑
function showRecoveryIfInterrupted(events) {
  const open = new Map();
  for (const e of events) {
    if (e.type === "turn/start") open.set(e.turn, true);
    if (e.type === "turn/end") open.delete(e.turn);
  }
  const openTurns = [...open.keys()].sort((a, b) => a - b);
  if (openTurns.length === 0) return;
  const banner = document.getElementById("recovery-banner");
  document.getElementById("recovery-text").textContent =
    `检测到中断的轮：turn ${openTurns.join("、")} 未正常收束（M3 续跑在子进程启动时已自动执行）`;
  const retry = document.getElementById("recovery-retry");
  retry.hidden = lastUserPrompt === "";
  banner.hidden = false;
}
document.getElementById("recovery-retry").addEventListener("click", () => {
  document.getElementById("recovery-banner").hidden = true;
  if (lastUserPrompt !== "") {
    void sendRequest(sessionId(), {
      type: "prompt",
      messageId: allocRequestId("m"),
      content: lastUserPrompt,
    });
  }
});
document.getElementById("recovery-dismiss").addEventListener("click", () => {
  document.getElementById("recovery-banner").hidden = true;
});

// —— 更新横幅 + 发布说明弹窗（U7 消费端：宿主面更新器经
// window.aegentShowUpdate(version, notes) 触发——T-P3-114 接线点）
function showUpdateBanner(version, notes) {
  document.getElementById("update-text").textContent = `新版本可用：${version}`;
  document.getElementById("rn-version").textContent = `发布说明 · ${version}`;
  document.getElementById("rn-body").textContent = notes ?? "（无发布说明）";
  document.getElementById("update-banner").hidden = false;
}
window.aegentShowUpdate = (version, notes) => showUpdateBanner(version, notes);
document.getElementById("update-details").addEventListener("click", () => {
  document.getElementById("release-notes").hidden = false;
});
document.getElementById("update-dismiss").addEventListener("click", () => {
  document.getElementById("update-banner").hidden = true;
});
document.getElementById("rn-close").addEventListener("click", () => {
  document.getElementById("release-notes").hidden = true;
});

// 深链确认钩子（宿主接线面——aegentShowUpdate 同款；scheme 注册随真实分发
// 接入，记档）：aegent://import?data=<urlencoded 配置包> → 本钩子收 data。
// 导入链在设置域（views/settings.js）——动态 import 委派（懒加载不破）；
// 返回值为 Promise<"accepted"|"dismissed"|"rejected">（宿主面 eval 不消费返回值）。
window.aegentApplyDeepLink = (encodedData) =>
  import("./views/settings.js").then((m) => m.applyDeepLink(encodedData));

// —— 侧栏 Profiles 快速切换（#profile-quick 在骨架侧栏——设置域的
//    applyQuickProfile 经动态 import 调用，启动即可用）
document.getElementById("profile-quick").addEventListener("change", (ev) => {
  const name = ev.target.value;
  ev.target.value = "";
  if (name === "") return;
  void import("./views/settings.js").then((m) => m.applyQuickProfile(name));
});

// ---------------------------------------------------------------------------
// 快捷键统一分发（U25/T-P3-128）：注册表驱动（settings.shortcuts 覆盖默认
// 键位——设置页保存后 state.rebuildKeymap 同步）；面板开关 = 路由跳转
//（go 对当前视图重复触发 = 回对话——原 hidden 切换的路由等价面）。
// ---------------------------------------------------------------------------

const KEYMAP_HANDLERS = {
  settings: () => go("settings"),
  find: () => openFind(),
  search: () => go("search"),
  "close-find": () => {
    if (!findBar.hidden) {
      findBar.hidden = true;
      clearHits();
      return;
    }
    // T-P3-156 X：Esc 归还焦点链——搜索条未开时收起展开的终端/面板（输入
    // 框聚焦时不抢——composer 的 Esc 留给 IME/撤润色既有语义）
    const inComposer = document.activeElement === input;
    if (!inComposer) {
      const drawer = document.getElementById("terminal-drawer");
      const paneRoot = document.getElementById("pane-root");
      if (drawer !== null && !drawer.hidden) {
        void import("./terminal.js").then((m) => m.toggleTerminal(false));
        return;
      }
      if (paneRoot !== null && !paneRoot.hidden) togglePane(false);
    }
  },
  history: () => openHistory(),
  work: () => openWorkpanel(),
  usage: () => openUsage(),
  notify: () => go("notify"),
  // T-P3-152 A1：动作空间扩容（全部以本文件既有能力为准）
  "goto-projects": () => openProjects(),
  "goto-plugins": () => go("plugins"),
  // T-P3-156：新布局动作（切换面板开合 / 新建任务流程 / 定位项目分段）
  pane: () => togglePane(),
  terminal: () => void import("./terminal.js").then((m) => m.toggleTerminal()),
  "new-task": () => void import("./sidebar.js").then((m) => m.newTaskFlow()),
  "focus-input": () => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  },
  "clear-input": () => {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  },
  "copy-last-reply": () => void copyLastReply(),
  "scroll-top": () => {
    stream.scrollTop = 0;
  },
  "scroll-bottom": () => {
    stream.scrollTop = stream.scrollHeight;
  },
  "toggle-lease": () => leaseBtn.click(),
  cheatsheet: () => void openCheatsheet(),
};

/** T-P3-152：复制最后一条 assistant 回复（剪贴板；无回复时 toast 提示）。 */
async function copyLastReply() {
  const bubbles = stream.querySelectorAll(".bubble.agent");
  const last = bubbles[bubbles.length - 1];
  if (last === undefined) {
    toast("暂无可复制的回复", "warn");
    return;
  }
  try {
    await navigator.clipboard.writeText(last.textContent ?? "");
    toast("已复制最后回复", "info");
  } catch (e) {
    toast(`复制失败：${e instanceof Error ? e.message : String(e)}`, "warn");
  }
}

// —— T-P3-152 C1 `?` 速查面板（GitHub 上下文分组 + Slack 搜索 + pi 实时
// 生效键位先例）：分组表格 + 顶部搜索框 + kbd 徽标；Esc 关闭。数据源 =
// keymap 注册表 + 当前生效绑定（改键即变）。

async function openCheatsheet() {
  const { openDialog } = await import("./views/settings/core.js");
  const { ACTIONS, ACTION_GROUPS, createKeymap, usableInInput } = await import("./keymap.js");
  const bindings = getKeymapBindings();
  const body = document.createElement("div");
  body.className = "cheatsheet-body";
  body.innerHTML = `
    <input id="cheatsheet-search" class="input input-wide" placeholder="搜索动作或键位…" autocomplete="off" />
    <div id="cheatsheet-list"></div>
  `;
  const render = () => {
    const q = (body.querySelector("#cheatsheet-search")?.value ?? "").trim().toLowerCase();
    const list = body.querySelector("#cheatsheet-list");
    list.replaceChildren();
    for (const group of ACTION_GROUPS) {
      const actions = Object.entries(ACTIONS).filter(
        ([action, def]) =>
          def.group === group &&
          (q === "" ||
            def.label.toLowerCase().includes(q) ||
            (bindings[action] ?? "").toLowerCase().includes(q) ||
            action.includes(q)),
      );
      if (actions.length === 0) continue;
      const h = document.createElement("div");
      h.className = "cheatsheet-group";
      h.textContent = group;
      list.appendChild(h);
      for (const [action, def] of actions) {
        const row = document.createElement("div");
        row.className = "cheatsheet-row";
        const label = document.createElement("span");
        label.textContent = def.label;
        const keys = document.createElement("span");
        keys.className = "combo-caps";
        const combo = bindings[action] ?? def.default;
        for (const part of combo.split("+")) {
          const kbd = document.createElement("kbd");
          kbd.className = "kbd";
          kbd.textContent = part;
          keys.appendChild(kbd);
        }
        if (usableInInput(combo) === false && combo !== "Enter") {
          const note = document.createElement("span");
          note.className = "cheatsheet-note";
          note.textContent = "输入框外";
          keys.appendChild(note);
        }
        row.append(label, keys);
        list.appendChild(row);
      }
    }
    if (list.children.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "没有匹配的动作";
      list.appendChild(empty);
    }
  };
  render();
  body.querySelector("#cheatsheet-search").addEventListener("input", render);
  openDialog({ title: "键盘快捷键", description: "当前生效的键位（设置→快捷键可自定义）。", width: "md", body, actions: [{ label: "关闭", className: "btn btn-primary" }] });
}

window.addEventListener("keydown", (ev) => {
  // Esc 优先走搜索条关闭（输入态无关既有行为）；其余经注册表分发
  const inInput =
    document.activeElement instanceof HTMLTextAreaElement ||
    (document.activeElement instanceof HTMLInputElement &&
      document.activeElement.type !== "button");
  const action = resolveAction(getKeymapBindings(), ev, { inInput });
  if (action === null) return;
  const handler = KEYMAP_HANDLERS[action];
  if (handler !== undefined) {
    ev.preventDefault();
    handler();
  }
});

// T-P3-152 C2：侧栏按钮 title 实时键位提示（pi keyHint 先例降级版——改键后
// 经 state.rebuildKeymap 消费面自然更新为下次读值）。
function applyNavKeyHints() {
  const bindings = getKeymapBindings();
  for (const [btnId, action] of [
    ["sb-search", "search"],
    ["sb-new-task", "new-task"],
    ["pane-toggle-btn", "pane"],
    ["terminal-btn", "terminal"],
    ["notify-top-btn", "notify"],
    ["settings-btn", "settings"],
  ]) {
    const btn = document.getElementById(btnId);
    const combo = bindings[action];
    if (btn === null || combo === undefined) continue;
    const base = (btn.getAttribute("data-i18n-title") ?? btn.title ?? "").replace(/（[^）]*键位[^）]*）$/, "").trim();
    btn.title = `${base}（${combo}）`;
  }
}
applyNavKeyHints();

// ---------------------------------------------------------------------------
// WS 生命周期：hello → query 恢复 → live 流（连接与重连在 api.js——入口注入
// 信封分发与状态展示）
// ---------------------------------------------------------------------------

function handleEnvelope(envelope) {
  switch (envelope.type) {
    case "hello":
      // 握手回执携带本 host 的会话 id（路由引导）→ 发 query 恢复视图
      //（快照先行）；流续播随 event 信封自然衔接。
      leaseBtn.hidden = false;
      setSessionId(envelope.sessionId ?? null);
      void refreshSidebar(); // T-P3-156：连接就绪 → 侧栏两分段首拉（WS 建立前不发 settings）
      void refreshContextUsage(); // T-P3-156 L：输入条上下文 % 首拉
      if (getSessionId() !== "") {
        const requestId = allocRequestId("q");
        inflight.set(requestId, null);
        sendRaw({ type: "query", requestId, sessionId: getSessionId(), op: "events" });
      }
      break;
    case "response": {
      if (envelope.requestId === "(lease)") {
        // lease 直答回执（bridge onLease——requestId 恒 "(lease)"）
        if (envelope.ok) {
          const result = envelope.result ?? {};
          setLeaseUi(result.held === true, result.held === true ? SURFACE_ID : undefined);
        } else {
          appendLine(`租约失败：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
          setLeaseUi(false, undefined);
        }
        return;
      }
      const resolve = inflight.get(envelope.requestId);
      if (resolve !== undefined) {
        inflight.delete(envelope.requestId);
        if (resolve !== null) resolve(envelope);
      }
      if (envelope.requestId.startsWith("q-")) {
        if (envelope.ok) {
          renderHistory(envelope.result?.events ?? []);
        } else {
          appendLine(`恢复视图失败：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
        }
      } else if (!envelope.ok && !envelope.requestId.startsWith("s-")) {
        appendLine(`请求被拒：${envelope.error?.code ?? ""} ${envelope.error?.message ?? ""}`, "warn");
      }
      break;
    }
    case "event":
      if (getSessionId() === "") setSessionId(envelope.sessionId);
      renderEventEnvelope(envelope);
      break;
    case "notification":
      if (envelope.name === "n5") {
        consumeN5(envelope.payload ?? {}); // U13：N5 分型通知中心消费
      } else if (envelope.name === "approval_requested" || envelope.name === "question_asked") {
        if (getSessionId() === "") setSessionId(envelope.sessionId);
        buildCard(envelope.name, envelope.payload ?? {});
        // T-P3-156：待决审批 → 侧栏状态点（橙色）
        window.dispatchEvent(new CustomEvent("agent:awaiting"));
      } else if (envelope.name === "approval_settled") {
        removeCard(envelope.payload?.requestId);
        appendLine(`审批已结算：${envelope.payload?.allowed ? "允许" : "拒绝"}`, "meta");
      } else if (envelope.name === "idle") {
        // T-P3-156 W：内核空闲信号（agent-process 收尾宣告——队列空+无在途轮）。
        // 权威空闲面：排队续跑中不误报（kick 后有下条时内核不发 idle）。
        window.__agentBusy = false;
        notifyComposerIdle();
        void refreshContextUsage(); // 轮末拉一次上下文用量（输入条 % 刷新）
        window.dispatchEvent(new CustomEvent("agent:idle"));
      } else if (envelope.name === "prompt_returned") {
        // T-P3-156 W：中止退回——未消费输入回填输入框（qwen ↑popAllMessages
        // 同语义；contents = 队列剩余的未消费原文）
        const contents = Array.isArray(envelope.payload?.contents) ? envelope.payload.contents : [];
        if (contents.length > 0) {
          const existing = input.value.trim();
          const restored = contents.join("\n\n");
          input.value = existing === "" ? restored : `${restored}\n\n${existing}`;
          input.dispatchEvent(new Event("input")); // 触发自适应高度
          toast(`已中止——${String(contents.length)} 条未消费输入已退回输入框`, "warn");
        }
        notifyPromptReturned(); // K：排队投影清零（退回的已在输入框）
      } else if (envelope.name === "config_refreshed") {
        // T-P3-156 W：会话内切档回执（settings/basic.js 与输入条权限 pill 共用）
        const applied = Array.isArray(envelope.payload?.applied) ? envelope.payload.applied : [];
        toast(applied.length > 0 ? `已生效：${applied.join("、")}` : "配置已刷新", "info");
        notifyPermissionChanged(); // L：权限 pill 文案随档位刷新
        window.dispatchEvent(new CustomEvent("agent:config-refreshed", { detail: { applied } }));
      } else if (envelope.name === "terminal-data") {
        // T-P3-156 P：PTY 输出下行 → 终端抽屉（CustomEvent 解耦——terminal.js
        // 模块与 handleEnvelope 无静态依赖环）
        window.dispatchEvent(new CustomEvent("terminal:data", { detail: envelope.payload ?? {} }));
      } else if (envelope.name === "terminal-exit") {
        window.dispatchEvent(new CustomEvent("terminal:exit", { detail: envelope.payload ?? {} }));
      } else if (envelope.name === "forked") {
        // T-P3-156 W：分支会话回执（方案 I 联动点——侧栏任务列表刷新）
        const detail = envelope.payload ?? {};
        toast(`已创建分支会话 ${String(detail.sessionId ?? "").slice(0, 12)}…`, "info");
        window.dispatchEvent(new CustomEvent("agent:forked", { detail }));
        void refreshSidebar();
      }
      break;
    case "hello_error":
      statusEl.textContent = `协议版本不符：${envelope.error?.message ?? ""}`;
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 启动：图标注入 → 侧栏导航与路由 → WS 连接
// ---------------------------------------------------------------------------

injectIcons(document);

// 侧栏与顶栏导航：[data-route] 按钮 → hash 路由（T-P3-156 骨架——侧栏仅
// 搜索/设置两入口，通知/终端/切换面板在顶栏；对话恒在主区无路由钮）
for (const btn of document.querySelectorAll("#sidebar [data-route], #topbar [data-route]")) {
  btn.addEventListener("click", () => go(btn.dataset.route));
}
document.getElementById("sidebar-toggle").addEventListener("click", () => {
  const shell = document.getElementById("app-shell");
  shell.classList.toggle("rail");
  try {
    localStorage.setItem("aegent.sidebarRail", shell.classList.contains("rail") ? "1" : "0");
  } catch {
    // 存储不可用——折叠态会话内有效
  }
});
try {
  if (localStorage.getItem("aegent.sidebarRail") === "1") {
    document.getElementById("app-shell").classList.add("rail");
  }
} catch {
  // 同上
}

// T-P3-156 A：侧栏拖宽（两段式——拖拽写 CSS 变量，松手才持久化；
// zcode WorkspaceShellLayout.tsx:539-557 同构；rail 折叠态禁用）
(() => {
  const bar = document.getElementById("sidebar-resizer");
  if (bar === null) return;
  const MIN = 220;
  const MAX_RATIO = 0.5;
  const saved = Number(localStorage.getItem("aegent.sidebarWidth"));
  if (Number.isFinite(saved) && saved >= MIN) {
    document.documentElement.style.setProperty("--sidebar-width", `${saved}px`);
  }
  bar.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    if (document.getElementById("app-shell").classList.contains("rail")) return;
    bar.classList.add("dragging");
    const onMove = (move) => {
      const width = Math.min(window.innerWidth * MAX_RATIO, Math.max(MIN, move.clientX));
      document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
    };
    const onUp = () => {
      bar.classList.remove("dragging");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const current = document.documentElement.style.getPropertyValue("--sidebar-width");
      try {
        localStorage.setItem("aegent.sidebarWidth", current.trim());
      } catch {
        // 存储不可用——宽度会话内有效
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
})();

// T-P3-156：侧栏「新建任务」流程（项目选择/添加 → 设为活动工作区）
document.getElementById("sb-new-task").addEventListener("click", () => void newTaskFlow());

// T-P3-156 K/L：输入 Tab 栏 + 排队条（权限/上下文%/模型/附件；addAttachment
// 复用既有粘贴附件链——限额/预览/revoke 全一致）。try/catch 可见化：启动期
// 错误在 WS 就绪前上不了日志（log-report flush 失败静默）——首屏横幅兜底
try {
  initComposerBar({ input, addAttachment });
  // T-P3-156 U：右上角进度小弹窗（pill+hover 展开+终态驻留）
  initProgressDock();
  // T-P3-156 P：底部终端抽屉（xterm+node-pty——按钮按 IS_DESKTOP 显隐）
  initTerminalPane();
} catch (e) {
  console.error("输入区/进度弹窗初始化失败", e);
  appendLine(`输入区初始化失败：${e?.message ?? String(e)}`, "warn");
}

// T-P3-156 H：子代理同构工作区面板（切换面板内独立 Tab——渲染复用主会话
// renderEvent 管线；快照+手动/自动刷新；多实例=每子代理一个 Tab）
let subagentPollTimer = null;

async function renderSubagentPaneBody(body, sid) {
  body.replaceChildren();
  const head = document.createElement("div");
  head.className = "subagent-pane-head";
  const title = document.createElement("span");
  title.className = "subagent-pane-title";
  title.textContent = `🤖 子代理 ${sid.slice(0, 12)}…（只读同构视图）`;
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "btn btn-ghost";
  refresh.textContent = "↻ 刷新";
  refresh.title = "重拉子会话事件快照";
  const auto = document.createElement("label");
  auto.className = "subagent-auto";
  auto.title = "每 5 秒自动重拉快照（子代理运行期间用）";
  const autoCheck = document.createElement("input");
  autoCheck.type = "checkbox";
  autoCheck.checked = subagentPollTimer !== null;
  autoCheck.addEventListener("change", () => {
    if (subagentPollTimer !== null) {
      clearInterval(subagentPollTimer);
      subagentPollTimer = null;
    }
    if (autoCheck.checked) {
      subagentPollTimer = setInterval(() => {
        if (document.querySelector(".pane-tab.active")?.textContent.includes("子代理")) {
          void renderSubagentPaneBody(document.querySelector("#pane-root .pane-body"), sid);
        }
      }, 5000);
    }
  });
  auto.append(autoCheck, document.createTextNode("自动"));
  head.append(title, auto, refresh);
  const stream = document.createElement("div");
  stream.className = "subagent-pane-stream";
  body.append(head, stream);
  const paint = async () => {
    const view = await sendQuery({ sessionId: sid, op: "events" });
    if (!view.ok) {
      stream.textContent = `子会话读取失败：${view.error?.message ?? ""}`;
      return;
    }
    stream.replaceChildren();
    for (const ev of view.result.events ?? []) {
      const node = renderEvent(ev);
      if (node !== null) stream.appendChild(node);
    }
    const note = document.createElement("div");
    note.className = "subagent-pane-note";
    note.textContent = `── 共 ${String((view.result.events ?? []).length)} 条事件 · 只读（续聊请 CLI resume）──`;
    stream.appendChild(note);
  };
  refresh.addEventListener("click", () => void paint());
  await paint();
}

registerPane("subagent", {
  title: (tab) => `🤖 子代理 ${String(tab.payload.sessionId).slice(0, 8)}`,
  icon: "🤖",
  render: (body, tab) => renderSubagentPaneBody(body, String(tab.payload.sessionId)),
});

// T-P3-156 C：切换面板宿主初始化（右上角「切换面板」钮 ↔ #pane-root 开合）
initPane(document.getElementById("pane-root"), document.getElementById("pane-toggle-btn"));
// T-P3-156 A/E：侧栏两分段（项目 / 最近会话）启动渲染
initSidebar();

/** 侧栏激活态与路由同步（hashchange 驱动——深链/前进后退同样生效）。 */
function syncNav() {
  const active = location.hash.replace(/^#\/?/, "").split("/")[0] || "chat";
  for (const btn of document.querySelectorAll("#sidebar [data-route]")) {
    btn.classList.toggle("active", btn.dataset.route === active);
  }
}
window.addEventListener("hashchange", syncNav);
syncNav();

// 聊天流重建回调注册（history/search 的"查看 = 只读恢复视图"消费）
hooks.resetStreamView = resetStreamView;
hooks.renderHistory = renderHistory;

startRouter(document.getElementById("view-root"), document.getElementById("chat-view"));

connect({
  onEnvelope: handleEnvelope,
  onStatus: (text) => {
    statusEl.textContent = text;
  },
  onClose: () => setLeaseUi(false, undefined), // 断连归还租约 UI（原 close 语义）
});
