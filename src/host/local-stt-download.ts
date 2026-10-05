/**
 * 本地 SenseVoice 转写——模型下载器（T-P3-174 批次 6 G1；dsh·runtime.ts
 * downloadAsset 行为锚）：.part 临时文件（flags:"wx"）流式边下边校验
 * （字节计数 + sha256 双轨，超量即断），完整后原子 rename 发布；已有缓存
 * size+sha256 匹配直接短路复用。进度经回调上报（op 层节流落内存进度表，
 * UI 轮询 stt-local-status）。
 */

import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import {
  STT_MODEL_ASSETS,
  STT_MODEL_ASSET_IDS,
  sttModelAssetPath,
  sttModelAssetUrl,
  sttModelRoot,
  verifyAssetFile,
  type SttModelAssetId,
} from "./local-stt-assets.js";

export interface SttDownloadProgress {
  asset: SttModelAssetId;
  completedBytes: number;
  totalBytes: number;
}

export type SttDownloadPhase =
  | { phase: "idle" }
  | { phase: "verifying"; asset: SttModelAssetId }
  | { phase: "downloading"; asset: SttModelAssetId; completedBytes: number; totalBytes: number }
  | { phase: "done" }
  | { phase: "failed"; asset: SttModelAssetId; message: string };

/** 下载会话状态（host 内存面——op 轮询读；进程重启即 idle 不持久）。 */
export interface SttDownloadState {
  phase: SttDownloadPhase;
  /** 下载中断言（重试/状态页展示）。 */
  lastError?: string;
}

const state: SttDownloadState = { phase: { phase: "idle" } };

export function sttDownloadState(): Readonly<SttDownloadState> {
  return state;
}

function setPhase(phase: SttDownloadPhase, lastError?: string): void {
  state.phase = phase;
  if (lastError !== undefined) state.lastError = lastError;
  else if (phase.phase === "done") state.lastError = undefined;
}

/**
 * 全量就绪检查（三文件逐一 size+sha256——已有缓存复用与下载后验共用）。
 */
export async function sttModelsReady(root?: string): Promise<{
  ready: boolean;
  files: { id: SttModelAssetId; name: string; bytes: number; verified: boolean; reason?: string }[];
}> {
  const files: { id: SttModelAssetId; name: string; bytes: number; verified: boolean; reason?: string }[] = [];
  let ready = true;
  for (const id of STT_MODEL_ASSET_IDS) {
    const asset = STT_MODEL_ASSETS[id];
    const p = sttModelAssetPath(id, root);
    const result = await verifyAssetFile(p, asset);
    let bytes = 0;
    try {
      bytes = statSync(p).size;
    } catch {
      /* 缺文件 bytes=0 */
    }
    files.push({ id, name: asset.name, bytes, verified: result.ok, ...(result.ok ? {} : { reason: result.reason }) });
    if (!result.ok) ready = false;
  }
  return { ready, files };
}

/** 单资产下载（调用方保证串行——sttDownloadAll 内逐个）。 */
async function downloadAsset(
  id: SttModelAssetId,
  root: string,
  origin: string,
  signal: AbortSignal,
): Promise<void> {
  const asset = STT_MODEL_ASSETS[id];
  const dest = sttModelAssetPath(id, root);
  // 缓存短路（既有完整文件不重下）
  setPhase({ phase: "verifying", asset: id });
  const cached = await verifyAssetFile(dest, asset);
  if (cached.ok) return;
  mkdirSync(root, { recursive: true });
  const partial = join(root, `${asset.name}.${randomUUID()}.part`);
  setPhase({ phase: "downloading", asset: id, completedBytes: 0, totalBytes: asset.bytes });
  try {
    const resp = await fetch(sttModelAssetUrl(id, origin), { signal, redirect: "follow" });
    if (!resp.ok || resp.body === null) {
      throw new Error(`HTTP ${resp.status}（${sttModelAssetUrl(id, origin)}）`);
    }
    const digest = createHash("sha256");
    let completed = 0;
    const file = createWriteStream(partial, { flags: "wx", mode: 0o600 });
    const reader = resp.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      completed += value.byteLength;
      if (completed > asset.bytes) {
        throw new Error(`下载超量（${completed} > ${asset.bytes}）——源损坏`);
      }
      digest.update(value);
      if (!file.write(value)) {
        await new Promise<void>((resolve) => file.once("drain", resolve));
      }
      if (state.phase.phase === "downloading" && state.phase.asset === id) {
        setPhase({ phase: "downloading", asset: id, completedBytes: completed, totalBytes: asset.bytes });
      }
    }
    file.end();
    await new Promise<void>((resolve, reject) => {
      file.on("finish", resolve);
      file.on("error", reject);
    });
    if (completed !== asset.bytes || digest.digest("hex") !== asset.sha256) {
      throw new Error(`完整性校验失败（${completed} 字节，sha256 不符）——拒绝发布`);
    }
    renameSync(partial, dest); // 原子发布
  } finally {
    try {
      rmSync(partial, { force: true }); // partial 强制清理（成功后已 rename 走，失败路径清残留）
    } catch {
      /* Windows 句柄竞态——下轮下载 wx 再造 */
    }
  }
}

/** 下载队列互斥（重复触发直接返回当前状态——UI 防连点）。 */
let running = false;

/**
 * 全量下载入口（模型+tokens+VAD 逐个串行；任一失败中断并落 failed——
 * 重试从缺的文件续，已验证文件被缓存短路）。host 侧 fire-and-forget，
 * 进度经 sttDownloadState() 轮询。
 */
export async function sttDownloadAll(
  options: { origin?: string; root?: string; signal?: AbortSignal } = {},
): Promise<{ started: boolean }> {
  if (running) return { started: false };
  running = true;
  const root = options.root ?? sttModelRoot();
  const signal = options.signal ?? new AbortController().signal;
  void (async () => {
    try {
      for (const id of STT_MODEL_ASSET_IDS) {
        await downloadAsset(id, root, options.origin ?? (await import("./local-stt-assets.js")).STT_MODEL_ORIGIN, signal);
      }
      setPhase({ phase: "done" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPhase({ phase: "failed", asset: "model", message });
    } finally {
      running = false;
    }
  })();
  return { started: true };
}

/** 部分文件名（basename 供展示）。 */
export function sttPartialName(name: string): string {
  return basename(name);
}
