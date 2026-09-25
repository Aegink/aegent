import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { NodeExecutionEnv } from "../env.js";
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

describe("bash 工具（T-4-05 回填后：执行经 ExecutionEnv）", () => {
  it("参数校验：command 缺失 / timeout 非法即拒", async () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const noCmd = await dispatch(registry, "bash", { timeout: 5 });
    expect(noCmd.error?.code).toBe("INVALID_ARGUMENTS");
    const badTimeout = await dispatch(registry, "bash", { command: "ls", timeout: 0 });
    expect(badTimeout.error?.code).toBe("INVALID_ARGUMENTS");
    const hugeTimeout = await dispatch(registry, "bash", { command: "ls", timeout: 1e12 });
    expect(hugeTimeout.error?.code).toBe("INVALID_ARGUMENTS");
  });

  it("缺 ExecutionEnv → isError EXECUTION_ENV_MISSING（装配缺失的明确报错）", async () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const stub = await dispatch(registry, "bash", { command: "echo hi" });
    expect(stub.isError).toBe(true);
    expect(stub.error?.code).toBe("EXECUTION_ENV_MISSING");
  });

  it("经 env 真执行：stdout 回显（回填验收：stdout/exit code）", async () => {
    const registry = new ToolRegistry({ env: new NodeExecutionEnv() });
    registerBuiltinTools(registry);
    const ok = await dispatch(registry, "bash", { command: "echo aegent-bash-ok" });
    expect(ok.isError).toBeUndefined();
    // 输出原样转述（含尾换行不 trim）；截断属 T-4-06
    expect(ok.content).toBe("aegent-bash-ok\n");
    expect(ok.meta).toEqual({ exitCode: 0 });
  }, 10_000);

  it("非零退出码 → isError + [exit code N] + meta.exitCode；空输出 → (no output)", async () => {
    const registry = new ToolRegistry({ env: new NodeExecutionEnv() });
    registerBuiltinTools(registry);
    const failed = await dispatch(registry, "bash", { command: "echo oops >&2; exit 7" });
    expect(failed.isError).toBe(true);
    expect(failed.content).toContain("oops");
    expect(failed.content).toContain("[exit code 7]");
    expect(failed.meta).toEqual({ exitCode: 7 });
    const silent = await dispatch(registry, "bash", { command: "true" });
    expect(silent.isError).toBeUndefined();
    expect(silent.content).toBe("(no output)");
  }, 10_000);

  it("timeout 超时 → isError TOOL_TIMEOUT（J22 词汇贯穿）", async () => {
    const registry = new ToolRegistry({ env: new NodeExecutionEnv() });
    registerBuiltinTools(registry);
    const slow = await dispatch(registry, "bash", { command: "sleep 5", timeout: 1 });
    expect(slow.isError).toBe(true);
    expect(slow.error?.code).toBe("TOOL_TIMEOUT");
  }, 10_000);
});

describe("edit 工具", () => {
  it("唯一匹配替换成功并落盘（newText 原样写入，$& 等不被解释）", async () => {
    const dir = tempDir();
    const file = path.join(dir, "code.txt");
    writeFileSync(file, "const a = 1;\nconst b = 2;\n", "utf8");
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const result = await dispatch(registry, "edit", {
      path: file,
      oldText: "const a = 1;",
      newText: 'const a = "$&"; // keep',
    });
    expect(result.isError).toBeUndefined();
    expect(readFileSync(file, "utf8")).toBe('const a = "$&"; // keep\nconst b = 2;\n');
  });

  it("oldText 不唯一 → NOT_UNIQUE；未找到 → NOT_FOUND（均 isError 不落盘）", async () => {
    const dir = tempDir();
    const file = path.join(dir, "dup.txt");
    writeFileSync(file, "x\nx\ny\n", "utf8");
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const notUnique = await dispatch(registry, "edit", {
      path: file,
      oldText: "x",
      newText: "z",
    });
    expect(notUnique.isError).toBe(true);
    expect(notUnique.error?.code).toBe("OLD_TEXT_NOT_UNIQUE");
    const notFound = await dispatch(registry, "edit", {
      path: file,
      oldText: "不存在的串",
      newText: "z",
    });
    expect(notFound.isError).toBe(true);
    expect(notFound.error?.code).toBe("OLD_TEXT_NOT_FOUND");
    expect(readFileSync(file, "utf8")).toBe("x\nx\ny\n");
  });

  it("参数坏（oldText 空 / newText 缺失）→ isError INVALID_ARGUMENTS", async () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const empty = await dispatch(registry, "edit", { path: "a.txt", oldText: "", newText: "x" });
    expect(empty.error?.code).toBe("INVALID_ARGUMENTS");
    const noNew = await dispatch(registry, "edit", { path: "a.txt", oldText: "x" });
    expect(noNew.error?.code).toBe("INVALID_ARGUMENTS");
  });
});

describe("glob 工具", () => {
  it("嵌套目录按模式匹配，输出绝对路径字母序（*.ts 与 ** 跨段与 ?）", async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "a.ts"), "", "utf8");
    mkdirSync(path.join(dir, "sub", "deep"), { recursive: true });
    writeFileSync(path.join(dir, "sub", "b.ts"), "", "utf8");
    writeFileSync(path.join(dir, "sub", "deep", "c.ts"), "", "utf8");
    writeFileSync(path.join(dir, "note.md"), "", "utf8");
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);

    const tsFiles = await dispatch(registry, "glob", { pattern: "**/*.ts", path: dir });
    expect(tsFiles.content).toBe(
      [
        path.join(dir, "a.ts"),
        path.join(dir, "sub", "b.ts"),
        path.join(dir, "sub", "deep", "c.ts"),
      ].join("\n"),
    );

    const deep = await dispatch(registry, "glob", { pattern: "**/deep/*.ts", path: dir });
    expect(deep.content).toBe(path.join(dir, "sub", "deep", "c.ts"));

    const singleChar = await dispatch(registry, "glob", { pattern: "?.ts", path: dir });
    expect(singleChar.content).toBe(path.join(dir, "a.ts"));
  });

  it("无匹配空输出；超上限截断提示（默认 100）", async () => {
    const dir = tempDir();
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const none = await dispatch(registry, "glob", { pattern: "*.nope", path: dir });
    expect(none.content).toBe("No files found");

    for (let i = 0; i < 101; i++) {
      writeFileSync(path.join(dir, `f${String(i).padStart(3, "0")}.ts`), "", "utf8");
    }
    const many = await dispatch(registry, "glob", { pattern: "f*.ts", path: dir });
    const lines = String(many.content).split("\n");
    expect(lines).toHaveLength(102); // 100 条 + 空行 + 截断提示
    expect(String(many.content)).toContain("101 files matched, showing first 100");
  });
});

describe("grep 工具（P0 纯 JS 实现）", () => {
  it("嵌套目录多文件搜索，行号与内容正确；include 按 glob 过滤", async () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "src", "one.ts"), "const a = 1;\nconst b = alpha;\n", "utf8");
    writeFileSync(path.join(dir, "two.md"), "# alpha\n", "utf8");
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);

    const all = await dispatch(registry, "grep", { pattern: "alpha", path: dir });
    expect(String(all.content).split("\n")).toEqual([
      `${path.join(dir, "src", "one.ts")}:2: const b = alpha;`,
      `${path.join(dir, "two.md")}:1: # alpha`,
    ]);

    const tsOnly = await dispatch(registry, "grep", {
      pattern: "alpha",
      path: dir,
      include: "*.ts",
    });
    expect(String(tsOnly.content)).toBe(
      `${path.join(dir, "src", "one.ts")}:2: const b = alpha;`,
    );
  });

  it("单文件搜索；正则语法；非法正则 isError；无匹配 No matches found", async () => {
    const dir = tempDir();
    const file = path.join(dir, "nums.txt");
    writeFileSync(file, "n 1\nn 22\nn 333\n", "utf8");
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);

    const single = await dispatch(registry, "grep", { pattern: "\\d{3}", path: file });
    expect(String(single.content)).toBe(`${file}:3: n 333`);

    const dirSearch = await dispatch(registry, "grep", { pattern: "n \\d+", path: dir });
    expect(String(dirSearch.content)).toContain("n 333");

    const none = await dispatch(registry, "grep", { pattern: "不存在的文本", path: dir });
    expect(none.content).toBe("No matches found");

    const badRe = await dispatch(registry, "grep", { pattern: "([", path: dir });
    expect(badRe.isError).toBe(true);
    expect(badRe.error?.code).toBe("INVALID_PATTERN");
  });
});

describe("内置工具注册入口", () => {
  it("registerBuiltinTools 挂上六个内置工具，且描述文件在位（B2）", () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    expect(registry.names()).toEqual(["read", "write", "bash", "edit", "glob", "grep"]);
    // 描述从真 descriptions/ 目录读出（非空）——内置描述文件的存在性证明
    for (const name of registry.names()) {
      expect(registry.description(name).length).toBeGreaterThan(0);
    }
  });
});
