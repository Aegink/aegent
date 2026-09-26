/**
 * 工作区/临时目录的能力 SID 派生（D6/D10）——确定性 `S-1-4-x-y`，子权威
 * 取 sha256 的 30 位段（dsh workspace-sid.ts 同款派生公式，Rust 侧解析
 * SDDL 后用于 grant ACE 与 restricting 清单）。
 *
 * 关键纪律（dsh 原文语义）：
 *   - 输入必须是 canonical 路径（realpathSync.native）——大小写/别名拼写
 *     收敛到同一 SID，两套拼写不再生第二个身份；
 *   - workspace SID 跨会话/重启不变（同工作区 standing ACE 复用 O(1)）；
 *   - temp 用独立派生（域分离第三子权威 `-1`）——与 workspace 共享身份
 *     会让兄弟会话互写 temp 树；
 *   - SID 本身不是秘密，其权力完全由 ACE 形状定义（只出现在工作区树与
 *     私有 temp 目录上）。
 */

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";

/** 30 位子权威（dsh 同款：digest 32 位模 (2^30 - 1) + 1，避开 0）。 */
function subauthority(digest: Buffer, offset: number): number {
  return (digest.readUInt32LE(offset) % (2 ** 30 - 1)) + 1;
}

/** 工作区写身份（S-1-4-x-y）。 */
export function workspaceWriteSid(workspaceRoot: string): string {
  const digest = createHash("sha256").update(workspaceRoot, "utf8").digest();
  return `S-1-4-${String(subauthority(digest, 0))}-${String(subauthority(digest, 4))}`;
}

/** 私有 temp 目录写身份（S-1-4-x-y-1，第三子权威域分离）。 */
export function tempWriteSid(tempDir: string): string {
  const digest = createHash("sha256").update("temp\0", "utf8").update(tempDir, "utf8").digest();
  return `S-1-4-${String(subauthority(digest, 0))}-${String(subauthority(digest, 4))}-1`;
}

/** canonical 路径（realpathSync.native——dsh 的收敛语义）；失败回原样。 */
export function canonicalize(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}
