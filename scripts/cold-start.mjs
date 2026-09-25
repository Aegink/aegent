#!/usr/bin/env node
// 冷启动基准（T9 / Q16，§6.2）——实测 spawn → 首个会话事件 的耗时。
// 用法：node scripts/cold-start.mjs
// 阈值 <500ms：达标退出码 0；超标退出码 2（按纪律停下写待澄清，不自行改设计）。

import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("构建子进程入口（npm run build，含资产拷贝）…");
execSync("npm run build", { cwd: root, stdio: "pipe" });
const entry = path.join(root, "dist", "src", "kernel", "agent-child.js");

// 预热一次 OS 文件缓存后测三轮，报每次与中位数——单次易被首跑 IO 噪声误导
function runOnce() {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [entry], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    let buffer = "";
    let readyAt = null;
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (;;) {
        const nl = buffer.indexOf("\n");
        if (nl < 0) break;
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.type === "ready" && readyAt === null) {
          readyAt = performance.now();
          child.stdin.write(
            `${JSON.stringify({ type: "prompt", messageId: "bench", content: "冷启动" })}\n`,
          );
        } else if (msg.type === "event" && msg.event?.type === "turn/start") {
          const firstEventAt = performance.now();
          child.kill();
          resolve({ ready: readyAt - t0, firstEvent: firstEventAt - t0 });
          return;
        }
      }
    });
    child.on("error", reject);
    setTimeout(() => {
      child.kill();
      reject(new Error("10s 内未收到首事件"));
    }, 10_000);
  });
}

const rounds = [];
try {
  for (let i = 0; i < 3; i++) {
    const r = await runOnce();
    rounds.push(r);
    console.log(
      `第 ${i + 1} 轮  spawn→ready ${r.ready.toFixed(1)}ms | spawn→首事件 ${r.firstEvent.toFixed(1)}ms`,
    );
  }
} catch (e) {
  console.error("冷启动基准失败：", e.message);
  process.exit(1);
}

const sorted = rounds.map((r) => r.firstEvent).sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const best = sorted[0];
console.log(`—— spawn→首事件：best ${best.toFixed(1)}ms / median ${median.toFixed(1)}ms（阈值 500ms）`);
if (median <= 500) {
  console.log("结论：达标（median ≤ 500ms）");
  process.exit(0);
} else {
  console.log("结论：超标——按 Q16 纪律停下写待澄清，不自行改设计");
  process.exit(2);
}
