import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolRegistry, type ToolDef } from "./registry.js";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  boundedOutput,
  type SpillMarker,
} from "./truncate.js";
import { SPILL_FILE_RE, enforceSpillQuota, sweepSessionSpill } from "./spill-gc.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-trunc-"));
  tmpDirs.push(dir);
  return dir;
}

function opts(dir: string, extra?: Partial<Parameters<typeof boundedOutput>[1]>) {
  return {
    sessionId: "s-test",
    tool: "fake",
    callId: "c-test",
    spillDir: dir,
    ...extra,
  };
}

describe("boundedOutput（B5/B10：50KB / 2000 行先到先算）", () => {
  it("未超限：原样通过，不落盘", async () => {
    const dir = tempDir();
    const out = await boundedOutput("短输出\n两行", opts(dir));
    expect(out.truncated).toBe(false);
    expect(out.text).toBe("短输出\n两行");
    expect(out.spilled).toBeUndefined();
  });

  it("行数触发（2001 行）：保留头 2000 行，尾部提示含完整输出路径（验收②）", async () => {
    const dir = tempDir();
    const raw = Array.from({ length: DEFAULT_MAX_LINES + 1 }, (_, i) => `line-${String(i)}`).join("\n");
    const out = await boundedOutput(raw, opts(dir));
    expect(out.truncated).toBe(true);
    expect(out.truncatedBy).toBe("lines");
    expect(String(out.text).split("\n").length).toBe(DEFAULT_MAX_LINES + 2); // 头 2000 行 + 空行 + 单行提示
    expect(out.text).toContain(`完整输出在 ${out.spilled?.path ?? "?"}`);
  });

  it("字节触发（>51KB，多字节中文不切断）：无乱码、截后字节不超限（验收①）", async () => {
    const dir = tempDir();
    // 每个中文 3 字节，构造约 60KB
    const raw = "测".repeat(20_000);
    const out = await boundedOutput(raw, opts(dir));
    expect(out.truncated).toBe(true);
    expect(out.truncatedBy).toBe("bytes");
    const hintAt = String(out.text).lastIndexOf("\n\n[Output truncated");
    const keptPart = String(out.text).slice(0, hintAt);
    expect(Buffer.byteLength(keptPart, "utf8")).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
    expect(keptPart).not.toContain("\uFFFD");
    expect(out.text).toContain("完整输出在");
  });

  it("行与字节双触发：先截行再截字节，truncatedBy 记最后生效者；spill 落完整原文（验收①双触发点）", async () => {
    const dir = tempDir();
    // 2100 行、每行约 100 字节 → 行限与字节限都超；先截 2000 行（约 200KB）仍超字节
    const raw = Array.from({ length: 2100 }, (_, i) => `x${String(i).padStart(3, "0")}`.padEnd(100, "y")).join("\n");
    const out = await boundedOutput(raw, opts(dir));
    expect(out.truncatedBy).toBe("bytes");
    // spill 文件 = 完整原文（首行标记 + 空行 + 原文）
    const spillPath = out.spilled?.path;
    expect(spillPath).toBeDefined();
    const content = readFileSync(spillPath ?? "", "utf8");
    const firstLine = content.split("\n")[0] ?? "{}";
    const marker = JSON.parse(firstLine) as SpillMarker;
    expect(marker.kind).toBe("aegent/tool-output-spill");
    expect(marker.sessionId).toBe("s-test");
    expect(marker.tool).toBe("fake");
    expect(marker.callId).toBe("c-test");
    expect(marker.deletable).toBe("after-session-end");
    expect(marker.truncatedBy).toBe("bytes");
    // Q13 标记 + 空行之后是完整原文
    expect(content.slice(firstLine.length + 2)).toBe(raw);
  }, 10_000);
});

describe("registry 出口接入（全部工具一次接入）", () => {
  function makeRegistry(dir: string): ToolRegistry {
    const registry = new ToolRegistry({ sessionId: "s-1", spillDir: dir });
    const big: ToolDef = {
      name: "big",
      execute: () => ({
        content: Array.from({ length: 2100 }, (_, i) => `row-${String(i)}`).join("\n"),
        meta: { exitCode: 0 },
      }),
    };
    registry.registerTool(big);
    return registry;
  }

  it("dispatch 返回截断 content + meta 合并（truncated/spillPath 与工具自带 meta 共存）", async () => {
    const dir = tempDir();
    const registry = makeRegistry(dir);
    const result = await registry.dispatch({
      callId: "call-9",
      name: "big",
      arguments: "{}",
    });
    expect(result.meta).toMatchObject({ exitCode: 0, truncated: true, truncatedBy: "lines" });
    expect(String(result.meta && typeof result.meta === "object" && !Array.isArray(result.meta) ? (result.meta as Record<string, unknown>)["spillPath"] : "")).not.toBe("");
    expect(result.content).toContain("完整输出在");
    // spill 标记的 tool/callId 来自 dispatch 的调用事实
    const spillPath = String((result.meta as Record<string, unknown>)["spillPath"]);
    const marker = JSON.parse(readFileSync(spillPath, "utf8").split("\n")[0] ?? "{}") as SpillMarker;
    expect(marker.tool).toBe("big");
    expect(marker.callId).toBe("call-9");
    expect(marker.sessionId).toBe("s-1");
  });

  it("isError 结果同样过截断（超大错误输出不淹没上下文）", async () => {
    const dir = tempDir();
    const registry = new ToolRegistry({ sessionId: "s-1", spillDir: dir });
    registry.registerTool({
      name: "bad",
      execute: () => ({
        content: "e".repeat(DEFAULT_MAX_BYTES + 1000),
        isError: true,
        error: { name: "BadError", code: "BIG" },
      }),
    });
    const result = await registry.dispatch({ callId: "c", name: "bad", arguments: "{}" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("完整输出在");
  });
});

// ---------------------------------------------------------------------------
// spill GC（Q3/T-P1-14）：落盘文件生命周期——会话关闭 + 超量两触发
// ---------------------------------------------------------------------------

/** 手工写一个带合法标记的 spill 文件（GC 测试的固定形状输入）。 */
function writeSpillFile(
  dir: string,
  opts: {
    sessionId: string;
    createdAt?: string;
    deletable?: "manual" | "after-session-end";
    callId?: string;
  },
): string {
  const marker: SpillMarker = {
    kind: "aegent/tool-output-spill",
    sessionId: opts.sessionId,
    tool: "fake",
    callId: opts.callId ?? "c",
    createdAt: opts.createdAt ?? new Date().toISOString(),
    deletable: opts.deletable ?? "after-session-end",
    truncatedBy: "bytes",
  };
  const filePath = path.join(
    dir,
    `spill-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.txt`,
  );
  writeFileSync(filePath, `${JSON.stringify(marker)}\n\n原文`, "utf8");
  return filePath;
}

describe("spill GC（Q3：清理只认自己打过标记的文件）", () => {
  it("验收①超量触发：N 次截断后 spill 文件数有界（≤上限）且最老先删", async () => {
    const dir = tempDir();
    const registry = new ToolRegistry({ sessionId: "s-1", spillDir: dir, spillMaxFiles: 5 });
    registry.registerTool({
      name: "big",
      execute: () => ({ content: "e".repeat(DEFAULT_MAX_BYTES + 100) }),
    });
    for (let i = 0; i < 12; i++) {
      await registry.dispatch({ callId: `c${String(i)}`, name: "big", arguments: "{}" });
      // createdAt 毫秒级：同毫秒会打平使"最老先删"不稳定，间隔 3ms 保证严格递增
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
    const survivors = readdirSync(dir).filter((n) => SPILL_FILE_RE.test(n));
    expect(survivors.length).toBe(5);
    // 最老先删：活下来的是最后 5 次调用（c7..c11）的 spill
    const callIds = new Set(
      survivors.map((n) => {
        const marker = JSON.parse(readFileSync(path.join(dir, n), "utf8").split("\n")[0] ?? "{}") as SpillMarker;
        return marker.callId;
      }),
    );
    expect([...callIds].sort()).toEqual(["c10", "c11", "c7", "c8", "c9"]);
  });

  it("验收②证伪：清理不误删非 spill 文件（外来文件/形状相近无标记/名字形状命中的目录）", async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "notes.txt"), "用户的普通文件", "utf8");
    writeFileSync(path.join(dir, "keep.json"), "{}", "utf8");
    // 文件名形状命中但首行不是我们的标记：外来内容，连删的资格都没有
    writeFileSync(path.join(dir, "spill-123-456-abcdef.txt"), "不是标记的首行", "utf8");
    // 名字形状命中的目录：lstat 跳过，绝不递归
    mkdirSync(path.join(dir, "spill-789-012-abcdef.txt"));
    // 上限 0 是最激进配额 + 会话清理双触发，四样原样保留
    await sweepSessionSpill(dir, "s-1");
    await enforceSpillQuota(dir, 0);
    expect(readFileSync(path.join(dir, "notes.txt"), "utf8")).toBe("用户的普通文件");
    expect(readFileSync(path.join(dir, "spill-123-456-abcdef.txt"), "utf8")).toBe("不是标记的首行");
    expect(existsSync(path.join(dir, "spill-789-012-abcdef.txt"))).toBe(true);
    expect(existsSync(path.join(dir, "keep.json"))).toBe(true);
  });

  it("验收③会话关闭触发：本会话自动可删文件清掉，其他会话/manual/外来全保留", async () => {
    const dir = tempDir();
    const s1Auto = writeSpillFile(dir, { sessionId: "s1", callId: "auto" });
    const s1Manual = writeSpillFile(dir, { sessionId: "s1", deletable: "manual", callId: "manual" });
    const s2File = writeSpillFile(dir, { sessionId: "s2", callId: "other" });
    const foreign = path.join(dir, "notes.txt");
    writeFileSync(foreign, "keep", "utf8");
    const report = await sweepSessionSpill(dir, "s1");
    expect(existsSync(s1Auto)).toBe(false);
    expect(existsSync(s1Manual)).toBe(true);
    expect(existsSync(s2File)).toBe(true);
    expect(existsSync(foreign)).toBe(true);
    expect(report.deleted).toEqual([s1Auto]);
  });

  it("超量驱逐只碰自动可删者：manual 者即使最老也保留（deletable 纪律）", async () => {
    const dir = tempDir();
    const manualOld = writeSpillFile(dir, {
      sessionId: "s1",
      createdAt: "2026-01-01T00:00:00.000Z",
      deletable: "manual",
    });
    const autoMid = writeSpillFile(dir, { sessionId: "s1", createdAt: "2026-01-02T00:00:00.000Z" });
    const autoNew = writeSpillFile(dir, { sessionId: "s1", createdAt: "2026-01-03T00:00:00.000Z" });
    const report = await enforceSpillQuota(dir, 1);
    expect(existsSync(manualOld)).toBe(true);
    expect(existsSync(autoMid)).toBe(false);
    expect(existsSync(autoNew)).toBe(false);
    expect(report.deleted.sort()).toEqual([autoMid, autoNew].sort());
  });

  it("目录不存在 = 无 spill 可清（常见路径，非错误）；删除失败收集报告不抛", async () => {
    const missing = path.join(tempDir(), "nope");
    const report = await sweepSessionSpill(missing, "s1");
    expect(report.deleted).toEqual([]);
    const quotaReport = await enforceSpillQuota(missing, 5);
    expect(quotaReport.deleted).toEqual([]);
  });
});
