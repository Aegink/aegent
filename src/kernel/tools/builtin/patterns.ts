/**
 * 内置工具共用的小件：glob 模式匹配与目录遍历。
 *
 * 模式方言（P0 记录，与 C39（P1）对齐时再统一）：星星对跨目录段（尾随
 * "星星对加斜杠"可匹配零段）、单星段内任意（含点开头文件）、问号单字符，
 * 其余按字面量；匹配对象是相对搜索根的 posix 风格路径。
 * （本注释刻意不写 glob 原文——块注释内出现星斜杠会提前闭合注释。）
 */

import { readdir } from "node:fs/promises";
import * as path from "node:path";

/** 把 glob 模式编译为锚定的 RegExp。 */
export function globToRegExp(pattern: string): RegExp {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === undefined) break; // noUncheckedIndexedAccess 防御：i < length 恒真
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          re += "(?:.*/)?"; // "**/" 可选匹配零段（前缀目录）
          i += 2;
        } else {
          re += ".*"; // 尾随/中段 "**" 跨任意段
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`${re}$`);
}

/**
 * 深度优先收集 root 下的全部文件，返回 posix 风格相对路径（字母序稳定）。
 * 只收普通文件（符号链接/设备文件不进）；目录不可读时抛给调用方。
 */
export async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const visit = async (rel: string): Promise<void> => {
    const entries = await readdir(rel === "" ? root : path.join(root, rel), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) await visit(childRel);
      else if (entry.isFile()) out.push(childRel);
    }
  };
  await visit("");
  return out.sort();
}
