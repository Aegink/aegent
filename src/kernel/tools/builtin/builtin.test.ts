import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { NodeExecutionEnv } from "../env.js";
import { PathGuard } from "../../../sandbox/path-guard.js";
import { seedTextFile } from "../../../test-support/tmp-fs.js";
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

/**
 * 装配内置工具 + 守卫工作区（T-6-01）：四个文件工具类型上必收守卫——
 * 夹具目录即守卫工作区（写面限制在工作区内正是被测语义）。
 */
function toolsWith(
  dir: string,
  env?: NodeExecutionEnv,
  builtinOptions?: Parameters<typeof registerBuiltinTools>[1],
): ToolRegistry {
  const registry = new ToolRegistry(env !== undefined ? { env } : undefined);
  registerBuiltinTools(registry, { pathGuard: PathGuard.forWorkspace(dir), ...builtinOptions });
  return registry;
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
    seedTextFile(file, "第一行\nsecond line\n第三行\n");
    const result = await dispatch(toolsWith(dir), "read", { path: file });
    // 尾换行不算一行：原文去尾空行
    expect(result).toEqual({ content: "第一行\nsecond line\n第三行" });
  });

  it("offset/limit 切片 + 续读导航提示（pi 同款）", async () => {
    const dir = tempDir();
    const file = path.join(dir, "big.txt");
    seedTextFile(file, "l1\nl2\nl3\nl4\nl5\n");
    const result = await dispatch(toolsWith(dir), "read", { path: file, offset: 2, limit: 2 });
    expect(result.content).toBe("l2\nl3\n\n[Showing lines 2-3 of 5. Use offset=4 to continue.]");
  });

  it("边界：不存在路径 → isError（ENOENT）；空文件 → 空输出；offset 越界 → isError", async () => {
    const dir = tempDir();
    const registry = toolsWith(dir);
    const missing = await dispatch(registry, "read", { path: path.join(dir, "no-such.txt") });
    expect(missing.isError).toBe(true);
    expect(missing.error?.code).toBe("ENOENT");

    const empty = path.join(dir, "empty.txt");
    seedTextFile(empty, "");
    const result = await dispatch(registry, "read", { path: empty });
    expect(result).toEqual({ content: "" });

    const beyond = await dispatch(registry, "read", { path: empty, offset: 2 });
    expect(beyond.isError).toBe(true);
    expect(beyond.error?.code).toBe("OFFSET_BEYOND_EOF");
  });

  it("路径边界：P0 读面不限，工作区外路径也可读（读边界仅显式配置 readRoots 时生效）", async () => {
    const dir = tempDir();
    const outside = tempDir();
    const file = path.join(outside, "anywhere.txt");
    seedTextFile(file, "content");
    const result = await dispatch(toolsWith(dir), "read", { path: file });
    expect(result).toEqual({ content: "content" });
  });
});

describe("write 工具", () => {
  it("写新文件（父目录不存在自动创建），落盘内容一致", async () => {
    const dir = tempDir();
    const file = path.join(dir, "nested", "deep", "out.txt");
    const result = await dispatch(toolsWith(dir), "write", { path: file, content: "hello 你好\n" });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Successfully wrote to");
    expect(readFileSync(file, "utf8")).toBe("hello 你好\n");
  });

  it("覆盖已有文件；空内容边界（0 字节）", async () => {
    const dir = tempDir();
    const file = path.join(dir, "over.txt");
    seedTextFile(file, "old");
    const registry = toolsWith(dir);
    await dispatch(registry, "write", { path: file, content: "new content" });
    expect(readFileSync(file, "utf8")).toBe("new content");

    const empty = await dispatch(registry, "write", { path: file, content: "" });
    expect(empty.isError).toBeUndefined();
    expect(empty.content).toContain("(0 bytes)");
    expect(readFileSync(file, "utf8")).toBe("");
  });

  it("路径边界（C7 场景④）：工作区外写 → isError PATH_OUTSIDE_WRITABLE，报错含目标路径且不落盘", async () => {
    const dir = tempDir();
    const outside = tempDir();
    const target = path.join(outside, "escape.txt");
    const result = await dispatch(toolsWith(dir), "write", { path: target, content: "x" });
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("PATH_OUTSIDE_WRITABLE");
    expect(String(result.content)).toContain(target);
    expect(existsSync(target)).toBe(false);
  });

  it("参数坏 → isError INVALID_ARGUMENTS（path 缺失 / content 非字符串）", async () => {
    const registry = toolsWith(tempDir());
    const noPath = await dispatch(registry, "write", { content: "x" });
    expect(noPath.error?.code).toBe("INVALID_ARGUMENTS");
    const badContent = await dispatch(registry, "write", { path: "a.txt", content: 42 });
    expect(badContent.error?.code).toBe("INVALID_ARGUMENTS");
  });
});

describe("bash 工具（T-4-05 回填后：执行经 ExecutionEnv）", () => {
  it("参数校验：command 缺失 / timeout 非法即拒", async () => {
    const registry = toolsWith(tempDir());
    const noCmd = await dispatch(registry, "bash", { timeout: 5 });
    expect(noCmd.error?.code).toBe("INVALID_ARGUMENTS");
    const badTimeout = await dispatch(registry, "bash", { command: "ls", timeout: 0 });
    expect(badTimeout.error?.code).toBe("INVALID_ARGUMENTS");
    const hugeTimeout = await dispatch(registry, "bash", { command: "ls", timeout: 1e12 });
    expect(hugeTimeout.error?.code).toBe("INVALID_ARGUMENTS");
  });

  it("缺 ExecutionEnv → isError EXECUTION_ENV_MISSING（装配缺失的明确报错）", async () => {
    const registry = toolsWith(tempDir());
    const stub = await dispatch(registry, "bash", { command: "echo hi" });
    expect(stub.isError).toBe(true);
    expect(stub.error?.code).toBe("EXECUTION_ENV_MISSING");
  });

  it("路径边界（T-6-01）：重定向写越界 → isError PATH_OUTSIDE_WRITABLE 且命令未启动", async () => {
    const dir = tempDir();
    const outside = tempDir();
    const target = path.join(outside, "x.txt").split(path.sep).join("/");
    const calls: string[] = [];
    const fakeEnv = {
      exec: async (cmd: string) => {
        calls.push(cmd);
        return { stdout: "ok", stderr: "", exitCode: 0 };
      },
    } as unknown as NodeExecutionEnv;
    const denied = await dispatch(toolsWith(dir, fakeEnv), "bash", { command: `echo hi > ${target}` });
    expect(denied.isError).toBe(true);
    expect(denied.error?.code).toBe("PATH_OUTSIDE_WRITABLE");
    expect(calls).toHaveLength(0); // 被拒命令未启动
  });

  it("经 env 真执行：stdout 回显（回填验收：stdout/exit code）", async () => {
    const ok = await dispatch(toolsWith(tempDir(), new NodeExecutionEnv()), "bash", {
      command: "echo aegent-bash-ok",
    });
    expect(ok.isError).toBeUndefined();
    // 输出原样转述（含尾换行不 trim）；截断属 T-4-06；started 为 D15 标记
    expect(ok.content).toBe("aegent-bash-ok\n");
    expect(ok.meta).toEqual({ exitCode: 0, started: true });
  }, 10_000);

  it("非零退出码 → isError + [exit code N] + meta.exitCode；空输出 → (no output)", async () => {
    const registry = toolsWith(tempDir(), new NodeExecutionEnv());
    const failed = await dispatch(registry, "bash", { command: "echo oops >&2; exit 7" });
    expect(failed.isError).toBe(true);
    expect(failed.content).toContain("oops");
    expect(failed.content).toContain("[exit code 7]");
    expect(failed.meta).toEqual({ exitCode: 7, started: true });
    const silent = await dispatch(registry, "bash", { command: "true" });
    expect(silent.isError).toBeUndefined();
    expect(silent.content).toBe("(no output)");
  }, 10_000);

  it("timeout 超时 → isError TOOL_TIMEOUT（J22 词汇贯穿）", async () => {
    const registry = toolsWith(tempDir(), new NodeExecutionEnv());
    const slow = await dispatch(registry, "bash", { command: "sleep 5", timeout: 1 });
    expect(slow.isError).toBe(true);
    expect(slow.error?.code).toBe("TOOL_TIMEOUT");
  }, 10_000);
});

describe("edit 工具", () => {
  it("唯一匹配替换成功并落盘（newText 原样写入，$& 等不被解释）", async () => {
    const dir = tempDir();
    const file = path.join(dir, "code.txt");
    seedTextFile(file, "const a = 1;\nconst b = 2;\n");
    const result = await dispatch(toolsWith(dir), "edit", {
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
    seedTextFile(file, "x\nx\ny\n");
    const registry = toolsWith(dir);
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

  it("路径边界（T-6-01）：工作区外 edit → isError PATH_OUTSIDE_WRITABLE（读之前被拒）", async () => {
    const dir = tempDir();
    const outside = tempDir();
    const target = path.join(outside, "e.txt");
    const result = await dispatch(toolsWith(dir), "edit", {
      path: target,
      oldText: "a",
      newText: "b",
    });
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("PATH_OUTSIDE_WRITABLE");
    expect(existsSync(target)).toBe(false);
  });

  it("参数坏（oldText 空 / newText 缺失）→ isError INVALID_ARGUMENTS", async () => {
    const registry = toolsWith(tempDir());
    const empty = await dispatch(registry, "edit", { path: "a.txt", oldText: "", newText: "x" });
    expect(empty.error?.code).toBe("INVALID_ARGUMENTS");
    const noNew = await dispatch(registry, "edit", { path: "a.txt", oldText: "x" });
    expect(noNew.error?.code).toBe("INVALID_ARGUMENTS");
  });
});

describe("glob 工具", () => {
  it("嵌套目录按模式匹配，输出绝对路径字母序（*.ts 与 ** 跨段与 ?）", async () => {
    const dir = tempDir();
    seedTextFile(path.join(dir, "a.ts"), "");
    mkdirSync(path.join(dir, "sub", "deep"), { recursive: true });
    seedTextFile(path.join(dir, "sub", "b.ts"), "");
    seedTextFile(path.join(dir, "sub", "deep", "c.ts"), "");
    seedTextFile(path.join(dir, "note.md"), "");
    const registry = toolsWith(dir);

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
    const registry = toolsWith(dir);
    const none = await dispatch(registry, "glob", { pattern: "*.nope", path: dir });
    expect(none.content).toBe("No files found");

    for (let i = 0; i < 101; i++) {
      seedTextFile(path.join(dir, `f${String(i).padStart(3, "0")}.ts`), "");
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
    seedTextFile(path.join(dir, "src", "one.ts"), "const a = 1;\nconst b = alpha;\n");
    seedTextFile(path.join(dir, "two.md"), "# alpha\n");
    const registry = toolsWith(dir);

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
    seedTextFile(file, "n 1\nn 22\nn 333\n");
    const registry = toolsWith(dir);

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
  it("registerBuiltinTools 挂上十一个内置工具（无装配选项时），且描述文件在位（B2；skill_load 为 T-P1-08 新增、tool_load 为 T-P1-17 新增、pwsh 为 T-P1-28 新增、apply_patch 为 T-P1-56 新增）", () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    expect(registry.names()).toEqual([
      "read",
      "write",
      "bash",
      "pwsh",
      "edit",
      "apply_patch",
      "lsp",
      "glob",
      "grep",
      "skill_load",
      "tool_load",
    ]);
    // 描述从真 descriptions/ 目录读出（非空）——内置描述文件的存在性证明
    for (const name of registry.names()) {
      expect(registry.description(name).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// webfetch（B8a / T-P1-20）：NetworkPolicy 对接 + 文本化 + 截断落 spill
// ---------------------------------------------------------------------------

import { createServer, type Server } from "node:http";
import { createNetworkGuard } from "../../../sandbox/network.js";

/** 起一个真端口 HTTP 服务（返回 body 后关闭由调用方负责）。 */
function httpServer(body: string, contentType = "text/plain; charset=utf-8"): Promise<{
  server: Server;
  url: (path?: string) => string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": contentType });
      res.end(body);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        server,
        url: (p = "/") => `http://127.0.0.1:${String(port)}${p}`,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

describe("webfetch（B8a / T-P1-20）", () => {
  it("验收①：allow 档 localhost 放行（真端口），文本回喂带 meta", async () => {
    const http = await httpServer("hello from localhost");
    try {
      const registry = new ToolRegistry();
      registerBuiltinTools(registry, {
        networkGuard: createNetworkGuard({ policy: "allow" }),
      });
      const result = await dispatch(registry, "webfetch", { url: http.url("/page") });
      expect(result.isError).toBeUndefined();
      expect(result.content).toBe("hello from localhost");
      expect(result.meta).toMatchObject({ status: 200, url: http.url("/page") });
    } finally {
      await http.close();
    }
  });

  it("验收②：deny 档拒绝且 NETWORK_DENIED 含目标 URL（D3 语义复用，零真实 I/O）", async () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      networkGuard: createNetworkGuard({ policy: "deny" }),
    });
    const target = "http://example.invalid/path";
    const result = await dispatch(registry, "webfetch", { url: target });
    expect(result.isError).toBe(true);
    expect((result.error as { code: string }).code).toBe("NETWORK_DENIED");
    expect(result.content).toContain(target);
  });

  it("验收③：超长响应走 B5 出口截断落 spill（T-P1-14 联动），完整原文在 spill 文件", async () => {
    const spillDir = tempDir();
    const bigBody = Array.from({ length: 2500 }, (_, i) => `row-${String(i)}`).join("\n");
    const http = await httpServer(bigBody);
    try {
      const registry = new ToolRegistry({ sessionId: "s-wf", spillDir });
      registerBuiltinTools(registry, {
        networkGuard: createNetworkGuard({ policy: "allow" }),
      });
      const result = await dispatch(registry, "webfetch", { url: http.url("/big") });
      expect(result.meta).toMatchObject({ truncated: true });
      const spillPath = String((result.meta as Record<string, unknown>)["spillPath"]);
      expect(spillPath).not.toBe("");
      // spill 首行 = Q13 标记，其后是完整原文
      const spill = readFileSync(spillPath, "utf8");
      expect(JSON.parse(spill.split("\n")[0]!)).toMatchObject({
        kind: "aegent/tool-output-spill",
        tool: "webfetch",
      });
      expect(spill.slice(spill.indexOf("\n\n") + 2)).toBe(bigBody);
      // 模型可见面：保留头 + 截断提示
      expect(result.content).toContain("[Output truncated");
      expect(result.content).toContain(`完整输出在 ${spillPath}`);
    } finally {
      await http.close();
    }
  });

  it("URL 校验与非 2xx 状态：协议/域名错误 isError 可自修", async () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      networkGuard: createNetworkGuard({ policy: "allow" }),
    });
    const badScheme = await dispatch(registry, "webfetch", { url: "ftp://example.com/x" });
    expect(badScheme.isError).toBe(true);
    expect((badScheme.error as { code: string }).code).toBe("INVALID_ARGUMENTS");

    const http = await httpServer("gone", "text/plain");
    try {
      // 覆写为 404 响应的第二个服务
      const notFound = await new Promise<{ server: Server; url: () => string; close: () => Promise<void> }>(
        (resolve) => {
          const server = createServer((_req, res) => {
            res.writeHead(404, { "content-type": "text/plain" });
            res.end("nope");
          });
          server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address !== null ? address.port : 0;
            resolve({
              server,
              url: () => `http://127.0.0.1:${String(port)}/`,
              close: () => new Promise<void>((c) => server.close(() => c())),
            });
          });
        },
      );
      try {
        const result = await dispatch(registry, "webfetch", { url: notFound.url() });
        expect(result.isError).toBe(true);
        expect((result.error as { code: string }).code).toBe("HTTP_STATUS");
        expect(result.content).toContain("404");
      } finally {
        await notFound.close();
      }
    } finally {
      await http.close();
    }
  });

  it("未提供 networkGuard 时 webfetch 不注册（fail-closed：无守卫无网络工具）", () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    expect(registry.has("webfetch")).toBe(false);
    const withGuard = new ToolRegistry();
    registerBuiltinTools(withGuard, {
      networkGuard: createNetworkGuard({ policy: "deny" }),
    });
    expect(withGuard.has("webfetch")).toBe(true);
  });
});

describe("bash 超时三档合并（B18/T-P1-55）", () => {
  /** fakeEnv 捕获 exec 收到的 timeoutMs，验证三档合并结果（不真执行） */
  function capturingEnv(captured: Array<number | undefined>) {
    return {
      exec: async (cmd: string, options?: { timeoutMs?: number }) => {
        captured.push(options?.timeoutMs);
        return { stdout: "ok", stderr: "", exitCode: 0 };
      },
    } as unknown as NodeExecutionEnv;
  }

  it("默认档：timeout 参数缺省时 env 收到 defaultTimeoutSeconds 换算的毫秒", async () => {
    const captured: Array<number | undefined> = [];
    const registry = toolsWith(tempDir(), capturingEnv(captured), { bash: { defaultTimeoutSeconds: 7 } });
    await dispatch(registry, "bash", { command: "echo hi" });
    expect(captured).toEqual([7_000]);
  });

  it("提示档覆盖默认档；提示恒被上限收口（不可经输入关闭）", async () => {
    const captured: Array<number | undefined> = [];
    const registry = toolsWith(tempDir(), capturingEnv(captured), { bash: { defaultTimeoutSeconds: 60 } });
    await dispatch(registry, "bash", { command: "echo hi", timeout: 3 });
    expect(captured).toEqual([3_000]);
    await dispatch(registry, "bash", { command: "echo hi", timeout: 1e12 - 1e9 });
    // 1e12 秒远超上限 → 已在参数校验层拒绝，这里不再到达 env
    expect(captured).toHaveLength(1);
  });

  it("无默认档且无提示 = 不武装超时（timeoutMs 缺省透传 env，现状语义保持）", async () => {
    const captured: Array<number | undefined> = [];
    const registry = toolsWith(tempDir(), capturingEnv(captured));
    await dispatch(registry, "bash", { command: "echo hi" });
    expect(captured).toEqual([undefined]);
  });
});

describe("bash 沙箱升级（B15/T-P1-58）", () => {
  /** 假 backend：记录每次 spawn 的 mode，返回固定结果 */
  function fakeBackend() {
    const spawns: Array<{ command: string; mode: string }> = [];
    const backend = {
      supportedModes: ["workspace-write", "danger-full-access"],
      spawn: async (req: { command: string; mode: string }) => {
        spawns.push({ command: req.command, mode: req.mode });
        return { stdout: "spawned", stderr: "", exitCode: 0 };
      },
    };
    return { spawns, backend };
  }

  /** 审批桩：按预案返回 allow/deny，记录收到的请求 */
  function fakeApprovals(reply: "allow" | "deny") {
    const asks: Array<{ id: string; args: Record<string, unknown> }> = [];
    const approvals = {
      ask: async (req: { id: string; args: Record<string, unknown> }) => {
        asks.push({ id: req.id, args: req.args });
        return { action: reply, reason: reply === "allow" ? "批准" : "不允许" };
      },
    };
    return { asks, approvals };
  }

  function registryWithSandbox(
    reply: "allow" | "deny",
  ): {
    spawns: Array<{ command: string; mode: string }>;
    registry: ToolRegistry;
    asks: Array<{ id: string; args: Record<string, unknown> }>;
  } {
    const dir = tempDir();
    const { spawns, backend } = fakeBackend();
    const { asks, approvals } = fakeApprovals(reply);
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      pathGuard: PathGuard.forWorkspace(dir),
      bashSandbox: {
        backend: backend as never,
        defaultMode: "workspace-write",
        approvals: approvals as never,
        sessionId: "s-sandbox",
        approvalTimeoutMs: 1_000,
      },
    });
    return { spawns, registry, asks };
  }

  it("审批通过 → 本调用按提升 mode spawn（一次生效），下一调用回默认模式", async () => {
    const { spawns, registry, asks } = registryWithSandbox("allow");
    const up = await dispatch(registry, "bash", {
      command: "echo one",
      sandboxPermissions: "danger-full-access",
      justification: "需要写系统缓存",
    });
    expect(up.isError).toBeUndefined();
    expect(spawns[0]).toMatchObject({ command: "echo one", mode: "danger-full-access" });
    expect(asks[0]!.args).toMatchObject({ escalation: "sandbox → danger-full-access" });
    // 下一调用不带升级参数 → 回默认模式（仅本调用生效）
    await dispatch(registry, "bash", { command: "echo two" });
    expect(spawns[1]).toMatchObject({ command: "echo two", mode: "workspace-write" });
  });

  it("审批拒绝 → SANDBOX_ESCALATION_DENIED 且命令未启动", async () => {
    const { spawns, registry } = registryWithSandbox("deny");
    const denied = await dispatch(registry, "bash", {
      command: "echo nope",
      sandboxPermissions: "danger-full-access",
      justification: "理由充分",
    });
    expect(denied.isError).toBe(true);
    expect(denied.error?.code).toBe("SANDBOX_ESCALATION_DENIED");
    expect(spawns).toHaveLength(0); // fail-closed：执行前拒绝
  });

  it("缺 justification / 空白理由 / 无沙箱装配时带升级参数 → fail-closed 不执行", async () => {
    const { spawns, registry } = registryWithSandbox("allow");
    const missing = await dispatch(registry, "bash", {
      command: "echo x",
      sandboxPermissions: "danger-full-access",
    });
    expect(missing.error?.code).toBe("SANDBOX_ESCALATION_INVALID");
    expect(spawns).toHaveLength(0);
    const blank = await dispatch(registry, "bash", {
      command: "echo x",
      sandboxPermissions: "danger-full-access",
      justification: "  ",
    });
    expect(blank.error?.code).toBe("SANDBOX_ESCALATION_INVALID");
    // 无沙箱装配：升级参数直接 SANDBOX_UNAVAILABLE（env 直通路径）
    const plain = toolsWith(tempDir());
    const noSandbox = await dispatch(plain, "bash", {
      command: "echo y",
      sandboxPermissions: "danger-full-access",
      justification: "没有沙箱也要升",
    });
    expect(noSandbox.error?.code).toBe("SANDBOX_UNAVAILABLE");
  });

  it("schema 面：sandboxPermissions 枚举是封闭目标词汇（不含 read-only）", () => {
    const { registry } = registryWithSandbox("allow");
    const chat = registry.toChatTools();
    const bash = chat.find((t) => t.name === "bash");
    expect(bash).toBeDefined();
    const perm = (bash!.parameters as { properties: { sandboxPermissions: { enum: string[] } } })
      .properties.sandboxPermissions;
    expect(perm.enum).toEqual(["workspace-write", "danger-full-access"]);
  });
});
