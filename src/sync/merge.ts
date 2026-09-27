/**
 * 配置三方合并（N10/T-P1-111）——"禁止后写覆盖先写，必须三方合并；冲突
 * 显式报错"（与 C49 同源纪律）的机制本体。形状取 pi-desktop·config_sync/
 * merge.rs 的 three_way：实体级三集并 + payload 字段级三方 + 冲突显式化
 * （两侧指纹供审计比对——冲突绝不静默裁决）+ 墓碑删除语义。
 *
 * 红线：base/local/remote 三方全异的键**绝不自动取边**（last-write-wins
 * 禁止）——冲突进 MergeConflict 清单，结果 applyable:false，调用方必须
 * 显式解决后重试。删除以墓碑（deleted:true）表达：base 有而本侧已删 =
 * 墓碑参与合并，"缺席"本身不是删除（类别 opt-out 不变成意外远程删除——
 * pi 同款纪律）。
 *
 * 纯函数无 IO：N9 coordinator（T-P1-118）消费；digest 为稳定序列化的
 * FNV-1a（T-P1-100 压缩指纹同款自算哈希，不引依赖）。
 */

import type { JsonRecord } from "../kernel/events.js";

/** 同步实体：一个配置域内的一个可命名对象（provider/预设/键值组…）。 */
export interface SyncEntity {
  /** 配置域（如 "providers" / "preferences"）——域间不交叉合并。 */
  readonly domain: string;
  /** 域内唯一键。 */
  readonly entityId: string;
  /** 展示名（冲突报告可读性）。 */
  readonly label?: string;
  /** 实体载荷（对象形状才可字段级合并）。 */
  readonly payload: JsonRecord;
  /** 墓碑：true = 本侧已删除该实体（payload 忽略）。 */
  readonly deleted?: boolean;
}

/** 冲突报告：无法自动合并的实体，两侧内容指纹供审计比对与人工裁决。 */
export interface MergeConflict {
  readonly domain: string;
  readonly entityId: string;
  readonly label?: string;
  readonly localDigest: string;
  readonly remoteDigest: string;
  readonly reason: string;
}

export interface MergeResult {
  /** 合并后的实体清单（不含冲突实体——冲突必须显式解决后重试）。 */
  readonly entities: SyncEntity[];
  readonly conflicts: MergeConflict[];
  /** false = 存在未解决冲突，本结果不可应用（N10"冲突显式报错"）。 */
  readonly applyable: boolean;
}

/** 实体内容指纹：稳定序列化（键排序递归）后的 FNV-1a 32 位 hex。 */
export function entityDigest(entity: SyncEntity): string {
  const canonical = stableStringify({ deleted: entity.deleted ?? false, payload: entity.payload });
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 稳定字符串化：键排序递归（嵌套对象不丢——T-P1-100 的 replacer 数组坑）。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`)
    .join(",")}}`;
}

function keyOf(entity: SyncEntity): string {
  return `${entity.domain} ${entity.entityId}`;
}

function sameEntity(a: SyncEntity | undefined, b: SyncEntity | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  // 墓碑的等值只看删除标志——payload 在删除后无意义（不参与指纹比较）
  if (a.deleted === true || b.deleted === true) {
    return (a.deleted ?? false) === (b.deleted ?? false);
  }
  return entityDigest(a) === entityDigest(b);
}

/**
 * 字段级三方合并：双方 payload 都修改时逐键三方（local==remote 取之 /
 * 一方==base 取另一方 / 三方全异 → undefined）。任一方是墓碑不进字段级。
 */
function mergeEntityFields(
  base: SyncEntity,
  local: SyncEntity,
  remote: SyncEntity,
): SyncEntity | undefined {
  if (local.deleted === true || remote.deleted === true) return undefined;
  const keys = new Set<string>([
    ...Object.keys(base.payload),
    ...Object.keys(local.payload),
    ...Object.keys(remote.payload),
  ]);
  const merged: JsonRecord = {};
  for (const key of keys) {
    const b = base.payload[key];
    const l = local.payload[key];
    const r = remote.payload[key];
    const bs = stableStringify(b);
    const ls = stableStringify(l);
    const rs = stableStringify(r);
    // 缺席（undefined）与值相等同权比较：双边同删该键 → 不写（键消失）
    if (ls === rs) {
      if (l !== undefined) merged[key] = l;
    } else if (ls === bs) {
      if (r !== undefined) merged[key] = r;
    } else if (rs === bs) {
      if (l !== undefined) merged[key] = l;
    } else {
      return undefined; // 三方全异——该实体整体冲突（不落半合并结果）
    }
  }
  return { ...local, payload: merged };
}

/**
 * 三方合并（N10 机制本体）：base = 上次双方都确认的共同基线，local/remote
 * 是两侧当前快照。任一侧"缺席"只有 base 有时才由调用方在 capture 时补
 * 墓碑（"缺席仅在 base 有意义"——本函数只认显式墓碑）。
 */
export function threeWayMerge(
  base: readonly SyncEntity[] | undefined,
  local: readonly SyncEntity[],
  remote: readonly SyncEntity[],
): MergeResult {
  const baseIndex = new Map<string, SyncEntity>();
  for (const entity of base ?? []) baseIndex.set(keyOf(entity), entity);
  const localIndex = new Map<string, SyncEntity>();
  for (const entity of local) localIndex.set(keyOf(entity), entity);
  const remoteIndex = new Map<string, SyncEntity>();
  for (const entity of remote) remoteIndex.set(keyOf(entity), entity);

  const keys = new Set<string>([...baseIndex.keys(), ...localIndex.keys(), ...remoteIndex.keys()]);
  const entities: SyncEntity[] = [];
  const conflicts: MergeConflict[] = [];

  for (const key of keys) {
    const b = baseIndex.get(key);
    const l = localIndex.get(key);
    const r = remoteIndex.get(key);
    const spaceAt = key.indexOf(" ");
    const domain = key.slice(0, spaceAt);
    const entityId = key.slice(spaceAt + 1);
    const label = (l ?? r ?? b)?.label;

    // 双边同值（含双方同墓碑）→ 收敛；双方同删不产出实体
    if (sameEntity(l, r)) {
      if (l !== undefined && l.deleted !== true) entities.push(l);
      continue;
    }
    // 缺席非删除（pi 墓碑纪律："缺席仅在 base 有意义"，显式墓碑才表达
    // 删除）——本侧缺席且另一侧相对 base 未变 → 取未变侧本体（B 设备
    // 配置快照没有该实体 = B 未动，不丢 A 的新增）。
    if (l === undefined && r !== undefined && b !== undefined && sameEntity(r, b)) {
      entities.push(r);
      continue;
    }
    if (r === undefined && l !== undefined && b !== undefined && sameEntity(l, b)) {
      entities.push(l);
      continue;
    }
    // 本侧未动 → 取远端（远端墓碑 = 删除收敛，不产出；远端缺席非删除 →
    // 保留本地）
    if (l !== undefined && b !== undefined && sameEntity(l, b)) {
      if (r !== undefined && r.deleted !== true) entities.push(r);
      else if (r === undefined) entities.push(l);
      continue;
    }
    // 远端未动 → 取本地（本地缺席非删除 → 保留远端）
    if (r !== undefined && b !== undefined && sameEntity(r, b)) {
      if (l !== undefined && l.deleted !== true) entities.push(l);
      else if (l === undefined) entities.push(r);
      continue;
    }
    // 单边新增（base 与另一边都无；墓碑对缺席 = 删除收敛，不产出）
    if (b === undefined && r === undefined) {
      if (l !== undefined && l.deleted !== true) entities.push(l);
      continue;
    }
    if (b === undefined && l === undefined) {
      if (r !== undefined && r.deleted !== true) entities.push(r);
      continue;
    }
    // base 无 + 双方各自新增同名实体 → 内容可字段级合并则并，全异即冲突
    if (b === undefined) {
      const merged =
        l !== undefined && r !== undefined
          ? mergeEntityFields({ domain, entityId, payload: {} }, l, r)
          : undefined;
      if (merged !== undefined) {
        entities.push(merged);
        continue;
      }
      conflicts.push(conflictOf(domain, entityId, label, l, r, "双方各自新增了同名实体且内容冲突"));
      continue;
    }
    // 缺席（非墓碑）不构成"修改"——base 有 + 本侧缺席 + 对侧相对 base
    // 改动 → 取对侧（A 设备快照没有 B 新推的实体状态 = A 未动，采纳 B；
    // 墓碑方不进此分支——删除 vs 修改仍是冲突）。
    if (l === undefined && r !== undefined && r.deleted !== true) {
      entities.push(r);
      continue;
    }
    if (r === undefined && l !== undefined && l.deleted !== true) {
      entities.push(l);
      continue;
    }
    // 删除 vs 修改（一方墓碑、另一方改动——双方同删已在 sameEntity 收敛）
    if (l?.deleted === true || r?.deleted === true) {
      conflicts.push(conflictOf(domain, entityId, label, l, r, "一方删除、另一方修改了该实体"));
      continue;
    }
    // 双改 → 字段级，失败即冲突
    const merged = l !== undefined && r !== undefined ? mergeEntityFields(b, l, r) : undefined;
    if (merged !== undefined) {
      entities.push(merged);
      continue;
    }
    conflicts.push(conflictOf(domain, entityId, label, l, r, "双方都修改了该实体且同键取值冲突"));
  }

  return { entities, conflicts, applyable: conflicts.length === 0 };
}

function conflictOf(
  domain: string,
  entityId: string,
  label: string | undefined,
  l: SyncEntity | undefined,
  r: SyncEntity | undefined,
  reason: string,
): MergeConflict {
  return {
    domain,
    entityId,
    ...(label !== undefined ? { label } : {}),
    localDigest: l !== undefined ? entityDigest(l) : "absent",
    remoteDigest: r !== undefined ? entityDigest(r) : "absent",
    reason,
  };
}
