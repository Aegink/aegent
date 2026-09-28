/**
 * 凭据管理（U2/T-P3-102，cc-switch·app_store.rs 凭据隔离存储的行为同构）——
 * API key 的录入/更换/删除走专用面，落盘经 DPAPI 加密（D8 面复用——
 * sandbox·dpapi 的 protect/unprotect）；配置文件与日志零明文（settings.json
 * 永不承载 key，credentials.bin 落盘的是 DPAPI blob）。
 *
 * 非 Windows 回退（卡面定形）：DPAPI 仅 Windows 可用（DPAPI_UNSUPPORTED_
 * PLATFORM）→ 回退 0600 权限明文文件（用户目录本机保护边界；权限位即唯一
 * 防线——记档为平台差异面，文档只写掩码）。文件本体仍是独立凭据库
 * `~/.aegent/credentials.bin`，与 settings.json 分离存储。
 *
 * provider 维度键名 = settings.json providers[].name / defaultProvider——
 * 装配消费（CLI/host main）据此把凭据注入 --api-key 槽（优先级链中位于
 * 显式参数与环境变量之后）。
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { SecureKeyStore } from "../sandbox/dpapi/secure-config.js";
import { defaultSettingsPath } from "./settings.js";

/** 凭据库缺省位：<home>/.aegent/credentials.bin（与 settings.json 同目录）。 */
export function defaultCredentialsPath(): string {
  return path.join(path.dirname(defaultSettingsPath()), "credentials.bin");
}

export interface CredentialMeta {
  name: string;
  updatedAt: string;
}

export interface CredentialStore {
  setKey(provider: string, key: string): Promise<void>;
  getKey(provider: string): Promise<string | undefined>;
  /** 删除（不存在 = no-op 返回 false——幂等删除面）。 */
  deleteKey(provider: string): Promise<boolean>;
  /** 条目清单（只有名字与时间——掩码展示面，无任何材料）。 */
  listKeys(): Promise<CredentialMeta[]>;
}

// ---------------------------------------------------------------------------
// Windows：DPAPI 加密存储（SecureKeyStore 复用——blob 结构/版本校验单一来源）
// ---------------------------------------------------------------------------

export class DpapiCredentialStore implements CredentialStore {
  private readonly store: SecureKeyStore;
  constructor(configPath: string) {
    this.store = new SecureKeyStore({ configPath });
  }
  async setKey(provider: string, key: string): Promise<void> {
    await this.store.setKey(provider, key);
  }
  async getKey(provider: string): Promise<string | undefined> {
    return this.store.getKey(provider);
  }
  async deleteKey(provider: string): Promise<boolean> {
    return this.store.deleteKey(provider);
  }
  async listKeys(): Promise<CredentialMeta[]> {
    return this.store.listKeys();
  }
}

// ---------------------------------------------------------------------------
// 非 Windows 回退：0600 权限明文文件（平台差异记档——权限位即唯一防线）
// ---------------------------------------------------------------------------

interface PlainCredentialsFile {
  readonly version: 1;
  readonly keys: Record<string, { readonly key: string; readonly updatedAt: string }>;
}

function assertProviderName(name: string): void {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) {
    throw new Error(`provider 名非法（限 [A-Za-z0-9_.-]，长度 1~64）：${name.slice(0, 64)}`);
  }
}

export class PlainFileCredentialStore implements CredentialStore {
  constructor(private readonly filePath: string) {}
  async setKey(provider: string, key: string): Promise<void> {
    assertProviderName(provider);
    const file = await this.read();
    const keys: PlainCredentialsFile["keys"] = {
      ...file.keys,
      [provider]: { key, updatedAt: new Date().toISOString() },
    };
    await this.write({ version: 1, keys });
  }
  async getKey(provider: string): Promise<string | undefined> {
    assertProviderName(provider);
    return (await this.read()).keys[provider]?.key;
  }
  async deleteKey(provider: string): Promise<boolean> {
    assertProviderName(provider);
    const file = await this.read();
    if (file.keys[provider] === undefined) return false;
    const keys: PlainCredentialsFile["keys"] = { ...file.keys };
    delete keys[provider];
    await this.write({ version: 1, keys });
    return true;
  }
  async listKeys(): Promise<CredentialMeta[]> {
    const file = await this.read();
    return Object.entries(file.keys).map(([name, entry]) => ({ name, updatedAt: entry.updatedAt }));
  }
  private async read(): Promise<PlainCredentialsFile> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return { version: 1, keys: {} };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `凭据文件损坏：${this.filePath}（${e instanceof Error ? e.message : String(e)}）——` +
          "删除该文件后重新录入凭据（aegent key set <provider>）",
      );
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== 1 ||
      typeof (parsed as { keys?: unknown }).keys !== "object"
    ) {
      throw new Error(`凭据文件形状非法：${this.filePath}`);
    }
    return parsed as PlainCredentialsFile;
  }
  private async write(file: PlainCredentialsFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, this.filePath);
  }
}

/** 平台工厂（platform 注入测试——Windows DPAPI / 其他 0600 回退）。 */
export function createCredentialStore(
  credentialsPath?: string,
  platform: NodeJS.Platform = process.platform,
): CredentialStore {
  const file = credentialsPath ?? defaultCredentialsPath();
  return platform === "win32"
    ? new DpapiCredentialStore(file)
    : new PlainFileCredentialStore(file);
}
