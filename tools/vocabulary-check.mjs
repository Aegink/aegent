/**
 * vocabulary:check —— 领域词汇表结构机检（T2/T-P1-122）。
 *
 * 纪律（zcode·CONTEXT.md 同款）：每词条必须有 `_Avoid_:` 行。
 * 词条形状：`**词条名**:` 开头的行开启一个词条，向下收集到下一个词条
 * 或 `###` 标题为止；区间内必须出现 `_Avoid_` 行，且定义非空。
 *
 * 用法：node tools/vocabulary-check.mjs [文件...]
 *   缺省检查 docs/vocabulary/*.md 全部。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VOCAB_DIR = path.join(REPO_ROOT, "docs", "vocabulary");

export function checkVocabularyFile(content, fileLabel) {
  const problems = [];
  const lines = content.split("\n");
  let current = null; // { name, line, hasAvoid, hasBody }
  const flush = () => {
    if (!current) return;
    if (!current.hasBody) problems.push(`${fileLabel}:词条 "${current.name}"（第 ${current.line} 行）定义缺失`);
    if (!current.hasAvoid) problems.push(`${fileLabel}:词条 "${current.name}"（第 ${current.line} 行）缺 _Avoid_ 行（T2 纪律）`);
    current = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const head = line.match(/^\*\*(.+?)\*\*/);
    if (head) {
      flush();
      current = { name: head[1], line: i + 1, hasAvoid: false, hasBody: false };
      continue;
    }
    if (/^#{2,3}\s/.test(line)) {
      flush();
      continue;
    }
    if (current) {
      if (/_Avoid_/.test(line)) current.hasAvoid = true;
      else if (line.trim() !== "" && !current.hasBody && !/^>/.test(line)) current.hasBody = true;
    }
  }
  flush();
  if (content.trim() !== "" && !/\*\*.+\*\*/.test(content)) {
    problems.push(`${fileLabel}:未发现任何词条（\`**名称**:\` 形状）`);
  }
  return problems;
}

export function main(argv = process.argv.slice(2)) {
  const files = argv.length > 0
    ? argv.map((f) => path.resolve(REPO_ROOT, f))
    : fs.readdirSync(VOCAB_DIR).filter((f) => f.endsWith(".md")).map((f) => path.join(VOCAB_DIR, f));
  if (files.length === 0) {
    console.error("vocabulary:check —— 无词汇表文件");
    return 1;
  }
  const problems = [];
  for (const f of files) {
    const label = path.relative(REPO_ROOT, f).replaceAll("\\", "/");
    if (!fs.existsSync(f)) {
      problems.push(`${label}:文件不存在`);
      continue;
    }
    problems.push(...checkVocabularyFile(fs.readFileSync(f, "utf8"), label));
  }
  for (const p of problems) console.error(`[vocabulary] ${p}`);
  console.error(`vocabulary:check —— ${files.length} 文件，${problems.length} 问题`);
  return problems.length > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
