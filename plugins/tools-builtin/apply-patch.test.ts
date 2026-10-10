import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../../src/core/index.js";
import { registerBuiltinTools } from "./index.js";
import { PathGuard } from "../../src/sandbox/path-guard.js";
import {
  PatchParseError,
  deriveUpdatedLines,
  parsePatchText,
} from "./apply-patch.js";
import { extractPatchWritePaths } from "../../src/policy/protected-paths.js";
import { findProtectedMetadataSegment } from "../../src/policy/protected-names.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-apply-patch-"));
  tmpDirs.push(dir);
  return dir;
}

function toolsWith(dir: string): ToolRegistry {
  const registry = new ToolRegistry();
  registerBuiltinTools(registry, { pathGuard: PathGuard.forWorkspace(dir) });
  return registry;
}

function dispatch(registry: ToolRegistry, args: unknown) {
  return registry.dispatch({
    callId: "c1",
    name: "apply_patch",
    arguments: JSON.stringify(args),
  });
}

function seedTextFile(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

describe("parsePatchText —— V4A 语法解析", () => {
  it("Add/Update(含 Move)/Delete 三类指令各解析一型", () => {
    const hunks = parsePatchText(
      [
        "*** Begin Patch",
        "*** Add File: a.txt",
        "+hello",
        "+world",
        "*** Update File: src/app.py",
        "*** Move to: src/main.py",
        "@@ def greet():",
        "-print(\"Hi\")",
        "+print(\"Hello\")",
        " print()",
        "*** Delete File: obsolete.txt",
        "*** End Patch",
      ].join("\n"),
    );
    expect(hunks).toHaveLength(3);
    expect(hunks[0]).toEqual({ type: "add", path: "a.txt", contents: "hello\nworld" });
    const updateHunk = hunks[1];
    expect(updateHunk).toMatchObject({
      type: "update",
      path: "src/app.py",
      movePath: "src/main.py",
    });
    if (updateHunk?.type === "update") {
      expect(updateHunk.chunks[0]).toEqual({
        oldLines: ["print(\"Hi\")", "print()"],
        newLines: ["print(\"Hello\")", "print()"],
        changeContext: "def greet():",
      });
    }
    expect(hunks[2]).toEqual({ type: "delete", path: "obsolete.txt" });
  });

  it("缺 Begin/End 标记、空 patch、缺路径、Add 行无 + 前缀均抛 PatchParseError", () => {
    expect(() => parsePatchText("没有标记")).toThrow(PatchParseError);
    expect(() => parsePatchText("*** Begin Patch\n*** End Patch")).toThrow(PatchParseError);
    expect(() => parsePatchText("*** Begin Patch\n*** Add File:\n+x\n*** End Patch")).toThrow(
      PatchParseError,
    );
    expect(() => parsePatchText("*** Begin Patch\n*** Add File: a.txt\nhello\n*** End Patch")).toThrow(
      PatchParseError,
    );
  });
});

describe("deriveUpdatedLines —— chunk 匹配与派生", () => {
  const original = "const a = 1;\nconst b = 2;\nconst c = 3;\n";

  it("保留行定位 + 替换：上下文行进 old/new 两边", () => {
    const next = deriveUpdatedLines("f", [{ oldLines: ["const a = 1;"], newLines: ["const a = 10;"] }], original);
    expect(next).toBe("const a = 10;\nconst b = 2;\nconst c = 3;\n");
  });

  it("纯加 chunk 追加文件尾；EOF 锚从尾部匹配；尾换行保证", () => {
    const appended = deriveUpdatedLines("f", [{ oldLines: [], newLines: ["tail"] }], original);
    expect(appended).toBe("const a = 1;\nconst b = 2;\nconst c = 3;\ntail\n");
    // EOF 锚：模式（原文件已有的行）从文件尾先试命中，新行追加其后
    const eof = deriveUpdatedLines(
      "f",
      [{ oldLines: ["const c = 3;"], newLines: ["const c = 3;", "NEW"], isEndOfFile: true }],
      original,
    );
    expect(eof).toBe("const a = 1;\nconst b = 2;\nconst c = 3;\nNEW\n");
  });

  it("rstrip 容错命中；找不到期望行序列抛错（验证阶段拒绝的来源）", () => {
    const padded = deriveUpdatedLines("f", [{ oldLines: ["const b = 2;   "], newLines: ["const b = 20;"] }], original);
    expect(padded).toContain("const b = 20;");
    expect(() => deriveUpdatedLines("f", [{ oldLines: ["不存在的行"], newLines: ["x"] }], original)).toThrow(
      /找不到 chunk 期望的行序列/,
    );
  });

  it("多 chunk 顺序前进游标（第二个 chunk 不重复匹配第一处）", () => {
    const dup = "x\nx\ny\n";
    const next = deriveUpdatedLines(
      "f",
      [
        { oldLines: ["x"], newLines: ["A"] },
        { oldLines: ["x"], newLines: ["B"] },
      ],
      dup,
    );
    expect(next).toBe("A\nB\ny\n");
  });
});

describe("apply_patch 工具（两阶段：全量验证后才执行）", () => {
  it("add/update/delete/move 各一变更落盘（A/M/D 汇总行）", async () => {
    const dir = tempDir();
    // patch 内路径与 read/write 同语义（path.resolve 相对进程 cwd）——测试
    // 用工作区内绝对路径（正斜杠形式，PathGuard 的 resolve 兼容两种分隔符）
    const p = (rel: string): string => `${dir.split(path.sep).join("/")}/${rel}`;
    seedTextFile(path.join(dir, "app.py"), "def greet():\n    print(\"Hi\")\n");
    seedTextFile(path.join(dir, "old.txt"), "gone\n");
    seedTextFile(path.join(dir, "obsolete.txt"), "bye\n");
    const patch = [
      "*** Begin Patch",
      `*** Add File: ${p("hello.txt")}`,
      "+Hello world",
      `*** Update File: ${p("app.py")}`,
      "-    print(\"Hi\")",
      "+    print(\"Hello\")",
      `*** Update File: ${p("old.txt")}`,
      `*** Move to: ${p("renamed.txt")}`,
      "-gone",
      "+moved",
      `*** Delete File: ${p("obsolete.txt")}`,
      "*** End Patch",
    ].join("\n");
    const result = await dispatch(toolsWith(dir), { patchText: patch });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain(`A ${p("hello.txt")}`);
    expect(result.content).toContain(`M ${p("app.py")}`);
    expect(result.content).toContain(`M ${p("renamed.txt")}`);
    expect(result.content).toContain(`D ${p("obsolete.txt")}`);
    expect(readFileSync(path.join(dir, "hello.txt"), "utf8")).toBe("Hello world\n");
    expect(readFileSync(path.join(dir, "app.py"), "utf8")).toBe("def greet():\n    print(\"Hello\")\n");
    expect(readFileSync(path.join(dir, "renamed.txt"), "utf8")).toBe("moved\n");
    expect(existsSync(path.join(dir, "old.txt"))).toBe(false);
    expect(existsSync(path.join(dir, "obsolete.txt"))).toBe(false);
  });

  it("第二个 hunk 验证失败 → 整体拒绝且零文件变更（验证先行，不落半态）", async () => {
    const dir = tempDir();
    const keep = path.join(dir, "keep.txt");
    seedTextFile(keep, "unchanged\n");
    const target = `${dir.split(path.sep).join("/")}/missing.txt`;
    const patch = [
      "*** Begin Patch",
      `*** Add File: ${dir.split(path.sep).join("/")}/new.txt`,
      "+data",
      `*** Update File: ${target}`,
      "-nope",
      "+yes",
      "*** End Patch",
    ].join("\n");
    const result = await dispatch(toolsWith(dir), { patchText: patch });
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("HUNK_NOT_APPLIED");
    expect(existsSync(path.join(dir, "new.txt"))).toBe(false);
    expect(readFileSync(keep, "utf8")).toBe("unchanged\n");
  });

  it("上下文不匹配 → HUNK_NOT_APPLIED 类型化错误且目标未动；空 patch（仅信封）→ 解析拒绝", async () => {
    const dir = tempDir();
    const file = path.join(dir, "code.txt");
    seedTextFile(file, "const a = 1;\n");
    const target = `${dir.split(path.sep).join("/")}/code.txt`;
    const result = await dispatch(toolsWith(dir), {
      patchText: `*** Begin Patch\n*** Update File: ${target}\n@@ 不存在的上下文\n-const a = 1;\n+const a = 2;\n*** End Patch`,
    });
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("HUNK_NOT_APPLIED");
    expect(readFileSync(file, "utf8")).toBe("const a = 1;\n");
    const empty = await dispatch(toolsWith(dir), {
      patchText: "*** Begin Patch\n*** End Patch",
    });
    expect(empty.isError).toBe(true);
    expect(empty.error?.code).toBe("PATCH_PARSE_FAILED");
  });

  it("越界目标 → 守卫拒绝且命令未执行（PATH_OUTSIDE_WRITABLE）", async () => {
    const dir = tempDir();
    const outside = tempDir();
    const target = path.join(outside, "x.txt").split(path.sep).join("/");
    const result = await dispatch(toolsWith(dir), {
      patchText: `*** Begin Patch\n*** Add File: ${target}\n+evil\n*** End Patch`,
    });
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("PATH_OUTSIDE_WRITABLE");
    expect(existsSync(path.join(outside, "x.txt"))).toBe(false);
  });

  it("C46 硬拦扫描器与解析器对齐：patch 目标含 .git 段 → policy 出口 deny（extractPatchWritePaths 全覆盖）", async () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/.git/config",
      "-a",
      "+b",
      "*** Add File: .git/hooks/pre-commit",
      "+#!/bin/sh",
      "*** End Patch",
    ].join("\n");
    const targets = extractPatchWritePaths(patch);
    expect(targets).toEqual(["src/.git/config", ".git/hooks/pre-commit"]);
    expect(targets.every((t) => findProtectedMetadataSegment(t) !== undefined)).toBe(true);
  });
});
