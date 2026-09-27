/**
 * architecture:check —— 架构即代码检查器（T1/T-P1-121）。
 *
 * 依据 architecture-policy.json 校验五类规则：
 *   1. 策略文件形状自检（id 重复 / roots 不存在 / requires 未知引用 / exceptions 缺 reason）；
 *   2. 模块依赖白名单：跨模块 import 必须落在该模块 requires 声明内
 *      （测试文件 *.test.ts / *.test-utils.ts 的出边不检查——测试可以 import
 *      任何被测面，这是测试的性质，卡面定形记档）；
 *   3. forbidDeepImports：跨模块 import 目标必须是该模块 publicEntrypoints
 *      之一（entrypoints 缺省为空的模块跳过——入口清单未收敛的域不激活）；
 *   4. forbidCycles：模块依赖图环检测（实际 import 边，与白名单无关）——
 *      环上全部节点 managed=true 才硬失败，否则警告（渐进采用：存量
 *      kernel↔context/session/models/policy/sandbox 的装配中心双向边按
 *      警告记档，新代码成环即失败）；
 *   5. maxFileLines：模块内 .ts 文件行数上限（exceptions 逐路径豁免）。
 *
 * 渐进采用（zcode 同语义）：managed=false 域的违规降级为警告（[warn]），
 * managed=true 域违规是错误（[error]）；退出码只看 error。
 *
 * 用法：
 *   node tools/architecture-check.mjs             # 全量
 *   node tools/architecture-check.mjs --changed   # 只查工作树改动（vs HEAD）
 *   node tools/architecture-check.mjs --changed main  # vs 指定基线
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = path.join(REPO_ROOT, "architecture-policy.json");

// ---------------------------------------------------------------------------
// 策略加载与形状自检
// ---------------------------------------------------------------------------

export function loadPolicy(policyPath = POLICY_PATH) {
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  assertPolicyShape(policy, policyPath);
  return policy;
}

export function assertPolicyShape(policy, policyPath = POLICY_PATH, repoRoot = REPO_ROOT) {
  const problems = [];
  const ids = new Set();
  if (policy.version !== 1) problems.push(`version 必须是 1，得到 ${JSON.stringify(policy.version)}`);
  if (!Array.isArray(policy.modules) || policy.modules.length === 0) {
    problems.push("modules 必须是非空数组");
  }
  for (const m of policy.modules ?? []) {
    if (!m.id || typeof m.id !== "string") problems.push(`模块缺 id：${JSON.stringify(m)}`);
    else if (ids.has(m.id)) problems.push(`模块 id 重复：${m.id}`);
    else ids.add(m.id);
    for (const r of m.roots ?? []) {
      if (!fs.existsSync(path.resolve(repoRoot, r))) {
        problems.push(`模块 ${m.id} 的 root 不存在：${r}`);
      }
    }
    if (!Array.isArray(m.roots) || m.roots.length === 0) problems.push(`模块 ${m.id} 缺 roots`);
  }
  for (const m of policy.modules ?? []) {
    for (const req of m.requires ?? []) {
      if (!ids.has(req)) problems.push(`模块 ${m.id} requires 未声明的模块：${req}`);
    }
  }
  for (const e of policy.exceptions ?? []) {
    if (!e.path || !e.reason) problems.push(`exception 必须带 path 与 reason：${JSON.stringify(e)}`);
  }
  if (problems.length > 0) {
    throw new Error(`策略文件形状非法（${policyPath}）:\n  ${problems.join("\n  ")}`);
  }
}

// ---------------------------------------------------------------------------
// import 扫描与模块归属
// ---------------------------------------------------------------------------

/** 扫描目录下全部 .ts 文件的相对 import（`from "..."` 与裸 `import "..."`）。 */
export function scanImports(rootDir) {
  const files = [];
  walkTs(rootDir, files);
  const graph = new Map(); // posix abs path -> posix rel import targets (resolved, .ts)
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const specs = [];
    for (const m of src.matchAll(/(?:from\s+|import\s+)["'](\.[^"']+)["']/g)) specs.push(m[1]);
    const targets = specs
      .map((s) => resolveSpec(f, s))
      .filter((t) => t !== null);
    graph.set(f, targets);
  }
  return graph;
}

function walkTs(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTs(p, out);
    else if (e.name.endsWith(".ts")) out.push(p);
  }
}

/** ESM 后缀风格：`./x.js` 实指 x.ts；解析失败返回 null（非本仓文件）。 */
export function resolveSpec(fromFile, spec) {
  const resolved = path.resolve(path.dirname(fromFile), spec);
  const candidates = [resolved];
  if (resolved.endsWith(".js")) candidates.push(resolved.slice(0, -3) + ".ts");
  for (const c of candidates) {
    if (fs.existsSync(c) && c.endsWith(".ts")) return c;
  }
  return null;
}

/** 文件 → 模块 id；不属于任何模块返回 null。 */
export function moduleOf(file, modules, repoRoot = REPO_ROOT) {
  const posix = file.replaceAll("\\", "/");
  for (const m of modules) {
    for (const root of m.roots) {
      const rootAbs = path.resolve(repoRoot, root).replaceAll("\\", "/");
      if (posix === rootAbs || posix.startsWith(rootAbs + "/")) return m.id;
    }
  }
  return null;
}

const isTestFile = (f) => {
  const base = path.basename(f);
  return base.endsWith(".test.ts") || base.endsWith(".test-utils.ts");
};

// ---------------------------------------------------------------------------
// 环检测（模块级 DFS）
// ---------------------------------------------------------------------------

export function findCycles(edges) {
  // edges: Map<moduleId, Set<moduleId>>（实际 import 边）；返回环列表（每个环为排序后的节点数组）。
  // 模块数小（<20），用双向可达法（显然正确）：v 的 SCC = {v} ∪ (正向可达 ∩ 反向可达)，
  // 大小 >1 或含自环的 SCC 即环。
  const ids = [...edges.keys()];
  const forwardOf = {};
  const backwardOf = {};
  for (const v of ids) {
    forwardOf[v] = reachable(v, (n) => edges.get(n) ?? new Set());
    backwardOf[v] = reachable(v, (n) => {
      const back = new Set();
      for (const [from, tos] of edges) if (tos.has(n)) back.add(from);
      return back;
    });
  }
  const seen = new Set();
  const cycles = [];
  for (const v of ids) {
    // v 在环中 ⟺ v 自身可达（forwardOf 含 v）；自环单独判
    const scc = [...forwardOf[v]].filter((x) => backwardOf[v].has(x));
    if (scc.length === 0) {
      if (!(edges.get(v) ?? new Set()).has(v)) continue;
      scc.push(v);
    }
    const key = [...scc].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    cycles.push(scc.sort());
  }
  return cycles;
}

function reachable(start, neighborsOf) {
  const seen = new Set();
  const queue = [...neighborsOf(start)];
  while (queue.length > 0) {
    const n = queue.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of neighborsOf(n)) if (!seen.has(m)) queue.push(m);
  }
  return seen;
}

// ---------------------------------------------------------------------------
// 主检查
// ---------------------------------------------------------------------------

/**
 * @returns {{errors: string[], warnings: string[]}}
 */
export function checkArchitecture(policy, opts = {}) {
  const { changedFiles = null, repoRoot = REPO_ROOT } = opts;
  const errors = [];
  const warnings = [];
  const managedOf = (id) => policy.modules.find((m) => m.id === id)?.managed ?? false;
  const fail = (managed, msg) => (managed ? errors.push(msg) : warnings.push(msg));

  const graph = scanImports(path.join(repoRoot, "src"));
  const rel = (abs) => abs.replaceAll("\\", "/").slice(repoRoot.replaceAll("\\", "/").length + 1);

  // 实际模块依赖边（仅非测试文件出边——测试可以 import 任何被测面，
  // 测试边不构成运行时依赖也不参与白名单/深导入/环检查；卡面定形）
  const moduleEdges = new Map();
  const maxLines = policy.global?.maxFileLines ?? Infinity;
  const exceptionPaths = new Set((policy.exceptions ?? []).map((e) => path.resolve(repoRoot, e.path).replaceAll("\\", "/")));

  for (const [file, targets] of graph) {
    const fromId = moduleOf(file, policy.modules, repoRoot);
    if (fromId === null) {
      warnings.push(`[unowned] ${rel(file)} 不属于任何模块（未纳入 architecture-policy.json）`);
      continue;
    }
    const managed = managedOf(fromId);

    // 行数上限（只对模块内文件；exceptions 豁免）
    if (!exceptionPaths.has(file.replaceAll("\\", "/"))) {
      const lines = fs.readFileSync(file, "utf8").split("\n").length;
      if (lines > maxLines) {
        fail(managed, `[maxFileLines] ${rel(file)} ${lines} 行 > 上限 ${maxLines}（模块 ${fromId}）`);
      }
    }

    for (const target of targets) {
      const toId = moduleOf(target, policy.modules, repoRoot);
      if (toId === null || toId === fromId) continue;
      // 测试文件出边不参与白名单/深导入/环边图（测试性质——卡面定形）
      if (isTestFile(file)) continue;
      if (!moduleEdges.get(fromId)) moduleEdges.set(fromId, new Set());
      moduleEdges.get(fromId).add(toId);
      const mod = policy.modules.find((m) => m.id === fromId);
      if (!(mod.requires ?? []).includes(toId)) {
        fail(managed, `[requires] ${rel(file)} import ${rel(target)}（模块 ${toId}）——未在模块 ${fromId} 的 requires 白名单声明`);
      }
      // 深导入：目标域声明了 entrypoints 才激活
      const targetMod = policy.modules.find((m) => m.id === toId);
      const entries = targetMod?.publicEntrypoints ?? [];
      if (policy.global?.forbidDeepImports && entries.length > 0) {
        const entryAbs = entries.map((e) => path.resolve(repoRoot, e).replaceAll("\\", "/"));
        if (!entryAbs.includes(target.replaceAll("\\", "/"))) {
          fail(managed, `[deep-import] ${rel(file)} import ${rel(target)}——模块 ${toId} 公开入口之外（深导入）`);
        }
      }
    }
  }

  // 环检测：环上全部 managed=true 才硬失败
  if (policy.global?.forbidCycles) {
    for (const cycle of findCycles(moduleEdges)) {
      const allManaged = cycle.every((id) => managedOf(id));
      fail(
        allManaged,
        `[cycle] 模块依赖环：${cycle.join(" -> ")} -> ${cycle[0]}${allManaged ? "" : "（含存量域——渐进收紧路线）"}`,
      );
    }
  }

  // --changed 过滤：只保留与改动文件相关的违规（环检测是全图性质，保留）
  if (changedFiles) {
    const changedSet = new Set(changedFiles.map((f) => path.resolve(repoRoot, f).replaceAll("\\", "/")));
    const relevant = (msg) => {
      if (msg.startsWith("[cycle]")) return true; // 环是全图结构性质，不按文件过滤
      const m = msg.match(/\] (\S+) /);
      if (!m) return true;
      const abs = path.resolve(repoRoot, m[1]).replaceAll("\\", "/");
      return changedSet.has(abs);
    };
    return {
      errors: errors.filter(relevant),
      warnings: warnings.filter(relevant),
    };
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// CLI 入口
// ---------------------------------------------------------------------------

export function main(argv = process.argv.slice(2)) {
  const policy = loadPolicy();
  let changedFiles = null;
  const changedIdx = argv.indexOf("--changed");
  if (changedIdx !== -1) {
    const ref = argv[changedIdx + 1] && !argv[changedIdx + 1].startsWith("--") ? argv[changedIdx + 1] : "HEAD";
    const out = execFileSync("git", ["diff", "--name-only", ref], { cwd: REPO_ROOT, encoding: "utf8" });
    changedFiles = out.split("\n").map((s) => s.trim()).filter(Boolean);
  }
  const { errors, warnings } = checkArchitecture(policy, { changedFiles });
  for (const e of errors) console.error(`[error] ${e}`);
  for (const w of warnings) console.error(`[warn] ${w}`);
  console.error(`architecture:check —— ${errors.length} error / ${warnings.length} warning${changedFiles ? `（--changed ${changedFiles.length} 文件）` : ""}`);
  return errors.length > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
