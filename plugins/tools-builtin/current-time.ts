/**
 * current_time 工具（T-P3-172 需求 1 补齐面——codex current_time 同款）：
 * 模型自行读取当前时间，免于每次靠系统提示/prompt 注入或瞎猜"今天几号"。
 * 零依赖零副作用（连时间都是只读）。
 */

import { toolError } from "../../src/kernel/tools/builtin/util.js";
import type { ToolDef } from "../../src/core/index.js";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

export function createCurrentTimeTool(): ToolDef {
  return {
    name: "current_time",
    // W5/T3-6 工具契约元数据（声明优先——gate/调度/审批三处共读；缺声明从严）
    sideEffectScope: "none",
    readOnly: true,
    descriptionText: "获取当前的日期、时间、时区与星期。查询时效性内容前后调用可对齐时间锚点。",
    parallel: true,
    parameters: {
      type: "object",
      properties: {},
    },
    async execute() {
      try {
        const now = new Date();
        const pad = (n: number): string => String(n).padStart(2, "0");
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
        const offsetMin = -now.getTimezoneOffset();
        const sign = offsetMin >= 0 ? "+" : "-";
        const offset = `${sign}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`;
        const content = [
          `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
          `星期${WEEKDAYS[now.getDay()]}`,
          `时区：${tz}（UTC${offset}）`,
          `ISO：${now.toISOString()}`,
        ].join("\n");
        return { content };
      } catch (e) {
        return toolError("CurrentTimeError", "TIME_FAILED", e instanceof Error ? e.message : String(e));
      }
    },
  };
}
