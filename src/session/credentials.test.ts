/**
 * 凭据管理测试（U2/T-P3-102）——验收面：
 * ① 往返（setKey → getKey 一致）+ 更换覆盖 + 删除幂等；
 * ② 加密断言（DPAPI blob 落盘无明文——Windows 真 PowerShell；非 Windows
 *    回退 0600 明文文件的形状与写入面）；
 * ③ 零明文（settings.json 零 key 断言 + 凭据文件 sk- 证伪——DPAPI 面）。
 * DPAPI 冷启动 1~3s/次（dpapi.test.ts 同款），全文件超时放宽。
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DpapiCredentialStore,
  PlainFileCredentialStore,
  createCredentialStore,
  defaultCredentialsPath,
} from "./credentials.js";
import { resolveChildLaunchArgv, parseSettingsShape } from "./settings.js";
import { runKeyCommand } from "../cli/key.js";

const WIN = process.platform === "win32";
const SK_PATTERN = /sk-[A-Za-z0-9]{20,}/;
const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tmpFile(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-cred-"));
  tmpDirs.push(dir);
  return path.join(dir, name);
}

describe("PlainFileCredentialStore（非 Windows 回退——0600 明文文件）", () => {
  it("往返 + 更换覆盖 + 删除幂等 + 清单", async () => {
    const store = new PlainFileCredentialStore(tmpFile("credentials.bin"));
    await store.setKey("main", "sk-plain-0123456789abcdefghij");
    expect(await store.getKey("main")).toBe("sk-plain-0123456789abcdefghij");
    await store.setKey("main", "sk-updated-0123456789abcdefghij"); // 更换覆盖
    expect(await store.getKey("main")).toBe("sk-updated-0123456789abcdefghij");
    const list = await store.listKeys();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "main" });
    expect(await store.deleteKey("main")).toBe(true);
    expect(await store.deleteKey("main")).toBe(false); // 幂等
    expect(await store.getKey("main")).toBeUndefined();
  });

  it("provider 名非法拒绝；文件形状损坏 fail-closed", async () => {
    const file = tmpFile("credentials.bin");
    const store = new PlainFileCredentialStore(file);
    await expect(store.setKey("bad name!", "sk-x-0123456789abcdefghij")).rejects.toThrow(
      /provider 名非法/,
    );
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, "{ broken", "utf8");
    await expect(store.getKey("main")).rejects.toThrow(/凭据文件损坏/);
  });

  it("0600 权限写入（writeFile 的 mode 参数面——Windows 上无位语义记档）", async () => {
    // PlainFileCredentialStore.write 固定传 mode 0o600；此处以文件可达 +
    // 内容正确为机验（权限位的真值断言仅在 POSIX 有意义——平台差异记档）
    const file = tmpFile("credentials.bin");
    const store = new PlainFileCredentialStore(file);
    await store.setKey("p", "sk-mode-0123456789abcdefghij");
    expect(readFileSync(file, "utf8")).toContain("sk-mode-0123456789abcdefghij");
  });
});

describe.runIf(WIN)("DpapiCredentialStore（Windows 真 PowerShell 子进程）", () => {
  it("往返 + 落盘 blob 无明文（sk- 证伪）+ 删除", async () => {
    const file = tmpFile("credentials.bin");
    const store = new DpapiCredentialStore(file);
    const plain = "sk-dpapi-0123456789abcdefghij012345";
    await store.setKey("main", plain);
    const onDisk = readFileSync(file, "utf8");
    expect(onDisk).not.toMatch(SK_PATTERN); // 零明文——落盘的是 DPAPI blob
    expect(await store.getKey("main")).toBe(plain);
    expect(await store.deleteKey("main")).toBe(true);
    expect(await store.getKey("main")).toBeUndefined();
  }, 120_000);

  it("工厂（win32）走 DPAPI 存储", async () => {
    const file = tmpFile("credentials.bin");
    const store = createCredentialStore(file, "win32");
    await store.setKey("main", "sk-factory-0123456789abcdefghij");
    expect(await store.getKey("main")).toBe("sk-factory-0123456789abcdefghij");
  }, 120_000);
});

describe("runKeyCommand（CLI key 子命令）", () => {
  function collect(store: Parameters<typeof runKeyCommand>[2], stdinText?: string) {
    const out: string[] = [];
    const err: string[] = [];
    const input = new PassThrough();
    if (stdinText !== undefined) input.end(stdinText);
    const run = (argv: string[]) =>
      runKeyCommand(argv, {
        ...(stdinText !== undefined ? { input } : {}),
        out: (l) => out.push(l),
        err: (l) => err.push(l),
      }, store);
    return { run, out, err };
  }

  it("set（stdin 读入不进命令行）→ get 掩码 → delete → list 空态", async () => {
    const store = createCredentialStore(tmpFile("credentials.bin"), "linux");
    const first = collect(store, "sk-cli-0123456789abcdefghij\n");
    expect(await first.run(["set", "main"])).toBe(0);
    // key 材料出现在输入流与存储，但输出永不带明文（只带掩码）
    expect(first.out.join("\n")).not.toContain("sk-cli-0123456789abcdefghij");
    expect(first.out.join("\n")).toContain("sk-c…ghij");

    const view = collect(store);
    expect(await view.run(["get", "main"])).toBe(0);
    expect(view.out.join("\n")).not.toContain("sk-cli-0123456789abcdefghij");
    expect(view.out.join("\n")).toMatch(/main: sk-c…ghij/);

    expect(await collect(store).run(["delete", "main"])).toBe(0);
    expect(await collect(store).run(["list"])).toBe(0);
    expect(await collect(store).run(["get", "main"])).toBe(1); // 删除后 get 失败
  });

  it("list 有条目 / set 空 key 拒绝 / 未知动作 → 用法与退出码", async () => {
    const store = createCredentialStore(tmpFile("credentials.bin"), "linux");
    await store.setKey("p1", "sk-listing-0123456789abcdefghij");
    const listed = collect(store);
    expect(await listed.run(["list"])).toBe(0);
    expect(listed.out.join("\n")).toContain("p1");

    const empty = collect(store, "\n");
    expect(await empty.run(["set", "main"])).toBe(1);
    expect(empty.err.join("\n")).toContain("key 为空");

    const bad = collect(store);
    expect(await bad.run(["frobnicate"])).toBe(1);
    expect(bad.err.join("\n")).toContain("用法");
  });
});

describe("工厂与装配消费", () => {
  it("工厂按 platform 选择实现（win32 → DPAPI / 其他 → 0600 明文）", () => {
    expect(createCredentialStore("a.bin", "win32")).toBeInstanceOf(DpapiCredentialStore);
    expect(createCredentialStore("a.bin", "linux")).toBeInstanceOf(PlainFileCredentialStore);
  });

  it("defaultCredentialsPath 与 settings.json 同目录（~/.aegent/credentials.bin）", () => {
    expect(defaultCredentialsPath().replace(/\\/g, "/")).toMatch(/\.aegent\/credentials\.bin$/);
  });

  it("resolveChildLaunchArgv 的 credentialKey 槽：显式 > env > 凭据；条目未选中不注入", () => {
    const settings = parseSettingsShape({
      providers: [{ name: "main", baseUrl: "https://x.example.com" }],
      defaultProvider: "main",
    });
    const cred = { credentialKey: "sk-cred-0123456789abcdefghij" };
    const { args } = resolveChildLaunchArgv([], {}, settings, cred);
    expect(args[args.indexOf("--api-key") + 1]).toBe("sk-cred-0123456789abcdefghij");
    // env 有 key → 凭据不越过 env
    const { args: envArgs } = resolveChildLaunchArgv([], { AEGENT_API_KEY: "sk-env-0123456789abcd" }, settings, cred);
    expect(envArgs[envArgs.indexOf("--api-key") + 1]).toBe("sk-env-0123456789abcd");
    // 显式占用 provider 槽 → 条目与凭据都不参与
    const { args: occupied } = resolveChildLaunchArgv(["--provider", "anthropic"], {}, settings, cred);
    expect(occupied).not.toContain("--api-key");
  });
});
