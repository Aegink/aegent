/**
 * bash 工具（B3，P0 桩）——参数形状已定（pi harness/tools/bash.ts 同款：
 * `{ command, timeout?（秒）}`，timeout 校验一并落地，回填时不动），执行体
 * 待 T-4-05 的 ExecutionEnv（D4：工具拿不到裸进程 API，spawn 在 env 实现
 * 层）落地后回填；"回显 stdout/exit code + 空输出边界"验收随回填补跑。
 * shell 选择：P0 用 bash（Git Bash 在本机存在），跨壳留 P1 D11。
 */

import type { ToolDef } from "../registry.js";
import { toolError } from "./util.js";

export interface BashArgs {
  command: string;
  /** 超时秒数（pi 同款：可选，不设默认超时）。 */
  timeout?: number;
}

/** setTimeout 约束换算的秒数上限（pi bash.ts 同款）。 */
const MAX_TIMEOUT_SECONDS = 2_147_483_647 / 1000;

export function createBashTool(): ToolDef {
  return {
    name: "bash",
    async execute(args) {
      const { command, timeout } = args as Partial<BashArgs>;
      if (typeof command !== "string" || command === "") {
        return toolError("BashError", "INVALID_ARGUMENTS", "bash 需要 command（非空字符串）");
      }
      if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
        return toolError(
          "BashError",
          "INVALID_ARGUMENTS",
          `timeout 必须是正的有限秒数，收到 ${String(timeout)}`,
        );
      }
      if (timeout !== undefined && timeout > MAX_TIMEOUT_SECONDS) {
        return toolError(
          "BashError",
          "INVALID_ARGUMENTS",
          `timeout 上限 ${String(MAX_TIMEOUT_SECONDS)} 秒`,
        );
      }
      return toolError(
        "BashError",
        "TOOL_NOT_IMPLEMENTED",
        "bash 工具尚未接入执行环境（T-4-05 ExecutionEnv 回填）",
      );
    },
  };
}
