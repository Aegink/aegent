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

  it("tauri.conf.json 形状：frontendDist 指向 ui/ 静态资产 + bundle 收窄 nsis + 单窗口", () => {
    const conf = JSON.parse(readFileSync(path.join(TAURI_DIR, "tauri.conf.json"), "utf8"));
    expect(conf.build.frontendDist).toBe("../ui");
    expect(conf.build.beforeBuildCommand).toBeUndefined(); // 零前端构建链
    expect(conf.bundle.targets).toEqual(["nsis"]);
    expect(conf.bundle.active).toBe(true);
    expect(conf.app.windows).toHaveLength(1);
    expect(conf.app.security.csp).toContain("connect-src");
    // 连接面：CSP 放开本机回环 WS（host 进程）
    expect(conf.app.security.csp).toContain("ws://127.0.0.1");
  });

  it("capabilities 零插件：仅 core:default 最小面", () => {
    const caps = JSON.parse(
      readFileSync(path.join(TAURI_DIR, "capabilities", "default.json"), "utf8"),
    );
    expect(caps.windows).toEqual(["main"]);
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
});
