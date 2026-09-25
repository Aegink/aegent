/**
 * 内置工具注册入口（B3）：装配处一行把内置工具挂上注册表。
 * P0 六个 = read/write/bash（本卡）+ edit/glob/grep（T-4-03）。
 */

import type { ToolRegistry } from "../registry.js";
import { createBashTool } from "./bash.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

export function registerBuiltinTools(registry: ToolRegistry): void {
  for (const def of [createReadTool(), createWriteTool(), createBashTool()]) {
    registry.registerTool(def);
  }
}
