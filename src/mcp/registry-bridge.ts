/**
 * MCP → B1 注册桥（I3/T-P1-64）——连接 server、tools/list、工具映射为
 * ToolDef 注册进注册表。命名空间化取 opencode McpCatalog.toolName 同构
 * （`<server>__<tool>`——server 名前缀防跨 server 冲突）；inputSchema 透传
 * （JSON Schema 形状）；tools/call 结果投影为文本（B12 投影面）。
 *
 * M6/B16/B17 既有面自动覆盖：注册的 MCP 工具与 builtin 同轨（超时声明可
 * 在 ToolDef 上声明、并行判定走注册表、step 快照保护在途 step）。
 */

import type { JsonRecord } from "../kernel/events.js";
import type { ToolDef, ToolRegistry } from "../kernel/tools/registry.js";
import { McpClient, createMcpStdioTransport, type McpToolInfo } from "./client.js";

/** 一个 MCP server 的装配配置（stdio 命令 + 参数）。 */
export interface McpServerConfig {
  /** server 名（工具名命名空间前缀；须非空且不含 "__"——防前缀歧义）。 */
  name: string;
  command: string;
  args?: string[];
  /** server 进程环境变量覆盖（T-P3-143——叠加宿主环境，同名以条目为准）。 */
  env?: Record<string, string>;
  /** 握手/列工具/调用的单请求超时 ms（缺省 client 的 10s 常量）。 */
  timeoutMs?: number;
}

/** 已连接 server 的句柄（调用面复用——装配持有）。 */
export interface McpConnection {
  client: McpClient;
  registeredToolNames: string[];
}

/** server 名校验：非空且不含命名空间分隔符。 */
export function validateServerName(name: string): void {
  if (name === "" || name.includes("__")) {
    throw new Error(`MCP server 名非法："${name}"（须非空且不含 "__"）`);
  }
}

/** MCP 工具名 → 注册表名（opencode McpCatalog.toolName 同构）。 */
export function mcpToolRegistryName(serverName: string, toolName: string): string {
  return `${serverName}__${toolName}`;
}

/**
 * 连接一个 MCP server 并把其工具注册进注册表：initialize 握手 → tools
 * 能力检测（无 tools 能力 → 零注册不报错——opencode getServerCapabilities
 * 检测同构）→ tools/list 全量 → 逐个映射注册。server 崩溃后已注册工具的
 * 调用经 client 的类型化失败落 isError 结果（不挂 loop）。
 */
export async function connectAndRegister(
  registry: ToolRegistry,
  config: McpServerConfig,
  options?: { requestTimeoutMs?: number },
): Promise<McpConnection> {
  validateServerName(config.name);
  const transport = createMcpStdioTransport(config.command, config.args ?? [], config.env);
  const client = new McpClient(
    transport,
    config.name,
    transport.onLine.bind(transport),
    transport.onFail.bind(transport),
  );
  const timeout = options?.requestTimeoutMs ?? config.timeoutMs;
  const capabilities =
    timeout !== undefined ? await client.initialize(timeout) : await client.initialize();
  if (!capabilities.tools) {
    return { client, registeredToolNames: [] };
  }
  const tools: McpToolInfo[] =
    timeout !== undefined ? await client.listTools(timeout) : await client.listTools();
  const registeredToolNames: string[] = [];
  for (const tool of tools) {
    const def = toToolDef(client, config.name, tool, options);
    registry.registerTool(def);
    registeredToolNames.push(def.name);
  }
  return { client, registeredToolNames };
}

/**
 * 连接校验探针（U17/T-P3-119）——launch 一次 initialize + tools/list 后
 * 立即关闭（不做工具注册，不持连接）：向导"测连接"的数据面。握手/列工具
 * 失败原样上抛（调用方转类型化校验回执——坏命令/无响应/无能力三态）。
 */
export async function probeServer(
  config: McpServerConfig,
  options?: { requestTimeoutMs?: number },
): Promise<{ protocolVersion: string; tools: McpToolInfo[] }> {
  validateServerName(config.name);
  const transport = createMcpStdioTransport(config.command, config.args ?? [], config.env);
  const client = new McpClient(
    transport,
    config.name,
    transport.onLine.bind(transport),
    transport.onFail.bind(transport),
  );
  const timeout = options?.requestTimeoutMs ?? config.timeoutMs;
  try {
    const capabilities =
      timeout !== undefined ? await client.initialize(timeout) : await client.initialize();
    const tools: McpToolInfo[] = capabilities.tools
      ? timeout !== undefined
        ? await client.listTools(timeout)
        : await client.listTools()
      : [];
    return { protocolVersion: capabilities.protocolVersion, tools };
  } finally {
    client.dispose();
  }
}

/** MCP 工具描述 → ToolDef（inputSchema 透传 + tools/call 执行体）。 */
export function toToolDef(
  client: McpClient,
  serverName: string,
  tool: McpToolInfo,
  options?: { requestTimeoutMs?: number },
): ToolDef {
  return {
    name: mcpToolRegistryName(serverName, tool.name),
    parameters:
      tool.inputSchema !== undefined && typeof tool.inputSchema === "object" && tool.inputSchema !== null
        ? (tool.inputSchema as JsonRecord)
        : undefined,
    // B2 描述面的 MCP 变体：描述随协议到达，内联进 def（description()
    // 优先读 descriptionText，不落 txt 文件）
    ...(tool.description !== undefined ? { descriptionText: tool.description } : {}),
    async execute(args) {
      // 协议面失败（超时/崩溃/错误帧）统一落 isError 结果——MCP server 的
      // 失联与调用失败都是"工具执行失败"语义，不作为基础设施崩溃上抛。
      try {
        const timeout = options?.requestTimeoutMs;
        const result =
          timeout !== undefined
            ? await client.callTool(tool.name, args as Record<string, unknown>, timeout)
            : await client.callTool(tool.name, args as Record<string, unknown>);
        return {
          content: result.content === "" ? "(no output)" : result.content,
          ...(result.isError ? { isError: true as const } : {}),
          meta: { mcpServer: serverName, mcpTool: tool.name },
        };
      } catch (e) {
        return {
          content: `MCP 工具调用失败：${(e as Error).message}`,
          isError: true,
          error: { name: "McpToolError", code: "MCP_CALL_FAILED" },
          meta: { mcpServer: serverName, mcpTool: tool.name },
        };
      }
    },
  };
}
