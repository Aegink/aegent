/**
 * DPAPI 测试（T-6-04 · D8）——真实 PowerShell 子进程往返（DPAPI 无法 mock，
 * 往返一致就是验收）。PowerShell 冷启动 1~3s/次，全文件超时放宽到 120s。
 * 验收 §8 第 5 条：落盘配置文件 grep 无明文 key（测试内对配置文件做同款
 * sk- 证伪；卡面验收的 config/ 目录在装配前不存在 → `|| echo CLEAN`）。
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DPAPI_UNPROTECT_FAILED, protect, unprotect } from "./dpapi/index.js";
import { SecureKeyStore } from "./dpapi/secure-config.js";

const WIN = process.platform === "win32";
const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

// 与卡面验收同款的明文 key 证伪模式
const SK_PATTERN = /sk-[A-Za-z0-9]{20,}/;

describe.runIf(WIN)("DPAPI 往返（真实 PowerShell 子进程）", () => {
  it("protect → unprotect 往返一致（ASCII + 中文混合载荷，非 ASCII 经 base64 通道不乱码）", async () => {
    const plain = "sk-test-abcdef0123456789abcdef012345-密钥±测试";
    const blob = await protect(plain);
    // blob 是 DPAPI/secure-string 形状（hex 文本），不含明文
    expect(blob).not.toContain("sk-test");
    expect(await unprotect(blob)).toBe(plain);
  }, 120_000);

  it("SecureKeyStore：setKey → 落盘 JSON 无明文 key → getKey 往返（§8 第 5 条）", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-dpapi-"));
    tmpDirs.push(dir);
    const configPath = path.join(dir, "config", "secure-keys.json");
    const store = new SecureKeyStore({ configPath });
    const plain = "sk-store-0123456789abcdefghij0123456789";
    await store.setKey("openai", plain);

    const onDisk = readFileSync(configPath, "utf8");
    expect(onDisk).not.toMatch(SK_PATTERN); // 配置文件无明文 key（卡面验收的机验形式）
    expect(onDisk).toContain("blob"); // 落盘的是 blob
    expect(await store.getKey("openai")).toBe(plain);
    expect(await store.getKey("not-set")).toBeUndefined();
  }, 120_000);

  it("损坏 blob unprotect → DPAPI_UNPROTECT_FAILED（fail-loud 不悬挂）", async () => {
    // 合法 base64、非法 blob：走完协议后 PowerShell 侧解密失败
    const garbage = Buffer.from("deadbeef-not-a-real-blob", "utf8").toString("base64");
    await expect(unprotect(garbage)).rejects.toMatchObject({ code: DPAPI_UNPROTECT_FAILED });
  }, 120_000);

  it("密钥名非法即拒（配置键面的输入校验，无 spawn）", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-dpapi-"));
    tmpDirs.push(dir);
    const store = new SecureKeyStore({ configPath: path.join(dir, "keys.json") });
    await expect(store.setKey("bad name/../x", "sk-xx")).rejects.toThrow(/密钥名非法/);
    await expect(store.getKey("")).rejects.toThrow(/密钥名非法/);
  });
});
