/**
 * architecture:read 阅读包组装测试（T3/T-P2-501）——fixture 目录隔离，
 * 不碰真实 src / 真实 architecture-policy.json（真实模块的 CLI 全量跑由
 * `node tools/architecture-read.mjs host` 承担，结果落卡面完成记录）。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error —— 工具脚本是 mjs 无类型声明（下方本地收窄形状）
import { collectReadingPack } from "../../tools/architecture-read.mjs";

// mjs 导入无类型声明——本地收窄（阅读包形状）
const readPack = collectReadingPack as (
  policy: unknown,
  moduleId: string,
  repoRoot?: string,
) => {
  id: string;
  roots: string[];
  managed: boolean;
  requires: string[];
  entrypoints: string[];
  domainFiles: string[];
  testFiles: string[];
  adjacent: { id: string; entrypoints: string[]; topFiles: string[]; fileCount: number }[];
};

describe("architecture-read 阅读包", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "arch-read-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const writeFile = (rel: string) => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, "export {};\n");
  };

  const policyOf = (modules: unknown[]) => ({ version: 1, modules });

  it("阅读包四件齐：入口 + 域内文件 + 测试分列 + requires 邻接", () => {
    writeFile("src/alpha/one.ts");
    writeFile("src/alpha/two.ts");
    writeFile("src/alpha/one.test.ts");
    writeFile("src/alpha/one.test-utils.ts");
    writeFile("src/beta/index.ts");
    writeFile("src/beta/core.ts");
    writeFile("src/beta/nested/deep.ts");
    const policy = policyOf([
      {
        id: "alpha",
        roots: ["src/alpha"],
        managed: true,
        requires: ["beta"],
        publicEntrypoints: ["src/alpha/one.ts"],
        owner: "wangh",
      },
      {
        id: "beta",
        roots: ["src/beta"],
        managed: false,
        requires: [],
        publicEntrypoints: [],
      },
    ]);

    const pack = readPack(policy, "alpha", root);
    expect(pack.id).toBe("alpha");
    expect(pack.managed).toBe(true);
    expect(pack.entrypoints).toEqual(["src/alpha/one.ts"]);
    // 域内文件与测试分列——测试文件不混进实现清单
    expect(pack.domainFiles).toEqual(["src/alpha/one.ts", "src/alpha/two.ts"]);
    expect(pack.testFiles).toEqual(["src/alpha/one.test-utils.ts", "src/alpha/one.test.ts"]);
    // 邻接：beta 无收敛入口 → 顶层 .ts 作常用入口（不递归），fileCount 含嵌套
    expect(pack.adjacent).toHaveLength(1);
    const adj = pack.adjacent[0]!;
    expect(adj.id).toBe("beta");
    expect(adj.entrypoints).toEqual([]);
    expect(adj.topFiles).toEqual(["src/beta/core.ts", "src/beta/index.ts"]);
    expect(adj.fileCount).toBe(3);
  });

  it("邻接模块的 entrypoints 存在时优先给出（存在性过滤）", () => {
    writeFile("src/alpha/a.ts");
    writeFile("src/gamma/main.ts");
    const policy = policyOf([
      { id: "alpha", roots: ["src/alpha"], managed: true, requires: ["gamma"], publicEntrypoints: [] },
      // 声明了 entrypoint 但文件不存在——被存在性过滤剔除
      { id: "gamma", roots: ["src/gamma"], managed: true, requires: [], publicEntrypoints: ["src/gamma/gone.ts", "src/gamma/main.ts"] },
    ]);

    const pack = readPack(policy, "alpha", root);
    const adj = pack.adjacent[0]!;
    expect(adj.entrypoints).toEqual(["src/gamma/main.ts"]);
  });

  it("未知模块 id 类型化拒绝（列出可用 id）", () => {
    const policy = policyOf([{ id: "alpha", roots: ["src/alpha"], managed: true, requires: [] }]);
    expect(() => readPack(policy, "nope", root)).toThrow(/^未知模块 id/);
    expect(() => readPack(policy, "nope", root)).toThrow(/alpha/);
  });

  it("roots 目录不存在时文件清单为空（形状自检是 loadPolicy 的职责）", () => {
    const policy = policyOf([{ id: "ghost", roots: ["src/ghost"], managed: true, requires: [] }]);
    const pack = readPack(policy, "ghost", root);
    expect(pack.domainFiles).toEqual([]);
    expect(pack.testFiles).toEqual([]);
  });
});
