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
    // 零插件（九插件群不取）：lib.rs 不出现插件注册面
    expect(lib).not.toMatch(/\.plugin\(/);
    const main = readFileSync(path.join(TAURI_DIR, "src", "main.rs"), "utf8");
    // cc-switch main.rs 同款 release 惯例（windows_subsystem）
    expect(main).toContain('windows_subsystem = "windows"');
  });

  it("Cargo.toml 依赖闭集：仅 tauri + tauri-build，零插件零额外运行时依赖", () => {
    const cargo = readFileSync(path.join(TAURI_DIR, "Cargo.toml"), "utf8");
    const depsSection = cargo.split("[dependencies]")[1]?.split("\n[") ?? [];
    const deps = (depsSection[0] ?? "")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"));
    expect(deps.length).toBe(1);
    expect(deps[0]).toContain("tauri =");
    expect(cargo).toContain("tauri-build");
    // 行数纪律：Cargo.toml 保持最小面
    expect(cargo.split("\n").length).toBeLessThanOrEqual(40);
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

  it("capabilities 零插件：仅 core:default 最小面", () => {
    const caps = JSON.parse(
      readFileSync(path.join(TAURI_DIR, "capabilities", "default.json"), "utf8"),
    );
    // K9：画中画窗口同受 capabilities 约束（core:default 最小面不变）
    expect(caps.windows).toEqual(["main", "pip"]);
    for (const permission of caps.permissions as string[]) {
      expect(permission.startsWith("core:")).toBe(true);
    }
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
    // 七分节（providers/credentials/permission/sandbox/appearance/logging/about——
    // settings.json 各段一一对应；U5 卡在 providers 分节扩展切换与健康徽标；
    // logging 为 T-P3-132 #28 补落）
    for (const section of ["providers", "credentials", "permission", "sandbox", "appearance", "logging", "about"]) {
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
    for (const marker of [".search-hit", ".mm-row", "#find-bar", "#minimap", ".ac-row", ".attachment-chip"]) {
      expect(css).toContain(marker);
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
