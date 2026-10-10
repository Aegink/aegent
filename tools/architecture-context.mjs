#!/usr/bin/env node
/**
 * architecture:context —— 域上下文速查（T0-5，zcode scripts/architecture 同形状）。
 *
 * 用法：node tools/architecture-context.mjs <module-id>
 * 输出该域的 owner/managed/requires + 本域契约文件与公开入口 + 直接依赖各域的
 * 契约面——写插件/写代码前把"可依赖清单 + 公开面"一次性喂给模型。
 * 退出码：模块不存在 → 1。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPolicy, moduleOf, scanImports } from "./architecture-check.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 契约文件：contract.* 命名（zcode 惯例）或 contracts/ 目录下文件（core 契约面落点）。 */
const isContractFile = (abs) => {
  const base = path.basename(abs);
  return base.startsWith("contract.") || path.basename(path.dirname(abs)) === "contracts";
};

const posix = (p) => p.replaceAll("\\", "/");

export function generateContext(moduleId, repoRoot = REPO_ROOT) {
  const policy = loadPolicy(path.join(repoRoot, "architecture-policy.json"));
  const module = policy.modules.find((m) => m.id === moduleId);
  if (!module) {
    throw new Error(`未知模块: ${moduleId}（已知：${policy.modules.map((m) => m.id).join(", ")}）`);
  }
  const files = [];
  for (const rootDir of ["src", "plugins"]) {
    const abs = path.join(repoRoot, rootDir);
    if (fs.existsSync(abs)) files.push(...scanImports(abs).keys());
  }
  const moduleFiles = files.filter((f) => moduleOf(f, policy.modules, repoRoot) === moduleId);
  const contracts = moduleFiles.filter(isContractFile).map((f) => posix(path.relative(repoRoot, f)));

  const dependencyContracts = module.requires.flatMap((depId) => {
    const dep = policy.modules.find((m) => m.id === depId);
    if (!dep) return [];
    const depFiles = files.filter((f) => moduleOf(f, policy.modules, repoRoot) === depId);
    const depContracts = depFiles.filter(isContractFile).map((f) => posix(path.relative(repoRoot, f)));
    const lines = depContracts.map((f) => `- ${f}`);
    if (dep.publicEntrypoints.length > 0) lines.push(...dep.publicEntrypoints.map((e) => `- public: ${e}`));
    if (lines.length === 0) lines.push(`- ${depId}：（无契约文件与公开入口——依赖前先补契约）`);
    return lines;
  });

  return [
    `# Architecture context: ${module.id}`,
    `owner: ${module.owner ?? "unassigned"}`,
    `managed: ${module.managed}`,
    `requires: ${module.requires.join(", ") || "none"}`,
    "",
    "## Contract files & public entrypoints",
    ...(contracts.length > 0 ? contracts.map((f) => `- ${f}`) : ["- （本域暂无契约文件）"]),
    ...(module.publicEntrypoints.length > 0
      ? module.publicEntrypoints.map((e) => `- public: ${e}`)
      : ["- publicEntrypoints：（未声明——深导入检查未激活）"]),
    "",
    "## Direct dependency contracts",
    ...(dependencyContracts.length > 0 ? dependencyContracts : ["- none（requires 为空——本域零跨域依赖）"]),
    "",
    "## Boundaries",
    "- 跨域 import 必须落在本域 requires 白名单与对方 publicEntrypoints 之内（architecture-check 强制）。",
    "- 新增能力先落契约（contracts/ 或 contract.*）再写实现；契约文件受 maxContractLines/maxPublicMethods 约束。",
  ].join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const moduleId = argv[0];
  if (!moduleId) {
    console.error("用法: node tools/architecture-context.mjs <module-id>");
    console.error(`已知模块: ${loadPolicy(path.join(REPO_ROOT, "architecture-policy.json")).modules.map((m) => m.id).join(", ")}`);
    return 1;
  }
  console.log(generateContext(moduleId));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
