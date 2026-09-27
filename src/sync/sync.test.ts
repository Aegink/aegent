import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  VaultError,
  createVault,
  decryptObject,
  encryptObject,
  rewrapVault,
  unlockVault,
} from "./vault.js";
import { FileSystemRemoteStore, type RemoteStore } from "./store.js";
import { SyncConflictError, syncOnce, type SyncOnceResult } from "./coordinator.js";
import { SyncJournal } from "./journal.js";
import type { SyncEntity } from "./merge.js";

function entity(entityId: string, payload: Record<string, unknown>): SyncEntity {
  return { domain: "providers", entityId, payload: payload as SyncEntity["payload"] };
}

function memoryStore(): RemoteStore & { raw(key: string): string | undefined } {
  const map = new Map<string, string>();
  return {
    read: async (key) => map.get(key),
    write: async (key, content) => {
      map.set(key, content);
    },
    raw: (key) => map.get(key),
  };
}

/** 设备面：knownBase / knownVault 由设备持久化（per-device 认可进度）。 */
interface Device {
  base?: SyncEntity[];
  vault?: Awaited<ReturnType<typeof import("./vault.js")["createVault"]>>["header"];
}

async function deviceSync(
  device: Device,
  local: SyncEntity[],
  remote: RemoteStore,
  passphrase: string,
  hooks?: {
    applied?: SyncEntity[];
    journalPath?: string;
    crashOn?: (entity: SyncEntity) => boolean;
  },
): Promise<SyncOnceResult> {
  const result = await syncOnce({
    local,
    remote,
    passphrase,
    knownBase: device.base,
    knownVault: device.vault,
    applyEntity: (e) => {
      if (hooks?.crashOn?.(e)) throw new Error("模拟崩溃");
      hooks?.applied?.push(e);
    },
    journalPath: hooks?.journalPath,
  });
  device.base = [...result.base];
  return result;
}

describe("N9/T-P1-118 vault 加密（数据密钥包裹 + 参数有界）", () => {
  it("create/unlock 往返；错误口令类型化拒绝（GCM 认证）", () => {
    const { header, vaultKey } = createVault("correct horse");
    const unlocked = unlockVault(header, "correct horse");
    expect(unlocked.equals(vaultKey)).toBe(true);
    expect(() => unlockVault(header, "wrong")).toThrowError(
      expect.objectContaining({ code: "VAULT_AUTH_FAILED" }),
    );
  });

  it("KDF 参数越界拒绝（防 DoS——攻击者控制的 header）", () => {
    const { header } = createVault("p");
    const evil = { ...header, kdf: { ...header.kdf, N: 1 << 30 } };
    expect(() => unlockVault(evil, "p")).toThrowError(
      expect.objectContaining({ code: "VAULT_KDF_OUT_OF_BOUNDS" }),
    );
    const evil2 = { ...header, kdf: { ...header.kdf, algorithm: "argon2id" as never } };
    expect(() => unlockVault(evil2, "p")).toThrowError(/scrypt/);
  });

  it("rewrap 换口令：旧口令失效、新口令可解、wrappedKey 变化（数据密文不动）", () => {
    const { header, vaultKey } = createVault("old-pass");
    const dataBlob = encryptObject(vaultKey, { apiKey: "sk-secret" });
    const newHeader = rewrapVault(header, vaultKey, "new-pass");
    expect(newHeader.vaultId).toBe(header.vaultId);
    expect(newHeader.wrappedKey).not.toBe(header.wrappedKey);
    expect(() => unlockVault(newHeader, "old-pass")).toThrowError(VaultError);
    const reKey = unlockVault(newHeader, "new-pass");
    expect(decryptObject<{ apiKey: string }>(reKey, dataBlob)).toEqual({ apiKey: "sk-secret" });
  });

  it("对象加解密往返 + 密文无明文断言（API key 不落盘）", () => {
    const { vaultKey } = createVault("p");
    const secret = { provider: "openai", settingsConfig: JSON.stringify({ apiKey: "sk-live-123" }) };
    const blob = encryptObject(vaultKey, secret);
    expect(blob).not.toContain("sk-live-123");
    expect(decryptObject(vaultKey, blob)).toEqual(secret);
  });

  it("对象密文被篡改 → 类型化拒绝", () => {
    const { vaultKey } = createVault("p");
    const blob = encryptObject(vaultKey, { a: 1 });
    const raw = Buffer.from(blob, "base64");
    const last = raw.length - 1;
    raw[last] = raw[last]! ^ 0xff;
    expect(() => decryptObject(vaultKey, raw.toString("base64"))).toThrowError(
      expect.objectContaining({ code: "VAULT_DECRYPT_FAILED" }),
    );
  });
});

describe("N9/T-P1-118 协调器（跨设备同步 + 三方合并 + journal 崩溃恢复）", () => {
  it("首推（remote 空）→ 本地全量上推；远端密文无明文", async () => {
    const remote = memoryStore();
    const local = [entity("p1", { apiKey: "sk-live-abc" })];
    const device: Device = {};
    const result = await deviceSync(device, local, remote, "pw");
    expect(result.applied).toBe(0);
    const raw = remote.raw("manifest.json")!;
    expect(raw).not.toContain("sk-live-abc");
  });

  it("跨设备同步：A 推 → B 拉应用再推 → A 拉收敛；字段级合并生效", async () => {
    const remote = memoryStore();
    const passphrase = "pw";
    const a: Device = {};
    const b: Device = {};
    // A 首推 {model:a, region:us}
    await deviceSync(a, [entity("p1", { model: "a", region: "us" })], remote, passphrase);
    // B 拉取应用（B 本地从空到 {model:a, region:us}）→ B 改 model → push {model:b, region:us}
    const bApplied: SyncEntity[] = [];
    await deviceSync(b, [], remote, passphrase, { applied: bApplied });
    expect(bApplied).toEqual([entity("p1", { model: "a", region: "us" })]);
    const bLocal: SyncEntity[] = [entity("p1", { model: "b", region: "us" })];
    await deviceSync(b, bLocal, remote, passphrase);
    // A 拉取应用（吸收 model:b）→ A 改 region → push {model:b, region:eu}
    const aApplied: SyncEntity[] = [];
    await deviceSync(a, [], remote, passphrase, { applied: aApplied });
    expect(aApplied).toEqual([entity("p1", { model: "b", region: "us" })]);
    const aLocal: SyncEntity[] = [entity("p1", { model: "b", region: "eu" })];
    await deviceSync(a, aLocal, remote, passphrase);
    // B 再拉：收敛到 {model:b, region:eu}（字段级——B 的 model 修改与 A 的 region 修改并立）
    const bApplied2: SyncEntity[] = [];
    await deviceSync(b, [], remote, passphrase, { applied: bApplied2 });
    expect(bApplied2).toEqual([entity("p1", { model: "b", region: "eu" })]);
  });

  it("冲突显式报错零 apply（N10——两设备相对同一基线改同键）", async () => {
    const remote = memoryStore();
    const passphrase = "pw";
    const a: Device = {};
    const b: Device = {};
    // A 首推 {model:a}；B 拉取应用（B.knownBase = {model:a}）
    await deviceSync(a, [entity("p1", { model: "a" })], remote, passphrase);
    await deviceSync(b, [], remote, passphrase);
    // A 改 model:b 并 push（基线推进到 b）
    await deviceSync(a, [entity("p1", { model: "b" })], remote, passphrase);
    // B 没拉 A 的修改就改 model:c 再 pull——B.knownBase 仍是 {model:a}：
    // base=a、local=c、remote=b 三方全异 → SyncConflictError（不静默取边）
    await expect(
      deviceSync(b, [entity("p1", { model: "c" })], remote, passphrase),
    ).rejects.toThrowError(SyncConflictError);
  });

  it("journal 崩溃恢复：应用中途中断 → 重跑幂等收敛（done 步零重复副作用）", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-sync-journal-"));
    const journalPath = path.join(dir, "journal.jsonl");
    const remote = memoryStore();
    const passphrase = "pw";
    const a: Device = {};
    const three = [entity("p1", { v: 1 }), entity("p2", { v: 2 }), entity("p3", { v: 3 })];
    await deviceSync(a, three, remote, passphrase);

    // B 设备首次拉取应用：p1/p2 完成（journal 预写 done——模拟已完成步），
    // p3 应用时崩溃
    const b: Device = {};
    const preJournal = new SyncJournal(journalPath);
    preJournal.begin("p1");
    preJournal.complete("p1");
    preJournal.begin("p2");
    preJournal.complete("p2");
    const appliedEntities: SyncEntity[] = [];
    await expect(
      deviceSync(b, [], remote, passphrase, {
        applied: appliedEntities,
        journalPath,
        crashOn: (e) => e.entityId === "p3",
      }),
    ).rejects.toThrowError(/模拟崩溃/);
    // p1/p2 被 journal 跳过（applied 不含）、p3 崩溃前未完成
    expect(appliedEntities).toEqual([]);

    // 重跑：p1/p2 done 跳过、p3 幂等重做
    const b2: Device = {};
    const applied2: SyncEntity[] = [];
    await deviceSync(b2, [], remote, passphrase, {
      applied: applied2,
      journalPath,
    });
    expect(applied2).toEqual([entity("p3", { v: 3 })]);
  });

  it("FileSystemRemoteStore：原子写 + 读缺省 undefined + 非法键拒绝", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aegent-sync-fs-"));
    const store = new FileSystemRemoteStore(dir);
    expect(await store.read("nothing")).toBeUndefined();
    await store.write("manifest.json", '{"ok":true}');
    expect(JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"))).toEqual({ ok: true });
    await expect(store.write("../escape", "x")).rejects.toThrowError(/非法远端键/);
  });
});
