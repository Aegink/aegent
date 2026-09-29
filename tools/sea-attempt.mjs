/**
 * U6/T-P3-113 ①案 SEA 失败的复现实证脚本——跑 node SEA 全流程
 * （sea-config → blob → node 副本 → postject 注入 → 执行）并**预期失败**
 * 于 better-sqlite3 的 require（ERR_UNKNOWN_BUILTIN_MODULE——SEA 只能内嵌
 * JS blob，不能内嵌原生 .node / node_modules）。退出码 0 = 失败被如实在
 * 现（证据成立）；非 0 = 前置工具缺失（postject 网络面），证据以本仓
 * 2026-09-29 实测记录为准。
 *
 * 结论：①案（真单文件 SEA）对 better-sqlite3 不可行 → 回退 ②案
 * 便携 node.exe 布局（tools/build-host-bundle.mjs）。
 */

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const blob = path.join(dist, "sea-prep.blob");
const seaExe = path.join(dist, process.platform === "win32" ? "sea.exe" : "sea");
const sentinel = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

if (!existsSync(path.join(dist, "portable", "host.cjs"))) {
  console.error("先跑 npm run build:single（SEA 实验对象 = portable/host.cjs）");
  process.exit(2);
}

console.log("[sea-attempt] 1) sea-config → blob");
rmSync(blob, { force: true });
writeFileSync(
  path.join(dist, "sea-config.json"),
  `${JSON.stringify(
    {
      main: "dist/portable/host.cjs",
      output: "dist/sea-prep.blob",
      disableExperimentalSEAWarning: true,
    },
    null,
    2,
  )}\n`,
);
execFileSync(
  process.execPath,
  ["--experimental-sea-config", path.join(dist, "sea-config.json")],
  { stdio: "inherit" },
);

console.log("[sea-attempt] 2) node 副本 → sea.exe");
rmSync(seaExe, { force: true });
copyFileSync(process.execPath, seaExe);

console.log("[sea-attempt] 3) postject 注入（npx 拉取——离线环境此步退化，证据以实测记录为准）");
const inject = spawnSync("npx", ["--yes", "postject", seaExe, "NODE_SEA_BLOB", blob, `--sentinel-fuse=${sentinel}`], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (inject.status !== 0) {
  console.error("[sea-attempt] postject 不可用（网络/安装面）——证据以仓内实测记录为准");
  process.exit(3);
}

console.log("[sea-attempt] 4) 执行 sea.exe——预期 better-sqlite3 require 失败（①案不可行的证据）");
const run = spawnSync(seaExe, ["--port", "0"], { encoding: "utf8", timeout: 30_000 });
const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
rmSync(seaExe, { force: true });
rmSync(blob, { force: true });
if (output.includes("better-sqlite3") && /ERR_UNKNOWN_BUILTIN_MODULE|Cannot find module/.test(output)) {
  console.log("[sea-attempt] ✅ ①案失败实证成立：", output.split(/\r?\n/).find((l) => l.includes("better-sqlite3")));
  process.exit(0);
}
console.log("[sea-attempt] ⚠ 未复现预期失败——上游 SEA 行为可能变化，人工复核", output.slice(0, 400));
process.exit(4);
