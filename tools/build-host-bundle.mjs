/**
 * U6/T-P3-113 host/agent-child 双 bundle + 便携运行时布局（②案——便携
 * node.exe 随包）。
 *
 * 展卡预判：①案 node SEA（真单文件）对 better-sqlite3 原生模块不可行——
 * SEA 只能内嵌 JS blob，不能内嵌原生 .node 与 node_modules（官方限制；
 * 实测证据 = 本 bundle 的唯一 external 即该原生模块，缺 node_modules 即
 * MODULE_NOT_FOUND）。回退 ②案：dist/portable/ 布局 =
 *   node.exe（当前 node 运行时原样拷贝）
 *   host.cjs（esbuild CJS bundle：dist/src/host/server.js——bin 守卫经
 *     import.meta.url shim 原生成立；唯一 external = better-sqlite3）
 *   agent-child.cjs（同款 bundle：dist/src/kernel/agent-child.js——壳/
 *     便携运行器经 --agent-entry 传给 host）
 *   node_modules/better-sqlite3（原生模块解引用拷贝）
 *   ui/（静态资产——Tauri 壳与便携 node 模式共用）
 * 用法：node dist/portable/node.exe host.cjs --port 8787 --ui ./ui
 *       --agent-entry ./agent-child.cjs（Rust 壳同款 spawn 参数；启动
 *       参数来自 U1 配置链——壳不加环境变量）。
 *
 * CJS 选型说明：ESM bundle 在 host 链上会踩 esbuild 的动态 require 兜底
 * （"Dynamic require of events"）；CJS 原生 require 无此问题，import.meta
 * 用 banner + define shim 补（本仓 dist 仅用 import.meta.url 一形）。
 *
 * 体积分列（§6.1 约束 5）：壳（Tauri exe + ui/）与 runtime（node.exe +
 * 两 bundle + better-sqlite3）分列陈述，脚本尾行输出实际数字。
 */

import { cpSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "dist", "portable");

const du = (p) => {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.size;
  return readdirSync(p).reduce((sum, name) => sum + du(path.join(p, name)), 0);
};
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

// 1) tsc 产物必须先在位（npm run build 先行——脚本只做打包与布局）
for (const rel of ["dist/src/host/server.js", "dist/src/kernel/agent-child.js"]) {
  if (!existsSync(path.join(repoRoot, rel))) {
    console.error(`缺 ${rel}——先跑 npm run build`);
    process.exit(1);
  }
}

const bundle = (entry, outfile) => {
  console.log(`esbuild bundle → dist/portable/${outfile}`);
  execFileSync(
    process.execPath,
    [
      path.join(repoRoot, "node_modules", "esbuild", "bin", "esbuild"),
      path.join(repoRoot, entry),
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--target=node22",
      "--legal-comments=eof",
      "--external:better-sqlite3",
      // import.meta.url shim（CJS 无 import.meta——bin 守卫与模块缺省路径依赖它）
      "--banner:js=const __import_meta_url = require('node:url').pathToFileURL(__filename).href;",
      "--define:import.meta.url=__import_meta_url",
      `--outfile=${path.join(outDir, outfile)}`,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
};
bundle("dist/src/host/server.js", "host.cjs");
bundle("dist/src/kernel/agent-child.js", "agent-child.cjs");

// 2) 便携布局：ui/ + node.exe + better-sqlite3
const uiDst = path.join(outDir, "ui");
rmSync(uiDst, { recursive: true, force: true });
cpSync(path.join(repoRoot, "ui"), uiDst, { recursive: true });

const nodeExeDst = path.join(outDir, process.platform === "win32" ? "node.exe" : "node");
cpSync(process.execPath, nodeExeDst);

const nativeDst = path.join(outDir, "node_modules", "better-sqlite3");
rmSync(path.join(outDir, "node_modules"), { recursive: true, force: true });
cpSync(path.join(repoRoot, "node_modules", "better-sqlite3"), nativeDst, {
  recursive: true,
  dereference: true, // pnpm 符号链接解引用
});

// 3.5) 运行时伴生资产（copy-assets 的五类——bundle 里 import.meta.url 经
// shim 指向 bundle 自身，故资产必须镜像到 bundle 同目录的相对形状：
// registry descriptions / templates.js templates / system-prompt prompt /
// dpapi index dpapi / migrate schema.sql——两个 bundle 同目录共用一份）。
const assets = [
  ["src/kernel/tools/descriptions", "descriptions"],
  ["src/sandbox/templates", "templates"],
  ["src/context/prompt", "prompt"],
  ["src/sandbox/dpapi", "dpapi"],
];
for (const [src, dst] of assets) {
  rmSync(path.join(outDir, dst), { recursive: true, force: true });
  cpSync(path.join(repoRoot, src), path.join(outDir, dst), { recursive: true });
}
cpSync(path.join(repoRoot, "src/session/schema.sql"), path.join(outDir, "schema.sql"));
// T-P3-137 修正：dpapi/index.ts 的 helper 路径 = dirname(import.meta.url)/dpapi.ps1
// ——bundle 后 import.meta.url 指向 host.cjs（outDir 根），故 dpapi.ps1 必须在
// portable 根（原仅目录镜像 dpapi/ 存在子目录，凭据面在 portable 布局报"脚本
// 缺失"——走查实测发现）。
cpSync(path.join(repoRoot, "src/sandbox/dpapi/dpapi.ps1"), path.join(outDir, "dpapi.ps1"));

// T-P3-155 A1：构建信息随包（bundle 后 import.meta.url 指向 portable 根——
// readBuildInfo 的查找链第一位即此处）
cpSync(path.join(repoRoot, "dist/build-info.json"), path.join(outDir, "build-info.json"));

// T-P3-140 批次 A：沙箱 helper 进发行链——受限令牌后端的强制面随包分发
//（bundle 后 import.meta.url 指向 portable 根的 host/agent-child .cjs，
// resolveSandboxHelperPath 的"伴随位"解析即命中此处）。缺席不阻断打包
//（开发机未跑 cargo build 时降级为 local 弱兜底 + 自检面板可见），但
// 显式提示——发行链纪律：缺强制面必须对打包者可见。
const helperSrc = path.join(
  repoRoot,
  "src/sandbox/win32-helper/target/release/win32-sandbox-helper.exe",
);
if (existsSync(helperSrc)) {
  cpSync(helperSrc, path.join(outDir, "win32-sandbox-helper.exe"));
  console.log("sandbox helper → dist/portable/win32-sandbox-helper.exe（受限令牌强制面随包）");
} else {
  console.warn(
    "[warn] 沙箱 helper 不在场（npm run build:sandbox-helper）——便携包将以 local 弱兜底运行受限档",
  );
}

// 3) 体积分列输出
console.log("—— 体积分列（U6 验收）——");
console.log(`壳侧 ui/              : ${mb(du(uiDst))}`);
console.log(`runtime node.exe      : ${mb(du(nodeExeDst))}`);
console.log(`runtime host.cjs      : ${mb(du(path.join(outDir, "host.cjs")))}`);
console.log(`runtime agent-child.cjs: ${mb(du(path.join(outDir, "agent-child.cjs")))}`);
console.log(`runtime better-sqlite3: ${mb(du(nativeDst))}`);
console.log(
  `runtime 小计          : ${mb(
    du(nodeExeDst) + du(path.join(outDir, "host.cjs")) + du(path.join(outDir, "agent-child.cjs")) + du(nativeDst),
  )}`,
);
console.log(`dist/portable 合计    : ${mb(du(outDir))}`);
