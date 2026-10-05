/**
 * 本地 SenseVoice 转写——模型资产锁（T-P3-174 批次 6 G1；dsh·speech-to-text-
 * sensevoice 的 runtime/assets.json 行为锚：revision-pinned URL + bytes +
 * sha256 三元组锁定上游公开资产，镜像替换只换 origin 不动路径）。
 *
 * 落点 = ~/.aegent/models/sensevoice/（用户数据目录随 AEGENT_HOME 走）；三
 * 文件齐 + 尺寸/哈希双验 = 就绪。int8 优先（228MB 首用下载——dsh Config
 * precision 缺省同款；fp32 894MB 不提供下载面）。
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** 单个模型资产的锁定事实（URL/尺寸/sha256——上游 revision 固定）。 */
export interface SttModelAsset {
  name: string;
  url: string;
  bytes: number;
  sha256: string;
}

/** 主页（huggingface.co；下载时可经 modelOrigin 换镜像只替 origin）。 */
export const STT_MODEL_ORIGIN = "https://huggingface.co";
const SENSEVOICE_REPO = "/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07";
const VAD_REPO = "/csukuangfj/vad/resolve/fba88cd2e921609e7675c3aaf51e0b9b295da4bc";

export const STT_MODEL_ASSETS: Record<"model" | "tokens" | "vad", SttModelAsset> = {
  model: {
    name: "model.int8.onnx",
    url: `${STT_MODEL_ORIGIN}${SENSEVOICE_REPO}/model.int8.onnx`,
    bytes: 239_233_841,
    sha256: "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
  },
  tokens: {
    name: "tokens.txt",
    url: `${STT_MODEL_ORIGIN}${SENSEVOICE_REPO}/tokens.txt`,
    bytes: 315_894,
    sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
  },
  vad: {
    name: "silero_vad.onnx",
    url: `${STT_MODEL_ORIGIN}${VAD_REPO}/silero_vad.onnx`,
    bytes: 1_807_522,
    sha256: "a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28",
  },
};

export const STT_MODEL_ASSET_IDS = ["model", "tokens", "vad"] as const;
export type SttModelAssetId = (typeof STT_MODEL_ASSET_IDS)[number];

/** 模型根目录（AEGENT_HOME 覆盖——多档隔离与走查隔离同语义）。 */
export function sttModelRoot(homeDir: string = process.env["AEGENT_HOME"] ?? homedir()): string {
  return path.join(homeDir, ".aegent", "models", "sensevoice");
}

export function sttModelAssetPath(id: SttModelAssetId, root: string = sttModelRoot()): string {
  return path.join(root, STT_MODEL_ASSETS[id].name);
}

/** 镜像 URL（modelOrigin 只替 origin 保留 pinned path——dsh runtime.ts:159-163 同语义）。 */
export function sttModelAssetUrl(id: SttModelAssetId, origin: string = STT_MODEL_ORIGIN): string {
  const u = new URL(STT_MODEL_ASSETS[id].url);
  return `${origin.replace(/\/$/, "")}${u.pathname}`;
}

/** 单文件校验：size + 流式 sha256 双验（下载后与既有缓存共用一个判据）。 */
export async function verifyAssetFile(
  filePath: string,
  asset: SttModelAsset,
): Promise<{ ok: boolean; reason?: string }> {
  const { statSync } = await import("node:fs");
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return { ok: false, reason: "missing" };
  }
  if (stat.size !== asset.bytes) {
    return { ok: false, reason: `size mismatch（${stat.size} ≠ ${asset.bytes}）` };
  }
  return new Promise((resolve) => {
    const digest = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("end", () => {
      const hex = digest.digest("hex");
      resolve(hex === asset.sha256 ? { ok: true } : { ok: false, reason: "sha256 mismatch" });
    });
    stream.on("error", (e) => resolve({ ok: false, reason: e.message }));
  });
}
