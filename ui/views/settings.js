/**
 * U14/T-P3-103 设置中心视图壳（T-P3-135 · UI 批次 B①② 重做）——十九分节
 * 内容按二级导航三组分域下沉 views/settings/ 子模块（core 共享层 + basic/
 * agents/system 三组；域状态 markDirty/dirtySections/健康缓存/编辑态归各自
 * 子模块，保存时序在 core 共享），本壳只保留：三组导航数据 + tab-header
 * sticky 页头（opencode settings-v2 规格：padding 40px 40px 32px + 标题
 * 15px/640/lh1 + 底部 24px 渐隐）+ 骨架组装 + render/unmount 契约 + 深链
 * 定位。视图契约：render(container, params) + unmount()（关页前收尾保存）。
 */

import { sendSettings } from "../api.js";
import {
  settingsCache,
  setSettingsCache,
  markPromptsLoaded,
  applyTheme,
  rebuildKeymap,
} from "../state.js";
import { appendLine } from "../feedback.js";
import { go } from "../router.js";
import { injectIcons } from "../icons.js";
import { flushSettings, setRefillForms } from "./settings/core.js";
import * as basic from "./settings/basic.js";
import * as agents from "./settings/agents.js";
import * as system from "./settings/system.js";

// —— 二级分类导航三组（方案 §三批 A：基础设置/Agent 能力/数据与系统）
const NAV_GROUPS = [
  {
    title: "基础设置",
    sections: [
      ["providers", "供应商"],
      ["credentials", "凭据"],
      ["permission", "权限档"],
      ["sandbox", "沙箱档"],
      ["appearance", "外观与语言"],
      ["profiles", "场景配置档"],
    ],
  },
  {
    title: "Agent 能力",
    sections: [
      ["mcp", "MCP 服务器"],
      ["skills", "技能"],
      ["subagents", "子智能体"],
      ["prompts", "提示词模板"],
      ["enhancement", "辅助模型"],
      ["plugins", "插件"],
      ["speech", "语音【实验性】"],
    ],
  },
  {
    title: "数据与系统",
    sections: [
      ["projects", "项目"],
      ["instructions", "指令中心"],
      ["shortcuts", "快捷键"],
      ["transfer", "导入与导出"],
      ["logging", "日志"],
      ["about", "关于"],
    ],
  },
];

const NAV_HTML = NAV_GROUPS.map(
  (group) =>
    `<div class="nav-group-title">${group.title}</div>` +
    group.sections
      .map(([id, label]) => `<button type="button" class="nav-item" data-nav="${id}">${label}</button>`)
      .join(""),
).join("");

const TEMPLATE = `
<aside id="settings-panel" aria-label="设置中心">
  <div class="settings-layout">
    <nav class="settings-nav" aria-label="设置分类">${NAV_HTML}</nav>
    <div class="settings-page">
      <header class="tab-header">
        <h1 class="tab-title">设置</h1>
        <button id="settings-close" type="button" class="btn btn-ghost">关闭</button>
      </header>
      <div class="tab-body">
        ${basic.SECTIONS_HTML}
        ${agents.SECTIONS_HTML}
        ${system.SECTIONS_HTML}
      </div>
    </div>
  </div>
</aside>
`;

/**
 * 二级分类导航：单分节页面切换（T-P3-135 走查反馈修正——用户裁决"每个 tab
 * 单独一个页面，不是全堆一长页"：DOM 保留 19 分节〔异步清单不重复拉取〕，
 * 显示层只呈现激活分节，其余 display:none）+ 激活态（深链 #settings/<section>
 * 同入口）。history.replaceState 同步 hash 不触发路由重挂载——分节切换是
 * 视图内导航，浏览器前进后退仍可跨分节。
 */
function navigateToSection(sectionId) {
  const section = document.querySelector(`#settings-panel [data-section="${sectionId}"]`);
  if (section === null) return;
  for (const btn of document.querySelectorAll("#settings-panel .settings-nav .nav-item")) {
    btn.classList.toggle("active", btn.dataset.nav === sectionId);
  }
  for (const el of document.querySelectorAll("#settings-panel .tab-body > section")) {
    el.classList.toggle("section-active", el === section);
  }
  section.scrollIntoView({ block: "start", behavior: "instant" }); // 分节内长清单回到顶部
  history.replaceState(null, "", `#settings/${sectionId}`);
}

/** 全分节表单回填（open 拉取后 / 导入成功后共用——原 fillSettingsForm 语义）。 */
function refillAllForms() {
  basic.fill();
  agents.fill();
  system.fill();
}

async function open() {
  const envelope = await sendSettings({ op: "get" });
  if (!envelope.ok) {
    appendLine(`设置读取失败：${envelope.error?.message ?? ""}`, "warn");
    return;
  }
  setSettingsCache(envelope.result.settings);
  markPromptsLoaded();
  applyTheme(settingsCache.appearance?.theme);
  rebuildKeymap(); // U25：键位表随 settings 就绪
  refillAllForms();
  basic.refreshCredentials(); // U2：凭据清单（掩码回显）
  agents.refreshLists(); // U22/U23/T-P3-133：技能/子代理/插件清单（文件系统面每次打开刷新）
  system.refreshInstructionsOnce(); // U24：指令中心（打开时拉一次，保存后局部刷新）
}

function bindShell() {
  document.getElementById("settings-close").addEventListener("click", () => {
    go("chat"); // unmount 收尾保存（原"关面板前 flushSettings"语义）
  });
  // 二级分类导航（单分节页面切换 + hash 同步——视图内导航不触发路由重挂载）
  for (const btn of document.querySelectorAll("#settings-panel .settings-nav .nav-item")) {
    btn.addEventListener("click", () => navigateToSection(btn.dataset.nav));
  }
}

export async function render(container, route) {
  container.innerHTML = TEMPLATE;
  injectIcons(container);
  setRefillForms(refillAllForms);
  bindShell();
  basic.bind();
  agents.bind();
  system.bind();
  await open();
  // 单分节页面：深链 #settings/<section> 直达，缺省首分节（DOM 全挂载、
  // 显示层单分节——必须显式激活一个，否则 CSS 默认全隐藏）
  navigateToSection(route?.section ?? "providers");
}

export function unmount() {
  void flushSettings(); // 关页前收尾保存（原 settings-close 语义——导航通用化）
  system.unmount(); // 捕获态监听移除 + 捕获态不跨视图存活
}

// —— 壳级导出（app.js 经动态 import("views/settings.js") 委派——设置域归属
// 面）：Profiles 快速切换在 basic、深链确认在 system，壳只转发。
export function applyQuickProfile(name) {
  basic.applyQuickProfile(name);
}

export function applyDeepLink(encodedData) {
  return system.applyDeepLink(encodedData);
}
