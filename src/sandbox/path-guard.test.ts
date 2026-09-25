/**
 * 路径守卫测试（T-6-01 · C7/D1）：
 * - C7 场景④：工作区外写被拒且报错含目标路径（"报错明确"）；
 * - D1：白名单两段式、读面缺省不限、bash 经 T-5-14 虚拟文件操作接入、
 *   工具层无旁路（工厂必收守卫）；
 * - realpath 归一（含 Windows 大小写与 MSYS 盘符方言）、不可静态验证目标
 *   fail-closed、LIMITATIONS 双载体同文。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeShellCommand } from "../policy/shell-semantics.js";
import type { ExecutionEnv } from "../kernel/tools/env.js";
import { ToolRegistry } from "../kernel/tools/registry.js";
import { createBashTool } from "../kernel/tools/builtin/bash.js";
import { createEditTool } from "../kernel/tools/builtin/edit.js";
import { createReadTool } from "../kernel/tools/builtin/read.js";
import { createWriteTool } from "../kernel/tools/builtin/write.js";
import {
  PATH_GUARD_LIMITATIONS,
  PathGuard,
  PathGuardError,
  resolveShellTarget,
} from "./path-guard.js";
import { seedTextFile } from "../test-support/tmp-fs.js";

const WIN = process.platform === "win32";
const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function makeWorkspace(): { ws: string; outside: string; guard: PathGuard } {
  const ws = tempDir("aegent-ws-");
  const outside = tempDir("aegent-out-");
  return { ws, outside, guard: PathGuard.forWorkspace(ws) };
}

// 符号链接探针：创建需要特权（Windows 需开发者模式），不可创建则跳过逃逸用例
let canSymlink = false;
{
  const probe = mkdtempSync(path.join(tmpdir(), "aegent-symprobe-"));
  try {
    const target = path.join(probe, "target.txt");
    seedTextFile(target, "t");
    await symlink(target, path.join(probe, "link.txt"), "file");
    canSymlink = true;
  } catch {
    // 无符号链接特权（LIMITATIONS #1：此时逃逸路径无法实测）
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

describe("PathGuard · 写边界（C7 场景④）", () => {
  it("工作区内写放行（含多级不存在目录自动创建），落盘一致", async () => {
    const { ws, guard } = makeWorkspace();
    await guard.write(path.join(ws, "a.txt"), "hello 你好");
    expect(readFileSync(path.join(ws, "a.txt"), "utf8")).toBe("hello 你好");
    await guard.write(path.join(ws, "nested", "deep", "b.txt"), "x");
    expect(readFileSync(path.join(ws, "nested", "deep", "b.txt"), "utf8")).toBe("x");
  });

  it("工作区外写拒绝：报错含目标绝对路径、目标不落盘（场景④）", async () => {
    const { ws, outside, guard } = makeWorkspace();
    const target = path.join(outside, "escape.txt");
    const err = await guard.assertWritable(target).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PathGuardError);
    expect((err as PathGuardError).code).toBe("PATH_OUTSIDE_WRITABLE");
    expect((err as Error).message).toContain(target); // 报错明确：含目标路径
    expect((err as Error).message).toContain(ws); // 且告知允许范围
    await guard.write(target, "x").catch(() => {});
    expect(existsSync(target)).toBe(false); // 拒绝的写不落盘
  });

  it("前缀孪生目录不误放（path.relative 防 startsWith 假匹配）", async () => {
    const { ws, guard } = makeWorkspace();
    const evilRoot = `${ws}-evil`; // 真实存在的兄弟目录
    const err = await guard.assertWritable(path.join(evilRoot, "x.txt")).catch((e: unknown) => e);
    expect((err as PathGuardError).code).toBe("PATH_OUTSIDE_WRITABLE");
  });

  it("写白名单放行工作区外的显式目录（codex 白名单覆盖形状）", async () => {
    const { ws, outside } = makeWorkspace();
    const guard = PathGuard.forWorkspace(ws, { writeWhitelist: [outside] });
    await guard.write(path.join(outside, "allowed.txt"), "ok");
    expect(readFileSync(path.join(outside, "allowed.txt"), "utf8")).toBe("ok");
  });

  it("Windows 大小写不敏感：大小写变体路径仍判工作区内（runIf win32）", { skip: !WIN }, async () => {
    const { ws, guard } = makeWorkspace();
    await guard.assertWritable(path.join(ws.toUpperCase(), "case.txt"));
    await guard.write(path.join(ws.toUpperCase(), "case.txt"), "ok");
  });

  it("符号链接逃逸：工作区内链接指向外界目标 → 拒绝（runIf 可创建符号链接）", { skip: !canSymlink }, async () => {
    const { ws, outside, guard } = makeWorkspace();
    const target = path.join(outside, "real.txt");
    seedTextFile(target, "secret");
    const link = path.join(ws, "jump.txt");
    await symlink(target, link, "file");
    const err = await guard.assertWritable(link).catch((e: unknown) => e);
    expect((err as PathGuardError).code).toBe("PATH_OUTSIDE_WRITABLE");
  });
});

describe("PathGuard · 读边界（P0 缺省不限）", () => {
  it("缺省全盘可读：工作区外直通（与 C46 出口 read 不拦一致）", async () => {
    const { ws, outside, guard } = makeWorkspace();
    const file = path.join(outside, "anywhere.txt");
    seedTextFile(file, "content");
    await guard.assertReadable(file);
    expect(await guard.read(file)).toBe("content");
    await guard.assertReadable(path.join(ws, "missing-but-fine.txt")); // 读断言放行，I/O 才报 ENOENT
  });

  it("配置 readRoots 后读边界生效：外界读拒绝且报错含目标", async () => {
    const { ws, outside } = makeWorkspace();
    const guard = PathGuard.forWorkspace(ws, { readRoots: [] });
    const file = path.join(outside, "secret.txt");
    const err = await guard.assertReadable(file).catch((e: unknown) => e);
    expect((err as PathGuardError).code).toBe("PATH_OUTSIDE_READABLE");
    expect((err as Error).message).toContain(file);
    await guard.assertReadable(path.join(ws, "inside.txt")); // 工作区内仍可读
  });
});

describe("resolveShellTarget · bash 方言", () => {
  it("变量/命令替换/引号目标不可验证", () => {
    expect(resolveShellTarget("$OUT/x")).toEqual({ unverifiable: true, reason: expect.any(String) });
    expect(resolveShellTarget("a`id`b")).toEqual({ unverifiable: true, reason: expect.any(String) });
    expect(resolveShellTarget('"my file.txt"')).toEqual({ unverifiable: true, reason: expect.any(String) });
  });

  it("相对路径无 cd → 解析到进程 cwd（bash 继承进程工作目录）", () => {
    const r = resolveShellTarget("rel/out.txt");
    expect("abs" in r && r.abs).toBe(path.resolve(process.cwd(), "rel/out.txt"));
  });

  it("~ 展开到家目录；~user 不可验证", () => {
    const r = resolveShellTarget("~/notes.txt");
    expect("abs" in r && r.abs).toBe(path.join(homedir(), "notes.txt"));
    expect(resolveShellTarget("~other/x")).toEqual({ unverifiable: true, reason: expect.any(String) });
  });

  it.runIf(WIN)("win32：反斜杠目标不可验证；无盘符 POSIX 路径不可验证", () => {
    expect(resolveShellTarget("F:\\ws\\x.txt")).toEqual({ unverifiable: true, reason: expect.any(String) });
    expect(resolveShellTarget("/tmp/x")).toEqual({ unverifiable: true, reason: expect.any(String) });
  });

  it.runIf(WIN)("win32：MSYS 盘符形式 /c/... → C:\\...", () => {
    const r = resolveShellTarget("/f/aegent/src/x.txt");
    expect("abs" in r && r.abs).toBe("F:\\aegent\\src\\x.txt");
    expect(resolveShellTarget("/f")).toEqual({ abs: "F:\\" });
  });
});

describe("assertShellFileOps · bash 经 T-5-14 虚拟文件操作接入", () => {
  it("重定向写工作区内放行；写外界拒绝；不可验证 fail-closed", async () => {
    const { ws, outside, guard } = makeWorkspace();
    const insideTarget = path.join(ws, "out.txt").split(path.sep).join("/");
    await guard.assertShellFileOps([
      { kind: "file-write", path: insideTarget },
    ]);
    await expect(
      guard.assertShellFileOps([{ kind: "file-write", path: path.join(outside, "x.txt").split(path.sep).join("/") }]),
    ).rejects.toMatchObject({ code: "PATH_OUTSIDE_WRITABLE" });
    await expect(
      guard.assertShellFileOps([{ kind: "file-write", path: "$HOME/x", cwdUnknown: true }]),
    ).rejects.toMatchObject({ code: "PATH_UNVERIFIABLE" });
  });

  it("file-read 缺省直通（读面不限）；&N fd 目标按非文件跳过；command 类不处理", async () => {
    const { guard } = makeWorkspace();
    await guard.assertShellFileOps([
      { kind: "file-read", path: "/etc/hosts" },
      { kind: "file-write", path: "&2" },
      { kind: "command", command: "echo hi" },
    ]);
  });

  it("file-read 在受限读面下：外界拒绝、不可验证拒绝（fail-closed）", async () => {
    const { ws, outside } = makeWorkspace();
    const guard = PathGuard.forWorkspace(ws, { readRoots: [] });
    await expect(
      guard.assertShellFileOps([{ kind: "file-read", path: path.join(outside, "s").split(path.sep).join("/") }]),
    ).rejects.toMatchObject({ code: "PATH_OUTSIDE_READABLE" });
    await expect(
      guard.assertShellFileOps([{ kind: "file-read", path: "$F" }]),
    ).rejects.toMatchObject({ code: "PATH_UNVERIFIABLE" });
  });

  it("真实扫描器联测（T-5-14 analyzeShellCommand）：绝对目标放行、cd 后相对目标拒绝", async () => {
    const { ws, guard } = makeWorkspace();
    const insideTarget = path.join(ws, "ok.txt").split(path.sep).join("/");
    await guard.assertShellFileOps(analyzeShellCommand(`echo hi > ${insideTarget}`).ops);
    const err = await guard
      .assertShellFileOps(analyzeShellCommand("cd somewhere && echo hi > rel.txt").ops)
      .catch((e: unknown) => e);
    expect((err as PathGuardError).code).toBe("PATH_UNVERIFIABLE");
  });
});

describe("工具层接入（无旁路：工厂必收守卫）", () => {
  function registryWith(
    dir: string,
    register: (registry: ToolRegistry) => void,
    env?: ExecutionEnv,
  ): ToolRegistry {
    const registry = new ToolRegistry(env !== undefined ? { env } : undefined);
    register(registry);
    return registry;
  }

  function dispatch(registry: ToolRegistry, name: string, args: unknown) {
    return registry.dispatch({ callId: "c1", name, arguments: JSON.stringify(args) });
  }

  it("bash 工具：越界重定向 isError 且命令未启动（exec 零调用）", async () => {
    const { ws, outside } = makeWorkspace();
    const execCalls: string[] = [];
    const fakeEnv = {
      exec: async (cmd: string) => {
        execCalls.push(cmd);
        return { stdout: "ok", stderr: "", exitCode: 0 };
      },
    } as unknown as ExecutionEnv;
    const registry = registryWith(ws, (r) => r.registerTool(createBashTool({ pathGuard: PathGuard.forWorkspace(ws) })), fakeEnv);
    const insideTarget = path.join(ws, "ok.txt").split(path.sep).join("/");
    const ok = await dispatch(registry, "bash", { command: `echo hi > ${insideTarget}` });
    expect(ok.isError).toBeUndefined();
    expect(execCalls).toHaveLength(1);

    const outsideTarget = path.join(outside, "x.txt");
    const denied = await dispatch(registry, "bash", {
      command: `echo hi > ${outsideTarget.split(path.sep).join("/")}`,
    });
    expect(denied.isError).toBe(true);
    expect(denied.error?.code).toBe("PATH_OUTSIDE_WRITABLE");
    expect(String(denied.content)).toContain(outsideTarget);
    expect(execCalls).toHaveLength(1); // 被拒命令未启动

    const unverifiable = await dispatch(registry, "bash", { command: "cd /tmp && echo hi > rel.txt" });
    expect(unverifiable.error?.code).toBe("PATH_UNVERIFIABLE");
    expect(execCalls).toHaveLength(1);
  });

  it("write 工具：越界 → isError PATH_OUTSIDE_WRITABLE + 报错含路径 + 不落盘；区内正常", async () => {
    const { ws, outside } = makeWorkspace();
    const registry = registryWith(ws, (r) => r.registerTool(createWriteTool({ pathGuard: PathGuard.forWorkspace(ws) })));
    const target = path.join(outside, "w.txt");
    const denied = await dispatch(registry, "write", { path: target, content: "x" });
    expect(denied.isError).toBe(true);
    expect(denied.error?.code).toBe("PATH_OUTSIDE_WRITABLE");
    expect(String(denied.content)).toContain(target);
    expect(existsSync(target)).toBe(false);

    const ok = await dispatch(registry, "write", { path: path.join(ws, "nested", "t.txt"), content: "hi" });
    expect(ok.isError).toBeUndefined();
    expect(readFileSync(path.join(ws, "nested", "t.txt"), "utf8")).toBe("hi");
  });

  it("edit 工具：越界在读之前被拒（目标文件保持不存在）", async () => {
    const { ws, outside } = makeWorkspace();
    const registry = registryWith(ws, (r) => r.registerTool(createEditTool({ pathGuard: PathGuard.forWorkspace(ws) })));
    const target = path.join(outside, "e.txt");
    const denied = await dispatch(registry, "edit", { path: target, oldText: "a", newText: "b" });
    expect(denied.isError).toBe(true);
    expect(denied.error?.code).toBe("PATH_OUTSIDE_WRITABLE");
    expect(existsSync(target)).toBe(false);
  });

  it("read 工具：受限读面下外界读拒绝（code=PATH_OUTSIDE_READABLE）", async () => {
    const { ws, outside } = makeWorkspace();
    const registry = registryWith(
      ws,
      (r) => r.registerTool(createReadTool({ pathGuard: PathGuard.forWorkspace(ws, { readRoots: [] }) })),
    );
    const denied = await dispatch(registry, "read", { path: path.join(outside, "secret.txt") });
    expect(denied.isError).toBe(true);
    expect(denied.error?.code).toBe("PATH_OUTSIDE_READABLE");
  });
});

describe("C7/D1 · LIMITATIONS 双载体（docs 同源拷贝）", () => {
  it("清单 ≥5 条且 docs/sandbox-path-limitations.md 逐条含同文", () => {
    expect(PATH_GUARD_LIMITATIONS.length).toBeGreaterThanOrEqual(5);
    const doc = readFileSync("docs/sandbox-path-limitations.md", "utf8");
    for (const item of PATH_GUARD_LIMITATIONS) {
      expect(doc).toContain(item);
    }
  });
});
