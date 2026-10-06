/**
 * 浏览器面板 CDP 通道发现（T-P3-174 调研报告方案 A 的接线胶水之一）：
 * 壳侧 browser_create 给面板 webview 配了专属 data directory（
 * <exeDir>/data/webview-panel）+ --remote-debugging-port=0——Chromium 把
 * 实际端口写进该目录的 DevToolsActivePort 文件（首行端口、次行调试 path）。
 * 本模块按同一约定发现端口并建 page 级 CDP 连接（面板的每个 webview 是
 * /json/list 里的一个 page target——target 重建断连是多 tab 既有边界，
 * 每次工具调用前重连/重取 target 是 zcode browserGuestManager 的同款应对）。
 *
 * 安全边界（调研报告 §4.4 记档）：CDP 端口无鉴权——专属 data directory
 * 把暴露面收窄到面板 target；工具面的每导航审批 + 域白名单在
 * scheduler/browser.ts（createBrowserTools）。
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { CdpConnection } from "./browser.js";

/** 发现错误码（类型化 fail-closed——面板缺席/端口文件缺失/无 page target）。 */
export const BROWSER_PANEL_NOT_FOUND = "BROWSER_PANEL_NOT_FOUND";

export class BrowserPanelNotFoundError extends Error {
  override readonly name = "BrowserPanelNotFoundError";
  readonly code = BROWSER_PANEL_NOT_FOUND;
  constructor(message: string) {
    super(message);
  }
}

/** 面板 data directory 的约定路径（壳 browser_create 写、本模块读——两端
 * 以 <exeDir>/data/webview-panel 对齐；portable 布局下 node.exe 与壳 exe
 * 同目录，dev 态壳不 spawn host = 文件自然缺席 → 工具不注册/类型化报错）。 */
export function panelDataDir(exeDir: string): string {
  return path.join(exeDir, "data", "webview-panel");
}

/**
 * 读 DevToolsActivePort 的实际端口（--remote-debugging-port=0 的随机端口
 * 发现面）。文件缺席/内容非端口 = 类型化报错（fail-closed）。
 */
export function panelDevToolsPort(exeDir: string): number {
  const file = path.join(panelDataDir(exeDir), "DevToolsActivePort");
  if (!existsSync(file)) {
    throw new BrowserPanelNotFoundError(
      "浏览器面板调试端口文件不存在（面板未创建或壳未启用 CDP 通道）——先在浏览器面板打开一个页面",
    );
  }
  const raw = readFileSync(file, "utf8");
  const port = Number.parseInt(raw.split("\n")[0]?.trim() ?? "", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new BrowserPanelNotFoundError(`DevToolsActivePort 内容非法：${JSON.stringify(raw.slice(0, 40))}`);
  }
  return port;
}

export interface PanelPageTarget {
  readonly id: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

/** 列 page targets（browser 端 /json/list——type=page 过滤）。 */
export async function listPanelPageTargets(
  exeDir: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PanelPageTarget[]> {
  const port = panelDevToolsPort(exeDir);
  const response = await fetchImpl(`http://127.0.0.1:${String(port)}/json/list`);
  if (!response.ok) {
    throw new BrowserPanelNotFoundError(`/json/list 返回 HTTP ${String(response.status)}`);
  }
  const entries = (await response.json()) as Array<Record<string, unknown>>;
  return entries
    .filter((e) => e["type"] === "page" && typeof e["webSocketDebuggerUrl"] === "string")
    .map((e) => ({
      id: String(e["id"] ?? ""),
      url: String(e["url"] ?? ""),
      webSocketDebuggerUrl: String(e["webSocketDebuggerUrl"]),
    }));
}

export interface PanelConnectOptions {
  /** CDP 往返 deadline（透传 CdpConnection——缺省 30s）。 */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** WebSocket 实现（ws 库形状——测试注入）；缺省 ws 库默认。 */
  WebSocketImpl?: typeof import("ws").WebSocket;
}

/**
 * 建面板 page 级 CDP 连接：取 page targets 的**最后一个**（新 tab 追加在
 * 列表尾——多 tab 场景天然偏向用户/agent 最新打开的 tab；单 tab 恒命中）。
 * 空列表 = 面板还没有可用页面，类型化报错。
 */
export async function connectPanelBrowser(
  exeDir: string,
  options: PanelConnectOptions = {},
): Promise<CdpConnection> {
  const targets = await listPanelPageTargets(exeDir, options.fetchImpl ?? fetch);
  const target = targets.at(-1);
  if (target === undefined) {
    throw new BrowserPanelNotFoundError("浏览器面板没有可用的 page target——先在面板里打开一个页面");
  }
  return new CdpConnection(
    target.webSocketDebuggerUrl,
    options.timeoutMs,
    options.WebSocketImpl,
  );
}
