/**
 * architecture:check 检查器核心逻辑测试（T1/T-P1-121）——fixture 目录隔离，
 * 不碰真实 src / 真实 architecture-policy.json（真实策略的全量跑由
 * `node tools/architecture-check.mjs` 承担，结果落卡面完成记录）。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error —— 工具脚本是 mjs 无类型声明（下方本地收窄形状）
import { assertPolicyShape, checkArchitecture, findCycles, resolveSpec } from "../../tools/architecture-check.mjs";

// mjs 导入无类型声明——本地收窄（返回违规清单形状）
const check = checkArchitecture as (
  policy: unknown,
  opts?: { repoRoot?: string; changedFiles?: string[] | null },
) => { errors: string[]; warnings: string[] };
const cyclesOf = findCycles as (edges: Map<string, Set<string>>) => string[][];

describe("architecture-check 检查器", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "arch-check-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const writeModule = (files: Record<string, string>) => {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(root, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
  };

  const policyOf = (modules: unknown[], global = {}) => ({
    version: 1,
    modules,
    global: { maxFileLines: 400, forbidCycles: true, forbidDeepImports: true, ...global },
    exceptions: [],
  });

  const twoModules = (overrides: Record<string, unknown> = {}) => [
    { id: "a", roots: ["src/a"], managed: true, requires: [], publicEntrypoints: [], owner: "t", ...overrides },
    { id: "b", roots: ["src/b"], managed: false, requires: [], publicEntrypoints: [], owner: "t" },
  ];

  it("策略形状自检：重复 id / 未知 requires / 缺 reason 的 exception 都拒绝", () => {
    expect(() =>
      assertPolicyShape(policyOf([
        { id: "x", roots: ["src/a"], managed: true, requires: [] },
        { id: "x", roots: ["src/b"], managed: false, requires: [] },
      ]), path.join(root, "p.json"), root),
    ).toThrow(/重复/);
    expect(() =>
      assertPolicyShape(policyOf([{ id: "x", roots: ["src/a"], managed: true, requires: ["ghost"] }]), path.join(root, "p.json"), root),
    ).toThrow(/未声明的模块/);
    expect(() =>
      assertPolicyShape({ ...policyOf(twoModules()), exceptions: [{ path: "src/a/x.ts" }] }, path.join(root, "p.json"), root),
    ).toThrow(/reason/);
  });

  it("白名单：managed 域未声明依赖是 error，存量域降级 warning", () => {
    writeModule({
      "src/a/index.ts": `import { b } from "../b/index.js";\nexport const a = b;\n`,
      "src/b/index.ts": `export const b = 1;\n`,
    });
    const r = check(policyOf(twoModules()), { repoRoot: root });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/\[requires\].*src\/a\/index\.ts.*未在模块 a 的 requires/);
    // a 改为 managed:false → 降级 warning
    const r2 = check(policyOf([{ id: "a", roots: ["src/a"], managed: false, requires: [], publicEntrypoints: [], owner: "t" }, { id: "b", roots: ["src/b"], managed: false, requires: [], publicEntrypoints: [], owner: "t" }]), { repoRoot: root });
    expect(r2.errors).toHaveLength(0);
    expect(r2.warnings).toHaveLength(1);
    // 声明 requires 后通过
    const r3 = check(policyOf(twoModules({ requires: ["b"] })), { repoRoot: root });
    expect(r3.errors).toHaveLength(0);
  });

  it("深导入：目标域声明了 publicEntrypoints 时，import 内部文件报违规", () => {
    writeModule({
      "src/a/index.ts": `import { hidden } from "../b/internal.js";\nexport const a = hidden;\n`,
      "src/b/index.ts": `export const pub = 1;\n`,
      "src/b/internal.ts": `export const hidden = 2;\n`,
    });
    const withEntries = policyOf([
      { id: "a", roots: ["src/a"], managed: true, requires: ["b"], publicEntrypoints: [], owner: "t" },
      { id: "b", roots: ["src/b"], managed: true, requires: [], publicEntrypoints: ["src/b/index.ts"], owner: "t" },
    ]);
    const r = check(withEntries, { repoRoot: root });
    expect(r.errors.some((e) => /\[deep-import\].*internal\.ts/.test(e))).toBe(true);
    // 目标域未声明 entrypoints（缺省空）→ 深导入检查不激活
    const noEntries = policyOf([
      { id: "a", roots: ["src/a"], managed: true, requires: ["b"], publicEntrypoints: [], owner: "t" },
      { id: "b", roots: ["src/b"], managed: true, requires: [], publicEntrypoints: [], owner: "t" },
    ]);
    expect(check(noEntries, { repoRoot: root }).errors).toHaveLength(0);
  });

  it("环检测：模块互依成环；全 managed 环是 error，含存量域是 warning", () => {
    writeModule({
      "src/a/index.ts": `import { b } from "../b/index.js";\nexport const a = b;\n`,
      "src/b/index.ts": `import { a } from "../a/index.js";\nexport const b = a;\n`,
    });
    const allManaged = policyOf([
      { id: "a", roots: ["src/a"], managed: true, requires: ["b"], publicEntrypoints: [], owner: "t" },
      { id: "b", roots: ["src/b"], managed: true, requires: ["a"], publicEntrypoints: [], owner: "t" },
    ]);
    const r = check(allManaged, { repoRoot: root });
    expect(r.errors.some((e) => /\[cycle\]/.test(e))).toBe(true);
    const r2 = check(
      policyOf([
        { id: "a", roots: ["src/a"], managed: true, requires: ["b"], publicEntrypoints: [], owner: "t" },
        { id: "b", roots: ["src/b"], managed: false, requires: ["a"], publicEntrypoints: [], owner: "t" },
      ]),
      { repoRoot: root },
    );
    expect(r2.errors.some((e) => /\[cycle\]/.test(e))).toBe(false);
    expect(r2.warnings.some((e) => /\[cycle\].*渐进/.test(e))).toBe(true);
  });

  it("findCycles：单向链不成环、双向互依成环、自环成环", () => {
    const edges = new Map<string, Set<string>>([
      ["a", new Set(["b"])],
      ["b", new Set(["c"])],
      ["c", new Set<string>()],
      ["d", new Set(["d"])],
    ]);
    expect(cyclesOf(edges)).toEqual([["d"]]);
    (edges.get("c") as Set<string>).add("a");
    const cycles = cyclesOf(edges);
    expect(cycles).toHaveLength(2);
    expect(cycles.some((c) => c.join("|") === "a|b|c")).toBe(true);
  });

  it("maxFileLines：managed 域超限是 error，exceptions 豁免", () => {
    const long = Array.from({ length: 401 }, (_, i) => `// line ${i}`).join("\n");
    writeModule({ "src/a/long.ts": long });
    const r = check(policyOf(twoModules()), { repoRoot: root });
    expect(r.errors.some((e) => /\[maxFileLines\].*long\.ts.*401/.test(e))).toBe(true);
    const withEx = { ...policyOf(twoModules()), exceptions: [{ path: "src/a/long.ts", reason: "存量迁移中" }] };
    expect(check(withEx, { repoRoot: root }).errors).toHaveLength(0);
  });

  it("测试文件出边不参与白名单/环检查（测试可以 import 任何被测面）", () => {
    writeModule({
      "src/a/index.test.ts": `import { b } from "../b/index.js";\nimport { expect } from "vitest";\n`,
      "src/b/index.ts": `import { a } from "../a/index.js";\nexport const b = a;\n`,
      "src/a/index.ts": `export const a = 1;\n`,
    });
    // a 的测试文件 import b 不构成 a->b 边（无违规）；b->a 是运行时边
    // 但 b 是存量域未声明 requires → 仅 warning（渐进）
    const r = check(policyOf(twoModules()), { repoRoot: root });
    expect(r.errors).toHaveLength(0);
    expect(r.warnings.filter((w) => /\[requires\]/.test(w))).toHaveLength(1);
    expect(r.warnings.join("\n")).toMatch(/src\/b\/index\.ts/);
    // a 的测试文件 import b 不报任何 [requires] 指向 src/a
    expect(r.warnings.join("\n")).not.toMatch(/\[requires\].*src\/a\/index\.test\.ts/);
  });

  it("resolveSpec：.js 后缀映射到 .ts（ESM 后缀风格）", () => {
    writeModule({
      "src/a/one.ts": `export const one = 1;\n`,
    });
    const from = path.join(root, "src/a/two.ts");
    expect(resolveSpec(from, "../a/one.js")).toBe(path.join(root, "src/a/one.ts"));
    expect(resolveSpec(from, "./missing.js")).toBe(null);
  });

  it("--changed：只保留改动文件相关的违规；环警告全图保留", () => {
    writeModule({
      "src/a/long.ts": Array.from({ length: 401 }, (_, i) => `// ${i}`).join("\n"),
      "src/b/long.ts": Array.from({ length: 401 }, (_, i) => `// ${i}`).join("\n"),
    });
    const policy = policyOf(twoModules());
    const all = check(policy, { repoRoot: root });
    // a 是 managed 域 → error；b 是存量域 → warning（渐进）
    expect(all.errors).toHaveLength(1);
    expect(all.warnings.some((w) => /\[maxFileLines\].*src\/b\/long\.ts/.test(w))).toBe(true);
    const filtered = check(policy, { repoRoot: root, changedFiles: ["src/a/long.ts"] });
    expect(filtered.errors).toHaveLength(1);
    expect(filtered.errors[0]).toMatch(/src\/a\/long\.ts/);
    // 改动面外的 warning 被过滤（b/long.ts 不在 changed 集）
    expect(filtered.warnings.some((w) => /src\/b\/long\.ts/.test(w))).toBe(false);
  });
});
