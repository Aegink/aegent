/**
 * W16/T7-4 调度工具族（EP-7）：schedule_create/list/update/delete——cron
 * 管理面从 UI-only（scheduler-ops）提到模型面。**默认不注册**（preset
 * 决定——无人值守轮才提供，交互轮模型不碰调度）；over 现有 SqliteCronStore
 * （任务行复用——非新存储）。
 */
import type { ToolDef } from "../../src/core/index.js";
import { toolError } from "./util.js";

export interface ScheduleToolDeps {
  /** CronStore 面任务行（复用 scheduler-ops 的 SqliteCronStore——闭集同库）。 */
  readonly add: (expr: string, prompt: string) => Promise<{ id: string }>;
  readonly list: () => Promise<readonly { id: string; expr: string; prompt: string }[]>;
  readonly remove: (id: string) => Promise<boolean>;
}

/** 相对时间归一化（zcode 同款）：『N 分钟/小时/秒后』→ 延迟毫秒。 */
export function normalizeRelativeDelay(text: string): number | null {
  const m = /^(\d+)\s*(分钟|小时|秒)后?$/.exec(text.trim());
  if (m === null) return null;
  const n = Number(m[1]);
  if (m[2] === "秒") return n * 1000;
  if (m[2] === "分钟") return n * 60_000;
  return n * 3_600_000;
}

export function createScheduleTools(deps: ScheduleToolDeps): ToolDef[] {
  return [
    {
      name: "schedule_create",
      sideEffectScope: "workspace",
      needsApproval: true,
      parameters: {
        type: "object",
        properties: {
          expr: { type: "string", description: "cron 表达式（或相对时间如 8分钟后——自动归一化为一次性延迟）" },
          prompt: { type: "string", description: "触发时投递的提示词" },
        },
        required: ["expr", "prompt"],
      },
      execute: async (args) => {
        if (typeof args.expr !== "string" || args.expr === "") return toolError("ScheduleError", "INVALID_ARGUMENTS", "expr 须为非空字符串");
        if (typeof args.prompt !== "string" || args.prompt === "") return toolError("ScheduleError", "INVALID_ARGUMENTS", "prompt 须为非空字符串");
        const delay = normalizeRelativeDelay(args.expr);
        const expr =
          delay !== null
            ? // 相对时间 → 一次性 cron（下一整分钟粒度由 CronScheduler tick 语义裁决）
              `@once+${delay}ms`
            : args.expr;
        try {
          const { id } = await deps.add(expr, args.prompt);
          return { content: JSON.stringify({ id, expr }) };
        } catch (e) {
          return toolError("ScheduleError", "SCHEDULE_ADD_FAILED", e instanceof Error ? e.message : String(e));
        }
      },
    },
    {
      name: "schedule_list",
      sideEffectScope: "none",
      readOnly: true,
      parallel: true,
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: JSON.stringify(await deps.list()) }),
    },
    {
      name: "schedule_delete",
      sideEffectScope: "workspace",
      needsApproval: true,
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "任务 id（schedule_list 取得）" } },
        required: ["id"],
      },
      execute: async (args) => {
        if (typeof args.id !== "string" || args.id === "") return toolError("ScheduleError", "INVALID_ARGUMENTS", "id 须为非空字符串");
        const ok = await deps.remove(args.id);
        return ok ? { content: `已删除 ${args.id}` } : toolError("ScheduleError", "SCHEDULE_NOT_FOUND", `任务 ${args.id} 不存在`);
      },
    },
  ];
}
