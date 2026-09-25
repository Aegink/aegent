/**
 * 构建资产拷贝（T-4-05）：tsc 只编译 .ts——工具描述 txt（B2 的
 * descriptions/*.txt）不进 dist，而 dist 是子进程（agent-child）与后续
 * CLI 交付的运行形态，缺描述会让装配即抛。这里把描述文件拷到与编译产物
 * 相同的相对位置。schema.sql 的同题（T-1 报告遗留记录）需要时在此一并处理。
 */

import { cpSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcDir = path.join(root, "src", "kernel", "tools", "descriptions");
const outDir = path.join(root, "dist", "src", "kernel", "tools", "descriptions");

if (!existsSync(srcDir)) throw new Error(`描述目录不存在：${srcDir}`);
const files = readdirSync(srcDir).filter((f) => f.endsWith(".txt"));
cpSync(srcDir, outDir, { recursive: true });
console.log(`copy-assets: ${String(files.length)} 个描述文件 → dist`);
