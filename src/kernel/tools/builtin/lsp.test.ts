import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { registerBuiltinTools } from "./index.js";
import { PathGuard } from "../../../sandbox/path-guard.js";
import { LspClient, createMemoryTransport, encodeFrame } from "../../../lsp/client.js";
import { toLspPosition, buildLspRequest } from "./lsp.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-lsp-"));
  tmpDirs.push(dir);
  return dir;
}

function dispatch(registry: ToolRegistry, args: unknown) {
  return registry.dispatch({
    callId: "c1",
    name: "lsp",
    arguments: JSON.stringify(args),
  });
}

/**
 * 桩客户端：每个请求（含 initialize）按序消费一个预编 result，id 递增
 * 配对（与 LspClient 的 nextId 从 1 递增一致）。requests 侧记录帧原文。
 */
function stubClient(results: unknown[]): {
  client: LspClient;
  requestBodies: Array<{ id: number; method: string; params: Record<string, unknown> }>;
} {
  const transport = createMemoryTransport(
    results.map((result, i) =>
      encodeFrame(JSON.stringify({ jsonrpc: "2.0", id: i + 1, result })),
    ),
  );
  const requestBodies: Array<{ id: number; method: string; params: Record<string, unknown> }> = [];
  const client = new LspClient(transport, { name: "stub" });
  const originalSend = transport.send.bind(transport);
  transport.send = (frame: string) => {
    const body = JSON.parse(frame.replace(/^Content-Length: \d+\r\n\r\n/, ""));
    if (typeof body.id === "number") {
      requestBodies.push({ id: body.id, method: body.method, params: body.params });
    }
    originalSend(frame);
  };
  return { client, requestBodies };
}

describe("lsp 工具（B8b/T-P1-60）", () => {
  it("位置类操作往返：1-based 换算 0-based、method 与 params 正确", async () => {
    const dir = tempDir();
    const file = path.join(dir, "a.txt");
    writeFileSync(file, "hello\n");
    // 响应序列：initialize → goToDefinition（工具内按需自动 initialize）
    const { client, requestBodies } = stubClient([{ capabilities: {} }, [{ line: 0, character: 0 }]]);
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      pathGuard: PathGuard.forWorkspace(dir),
      lspClientFor: () => client,
    });
    const result = await dispatch(registry, {
      operation: "goToDefinition",
      filePath: file,
      line: 1,
      character: 1,
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content)).toEqual([{ line: 0, character: 0 }]);
    // 请求帧：method 正确 + 0-based 换算断言（1-based 1,1 → 0,0）
    const req = requestBodies.find((r) => r.method === "textDocument/definition");
    expect(req).toBeDefined();
    expect(req!.params.position).toEqual(toLspPosition(1, 1));
    expect(req!.params.position).toEqual({ line: 0, character: 0 });
  });

  it("9 操作到 LSP method 的映射闭集（buildLspRequest 纯函数）", () => {
    const pos = { line: 0, character: 0 };
    expect(buildLspRequest("goToDefinition", "u", pos, undefined).method).toBe(
      "textDocument/definition",
    );
    expect(buildLspRequest("findReferences", "u", pos, undefined).method).toBe(
      "textDocument/references",
    );
    expect(buildLspRequest("hover", "u", pos, undefined).method).toBe("textDocument/hover");
    expect(buildLspRequest("documentSymbol", "u", pos, undefined).method).toBe(
      "textDocument/documentSymbol",
    );
    expect(buildLspRequest("workspaceSymbol", "u", pos, "sym").method).toBe("workspace/symbol");
    expect(buildLspRequest("goToImplementation", "u", pos, undefined).method).toBe(
      "textDocument/implementation",
    );
    expect(buildLspRequest("prepareCallHierarchy", "u", pos, undefined).method).toBe(
      "textDocument/prepareCallHierarchy",
    );
    expect(buildLspRequest("incomingCalls", "u", pos, undefined).method).toBe(
      "callHierarchy/incomingCalls",
    );
    expect(buildLspRequest("outgoingCalls", "u", pos, undefined).method).toBe(
      "callHierarchy/outgoingCalls",
    );
  });

  it("无 server 文件类型 → LSP_NO_SERVER 类型化错误", async () => {
    const dir = tempDir();
    const file = path.join(dir, "b.txt");
    writeFileSync(file, "x\n");
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, { pathGuard: PathGuard.forWorkspace(dir) });
    const result = await dispatch(registry, {
      operation: "hover",
      filePath: file,
      line: 1,
      character: 1,
    });
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("LSP_NO_SERVER");
  });

  it("参数坏：未知操作 / 位置类缺行列 → INVALID_ARGUMENTS；空结果 → No results found", async () => {
    const dir = tempDir();
    const file = path.join(dir, "c.txt");
    writeFileSync(file, "x\n");
    // 响应序列：initialize → hover 请求回 null（空结果）
    const { client } = stubClient([{ capabilities: {} }, null]);
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      pathGuard: PathGuard.forWorkspace(dir),
      lspClientFor: () => client,
    });
    const badOp = await dispatch(registry, { operation: "mindRead", filePath: file });
    expect(badOp.error?.code).toBe("INVALID_ARGUMENTS");
    const noPos = await dispatch(registry, { operation: "hover", filePath: file });
    expect(noPos.error?.code).toBe("INVALID_ARGUMENTS");
    const empty = await dispatch(registry, {
      operation: "hover",
      filePath: file,
      line: 1,
      character: 1,
    });
    expect(empty.content).toBe("No results found for hover");
  });

  it("server 请求失败 → LSP_REQUEST_FAILED（不挂 loop）；工作区外路径被守卫拒", async () => {
    const dir = tempDir();
    const file = path.join(dir, "d.txt");
    writeFileSync(file, "x\n");
    // 请求即失败的桩 client（isInitialized=true——工具内不再握手）
    const failingClient = {
      name: "boom",
      isInitialized: true,
      request: async () => {
        throw new Error("boom");
      },
    } as unknown as LspClient;
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, {
      pathGuard: PathGuard.forWorkspace(dir),
      lspClientFor: () => failingClient,
    });
    const failed = await dispatch(registry, {
      operation: "hover",
      filePath: file,
      line: 1,
      character: 1,
    });
    expect(failed.isError).toBe(true);
    expect(failed.error?.code).toBe("LSP_REQUEST_FAILED");
    // 读面：P0 读边界不限（assertReadable 直通——read 工具同款行为），
    // 工作区外路径照常进 client → 同样落 LSP_REQUEST_FAILED
    const outside = tempDir();
    const outsideFile = path.join(outside, "x.txt");
    writeFileSync(outsideFile, "x\n");
    const outsideResult = await dispatch(registry, {
      operation: "hover",
      filePath: outsideFile,
      line: 1,
      character: 1,
    });
    expect(outsideResult.error?.code).toBe("LSP_REQUEST_FAILED");
  });
});
