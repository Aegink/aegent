import { describe, expect, it } from "vitest";

import {
  entityDigest,
  threeWayMerge,
  type SyncEntity,
} from "./merge.js";

function entity(
  entityId: string,
  payload: Record<string, unknown>,
  options?: { domain?: string; label?: string; deleted?: boolean },
): SyncEntity {
  return {
    domain: options?.domain ?? "providers",
    entityId,
    ...(options?.label !== undefined ? { label: options.label } : {}),
    payload: payload as SyncEntity["payload"],
    ...(options?.deleted === true ? { deleted: true } : {}),
  };
}

describe("N10/T-P1-111 配置三方合并", () => {
  it("双边同改同值收敛（双方都改了同一处成同样内容）", () => {
    const base = [entity("p1", { model: "a", key: "k1" })];
    const local = [entity("p1", { model: "a", key: "k2" })];
    const remote = [entity("p1", { model: "a", key: "k2" })];
    const result = threeWayMerge(base, local, remote);
    expect(result.applyable).toBe(true);
    expect(result.entities).toEqual([entity("p1", { model: "a", key: "k2" })]);
  });

  it("单边修改取修改边（另一边未动——禁后写覆盖的正确半边）", () => {
    const base = [entity("p1", { model: "a" })];
    const local = [entity("p1", { model: "b" })]; // 本地改了
    const remote = [entity("p1", { model: "a" })]; // 远端没动
    const result = threeWayMerge(base, local, remote);
    expect(result.applyable).toBe(true);
    expect(result.entities).toEqual([entity("p1", { model: "b" })]);
  });

  it("字段级合并：同实体不同键各自并入", () => {
    const base = [entity("p1", { model: "a", region: "us" })];
    const local = [entity("p1", { model: "b", region: "us" })]; // 改 model
    const remote = [entity("p1", { model: "a", region: "eu" })]; // 改 region
    const result = threeWayMerge(base, local, remote);
    expect(result.applyable).toBe(true);
    expect(result.entities).toEqual([entity("p1", { model: "b", region: "eu" })]);
  });

  it("同键三方全异 → 冲突显式列出（applyable:false，不自动取边）", () => {
    const base = [entity("p1", { model: "a" })];
    const local = [entity("p1", { model: "b" })];
    const remote = [entity("p1", { model: "c" })];
    const result = threeWayMerge(base, local, remote);
    expect(result.applyable).toBe(false);
    expect(result.entities).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    const conflict = result.conflicts[0]!;
    expect(conflict).toMatchObject({ domain: "providers", entityId: "p1" });
    expect(conflict.reason).toContain("修改");
    expect(conflict.localDigest).not.toBe(conflict.remoteDigest);
    expect(conflict.localDigest).toMatch(/^[0-9a-f]{8}$/);
  });

  it("删除语义：一方墓碑 + 另一方未动 → 删除收敛（不产出实体）", () => {
    const base = [entity("p1", { model: "a" })];
    const local = [entity("p1", {}, { deleted: true })];
    const remote = [entity("p1", { model: "a" })];
    const result = threeWayMerge(base, local, remote);
    expect(result.applyable).toBe(true);
    expect(result.entities).toEqual([]);
  });

  it("删除 vs 修改 → 冲突（不静默裁决）", () => {
    const base = [entity("p1", { model: "a" })];
    const local = [entity("p1", {}, { deleted: true })];
    const remote = [entity("p1", { model: "b" })];
    const result = threeWayMerge(base, local, remote);
    expect(result.applyable).toBe(false);
    expect(result.conflicts[0]!.reason).toContain("删除");
  });

  it("双方各删 → 删除收敛", () => {
    const base = [entity("p1", { model: "a" })];
    const local = [entity("p1", {}, { deleted: true })];
    const remote = [entity("p1", { x: 1 }, { deleted: true })];
    const result = threeWayMerge(base, local, remote);
    expect(result.applyable).toBe(true);
    expect(result.entities).toEqual([]);
  });

  it("单边新增：本地新增远端无 → 收录", () => {
    const result = threeWayMerge([], [entity("new", { k: 1 })], []);
    expect(result.applyable).toBe(true);
    expect(result.entities).toEqual([entity("new", { k: 1 })]);
  });

  it("双方各自新增同名实体且内容可并 → 字段级并入；全异 → 冲突", () => {
    const merged = threeWayMerge(
      [],
      [entity("n", { a: 1 })],
      [entity("n", { b: 2 })],
    );
    expect(merged.applyable).toBe(true);
    expect(merged.entities).toEqual([entity("n", { a: 1, b: 2 })]);

    const conflict = threeWayMerge(
      [],
      [entity("n", { a: 1 })],
      [entity("n", { a: 2 })],
    );
    expect(conflict.applyable).toBe(false);
    expect(conflict.conflicts[0]!.reason).toContain("新增");
  });

  it("同 id 不同域互不干扰（域隔离）", () => {
    const base = [
      entity("shared", { v: "base" }, { domain: "providers" }),
      entity("shared", { v: "base" }, { domain: "preferences" }),
    ];
    const local = [
      entity("shared", { v: "local" }, { domain: "providers" }),
      entity("shared", { v: "base" }, { domain: "preferences" }),
    ];
    const remote = [
      entity("shared", { v: "base" }, { domain: "providers" }),
      entity("shared", { v: "remote" }, { domain: "preferences" }),
    ];
    const result = threeWayMerge(base, local, remote);
    expect(result.applyable).toBe(true);
    expect(result.entities).toContainEqual(entity("shared", { v: "local" }, { domain: "providers" }));
    expect(result.entities).toContainEqual(entity("shared", { v: "remote" }, { domain: "preferences" }));
  });

  it("同输入幂等（纯函数）", () => {
    const base = [entity("p1", { model: "a" })];
    const local = [entity("p1", { model: "b" })];
    const remote = [entity("p1", { model: "a", region: "eu" })];
    const a = threeWayMerge(base, local, remote);
    const b = threeWayMerge(base, local, remote);
    expect(a).toEqual(b);
  });

  it("entityDigest：同内容同指纹、内容差异不同指纹、键序无关", () => {
    expect(entityDigest(entity("x", { a: 1, b: 2 }))).toBe(
      entityDigest(entity("x", { b: 2, a: 1 })),
    );
    expect(entityDigest(entity("x", { a: 1 }))).not.toBe(entityDigest(entity("x", { a: 2 })));
    expect(entityDigest(entity("x", { a: 1 }))).not.toBe(
      entityDigest(entity("x", { a: 1 }, { deleted: true })),
    );
  });
});
