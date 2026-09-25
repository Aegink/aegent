/**
 * 内置工具注册入口（B3）：装配处一行把内置工具挂上注册表。
 * P0 六个 = read/write/bash（T-4-02）+ edit/glob/grep（T-4-03）。
 */

import type { ToolRegistry } from "../registry.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createGlobTool } from "./glob.js";
import { createGrepTool } from "./grep.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

export function registerBuiltinTools(registry: ToolRegistry): void {
  for (const def of [
    createReadTool(),
    createWriteTool(),
    createBashTool(),
    createEditTool(),
    createGlobTool(),
    createGrepTool(),
  ]) {
    registry.registerTool(def);
  }
}
