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
  it("Rust 面最小：.rs 恰 5 文件（main/lib/build/browser/picker——T-P3-158 反馈 2 文件夹选择器）且 lib+main 无业务（无第三方 use）", () => {
    const rsFiles = listFiles(TAURI_DIR).filter((f) => f.endsWith(".rs"));
    const names = rsFiles.map((f) => path.basename(f)).sort();
    expect(names).toEqual(["browser.rs", "build.rs", "lib.rs", "main.rs", "picker.rs"]); // T-P3-156 Q +browser.rs；T-P3-158 +picker.rs
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

  it("Cargo.toml 依赖闭集：tauri + updater 单插件（U7 解禁例外）+ serde_json + rfd（T-P3-158 反馈 2 选文件夹——自定义 command 不加插件）", () => {
    const cargo = readFileSync(path.join(TAURI_DIR, "Cargo.toml"), "utf8");
    const depsSection = cargo.split("[dependencies]")[1]?.split("\n[") ?? [];
    const deps = (depsSection[0] ?? "")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"));
    expect(deps.length).toBe(4);
    expect(cargo).toContain('tauri = { version = "2"');
    expect(cargo).toContain("tauri-plugin-updater");
    expect(cargo).toContain('rfd = "0.15"'); // T-P3-158：pick_folder 底层（dialog 插件同款底层，插件纪律不破）
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


  it("T-P3-134 · UI 批次 A：布局骨架（侧栏/路由容器）+ 图标注入 + hash 深链解析 + 组件类库", async () => {
    const uiDir = path.resolve(import.meta.dirname, "..", "..", "ui");
    const read = (name: string) => readFileSync(path.join(uiDir, ...name.split("/")), "utf8");
    const html = read("index.html");
    // 布局骨架：侧栏（260px/折叠 rail）+ 主内容路由容器 + 对话默认页
    for (const id of ["app-shell", "sidebar", "sidebar-toggle", "main", "view-root", "chat-view", "stream", "composer", "pending"]) {
      expect(html).toContain(`id="${id}"`);
    }
    // 侧栏导航组与底部状态区——T-P3-156 布局批：侧栏仅项目列表（两分段），
    // data-route 收敛到 搜索/通知（顶栏铃铛）/设置 三入口；对话恒在主区无
    // 路由钮（需求一.1/一.2）；三栏壳新件随行断言
    for (const route of ["search", "notify", "settings"]) {
      expect(html).toContain(`data-route="${route}"`);
    }
    expect(html).not.toContain('data-route="chat"');
    expect(html).not.toContain('data-route="projects"'); // 项目→侧栏分段（方案 A）
    expect(html).not.toContain('data-route="history"'); // 历史→侧栏分段（方案 A）
    for (const id of ["topbar", "pane-root", "terminal-drawer", "sb-projects", "sb-history", "sb-files", "sidebar-resizer"]) {
      expect(html).toContain(`id="${id}"`); // 右上角入口 + 面板宿主 + 终端抽屉容器 + 两分段
    }
    expect(html).toContain('id="conn-status"');
    expect(html).toContain('id="surface-id"');
    expect(html).toContain('id="lease-status"');
    expect(html).toContain('id="lease-btn"');
    // 图标注入面：data-icon 占位 + icons.js 图标集（≥24 枚）+ 注入函数
    expect(html).toContain('data-icon="search"'); // T-P3-165：sb-new-task 退役——顶栏动作行只剩搜索
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
    expect(router.parseHash("#history")).toEqual({ view: "chat" }); // T-P3-156：历史迁侧栏（重定向面）
    expect(router.parseHash("#projects")).toEqual({ view: "chat" }); // T-P3-156：项目迁侧栏
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
