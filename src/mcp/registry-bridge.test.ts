import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../kernel/tools/registry.js";
import { McpClient, createMcpStdioTransport } from "./client.js";
import { connectAndRegister, mcpToolRegistryName, validateServerName } from "./registry-bridge.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * 写一个真 stdio MCP server 脚本（newline JSON-RPC）：initialize 握手、
 * tools/list（两个工具）、tools/call（echo 与错误面）。无 tools 能力的
 * server 变体由 noTools 控制。
 */
function writeStubServer(dir: string, opts?: { noTools?: boolean }): string {
  const script = `
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  buf += c;
  for (;;) {
    const nl = buf.indexOf("\\n");
    if (nl === -1) break;
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0", id: msg.id,
        result: { protocolVersion: "2024-11-05", capabilities: ${opts?.noTools ? "{}" : "{ tools: {} }"}, serverInfo: { name: "stub" } },
      }) + "\\n");
    } else if (msg.method === "tools/list") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0", id: msg.id,
        result: { tools: [
          { name: "echo", description: "回显输入", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
          { name: "boom", description: "总是失败", inputSchema: { type: "object" } },
        ] },
      }) + "\\n");
    } else if (msg.method === "tools/call") {
      const ok = msg.params.name === "echo";
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0", id: msg.id,
        result: ok
          ? { content: [{ type: "text", text: "echo: " + String(msg.params.arguments.text) }] }
          : { content: [{ type: "text", text: "boom failed" }], isError: true },
      }) + "\\n");
    }
  }
});
`;
  const file = path.join(dir, "stub-mcp-server.js");
  writeFileSync(file, script, "utf8");
  return file;
}

describe("MCP 客户端（I3/T-P1-64）", () => {
  it("stdio 桩 server：initialize 握手 + capabilities 检测 + tools/list", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-mcp-"));
    tmpDirs.push(dir);
    const server = writeStubServer(dir);
    const transport = createMcpStdioTransport(process.execPath, [server]);
    const client = new McpClient(transport, "stub", transport.onLine.bind(transport), transport.onFail.bind(transport));
    const caps = await client.initialize();
    expect(caps.tools).toBe(true);
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["echo", "boom"]);
    client.dispose();
  });

  it("无 tools 能力的 server → 零注册不报错（opencode 能力检测同构）", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-mcp-"));
    tmpDirs.push(dir);
    const server = writeStubServer(dir, { noTools: true });
    const registry = new ToolRegistry();
    const conn = await connectAndRegister(registry, {
      name: "noTools",
      command: process.execPath,
      args: [server],
    });
    expect(conn.registeredToolNames).toEqual([]);
    conn.client.dispose();
  });

  it("registry-bridge：工具注册进 B1（命名空间化）+ dispatch 可执行 + isError 透传", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-mcp-"));
    tmpDirs.push(dir);
    const server = writeStubServer(dir);
    const registry = new ToolRegistry();
    const conn = await connectAndRegister(registry, {
      name: "fs",
      command: process.execPath,
      args: [server],
    });
    expect(conn.registeredToolNames).toEqual([
      mcpToolRegistryName("fs", "echo"),
      mcpToolRegistryName("fs", "boom"),
    ]);
    expect(conn.registeredToolNames[0]).toBe("fs__echo");
    // dispatch 执行：tools/call 往返 + 结果投影
    const ok = await registry.dispatch({
      callId: "c1",
      name: "fs__echo",
      arguments: JSON.stringify({ text: "你好" }),
    });
    expect(ok.content).toBe("echo: 你好");
    expect(ok.isError).toBeUndefined();
    // isError 透传
    const boom = await registry.dispatch({
      callId: "c2",
      name: "fs__boom",
      arguments: "{}",
    });
    expect(boom.isError).toBe(true);
    expect(boom.content).toBe("boom failed");
    // wire 面：MCP 工具的 description 来自协议（内联 descriptionText）
    const chat = registry.toChatTools();
    const echo = chat.find((t) => t.name === "fs__echo");
    expect(echo).toBeDefined();
    expect(echo!.description).toBe("回显输入");
    conn.client.dispose();
  });

  it("server 进程崩溃 → 挂起请求类型化失败、后续调用不挂 loop", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-mcp-"));
    tmpDirs.push(dir);
    const server = writeStubServer(dir);
    const registry = new ToolRegistry();
    const conn = await connectAndRegister(registry, {
      name: "die",
      command: process.execPath,
      args: [server],
    });
    conn.client.dispose(); // 模拟 server 失联（transport dispose → stdio 退出 → onFail）
    // 崩溃后的调用：快速类型化失败（isError 结果），不挂
    const result = await registry.dispatch({
      callId: "c3",
      name: "die__echo",
      arguments: JSON.stringify({ text: "x" }),
    });
    expect(result.isError).toBe(true);
  });

  it("server 名校验：空名 / 含 __ → 拒绝", () => {
    expect(() => validateServerName("")).toThrow();
    expect(() => validateServerName("a__b")).toThrow();
    expect(() => validateServerName("files")).not.toThrow();
  });

  it("条目 env 覆盖到子进程（T-P3-143）：叠加宿主环境，同名以条目为准", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-mcp-"));
    tmpDirs.push(dir);
    // 桩 server：peek 工具回显指定环境变量（既有值 + 条目覆盖值 + 宿主值）
    const file = path.join(dir, "env-probe-server.js");
    writeFileSync(
      file,
      `
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  buf += c;
  for (;;) {
    const nl = buf.indexOf("\\n");
    if (nl === -1) break;
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0", id: msg.id,
        result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "stub" } },
      }) + "\\n");
    } else if (msg.method === "tools/list") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0", id: msg.id,
        result: { tools: [{ name: "peek", description: "回显环境变量", inputSchema: { type: "object" } }] },
      }) + "\\n");
    } else if (msg.method === "tools/call") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0", id: msg.id,
        result: { content: [{ type: "text", text: String(process.env[msg.params.arguments.name] ?? "(unset)") }] },
      }) + "\\n");
    }
  }
});
`,
      "utf8",
    );
    const registry = new ToolRegistry();
    const conn = await connectAndRegister(registry, {
      name: "envprobe",
      command: process.execPath,
      args: [file],
      // MCP_ENV_PROBE 为条目覆盖值；PATH 为宿主环境继承样本
      env: { MCP_ENV_PROBE: "from-entry" },
    });
    const peek = async (name: string) =>
      (
        await registry.dispatch({
          callId: `c-${name}`,
          name: "envprobe__peek",
          arguments: JSON.stringify({ name }),
        })
      ).content;
    await expect(peek("MCP_ENV_PROBE")).resolves.toBe("from-entry");
    await expect(peek("PATH")).resolves.not.toBe("(unset)");
    conn.client.dispose();
  });
});
