/**
 * 内置工具注册入口（B3）：装配处一行把内置工具挂上注册表。
 * P0 六个 = read/write/bash（T-4-02）+ edit/glob/grep（T-4-03）。
 *
 * 路径守卫（T-6-01）：四个文件工具（read/write/edit/bash）类型上必收
 * PathGuard——缺省守卫 = 进程 cwd（装配面可显式注入覆盖）。glob/grep
 * 只读且 P0 读面不限，不接守卫（见 path-guard 头注释 LIMITATIONS #5）。
 */

import { PathGuard } from "../../../sandbox/path-guard.js";
import type { ToolRegistry } from "../registry.js";
import { WriteQueue } from "../write-queue.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createGlobTool } from "./glob.js";
import { createGrepTool } from "./grep.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

/** 内置工具名清单（C45 linter 的 unknown-tool 判定缺省面；与
 * registerBuiltinTools 的注册清单同步维护，新增工具两处都加）。 */
export const BUILTIN_TOOL_NAMES = [
  "read",
  "write",
  "bash",
  "edit",
  "glob",
  "grep",
] as const;

export function registerBuiltinTools(
  registry: ToolRegistry,
  options: { pathGuard?: PathGuard } = {},
): void {
  const guard = options.pathGuard ?? PathGuard.forWorkspace(process.cwd());
  // B4：write/edit 共享一个写队列（同路径互斥、异路径并行）
  const writeQueue = new WriteQueue();
  for (const def of [
    createReadTool({ pathGuard: guard }),
    createWriteTool({ writeQueue, pathGuard: guard }),
    createBashTool({ pathGuard: guard }),
    createEditTool({ writeQueue, pathGuard: guard }),
    createGlobTool(),
    createGrepTool(),
  ]) {
    registry.registerTool(def);
  }
}
