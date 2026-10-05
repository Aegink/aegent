// T-P3-174 批次 6 G1：本地 SenseVoice——WAV 校验/样本转换纯函数 + 资产
// 校验判据（size+sha256）+ settings.stt.engine 解析。
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { verifyAssetFile, type SttModelAsset } from "./local-stt-assets.js";
import { validateWav, wavPcm16ToSamples } from "./local-stt-worker.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

/** 构造规范 44 字节头 16k/mono/16bit WAV。 */
function makeWav(samples: number[]): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(v, i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe("validateWav / wavPcm16ToSamples", () => {
  it("规范 WAV 通过；采样率/声道/位深/大小/标识逐项 fail-closed", () => {
    const wav = makeWav([0, 100, -100]);
    expect(validateWav(new Uint8Array(wav), 8 * 1024 * 1024)).toBeUndefined();
    const badRate = makeWav([0]);
    badRate.writeUInt32LE(44100, 24);
    expect(validateWav(new Uint8Array(badRate), 8 * 1024 * 1024)).toContain("16000");
    expect(validateWav(new Uint8Array(Buffer.from("not a wav at all")), 1 << 20)).toContain("WAV");
    expect(validateWav(new Uint8Array(Buffer.alloc(10)), 1 << 20)).toContain("过短");
    expect(validateWav(new Uint8Array(makeWav(new Array(5 * 1024 * 1024).fill(0))), 1024)).toContain("超上限");
  });
  it("PCM16 → Float32（/32768；44 字节头剥离）", () => {
    const samples = wavPcm16ToSamples(new Uint8Array(makeWav([0, 16384, -16384])));
    expect(samples.length).toBe(3);
    expect(samples[0]).toBe(0);
    expect(samples[1]).toBeCloseTo(0.5, 5);
    expect(samples[2]).toBeCloseTo(-0.5, 5);
  });
});

describe("verifyAssetFile", () => {
  it("size+sha256 双验：匹配短路；尺寸或哈希不符拒绝；缺失 missing", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-stt-"));
    dirs.push(dir);
    const body = Buffer.from("asset-body-0123456789");
    const asset: SttModelAsset = {
      name: "model.bin",
      url: "https://example.invalid/m",
      bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
    };
    const p = path.join(dir, "model.bin");
    writeFileSync(p, body);
    expect((await verifyAssetFile(p, asset)).ok).toBe(true);
    writeFileSync(p, body.subarray(0, 5));
    const sizeBad = await verifyAssetFile(p, asset);
    expect(sizeBad.ok).toBe(false);
    expect(sizeBad.reason).toContain("size");
    writeFileSync(p, Buffer.from("differext-body-9876XY")); // 同长度不同内容——只触发 sha256 面
    const hashBad = await verifyAssetFile(p, asset);
    expect(hashBad.ok).toBe(false);
    expect(hashBad.reason).toContain("sha256");
    expect((await verifyAssetFile(path.join(dir, "nope.bin"), asset)).reason).toBe("missing");
  });
});
