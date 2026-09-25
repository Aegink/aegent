import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
    expect(marker.deletable).toBe("manual");
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
