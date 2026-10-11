/**
 * 内置模型目录生成器（W18——pi models.generated.ts 数据化模式）：
 *   数据源 ①  ui/model-catalog.json（models.dev api.json 裁剪快照，2646 模型
 *             尾段索引——ctx/out/img/pdf/lv 缩写字段，机器来源 verified:false）
 *   数据源 ②  src/models/catalog-data.ts（人工核对精选覆盖层，verified 保留）
 *   输出    →  src/models/catalog.generated.ts（运行时目录：②覆盖①，同
 *             (adapter,id) 键命中时覆盖层优先）
 *
 * 用法：
 *   node tools/generate-model-catalog.mjs            # 生成（校验 + 写出）
 *   node tools/generate-model-catalog.mjs --check    # 校验 data/generated 同步（零写出）
 *
 * 校验：id 非空、contextWindow/maxOutputTokens 正整数、thinkingLevels ⊆
 * THINKING_LEVELS 闭集（与 session/settings.ts 字面量同值）、adapter 闭集、
 * (adapter,id) 无重复。
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI_JSON = path.join(ROOT, "ui", "model-catalog.json");
const DATA_TS = path.join(ROOT, "src", "models", "catalog-data.ts");
const OUT_TS = path.join(ROOT, "src", "models", "catalog.generated.ts");

const ADAPTERS = new Set(["openai", "openai-responses", "anthropic", "google"]);
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

const overrides = (await import(pathToFileURL(DATA_TS).href)).CATALOG_DATA_OVERRIDES;
const big = JSON.parse(readFileSync(UI_JSON, "utf8"));

// ---- ①大数据映射（models.dev 缩写字段 → spec 全字段；机器来源）----
const fromBig = [];
const modelsIndex = big.models ?? {};
for (const [id, m] of Object.entries(modelsIndex)) {
  if (typeof id !== "string" || id === "" || m === null || typeof m !== "object") {
    throw new Error(`目录数据条目非法：${id}`);
  }
  for (const [field, value] of [["ctx", m.ctx], ["out", m.out]]) {
    if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value <= 0)) {
      throw new Error(`目录条目 ${id}.${field} 须为正整数：${String(value)}`);
    }
  }
  if (m.lv !== undefined && (!Array.isArray(m.lv) || m.lv.some((l) => !THINKING_LEVELS.has(l)))) {
    throw new Error(`目录条目 ${id}.lv 含闭集外思考档：${JSON.stringify(m.lv)}`);
  }
  if (m.adapter !== undefined && !ADAPTERS.has(m.adapter)) {
    throw new Error(`目录条目 ${id}.adapter 闭集外：${m.adapter}`);
  }
  fromBig.push({
    id,
    ...(m.adapter !== undefined ? { adapter: m.adapter } : {}),
    ...(m.ctx !== undefined ? { contextWindow: m.ctx } : {}),
    ...(m.out !== undefined ? { maxOutputTokens: m.out } : {}),
    ...(Array.isArray(m.lv) && m.lv.length > 0 ? { thinkingLevels: [...m.lv] } : {}),
    ...(m.img === 1 ? { imageInput: true } : {}),
    ...(m.pdf === 1 ? { pdfInput: true } : {}),
    verified: false,
  });
}

// ---- ②覆盖层合并（人工核对优先：覆盖层条目 id 命中时，大数据同 id 条目
// 全部不进目录——beta/变体配置的机器值不越过人工核对值）----
const overrideIds = new Set(overrides.map((e) => e.id));
const keyOf = (e) => `${e.adapter ?? "*"}::${e.id}`;
const merged = new Map();
for (const entry of fromBig) {
  if (!overrideIds.has(entry.id)) merged.set(keyOf(entry), entry);
}
for (const entry of overrides) {
  // 覆盖层校验（生成器即校验器——数据坏在源头爆出）
  if (typeof entry.id !== "string" || entry.id === "") throw new Error("覆盖层条目 id 缺失");
  if (entry.adapter !== undefined && !ADAPTERS.has(entry.adapter)) {
    throw new Error(`覆盖层条目 ${entry.id}.adapter 闭集外：${entry.adapter}`);
  }
  for (const [field, value] of [["contextWindow", entry.contextWindow], ["maxOutputTokens", entry.maxOutputTokens]]) {
    if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value <= 0)) {
      throw new Error(`覆盖层条目 ${entry.id}.${field} 须为正整数`);
    }
  }
  if (entry.thinkingLevels !== undefined && entry.thinkingLevels.some((l) => !THINKING_LEVELS.has(l))) {
    throw new Error(`覆盖层条目 ${entry.id}.thinkingLevels 含闭集外档位`);
  }
  merged.set(keyOf(entry), entry);
}
const catalog = [...merged.values()].sort((a, b) =>
  a.id === b.id ? (a.adapter ?? "").localeCompare(b.adapter ?? "") : a.id.localeCompare(b.id),
);
const ids = new Set(catalog.map((e) => keyOf(e)));
if (ids.size !== catalog.length) throw new Error("合并后存在 (adapter,id) 重复条目");

// ---- 输出（generated 是冻结边界——不手工改）----
const header = `/**
 * 内置模型目录·生成产物（W18 数据化——**不手工编辑**）。
 * 来源：ui/model-catalog.json（models.dev 裁剪快照，机器条目 verified:false）
 *   + src/models/catalog-data.ts（人工核对覆盖层，verified 保留，同键优先）。
 * 再生成：node tools/generate-model-catalog.mjs（--check 校验同步）。
 * 条目数：${catalog.length}（覆盖层 ${overrides.length} / 大数据 ${fromBig.length}）。
 */
import type { BuiltinModelSpec } from "./catalog-data.js";

export const CATALOG_GENERATED: readonly BuiltinModelSpec[] = `;
const body = JSON.stringify(catalog, null, 2)
    .replace(/"([a-zA-Z][a-zA-Z0-9_]*)":/g, "$1: ")
    .replace(/\n/g, "\n  ");
const content = `${header}${body.replace(/^\[/, "[\n  ").replace(/\]$/, "\n]")};\n`;

if (process.argv.includes("--check")) {
  const current = readFileSync(OUT_TS, "utf8");
  if (current !== content) {
    console.error("catalog.generated.ts 与数据源不同步——请运行 node tools/generate-model-catalog.mjs");
    process.exit(1);
  }
  console.log(`catalog --check ✓（${catalog.length} 条目同步）`);
} else {
  writeFileSync(OUT_TS, content, "utf8");
  console.log(`catalog.generated.ts ← ${overrides.length} 覆盖层 + ${fromBig.length} 大数据 = ${catalog.length} 条目`);
}
