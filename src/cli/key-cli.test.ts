/**
 * W19：CLI key 子命令测试（自 src/session/credentials.test.ts 拆出——内核仓
 * 不含 CLI 面，产品仓保留本文件）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCredentialStore } from "../session/credentials.js";
import { runKeyCommand } from "./key.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tmpFile(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-key-cli-"));
  tmpDirs.push(dir);
  return path.join(dir, name);
}

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
