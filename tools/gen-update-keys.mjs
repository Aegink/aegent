/**
 * U7/T-P3-114 更新签名密钥对生成（minisign 形态——tauri signer 同款）。
 * 私钥落 `private/`（gitignore——凭据红线），公钥（<key>.pub）回显供
 * tauri.conf.json 的 plugins.updater.pubkey。用法：node tools/gen-update-keys.mjs
 * （已存在私钥时拒绝覆盖——覆盖即废签名链，需先手动删除）。
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keyPath = path.join(root, "private", "tauri-updater.key");

if (existsSync(keyPath)) {
  console.error(`私钥已存在：${keyPath.replace(root, "<repo>")}（不覆盖——覆盖即废签名链；确认更换请先手动删除）`);
  process.exit(1);
}

// tauri signer generate -w <key> --password "" --ci：私钥落 <key>、公钥落
// <key>.pub。本地面空密码（演示面；私钥只进 gitignored private/——线上
// 分发必须设密码并保管，记档）。
const gen = spawnSync(
  "npx",
  ["-y", "tauri", "signer", "generate", "-w", keyPath, "--password", "", "--ci"],
  { stdio: "inherit", shell: process.platform === "win32" },
);
if (gen.status !== 0) {
  console.error("tauri signer generate 失败");
  process.exit(2);
}

console.log("—— 密钥对已生成 ——");
console.log(`私钥：${keyPath.replace(root, "<repo>")}（掩码入档，不入 git）`);
console.log("公钥（复制进 tauri.conf.json → plugins.updater.pubkey）：");
console.log(readFileSync(`${keyPath}.pub`, "utf8").trim());
