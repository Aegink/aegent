/**
 * architecture:read —— 模块阅读包命令（T3/T-P2-501）。
 *
 * 给定模块 id，产出"读该模块所需的上下文包"：本模块入口与域内文件清单 +
 * requires 邻接模块的入口/顶层文件 + 测试文件清单。依据与 architecture:check
 * 同源的 architecture-policy.json（元数据驱动——policy 是单一事实源）。
 *
 * 用法：
 *   node tools/architecture-read.mjs host          # 人读文本到 stdout
 *   node tools/architecture-read.mjs host --json   # JSON（机器消费）
 *
 * 未知模块 id 退出码 1（类型化错误信息列出可用 id）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPolicy } from "./architecture-check.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 递归收集 dir 下所有 .ts 文件（相对 repoRoot 的 posix 路径；目录不存在返回空——形状自检是 loadPolicy 的职责）。 */
function collectTsFiles(repoRoot, root, { recursive = true } = {}) {
  const absRoot = path.resolve(repoRoot, root);
  if (!fs.existsSync(absRoot)) return [];
  const out = [];
  const walk = (abs) => {
    for (const name of fs.readdirSync(abs).sort()) {
      if (name === "node_modules") continue;
      const absPath = path.join(abs, name);
      const stat = fs.statSync(absPath);
      if (stat.isDirectory()) {
        if (recursive) walk(absPath);
      } else if (name.endsWith(".ts")) {
        out.push(path.relative(repoRoot, absPath).split(path.sep).join("/"));
      }
    }
  };
  walk(absRoot);
  return out;
}

const isTestFile = (f) => f.endsWith(".test.ts") || f.endsWith(".test-utils.ts");

/**
 * 组装阅读包（纯函数——fixture 测试直接喂临时 policy + 临时 repoRoot）。
 * 未知模块 id 抛 Error（message 以 "未知模块 id" 起头并列出可用 id）。
 */
export function collectReadingPack(policy, moduleId, repoRoot = REPO_ROOT) {
  const module = (policy.modules ?? []).find((m) => m.id === moduleId);
  if (!module) {
    const available = (policy.modules ?? []).map((m) => m.id).join(", ");
    throw new Error(`未知模块 id：${JSON.stringify(moduleId)}。可用模块：${available}`);
  }

  const allFiles = module.roots.flatMap((r) => collectTsFiles(repoRoot, r));
  const domainFiles = allFiles.filter((f) => !isTestFile(f));
  const testFiles = allFiles.filter(isTestFile);
  const entrypoints = (module.publicEntrypoints ?? []).filter((e) =>
    fs.existsSync(path.resolve(repoRoot, e)),
  );

  // 邻接模块：entrypoints 优先（深导入收敛面）；未收敛的域给顶层 .ts 作常用入口
  const adjacent = (module.requires ?? []).map((reqId) => {
    const dep = (policy.modules ?? []).find((m) => m.id === reqId);
    if (!dep) return { id: reqId, missing: true };
    const depEntry = (dep.publicEntrypoints ?? []).filter((e) =>
      fs.existsSync(path.resolve(repoRoot, e)),
    );
    const depTop = dep.roots.flatMap((r) => collectTsFiles(repoRoot, r, { recursive: false }));
    return {
      id: reqId,
      entrypoints: depEntry,
      topFiles: depTop,
      fileCount: dep.roots.flatMap((r) => collectTsFiles(repoRoot, r)).length,
    };
  });

  return {
    id: module.id,
    roots: module.roots,
    managed: module.managed === true,
    owner: module.owner ?? null,
    requires: module.requires ?? [],
    entrypoints,
    domainFiles,
    testFiles,
    adjacent,
  };
}

function renderText(pack) {
  const lines = [];
  lines.push(`# 阅读包：${pack.id}（${pack.managed ? "managed" : "unmanaged"}）`);
  lines.push(`roots: ${pack.roots.join(", ")}${pack.owner ? ` · owner: ${pack.owner}` : ""}`);
  lines.push("");
  lines.push(`## 入口 publicEntrypoints（${pack.entrypoints.length}）`);
  if (pack.entrypoints.length === 0) lines.push("  （未收敛——深导入检查未激活）");
  for (const e of pack.entrypoints) lines.push(`  ${e}`);
  lines.push("");
  lines.push(`## 域内文件（实现 ${pack.domainFiles.length} + 测试 ${pack.testFiles.length}）`);
  for (const f of pack.domainFiles) lines.push(`  ${f}`);
  if (pack.testFiles.length > 0) lines.push("  —— 测试 ——");
  for (const f of pack.testFiles) lines.push(`  ${f}`);
  lines.push("");
  lines.push(`## requires 邻接（${pack.adjacent.length}）—— 读本模块前先看这些`);
  for (const adj of pack.adjacent) {
    if (adj.missing) {
      lines.push(`### ${adj.id}（policy 未定义此模块——requires 引用悬空）`);
      continue;
    }
    const entryNote = adj.entrypoints.length > 0 ? `入口 ${adj.entrypoints.join(", ")}` : "无收敛入口";
    lines.push(`### ${adj.id}（${entryNote}；域内 ${adj.fileCount} 个 .ts）`);
    for (const e of adj.entrypoints) lines.push(`  ${e}`);
    for (const f of adj.topFiles) lines.push(`  ${f}`);
  }
  return lines.join("\n");
}

function main(argv) {
  const args = argv.filter((a) => a !== "--json");
  const json = args.length !== argv.length;
  if (args.length !== 1) {
    console.error("用法：node tools/architecture-read.mjs <模块id> [--json]");
    process.exit(2);
  }
  const policy = loadPolicy();
  let pack;
  try {
    pack = collectReadingPack(policy, args[0], REPO_ROOT);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
  if (json) {
    console.log(JSON.stringify(pack, null, 2));
  } else {
    console.log(renderText(pack));
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main(process.argv.slice(2));
