/**
 * 本地 SenseVoice 转写——host 侧服务（T-P3-174 批次 6 G1）：worker 子进程
 * 生命周期（spawn/readiness 行/串行请求队列/空闲回收/崩溃摘除）+ 引擎路由
 * （settings.stt.engine === "local" 时 stt-transcribe 走本地，否则云端零
 * 变化）。模型未就绪 = 类型化错误引导下载（fail-closed 不静默降级云端——
 * 用户显式选了本地引擎）。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { sttModelAssetPath } from "./local-stt-assets.js";
import { sttDownloadState, sttModelsReady } from "./local-stt-download.js";

export interface LocalSttStatus {
  /** 三文件齐且 sha256 双验通过。 */
  installed: boolean;
  files: { id: string; name: string; bytes: number; verified: boolean; reason?: string }[];
  /** worker 活着且 readiness 已收。 */
  engineReady: boolean;
}

/** worker 路径：便携布局 = host.cjs 同目录的 local-stt-worker.cjs（bundle
 * 面）；源码/dist 运行 = 本目录 local-stt-worker.js。 */
function workerEntryPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundled = path.join(here, "local-stt-worker.cjs");
  if (existsSync(bundled)) return bundled;
  return path.join(here, "local-stt-worker.js");
}

let worker: ChildProcess | null = null;
let ready = false;
let buffer = "";
const pending = new Map<string, (r: { ok: boolean; text?: string; code?: string; message?: string }) => void>();
let seq = 0;
/** 空闲回收定时（30 分钟无请求杀 worker——冷加载代价下轮请求重付）。 */
let idleTimer: NodeJS.Timeout | null = null;

function killWorker(): void {
  if (worker !== null) {
    try {
      worker.kill();
    } catch {
      /* 退出竞态 */
    }
    worker = null;
  }
  ready = false;
  buffer = "";
  for (const [, p] of pending) p({ ok: false, code: "WORKER_GONE", message: "转写进程已退出" });
  pending.clear();
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function armIdleTimer(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => killWorker(), 30 * 60_000);
  idleTimer.unref?.();
}

async function ensureWorker(threads: number): Promise<void> {
  if (worker !== null && ready) return;
  killWorker();
  const entry = workerEntryPath();
  if (!existsSync(entry)) {
    throw new Error(`本地转写 worker 未随包（${entry}）——便携包布局缺失`);
  }
  const modelPath = sttModelAssetPath("model");
  const tokensPath = sttModelAssetPath("tokens");
  const vadPath = sttModelAssetPath("vad");
  worker = spawn(
    process.execPath,
    [entry, modelPath, tokensPath, vadPath, String(threads)],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  worker.stderr?.setMaxListeners(0);
  worker.on("exit", () => {
    const wasReady = ready;
    worker = null;
    ready = false;
    for (const [, p] of pending) p({ ok: false, code: "WORKER_GONE", message: "转写进程已退出" });
    pending.clear();
    if (wasReady) {
      // 意外崩溃（原生段错误）——下次请求重新拉起
    }
  });
  // readiness 行（{"ready":true}）
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("转写进程启动超时（模型加载 >60s）")), 60_000);
    const onLine = (line: string): void => {
      try {
        const m = JSON.parse(line) as { ready?: boolean };
        if (m.ready === true) {
          clearTimeout(timeout);
          ready = true;
          resolve();
        }
      } catch {
        /* 非 JSON 行忽略 */
      }
    };
    let buf = "";
    worker!.stdout!.setEncoding("utf8");
    worker!.stdout!.on("data", (chunk: string) => {
      buf += chunk;
      for (;;) {
        const nl = buf.indexOf("\n");
        if (nl < 0) break;
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!ready) onLine(line);
        else {
          // 请求响应分发
          try {
            const m = JSON.parse(line) as { id?: string };
            if (m.id !== undefined && pending.has(m.id)) {
              const resolveReq = pending.get(m.id)!;
              pending.delete(m.id);
              resolveReq(m as { ok: boolean; text?: string; code?: string; message?: string });
            }
          } catch {
            /* 坏行忽略 */
          }
        }
      }
    });
    worker!.on("exit", () => {
      clearTimeout(timeout);
      if (!ready) reject(new Error("转写进程启动即退出（原生件缺失或模型损坏）"));
    });
  });
}

/** 本地转写（并发上限 4 的请求队列；队列满 = 类型化拒绝）。 */
export async function localTranscribe(
  audio: Uint8Array,
  options: { language?: string; threads?: number } = {},
): Promise<{ ok: boolean; text?: string; code?: string; message?: string }> {
  const probe = await sttModelsReady();
  if (!probe.ready) {
    return {
      ok: false,
      code: "STT_LOCAL_NOT_INSTALLED",
      message: "本地转写模型未就绪——设置 → 语音 → 本地转写页下载（约 230MB，首次一次性）",
    };
  }
  await ensureWorker(options.threads ?? 2);
  if (pending.size >= 4) {
    return { ok: false, code: "STT_LOCAL_BUSY", message: "转写队列满（4）——请稍候再试" };
  }
  const id = `r${++seq}`;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    const line = `${JSON.stringify({
      id,
      audioBase64: Buffer.from(audio).toString("base64"),
      ...(options.language !== undefined && options.language !== "" ? { language: options.language } : {}),
    })}\n`;
    worker!.stdin!.write(line);
    armIdleTimer();
  });
}

/** 状态查询（op stt-local-status 消费面）。 */
export async function localSttStatus(): Promise<LocalSttStatus & { downloading?: object; lastError?: string }> {
  const probe = await sttModelsReady();
  const dl = sttDownloadState();
  return {
    installed: probe.ready,
    files: probe.files,
    engineReady: ready && worker !== null,
    ...(dl.phase.phase !== "idle" ? { downloading: dl.phase } : {}),
    ...(dl.lastError !== undefined ? { lastError: dl.lastError } : {}),
  };
}

/** dispose（host 关停面）。 */
export function disposeLocalStt(): void {
  killWorker();
}
