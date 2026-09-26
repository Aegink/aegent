#!/usr/bin/env node
/**
 * 网络隔离 provision 独立入口（T-P1-27 · D16）——**需管理员运行**。
 *
 * `npm run sandbox:provision`：调 helper 的 provision-network 动作
 * （专用账户 + SeBatchLogonRight + WFP persistent 出站 BLOCK，幂等）。
 * 自动生成的密码在 stdout 打印一次——**调用方应立即 DPAPI 加密落盘**
 * （D8 机器级扩展位；装配面随 CLI 批次接 SecureKeyStore）。明文不进
 * 命令行、不写日志（D9 纪律）。
 */

import { spawn } from "node:child_process";
import { DEFAULT_HELPER_PATH } from "../sandbox/win32-backend.js";

const helperPath = DEFAULT_HELPER_PATH.replace("src/sandbox", "dist/src/sandbox");

const child = spawn(helperPath, ["--action", "provision-network"], {
  stdio: ["pipe", "pipe", "inherit"],
  windowsHide: true,
});
let out = "";
child.stdout.on("data", (chunk: Buffer) => {
  out += chunk.toString("utf8");
});
child.on("close", (code) => {
  try {
    const parsed = JSON.parse(out.trim()) as {
      ok: boolean;
      account: string;
      passwordGenerated: boolean;
      password: string;
      detail: string;
    };
    if (!parsed.ok) {
      console.error("provision 失败：", out.trim());
      process.exit(2);
    }
    console.log(`✓ 网络隔离已 provision（账户 ${parsed.account}）`);
    console.log(`  ${parsed.detail}`);
    if (parsed.passwordGenerated && parsed.password !== "") {
      console.log("  ⚠ 自动生成的密码（打印一次，请立即加密落盘并从终端历史清除）：");
      console.log(`  ${parsed.password}`);
    }
    process.exit(0);
  } catch {
    console.error("provision 输出无法解析（exit " + String(code) + "）：", out.trim().slice(0, 300));
    process.exit(2);
  }
});
child.stdin.end("{}");
