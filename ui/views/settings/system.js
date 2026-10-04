/**
 * 数据与系统组（T-P3-135 · UI 批次 B⑦⑨——projects/instructions/shortcuts/
 * transfer/logging/about 六分节；T-P3-153 transfer 下沉 transfer.js 数据
 * 中心域文件——配置包 v2/备份中心/会话数据/体检五卡组，本文件只转发）：
 * - shortcuts：kbd 键位胶囊 + 绑定行 + 顶部搜索过滤（ShortcutBindingRow
 *   形态；捕获态交互原样——冲突阻断/保留键提示语义不动）；
 * - projects：行式卡 + 建档模态（project-form 下沉——CRUD 原样）；
 * - instructions：三文件位编辑器卡（保存确认保持原生 confirm——卡面⑨
 *   "其余 confirm 保持"）；
 * - logging/about：行式卡。
 * 数据面逻辑原样（instructions-list/instruction-save/project CRUD/
 * shortcuts 段 + 捕获态改绑全保留）。
 */

import * as instructions from "./instructions.js";
import * as shortcuts from "./shortcuts.js";
import * as transfer from "./transfer.js";
import * as logging from "./logging.js";
import * as about from "./about.js";
import { shortcutCaptureKeydown } from "./shortcuts.js";
import { settingsCache } from "../../state.js";

const instructionsSection = instructions.SECTION_HTML;
const shortcutsSection = shortcuts.SECTION_HTML;
const transferSection = transfer.SECTION_HTML;
const loggingSection = logging.SECTION_HTML;
const aboutSection = about.SECTION_HTML;

export const SECTIONS_HTML = `
<section data-section="chat">
  <div class="section-head">
    <h2 class="section-title">对话与输入</h2>
  </div>
  <p class="hint">影响主对话页的输入与展示行为（zcode 常规/全局 AI 页同位功能的真实可用子集）。</p>
  <div class="card">
    <div class="settings-row">
      <div>
        <div class="settings-row-title">回车发送</div>
        <div class="settings-row-desc">开启 = Enter 直接发送、Shift+Enter 换行；关闭 = Ctrl+Enter 发送。</div>
      </div>
      <label class="switch"><input id="chat-enter-send" type="checkbox" aria-label="回车发送" /><span class="switch-track"></span></label>
    </div>
    <div class="settings-row">
      <div>
        <div class="settings-row-title">上下文用量读数</div>
        <div class="settings-row-desc">输入条用量圆标显示已用占比还是剩余占比。</div>
      </div>
      <div class="tab-group" id="chat-ctx-readout">
        <button type="button" class="tab-trigger" data-value="used">已用</button>
        <button type="button" class="tab-trigger" data-value="remaining">剩余</button>
      </div>
    </div>
    <div class="settings-row">
      <div>
        <div class="settings-row-title">思考过程展示模式</div>
        <div class="settings-row-desc">详细 = 思考卡默认展开；精简 = 默认收起（点击展开）。</div>
      </div>
      <div class="tab-group" id="chat-reasoning-display">
        <button type="button" class="tab-trigger" data-value="detailed">详细</button>
        <button type="button" class="tab-trigger" data-value="concise">精简</button>
      </div>
    </div>
    <div class="settings-row">
      <div>
        <div class="settings-row-title">大段文本粘贴阈值</div>
        <div class="settings-row-desc">粘贴超过该字符数自动转为文本附件（200-100000）。</div>
      </div>
      <input id="chat-paste-threshold" class="input" type="number" min="200" max="100000" step="100" style="width: 120px" />
    </div>
  </div>
</section>
${instructionsSection}${shortcutsSection}${transferSection}${loggingSection}
${aboutSection}
`;

// ---------------------------------------------------------------------------
// T-P3-150 D1：项目 CRUD 迁独立页 views/projects.js（工作区/任务/文件树/
// 添加三模式）——本分节只留跳转卡；项目指令仍走下方指令中心（instr-project）。

// ---------------------------------------------------------------------------
// U24/T-P3-127 指令中心：全局/项目 AGENTS.md + 用户规则文件（C22 project/
// user 档文件位）——查看/编辑/保存确认 + 规则 lint + 模板插入辅助。
// ---------------------------------------------------------------------------

/** 卸载收束（壳 unmount 委派——捕获态不跨视图存活）。 */
export function unmount() {
  shortcuts.unmount();
}

// ---------------------------------------------------------------------------
// T-P3-153：导入导出域下沉 transfer.js（数据中心五卡组）——本文件只转发旧
// 入口（settings.js 壳 → app.js 深链/导入链的既有消费面零破坏）。
// ---------------------------------------------------------------------------

export { applyDeepLink, applyImportedSettingsObject, summarizeImported } from "./transfer.js";

// ---------------------------------------------------------------------------
// 挂载 / 回填 / 打开拉取
// ---------------------------------------------------------------------------

export function bind() {
  bindChatSection(); // T-P3-165 需求 4：对话与输入分节
  // T-P3-152：快捷键域（绑定/捕获监听/录制搜索/单行重置在 shortcuts.js）
  shortcuts.bind();
  window.addEventListener("keydown", shortcutCaptureKeydown, true);
  // T-P3-153：数据中心域（导出模态/导入确认/备份中心/会话回导/体检在 transfer.js）
  transfer.bind();
  // T-P3-154：日志中心域（查看器/级别热更/诊断包在 logging.js）
  logging.bind();
  // T-P3-155：关于中心域（版本/环境路径/更新检查/入口在 about.js）
  about.bind();
}

export function fill() {
  fillChatSection(); // T-P3-165：对话与输入回填
  shortcuts.render();
  logging.fill(); // T-P3-154：日志中心表单回填（rawDir/级别/保留天数）
  about.fill();
}

/** 指令中心打开时拉一次（壳 open 委派——逻辑在 instructions 域文件）。 */
export function refreshInstructionsOnce() {
  void instructions.refresh();
}

// ---------------------------------------------------------------------------
// T-P3-165 需求 4：对话与输入分节（settings.chat 段——回车发送/上下文读数
// 口径/思考展示模式/粘贴阈值；保存走既有 op:update patch 全链）。
// ---------------------------------------------------------------------------

function chatSettings() {
  return settingsCache?.chat ?? {};
}

async function saveChatSection(patch) {
  const envelope = await (await import("../api.js")).sendSettings({
    op: "update",
    patch: { chat: { ...chatSettings(), ...patch } },
  });
  if (!envelope.ok) {
    const { toast } = await import("../feedback.js");
    toast(`保存失败：${envelope.error?.message ?? ""}`, "warn");
    return false;
  }
  return true;
}

function fillChatSection() {
  const chat = chatSettings();
  const enterBtn = document.getElementById("chat-enter-send");
  if (enterBtn !== null) enterBtn.checked = chat.enterToSend !== false; // 缺省 = 开（既有语义）
  const readout = chat.ctxReadout ?? "used";
  for (const b of document.querySelectorAll("#chat-ctx-readout .tab-trigger")) {
    b.classList.toggle("active", b.dataset.value === readout);
  }
  const reasoning = chat.reasoningDisplay ?? "detailed";
  for (const b of document.querySelectorAll("#chat-reasoning-display .tab-trigger")) {
    b.classList.toggle("active", b.dataset.value === reasoning);
  }
  const threshold = document.getElementById("chat-paste-threshold");
  if (threshold !== null) threshold.value = String(chat.pasteThreshold ?? 8192);
}

function bindChatSection() {
  document.getElementById("chat-enter-send")?.addEventListener("change", async (ev) => {
    if (await saveChatSection({ enterToSend: ev.target.checked })) fillChatSection();
  });
  for (const b of document.querySelectorAll("#chat-ctx-readout .tab-trigger")) {
    b.addEventListener("click", async () => {
      if (await saveChatSection({ ctxReadout: b.dataset.value })) fillChatSection();
    });
  }
  for (const b of document.querySelectorAll("#chat-reasoning-display .tab-trigger")) {
    b.addEventListener("click", async () => {
      if (await saveChatSection({ reasoningDisplay: b.dataset.value })) fillChatSection();
    });
  }
  document.getElementById("chat-paste-threshold")?.addEventListener("change", async (ev) => {
    const value = Number(ev.target.value);
    if (!Number.isFinite(value) || value < 200 || value > 100000) {
      fillChatSection();
      return;
    }
    if (await saveChatSection({ pasteThreshold: Math.floor(value) })) fillChatSection();
  });
}
