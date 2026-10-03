/**
 * UI 错误捕获上报（T-P3-154 A3——zcode renderer 桥接+cc-switch 三层捕获
 * 锚）：window.onerror + unhandledrejection → 缓冲队列 → 5s 窗口或满 20
 * 条批量上送 settings op:"log-report" → host 落 ui-YYYYMMDD.log（管道与
 * 级别在 host 侧 logging-ops）。循环防护：上送失败静默且不再重试本批；
 * 捕获器自身错误绝不外抛（日志面不能成为新的错误源）。
 */

import { sendSettings } from "./api.js";

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_BATCH_MAX = 20;
const MESSAGE_MAX = 1024;
const STACK_MAX = 2048;

// PendingError 形状：{ ts, level, message, stack?, source? }（host 侧 ReportedError 同构）

const queue = [];
let timerScheduled = false;
let wired = false;

function clip(value, max) {
  if (value === undefined || value === null) return undefined;
  const s = String(value);
  return s === "" ? undefined : s.length > max ? `${s.slice(0, max)}…（截断）` : s;
}

function enqueue(pending) {
  if (queue.length >= FLUSH_BATCH_MAX * 2) return; // 队列积压上限——丢弃最旧之外的
  if (queue.length >= FLUSH_BATCH_MAX) queue.shift();
  queue.push(pending);
  if (!timerScheduled) {
    timerScheduled = true;
    setTimeout(() => void flush(), FLUSH_INTERVAL_MS);
  }
}

async function flush() {
  timerScheduled = false;
  if (queue.length === 0) return;
  const batch = queue.splice(0, FLUSH_BATCH_MAX);
  try {
    const envelope = await sendSettings({ op: "log-report", entries: batch });
    if (!envelope.ok && queue.length === 0) return; // 静默——host 不可达时不再刷
  } catch {
    return; // 上送失败静默（不重试本批——防止风暴）
  }
  if (queue.length > 0 && !timerScheduled) {
    timerScheduled = true;
    setTimeout(() => void flush(), FLUSH_INTERVAL_MS);
  }
}

/** 挂全局错误捕获（幂等——app.js 启动即调一次）。 */
export function installGlobalErrorReporters() {
  if (wired) return;
  wired = true;
  try {
    window.addEventListener("error", (ev) => {
      enqueue({
        ts: new Date().toISOString(),
        level: "error",
        message: clip(ev.message ?? "（无消息）", MESSAGE_MAX) ?? "（无消息）",
        ...(ev.filename !== undefined && ev.filename !== "" ? { source: `${ev.filename}:${ev.lineno ?? 0}:${ev.colno ?? 0}` } : {}),
        ...(ev.error instanceof Error && ev.error.stack !== undefined ? { stack: clip(ev.error.stack, STACK_MAX) } : {}),
      });
    });
    window.addEventListener("unhandledrejection", (ev) => {
      const reason = ev.reason instanceof Error ? ev.reason : undefined;
      enqueue({
        ts: new Date().toISOString(),
        level: "error",
        message: clip(reason?.message ?? (ev.reason !== undefined ? String(ev.reason) : "（无原因）"), MESSAGE_MAX) ?? "（无原因）",
        ...(reason?.stack !== undefined ? { stack: clip(reason.stack, STACK_MAX) } : {}),
        source: "unhandledrejection",
      });
    });
  } catch {
    // 捕获器自身失败静默（老环境无 addEventListener 等极端场景）
  }
}
