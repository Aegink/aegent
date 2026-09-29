/**
 * CLI 行编辑增强（U21/T-P3-123）——kill-ring、Ctrl+R 模糊历史搜索、反斜杠
 * 续行多行输入（pi·tui editor/kill-ring/alt-screen-search/fuzzy 行为锚，
 * 🔴 只学行为：全 TUI 重绘不取——渐进路线，readline 之上增强）。
 *
 * 分层（卡内定形）：
 *   - **纯逻辑核心**（本文件导出，机验主体）：kill-ring 纯结构、模糊匹配
 *     与历史搜索（子序列语义）、Ctrl+R 搜索状态机、续行合并包装器；
 *   - **生产接线**（薄）：attachReverseSearch 把搜索状态机挂上 readline
 *     keypress（回填走 rl.write——不动 readline 内部缓冲结构）；
 *     repl.ts 的输入行流经 withContinuation 合并续行。
 *
 * 跨终端负例（卡面预警记档）：Ctrl+W / Ctrl+R / Escape 在部分 Windows
 * 终端（ConPTY 老版本、Windows Terminal 以外的 conhost 旧配置）可能被
 * 终端自身消费或键位报告差异——搜索/剪贴键位是 best-effort 增强，核心
 * 交互（回车发送、/命令、续行）不依赖它们；非 TTY（管道/测试）不接管。
 */

// ---------------------------------------------------------------------------
// kill-ring（pi·tui kill-ring 行为锚：剪贴操作共享一个环形存储，yank 取
// 顶、yank-pop 在环内回溯）
// ---------------------------------------------------------------------------

export interface KillRing {
  /** 剪贴入环（新条目压顶；容量上限 16——最老弹出）。 */
  push(text: string): void;
  /** 取环顶（连续取同一条——直到 yankPop 推进指针）。 */
  yank(): string;
  /** yank 后回溯：返回环内下一条（替换语义由调用方完成——返回值即替换文本）。 */
  yankPop(): string;
  readonly size: number;
}

const KILL_RING_CAPACITY = 16;

export function createKillRing(): KillRing {
  const ring: string[] = [];
  let index = 0; // 指向环顶（最近一条）
  return {
    push(text: string) {
      if (text === "") return;
      ring.unshift(text);
      if (ring.length > KILL_RING_CAPACITY) ring.pop();
      index = 0;
    },
    yank(): string {
      return ring.length > 0 ? (ring[index] ?? ring[0] ?? "") : "";
    },
    yankPop(): string {
      if (ring.length === 0) return "";
      index = (index + 1) % ring.length;
      return ring[index] ?? "";
    },
    get size(): number {
      return ring.length;
    },
  };
}

// ---------------------------------------------------------------------------
// 模糊历史搜索（pi·tui fuzzy 行为锚：query 字符按序出现在候选中即命中
// ——子序列语义，大小写不敏感；连续命中加分排序）
// ---------------------------------------------------------------------------

export function fuzzyMatch(query: string, candidate: string): boolean {
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  let at = 0;
  for (const ch of q) {
    at = c.indexOf(ch, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

/**
 * Ctrl+R 候选列表（**约定 history[0] = 最新**——readline rl.history 同约定
 * 的历史数组，保持原序过滤：reverse-i-search 语义 = 从最新向旧翻页，
 * 顺序稳定可预期；pi·tui fuzzy 的评分排序是 TUI 列表面，非本面）。
 */
export function fuzzySearchHistory(history: readonly string[], query: string): string[] {
  return history.filter((line) => fuzzyMatch(query, line));
}

// ---------------------------------------------------------------------------
// Ctrl+R 搜索状态机（纯——attachReverseSearch 只是它的 readline 薄壳）
// ---------------------------------------------------------------------------

export interface HistorySearcher {
  /** 可打印字符加入 query（hits 重算、指针复位）。 */
  feed(ch: string): void;
  /** Backspace：query 去尾。 */
  backspace(): void;
  /** Ctrl+R 再按：翻到下一命中（环绕）。 */
  next(): void;
  /** 当前命中（无命中 = null）。 */
  currentMatch(): string | null;
  /** Enter：接受当前命中并退出搜索（返回值回填输入行）。 */
  accept(): string | null;
  /** Esc / Ctrl+G：取消（不回填）。 */
  cancel(): void;
  /** 只读快照（UI 提示面——`(fuzzy) query`）。 */
  readonly query: string;
  readonly active: boolean;
}

export function createHistorySearcher(history: readonly string[]): HistorySearcher {
  let query = "";
  let hits = fuzzySearchHistory(history, "");
  let idx = 0;
  let active = true;
  const recompute = (): void => {
    hits = fuzzySearchHistory(history, query);
    idx = 0;
  };
  return {
    feed(ch: string) {
      query += ch;
      recompute();
    },
    backspace() {
      query = query.slice(0, -1);
      recompute();
    },
    next() {
      if (hits.length > 0) idx = (idx + 1) % hits.length;
    },
    currentMatch(): string | null {
      return hits[idx] ?? null;
    },
    accept(): string | null {
      active = false;
      return hits[idx] ?? null;
    },
    cancel() {
      active = false;
    },
    get query(): string {
      return query;
    },
    get active(): boolean {
      return active;
    },
  };
}

// ---------------------------------------------------------------------------
// 反斜杠续行（多行输入）：行尾 `\` = 本行未完，与下一行以换行符拼接成
// 一个逻辑输入（prompt 中的换行是内容——runCli 的 trim 只去首尾空白）。
// EOF 时未闭合的续行照常 flush（不丢输入）。
// ---------------------------------------------------------------------------

const CONTINUATION = "\\";

export async function* withContinuation(
  input: AsyncIterable<string>,
): AsyncGenerator<string, void, undefined> {
  let buffered: string | null = null;
  for await (const line of input) {
    const body = line.endsWith("\n") ? line.slice(0, -1) : line;
    const isContinuation = body.trimEnd().endsWith(CONTINUATION);
    if (isContinuation) {
      const stripped = body.trimEnd().slice(0, -1);
      buffered = buffered === null ? `${stripped}\n` : `${buffered}${stripped}\n`;
      continue;
    }
    yield buffered === null ? line : `${buffered}${line}`;
    buffered = null;
  }
  if (buffered !== null) yield buffered; // EOF flush（不丢未闭合续行）
}

// ---------------------------------------------------------------------------
// 生产接线（薄壳）：把搜索状态机挂上 readline keypress。回填 = 清行 +
// rl.write(match)——不动 readline 内部缓冲结构（Windows 终端兼容面见
// 文件头负例记档；非 TTY 不接管）。
// ---------------------------------------------------------------------------

import { emitKeypressEvents, type Interface as ReadlineInterface } from "node:readline";

export function attachReverseSearch(rl: ReadlineInterface): void {
  // readline Interface 运行时持有 .input（类型声明缺失——结构性断言）
  const input = (rl as unknown as { input: NodeJS.ReadStream & { isTTY?: boolean } }).input;
  if (!input.isTTY) return; // 管道/smoke 模式不接管（键位增强是交互面专属）
  emitKeypressEvents(input, rl);
  let searcher: HistorySearcher | null = null;
  const rewrite = (): void => {
    rl.write(null, { ctrl: true, name: "u" }); // 清行（readline 内置 kill-line backwards）
    const m = searcher?.currentMatch();
    if (m !== null && m !== undefined) {
      rl.write(m);
    }
    rl.prompt(true);
  };
  const handler = (ch: string, key: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean } | undefined): void => {
    const k = key ?? {};
    if (!searcher) {
      if (k.ctrl && k.name === "r") {
        searcher = createHistorySearcher(collectHistory(rl));
        rewrite();
      }
      return;
    }
    // 搜索中
    if (k.ctrl && k.name === "r") {
      searcher.next();
      rewrite();
      return;
    }
    if (k.name === "escape" || (k.ctrl && k.name === "g")) {
      searcher = null;
      rl.write(null, { ctrl: true, name: "u" });
      rl.prompt(true);
      return;
    }
    if (k.name === "return" || k.name === "enter") {
      const m = searcher.accept();
      searcher = null;
      if (m !== null) {
        rl.write(null, { ctrl: true, name: "u" });
        rl.write(m);
      } // 无命中：行保持空，readline 正常提交空行（无害）
      return;
    }
    if (k.name === "backspace") {
      searcher.backspace();
      rewrite();
      return;
    }
    if (ch !== undefined && ch !== "" && !k.ctrl && !k.meta) {
      searcher.feed(ch);
      rewrite();
    }
  };
  input.on("keypress", handler);
}

/** readline terminal 模式的实时历史（最新在前—— Interface.history）。 */
function collectHistory(rl: ReadlineInterface): string[] {
  const h = (rl as unknown as { history?: string[] }).history;
  return Array.isArray(h) ? [...h] : [];
}
