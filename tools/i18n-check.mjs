#!/usr/bin/env node
/**
 * i18n 覆盖检查（D 级债务 5 清偿的收口工具——渐进覆盖的度量面）：扫描
 * ui/ 里 t("…") 的静态调用与 index.html 的 data-i18n* 属性，与 en-US
 * 词典键取差集。**只报告不阻断**——中文原文即键的回退语义保证未覆盖键
 * 不破坏功能；本脚本让"还差多少"可度量（每次补录批次跑一次）。
 *
 * 运行：node tools/i18n-check.mjs（exit 0 恒定——报告性工具）。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UI = path.join(root, "ui");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "vendor") continue; // 第三方库（xterm 等）不进扫描面
      walk(full, out);
    } else if (name.endsWith(".js") && !name.endsWith(".test.js")) out.push(full);
  }
  return out;
}

const used = new Set();
for (const file of walk(UI)) {
  const src = readFileSync(file, "utf8");
  // t("中文") / t(`中文`)（静态首参——模板插值首参不可静态分析，忽略）
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) used.add(JSON.parse(`"${m[1]}"`));
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) used.add(m[1]);
}
const html = readFileSync(path.join(UI, "index.html"), "utf8");
for (const m of html.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]*)"/g)) used.add(m[1]);

const { MESSAGES } = await import(pathToFileURL(path.join(UI, "locales", "en-US.js")).href);
const missing = [...used].filter((k) => !(k in MESSAGES)).sort();
const dictOnly = Object.keys(MESSAGES).filter((k) => !used.has(k)).length;

console.log(`i18n 覆盖检查：静态调用 ${used.size} 键 / 词典 ${Object.keys(MESSAGES).length} 键（未引用 ${dictOnly}）`);
if (missing.length === 0) {
  console.log("全部静态调用已覆盖 ✅");
} else {
  console.log(`未覆盖 ${missing.length} 键（回退中文原文——渐进补录清单）：`);
  for (const key of missing) console.log(`  - ${key}`);
}
