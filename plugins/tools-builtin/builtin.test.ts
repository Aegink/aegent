import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../../src/core/index.js";
import { NodeExecutionEnv } from "../../src/core/index.js";
import { PathGuard } from "../../src/sandbox/path-guard.js";
import { seedTextFile } from "../../src/test-support/tmp-fs.js";
import { registerBuiltinTools } from "./index.js";
import { ReadGateService } from "../../src/policy/read-gate.js";
import { PendingApprovals } from "../../src/policy/pending.js";
import { createPlanModeService } from "../../src/ext-builtin/prompt-defaults/plan-mode.js";

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
    expect(ok.meta).toEqual({ exitCode: 0, started: true, outputBounded: true, spillPaths: [] });
  }, 10_000);

  it("非零退出码 → isError + [exit code N] + meta.exitCode；空输出 → (no output)", async () => {
    const registry = toolsWith(tempDir(), new NodeExecutionEnv());
    const failed = await dispatch(registry, "bash", { command: "echo oops >&2; exit 7" });
    expect(failed.isError).toBe(true);
    expect(failed.content).toContain("oops");
    expect(failed.content).toContain("[exit code 7]");
    expect(failed.meta).toEqual({ exitCode: 7, started: true, outputBounded: true, spillPaths: [] });
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
  it("registerBuiltinTools 挂上零依赖常驻内置工具（无装配选项时），且描述文件在位（B2；T-P3-174 批次 1 +task_output/save_memory/notebook_edit）", () => {
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
      // T-P3-172：ls/current_time 零依赖常驻（+2）
      "ls",
      "current_time",
      // T-P3-174 批次 1：task_output/save_memory 零依赖常驻 + notebook_edit（+3）
      "task_output",
      "save_memory",
      "notebook_edit",
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
import { createNetworkGuard } from "../../src/sandbox/network.js";

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


  it("C37 端到端：webfetch 访问 IMDS → isError 且 NETWORK_IMDS_DENIED（allow 档同样拦）", async () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      networkGuard: createNetworkGuard({ policy: "allow" }),
    });
    const result = await dispatch(registry, "webfetch", {
      url: "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    });
    expect(result.isError).toBe(true);
    expect((result.error as { code?: string }).code).toBe("NETWORK_IMDS_DENIED");
    expect(result.content).toContain("C37");
  });

  it("验收②：deny 档拒绝且 NETWORK_DENIED 含目标 URL（D3 语义复用，零真实 I/O；T-P3-174 起非私有 http:// 先升级 https://——拒绝消息含升级后目标）", async () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      networkGuard: createNetworkGuard({ policy: "deny" }),
    });
    const target = "http://example.invalid/path";
    const result = await dispatch(registry, "webfetch", { url: target });
    expect(result.isError).toBe(true);
    expect((result.error as { code: string }).code).toBe("NETWORK_DENIED");
    // T-P3-174 批次 1：HTTP→HTTPS 升级在守卫判定之前（qwen 同构——守卫与
    // 请求看到同一目标），拒绝消息含升级后的 URL
    expect(result.content).toContain("https://example.invalid/path");
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

  it("活 defaultMode：getter 每调用现读（config/refresh 切档即生效——T-P3-140 批次 A）", async () => {
    const dir = tempDir();
    const { spawns, backend } = fakeBackend();
    let liveMode = "read-only";
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      pathGuard: PathGuard.forWorkspace(dir),
      bashSandbox: {
        backend: backend as never,
        get defaultMode() {
          return liveMode;
        },
      } as never,
    });
    await dispatch(registry, "bash", { command: "echo a" });
    expect(spawns[0]).toMatchObject({ mode: "read-only" });
    liveMode = "danger-full-access"; // 模拟 config/refresh 切档（store 活值）
    await dispatch(registry, "bash", { command: "echo b" });
    expect(spawns[1]).toMatchObject({ mode: "danger-full-access" });
    // 升级目标以活值为基准：已是最宽档时再升 → INVALID（不消耗审批）
    const up = await dispatch(registry, "bash", {
      command: "echo c",
      sandboxPermissions: "danger-full-access",
      justification: "已是最宽档",
    });
    expect(up.error?.code).toBe("SANDBOX_ESCALATION_INVALID");
    expect(spawns).toHaveLength(2);
  });

  it("pwsh 沙箱装配：走 backend.spawn（同后端同档），无升级参数面（批次 A）", async () => {
    const dir = tempDir();
    const { spawns, backend } = fakeBackend();
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      pathGuard: PathGuard.forWorkspace(dir),
      pwshSandbox: { backend: backend as never, defaultMode: "workspace-write" },
    });
    const result = await dispatch(registry, "pwsh", { command: "Get-Location" });
    expect(result.isError).toBeUndefined();
    expect(spawns[0]).toMatchObject({ command: "Get-Location", mode: "workspace-write" });
  });
});

// ---------------------------------------------------------------------------
// C12/C13 编辑前必须先读（T-P1-71）：readGate 提供时记账 + 校验；缺省
// undefined = 整体丢弃（工具照常用）。
// ---------------------------------------------------------------------------

describe("C12/C13 · 编辑前必须先读（可选装配）", () => {
  function readGateTools(dir: string): { registry: ToolRegistry; gate: import("../../src/policy/read-gate.js").ReadGateService } {
    const gate = new ReadGateService();
    const registry = new ToolRegistry({ readGate: gate });
    registerBuiltinTools(registry, { pathGuard: PathGuard.forWorkspace(dir) });
    return { registry, gate };
  }

  it("验收①：未读先 edit → EDIT_WITHOUT_READ；验收②：读后 edit 放行", async () => {
    const dir = tempDir();
    const file = path.join(dir, "code.txt");
    seedTextFile(file, "hello world\n");
    const { registry } = readGateTools(dir);

    const unread = await dispatch(registry, "edit", {
      path: file,
      oldText: "hello",
      newText: "hi",
    });
    expect(unread.isError).toBe(true);
    expect(unread.error?.code).toBe("EDIT_WITHOUT_READ");

    await dispatch(registry, "read", { path: file });
    const ok = await dispatch(registry, "edit", {
      path: file,
      oldText: "hello",
      newText: "hi",
    });
    expect(ok.isError).toBeUndefined();
  });

  it("验收③：读后外部修改 → EDIT_STALE_READ", async () => {
    const dir = tempDir();
    const file = path.join(dir, "stale.txt");
    seedTextFile(file, "v1\n");
    const { registry } = readGateTools(dir);
    await dispatch(registry, "read", { path: file });
    // 外部修改（不经工具，绕过记账）
    seedTextFile(file, "v2 (external write)\n");
    const result = await dispatch(registry, "edit", {
      path: file,
      oldText: "v2",
      newText: "v3",
    });
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("EDIT_STALE_READ");
  });

  it("edit 后再 edit 无需中间读（写后记账 = 新基线）", async () => {
    const dir = tempDir();
    const file = path.join(dir, "twice.txt");
    seedTextFile(file, "aaa bbb\n");
    const { registry } = readGateTools(dir);
    await dispatch(registry, "read", { path: file });
    const first = await dispatch(registry, "edit", { path: file, oldText: "aaa", newText: "ccc" });
    expect(first.isError).toBeUndefined();
    const second = await dispatch(registry, "edit", { path: file, oldText: "bbb", newText: "ddd" });
    expect(second.isError).toBeUndefined();
  });

  it("验收④：apply_patch update 未读目标拒绝且零变更；delete 同款（卡内定形）", async () => {
    const dir = tempDir();
    const file = path.join(dir, "patched.txt");
    seedTextFile(file, "original\n");
    const { registry } = readGateTools(dir);
    // patch 内路径与 read/write 同语义（path.resolve 相对进程 cwd）——
    // 用工作区内绝对路径（正斜杠形式，apply-patch.test 同款）
    const target = `${dir.split(path.sep).join("/")}/patched.txt`;

    const update = await dispatch(registry, "apply_patch", {
      patchText: `*** Begin Patch\n*** Update File: ${target}\n@@\n-original\n+changed\n*** End Patch`,
    });
    expect(update.isError).toBe(true);
    expect(update.error?.code).toBe("EDIT_WITHOUT_READ");
    expect(readFileSync(file, "utf8")).toBe("original\n"); // 零变更

    const del = await dispatch(registry, "apply_patch", {
      patchText: `*** Begin Patch\n*** Delete File: ${target}\n*** End Patch`,
    });
    expect(del.isError).toBe(true);
    expect(del.error?.code).toBe("EDIT_WITHOUT_READ");
    expect(existsSync(file)).toBe(true); // 未删除

    // 读后 update 放行，且 edit-then-patch 无需中间读
    await dispatch(registry, "read", { path: file });
    const ok = await dispatch(registry, "apply_patch", {
      patchText: `*** Begin Patch\n*** Update File: ${target}\n@@\n-original\n+changed\n*** End Patch`,
    });
    expect(ok.isError).toBeUndefined();
    const second = await dispatch(registry, "apply_patch", {
      patchText: `*** Begin Patch\n*** Update File: ${target}\n@@\n-changed\n+changed2\n*** End Patch`,
    });
    expect(second.isError).toBeUndefined();
  });

  it("验收⑥：write 新文件豁免；覆盖未读拒；覆盖已读放行", async () => {
    const dir = tempDir();
    const existing = path.join(dir, "exists.txt");
    seedTextFile(existing, "old\n");
    const fresh = path.join(dir, "fresh.txt");
    const { registry } = readGateTools(dir);

    const create = await dispatch(registry, "write", { path: fresh, content: "new\n" });
    expect(create.isError).toBeUndefined(); // 新文件豁免

    const overwrite = await dispatch(registry, "write", { path: existing, content: "x\n" });
    expect(overwrite.isError).toBe(true);
    expect(overwrite.error?.code).toBe("EDIT_WITHOUT_READ");

    await dispatch(registry, "read", { path: existing });
    const ok = await dispatch(registry, "write", { path: existing, content: "read-then-overwrite\n" });
    expect(ok.isError).toBeUndefined();
  });

  it("验收⑤：readGate 缺省（C13 整体丢弃）→ 未读先 edit 照常成功", async () => {
    const dir = tempDir();
    const file = path.join(dir, "free.txt");
    seedTextFile(file, "hello\n");
    const registry = toolsWith(dir); // 无 readGate
    const result = await dispatch(registry, "edit", {
      path: file,
      oldText: "hello",
      newText: "hi",
    });
    expect(result.isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Q2/T-P2-105 会话查询工具（session_query / session_get）
// ---------------------------------------------------------------------------

import { ScriptedProvider } from "../../src/core/primitives/loop/loop.test-utils.js";
import { AgentLoop } from "../../src/core/index.js";
import {SessionEventStore, type SessionStore} from "../../src/session/store.js";
import { SqliteEventStorage } from "../../src/session/db.js";
import type { StreamChunk } from "../../src/core/index.js";

async function seedQueryDb(dbPath: string): Promise<void> {
  const storage = SqliteEventStorage.open({ path: dbPath });
  try {
    const store = new SessionEventStore(storage);
    store.append("s-old", [
      { type: "turn/start", turn: 1 },
      { type: "step/start", turn: 1, step: 1 },
      { type: "user/message", turn: 1, message: { content: "historical needle" }, source: "user" },
      { type: "assistant/message", turn: 1, step: 1, message: { content: "ack" }, stream: [] },
      { type: "step/end", turn: 1, step: 1 },
      { type: "turn/end", turn: 1, reason: { kind: "completed" } },
    ]);
    await store.flush("s-old");
  } finally {
    storage.close();
  }
}

describe("会话查询工具（Q2/T-P2-105）", () => {
  it("装配面：sessionQuery 提供时才注册两工具；缺省零新增（描述文件在位）", () => {
    const without = new ToolRegistry();
    registerBuiltinTools(without);
    expect(without.names()).not.toContain("session_query");
    expect(without.names()).not.toContain("session_get");

    const dir = tempDir();
    const withDb = toolsWith(dir, undefined, { sessionQuery: { dbPath: path.join(dir, "q.sqlite") } });
    expect(withDb.names()).toContain("session_query");
    expect(withDb.names()).toContain("session_get");
    expect(withDb.description("session_query").length).toBeGreaterThan(0);
    expect(withDb.description("session_get").length).toBeGreaterThan(0);
  });

  it("工具直取：session_query 条件命中 + session_get 会话事件（只读、无命中不报错）", async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "q.sqlite");
    await seedQueryDb(dbPath);
    const registry = toolsWith(dir, undefined, { sessionQuery: { dbPath } });

    const hit = await dispatch(registry, "session_query", { sessionIdPrefix: "s-old", content: "needle" });
    expect(hit.isError).toBeUndefined();
    expect(hit.content).toContain("命中 1 条");
    expect(hit.content).toContain("[s-old]");

    const miss = await dispatch(registry, "session_query", { content: "不存在的串" });
    expect(miss.isError).toBeUndefined();
    expect(miss.content).toContain("命中 0 条");

    const read = await dispatch(registry, "session_get", { sessionId: "s-old" });
    expect(read.isError).toBeUndefined();
    expect(read.content).toContain("共 6 条事件");
    expect(read.content).toContain("turn/start");

    // 不存在的会话 → 类型化错误回喂（模型可自修）
    const missing = await dispatch(registry, "session_get", { sessionId: "s-none" });
    expect(missing.isError).toBe(true);
    expect(missing.error?.code).toBe("SESSION_NOT_FOUND");
  });

  it("工具化往返：模型调用 session_query → 结果落 tool/result → 模型读到历史后收尾", async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "q.sqlite");
    await seedQueryDb(dbPath);
    const registry = toolsWith(dir, undefined, { sessionQuery: { dbPath } });

    const provider = new ScriptedProvider();
    provider.mount([
      {
        type: "tool-call-delta",
        id: "t1",
        name: "session_query",
        argsDelta: JSON.stringify({ content: "historical needle" }),
      },
      { type: "done" },
    ]);
    const script: StreamChunk[] = [
      { type: "text-delta", text: "历史里找到了：s-old 的 user/message 提到 needle" },
      { type: "done" },
    ];
    provider.mount(script);

    const store = new SessionEventStore();
    const loop = new AgentLoop({
      sessionId: "s-cur",
      store,
      provider,
      identity: { provider: "mock", modelId: "m-1" },
      executeTool: (call) => registry.dispatch(call),
      decideTurn: (record) => (record.toolCalls.length > 0 ? { action: "continue" } : { action: "end" }),
    });

    await loop.runTurn("查一下历史里有没有 needle");

    const events = store.load("s-cur");
    const callEvent = events.find((e) => e.type === "tool/call");
    expect(callEvent?.type === "tool/call" ? callEvent.name : undefined).toBe("session_query");
    const resultEvent = events.find((e) => e.type === "tool/result");
    expect(resultEvent?.type === "tool/result" ? resultEvent.message.isError : true).toBeFalsy();
    expect(resultEvent?.type === "tool/result" ? resultEvent.message.content : "").toContain("s-old");
    // 第二次模型请求看到 tool 结果（历史检索结果进模型上下文）
    const secondReq = provider.requestAt(1, "工具结果回喂");
    expect(secondReq.messages.some((m) => m.role === "tool" && m.content.includes("s-old"))).toBe(true);
    // 查询是读面：被查会话零变化（s-old 仍是 6 条）
    const storage = SqliteEventStorage.open({ path: dbPath });
    try {
      expect(storage.readAll("s-old")).toHaveLength(6);
    } finally {
      storage.close();
    }
  });
});

describe("builtinToolParamNames（C40 · T-P2-201）", () => {
  it("从真实注册 schema 派生，与注册表 toChatTools 逐工具一致（漂移免疫）", async () => {
    const { builtinToolParamNames } = await import("./index.js");
    const map = builtinToolParamNames();
    // 与独立构造的注册表逐工具对账（同一 stub 依赖面）
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      todoEmit: () => {},
      planMode: createPlanModeService(),
      savePlanArtifact: () => ({ path: "stub" }),
      networkGuard: createNetworkGuard({ policy: "deny" }),
      question: { pending: new PendingApprovals(), sessionId: "param-names", timeoutMs: 1 },
      task: {
        runSubagent: async () => ({ kind: "foreground", result: { sessionId: "stub", stopReason: "cancelled", output: "" } }),
      },
      sessionQuery: { dbPath: "stub" },
    });
    for (const tool of registry.toChatTools()) {
      const props =
        (tool.parameters as { properties?: Record<string, unknown> } | undefined)
          ?.properties ?? {};
      expect(map[tool.name]).toEqual(Object.keys(props));
    }
    // 关键工具形状抽核（C40 验收例的承载工具在表中）
    expect(map["task"]).toContain("prompt");
    expect(map["bash"]).toContain("command");
    // 两次调用同一缓存对象（模块级 memo）
    expect(builtinToolParamNames()).toBe(map);
  });
});

describe("task 的 --backend 参数面（H6 · T-P2-309）", () => {
  it("backend 参数透传 runSubagent（缺省不发键；坏形状类型化拒绝）", async () => {
    const { createTaskTool } = await import("./task.js");
    const seen: (string | undefined)[] = [];
    const tool = createTaskTool({
      runSubagent: async (_prompt, _desc, opts) => {
        seen.push(opts?.backend);
        return {
          kind: "foreground",
          result: { sessionId: "s-ext", stopReason: "completed", output: "ok" },
        };
      },
    });
    // 缺省：opts 不带 backend 键
    await tool.execute({ description: "d", prompt: "p" }, { toolCallId: "c1" });
    expect(seen).toEqual([undefined]);
    // 显式：透传
    await tool.execute({ description: "d", prompt: "p", backend: "acp" }, { toolCallId: "c2" });
    expect(seen).toEqual([undefined, "acp"]);
    // 坏形状：非字符串 / 空串 → 类型化 isError（不下发）
    const bad = await tool.execute({ description: "d", prompt: "p", backend: 7 }, { toolCallId: "c3" });
    expect(bad.isError).toBe(true);
    const empty = await tool.execute({ description: "d", prompt: "p", backend: "" }, { toolCallId: "c4" });
    expect(empty.isError).toBe(true);
    expect(seen).toEqual([undefined, "acp"]);
  });
});

describe("task 的 subagent_type 参数面（U23 · T-P3-126）", () => {
  it("subagent_type 透传 runSubagent（缺省不发键；坏形状类型化拒绝）", async () => {
    const { createTaskTool } = await import("./task.js");
    const seen: (string | undefined)[] = [];
    const tool = createTaskTool({
      runSubagent: async (_prompt, _desc, opts) => {
        seen.push(opts?.subagentType);
        return {
          kind: "foreground",
          result: { sessionId: "s-x", stopReason: "completed", output: "ok" },
        };
      },
    });
    // 缺省：opts 不带 subagentType 键（通用子代理——既有行为零变化）
    await tool.execute({ description: "d", prompt: "p" }, { toolCallId: "u1" });
    expect(seen).toEqual([undefined]);
    // 显式：透传预设名
    await tool.execute({ description: "d", prompt: "p", subagent_type: "code-reviewer" }, { toolCallId: "u2" });
    expect(seen).toEqual([undefined, "code-reviewer"]);
    // 坏形状：非字符串 / 空串 → 类型化 isError（不下发）
    const bad = await tool.execute({ description: "d", prompt: "p", subagent_type: 7 }, { toolCallId: "u3" });
    expect(bad.isError).toBe(true);
    const empty = await tool.execute({ description: "d", prompt: "p", subagent_type: "" }, { toolCallId: "u4" });
    expect(empty.isError).toBe(true);
    expect(seen).toEqual([undefined, "code-reviewer"]);
  });
});
