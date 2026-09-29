/**
 * Tauri 桌面壳结构断言（K2/T-P1-129）——"最小壳"红线的机内化（acp.test
 * fs 扫描先例）：Rust 面文件数与依赖闭集、tauri.conf.json 形状（frontendDist
 * 指向 ui/ 静态资产、bundle 收窄 nsis）、capabilities 零插件——桌面壳的
 * 行为学自 cc-switch·src-tauri（conf 形状 + windows_subsystem 惯例），业务
 * 与插件群不取（展卡核对结论④）。结构面机验；安装体积实测落完成记录。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

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

  it("ui/ 资产在位：index.html + app.js + style.css（K2/K5 同一份资产不漂移）", () => {
    const uiDir = path.resolve(import.meta.dirname, "..", "..", "ui");
    for (const name of ["index.html", "app.js", "style.css"]) {
      expect(statSync(path.join(uiDir, name)).isFile()).toBe(true);
    }
    const app = readFileSync(path.join(uiDir, "app.js"), "utf8");
    // 桌面/网页双端同源判定（surfaceId 前缀 web-/desktop-）
    expect(app).toContain("__TAURI_INTERNALS__");
    expect(app).toContain('"desktop"');
  });

  it("U14/T-P3-103 · 设置中心资产：分节齐全 + 主题变量在位 + 导航入口（分节与 settings 模块一一对应）", () => {
    const uiDir = path.resolve(import.meta.dirname, "..", "..", "ui");
    const html = readFileSync(path.join(uiDir, "index.html"), "utf8");
    // 八分节（providers/credentials/permission/sandbox/appearance/logging/projects/about——
    // settings.json 各段一一对应；U5 卡在 providers 分节扩展切换与健康徽标；
    // logging 为 T-P3-132 #28 补落；projects 为 U11/T-P3-110 项目档）
    for (const section of ["providers", "credentials", "permission", "sandbox", "appearance", "logging", "projects", "prompts", "mcp", "enhancement", "profiles", "transfer", "about"]) {
      expect(html).toContain(`data-section="${section}"`);
    }
    // 导航入口（状态栏齿轮）与凭据不回显（U2 面注入防呆）
    expect(html).toContain('id="settings-btn"');
    expect(html).toContain('type="password"');

    const app = readFileSync(path.join(uiDir, "app.js"), "utf8");
    // settings 信封直答（get/update + credentials-*）与即改即存（防抖合并）
    expect(app).toContain('op: "get"');
    expect(app).toContain('op: "update"');
    expect(app).toContain("credentials-set");
    expect(app).toContain("credentials-delete");
    expect(app).toContain("markDirty");
    // U5/T-P3-104：会话期切换（model/switch）+ 健康徽标（probe 消费 + 节流）+ 编辑
    expect(app).toContain('"model/switch"');
    expect(app).toContain('op: "probe"');
    expect(app).toContain("HEALTH_THROTTLE_MS");
    expect(app).toContain("editingProviderName");
    // 主题全端一致：改动即应用 body[data-theme]（dataset.theme 赋值）
    expect(app).toContain("dataset.theme");

    const css = readFileSync(path.join(uiDir, "style.css"), "utf8");
    // 主题变量在位（亮色覆盖 + 暗色缺省——CSS 变量方案）
    expect(css).toContain('body[data-theme="light"]');
    expect(css).toContain("--bg:");
    expect(css).toContain("--accent:");
    // U3/T-P3-105：会话历史侧栏（清单/只读查看/删除确认/resume 提示）
    expect(html).toContain('id="history-panel"');
    expect(html).toContain('id="history-list"');
    expect(app).toContain('op: "sessions"');
    expect(app).toContain('op: "session-delete"');
    expect(app).toContain("window.confirm"); // 硬删除确认对话框
    expect(app).toContain("aegent sessions resume"); // 续聊入口提示
  });

  it("U4/T-P3-107 · 渲染分层资产：vendor 本地化 + THIRD_PARTY 登记 + 分层标记（XSS 防呆面在位）", () => {
    const uiDir = path.resolve(import.meta.dirname, "..", "..", "ui");
    const html = readFileSync(path.join(uiDir, "index.html"), "utf8");
    // vendor 本地化（P3 §1 全局约束 3——两纯库 + 两 LICENSE + 出处 README）
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

    const render = readFileSync(path.join(uiDir, "render.js"), "utf8");
    // XSS 防呆在管线内固化（行为机验见 ui-render.test.ts 动态 import 直测）
    expect(render).toContain("./vendor/marked.esm.js");
    expect(render).toContain("./vendor/highlight.esm.js");
    expect(render).toContain("md-html-raw"); // 禁 HTML 透传（转义可见）
    expect(render).toContain("/^(https?:|mailto:)/i"); // href 协议白名单
    expect(render).toContain("parseDenial"); // C55 拒绝面解析
    expect(render).toContain("buildDiffLines"); // 写操作 diff 对照

    const app = readFileSync(path.join(uiDir, "app.js"), "utf8");
    // 分层：assistant 走管线（import renderMarkdown）；用户输入 textContent 不渲染
    expect(app).toContain('from "./render.js"');
    expect(app).toContain("typeStream"); // 流式打字（rAF 节流）
    expect(app).toContain("requestAnimationFrame");
    expect(app).toContain("data-call-id"); // 工具卡 callId 成对
    expect(app).toContain(".code-copy"); // 代码块复制（事件委托）
    expect(app).toContain("retry-btn"); // 错误重试交互
    expect(app).toContain('className = "chip"'); // 审批卡 C54 分类 chip
    expect(app).toContain("countdown"); // 审批卡超时倒计时

    const css = readFileSync(path.join(uiDir, "style.css"), "utf8");
    // 气泡/工具卡/代码块/diff/拒绝面样式在位 + hljs token 色
    for (const marker of [".bubble", ".tool-card", ".code-block", ".diff-row", ".denial", ".hljs-keyword"]) {
      expect(css).toContain(marker);
    }
    // U9/T-P3-108：会话内搜索条 + 跨会话搜索面板 + 小地图（导航/检索资产）
    expect(html).toContain('id="find-bar"');
    expect(html).toContain('id="find-input"');
    expect(html).toContain('id="minimap"');
    expect(html).toContain('id="search-panel"');
    expect(html).toContain('id="search-results"');
    expect(app).toContain('op: "search"'); // Q2 检索的 UI 消费
    expect(app).toContain("findInStream"); // 渲染层文本检索
    expect(app).toContain("minimapRegister"); // 消息结构导航条
    // U10/T-P3-109：Composer 升级（多行/两类补全/粘贴图入附件链）
    expect(html).toContain('id="autocomplete"');
    expect(html).toContain('id="attachments-preview"');
    expect(html).toContain("<textarea");
    expect(app).toContain('op: "files"'); // @ 补全的 workspace 列举面
    expect(app).toContain('op: "meta"'); // / 补全的清单来源（ready 捕获）
    expect(app).toContain("UI_COMMANDS"); // 斜杠命令本地集
    expect(app).toContain("addAttachment"); // 粘贴图 → 附件链
    expect(app).toContain("MAX_ATTACHMENT_BYTES"); // 限额防呆与 limits.ts 同源
    expect(app).toContain("renderProjectList"); // U11 项目页 CRUD
    expect(app).toContain("markDirty(\"activeProject\")"); // 切换即改即存
    expect(app).toContain("project-instructions"); // 项目级指令编辑面
    // U16/T-P3-118：提示词模板库（settings prompts 段 CRUD + / 补全调用）
    expect(html).toContain('id="prompt-list"');
    expect(html).toContain('id="prompt-form"');
    expect(app).toContain("renderPromptList"); // 库列表渲染
    expect(app).toContain("ensurePromptsCache"); // / 补全的模板数据面
    expect(app).toContain('kind: "prompt"'); // 补全候选混入标记
    expect(app).toContain("templateVarNames"); // {{var}} 变量提取（UI 侧）
    // U17/T-P3-119：MCP 管理向导（分步表单 + 测连接 + 统一面板）
    expect(html).toContain('id="mcp-list"');
    expect(html).toContain('id="mcp-wizard"');
    expect(html).toContain('id="mcp-step2"');
    expect(html).toContain('id="mcp-test"');
    expect(app).toContain('op: "mcp-check"'); // 连接校验数据面
    expect(app).toContain("renderMcpList"); // 统一面板（启停/编辑/删除）
    expect(app).toContain("editingMcpName"); // 编辑回填状态
    // U18/T-P3-120：辅助模型分节（judge/summarizer 独立配置 + 回退链 hint）
    expect(html).toContain('id="enh-judge-provider"');
    expect(html).toContain('id="enh-summarizer-model"');
    expect(app).toContain('markDirty("enhancement")'); // 即改即存
    expect(html).toContain("回退主模型链"); // 缺省回退语义提示
    // U19/T-P3-121：Profiles 组合档 + 故障转移优先级排序 + 状态栏快速切换
    expect(html).toContain('id="profile-list"');
    expect(html).toContain('id="profile-quick"');
    expect(html).toContain('id="profile-snapshot"');
    expect(app).toContain("applyProfileValues"); // 切换 = 批量写生效段
    expect(app).toContain("故障转移优先级"); // 排序按钮提示（↑↓ = J15 队列序）
    expect(html).toContain("故障转移优先级"); // providers 分节 hint
    // U20/T-P3-122：导入导出（确认面 + 备份 + 深链钩子）
    expect(html).toContain('id="export-btn"');
    expect(html).toContain('id="import-file"');
    expect(html).toContain('id="import-apply"');
    expect(app).toContain('op: "import"'); // 导入 wire 面
    expect(app).toContain("aegentApplyDeepLink"); // 深链宿主接线钩子
    expect(app).toContain("确认导入"); // 导入必确认（不可信输入面）
    expect(html).toContain("不含凭据"); // 零明文纪律的 UI 提示
    // U12/T-P3-111：用量面板（上下文检查器 + 成本统计页——J21 消费端）
    expect(html).toContain('id="usage-panel"');
    expect(html).toContain('id="ctx-meter-fill"');
    expect(html).toContain('id="cost-table"');
    expect(app).toContain('op: "usage"'); // 聚合数据源单源
    expect(app).toContain("已压缩"); // 压缩状态可见
    expect(app).toContain("pricing 段未配置"); // 无价格不虚构的成本解释面
    // U13/T-P3-112 五件套：通知中心/Toast/引导/恢复横幅/更新横幅（消费端钩子）
    expect(html).toContain('id="notify-panel"');
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
    // U15/T-P3-117：工作面板三 Tab（文件树/变更评审/子代理监控）+ 两新 op
    expect(html).toContain('id="workpanel"');
    expect(html).toContain('id="work-btn"');
    expect(html).toContain('data-worktab="files"');
    expect(html).toContain('data-worktab="review"');
    expect(html).toContain('data-worktab="subagent"');
    expect(html).toContain('id="work-filetree"');
    expect(html).toContain('id="work-delegation-table"');
    expect(app).toContain('op: "review"'); // 变更/委派纯函数直答数据源
    expect(app).toContain('op: "file"'); // 文件树点击预览
    expect(app).toContain("refreshWorkReview"); // turn_settled 自动刷新接线
    expect(app).toContain("previewWorkspaceFile");
    for (const marker of [".work-tab", ".tree-row", ".review-badge", "#work-preview"]) {
      expect(css).toContain(marker);
    }
    for (const marker of [".search-hit", ".mm-row", "#find-bar", "#minimap", ".ac-row", ".attachment-chip"]) {
      expect(css).toContain(marker);
    }
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
