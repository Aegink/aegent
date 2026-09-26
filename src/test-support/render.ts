/**
 * 上下文快照渲染（O14/O24，T-P1-32）——把"模型上下文"渲染成可读文本：
 * O14（codex·context_snapshot.rs）：窗口内差分——首条全量、后续只留新增
 * 后缀（"The first request in a window retains all its input; later requests
 * retain their suffix index"），settings 变化或输入不再延伸前驱即开新窗
 * （"A new window starts when a request no longer extends its predecessor's
 * input or changes request settings"）。
 * O24（kimi·snapshots.ts formatGenerateInput）：system prompt / tools 只在
 * 变化时打印，与 previous 深等折叠为 [unchanged] 标签；消息历史是前缀延伸
 * 时只渲染新增后缀——使缓存前缀稳定性（F13）可测（anchor 的逐字节断言在
 * T-P1-19 prefix-anchor.ts，本渲染器给测试可读性）。
 *
 * 纯函数：请求对象进、文本出；不落文件不接快照库。identity 变化算 settings
 * 变化（J6 换模开新窗是 F13 语义，卡内定形）。
 */

export interface RenderableRequest {
  /** 模型身份；变化即开新窗（换模语义）。 */
  identity?: { provider: string; modelId: string };
  system: string;
  tools: readonly { name: string }[];
  messages: readonly unknown[];
}

export interface RenderedRequestLine {
  /** 请求在原序列中的序号（0 起）。 */
  index: number;
  /** 渲染行：全量 / 前缀延伸 / 分叉三形态。 */
  text: string;
}

function identityOf(r: RenderableRequest): string {
  return r.identity ? `${r.identity.provider}/${r.identity.modelId}` : "（未指定）";
}

/** 前缀判断：逐条 JSON 深等（kimi isMessagePrefix 用 isDeepEqual——消息是值不是引用）。 */
function isPrefix<T>(prefix: readonly T[], whole: readonly T[]): boolean {
  if (prefix.length > whole.length) return false;
  return prefix.every((item, i) => JSON.stringify(item) === JSON.stringify(whole[i]));
}

/** 首个差异下标（浅比较 JSON 序列化——消息按值比较）。 */
function firstDiffIndex<T>(a: readonly T[], b: readonly T[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return i;
  }
  return n;
}

function renderMessage(message: unknown, index: number): string {
  if (typeof message !== "object" || message === null) {
    return `[${index}] ${JSON.stringify(message)}`;
  }
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "?";
  if (Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
    const calls = (m.toolCalls as { id?: string; name?: string }[])
      .map((c) => `${c.name ?? "?"}@${c.id ?? "?"}`)
      .join(", ");
    return `[${index}] ${role}（tool_calls: ${calls}）`;
  }
  if (typeof m.callId === "string") {
    return `[${index}] ${role}(${m.callId}): ${String(m.content ?? "")}`;
  }
  return `[${index}] ${role}: ${String(m.content ?? JSON.stringify(m))}`;
}

/**
 * 单请求差分渲染（O24）：system/tools 与 previous 深等 → [unchanged] 标签；
 * 消息是前缀延伸 → 只渲染新增后缀；非前缀（分叉）→ 全量渲染并标分叉点。
 * previous 缺省 = 首请求全量。
 */
export function formatGenerateInput(
  input: RenderableRequest,
  previous?: RenderableRequest | null,
): string {
  const lines: string[] = [];
  const fresh = previous === undefined || previous === null;
  lines.push(
    `identity: ${identityOf(input)}${fresh ? "" : previous!.identity !== undefined && !isSameIdentity(previous!, input) ? "（变更）" : ""}`,
  );

  if (fresh || previous!.system !== input.system) {
    lines.push(`system: ${input.system}`);
  } else {
    lines.push(`system: [unchanged]`);
  }

  const toolsChanged =
    fresh || JSON.stringify(previous!.tools) !== JSON.stringify(input.tools);
  if (toolsChanged) {
    const names = input.tools.map((t) => t.name).join(", ");
    lines.push(`tools: ${input.tools.length} 件（${names}）`);
  } else {
    lines.push(`tools: [unchanged]（${input.tools.length} 件）`);
  }

  const prevMessages = fresh ? null : previous!.messages;
  if (prevMessages === null) {
    lines.push("messages: 全量");
    input.messages.forEach((m, i) => lines.push(`  ${renderMessage(m, i)}`));
  } else if (isPrefix(prevMessages, input.messages)) {
    const added = input.messages.length - prevMessages.length;
    if (added === 0) {
      lines.push(`messages: [unchanged]（${input.messages.length} 条）`);
    } else {
      lines.push(`messages: 前缀延伸 +${added} 条：`);
      for (let i = prevMessages.length; i < input.messages.length; i++) {
        lines.push(`  ${renderMessage(input.messages[i], i)}`);
      }
    }
  } else {
    const diffAt = firstDiffIndex(prevMessages, input.messages);
    lines.push(`messages: 分叉于第 ${diffAt} 条（与前驱非前缀关系）——全量渲染`);
    input.messages.forEach((m, i) => lines.push(`  ${renderMessage(m, i)}`));
  }
  return lines.join("\n");
}

function isSameIdentity(a: RenderableRequest, b: RenderableRequest): boolean {
  return identityOf(a) === identityOf(b);
}

/**
 * 事件流快照渲染（O23，T-P1-33）——domain 与 wire 事件同流交错：`[emit]`/
 * `[wire]` 前缀分源（kimi·snapshots.ts:119）、事件名 `padEnd` 列对齐、载荷
 * 单行 JSON（JSON.stringify 转义物理换行，结构性保证单行）。
 * 与 O11 的 previous 差分渲染（formatGenerateInput）分工：本函数管"事件流"轴。
 */

export interface EventStreamLine {
  /** emit = domain 事件；wire = RPC/协议行（agent-protocol 转发面）。 */
  source: "emit" | "wire";
  type: string;
  payload: unknown;
}

export interface RenderEventStreamOptions {
  /** 载荷归一化注入（易变值占位符——test-support/normalize 的 normalizeValue）。 */
  normalize?: (payload: unknown) => unknown;
  /** 超长行最小截断（完整 160 字符政策是 P2 O27；缺省不截）。 */
  maxLineChars?: number;
}

export function renderEventStream(
  lines: readonly EventStreamLine[],
  options: RenderEventStreamOptions = {},
): string {
  if (lines.length === 0) return "（空事件流）";
  const maxTypeLen = Math.max(...lines.map((l) => l.type.length));
  const rendered = lines.map((line) => {
    const payload = options.normalize ? options.normalize(line.payload) : line.payload;
    let json = JSON.stringify(payload) ?? "undefined";
    if (options.maxLineChars !== undefined && json.length > options.maxLineChars) {
      json = `${json.slice(0, options.maxLineChars)}…(+${json.length - options.maxLineChars} 字)`;
    }
    const prefix = line.source === "wire" ? "[wire]" : "[emit]";
    return `${prefix} ${line.type.padEnd(maxTypeLen, " ")} ${json}`;
  });
  return rendered.join("\n");
}

/**
 * 多请求窗口渲染（O14）：settings（identity/system/tools）不变且消息是
 * 前缀延伸 → 同窗；否则开新窗并记录原因。窗内首请求全量、后续只渲染
 * 后缀（suffix index），窗头记录"窗口为何在此结束"的同构信息（新窗原因）。
 */
export function formatRequestWindow(requests: readonly RenderableRequest[]): string {
  if (requests.length === 0) return "（无请求）";

  // 分窗：每窗记起点与开窗原因
  const windows: { start: number; reason: string }[] = [];
  for (let i = 0; i < requests.length; i++) {
    if (windows.length === 0) {
      windows.push({ start: i, reason: "首个窗口" });
      continue;
    }
    const p = requests[i - 1]!;
    const r = requests[i]!;
    if (!isSameIdentity(p, r)) {
      windows.push({ start: i, reason: `identity 变更（${identityOf(p)} → ${identityOf(r)}）` });
    } else if (p.system !== r.system) {
      windows.push({ start: i, reason: "system prompt 变更" });
    } else if (JSON.stringify(p.tools) !== JSON.stringify(r.tools)) {
      windows.push({ start: i, reason: "tools 变更" });
    } else if (!isPrefix(p.messages, r.messages)) {
      windows.push({ start: i, reason: `输入分叉于第 ${firstDiffIndex(p.messages, r.messages)} 条` });
    }
  }

  const lines: string[] = [];
  for (let w = 0; w < windows.length; w++) {
    const win = windows[w]!;
    const end = w + 1 < windows.length ? windows[w + 1]!.start : requests.length;
    lines.push(`窗口 ${w + 1}（${end - win.start} 请求）——${win.reason}`);
    for (let i = win.start; i < end; i++) {
      const r = requests[i]!;
      if (i === win.start) {
        lines.push(
          `  #${i + 1} 全量: identity=${identityOf(r)} system=${r.system.length}字 tools=${r.tools.length}件 messages=${r.messages.length}条`,
        );
        lines.push(`    system: ${r.system}`);
        const names = r.tools.map((t) => t.name).join(", ");
        lines.push(`    tools: ${r.tools.length} 件（${names}）`);
        lines.push("    messages:");
        r.messages.forEach((m, j) => lines.push(`      ${renderMessage(m, j)}`));
      } else {
        const p = requests[i - 1]!;
        const added = r.messages.length - p.messages.length;
        lines.push(`  #${i + 1} 前缀延伸: +${added} messages（自 ${p.messages.length} 条起）`);
        for (let j = p.messages.length; j < r.messages.length; j++) {
          lines.push(`      ${renderMessage(r.messages[j], j)}`);
        }
      }
    }
  }
  return lines.join("\n");
}
