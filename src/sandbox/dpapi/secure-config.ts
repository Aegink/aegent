/**
 * 加密密钥的配置读写（T-6-04 · D8 配置接线，§8 第 5 条"配置文件无明文 key"）：
 * 明文只进 protect（DPAPI），落盘的是 blob + 元数据；读回时 unprotect。
 * 配置文件是装配面产物（不是模型可控输入，不在 T-6-01 路径守卫范围）。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { protect, unprotect, type DpapiOptions } from "./index.js";

export const KEY_NAME_INVALID = "KEY_NAME_INVALID";

/** 密钥名是配置文件里的 JSON 键，收紧为机器可写的安全子集。 */
export function assertKeyName(name: string): void {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) {
    throw new Error(`密钥名非法（限 [A-Za-z0-9_.-]，长度 1~64）：${name.slice(0, 64)}`);
  }
}

export interface SecureKeyEntry {
  /** DPAPI blob（PowerShell ConvertFrom-SecureString 产物，hex 文本）。 */
  readonly blob: string;
  readonly updatedAt: string;
}

interface SecureConfigFile {
  readonly version: 1;
  readonly keys: Record<string, SecureKeyEntry>;
}

export class SecureKeyStore {
  constructor(
    private readonly options: { configPath: string; dpapi?: DpapiOptions },
  ) {}

  private get configPath(): string {
    return this.options.configPath;
  }

  /** 明文 key → DPAPI blob → 写配置 JSON（文件里永远没有明文）。 */
  async setKey(name: string, plainKey: string): Promise<void> {
    assertKeyName(name);
    const blob = await protect(plainKey, this.options.dpapi);
    const file = await this.read();
    const keys: Record<string, SecureKeyEntry> = { ...file.keys };
    keys[name] = { blob, updatedAt: new Date().toISOString() };
    await mkdir(path.dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify({ version: 1, keys } satisfies SecureConfigFile, null, 2)}\n`, "utf8");
  }

  /** 读配置 → unprotect blob → 明文 key；未配置返回 undefined。 */
  async getKey(name: string): Promise<string | undefined> {
    assertKeyName(name);
    const file = await this.read();
    const entry = file.keys[name];
    if (entry === undefined) return undefined;
    return unprotect(entry.blob, this.options.dpapi);
  }

  private async read(): Promise<SecureConfigFile> {
    let raw: string;
    try {
      raw = await readFile(this.configPath, "utf8");
    } catch {
      return { version: 1, keys: {} };
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== 1 ||
      typeof (parsed as { keys?: unknown }).keys !== "object"
    ) {
      throw new Error(`加密配置文件形状非法：${this.configPath}`);
    }
    return parsed as SecureConfigFile;
  }
}
