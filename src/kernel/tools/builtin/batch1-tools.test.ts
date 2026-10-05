/**
 * T-P3-174 批次 1 工具面测试——agent 干活能力线：
 *   bash/pwsh run_in_background + task_output + shell 输出双层预算 spill +
 *   view_image（附件链注入）+ get_context_remaining + webfetch 增强 +
 *   grep rg 快路径 + save_memory + notebook_edit。
 * 每个 schema 完整断言走 builtinToolParamNames 派生面（schema 漂移免疫）。
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { ToolRegistry } from "../registry.js";
import { NodeExecutionEnv } from "../env.js";
import { PathGuard } from "../../../sandbox/path-guard.js";
import { createNetworkGuard } from "../../../sandbox/network.js";
import { InMemoryAttachmentStore } from "../../../attachments/store.js";
import { InMemoryEventStorage, SessionStore } from "../../../session/store.js";
import { ScriptedProvider, makeLoop } from "../../loop.test-utils.js";
import { registerBuiltinTools, builtinToolParamNames } from "./index.js";
import { BackgroundShellRegistry, MAX_BACKGROUND_TASKS } from "../background-shell.js";
import {
  formatShellOutput,
  SHELL_BUDGET_BYTES,
  SHELL_BUDGET_LINES,
  MAX_LINE_CHARS,
} from "../shell-output.js";
import {
  resetWebfetchCacheForTests,
  rewriteGitHubBlobUrl,
  upgradeHttpToHttps,
} from "./webfetch.js";
import { resetGrepRgProbeForTests } from "./grep.js";
import { createSaveMemoryTool, MAX_MEMORY_FACT_CHARS } from "./save-memory.js";
import { createNotebookEditTool } from "./notebook-edit.js";
import { createViewImageTool } from "./view-image.js";
import { createGetContextRemainingTool } from "./get-context-remaining.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  resetWebfetchCacheForTests();
  resetGrepRgProbeForTests();
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-b1-"));
  tmpDirs.push(dir);
  return dir;
}

function toolsWith(
  dir: string,
  options: {
    env?: NodeExecutionEnv;
    builtin?: Parameters<typeof registerBuiltinTools>[1];
    registry?: ConstructorParameters<typeof ToolRegistry>[0];
  } = {},
): ToolRegistry {
  const registry = new ToolRegistry({
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...options.registry,
  });
  registerBuiltinTools(registry, {
    pathGuard: PathGuard.forWorkspace(dir),
    workspaceRoot: dir,
    ...options.builtin,
  });
  return registry;
}

function dispatch(registry: ToolRegistry, name: string, args: unknown) {
  return registry.dispatch({
    callId: "c1",
    name,
    arguments: JSON.stringify(args),
  });
}

// ---------------------------------------------------------------------------
// schema 完整断言（ALL SCHEMAS OK 模式——新工具零空 schema）
// ---------------------------------------------------------------------------

describe("批次 1 新工具 schema 面（ALL SCHEMAS OK 模式）", () => {
  it("全配置注册下每个新工具的 schema 在 wire 上（有参工具 properties 非空——模型可传参）", () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      attachments: new InMemoryAttachmentStore(),
      contextUsage: () => null,
      sessionQuery: { dbPath: "stub" },
      pluginCreate: { workspaceRoot: "stub" },
      pluginDefine: { toolRegistry: registry, handles: [] },
    });
    for (const name of ["task_output", "view_image", "save_memory", "notebook_edit"]) {
      const chat = registry.toChatTools().find((t) => t.name === name);
      expect(chat, `工具 ${name} 应在 wire 清单`).toBeDefined();
      const params = chat!.parameters as { properties: Record<string, unknown> };
      expect(
        Object.keys(params.properties).length,
        `工具 ${name} 的 schema properties 非空（空 schema=模型无从传参）`,
      ).toBeGreaterThan(0);
    }
    // get_context_remaining 同 codex：无参工具（空 object schema——合法形态）
    const gc = registry.toChatTools().find((t) => t.name === "get_context_remaining");
    expect(gc).toBeDefined();
    expect((gc!.parameters as { type: string }).type).toBe("object");
  });

  it("builtinToolParamNames 派生面覆盖新工具（knownToolParams 漂移免疫）", () => {
    const names = builtinToolParamNames();
    expect(names["task_output"]).toContain("task_id");
    expect(names["view_image"]).toContain("path");
    expect(names["save_memory"]).toContain("fact");
    expect(names["notebook_edit"]).toContain("notebook_path");
    // get_context_remaining 无参数——入表为空数组（properties 存在但为空）
    expect(names["get_context_remaining"]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// bash/pwsh run_in_background + task_output（真机语义）
// ---------------------------------------------------------------------------

describe("bash run_in_background + task_output（真机 bash）", () => {
  it("后台启动立即返回 task_id；task_output 轮询到 completed 与输出", async () => {
    const dir = tempDir();
    const registry = toolsWith(dir, {
      env: new NodeExecutionEnv(),
      builtin: { shellScratchDir: path.join(dir, ".aegent", "scratch"), sessionId: "s-bg" },
    });
    const started = await dispatch(registry, "bash", {
      command: "echo bg-out-123",
      run_in_background: true,
    });
    expect(started.isError).toBeUndefined();
    expect(started.content).toContain("task_id: task-1");
    expect(started.meta).toMatchObject({ task_id: "task-1", background: true, started: true });

    // 轮询直到完成（wait 0.2s × 最多 ~50 次）
    let polled;
    for (let i = 0; i < 50; i++) {
      polled = await dispatch(registry, "task_output", { task_id: "task-1", wait_seconds: 0.2 });
      if (String(polled.content).includes("completed")) break;
    }
    expect(polled).toBeDefined();
    expect(polled!.isError).toBeUndefined();
    expect(String(polled!.content)).toContain("status: completed");
    expect(String(polled!.content)).toContain("bg-out-123");
    expect(polled!.meta).toMatchObject({ task_id: "task-1", outputBounded: true });
  }, 20_000);

  it("task_output kill：长任务被终止（status killed，进程树回收）", async () => {
    const dir = tempDir();
    const registry = toolsWith(dir, {
      env: new NodeExecutionEnv(),
      builtin: { shellScratchDir: path.join(dir, ".aegent", "scratch"), sessionId: "s-kill" },
    });
    await dispatch(registry, "bash", {
      command: "sleep 30 && echo should-not-appear",
      run_in_background: true,
    });
    const killed = await dispatch(registry, "task_output", { task_id: "task-1", kill: true });
    expect(killed.isError).toBeUndefined();
    expect(String(killed.content)).toContain("status: killed");
    expect(String(killed.content)).not.toContain("should-not-appear");
  }, 15_000);

  it("未知 task_id → 类型化 TASK_NOT_FOUND（含可用清单）；缺 task_id → INVALID_ARGUMENTS", async () => {
    const dir = tempDir();
    const registry = toolsWith(dir, { env: new NodeExecutionEnv() });
    const unknown = await dispatch(registry, "task_output", { task_id: "task-99" });
    expect(unknown.error?.code).toBe("TASK_NOT_FOUND");
    expect(String(unknown.content)).toContain("task-99");
    const missing = await dispatch(registry, "task_output", {});
    expect(missing.error?.code).toBe("INVALID_ARGUMENTS");
    const badWait = await dispatch(registry, "task_output", { task_id: "t", wait_seconds: 999 });
    expect(badWait.error?.code).toBe("INVALID_ARGUMENTS");
  });

  it("env 无 spawnBackground 能力 → BACKGROUND_UNSUPPORTED（fail-closed 不静默）", async () => {
    const dir = tempDir();
    const stubEnv = {
      exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    } as unknown as NodeExecutionEnv;
    const registry = toolsWith(dir, { env: stubEnv });
    const result = await dispatch(registry, "bash", {
      command: "echo x",
      run_in_background: true,
    });
    expect(result.error?.code).toBe("BACKGROUND_UNSUPPORTED");
  });

  it("pwsh run_in_background 同语义（注册面存在 + 常驻 task_output 共享注册表）", async () => {
    const dir = tempDir();
    const registry = toolsWith(dir, { env: new NodeExecutionEnv() });
    const names = registry.names();
    expect(names).toContain("task_output");
    expect(names).toContain("pwsh");
  });

  it("BackgroundShellRegistry：满员拒绝 + 已结束驱逐 + dispose 全杀", async () => {
    const registry = new BackgroundShellRegistry();
    let killCount = 0;
    const fakeHandle = (running: boolean) => ({
      pid: 1,
      output: () => ({ status: running ? ("running" as const) : ("completed" as const), stdout: "", stderr: "", stdoutOmittedBytes: 0, stderrOmittedBytes: 0 }),
      wait: async () => fakeHandle(running).output(),
      kill: async () => {
        killCount += 1;
      },
    });
    // 63 个在跑 + 1 个已结束 → 驱逐已结束者，新任务可进（64 满）
    for (let i = 0; i < MAX_BACKGROUND_TASKS - 1; i++) {
      registry.start({ shell: "bash", command: "x", handle: fakeHandle(true) });
    }
    registry.start({ shell: "bash", command: "done", handle: fakeHandle(false) });
    registry.start({ shell: "bash", command: "new", handle: fakeHandle(true) });
    // 全在跑 → 满员拒绝（无已结束者可驱逐）
    expect(() => registry.start({ shell: "bash", command: "y", handle: fakeHandle(true) })).toThrow(
      /后台任务已满/,
    );
    // dispose 杀掉全部运行中任务并清空
    await registry.dispose();
    expect(registry.list()).toHaveLength(0);
    expect(killCount).toBe(MAX_BACKGROUND_TASKS);
  });
});

// ---------------------------------------------------------------------------
// shell 输出双层预算格式化（stdout 保头 / stderr 保尾 / 单行 16k / spill）
// ---------------------------------------------------------------------------

describe("shell-output 双层预算格式化（pi-desktop 同构）", () => {
  it("预算内零截断（原文 + outputBounded 标记 + 空 spillPaths）", async () => {
    const out = await formatShellOutput({
      stdout: "line-1\nline-2",
      stderr: "",
      exitCode: 0,
      label: "bash",
      sessionId: "s1",
      tool: "bash",
      callId: "c1",
    });
    expect(out.truncated).toBe(false);
    expect(out.text).toBe("line-1\nline-2");
    expect(out.meta).toEqual({ outputBounded: true, spillPaths: [] });
  });

  it("stdout 超预算：保头截断 + spill 全量副本 + 尾部提示含路径与 KB", async () => {
    const dir = tempDir();
    const scratch = path.join(dir, ".aegent", "scratch");
    const lines = Array.from({ length: SHELL_BUDGET_LINES + 500 }, (_, i) => `row-${String(i)}`);
    const out = await formatShellOutput({
      stdout: lines.join("\n"),
      exitCode: 0,
      scratchDir: scratch,
      label: "bash",
      sessionId: "s1",
      tool: "bash",
      callId: "c1",
    });
    expect(out.truncated).toBe(true);
    expect(out.text).toContain("row-0\n");
    expect(out.text).not.toContain(`row-${String(SHELL_BUDGET_LINES + 499)}`);
    expect(out.text).toContain("完整输出已存至 ");
    expect(out.text).toContain("— 可 grep 或 read。]");
    const spillPath = String(out.meta.spillPaths[0]);
    const spill = readFileSync(spillPath, "utf8");
    // Q13 标记首行可解析 + 完整原文在位
    const marker = JSON.parse(spill.split("\n")[0]!) as Record<string, unknown>;
    expect(marker).toMatchObject({ kind: "aegent/tool-output-spill", sessionId: "s1", tool: "bash" });
    expect(spill).toContain(`row-${String(SHELL_BUDGET_LINES + 499)}`);
  });

  it("stderr 超预算：保尾截断（最后 stderr 行可见，早期行被截）", async () => {
    const lines = Array.from({ length: SHELL_BUDGET_LINES + 200 }, (_, i) => `err-${String(i)}`);
    const out = await formatShellOutput({
      stdout: "",
      stderr: lines.join("\n"),
      exitCode: 1,
      label: "pwsh",
      sessionId: "s1",
      tool: "pwsh",
      callId: "c1",
    });
    expect(out.truncated).toBe(true);
    // tail 方向：最后的错误在前部可见（marker 在正文前）
    expect(out.text.indexOf("[stderr truncated")).toBeLessThan(out.text.indexOf(`err-${String(SHELL_BUDGET_LINES + 199)}`));
    expect(out.text).toContain(`err-${String(SHELL_BUDGET_LINES + 199)}`);
    expect(out.text).not.toContain("\nerr-0\n");
    expect(out.text).toContain("[exit code 1]");
  });

  it("单行超 16384 字符被裁（minified one-liner 不刷屏）", async () => {
    const huge = "x".repeat(MAX_LINE_CHARS + 5000);
    const out = await formatShellOutput({
      stdout: huge,
      exitCode: 0,
      label: "bash",
      sessionId: "s1",
      tool: "bash",
      callId: "c1",
    });
    expect(out.text.length).toBeLessThan(huge.length);
    expect(out.text).toContain("超长行");
  });

  it("非零退出码追加 [exit code N]；全空输出 = (no output)", async () => {
    const failed = await formatShellOutput({
      stdout: "",
      stderr: "",
      exitCode: 3,
      label: "bash",
      sessionId: "s1",
      tool: "bash",
      callId: "c1",
    });
    expect(failed.text).toBe("(no output)\n[exit code 3]");
  });
});

// ---------------------------------------------------------------------------
// view_image（附件链注入）
// ---------------------------------------------------------------------------

/** 1×1 红色 PNG（魔数嗅探面）。 */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("view_image（本地图片注入）", () => {
  it("读图 → 字节进 AttachmentStore + 结果 meta 带 imageAttachment 引用", async () => {
    const dir = tempDir();
    const file = path.join(dir, "shot.png");
    writeFileSync(file, PNG_1PX);
    const store = new InMemoryAttachmentStore();
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      pathGuard: PathGuard.forWorkspace(dir),
      workspaceRoot: dir,
      attachments: store,
    });
    const result = await dispatch(registry, "view_image", { path: "shot.png" });
    expect(result.isError).toBeUndefined();
    const ref = (result.meta as Record<string, unknown>)["imageAttachment"] as Record<string, unknown>;
    expect(ref["attachmentId"]).toBeTypeOf("string");
    expect(ref["mediaType"]).toBe("image/png");
    // 字节确实进了 store（投影层 resolveImage 可解析）
    const att = store.read(String(ref["attachmentId"]));
    expect(att).not.toBeNull();
    expect(Buffer.from(att!.data, "base64")).toEqual(PNG_1PX);
  });

  it("不支持的格式（扩展名与魔数双失）→ UNSUPPORTED_FORMAT；目录 → NOT_A_FILE", async () => {
    const dir = tempDir();
    const file = path.join(dir, "note.txt");
    writeFileSync(file, "plain");
    const store = new InMemoryAttachmentStore();
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      pathGuard: PathGuard.forWorkspace(dir),
      workspaceRoot: dir,
      attachments: store,
    });
    const bad = await dispatch(registry, "view_image", { path: file });
    expect(bad.error?.code).toBe("UNSUPPORTED_FORMAT");
    const dirResult = await dispatch(registry, "view_image", { path: dir });
    expect(dirResult.error?.code).toBe("NOT_A_FILE");
  });

  it("工作区外路径 → P0 读面不限照读成功（与 read 工具同款语义——读边界仅显式配置 readRoots 时生效）", async () => {
    const dir = tempDir();
    const outside = tempDir();
    const file = path.join(outside, "anywhere.png");
    writeFileSync(file, PNG_1PX);
    const store = new InMemoryAttachmentStore();
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      pathGuard: PathGuard.forWorkspace(dir),
      workspaceRoot: dir,
      attachments: store,
    });
    const result = await dispatch(registry, "view_image", { path: file });
    expect(result.isError).toBeUndefined();
    const ref = (result.meta as Record<string, unknown>)["imageAttachment"] as Record<string, unknown>;
    expect(store.read(String(ref["attachmentId"]))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// get_context_remaining（monitor 投影）
// ---------------------------------------------------------------------------

describe("get_context_remaining（上下文余量自查）", () => {
  it("有计量记录 → used/contextWindow/tokensLeft 三数；无记录 → 诚实不可知", async () => {
    const registry = new ToolRegistry();
    let snapshot: { used: number; contextWindow: number } | null = { used: 120_000, contextWindow: 200_000 };
    registerBuiltinTools(registry, { contextUsage: () => snapshot });
    const result = await dispatch(registry, "get_context_remaining", {});
    expect(result.content).toContain("200000");
    expect(result.content).toContain("120000");
    expect(result.content).toContain("remaining: 80000");
    expect(result.meta).toMatchObject({ tokensLeft: 80000, used: 120000 });

    snapshot = null;
    const unknown = await dispatch(registry, "get_context_remaining", {});
    expect(String(unknown.content)).toContain("not available yet");
    expect(unknown.meta).toMatchObject({ tokensLeft: null });
  });

  it("contextUsage 缺席不注册（无计量面不造假数字）", () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    expect(registry.names()).not.toContain("get_context_remaining");
  });
});

// ---------------------------------------------------------------------------
// webfetch 增强（缓存 / blob 重写 / HTTPS 升级 / 跨域重定向）
// ---------------------------------------------------------------------------

function httpServer(
  handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void,
): Promise<{ server: Server; url: (p?: string) => string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
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

function webfetchRegistry(dir: string): ToolRegistry {
  const registry = new ToolRegistry();
  registerBuiltinTools(registry, {
    pathGuard: PathGuard.forWorkspace(dir),
    networkGuard: createNetworkGuard({ policy: "allow" }),
  });
  return registry;
}

describe("webfetch 增强（T-P3-174 批次 1）", () => {
  it("15 分钟缓存：第二次同 URL 命中缓存（cacheHit: true，不再打服务器）", async () => {
    let hits = 0;
    const http = await httpServer((_req, res) => {
      hits += 1;
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(`body-${String(hits)}`);
    });
    try {
      const registry = webfetchRegistry(tempDir());
      const first = await dispatch(registry, "webfetch", { url: http.url("/a") });
      expect(first.content).toBe("body-1");
      const second = await dispatch(registry, "webfetch", { url: http.url("/a") });
      expect(second.content).toBe("body-1"); // 缓存命中——服务器没被打第二次
      expect(hits).toBe(1);
      expect(second.meta).toMatchObject({ cacheHit: true });
      // 不同路径 = 不同 key
      const other = await dispatch(registry, "webfetch", { url: http.url("/b") });
      expect(other.content).toBe("body-2");
    } finally {
      await http.close();
    }
  });

  it("rewriteGitHubBlobUrl：github.com blob→raw；host 精确匹配；非 blob 原样", () => {
    expect(rewriteGitHubBlobUrl("https://github.com/owner/repo/blob/main/README.md")).toBe(
      "https://raw.githubusercontent.com/owner/repo/main/README.md",
    );
    expect(rewriteGitHubBlobUrl("https://www.github.com/owner/repo/blob/main/a b.txt")).toBe(
      "https://raw.githubusercontent.com/owner/repo/main/a%20b.txt",
    );
    // lookalike host 不触发
    expect(rewriteGitHubBlobUrl("https://github.com.evil.com/owner/repo/blob/main/x")).toBe(
      "https://github.com.evil.com/owner/repo/blob/main/x",
    );
    // 非 blob 路径原样
    expect(rewriteGitHubBlobUrl("https://github.com/owner/repo/tree/main/x")).toBe(
      "https://github.com/owner/repo/tree/main/x",
    );
    // gist 不匹配（hostname 是 gist.github.com）
    expect(rewriteGitHubBlobUrl("https://gist.github.com/a/b")).toBe("https://gist.github.com/a/b");
  });

  it("upgradeHttpToHttps：非私有 http 升级；localhost/私网/带端口不升", () => {
    expect(upgradeHttpToHttps("http://example.com/a").upgradedFrom).toBe("http://example.com/a");
    expect(upgradeHttpToHttps("http://example.com/a").url).toBe("https://example.com/a");
    expect(upgradeHttpToHttps("http://localhost:3000/a").upgradedFrom).toBeUndefined();
    expect(upgradeHttpToHttps("http://127.0.0.1/a").upgradedFrom).toBeUndefined();
    expect(upgradeHttpToHttps("http://192.168.1.2/a").upgradedFrom).toBeUndefined();
    expect(upgradeHttpToHttps("http://example.com:8080/a").upgradedFrom).toBeUndefined();
    expect(upgradeHttpToHttps("https://example.com/a").upgradedFrom).toBeUndefined();
  });

  it("同源重定向自动跟随（至多 5 跳）；跨源重定向返回指引不跟随", async () => {
    let finalHits = 0;
    const http = await httpServer((req, res) => {
      if (req.url === "/start") {
        // 同源跳转：127.0.0.1 → /final
        res.writeHead(302, { location: "/final" });
        res.end();
        return;
      }
      if (req.url === "/cross") {
        // 跨源跳转：localhost host ≠ 127.0.0.1（stripWww 后仍不同）
        const port = (req.socket.localPort ?? 0);
        res.writeHead(301, { location: `http://localhost:${String(port)}/elsewhere` });
        res.end();
        return;
      }
      finalHits += 1;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("final-body");
    });
    try {
      const registry = webfetchRegistry(tempDir());
      const followed = await dispatch(registry, "webfetch", { url: http.url("/start") });
      expect(followed.content).toBe("final-body");
      expect(finalHits).toBe(1);

      const cross = await dispatch(registry, "webfetch", { url: http.url("/cross") });
      expect(cross.isError).toBeUndefined(); // 指引不是错误
      expect(String(cross.content)).toContain("REDIRECT DETECTED");
      expect(String(cross.content)).toContain("http://localhost:");
      expect(String(cross.content)).toContain("/elsewhere");
    } finally {
      await http.close();
    }
  });

  it("私有 host 不升级：localhost 明文请求照发（本地开发面）", async () => {
    const http = await httpServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("plain-http-ok");
    });
    try {
      const registry = webfetchRegistry(tempDir());
      const result = await dispatch(registry, "webfetch", { url: http.url("/x") });
      expect(result.content).toBe("plain-http-ok");
      expect(result.meta).toMatchObject({ url: http.url("/x") });
      expect(result.meta).not.toMatchObject({ upgradedFrom: expect.anything() });
    } finally {
      await http.close();
    }
  });
});

// ---------------------------------------------------------------------------
// grep rg 快路径
// ---------------------------------------------------------------------------

describe("grep rg 快路径（系统 rg 优先 / 无缝回退）", () => {
  function fakeEnvWithRg(rgBehavior: {
    probeOk: boolean;
    respond?: (args: string[]) => { exitCode: number; stdout: string; stderr: string };
  }): NodeExecutionEnv {
    return {
      exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      execFile: async (program: string, args: readonly string[]) => {
        if (program === "rg" && args[0] === "--version") {
          if (rgBehavior.probeOk) return { exitCode: 0, stdout: "ripgrep 14.0.0", stderr: "" };
          throw Object.assign(new Error("spawn rg ENOENT"), { code: "ENOENT" });
        }
        if (program === "rg" && rgBehavior.respond !== undefined) {
          return rgBehavior.respond([...args]);
        }
        throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
      },
    } as unknown as NodeExecutionEnv;
  }

  function rgJsonMatch(file: string, lineNo: number, text: string): string {
    return JSON.stringify({
      type: "match",
      data: {
        path: { text: file },
        line_number: lineNo,
        lines: { text: `${text}\n` },
      },
    });
  }

  it("rg 在场：--json 输出解析为内置同款格式（file:line: text）", async () => {
    const dir = tempDir();
    const file = path.join(dir, "a.ts");
    writeFileSync(file, "alpha-pattern here\n");
    const registry = new ToolRegistry({
      env: fakeEnvWithRg({
        probeOk: true,
        respond: () => ({
          exitCode: 0,
          stdout: [rgJsonMatch(file, 3, "alpha-pattern"), rgJsonMatch(path.join(dir, "b.ts"), 7, "alpha-pattern again")].join("\n"),
          stderr: "",
        }),
      }),
    });
    registerBuiltinTools(registry, { pathGuard: PathGuard.forWorkspace(dir), workspaceRoot: dir });
    const result = await dispatch(registry, "grep", { pattern: "alpha", path: dir });
    expect(result.content).toContain(`${file}:3: alpha-pattern`);
    expect(result.content).toContain(`${path.join(dir, "b.ts")}:7: alpha-pattern again`);
  });

  it("rg 无匹配（exit 1）→ No matches found；rg 出错（exit 2）→ 回退内置搜索器", async () => {
    const dir = tempDir();
    const file = path.join(dir, "hit.txt");
    writeFileSync(file, "needle here\n");
    const registry = new ToolRegistry({
      env: fakeEnvWithRg({
        probeOk: true,
        respond: () => ({ exitCode: 2, stdout: "", stderr: "rg error" }),
      }),
    });
    registerBuiltinTools(registry, { pathGuard: PathGuard.forWorkspace(dir), workspaceRoot: dir });
    // exit 2 → fallback → 内置搜索器在真实文件上找到 needle
    const result = await dispatch(registry, "grep", { pattern: "needle", path: dir });
    expect(result.content).toContain(`${file}:1: needle here`);

    const registry2 = new ToolRegistry({
      env: fakeEnvWithRg({
        probeOk: true,
        respond: () => ({ exitCode: 1, stdout: "", stderr: "" }),
      }),
    });
    registerBuiltinTools(registry2, { pathGuard: PathGuard.forWorkspace(dir), workspaceRoot: dir });
    const none = await dispatch(registry2, "grep", { pattern: "needle", path: dir });
    expect(none.content).toBe("No matches found");
  });

  it("rg 不在 PATH（探测 ENOENT）→ 回退内置（结果形状不变）", async () => {
    const dir = tempDir();
    const file = path.join(dir, "code.txt");
    writeFileSync(file, "const x = 1;\n");
    const registry = new ToolRegistry({ env: fakeEnvWithRg({ probeOk: false }) });
    registerBuiltinTools(registry, { pathGuard: PathGuard.forWorkspace(dir), workspaceRoot: dir });
    const result = await dispatch(registry, "grep", { pattern: "const", path: dir });
    expect(result.content).toContain(`${file}:1: const x = 1;`);
  });

  it("JS 独有正则构造（lookahead）→ 直接回退内置（rg 不支持不输出假结果）", async () => {
    const dir = tempDir();
    const file = path.join(dir, "re.txt");
    writeFileSync(file, "foobar\nfoobaz\n");
    let rgCalled = 0;
    const registry = new ToolRegistry({
      env: {
        exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        execFile: async () => {
          rgCalled += 1;
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      } as unknown as NodeExecutionEnv,
    });
    registerBuiltinTools(registry, { pathGuard: PathGuard.forWorkspace(dir), workspaceRoot: dir });
    const result = await dispatch(registry, "grep", { pattern: "foo(?=bar)", path: dir });
    expect(result.content).toContain("foobar");
    expect(rgCalled).toBe(0); // 未尝试 rg（方言不兼容直接走内置）
  });
});

// ---------------------------------------------------------------------------
// save_memory（C2 记忆索引追加）
// ---------------------------------------------------------------------------

describe("save_memory（持久记忆追加）", () => {
  it("首写建标题 + 追加行（带日期）；再写续追加", async () => {
    const dir = tempDir();
    const memoryPath = path.join(dir, "memory", "MEMORY.md");
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      memoryPath,
      savePlanArtifact: () => ({ path: "stub" }),
    });
    const first = await dispatch(registry, "save_memory", { fact: "用户偏好深色主题" });
    expect(first.isError).toBeUndefined();
    expect(String(first.content)).toContain(memoryPath);
    let text = readFileSync(memoryPath, "utf8");
    expect(text).toContain("# 持久记忆");
    expect(text).toMatch(/- \[\d{4}-\d{2}-\d{2}\] 用户偏好深色主题/);

    await dispatch(registry, "save_memory", { fact: "项目路径 F:\\aegent" });
    text = readFileSync(memoryPath, "utf8");
    expect(text).toContain("项目路径 F:\\aegent");
    expect(text.trimEnd().split("\n").length).toBe(4); // 标题 + 空行 + 2 行
  });

  it("换行折叠成空格；空 fact / 超长 fact 类型化拒绝", async () => {
    const dir = tempDir();
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, { memoryPath: path.join(dir, "MEMORY.md") });
    const folded = await dispatch(registry, "save_memory", { fact: "第一行\n第二行\r\n第三行" });
    expect(readFileSync(path.join(dir, "MEMORY.md"), "utf8")).toContain("第一行 第二行 第三行");
    expect(String(folded.content)).toContain("已写入持久记忆");

    const empty = await dispatch(registry, "save_memory", { fact: "  \n " });
    expect(empty.error?.code).toBe("INVALID_ARGUMENTS");
    const huge = await dispatch(registry, "save_memory", { fact: "x".repeat(MAX_MEMORY_FACT_CHARS + 1) });
    expect(huge.error?.code).toBe("FACT_TOO_LONG");
  });
});

// ---------------------------------------------------------------------------
// notebook_edit（ipynb 单元格编辑）
// ---------------------------------------------------------------------------

function seedNotebook(file: string, cells: object[]): void {
  const doc = { cells, metadata: {}, nbformat: 4, nbformat_minor: 2 };
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

describe("notebook_edit（ipynb 单元格级编辑）", () => {
  const codeCell = (id: string, source: string) => ({
    cell_type: "code",
    execution_count: 3,
    id,
    metadata: {},
    outputs: [{ name: "stdout", output_type: "stream", text: ["old\n"] }],
    source,
  });
  const mdCell = (id: string, source: string) => ({
    cell_type: "markdown",
    id,
    metadata: {},
    source,
  });

  it("replace：改 source + code 格执行事实重置；格式保留（2 空格缩进 + 尾换行）", async () => {
    const dir = tempDir();
    const nb = path.join(dir, "book.ipynb");
    seedNotebook(nb, [codeCell("c1", 'print("hi")\n'), mdCell("m1", "# 标题")]);
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      pathGuard: PathGuard.forWorkspace(dir),
      workspaceRoot: dir,
      savePlanArtifact: () => ({ path: "stub" }),
    });
    const result = await dispatch(registry, "notebook_edit", {
      notebook_path: nb,
      cell_id: "c1",
      new_source: 'print("edited")\n',
    });
    expect(result.isError).toBeUndefined();
    const doc = JSON.parse(readFileSync(nb, "utf8")) as {
      cells: Array<Record<string, unknown>>;
    };
    expect(doc.cells[0]!["source"]).toBe('print("edited")\n');
    expect(doc.cells[0]!["execution_count"]).toBeNull();
    expect(doc.cells[0]!["outputs"]).toEqual([]);
    // 格式保留（2 空格缩进 + 尾换行）
    const raw = readFileSync(nb, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('\n  "cells"');
  });

  it("insert：cell_id 省略插头部 / 给了插其后；默认 code；delete 只需 cell_id", async () => {
    const dir = tempDir();
    const nb = path.join(dir, "book.ipynb");
    seedNotebook(nb, [mdCell("m1", "# t")]);
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      pathGuard: PathGuard.forWorkspace(dir),
      workspaceRoot: dir,
      savePlanArtifact: () => ({ path: "stub" }),
    });
    await dispatch(registry, "notebook_edit", {
      notebook_path: nb,
      new_source: "x = 1\n",
      cell_type: "code",
      edit_mode: "insert",
    });
    let doc = JSON.parse(readFileSync(nb, "utf8")) as { cells: Array<{ id?: string; cell_type?: string }> };
    expect(doc.cells).toHaveLength(2);
    expect(doc.cells[0]!.cell_type).toBe("code"); // 省略 cell_id → 插头部

    await dispatch(registry, "notebook_edit", {
      notebook_path: nb,
      cell_id: "m1",
      new_source: "y = 2\n",
      edit_mode: "insert",
    });
    doc = JSON.parse(readFileSync(nb, "utf8")) as { cells: Array<{ id?: string; cell_type?: string }> };
    expect(doc.cells).toHaveLength(3);
    expect(doc.cells[1]!.id).toBe("m1"); // 原格
    // 插在 m1 之后；cell_type 缺省 code
    expect(doc.cells[2]!.cell_type).toBe("code");

    await dispatch(registry, "notebook_edit", {
      notebook_path: nb,
      cell_id: "m1",
      edit_mode: "delete",
    });
    doc = JSON.parse(readFileSync(nb, "utf8")) as { cells: Array<{ id?: string; cell_type?: string }> };
    expect(doc.cells).toHaveLength(2);
    expect(doc.cells).toEqual([
      expect.not.objectContaining({ id: "m1" }),
      expect.not.objectContaining({ id: "m1" }),
    ]);
  });

  it("cell-N 回退定位；歧义 id 类型化报错；找不到格 / 非 ipynb / 坏 JSON 全拒绝", async () => {
    const dir = tempDir();
    const nb = path.join(dir, "book.ipynb");
    // 旧格式无 id 的 notebook（cell-N 回退面）
    seedNotebook(nb, [mdCell("a", "one"), mdCell("b", "two")]);
    const docRaw = JSON.parse(readFileSync(nb, "utf8")) as { cells: Array<Record<string, unknown>> };
    for (const c of docRaw.cells) delete c["id"];
    writeFileSync(nb, `${JSON.stringify(docRaw, null, 2)}\n`, "utf8");
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      pathGuard: PathGuard.forWorkspace(dir),
      workspaceRoot: dir,
      savePlanArtifact: () => ({ path: "stub" }),
    });
    // cell-1 = 第二格（0 基回退）
    const byFallback = await dispatch(registry, "notebook_edit", {
      notebook_path: nb,
      cell_id: "cell-1",
      new_source: "replaced",
      edit_mode: "replace",
    });
    expect(byFallback.isError).toBeUndefined();
    const doc = JSON.parse(readFileSync(nb, "utf8")) as { cells: Array<{ source: string }> };
    expect(doc.cells[1]!.source).toBe("replaced");

    const missing = await dispatch(registry, "notebook_edit", {
      notebook_path: nb,
      cell_id: "cell-9",
      edit_mode: "delete",
    });
    expect(missing.error?.code).toBe("NOTEBOOK_CELL_NOT_FOUND");

    // 歧义 id：重复 cell.id
    const dup = path.join(dir, "dup.ipynb");
    seedNotebook(dup, [codeCell("same", "a"), codeCell("same", "b")]);
    const ambiguous = await dispatch(registry, "notebook_edit", {
      notebook_path: dup,
      cell_id: "same",
      edit_mode: "delete",
    });
    expect(ambiguous.error?.code).toBe("NOTEBOOK_CELL_AMBIGUOUS");

    const notNb = await dispatch(registry, "notebook_edit", {
      notebook_path: path.join(dir, "x.txt"),
      cell_id: "c",
    });
    expect(notNb.error?.code).toBe("INVALID_ARGUMENTS");

    const badJson = path.join(dir, "bad.ipynb");
    writeFileSync(badJson, "{not json", "utf8");
    const parseFail = await dispatch(registry, "notebook_edit", {
      notebook_path: badJson,
      cell_id: "c",
      new_source: "x",
    });
    expect(parseFail.error?.code).toBe("NOTEBOOK_INVALID_JSON");
  });

  it("工作区外写 → PathGuard 拒绝（与 write/edit 同款出口级硬拦）", async () => {
    const dir = tempDir();
    const outside = tempDir();
    const nb = path.join(outside, "evil.ipynb");
    seedNotebook(nb, []);
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      pathGuard: PathGuard.forWorkspace(dir),
      workspaceRoot: dir,
      savePlanArtifact: () => ({ path: "stub" }),
    });
    const result = await dispatch(registry, "notebook_edit", {
      notebook_path: nb,
      cell_id: "c1",
      new_source: "x",
    });
    expect(result.error?.code).toBe("PATH_OUTSIDE_WRITABLE");
  });
});

// ---------------------------------------------------------------------------
// loop 图片注入（view_image 结果 → injected user/message → 投影展开）
// ---------------------------------------------------------------------------

describe("view_image 注入链（loop → 事件流 → 投影）", () => {
  it("工具结果 meta.imageAttachment 在位时，tool/result 后追加 injected user/message（attachments=[ref]）", async () => {
    const provider = new ScriptedProvider();
    provider.mount([
      { type: "text-delta", text: "看图" },
      { type: "tool-call-delta", id: "call-1", name: "view_image", argsDelta: '{"path":"a.png"}' },
      { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
      { type: "done" },
    ]);
    provider.mount([{ type: "text-delta", text: "看到了" }, { type: "done" }]);
    const ref = {
      attachmentId: "att-1",
      mediaType: "image/png",
      name: "a.png",
      size: 100,
    };
    const { store, loop } = makeLoop(provider, {
      executeTool: async () => ({
        content: "[image loaded: a.png (image/png, 100B, id=att-1)] 图片已注入下一次模型请求。",
        meta: { imageAttachment: ref },
      }),
    });
    await loop.runTurn("看看这张图");
    const events = store.load("s1");
    const types = events.map((e) => e.type);
    const resultIdx = types.lastIndexOf("tool/result");
    expect(resultIdx, "tool/result 应已落流").toBeGreaterThan(-1);
    const injectedIdx = types.findIndex(
      (t, i) => i > resultIdx && t === "user/message",
    );
    expect(injectedIdx, "tool/result 之后应有 injected user/message").toBeGreaterThan(resultIdx);
    const injected = events[injectedIdx] as unknown as {
      source: string;
      attachments?: Array<Record<string, unknown>>;
    };
    expect(injected.source).toBe("injected");
    expect(injected.attachments).toEqual([ref]);
  });
});

// ---------------------------------------------------------------------------
// agent-process 装配消费（最小装配：新工具可用 + 后台注册表 dispose 挂钩）
// ---------------------------------------------------------------------------

describe("批次 1 装配面", () => {
  it("shellScratchDir/sessionId 传进 bash（spill 落 workspace scratch）", async () => {
    const dir = tempDir();
    const scratch = path.join(dir, ".aegent", "scratch");
    const registry = toolsWith(dir, {
      env: new NodeExecutionEnv(),
      builtin: { shellScratchDir: scratch, sessionId: "s-asm" },
    });
    // seq 输出 4010 行（>4000 行预算 → 截断 + spill）
    const result = await dispatch(registry, "bash", { command: "seq 1 4010" });
    expect(result.meta).toMatchObject({ outputBounded: true });
    const spillPaths = (result.meta as Record<string, unknown>)["spillPaths"] as unknown[];
    expect(spillPaths.length, `应产生 spill（meta=${JSON.stringify(result.meta)}）`).toBeGreaterThan(0);
    const spillPath = String(spillPaths[0]);
    expect(spillPath.startsWith(scratch)).toBe(true);
    const marker = JSON.parse(readFileSync(spillPath, "utf8").split("\n")[0]!) as Record<string, unknown>;
    expect(marker["sessionId"]).toBe("s-asm");
  }, 15_000);

  it("InMemoryEventStorage 面不回归：注册表带 sessionId 装配（Q13 身份缺省面）", async () => {
    const dir = tempDir();
    const store = new SessionStore(new InMemoryEventStorage());
    expect(store).toBeDefined();
    const registry = toolsWith(dir, { env: new NodeExecutionEnv() });
    expect(registry.names()).toContain("task_output");
    expect(registry.names()).toContain("save_memory");
    expect(registry.names()).toContain("notebook_edit");
    expect(registry.names()).not.toContain("view_image"); // attachments 缺席不注册
  });
});
