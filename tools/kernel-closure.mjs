/**
 * W19 内核传递闭包分析（一次性工程脚本）：从全仓 ts import 图算出
 * "内核必需文件集"——排除宿主面（host/cli/acp/ui/tauri）后，内核文件之间
 * 的依赖是否闭合；输出缺口清单（内核文件引用了非内核文件的边）。
 *
 * 用法：node tools/kernel-closure.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// 宿主面（不进内核仓——产品外壳）
const HOST_DOMAINS = ["host", "cli", "acp", "sync", "ui"];
// 内核候选域（src/ 下）
const SRC_DOMAINS = readdirSync(path.join(ROOT, "src")).filter((d) =>
  statSync(path.join(ROOT, "src", d)).isDirectory(),
);
const CORE_DOMAINS = SRC_DOMAINS.filter((d) => !HOST_DOMAINS.includes(d));
// plugins/tools-builtin 是内核装配线硬依赖——一并纳入
const EXTRA_ROOTS = ["plugins/tools-builtin", "plugins"];

function listTs(relDir) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === "node_modules" || name === "target") continue;
        walk(p);
      } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
        out.push(path.relative(ROOT, p).replace(/\\/g, "/"));
      }
    }
  };
  if (existsSync(path.join(ROOT, relDir))) walk(path.join(ROOT, relDir));
  return out;
}

// 全仓 ts 文件（src + plugins）
const allFiles = [...listTs("src"), ...listTs("plugins")];
const isTest = (f) => f.endsWith(".test.ts") || f.endsWith(".test-utils.ts");

// import 解析：静态 from "..." + 动态 import("...")
const IMPORT_RE = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;

function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".")) return null; // 外部包/node 内置
  const base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  const cands = [base, base + ".ts", base + ".tsx", base + "/index.ts", base.replace(/\.js$/, ".ts")];
  for (const c of cands) {
    if (existsSync(c) && statSync(c).isFile()) return path.relative(ROOT, c).replace(/\\/g, "/");
  }
  return `UNRESOLVED:${spec}`;
}

// 内核候选集：非宿主域 src 文件 + plugins/tools-builtin
const kernelSet = new Set(
  allFiles.filter((f) => {
    if (f.startsWith("plugins/")) return true;
    const domain = f.split("/")[1];
    return CORE_DOMAINS.includes(domain);
  }),
);

// 缺口：内核文件 → 非内核文件（或未解析）的边
const gaps = [];
const testGaps = [];
for (const f of kernelSet) {
  const src = readFileSync(path.join(ROOT, f), "utf8");
  for (const m of src.matchAll(IMPORT_RE)) {
    const target = resolveImport(f, m[1]);
    if (target === null) continue;
    if (target.startsWith("UNRESOLVED")) {
      gaps.push({ from: f, to: target, spec: m[1] });
      continue;
    }
    if (!kernelSet.has(target)) {
      (isTest(f) ? testGaps : gaps).push({ from: f, to: target });
    }
  }
}

// 汇总：非内核依赖按域统计
const byDomain = new Map();
for (const g of gaps) {
  const domain = g.to.startsWith("UNRESOLVED") ? "UNRESOLVED" : g.to.split("/")[1];
  if (!byDomain.has(domain)) byDomain.set(domain, new Set());
  byDomain.get(domain).add(`${g.from} → ${g.to}`);
}
const byDomainTest = new Map();
for (const g of testGaps) {
  const domain = g.to.split("/")[1];
  if (!byDomainTest.has(domain)) byDomainTest.set(domain, new Set());
  byDomainTest.get(domain).add(`${g.from} → ${g.to}`);
}

console.log(`内核候选集：${kernelSet.size} 文件（非测试 ${[...kernelSet].filter((f) => !isTest(f)).length}）`);
console.log(`\n== 生产代码缺口（内核 → 非内核）==`);
if (byDomain.size === 0) console.log("（无——闭包完整）");
for (const [domain, edges] of [...byDomain].sort()) {
  console.log(`\n[${domain}] ${edges.size} 条：`);
  for (const e of [...edges].slice(0, 12)) console.log(`  ${e}`);
}
console.log(`\n== 测试代码缺口 ==`);
if (byDomainTest.size === 0) console.log("（无）");
for (const [domain, edges] of [...byDomainTest].sort()) {
  console.log(`[${domain}] ${edges.size} 条：`);
  for (const e of [...edges].slice(0, 8)) console.log(`  ${e}`);
}
