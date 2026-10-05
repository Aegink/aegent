// T-P3-153 B：备份中心 ops——列表/立即备份/恢复（safety 先行）/删除/白名单。
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyBackupRetentionPolicy,
  autoBackupTickOp,
  createSettingsBackupOp,
  deleteSettingsBackupOp,
  listSettingsBackupsOp,
  restoreSettingsBackupOp,
} from "./settings-backup-ops.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function tempSettingsPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aegent-backup-"));
  dirs.push(dir);
  return path.join(dir, "settings.json");
}

describe("settings-backup-ops", () => {
  it("列表：白名单形状 bak.<数字>，其余文件忽略；按序号排序", () => {
    const p = tempSettingsPath();
    writeFileSync(p, "{}", "utf8");
    writeFileSync(`${p}.bak.0`, "{}", "utf8");
    writeFileSync(`${p}.bak.2`, "{}", "utf8");
    writeFileSync(`${p}.bak.evil`, "{}", "utf8"); // 非数字序号——忽略
    writeFileSync(`${p}.bak.10`, "{}", "utf8");
    const { backups } = listSettingsBackupsOp(p);
    expect(backups.map((b) => b.index)).toEqual([0, 2, 10]);
  });
  it("立即备份：无配置文件类型化拒绝；有则滚动入 bak.0", () => {
    const p = tempSettingsPath();
    expect(() => createSettingsBackupOp(p)).toThrow(/配置文件不存在/);
    writeFileSync(p, JSON.stringify({ v: 1 }), "utf8");
    createSettingsBackupOp(p);
    expect(existsSync(`${p}.bak.0`)).toBe(true);
  });
  it("恢复：safety 滚动先行（当前配置入 bak.0）+ 内容写回 + 非法序号拒绝", () => {
    const p = tempSettingsPath();
    writeFileSync(p, JSON.stringify({ providers: [{ name: "old", model: "m" }], version: 1 }), "utf8");
    writeFileSync(`${p}.bak.1`, JSON.stringify({ providers: [{ name: "snap", model: "m" }], version: 1 }), "utf8");
    const r = restoreSettingsBackupOp(p, 1);
    expect(r.applied).toBe(true);
    expect(r.settings.providers[0]?.name).toBe("snap");
    expect(r.summary.some((l) => l.includes("供应商条目 1 个"))).toBe(true);
    // safety 备份 = 恢复前的当前配置（old）
    const safety = listSettingsBackupsOp(p).backups.find((b) => b.index === 0);
    expect(safety).toBeDefined();
    // 恢复后主配置 = snap
    expect(JSON.parse(readFileSync(p, "utf8")).providers[0].name).toBe("snap");
    expect(() => restoreSettingsBackupOp(p, -1)).toThrow(/备份序号非法/);
    expect(() => restoreSettingsBackupOp(p, 9)).toThrow(/备份不存在/);
  });
  it("坏备份（非 JSON）拒绝恢复——主配置不动", () => {
    const p = tempSettingsPath();
    writeFileSync(p, JSON.stringify({ version: 1 }), "utf8");
    writeFileSync(`${p}.bak.0`, "{broken", "utf8");
    expect(() => restoreSettingsBackupOp(p, 0)).toThrow(/不是合法 JSON/);
    expect(JSON.parse(readFileSync(p, "utf8")).version).toBe(1);
  });
  it("删除：存在才删；不存在类型化拒绝", () => {
    const p = tempSettingsPath();
    writeFileSync(`${p}.bak.3`, "{}", "utf8");
    expect(deleteSettingsBackupOp(p, 3)).toEqual({ deleted: true });
    expect(existsSync(`${p}.bak.3`)).toBe(false);
    expect(() => deleteSettingsBackupOp(p, 3)).toThrow(/备份不存在/);
  });
});

describe("周期自动备份（T-P3-174 批次 4）", () => {
  it("tick：auto 关/未到间隔跳过；到间隔滚动备份并应用保留策略", () => {
    const p = tempSettingsPath();
    writeFileSync(p, JSON.stringify({ version: 1 }), "utf8");
    // auto 缺省 = 不动
    expect(autoBackupTickOp(p, {}, 1000).backedUp).toBe(false);
    expect(existsSync(`${p}.bak.0`)).toBe(false);
    // 首次（无 bak.0）= 立即备份
    expect(autoBackupTickOp(p, { auto: true, intervalHours: 24, keep: 2 }, 1000).backedUp).toBe(true);
    expect(existsSync(`${p}.bak.0`)).toBe(true);
    // 未到间隔（bak.0 mtime = 文件系统真实时间——now 早于它即跳过）
    expect(autoBackupTickOp(p, { auto: true, intervalHours: 24, keep: 2 }, 2000).backedUp).toBe(false);
    // 超过间隔（now = 真实 mtime + 25h——mtime 由 copyFileSync 写为真实时钟）
    const later = Date.now() + 25 * 3_600_000;
    expect(autoBackupTickOp(p, { auto: true, intervalHours: 24, keep: 2 }, later).backedUp).toBe(true);
  });
  it("保留策略：keep 收窄时超出序号清理（最老先删）", () => {
    const p = tempSettingsPath();
    writeFileSync(p, JSON.stringify({ version: 1 }), "utf8");
    createSettingsBackupOp(p);
    for (const i of [1, 2, 3, 4]) writeFileSync(`${p}.bak.${i}`, "{}", "utf8");
    const r = applyBackupRetentionPolicy(p, 3);
    expect(r.removed.sort()).toEqual([3, 4]);
    expect(listSettingsBackupsOp(p).backups.map((b) => b.index)).toEqual([0, 1, 2]);
  });
});
