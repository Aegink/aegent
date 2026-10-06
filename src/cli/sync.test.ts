/**
 * sync 子命令测试（C3）——实体收集/应用往返（临时 AEGENT_HOME）+ 双设备
 * syncOnce 合并语义（FileSystemRemoteStore 当远端——WebDAV 适配面单独
 * mock fetch 验证 read/write 两方法）。
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { syncOnce } from "../sync/coordinator.js";
import { FileSystemRemoteStore } from "../sync/store.js";
import {
  applySyncEntity,
  collectSyncEntities,
  createWebdavRemoteStore,
  DOMAIN_FILE,
  DOMAIN_SETTINGS,
} from "./sync.js";

let tmp: string;
let prevHome: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "aegent-cli-sync-"));
  prevHome = process.env["AEGENT_HOME"];
  process.env["AEGENT_HOME"] = tmp;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env["AEGENT_HOME"];
  else process.env["AEGENT_HOME"] = prevHome;
  rmSync(tmp, { recursive: true, force: true });
});

describe("C3 · 同步实体面", () => {
  it("收集：settings.json（剔除本地态段）+ rules.txt + AGENTS.md 三实体", () => {
    const settingsFile = path.join(tmp, "settings.json");
    writeFileSync(
      settingsFile,
      JSON.stringify({
        defaultModel: "gpt-x",
        webdav: { url: "https://dav.example/" },
        onboardingDone: true,
      }),
      "utf8",
    );
    writeFileSync(path.join(tmp, "rules.txt"), "Bash(git status:*) -> allow\n", "utf8");
    writeFileSync(path.join(tmp, "AGENTS.md"), "# 全局指令\n", "utf8");
    const entities = collectSyncEntities(settingsFile);
    expect(entities.map((e) => e.entityId)).toEqual(["settings.json", "rules.txt", "AGENTS.md"]);
    const settingsEntity = entities[0]!;
    expect((settingsEntity.payload as { settings: Record<string, unknown> }).settings.webdav).toBeUndefined();
    expect((settingsEntity.payload as { settings: Record<string, unknown> }).settings.defaultModel).toBe("gpt-x");
  });

  it("应用：settings 实体合并写回（本地 webdav 段保留不覆盖）+ 文件实体写回", () => {
    const settingsFile = path.join(tmp, "settings.json");
    writeFileSync(
      settingsFile,
      JSON.stringify({ defaultModel: "old", webdav: { url: "https://keep.example/" } }),
      "utf8",
    );
    applySyncEntity(settingsFile, {
      domain: DOMAIN_SETTINGS,
      entityId: "settings.json",
      payload: { settings: { defaultModel: "from-remote" } },
    });
    const merged = JSON.parse(readFileSync(settingsFile, "utf8")) as Record<string, unknown>;
    expect(merged["defaultModel"]).toBe("from-remote");
    expect((merged["webdav"] as { url: string }).url).toBe("https://keep.example/"); // 本地段不覆盖
    applySyncEntity(path.join(tmp, "settings.json"), {
      domain: DOMAIN_FILE,
      entityId: "rules.txt",
      payload: { content: "Bash(git push:*) -> deny\n" },
    });
    expect(readFileSync(path.join(tmp, "rules.txt"), "utf8")).toContain("git push");
  });

  it("fail-closed：settings 实体载荷形状坏 / 文件键越界均拒绝", () => {
    const settingsFile = path.join(tmp, "settings.json");
    expect(() =>
      applySyncEntity(settingsFile, { domain: DOMAIN_SETTINGS, entityId: "s", payload: {} }),
    ).toThrow(/形状非法/);
    expect(() =>
      applySyncEntity(settingsFile, { domain: DOMAIN_FILE, entityId: "../escape.txt", payload: { content: "x" } }),
    ).toThrow(/越界/);
  });

  it("WebDAV remote 适配面：read 404=undefined、write 走 MKCOL+PUT（fetch mock）", async () => {
    const calls: { method: string; url: string }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url: String(url) });
      if (method === "GET" && String(url).endsWith("/manifest.json")) {
        return new Response("not found", { status: 404 }) as unknown as Response;
      }
      return new Response("", { status: 201 }) as unknown as Response;
    });
    const store = createWebdavRemoteStore({ url: "https://dav.example/", remoteRoot: "aegent-sync" });
    // davFetch 是模块内 fetch 引用——注入走 vi.stubGlobal
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const got = await store.read("manifest.json");
      expect(got).toBeUndefined(); // 404 = 远端空（批次 4 同语义）
      await store.write("manifest.json", "{}");
      expect(calls.some((c) => c.method === "PROPFIND" || c.method === "MKCOL")).toBe(true);
      expect(calls.some((c) => c.method === "PUT")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("C3 · 双设备 syncOnce（FileSystemRemoteStore 当远端）", () => {
  it("设备 A 首推 → 设备 B 本地改胜出推 → A 相对基线也改同键 → 拉取撞显式冲突（N10）", async () => {
    const remote = new FileSystemRemoteStore(path.join(tmp, "remote"));
    const passphrase = "test-passphrase";
    const entityOf = (model: string): Parameters<typeof syncOnce>[0]["local"] => [
      { domain: DOMAIN_SETTINGS, entityId: "settings.json", payload: { settings: { defaultModel: model } } },
    ];
    // 设备 A：本地 gpt-a → 推（base = gpt-a）
    const a1 = await syncOnce({
      local: entityOf("gpt-a"),
      remote,
      passphrase,
      applyEntity: () => {},
    });
    expect(a1.conflicts).toHaveLength(0);
    // 设备 B：本地 gpt-b（相对 base 改）→ 远端未变 → B 的新值合法胜出（非冲突）
    const b1 = await syncOnce({
      local: entityOf("gpt-b"),
      remote,
      passphrase,
      applyEntity: () => {},
    });
    expect(b1.conflicts).toHaveLength(0);
    // 设备 A：相对自己的 base（gpt-a）也改成 gpt-a2 → 拉到 B 的 gpt-b——
    // 同域同键**双向都改** → N10 显式冲突（SyncConflictError 抛出、零 apply，
    // 绝不后写覆盖先写）
    await expect(
      syncOnce({
        local: entityOf("gpt-a2"),
        remote,
        passphrase,
        applyEntity: () => {},
        knownBase: a1.base,
      }),
    ).rejects.toMatchObject({
      name: "SyncConflictError",
      conflicts: [expect.objectContaining({ domain: DOMAIN_SETTINGS })],
    });
    // 冲突后远端未被本侧污染（仍是 B 的 gpt-b）——对照：A 未改（local =
    // base）→ 正常拉到 gpt-b
    const a3 = await syncOnce({
      local: entityOf("gpt-a"),
      remote,
      passphrase,
      applyEntity: (e) => {
        expect((e.payload as { settings: { defaultModel: string } }).settings.defaultModel).toBe("gpt-b");
      },
      knownBase: a1.base,
    });
    expect(a3.applied).toBe(1);
    expect(a3.conflicts).toHaveLength(0);
  });
});
