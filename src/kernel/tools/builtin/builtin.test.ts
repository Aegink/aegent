import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { registerBuiltinTools } from "./index.js";

const tmpDirs: string[] = [];
afterEach(() => {
  // 测试夹具自清理（mkdtemp 建在 os.tmpdir()，只删本测试建的目录）
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-builtin-"));
  tmpDirs.push(dir);
  return dir;
}

function dispatch(registry: ToolRegistry, name: string, args: unknown) {
  return registry.dispatch({
    callId: "c1",
    name,
    arguments: JSON.stringify(args),
  });
}

describe("read 工具", () => {
  it("读文件原文（多行，含中文）", async () => {
    const dir = tempDir();
    const file = path.join(dir, "sample.txt");
    writeFileSync(file, "第一行\nsecond line\n第三行\n", "utf8");
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const result = await dispatch(registry, "read", { path: file });
    // 尾换行不算一行：原文去尾空行
    expect(result).toEqual({ content: "第一行\nsecond line\n第三行" });
  });

  it("offset/limit 切片 + 续读导航提示（pi 同款）", async () => {
    const dir = tempDir();
    const file = path.join(dir, "big.txt");
    writeFileSync(file, "l1\nl2\nl3\nl4\nl5\n", "utf8");
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const result = await dispatch(registry, "read", { path: file, offset: 2, limit: 2 });
    expect(result.content).toBe("l2\nl3\n\n[Showing lines 2-3 of 5. Use offset=4 to continue.]");
  });

  it("边界：不存在路径 → isError（ENOENT）；空文件 → 空输出；offset 越界 → isError", async () => {
    const dir = tempDir();
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const missing = await dispatch(registry, "read", { path: path.join(dir, "no-such.txt") });
    expect(missing.isError).toBe(true);
    expect(missing.error?.code).toBe("ENOENT");

    const empty = path.join(dir, "empty.txt");
    writeFileSync(empty, "", "utf8");
    const result = await dispatch(registry, "read", { path: empty });
    expect(result).toEqual({ content: "" });

    const beyond = await dispatch(registry, "read", { path: empty, offset: 2 });
    expect(beyond.isError).toBe(true);
    expect(beyond.error?.code).toBe("OFFSET_BEYOND_EOF");
  });
});

describe("write 工具", () => {
  it("写新文件（父目录不存在自动创建），落盘内容一致", async () => {
    const dir = tempDir();
    const file = path.join(dir, "nested", "deep", "out.txt");
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const result = await dispatch(registry, "write", { path: file, content: "hello 你好\n" });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Successfully wrote to");
    expect(readFileSync(file, "utf8")).toBe("hello 你好\n");
  });

  it("覆盖已有文件；空内容边界（0 字节）", async () => {
    const dir = tempDir();
    const file = path.join(dir, "over.txt");
    writeFileSync(file, "old", "utf8");
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    await dispatch(registry, "write", { path: file, content: "new content" });
    expect(readFileSync(file, "utf8")).toBe("new content");

    const empty = await dispatch(registry, "write", { path: file, content: "" });
    expect(empty.isError).toBeUndefined();
    expect(empty.content).toContain("(0 bytes)");
    expect(readFileSync(file, "utf8")).toBe("");
  });

  it("参数坏 → isError INVALID_ARGUMENTS（path 缺失 / content 非字符串）", async () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const noPath = await dispatch(registry, "write", { content: "x" });
    expect(noPath.error?.code).toBe("INVALID_ARGUMENTS");
    const badContent = await dispatch(registry, "write", { path: "a.txt", content: 42 });
    expect(badContent.error?.code).toBe("INVALID_ARGUMENTS");
  });
});

describe("bash 工具（P0 桩，T-4-05 回填）", () => {
  it("参数校验落地（command 缺失 / timeout 非法即拒），合法参数落在桩上", async () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const noCmd = await dispatch(registry, "bash", { timeout: 5 });
    expect(noCmd.error?.code).toBe("INVALID_ARGUMENTS");
    const badTimeout = await dispatch(registry, "bash", { command: "ls", timeout: 0 });
    expect(badTimeout.error?.code).toBe("INVALID_ARGUMENTS");
    const stub = await dispatch(registry, "bash", { command: "echo hi" });
    expect(stub.isError).toBe(true);
    expect(stub.error?.code).toBe("TOOL_NOT_IMPLEMENTED");
  });
});

describe("内置工具注册入口", () => {
  it("registerBuiltinTools 挂上 read/write/bash，且描述文件在位（B2）", () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    expect(registry.names()).toEqual(["read", "write", "bash"]);
    // 描述从真 descriptions/ 目录读出（非空）——内置描述文件的存在性证明
    for (const name of registry.names()) {
      expect(registry.description(name).length).toBeGreaterThan(0);
    }
  });
});
