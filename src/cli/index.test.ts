/**
 * CLI 入口测试（U1/T-P3-101 三入口接线面）——parseCliArgv 的 --settings
 * 参数面 + main 的 settings 装配接线（文件档注入子进程 argv / 损坏
 * fail-closed）。main 的 spawn 面经 --entry 注入假入口（写 argv 观察窗），
 * 不 spawn 真内核。
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { main, parseCliArgv } from "./index.js";
import { SettingsError } from "../session/settings.js";

describe("parseCliArgv（--settings 参数面）", () => {
  it("--settings 被入口吃掉、不透传子进程；其余参数原样透传", () => {
    const parsed = parseCliArgv([
      "--settings",
      "C:/cfg/settings.json",
      "--provider",
      "openai",
      "--smoke",
    ]);
    expect(parsed.settingsPath).toBe("C:/cfg/settings.json");
    expect(parsed.smoke).toBe(true);
    expect(parsed.childArgs).toEqual(["--provider", "openai"]);
  });

  it("缺省无 --settings（settingsPath undefined → <home>/.aegent/settings.json）", () => {
    const parsed = parseCliArgv([]);
    expect(parsed.settingsPath).toBeUndefined();
  });
});

describe("main 的 settings 装配接线", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  function tmpDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-cli-settings-"));
    dirs.push(dir);
    return dir;
  }

  /**
   * 假子进程入口：收到 spawn 即把 argv 写入观察窗文件后立即退出——main 的
   * settings → childArgs 翻译结果由此读取（messages 流随子进程退出自然结束，
   * runCli 在 stdin 关闭后正常收束，无悬挂）。
   */
  function fakeEntry(dir: string): { entry: string; observed: string } {
    const observed = path.join(dir, "observed-argv.json");
    const entry = path.join(dir, "fake-child.mjs");
    writeFileSync(
      entry,
      [
        "import { writeFileSync } from 'node:fs';",
        "try {",
        `  writeFileSync(${JSON.stringify(observed)}, JSON.stringify(process.argv.slice(2)));`,
        "} catch (e) {",
        "  process.stderr.write(String(e));",
        "}",
        "process.exit(0);",
      ].join("\n"),
      "utf8",
    );
    return { entry, observed };
  }

  it("settings.json 文件档注入子进程 argv（不带环境变量可启动）", async () => {
    const dir = tmpDir();
    const settingsFile = path.join(dir, "settings.json");
    writeFileSync(
      settingsFile,
      JSON.stringify({
        version: 1,
        providers: [
          { name: "main", adapter: "anthropic", baseUrl: "https://file.example.com", model: "file-model" },
        ],
        defaultProvider: "main",
        sandbox: { network: "deny" },
      }),
      "utf8",
    );
    const { entry, observed } = fakeEntry(dir);
    // --smoke + stdin 保持打开：main 完成 settings 装配与 spawn 后由测试收束
    const { PassThrough } = await import("node:stream");
    const stdin = new PassThrough();
    const origStdin = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
    const mainPromise = main(["--smoke", "--settings", settingsFile, "--entry", entry]);
    // 轮询观察窗（spawn 是异步面；5s 上限防悬挂）
    const deadline = Date.now() + 5_000;
    let observedArgs: string[] | null = null;
    while (Date.now() < deadline) {
      try {
        observedArgs = JSON.parse(readFileSync(observed, "utf8")) as string[];
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    stdin.end();
    await mainPromise;
    if (origStdin !== undefined) Object.defineProperty(process, "stdin", origStdin);
    // 子进程收束：connection.kill 在 main 尾部执行（观察窗已读到即无悬挂）
    expect(observedArgs).not.toBeNull();
    expect(observedArgs?.[observedArgs.indexOf("--provider") + 1]).toBe("anthropic");
    expect(observedArgs?.[observedArgs.indexOf("--model") + 1]).toBe("file-model");
    expect(observedArgs?.[observedArgs.indexOf("--base-url") + 1]).toBe("https://file.example.com");
    expect(observedArgs?.[observedArgs.indexOf("--network") + 1]).toBe("deny");
  });

  it("损坏的 settings.json → SettingsError 直达启动失败（fail-closed）", async () => {
    const dir = tmpDir();
    const settingsFile = path.join(dir, "broken.json");
    writeFileSync(settingsFile, "{ not json", "utf8");
    await expect(main(["--smoke", "--settings", settingsFile])).rejects.toBeInstanceOf(
      SettingsError,
    );
  });
});
