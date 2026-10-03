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
<section data-section="projects">
  <div class="section-head">
    <h2 class="section-title">项目</h2>
    <a class="btn btn-primary" href="#projects">前往项目中心</a>
  </div>
  <p class="hint">项目域已升级为独立页面（工作区/任务/文件树/添加三模式）——点上方按钮直达，或侧栏「项目」。</p>
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
  shortcuts.render();
  logging.fill(); // T-P3-154：日志中心表单回填（rawDir/级别/保留天数）
  about.fill();
}

/** 指令中心打开时拉一次（壳 open 委派——逻辑在 instructions 域文件）。 */
export function refreshInstructionsOnce() {
  void instructions.refresh();
}
