import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  OfflineNetworkExecutor,
  isValidSandboxAccount,
  resolveNetworkIdentity,
  probeNetworkProvisioned,
} from "./offline-network.js";
import { DEFAULT_HELPER_PATH } from "./win32-backend.js";

const helperPath = fileURLToPath(new URL(`../../${DEFAULT_HELPER_PATH}`, import.meta.url));
const helperReady = existsSync(helperPath);

describe("resolveNetworkIdentity（codex from_permissions 同构）", () => {
  it("①network disabled → offline 身份", () => {
    expect(resolveNetworkIdentity(false, false)).toEqual({ kind: "offline" });
  });

  it("①proxy 强制 → offline 身份", () => {
    expect(resolveNetworkIdentity(true, true)).toEqual({ kind: "offline" });
  });

  it("②network enabled 且无代理 → online 身份", () => {
    expect(resolveNetworkIdentity(true, false)).toEqual({ kind: "online" });
  });
});

describe("isValidSandboxAccount（provision 产出形状闭集）", () => {
  it("③合法账户名（aegent-sbx-<6 hex>）", () => {
    expect(isValidSandboxAccount("aegent-sbx-1a2b3c")).toBe(true);
    expect(isValidSandboxAccount("aegent-sbx-000000")).toBe(true);
  });

  it("③形状外的账户名拒绝（路径注入面）", () => {
    expect(isValidSandboxAccount("administrator")).toBe(false);
    expect(isValidSandboxAccount("aegent-sbx-../../x")).toBe(false);
    expect(isValidSandboxAccount("aegent-sbx-1A2B3C")).toBe(false); // 大写不在闭集
    expect(isValidSandboxAccount("")).toBe(false);
    expect(isValidSandboxAccount("aegent-sbx-12345")).toBe(false); // 位数不足
  });
});

describe.skipIf(!helperReady)("OfflineNetworkExecutor（未 provision 失败路径真机）", () => {
  it("④未 provision 的账户 → 类型化错误（绝不静默降级为有网运行）", async () => {
    const executor = new OfflineNetworkExecutor({
      helperPath,
      account: "aegent-sbx-000001",
      password: "no-such-password",
    });
    await expect(executor.execute({ command: "echo hi", cwd: process.cwd(), timeoutMs: 8000 })).rejects.toMatchObject({
      code: "NETWORK_SANDBOX_NOT_PROVISIONED",
    });
  }, 15_000);
});

describe.skipIf(!helperReady)("probeNetworkProvisioned（doctor 探针）", () => {
  it("⑤probe 可运行（未 provision 环境 → false；已 provision → true）", async () => {
    const result = await probeNetworkProvisioned(helperPath);
    // 非特权可读（FwpmEngineOpen0 只读会话）；真机返回 boolean 而非 null。
    expect(result === false || result === true).toBe(true);
  });
});
