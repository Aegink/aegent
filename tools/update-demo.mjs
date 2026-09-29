/**
 * U7/T-P3-114 本地更新演示两路（签名校验通过 / 拒绝）——不建分发渠道，
 * endpoints 指向 localhost。产物落 dist/update/：
 *   valid/    ：正确密钥（private/tauri-updater.key）签名的假 v0.1.1 升级包
 *               + latest.json（updater 通过路——签名与 pubkey 匹配）
 *   rejected/ ：同一包**篡改一个字节**后重用原签名 + latest.json
 *               （updater 拒绝路——内容与签名不符，minisign 校验必拒）
 * 用法：node tools/update-demo.mjs [--serve 8789]
 *   --serve 起一个静态服务（localhost）端点演示：把 updater endpoints 的
 *   url 指向 http://127.0.0.1:<port>/valid/latest.json 即通过路；改 rejected/
 *   即拒绝路（真机演示步骤见 plan-p3-progress 人工确认清单）。
 */

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriJs = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
// CLI 走 npx tauri（@tauri-apps/cli 的 JS 包装器按平台拉 tauri-cli.exe）
const tauriCli = "tauri";
const keyPath = path.join(root, "private", "tauri-updater.key");
const outDir = path.join(root, "dist", "update");

const argv = process.argv.slice(2);
const servePort = argv.includes("--serve") ? Number(argv[argv.indexOf("--serve") + 1] ?? 8789) : null;

if (!existsSync(keyPath)) {
  console.error("缺 private/tauri-updater.key——先跑 node tools/gen-update-keys.mjs");
  process.exit(1);
}

// 假升级包：内容稳定（哈希可复现）——演示只关心签名链，不关心真实产物
const payload = Buffer.from(
  `aegent-demo-update v0.1.1 built=${createHash("sha256").update("aegent-update-demo").digest("hex").slice(0, 12)}\n`,
  "utf8",
);
const artifact = path.join(outDir, "aegent_0.1.1_x64-setup.nsis.zip");
mkdirSync(outDir, { recursive: true });
writeFileSync(artifact, payload);

// 签名（tauri signer sign——密钥经 TAURI_SIGNING_PRIVATE_KEY_PATH 传路径，
// -k 只收字面密钥串；空密码与 gen-update-keys.mjs 同面）
const signed = spawnSync("node", [tauriJs, "signer", "sign", artifact], {
  stdio: "inherit",
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY_PATH: keyPath,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
  },
});
if (signed.status !== 0) {
  console.error("tauri signer sign 失败");
  process.exit(2);
}
const sig = readFileSync(`${artifact}.sig`, "utf8");

const latestJson = (url, signature) =>
  `${JSON.stringify(
    {
      version: "0.1.1",
      notes: "aegent 0.1.1 演示更新（本地演示面——签名校验链，无真实分发渠道）",
      pub_date: new Date().toISOString(),
      platforms: { "windows-x86_64": { signature, url } },
    },
    null,
    2,
  )}\n`;

// —— 通过路：原包 + 原签名
mkdirSync(path.join(outDir, "valid"), { recursive: true });
copyFileSync(artifact, path.join(outDir, "valid", "aegent_0.1.1_x64-setup.nsis.zip"));
copyFileSync(`${artifact}.sig`, path.join(outDir, "valid", "aegent_0.1.1_x64-setup.nsis.zip.sig"));
writeFileSync(
  path.join(outDir, "valid", "latest.json"),
  latestJson("http://127.0.0.1:8789/valid/aegent_0.1.1_x64-setup.nsis.zip", sig),
);

// —— 拒绝路：篡改一个字节（内容变、签名不变 → minisign 校验必拒）
const tampered = Buffer.from(payload);
tampered[0] = tampered[0] ^ 0xff;
mkdirSync(path.join(outDir, "rejected"), { recursive: true });
writeFileSync(path.join(outDir, "rejected", "aegent_0.1.1_x64-setup.nsis.zip"), tampered);
copyFileSync(`${artifact}.sig`, path.join(outDir, "rejected", "aegent_0.1.1_x64-setup.nsis.zip.sig"));
writeFileSync(
  path.join(outDir, "rejected", "latest.json"),
  latestJson("http://127.0.0.1:8789/rejected/aegent_0.1.1_x64-setup.nsis.zip", sig),
);

console.log("—— 更新演示两路已生成（dist/update/）——");
console.log("通过路   : valid/latest.json     （签名匹配 → updater 受理）");
console.log("拒绝路   : rejected/latest.json   （包被篡改 → 签名校验拒绝）");
console.log("端点演示 : updater endpoints 指向 http://127.0.0.1:8789/{valid|rejected}/latest.json");

if (servePort !== null) {
  const mime = (p) =>
    p.endsWith(".json") ? "application/json" : p.endsWith(".sig") ? "text/plain" : "application/zip";
  createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").replace(/^\/+/, "")) || "latest.json";
    const file = path.join(outDir, rel);
    if (!file.startsWith(outDir) || !existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": mime(file) });
    res.end(readFileSync(file));
  }).listen(servePort, "127.0.0.1", () => {
    console.log(`[update-demo] 静态端点：http://127.0.0.1:${servePort}/{valid|rejected}/latest.json`);
  });
}
