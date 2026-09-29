/**
 * Tauri 桌面壳结构断言（K2/T-P1-129）——"最小壳"红线的机内化（acp.test
 * fs 扫描先例）：Rust 面文件数与依赖闭集、tauri.conf.json 形状（frontendDist
 * 指向 ui/ 静态资产、bundle 收窄 nsis）、capabilities 零插件——桌面壳的
 * 行为学自 cc-switch·src-tauri（conf 形状 + windows_subsystem 惯例），业务
 * 与插件群不取（展卡核对结论④）。结构面机验；安装体积实测落完成记录。
 * T-P3-134 批 A：ui 巨石拆分为模块（api/state/feedback/router/icons +
 * views/*）——既有断言全保留，标记按所在模块重定目标；新增侧栏/路由
 * 容器/图标注入/深链解析断言（拆分零功能丢失的机验面）。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const TAURI_DIR = path.resolve(import.meta.dirname, "..", "..", "src-tauri");

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      // target/ 与 gen/ 是构建产物（.gitignore 在案）——结构断言只看源面
      if (name === "target" || name === "gen") continue;
      out.push(...listFiles(p));
    } else {
      out.push(p);
    }
  }
  return out;
}

describe("K2/T-P1-129 · Tauri 桌面壳结构红线", () => {
  it("Rust 面最小：.rs 恰 3 文件（main/lib/build）且 lib+main 无业务（无第三方 use）", () => {
    const rsFiles = listFiles(TAURI_DIR).filter((f) => f.endsWith(".rs"));
    const names = rsFiles.map((f) => path.basename(f)).sort();
    expect(names).toEqual(["build.rs", "lib.rs", "main.rs"]);
    const lib = readFileSync(path.join(TAURI_DIR, "src", "lib.rs"), "utf8");
    expect(lib).toContain("tauri::Builder::default()");
    expect(lib).toContain("tauri::generate_context!()");
    // 九插件群不取——U7/T-P3-114 解禁例外：updater 恰一插件（签名校验链）
    const pluginRegs = lib.match(/\.plugin\(/g) ?? [];
    expect(pluginRegs).toHaveLength(1);
    expect(lib).toContain("tauri_plugin_updater");
    const main = readFileSync(path.join(TAURI_DIR, "src", "main.rs"), "utf8");
    // cc-switch main.rs 同款 release 惯例（windows_subsystem）
    expect(main).toContain('windows_subsystem = "windows"');
  });

  it("Cargo.toml 依赖闭集：tauri + updater 单插件（U7 解禁例外）+ serde_json（generate_context 面）", () => {
    const cargo = readFileSync(path.join(TAURI_DIR, "Cargo.toml"), "utf8");
    const depsSection = cargo.split("[dependencies]")[1]?.split("\n[") ?? [];
    const deps = (depsSection[0] ?? "")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"));
    expect(deps.length).toBe(3);
    expect(cargo).toContain('tauri = { version = "2"');
    expect(cargo).toContain("tauri-plugin-updater");
    expect(cargo).toContain('serde_json = "1"');
    expect(cargo).toContain("tauri-build");
    // 行数纪律：Cargo.toml 保持最小面（updater 注释两行使上限放宽）
    expect(cargo.split("\n").length).toBeLessThanOrEqual(44);
  });

  it("tauri.conf.json 形状：frontendDist 指向 ui/ 静态资产 + bundle 收窄 nsis + 主/画中画双窗口（K9/T-P2-409）", () => {
    const conf = JSON.parse(readFileSync(path.join(TAURI_DIR, "tauri.conf.json"), "utf8"));
    expect(conf.build.frontendDist).toBe("../ui");
    expect(conf.build.beforeBuildCommand).toBeUndefined(); // 零前端构建链
    expect(conf.bundle.targets).toEqual(["nsis"]);
    expect(conf.bundle.active).toBe(true);
    // K9：双窗口——main（主操作面）+ pip（画中画：小尺寸 always-on-top
    // 第二窗口，visible:false 由主面唤起，加载 pip.html 只读渲染面）
    expect(conf.app.windows).toHaveLength(2);
    const main = conf.app.windows[0];
    const pip = conf.app.windows[1];
    expect(main.label).toBe("main");
    expect(pip.label).toBe("pip");
    expect(pip.alwaysOnTop).toBe(true);
    expect(pip.visible).toBe(false);
    expect(pip.resizable).toBe(false);
    expect(pip.width).toBeLessThanOrEqual(400);
    expect(pip.height).toBeLessThanOrEqual(300);
    expect(pip.url).toBe("pip.html");
    expect(conf.app.security.csp).toContain("connect-src");
    // 连接面：CSP 放开本机回环 WS（host 进程）
    expect(conf.app.security.csp).toContain("ws://127.0.0.1");
  });

  it("capabilities 最小面：core:default + updater:default（U7 解禁例外恰一项）", () => {
    const caps = JSON.parse(
      readFileSync(path.join(TAURI_DIR, "capabilities", "default.json"), "utf8"),
    );
    // K9：画中画窗口同受 capabilities 约束（core:default 最小面不变）
    expect(caps.windows).toEqual(["main", "pip"]);
    expect(caps.permissions).toEqual(["core:default", "updater:default"]);
  });

  it("ui/ 资产在位：入口三件 + 批 A 模块化拆分（共享层五件 + views 六件）（K2/K5 同一份资产不漂移）", () => {
    const uiDir = path.resolve(import.meta.dirname, "..", "..", "ui");
    for (const name of [
      "index.html",
      "app.js",
      "style.css",
      // T-P3-134 批 A 模块化拆分产物（方案 §三批 A 文件结构树）
      "theme.css",
      "components.css",
      "icons.js",
      "router.js",
      "api.js",
      "state.js",
      "feedback.js",
      "views/settings.js",
      "views/usage.js",
      "views/work.js",
      "views/notify.js",
      "views/history.js",
      "views/search.js",
    ]) {
      expect(statSync(path.join(uiDir, ...name.split("/"))).isFile()).toBe(true);
    }
    const api = readFileSync(path.join(uiDir, "api.js"), "utf8");
    // 桌面/网页双端同源判定（surfaceId 前缀 web-/desktop-——批 A 下沉协议面）
    expect(api).toContain("__TAURI_INTERNALS__");
    expect(api).toContain('"desktop"');
  });

  it("U14/T-P3-103 · 设置中心资产：分节齐全 + 主题变量在位 + 导航入口（分节与 settings 模块一一对应）", () => {
    const uiDir = path.resolve(import.meta.dirname, "..", "..", "ui");
    const read = (name: string) => readFileSync(path.join(uiDir, ...name.split("/")), "utf8");
    const html = read("index.html");
    const app = read("app.js");
    const css = read("style.css");
    const theme = read("theme.css");
    const settingsView = read("views/settings.js");
    const usageView = read("views/usage.js");
    const workView = read("views/work.js");
    const historyView = read("views/history.js");
    const searchView = read("views/search.js");
    const state = read("state.js");
    // 批 A 重定目标说明：原断言读 app.js/index.html 巨石；拆分后标记随
    // 代码/标记所在模块核对（断言本体一条不删）。
    // 十九分节（……speech、plugins、about——settings.json 各段与文件位
    // 一一对应；speech 为 U26/T-P3-129 语音【实验性】；plugins 为 T-P3-133
    // 插件管理——I4/I5/I9 管理面延伸）——批 A 迁 views/settings.js
    for (const section of ["providers", "credentials", "permission", "sandbox", "appearance", "logging", "projects", "prompts", "skills", "subagents", "instructions", "shortcuts", "mcp", "enhancement", "profiles", "transfer", "speech", "plugins", "about"]) {
      expect(settingsView).toContain(`data-section="${section}"`);
    }
    // 导航入口（侧栏齿轮——批 A 布局骨架）与凭据不回显（U2 面注入防呆）
    expect(html).toContain('id="settings-btn"');
    expect(settingsView).toContain('type="password"');

    // settings 信封直答（get/update + credentials-*）与即改即存（防抖合并）
    expect(app).toContain('op: "get"'); // 入口 maybeOnboard/引导完成写回
    expect(app).toContain('op: "update"'); // 入口 ob-done
    expect(settingsView).toContain("credentials-set");
    expect(settingsView).toContain("credentials-delete");
    expect(settingsView).toContain("markDirty");
    // U5/T-P3-104：会话期切换（model/switch）+ 健康徽标（probe 消费 + 节流）+ 编辑
    expect(settingsView).toContain('"model/switch"');
    expect(settingsView).toContain('op: "probe"');
    expect(settingsView).toContain("HEALTH_THROTTLE_MS");
    expect(settingsView).toContain("editingProviderName");
    // 主题全端一致：改动即应用 body[data-theme]（dataset.theme——批 A 下沉 state.js）
    expect(state).toContain("dataset.theme");

    // U3/T-P3-105：会话历史页（清单/只读查看/删除确认/resume 提示——批 A 迁 views/history.js）
    expect(historyView).toContain('id="history-panel"');
    expect(historyView).toContain('id="history-list"');
    expect(historyView).toContain('op: "sessions"');
    expect(historyView).toContain('op: "session-delete"');
    expect(historyView).toContain("window.confirm"); // 硬删除确认对话框
    expect(historyView).toContain("aegent sessions resume"); // 续聊入口提示

    // U4/T-P3-107 · 渲染分层资产：vendor 本地化 + THIRD_PARTY 登记 + 分层标记（XSS 防呆面在位）
    for (const name of [
      "vendor/marked.esm.js",
      "vendor/highlight.esm.js",
      "vendor/LICENSE.marked.md",
      "vendor/LICENSE.highlight.js",
      "vendor/README.md",
    ]) {
      expect(statSync(path.join(uiDir, ...name.split("/"))).isFile()).toBe(true);
    }
    const thirdParty = readFileSync(
      path.resolve(import.meta.dirname, "..", "..", "THIRD_PARTY.md"),
      "utf8",
    );
    expect(thirdParty).toContain("marked@16.4.2");
    expect(thirdParty).toContain("highlight.js@11.12.0");

    const render = read("render.js");
    // XSS 防呆在管线内固化（行为机验见 ui-render.test.ts 动态 import 直测）
    expect(render).toContain("./vendor/marked.esm.js");
    expect(render).toContain("./vendor/highlight.esm.js");
    expect(render).toContain("md-html-raw"); // 禁 HTML 透传（转义可见）
    expect(render).toContain("/^(https?:|mailto:)/i"); // href 协议白名单
    expect(render).toContain("parseDenial"); // C55 拒绝面解析
    expect(render).toContain("buildDiffLines"); // 写操作 diff 对照

    // 分层：assistant 走管线（import renderMarkdown）；用户输入 textContent 不渲染
    expect(app).toContain('from "./render.js"');
    expect(app).toContain("typeStream"); // 流式打字（rAF 节流）
    expect(app).toContain("requestAnimationFrame");
    expect(app).toContain("data-call-id"); // 工具卡 callId 成对
    expect(app).toContain(".code-copy"); // 代码块复制（事件委托）
    expect(app).toContain("retry-btn"); // 错误重试交互
    expect(app).toContain('className = "chip"'); // 审批卡 C54 分类 chip
    expect(app).toContain("countdown"); // 审批卡超时倒计时

    // 气泡/工具卡/代码块/diff/拒绝面样式在位 + hljs token 色
    for (const marker of [".bubble", ".tool-card", ".code-block", ".diff-row", ".denial", ".hljs-keyword"]) {
      expect(css).toContain(marker);
    }
    // U9/T-P3-108：会话内搜索条 + 跨会话搜索页 + 小地图（导航/检索资产）
    expect(html).toContain('id="find-bar"');
    expect(html).toContain('id="find-input"');
    expect(html).toContain('id="minimap"');
    expect(searchView).toContain('id="search-panel"');
    expect(searchView).toContain('id="search-results"');
    expect(searchView).toContain('op: "search"'); // Q2 检索的 UI 消费
    expect(app).toContain("findInStream"); // 渲染层文本检索
    expect(app).toContain("minimapRegister"); // 消息结构导航条
    // U10/T-P3-109：Composer 升级（多行/两类补全/粘贴图入附件链）
    expect(html).toContain('id="autocomplete"');
    expect(html).toContain('id="attachments-preview"');
    expect(html).toContain("<textarea");
    expect(app).toContain("UI_COMMANDS"); // 斜杠命令本地集
    expect(app).toContain("addAttachment"); // 粘贴图 → 附件链
    expect(app).toContain("MAX_ATTACHMENT_BYTES"); // 限额防呆与 limits.ts 同源
    // @ / 补全数据面（op:"files"/op:"meta"——批 A 下沉 api.js 会话期缓存）
    expect(read("api.js")).toContain('op: "files"'); // @ 补全的 workspace 列举面
    expect(read("api.js")).toContain('op: "meta"'); // / 补全的清单来源（ready 捕获）
    expect(app).toContain("ensurePromptsCache"); // / 补全的模板数据面
    expect(app).toContain('kind: "prompt"'); // 补全候选混入标记
    expect(app).toContain("templateVarNames"); // {{var}} 变量提取（UI 侧）
    // U11/T-P3-110 项目页 CRUD（批 A 迁 views/settings.js）
    expect(settingsView).toContain("renderProjectList"); // U11 项目页 CRUD
    expect(settingsView).toContain('markDirty("activeProject")'); // 切换即改即存
    expect(settingsView).toContain("project-instructions"); // 项目级指令编辑面
    // U16/T-P3-118：提示词模板库（settings prompts 段 CRUD + / 补全调用）
    expect(settingsView).toContain('id="prompt-list"');
    expect(settingsView).toContain('id="prompt-form"');
    expect(settingsView).toContain("renderPromptList"); // 库列表渲染
    // U17/T-P3-119：MCP 管理向导（分步表单 + 测连接 + 统一面板）
    expect(settingsView).toContain('id="mcp-list"');
    expect(settingsView).toContain('id="mcp-wizard"');
    expect(settingsView).toContain('id="mcp-step2"');
    expect(settingsView).toContain('id="mcp-test"');
    expect(settingsView).toContain('op: "mcp-check"'); // 连接校验数据面
    expect(settingsView).toContain("renderMcpList"); // 统一面板（启停/编辑/删除）
    expect(settingsView).toContain("editingMcpName"); // 编辑回填状态
    // U22/T-P3-125：技能管理（清单/编辑器写回/来源目录/停用开关）
    expect(settingsView).toContain('id="skill-list"');
    expect(settingsView).toContain('id="skill-editor"');
    expect(settingsView).toContain('id="skill-roots"');
    expect(settingsView).toContain('id="skill-root-form"');
    expect(settingsView).toContain('op: "skills-list"'); // 清单数据面
    expect(settingsView).toContain('op: "skill-save"'); // 编辑器写回
    expect(settingsView).toContain("refreshSkillsList"); // 清单刷新
    expect(settingsView).toContain('markDirty("skills")'); // 停用/来源即改即存
    expect(settingsView).toContain("skillToolsSelected"); // 工具集多选
    // U23/T-P3-126：子智能体管理（内置预设卡/自定义 CRUD/模型与 fallback）
    expect(settingsView).toContain('id="subagent-list"');
    expect(settingsView).toContain('id="subagent-editor"');
    expect(settingsView).toContain('id="subagent-fallbacks"');
    expect(settingsView).toContain('op: "subagents-list"'); // 清单数据面
    expect(settingsView).toContain("refreshSubagentsList"); // 清单刷新
    expect(settingsView).toContain('markDirty("subagents")'); // CRUD 即改即存
    expect(settingsView).toContain("subagentToolsSelected"); // 工具集多选
    // U24/T-P3-127：指令中心（三文件位编辑/保存确认/规则 lint/模板插入）
    expect(settingsView).toContain('id="instr-project"');
    expect(settingsView).toContain('id="instr-rules"');
    expect(settingsView).toContain('id="instr-rules-lint"');
    expect(settingsView).toContain("instr-save"); // 保存按钮 class
    expect(settingsView).toContain("instr-tpl"); // 模板插入按钮 class
    expect(settingsView).toContain('op: "instructions-list"'); // 数据面
    expect(settingsView).toContain('op: "instruction-save"'); // 写回
    expect(settingsView).toContain("INSTR_TEMPLATES"); // 模板插入辅助
    expect(settingsView).toContain("renderRulesLint"); // 规则 lint 提示面
    // U25/T-P3-128：快捷键注册表（清单/捕获改绑/冲突提示）+ 设置分节
    expect(settingsView).toContain('id="shortcut-list"');
    expect(settingsView).toContain('id="shortcut-reset"');
    expect(settingsView).toContain("renderShortcutList"); // 清单渲染
    expect(settingsView).toContain("capturingAction"); // 捕获态
    expect(state).toContain("rebuildKeymap"); // 键位表随 settings 同步（批 A 下沉 state.js）
    expect(settingsView).toContain('markDirty("shortcuts")'); // 改绑即改即存
    // U26/T-P3-129：语音【实验性】（STT 配置分节 + Composer 麦克风 +
    // 录音转写链 + 权限拒绝降级）
    expect(settingsView).toContain('id="stt-baseurl"');
    expect(settingsView).toContain('id="stt-model"');
    expect(settingsView).toContain("语音【实验性】");
    expect(html).toContain('id="mic-btn"'); // Composer 麦克风按钮
    expect(app).toContain('op: "stt-transcribe"'); // 转写代理数据面
    expect(app).toContain("MediaRecorder"); // 浏览器录音 API
    expect(app).toContain("NotAllowedError"); // 权限拒绝降级
    expect(settingsView).toContain('markDirty("stt")'); // STT 配置即改即存
    // T-P3-133：插件管理（清单/安装表单/启停删除——I4/I5/I9 管理面延伸）
    expect(settingsView).toContain('id="plugin-list"');
    expect(settingsView).toContain('id="plugin-transport"');
    expect(settingsView).toContain('id="plugin-add"');
    expect(settingsView).toContain('op: "plugins-list"'); // 清单数据面
    expect(settingsView).toContain("refreshPluginsList"); // 清单刷新
    expect(settingsView).toContain('markDirty("plugins")'); // 启停/安装即改即存
    // U18/T-P3-120：辅助模型分节（judge/summarizer 独立配置 + 回退链 hint）
    expect(settingsView).toContain('id="enh-judge-provider"');
    expect(settingsView).toContain('id="enh-summarizer-model"');
    expect(settingsView).toContain('markDirty("enhancement")'); // 即改即存
    expect(settingsView).toContain("回退主模型链"); // 缺省回退语义提示
    // U19/T-P3-121：Profiles 组合档 + 故障转移优先级排序 + 侧栏快速切换
    expect(settingsView).toContain('id="profile-list"');
    expect(html).toContain('id="profile-quick"'); // 侧栏底部快速器（批 A 骨架）
    expect(settingsView).toContain('id="profile-snapshot"');
    expect(settingsView).toContain("applyProfileValues"); // 切换 = 批量写生效段
    expect(settingsView).toContain("故障转移优先级"); // 排序按钮提示（↑↓ = J15 队列序）
    // U20/T-P3-122：导入导出（确认面 + 备份 + 深链钩子）
    expect(settingsView).toContain('id="export-btn"');
    expect(settingsView).toContain('id="import-file"');
    expect(settingsView).toContain('id="import-apply"');
    expect(settingsView).toContain('op: "import"'); // 导入 wire 面
    expect(app).toContain("aegentApplyDeepLink"); // 深链宿主接线钩子（入口委派设置域）
    expect(settingsView).toContain("确认导入"); // 导入必确认（不可信输入面）
    expect(settingsView).toContain("不含凭据"); // 零明文纪律的 UI 提示
    // U12/T-P3-111：用量页（上下文检查器 + 成本统计页——J21 消费端；批 A 迁 views/usage.js）
    expect(usageView).toContain('id="usage-panel"');
    expect(usageView).toContain('id="ctx-meter-fill"');
    expect(usageView).toContain('id="cost-table"');
    expect(usageView).toContain('op: "usage"'); // 聚合数据源单源
    expect(usageView).toContain("已压缩"); // 压缩状态可见
    expect(usageView).toContain("pricing 段未配置"); // 无价格不虚构的成本解释面
    // U13/T-P3-112 五件套：通知中心/Toast/引导/恢复横幅/更新横幅（消费端钩子）
    expect(historyView).toContain("window.confirm"); // 硬删除确认（会话删除）
    expect(read("views/notify.js")).toContain('id="notify-panel"'); // 通知中心（批 A 迁 views/notify.js）
    expect(html).toContain('id="toast-area"');
    expect(html).toContain('id="onboarding"');
    expect(html).toContain('id="recovery-banner"');
    expect(html).toContain('id="update-banner"');
    expect(html).toContain('id="release-notes"');
    expect(app).toContain('name === "n5"'); // N5 分型消费
    expect(app).toContain("consumeN5");
    expect(app).toContain("onboardingDone"); // 首跑标记（settings）
    expect(app).toContain("showRecoveryIfInterrupted"); // M3 可视化
    expect(app).toContain("aegentShowUpdate"); // U7 接线点（T-P3-114）
    // U15/T-P3-117：工作面板四 Tab（文件树/变更评审/子代理监控/协作——批 A 迁 views/work.js）
    expect(workView).toContain('id="workpanel"');
    expect(html).toContain('id="work-btn"'); // 侧栏导航入口
    expect(workView).toContain('data-worktab="files"');
    expect(workView).toContain('data-worktab="review"');
    expect(workView).toContain('data-worktab="subagent"');
    expect(workView).toContain('id="work-filetree"');
    expect(workView).toContain('id="work-delegation-table"');
    expect(workView).toContain('op: "review"'); // 变更/委派纯函数直答数据源
    expect(workView).toContain('op: "file"'); // 文件树点击预览
    expect(workView).toContain("refreshWorkReview"); // turn_settled 自动刷新接线
    expect(workView).toContain("previewWorkspaceFile");
    expect(workView).toContain('data-worktab="collab"'); // U27 协作 Tab
    expect(workView).toContain('id="work-collab-table"');
    for (const marker of [".work-tab", ".tree-row", ".review-badge", "#work-preview"]) {
      expect(css).toContain(marker);
    }
    for (const marker of [".search-hit", ".mm-row", "#find-bar", "#minimap", ".ac-row", ".attachment-chip"]) {
      expect(css).toContain(marker);
    }
    // 主题 token 层（批 A 迁 theme.css——全站唯一取色处；亮色覆盖在位）
    expect(theme).toContain('body[data-theme="light"]');
    expect(theme).toContain("--bg:");
    expect(theme).toContain("--accent:"); // 旧名兼容别名（style.css 消费面）
    expect(css).toContain('@import "./theme.css"'); // token 层接入点
  });

  it("T-P3-134 · UI 批次 A：布局骨架（侧栏/路由容器）+ 图标注入 + hash 深链解析 + 组件类库", async () => {
    const uiDir = path.resolve(import.meta.dirname, "..", "..", "ui");
    const read = (name: string) => readFileSync(path.join(uiDir, ...name.split("/")), "utf8");
    const html = read("index.html");
    // 布局骨架：侧栏（260px/折叠 rail）+ 主内容路由容器 + 对话默认页
    for (const id of ["app-shell", "sidebar", "sidebar-toggle", "main", "view-root", "chat-view", "stream", "composer", "pending"]) {
      expect(html).toContain(`id="${id}"`);
    }
    // 侧栏导航组（图标 + 文案 + data-route）与底部状态区（租约/surface/连接/快速器）
    for (const route of ["chat", "history", "search", "work", "usage", "notify", "settings"]) {
      expect(html).toContain(`data-route="${route}"`);
    }
    expect(html).toContain('id="conn-status"');
    expect(html).toContain('id="surface-id"');
    expect(html).toContain('id="lease-status"');
    expect(html).toContain('id="lease-btn"');
    // 图标注入面：data-icon 占位 + icons.js 图标集（≥24 枚）+ 注入函数
    expect(html).toContain('data-icon="chat"');
    const icons = read("icons.js");
    expect(icons).toContain("export const ICON_NAMES");
    expect(icons).toContain("export function icon(");
    expect(icons).toContain("export function injectIcons(");
    const mod = await import(pathToFileURL(path.join(uiDir, "icons.js")).href);
    expect(mod.ICON_NAMES.length).toBeGreaterThanOrEqual(24);
    // hash 路由深链用例（router.js parseHash 纯函数——直测）
    const router = await import(pathToFileURL(path.join(uiDir, "router.js")).href);
    expect(router.parseHash("")).toEqual({ view: "chat" });
    expect(router.parseHash("#chat")).toEqual({ view: "chat" });
    expect(router.parseHash("#usage")).toEqual({ view: "usage" });
    expect(router.parseHash("#notify")).toEqual({ view: "notify" });
    expect(router.parseHash("#history")).toEqual({ view: "history" });
    expect(router.parseHash("#search")).toEqual({ view: "search" });
    expect(router.parseHash("#settings")).toEqual({ view: "settings", section: null });
    expect(router.parseHash("#settings/mcp")).toEqual({ view: "settings", section: "mcp" });
    expect(router.parseHash("#work")).toEqual({ view: "work", tab: null });
    expect(router.parseHash("#work/review")).toEqual({ view: "work", tab: "review" });
    expect(router.parseHash("#bogus")).toEqual({ view: "chat" }); // 未知路由回对话
    // 组件类库（方案 §2.5 目录批 A 基线——逐页接入归批 B）
    const components = read("components.css");
    for (const cls of [".btn", ".btn-primary", ".btn-danger", ".input", ".switch", ".tabs-pill", ".row-list", ".row", ".chip-ui", ".table", ".empty-state", ".skeleton", ".dialog", ".kbd", ".toast", ".status-dot"]) {
      expect(components).toContain(cls);
    }
    // token 证伪：组件类库零散写色值（var(--token) 消费——取色唯一处 theme.css）
    expect(components).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(components).not.toMatch(/rgba?\(/);
  });

  it("U6/T-P3-113 · sidecar 分发面：bundle 脚本 + 壳进程管理（起 host/健康探测/退出收束）+ 资源清单", () => {
    const root = path.resolve(import.meta.dirname, "..", "..");
    // ①②便携 bundle 面：build:single 脚本 + 布局构建器（SEA 回退②案）
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build:single"]).toContain("build-host-bundle.mjs");
    expect(statSync(path.join(root, "tools", "build-host-bundle.mjs")).isFile()).toBe(true);
    expect(statSync(path.join(root, "tools", "sea-attempt.mjs")).isFile()).toBe(true); // ①案失败实证脚本
    // ③壳 Rust 侧进程管理：spawn host.cjs / TCP 健康探测 / RunEvent::Exit kill
    const lib = readFileSync(path.join(root, "src-tauri", "src", "lib.rs"), "utf8");
    expect(lib).toContain('"host.cjs"'); // 起 portable host
    expect(lib).toContain('"--agent-entry"'); // 子进程入口传参
    expect(lib).toContain("TcpStream::connect"); // TCP 健康探测
    expect(lib).toContain("RunEvent::Exit"); // 退出收束
    expect(lib).toContain("child.kill()");
    expect(lib).toContain("settings.json"); // 启动参数来自 U1 配置（壳不加环境变量的说明）
    // ④资源清单：portable 布局随安装器分发（与 exe 同目录——exe_dir 解析）
    const conf = readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8");
    for (const marker of ["host.cjs", "agent-child.cjs", "node.exe", "schema.sql", "ui/"]) {
      expect(conf).toContain(marker);
    }
    expect(conf).toContain('"visible": false'); // 主窗先隐藏（健康探测后进 UI）
    // U7/T-P3-114：updater 接线（插件解禁例外 + 签名链 + 本地演示面）
    const cargo = readFileSync(path.join(root, "src-tauri", "Cargo.toml"), "utf8");
    expect(cargo).toContain("tauri-plugin-updater"); // 单插件入册
    expect(lib).toContain("tauri_plugin_updater::Builder::new()"); // 插件注册
    expect(lib).toContain("spawn_update_check"); // 启动检查
    expect(lib).toContain("aegentShowUpdate"); // UI 横幅钩子（U13 消费端）
    expect(conf).toContain("createUpdaterArtifacts"); // 构建签名产物
    expect(conf).toContain('"pubkey"'); // minisign 公钥（private/ 生成）
    // localhost 演示例外（updater 演示端点——默认拒绝策略的显式白名单）
    expect(conf).toContain("dangerousInsecureTransportProtocol"); // localhost 演示例外
    for (const name of ["gen-update-keys.mjs", "update-demo.mjs"]) {
      expect(statSync(path.join(root, "tools", name)).isFile()).toBe(true);
    }
  });

  it("K9/T-P2-409 · 画中画资产在位：pip.html + pip.js + pip.css（S4 操作审计消费端——只读渲染面）", () => {
    const uiDir = path.resolve(import.meta.dirname, "..", "..", "ui");
    for (const name of ["pip.html", "pip.js", "pip.css"]) {
      expect(statSync(path.join(uiDir, name)).isFile()).toBe(true);
    }
    const pipJs = readFileSync(path.join(uiDir, "pip.js"), "utf8");
    // 只过滤 computer_* 工具事件（S4 操作审计消费端）
    expect(pipJs).toContain("computer_");
    expect(pipJs).toContain("tool/call");
    expect(pipJs).toContain("tool/result");
    // 只读渲染面：不发写命令（无 prompt/approve UI——零租约竞取）
    expect(pipJs).not.toContain('"prompt"');
    expect(pipJs).not.toContain('"approve"');
    // surfaceId 前缀 pip-（不参与租约竞取的观察端）
    expect(pipJs).toContain("pip-");
  });
});
