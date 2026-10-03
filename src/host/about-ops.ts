/**
 * 关于中心域 ops（T-P3-155——版本溯源/环境路径/更新检查/诊断文本）：
 * - about-info：build-info.json（构建期注入）+环境行+四路径+诊断文本
 *   （zcode about snapshot 字段集精简版——**不含凭据路径**，pi-desktop
 *   不收集凭证纪律）；
 * - check-update：GitHub Releases API + 8s 超时 + 软降级（codex updates.rs
 *   锚；便携版语义=UI 引导打开 Releases 页，下载安装归壳域记档）；
 * - open-path：目录/文件打开（三平台——日志中心/路径卡共用面）。
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions } from "./version-compare.js";
import { currentLogDir } from "./logging-ops.js";
import type { SettingsCall } from "./protocol-settings.js";
import type { SettingsGateway, TransferDeps } from "./settings-gateway-types.js";

const RELEASES_API = "https://api.github.com/repos/Aegink/aegent/releases/latest";
const RELEASES_PAGE = "https://github.com/Aegink/aegent/releases";
const UPDATE_TIMEOUT_MS = 8_000;

export interface BuildInfo {
  readonly version: string;
  readonly gitCommit: string;
  readonly buildTime: string;
}

/** 构建信息读取（dist/build-info.json——copy-assets 注入；缺省回退源码 package.json）。 */
export function readBuildInfo(distDir?: string): BuildInfo {
  // 查找链：bundle 布局（dirname=portable 根）→ 常规 dist（dirname/dist）→ 回退
  const self = path.dirname(fileURLToPath(import.meta.url));
  const candidates = distDir !== undefined
    ? [distDir]
    : [self, path.resolve(self, "..", "..")];
  for (const base of candidates) {
    try {
      const raw = JSON.parse(readFileSync(path.join(base, "build-info.json"), "utf8")) as Partial<BuildInfo>;
      return {
        version: typeof raw.version === "string" ? raw.version : "unknown",
        gitCommit: typeof raw.gitCommit === "string" ? raw.gitCommit : "unknown",
        buildTime: typeof raw.buildTime === "string" ? raw.buildTime : "unknown",
      };
    } catch {
      // 下一个候选
    }
  }
  // dev 源码直跑（无 dist）——回退 package.json（repoRoot = self 向上三级）
  try {
    const pkg = JSON.parse(readFileSync(path.resolve(self, "..", "..", "..", "package.json"), "utf8")) as { version?: string };
    return { version: pkg.version ?? "unknown", gitCommit: "dev", buildTime: "dev" };
  } catch {
    return { version: "unknown", gitCommit: "unknown", buildTime: "unknown" };
  }
}

// —— about 依赖投影（logDir 自日志通道池；workspaceRoot 经 TransferDeps 透传） ——

function aboutDeps(gateway: SettingsGateway): TransferDeps & { logDir: string } {
  const deps = gateway.transferDeps();
  return { ...deps, logDir: currentLogDir() };
}



/** 环境与路径聚合（B 域——zcode 字段集精简；不含凭据路径）。 */
export function aboutInfoOp(deps: TransferDeps & { logDir: string }): {
  build: BuildInfo;
  env: { platform: string; osRelease: string; arch: string; nodeVersion: string; memoryRssMb: number; uptimeMin: number };
  paths: { settings: string; logs: string; db: string; workspace: string };
  diagnosticsText: string;
} {
  const build = readBuildInfo();
  const env = {
    platform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    nodeVersion: process.version,
    memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    uptimeMin: Math.round(process.uptime() / 60),
  };
  const dbPath = deps.sessionDb !== undefined ? deps.sessionDb.db.name : "";
  const paths = {
    settings: deps.settingsPath,
    logs: deps.logDir,
    db: dbPath !== "" && dbPath !== ":memory:" ? dbPath : "",
    workspace: deps.workspaceRoot ?? "",
  };
  const diagnosticsText = [
    `aegent v${build.version}（${build.gitCommit} @ ${build.buildTime}）`,
    `平台：${env.platform} ${env.osRelease}（${env.arch}）· Node ${env.nodeVersion} · RSS ${env.memoryRssMb}MB · 运行 ${env.uptimeMin} 分钟`,
    `配置：${paths.settings}`,
    `日志：${paths.logs || "（未启用）"}`,
    `事件库：${paths.db || "（内存）"}`,
    ...(paths.workspace !== "" ? [`工作区：${paths.workspace}`] : []),
  ].join("\n");
  return { build, env, paths, diagnosticsText };
}

/** 更新检查（C1——GitHub Releases API；8s 超时软降级；比较自研轻量 semver）。 */
export async function checkUpdateOp(currentVersion: string): Promise<{
  status: "up-to-date" | "available" | "error";
  current: string;
  latest?: string;
  notes?: string;
  url?: string;
  reason?: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_TIMEOUT_MS);
  try {
    const res = await fetch(RELEASES_API, {
      signal: controller.signal,
      headers: { "User-Agent": "aegent-about-center", Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      return { status: "error", current: currentVersion, reason: `GitHub 返回 ${String(res.status)}` };
    }
    const body = (await res.json()) as { tag_name?: string; name?: string; body?: string; html_url?: string };
    const tag = typeof body.tag_name === "string" ? body.tag_name.replace(/^v/, "") : "";
    if (tag === "" || !/^\d/.test(tag)) {
      return { status: "error", current: currentVersion, reason: "release tag 形状不符" };
    }
    const notes = typeof body.body === "string" && body.body.trim() !== "" ? body.body.trim().slice(0, 500) : undefined;
    const url = typeof body.html_url === "string" && body.html_url !== "" ? body.html_url : RELEASES_PAGE;
    const newer = compareVersions(tag, currentVersion) > 0;
    return {
      status: newer ? "available" : "up-to-date",
      current: currentVersion,
      latest: tag,
      ...(notes !== undefined ? { notes } : {}),
      url,
    };
  } catch (e) {
    return {
      status: "error",
      current: currentVersion,
      reason: e instanceof Error && e.name === "AbortError" ? "检查超时（8s）" : e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 路径打开（三平台——B2 路径卡/日志中心共用语义；存在性校验先行）。 */
export function openPathOp(target: string): { done: true } {
  if (target.trim() === "" || !existsSync(target)) {
    const error = new Error(`路径不存在：${path.basename(target)}`);
    (error as unknown as { code: string }).code = "ABOUT_PATH_NOT_FOUND";
    throw error;
  }
  const abs = path.resolve(target);
  if (process.platform === "win32") {
    spawn("explorer", [abs], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [abs], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [abs], { detached: true, stdio: "ignore" }).unref();
  }
  return { done: true };
}

// —— 分发（bridge 零增量串联面——logging fallback 之后第三级） ——

export function tryAboutSettingsOp(gateway: SettingsGateway, call: SettingsCall): unknown {
  if (call.op !== "about-info" && call.op !== "check-update" && call.op !== "open-path") {
    return undefined;
  }
  const deps = aboutDeps(gateway);
  switch (call.op) {
    case "about-info":
      return aboutInfoOp(deps);
    case "check-update":
      return checkUpdateOp(readBuildInfo().version);
    case "open-path":
      return openPathOp(call.path!);
    default:
      return undefined;
  }
}
