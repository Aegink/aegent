/**
 * 浏览器面板 CDP 通道发现测试（C2 接线）——端口发现（DevToolsActivePort
 * 解析）与 page target 连接面在壳外可机验的部分；ws 往返本体由
 * browser.test.ts 的 CdpConnection 面覆盖，真机端到端随壳走查。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_PANEL_NOT_FOUND,
  connectPanelBrowser,
  listPanelPageTargets,
  panelDataDir,
  panelDevToolsPort,
} from "./browser-panel.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "aegent-browser-panel-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** 造一个"壳已创建面板"的 data directory（端口文件）。 */
function seedPanelDir(port: number): string {
  const dir = panelDataDir(tmp);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "DevToolsActivePort"), `${String(port)}\n/devtools/browser/guid`);
  return dir;
}

describe("C2 · 面板 CDP 端口发现（DevToolsActivePort）", () => {
  it("约定路径对齐：panelDataDir = <exeDir>/data/webview-panel（壳 browser_create 同值）", () => {
    expect(panelDataDir("F:/portable")).toBe(path.join("F:/portable", "data", "webview-panel"));
  });

  it("端口文件在位：读首行端口（随机端口零硬编码）", () => {
    seedPanelDir(41234);
    expect(panelDevToolsPort(tmp)).toBe(41234);
  });

  it("端口文件缺席：BROWSER_PANEL_NOT_FOUND 类型化报错（fail-closed——面板未创建）", () => {
    try {
      panelDevToolsPort(tmp);
      expect.unreachable("应抛 BrowserPanelNotFoundError");
    } catch (e) {
      expect((e as { code?: string }).code).toBe(BROWSER_PANEL_NOT_FOUND);
    }
  });

  it("端口文件内容非法（非整数端口）：类型化报错", () => {
    mkdirSync(panelDataDir(tmp), { recursive: true });
    writeFileSync(path.join(panelDataDir(tmp), "DevToolsActivePort"), "not-a-port\n/x");
    try {
      panelDevToolsPort(tmp);
      expect.unreachable("应抛 BrowserPanelNotFoundError");
    } catch (e) {
      expect((e as { code?: string }).code).toBe(BROWSER_PANEL_NOT_FOUND);
    }
  });
});

describe("C2 · page target 发现与连接", () => {
  it("/json/list 解析：type=page 过滤 + 取最后一个 target（多 tab 偏向最新）", async () => {
    seedPanelDir(41235);
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify([
          { id: "t0", type: "page", url: "https://a.example/", webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/t0" },
          { id: "t1", type: "iframe", url: "about:blank", webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/t1" },
          { id: "t2", type: "page", url: "https://b.example/", webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/t2" },
        ]),
        { status: 200 },
      ) as unknown as Response,
    );
    const targets = await listPanelPageTargets(tmp, fetchImpl as unknown as typeof fetch);
    expect(targets).toHaveLength(2);
    expect(targets.at(-1)?.id).toBe("t2");
    // connect 面：CdpConnection 注入 fake ws（不真连——只验证选中的 target 正确）
    const sent: string[] = [];
    class FakeWs {
      static OPEN = 1;
      readyState = 0;
      sent: string[] = [];
      constructor(url: string) {
        sent.push(url);
      }
      on() {}
      once(_e: string, cb: () => void) {
        queueMicrotask(cb); // open 即 resolve
      }
      send(_raw: string) {}
      close() {}
    }
    const conn = await connectPanelBrowser(tmp, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      WebSocketImpl: FakeWs as unknown as typeof import("ws").WebSocket,
    });
    expect(sent).toEqual(["ws://127.0.0.1:9223/devtools/page/t2"]);
    conn.close();
  });

  it("无 page target（列表空）：类型化报错", async () => {
    seedPanelDir(41236);
    const fetchImpl = vi.fn(async () => new Response("[]", { status: 200 }) as unknown as Response);
    await expect(
      connectPanelBrowser(tmp, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: BROWSER_PANEL_NOT_FOUND });
  });
});
