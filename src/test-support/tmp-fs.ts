/**
 * 测试夹具落盘助手（T-6-01）：集中在这里，使 src/kernel/tools/builtin/
 * 目录内不再出现 node:fs 写函数字面量——卡面验收的 grep 证伪按字面匹配
 * （writeFileSync 含 writeFile 子串，夹具也算命中）。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

/** 建父目录后同步落一个文本文件（夹具专用，不走被测代码）。 */
export function seedTextFile(absPath: string, content: string): void {
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, "utf8");
}
