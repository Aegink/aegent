/**
 * 构建资产拷贝（T-4-05）：tsc 只编译 .ts——工具描述 txt（B2 的
 * descriptions/*.txt）不进 dist，而 dist 是子进程（agent-child）与后续
 * CLI 交付的运行形态，缺描述会让装配即抛。这里把运行时读取的伴生资产
 * 拷到与编译产物相同的相对位置。新增运行时资产（如 T-6-02 的权限模板
 * md）在此追加清单。
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const assets = [
  {
    src: path.join(root, "plugins", "tools-builtin", "descriptions"),
    out: path.join(root, "dist", "plugins", "tools-builtin", "descriptions"),
    label: "工具描述",
  },
  {
    src: path.join(root, "src", "sandbox", "templates"),
    out: path.join(root, "dist", "src", "sandbox", "templates"),
    label: "权限模板",
  },
  {
    src: path.join(root, "src", "context", "prompt"),
    out: path.join(root, "dist", "src", "context", "prompt"),
    label: "基础提示",
  },
  {
    src: path.join(root, "src", "sandbox", "dpapi"),
    out: path.join(root, "dist", "src", "sandbox", "dpapi"),
    label: "DPAPI helper",
  },
  {
    src: path.join(root, "src", "session", "schema.sql"),
    out: path.join(root, "dist", "src", "session", "schema.sql"),
    label: "schema.sql（SQLite 建库 DDL，T-8-01）",
    file: true,
  },
];

for (const { src, out, label, file } of assets) {
  if (file) {
    mkdirSync(path.dirname(out), { recursive: true });
    copyFileSync(src, out);
    console.log(`copy-assets: ${label} 1 项 → dist`);
    continue;
  }
  if (!existsSync(src)) throw new Error(`${label}目录不存在：${src}`);
  cpSync(src, out, { recursive: true });
  const files = readdirSync(src, { recursive: true }).filter(
    (f) => typeof f === "string" && !f.endsWith(path.sep),
  );
  console.log(`copy-assets: ${label} ${String(files.length)} 项 → dist`);
}

// T-P3-155 A1：构建信息注入（qwen generate-git-commit-info 模式）——版本
// 自 package.json 单源 + git short SHA + 构建时间；host about-info op 读取。
{
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim();
  } catch {
    // 非 git 环境（打包机）——unknown 占位
  }
  const buildInfo = {
    version: pkg.version,
    gitCommit: commit,
    buildTime: new Date().toISOString(),
  };
  writeFileSync(path.join(root, "dist", "build-info.json"), JSON.stringify(buildInfo, null, 2), "utf8");
  console.log(`copy-assets: build-info.json（v${buildInfo.version} @ ${commit}）→ dist`);
}
