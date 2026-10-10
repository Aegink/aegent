/**
 * lsp 工具（B8b/T-P1-60）——语言服务查询面。9 操作闭集与 1-based 行列
 * 换算取 opencode lsp.ts（:11-21 operations / :64 position 换算 /
 * :77-78 无 server 类型化错误）；权限/取消与内建工具同轨（策略链
 * toolCall 点位在位——lsp 是只读类工具）。
 *
 * server 解析经注入的 clientFor（按文件路径返回已初始化的 LspClient）——
 * 装配面用 createLspClientFor（按扩展名映射 server 配置、按需 spawn 复用），
 * 测试注入内存桩。无 server / 未初始化 / server 崩溃都落类型化错误不挂 loop。
 */

import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { PathGuard, PathGuardError } from "../../../sandbox/path-guard.js";
import type { LspClient } from "../../../lsp/client.js";
import type { ToolExecutionResult } from "../../loop.js";
import type { ToolDef } from "../registry.js";
import { toolError } from "./util.js";

/** LSP 操作闭集（opencode operations 同构，冻结只追加）。 */
export const LSP_OPERATIONS = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const;

export type LspOperation = (typeof LSP_OPERATIONS)[number];

/** 位置类操作（带 line/character）；documentSymbol 只带文件、workspaceSymbol 只带 query。 */
const POSITION_OPS: ReadonlySet<LspOperation> = new Set([
  "goToDefinition",
  "findReferences",
  "hover",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
]);

export interface LspArgs {
  operation: string;
  filePath: string;
  /** 1-based（opencode 同款）——请求前换算为 LSP 0-based。 */
  line?: number;
  character?: number;
  query?: string;
}

/** server 解析面类型（装配与测试共用——按绝对文件路径返回客户端）。 */
export type LspClientFor = (filePath: string) => LspClient | undefined;

/** 换算到 LSP 的 0-based position（opencode :64 同构）。 */
export function toLspPosition(line: number, character: number): { line: number; character: number } {
  return { line: line - 1, character: character - 1 };
}

/** 单操作的 LSP method 与 params 构造（错误 = 参数与操作不匹配）。 */
export function buildLspRequest(
  operation: LspOperation,
  uri: string,
  position: { line: number; character: number },
  query: string | undefined,
): { method: string; params: Record<string, unknown> } {
  const textDocument = { uri };
  switch (operation) {
    case "goToDefinition":
      return { method: "textDocument/definition", params: { textDocument, position } };
    case "findReferences":
      return {
        method: "textDocument/references",
        params: { textDocument, position, context: { includeDeclaration: true } },
      };
    case "hover":
      return { method: "textDocument/hover", params: { textDocument, position } };
    case "documentSymbol":
      return { method: "textDocument/documentSymbol", params: { textDocument } };
    case "workspaceSymbol":
      return { method: "workspace/symbol", params: { query: query ?? "" } };
    case "goToImplementation":
      return { method: "textDocument/implementation", params: { textDocument, position } };
    case "prepareCallHierarchy":
      return { method: "textDocument/prepareCallHierarchy", params: { textDocument, position } };
    case "incomingCalls":
      return { method: "callHierarchy/incomingCalls", params: { item: { ...position, uri } } };
    case "outgoingCalls":
      return { method: "callHierarchy/outgoingCalls", params: { item: { ...position, uri } } };
  }
}

export function createLspTool(options: {
  pathGuard: PathGuard;
  /** 按文件路径解析 LSP 客户端；缺省 undefined = 无 server（全部操作类型化报错）。 */
  clientFor?: (filePath: string) => LspClient | undefined;
}): ToolDef {
  const guard = options.pathGuard;
  return {
    name: "lsp",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: [...LSP_OPERATIONS] },
        filePath: { type: "string", description: "Absolute or workspace-relative file path" },
        line: { type: "number", description: "1-based line (position operations)" },
        character: { type: "number", description: "1-based character (position operations)" },
        query: { type: "string", description: "Search query for workspaceSymbol" },
      },
      required: ["operation", "filePath"],
    },
    async execute(args): Promise<ToolExecutionResult> {
      const { operation, filePath, line, character, query } = args as Partial<LspArgs>;
      if (
        typeof operation !== "string" ||
        !(LSP_OPERATIONS as readonly string[]).includes(operation)
      ) {
        return toolError(
          "LspError",
          "INVALID_ARGUMENTS",
          `lsp 需要 operation（${LSP_OPERATIONS.join(" / ")} 之一）`,
        );
      }
      if (typeof filePath !== "string" || filePath === "") {
        return toolError("LspError", "INVALID_ARGUMENTS", "lsp 需要 filePath（非空字符串）");
      }
      const op = operation as LspOperation;
      const needsPosition = POSITION_OPS.has(op);
      if (needsPosition && (typeof line !== "number" || typeof character !== "number")) {
        return toolError(
          "LspError",
          "INVALID_ARGUMENTS",
          `操作 ${operation} 需要 1-based 的 line 与 character`,
        );
      }
      const abs = path.resolve(filePath);
      try {
        // 只读面（读边界断言 + didOpen 前读入文件内容走守卫唯一入口）
        await guard.assertReadable(abs);
      } catch (e) {
        if (e instanceof PathGuardError) {
          return toolError("LspError", e.code, e.message);
        }
        throw e;
      }
      const client = options.clientFor?.(abs);
      if (client === undefined) {
        return toolError(
          "LspError",
          "LSP_NO_SERVER",
          `No LSP server available for this file type: ${filePath}（装配未配置该语言的 server）`,
        );
      }
      try {
        // 按需初始化（opencode touchFile 的 ready 语义）：首个请求前确保
        // 握手完成；rootUri 取文件所在目录（单 server 最小面——LIMITATIONS）
        if (!client.isInitialized) {
          await client.initialize(pathToFileURL(path.dirname(abs)).href);
        }
        const uri = pathToFileURL(abs).href;
        const position = toLspPosition(line ?? 1, character ?? 1);
        const { method, params } = buildLspRequest(op, uri, position, query);
        const result = await client.request(method, params);
        const empty =
          result === null ||
          result === undefined ||
          (Array.isArray(result) && result.length === 0);
        if (empty) {
          return { content: `No results found for ${operation}` };
        }
        return { content: JSON.stringify(result, null, 2) };
      } catch (e) {
        return toolError("LspError", "LSP_REQUEST_FAILED", (e as Error).message);
      }
    },
  };
}
