/**
 * 配置同步协调器（N9/T-P1-118）——syncOnce：capture local → 拉远端 →
 * unlock 解密 → threeWayMerge（T-P1-111 消费）→ 无冲突 apply（journal
 * 包裹——崩溃恢复）→ push 加密清单 + 新基线。有冲突 → SyncConflictError
 * 显式报错零 apply（N10 贯穿——"禁止后写覆盖先写"）。
 *
 * 首推语义：远端无 manifest（新设备首同步）→ 本地全量加密上推，base =
 * 本次清单（下次合并的共同基线）。
 */

import { encryptObject, decryptObject, unlockVault, type VaultHeader } from "./vault.js";
import { threeWayMerge, type MergeConflict, type SyncEntity } from "./merge.js";
import { SyncJournal } from "./journal.js";
import type { RemoteStore } from "./store.js";

export const MANIFEST_KEY = "manifest.json";

/** 远端 manifest（加密载荷 + vault 头 + 合并基线——base 也是密文）。 */
export interface SyncManifest {
  vault: VaultHeader;
  /** 当前实体清单（对象级加密 blob）。 */
  entities: string;
  /** 上次双方确认的共同基线（加密 blob——三方合并的 base）。 */
  base: string;
}

export class SyncConflictError extends Error {
  readonly code = "SYNC_CONFLICT";
  constructor(readonly conflicts: readonly MergeConflict[]) {
    super(
      `配置同步冲突（${conflicts.length} 项）——禁止后写覆盖先写：${conflicts
        .map((c) => `${c.domain}/${c.entityId}（${c.reason}）`)
        .join("；")}`,
    );
    this.name = "SyncConflictError";
  }
}

export interface SyncOnceOptions {
  /** 本地当前实体快照（capture 面——调用方从配置域收集）。 */
  local: readonly SyncEntity[];
  remote: RemoteStore;
  passphrase: string;
  /** 实体应用面（调用方实现——写本地配置域；journal 的幂等消费点）。 */
  applyEntity: (entity: SyncEntity) => void | Promise<void>;
  /** 导入日志（缺省内存面——提供 path 即崩溃可恢复）。 */
  journalPath?: string;
  /** 已知 vault 头（上次同步留存；缺省从远端 manifest 解析）。 */
  knownVault?: VaultHeader;
  /**
   * 设备侧已认可基线（per-device acknowledged base——上次本设备同步成功
   * 时的合并结果，调用方持久化）。提供时合并用它做 base（而非全局
   * manifest.base）——两设备都相对同一基线改同键时，后推方在**自己的
   * pull 阶段**就撞出显式冲突（N10"禁止后写覆盖先写"的真正落点：全局
   * 单一 base 无法表达各设备各自的认可进度，后推方会静默取边）。
   */
  knownBase?: readonly SyncEntity[];
}

export interface SyncOnceResult {
  readonly applied: number;
  readonly skippedByJournal: number;
  readonly conflicts: readonly MergeConflict[];
  /** push 后的新基线（调用方持久化为下次的 knownBase）。 */
  readonly base: readonly SyncEntity[];
}

/** 一次同步（拉→并→本→推）。冲突显式拒绝零 apply（N10）。 */
export async function syncOnce(options: SyncOnceOptions): Promise<SyncOnceResult> {
  const { local, remote, passphrase, applyEntity } = options;
  const raw = await remote.read(MANIFEST_KEY);

  if (raw === undefined) {
    // 首推：本地全量上推，base = 本次清单（共同基线的起点）。
    const { header, vaultKey } = await import("./vault.js").then((m) =>
      m.createVault(passphrase),
    );
    const manifest: SyncManifest = {
      vault: header,
      entities: encryptObject(vaultKey, local),
      base: encryptObject(vaultKey, local),
    };
    await remote.write(MANIFEST_KEY, JSON.stringify(manifest));
    return { applied: 0, skippedByJournal: 0, conflicts: [], base: local };
  }

  const manifest = JSON.parse(raw) as SyncManifest;
  const header = options.knownVault ?? manifest.vault;
  const vaultKey = unlockVault(header, passphrase);
  const remoteEntities = decryptObject<SyncEntity[]>(vaultKey, manifest.entities);
  const baseEntities = decryptObject<SyncEntity[]>(vaultKey, manifest.base);

  // 设备侧 knownBase 优先（各设备各自的认可进度——冲突落点前移到 pull）。
  const merged = threeWayMerge(options.knownBase ?? baseEntities, local, remoteEntities);
  if (!merged.applyable) {
    throw new SyncConflictError(merged.conflicts);
  }

  // journal 包裹 apply：begin → 跳过已完成（崩溃恢复）→ applyEntity → complete。
  const journal = new SyncJournal(options.journalPath);
  const completed = journal.completedEntityIds();
  let applied = 0;
  let skipped = 0;
  for (const entity of merged.entities) {
    if (completed.has(entity.entityId)) {
      skipped += 1;
      continue;
    }
    journal.begin(entity.entityId);
    await applyEntity(entity);
    journal.complete(entity.entityId);
    applied += 1;
  }

  // push：合并结果与新基线（加密——API key 等明文绝不落盘）。
  const nextManifest: SyncManifest = {
    vault: header,
    entities: encryptObject(vaultKey, merged.entities),
    base: encryptObject(vaultKey, merged.entities),
  };
  await remote.write(MANIFEST_KEY, JSON.stringify(nextManifest));
  return { applied, skippedByJournal: skipped, conflicts: [], base: merged.entities };
}
