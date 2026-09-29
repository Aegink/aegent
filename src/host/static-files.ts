/**
 * host HTTP 静态资产服务（行数纪律拆分自 server.ts）。路径穿越防呆：
 * resolve 后必须落在 uiDir 内；GET/HEAD 之外 405。MIME 表覆盖 ui/ 资产
 * 的最小集（含 vendor 的 .js/.md 等）。
 */

import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

/** 静态资产扩展名 → content-type（ui/ 资产的最小表）。 */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** 静态资产服务（路径穿越防呆：resolve 后必须落在 uiDir 内）。 */
export function serveStatic(uiDir: string, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  const root = path.resolve(uiDir);
  const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) && file !== root) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error !== null) {
      res.writeHead(404).end("not found");
      return;
    }
    const type = CONTENT_TYPES[path.extname(file).toLowerCase()];
    res.writeHead(200, {
      "content-type": type ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(data);
  });
}
