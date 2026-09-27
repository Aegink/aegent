/**
 * 时间上下文注入（F7/T-P1-103，codex·session/time_reminder.rs 的我方同构）——
 * "模型知道'现在'；长会话中时间不漂移"。注入面 = user/message{source:"injected"}
 * （goal/预算提醒同款：写进模型可见历史才算送达——M10 纪律；事件流承载送达
 * 事实，**状态从流重建**，恢复恒等无独立记账面）。
 *
 * 到期判定（codex take_reminder_due 同款）：**新窗必送**（窗口号 ≠ 上次送达
 * 时的窗口号——压缩后立即再注入，F25 窗口身份消费）|| 距上次送达 ≥ interval。
 * 上次送达窗口号的重建：流内最后一条时间注入消息（seq S）时点的窗口号 =
 * currentWindow(events ≤ S).number——同一流两次推导恒等（流即状态）。
 *
 * CurrentTimeUnavailable 告示 N/A 记档（Node 系统时钟不可失败；外部时钟源
 * P2）。与 F23 分域：时间注入不占 developer 独立预算——它是"现在"的可再生
 * 事实，丢弃只损失新鲜度，重注入即恢复。
 */

import type { SessionEvent } from "../kernel/events.js";
import { currentWindow } from "./window.js";

/** 时间注入的固定前缀（与 goal/预算提醒措辞分域——模型侧可区分三类注入）。 */
export const TIME_REMINDER_PREFIX = "[当前时间]";

/** 缺省重注入间隔（秒；卡内定形——codex reminder_interval_seconds 的我方默认）。 */
export const DEFAULT_TIME_REMINDER_INTERVAL_SECONDS = 3_600;

interface LastDelivery {
  /** 送达时点（事件 ts，epoch ms）。 */
  ts: number;
  /** 送达时点的窗口号（重建口径：该消息 seq 时点的 currentWindow().number）。 */
  windowNumber: number;
}

/** 从流重建最近一次送达事实（无送达 → undefined——首轮必送）。 */
function lastDeliveryFromEvents(events: readonly SessionEvent[]): LastDelivery | undefined {
  let last: { ts: number; seq: number } | undefined;
  for (const e of events) {
    if (e.type === "user/message" && e.source === "injected" && e.message.content.startsWith(TIME_REMINDER_PREFIX)) {
      last = { ts: e.ts, seq: e.seq };
    }
  }
  if (last === undefined) return undefined;
  const upToDelivery = events.filter((e) => e.seq <= last!.seq);
  return { ts: last.ts, windowNumber: currentWindow(upToDelivery).number };
}

/**
 * 是否应当注入时间提醒（纯函数——恢复恒等：同流同 now 两次判定一致）。
 * 新窗（窗口号变化——含首轮"无上次送达"）|| 距上次送达 ≥ interval 秒。
 */
export function timeReminderDue(
  events: readonly SessionEvent[],
  now: number,
  intervalSeconds: number = DEFAULT_TIME_REMINDER_INTERVAL_SECONDS,
): boolean {
  const last = lastDeliveryFromEvents(events);
  if (last === undefined) return true;
  const isSameWindow = currentWindow(events).number === last.windowNumber;
  const intervalElapsed = now - last.ts >= intervalSeconds * 1_000;
  return !isSameWindow || intervalElapsed;
}

/** 注入内容（固定格式——无自由文本敏感面；本地时区）。 */
export function timeReminderContent(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return (
    `${TIME_REMINDER_PREFIX} 现在是 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} (UTC${offset})。`
  );
}
