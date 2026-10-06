/**
 * host 自动化运行时装配（C1/C5 补口——自 server.ts 下沉：行数纪律拆分）：
 * 把调度域（cron 定时任务）与 webhook 入站触发的装配集中一处。两者共用
 * 同一投递语义——host 内部调度通道（bridge.sendSystemPrompt，不经租约，
 * host-owned 自动化授权见 scheduler-ops 头注），事件照常落主会话流。
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import type { HostBridge } from "./bridge.js";
import { channelLogger } from "./logging-ops.js";
import { createSchedulerRuntime, setSchedulerRuntime, type SchedulerRuntime } from "./scheduler-ops.js";
import { JobRegistry } from "../kernel/jobs.js";
import { WebhookEndpoint, WEBHOOK_PATH_PREFIX } from "../scheduler/webhook.js";
import type { SqliteEventStorage } from "../session/db.js";

export interface AutomationRuntimeOptions {
  sessionId: string;
  bridge: HostBridge;
  /** host 面事件库（--host-db 在位才有——cron 任务表在此库）。 */
  sessionsLibrary?: SqliteEventStorage;
  /** C5：webhook 入站凭据（env 注入——缺省不挂路由）。 */
  webhookToken?: string;
  webhookSecret?: string;
}

export interface AutomationRuntime {
  /** HTTP 路由钩子：处理 /webhook/ 前缀返回 true（已应答）；未挂载返回 false。 */
  handleWebhook(req: IncomingMessage, res: ServerResponse): boolean;
  /** host stop 收束（cron tick 停止 + 模块级句柄摘除）。 */
  stop(): void;
}

export function createAutomationRuntime(options: AutomationRuntimeOptions): AutomationRuntime {
  // C1：cron 调度运行时（无 --host-db 不装配——任务表在 host 库）
  const schedulerRuntime: SchedulerRuntime | undefined =
    options.sessionsLibrary !== undefined
      ? createSchedulerRuntime({
          db: options.sessionsLibrary.db,
          sessionId: options.sessionId,
          sendPrompt: (sid, prompt) =>
            options.bridge.sendSystemPrompt(sid, {
              type: "prompt",
              messageId: `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              content: prompt,
            }),
        })
      : undefined;
  if (schedulerRuntime !== undefined) setSchedulerRuntime(schedulerRuntime);
  // C5：webhook 派发记账的独立 job 注册表（不与 cron 共用——生命周期独立）
  const webhookJobs = new JobRegistry({ epoch: "host" });
  const webhook =
    options.webhookToken !== undefined
      ? new WebhookEndpoint({
          token: options.webhookToken,
          ...(options.webhookSecret !== undefined ? { secret: options.webhookSecret } : {}),
          jobs: webhookJobs,
          validatePayload: (payload) =>
            payload !== null &&
            typeof payload === "object" &&
            typeof (payload as { prompt?: unknown }).prompt === "string" &&
            ((payload as { prompt: string }).prompt as string).trim() !== ""
              ? { ok: true }
              : { ok: false, message: '需要 {"prompt": "非空字符串"} 形状的 JSON 载荷' },
          onDispatch: (payload) => {
            const prompt =
              payload !== null && typeof payload === "object" && typeof (payload as { prompt?: unknown }).prompt === "string"
                ? ((payload as { prompt: string }).prompt as string).trim()
                : "";
            if (prompt === "") return;
            void options.bridge
              .sendSystemPrompt(options.sessionId, {
                type: "prompt",
                messageId: `webhook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                content: prompt,
              })
              .catch((e: unknown) => {
                channelLogger("host").error(`webhook 投递失败：${e instanceof Error ? e.message : String(e)}`, { category: "session" });
              });
          },
        })
      : undefined;
  return {
    handleWebhook(req: IncomingMessage, res: ServerResponse): boolean {
      if (webhook === undefined || req.url === undefined || !req.url.startsWith(WEBHOOK_PATH_PREFIX)) {
        return false;
      }
      void webhook.handle(req, res);
      return true;
    },
    stop(): void {
      if (schedulerRuntime !== undefined) {
        schedulerRuntime.stop(); // C1：cron tick 收束
        setSchedulerRuntime(undefined); // 模块级句柄摘除（防进程级悬挂）
      }
    },
  };
}
