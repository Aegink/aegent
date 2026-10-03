// T-P3-155：关于中心——版本比较/构建信息读取/更新检查软降级/路径校验。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkUpdateOp, openPathOp, readBuildInfo } from "./about-ops.js";
import { compareVersions } from "./version-compare.js";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe("compareVersions", () => {
  it("数字段逐段比较+v 前缀归一", () => {
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
    expect(compareVersions("v0.2.0", "0.10.0")).toBe(-1); // 逐段数值——2 < 10
    expect(compareVersions("0.1.0", "v0.1.0")).toBe(0);
  });
  it("预发布低于同号正式版", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-beta")).toBe(1);
  });
});

describe("readBuildInfo", () => {
  it("读 dist/build-info.json（构建期注入）", () => {
    const dir = mkdtempSync(join(tmpdir(), "aegent-about-"));
    dirs.push(dir);
    writeFileSync(join(dir, "build-info.json"), JSON.stringify({ version: "9.9.9", gitCommit: "abc1234", buildTime: "2026-10-03T00:00:00.000Z" }), "utf8");
    const info = readBuildInfo(dir);
    expect(info.version).toBe("9.9.9");
    expect(info.gitCommit).toBe("abc1234");
  });
  it("无文件回退：unknown 占位不炸", () => {
    const dir = mkdtempSync(join(tmpdir(), "aegent-about2-"));
    dirs.push(dir);
    const info = readBuildInfo(join(dir, "dist"));
    expect(info.version).toBe("unknown"); // 回退链失败=unknown 占位
  });
});

describe("checkUpdateOp", () => {
  it("发现新版：available+latest/notes/url", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ tag_name: "v0.2.0", body: "修复若干", html_url: "https://github.com/Aegink/aegent/releases/tag/v0.2.0" }), { status: 200 })));
    const r = await checkUpdateOp("0.1.0");
    expect(r.status).toBe("available");
    expect(r.latest).toBe("0.2.0");
    expect(r.notes).toBe("修复若干");
    expect(r.url).toContain("releases");
  });
  it("已最新 / 非法 tag / 网络失败 → 软降级（不抛）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ tag_name: "v0.1.0" }), { status: 200 })));
    expect((await checkUpdateOp("0.1.0")).status).toBe("up-to-date");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ tag_name: "not-a-version" }), { status: 200 })));
    const bad = await checkUpdateOp("0.1.0");
    expect(bad.status).toBe("error");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("断网");
    }));
    const err = await checkUpdateOp("0.1.0");
    expect(err.status).toBe("error");
    expect(err.reason).toBe("断网");
  });
});

describe("openPathOp", () => {
  it("路径不存在类型化拒绝", () => {
    expect(() => openPathOp(join(tmpdir(), "aegent-nope-xyz"))).toThrow(/路径不存在/);
  });
});
