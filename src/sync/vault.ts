/**
 * 配置同步加密 vault（N9/T-P1-118）——"里面有 API key，加密不是可选项"
 * （Q20）。形状取 pi-desktop·config_sync/crypto.rs：**数据密钥随机生成、
 * 口令 KDF 后包裹数据密钥**（rewrap = 换口令不重加密数据密文——pi 同构）
 * + vault header 字段面 + 对象级独立 nonce 加解密。
 *
 * **KDF 用 scrypt 替代 Argon2id**（记档）：argon2 无 Node 原生实现、引 npm
 * 原生依赖违反依赖纪律；scrypt 是 Node 内置的内存难解型 KDF。`checkedKdf`
 * 纪律照搬——"an attacker-controlled remote header cannot turn unlocking
 * into an unbounded memory or CPU allocation"：参数有界，越界拒绝。
 *
 * 与 sandbox/dpapi/secure-config 分域记档：静态安全配置（本机 DPAPI）与
 * 跨设备同步（口令 vault）是两套加密，不互通不互替。
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
export const VAULT_FORMAT = "aegent-sync-vault";
export const VAULT_VERSION = 1;

// scrypt 参数有界（防 DoS——攻击者控制的 header 不能引发无界内存/CPU）。
const MIN_N = 16384; // 2^14
const MAX_N = 1 << 20; // 2^20
const MIN_R = 8;
const MAX_R = 64;
const MIN_P = 1;
const MAX_P = 8;

export interface VaultKdf {
  algorithm: "scrypt";
  N: number;
  r: number;
  p: number;
  /** base64 盐。 */
  salt: string;
}

export interface VaultHeader {
  format: string;
  version: number;
  vaultId: string;
  cipher: "aes-256-gcm";
  kdf: VaultKdf;
  /** 包裹数据密钥的 GCM nonce（base64）。 */
  wrapNonce: string;
  /** 被口令派生密钥包裹的数据密钥（base64）。 */
  wrappedKey: string;
}

export class VaultError extends Error {
  constructor(
    readonly code: "VAULT_AUTH_FAILED" | "VAULT_KDF_OUT_OF_BOUNDS" | "VAULT_FORMAT_UNSUPPORTED" | "VAULT_DECRYPT_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

/** KDF 参数有界校验（checked_kdf 同款）——越界类型化拒绝。 */
export function checkedKdf(kdf: VaultKdf): void {
  if (kdf.algorithm !== "scrypt") {
    throw new VaultError("VAULT_KDF_OUT_OF_BOUNDS", `KDF 只支持 scrypt，收到：${kdf.algorithm}`);
  }
  if (
    kdf.N < MIN_N ||
    kdf.N > MAX_N ||
    kdf.r < MIN_R ||
    kdf.r > MAX_R ||
    kdf.p < MIN_P ||
    kdf.p > MAX_P
  ) {
    throw new VaultError(
      "VAULT_KDF_OUT_OF_BOUNDS",
      `KDF 参数越界（N∈[${MIN_N},${MAX_N}] r∈[${MIN_R},${MAX_R}] p∈[${MIN_P},${MAX_P}]）——攻击者控制的 header 不能引发无界资源`,
    );
  }
}

function deriveKey(passphrase: string, kdf: VaultKdf): Buffer {
  checkedKdf(kdf);
  return scryptSync(passphrase, Buffer.from(kdf.salt, "base64"), KEY_BYTES, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
  });
}

function defaultKdf(): VaultKdf {
  return { algorithm: "scrypt", N: 16384, r: 8, p: 1, salt: randomBytes(16).toString("base64") };
}

/** 创建 vault：随机数据密钥 + 口令派生密钥包裹（GCM 认证加密）。 */
export function createVault(passphrase: string): { header: VaultHeader; vaultKey: Buffer } {
  const kdf = defaultKdf();
  const vaultKey = randomBytes(KEY_BYTES);
  const wrapNonce = randomBytes(NONCE_BYTES);
  const kek = deriveKey(passphrase, kdf);
  const cipher = createCipheriv("aes-256-gcm", kek, wrapNonce);
  const wrapped = Buffer.concat([cipher.update(vaultKey), cipher.final(), cipher.getAuthTag()]);
  return {
    header: {
      format: VAULT_FORMAT,
      version: VAULT_VERSION,
      vaultId: randomBytes(8).toString("hex"),
      cipher: "aes-256-gcm",
      kdf,
      wrapNonce: wrapNonce.toString("base64"),
      wrappedKey: wrapped.toString("base64"),
    },
    vaultKey,
  };
}

/** 解锁 vault：口令派生密钥解包裹（GCM 认证失败 = 口令错 → 类型化拒绝）。 */
export function unlockVault(header: VaultHeader, passphrase: string): Buffer {
  if (header.format !== VAULT_FORMAT || header.version !== VAULT_VERSION) {
    throw new VaultError(
      "VAULT_FORMAT_UNSUPPORTED",
      `vault 格式不支持：${header.format}@${header.version}`,
    );
  }
  if (header.cipher !== "aes-256-gcm") {
    throw new VaultError("VAULT_FORMAT_UNSUPPORTED", `cipher 不支持：${header.cipher}`);
  }
  const kek = deriveKey(passphrase, header.kdf);
  const wrapped = Buffer.from(header.wrappedKey, "base64");
  const nonce = Buffer.from(header.wrapNonce, "base64");
  const tag = wrapped.subarray(wrapped.length - 16);
  const body = wrapped.subarray(0, wrapped.length - 16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", kek, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new VaultError("VAULT_AUTH_FAILED", "vault 解锁失败：口令错误或数据被篡改（GCM 认证）");
  }
}

/** 换口令不重加密数据密文（rewrap——数据密钥重新包裹）。 */
export function rewrapVault(
  header: VaultHeader,
  vaultKey: Buffer,
  newPassphrase: string,
): VaultHeader {
  const kdf = defaultKdf();
  const wrapNonce = randomBytes(NONCE_BYTES);
  const kek = deriveKey(newPassphrase, kdf);
  const cipher = createCipheriv("aes-256-gcm", kek, wrapNonce);
  const wrapped = Buffer.concat([cipher.update(vaultKey), cipher.final(), cipher.getAuthTag()]);
  return {
    ...header,
    vaultId: header.vaultId, // 数据域身份不变（rewrap 只换口令）
    kdf,
    wrapNonce: wrapNonce.toString("base64"),
    wrappedKey: wrapped.toString("base64"),
  };
}

/** 对象级加密：独立 nonce + GCM 认证（base64(nonce+tag+ct)）。 */
export function encryptObject(vaultKey: Buffer, value: unknown): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", vaultKey, nonce);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const sealed = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([nonce, sealed]).toString("base64");
}

/** 对象级解密（被篡改 → 类型化拒绝）。 */
export function decryptObject<T>(vaultKey: Buffer, blob: string): T {
  const raw = Buffer.from(blob, "base64");
  const nonce = raw.subarray(0, NONCE_BYTES);
  const tag = raw.subarray(raw.length - 16);
  const body = raw.subarray(NONCE_BYTES, raw.length - 16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", vaultKey, nonce);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")) as T;
  } catch {
    throw new VaultError("VAULT_DECRYPT_FAILED", "对象解密失败：密钥不符或数据被篡改");
  }
}

/** 恒时比较（口令无关面——vault id 比对等场景备用）。 */
export function equalBuffers(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
