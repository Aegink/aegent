/**
 * Shell 语义分析 B 档（C27/C28/C29，Q19）——把 shell 命令翻译成虚拟工具
 * 操作，使文件/危险规则能管住 shell 等价物（堵"用 Bash 绕过文件规则"）。
 *
 * Q19 边界：**B 档只做 `&&` / `;` / 管道 / 重定向 / `cd` 五种构造**，
 * 不做完整语法树（C 档）。结构与不确定性字段取 qwen·shell-semantics.ts
 * 的 ShellOperation 形状（cwdUnknown / pathMayDependOnCwd），65KB 完整
 * 实现不搬运。
 *
 * ── C29：静态分析做不到的清单（LIMITATIONS，docs/ 有一份同源拷贝）──
 *
 *   1. 变量展开的值不可知：$VAR 的内容可以是任何东西，不展开求值，
 *      只按"路径可能依赖 cwd"保守标记；
 *   2. 命令替换 $(…) / 反引号一律判 uncertain——其内容运行期可以是
 *      任何命令，B 档不做内嵌递归分析；
 *   3. eval / source / .（点号 sourcing）判 uncertain——动态构造的
 *      语义只能运行期确定；
 *   4. 不解析 bash 全部语法：[[ ]] 条件、算术 $(( ))、heredoc、进程
 *      替换 <( )、别名与函数定义、PATH 解析（"rm" 可能是用户函数）
 *      均不在分析范围；
 *   5. 带文件描述符的重定向（2>、&>）不抽取为文件写操作，只有 >、>>、<
 *      被识别；
 *   6. tee / dd / cp 等以参数（而非重定向）写文件的命令不识别为写操作，
 *      只有命中危险模式的会升 ask；
 *   7. 虚拟操作的语义裁决（uncertain/危险模式/cd 保守）在链上受首匹配
 *      层序影响，可被用户层 allow 压过；保留名单硬拦已升出口级（T-P1-01
 *      起 protected-paths 消费本扫描器重扫虚拟写目标，不可被规则授权）；
 *   8. 多行命令按换行分段；不模拟 set -e、管道失败与子 shell 语义。
 *
 * 消费纪律（C28）：cwdUnknown / uncertain / pathMayDependOnCwd 是保守
 * 信号——消费方（本文件的链上模块）一律按危险处理（升 ask），绝不因
 * "可能无害"放行。
 */

import type { PolicyCall, PolicyModule, PolicyOutcome } from "./chain.js";
import { findDangerousCommand } from "./dangerous-commands.js";
import { findProtectedMetadataSegment } from "./protected-names.js";

// ---------------------------------------------------------------------------
// 分析产物
// ---------------------------------------------------------------------------

export interface VirtualOp {
  /** command = 一段简单命令；file-write/read = 重定向目标上的文件操作。 */
  readonly kind: "command" | "file-write" | "file-read";
  readonly command?: string;
  readonly path?: string;
  /** C28：该操作在动态 cd 之后，工作目录不可静态确定。 */
  readonly cwdUnknown?: boolean;
  /** C28：该操作的路径解析可能受 cwd 影响（相对路径 + cwd 已变/不可知）。 */
  readonly pathMayDependOnCwd?: boolean;
  /** 不可静态分析（eval / 命令替换等）——消费方按危险处理。 */
  readonly uncertain?: boolean;
  readonly reason?: string;
}

export interface ShellAnalysis {
  readonly ops: readonly VirtualOp[];
  /** 任一操作 uncertain。 */
  readonly uncertain: boolean;
  /** 任一操作在动态 cd 之后。 */
  readonly cwdUnknown: boolean;
  /** 任一操作路径可能依赖 cwd。 */
  readonly pathMayDependOnCwd: boolean;
}

/** C29 清单的代码侧载体（文档拷贝见 docs/shell-semantics-limitations.md）。 */
export const SHELL_ANALYSIS_LIMITATIONS: readonly string[] = Object.freeze([
  "变量展开的值不可知（$VAR 不求值，只保守标记路径可能依赖 cwd）",
  "命令替换 $(…) 与反引号一律判 uncertain，不做内嵌递归分析",
  "eval / source / 点号 sourcing 判 uncertain",
  "不解析 [[ ]]、$(( ))、heredoc、进程替换、别名/函数与 PATH 解析",
  "带文件描述符的重定向（2>、&>）不抽取为文件操作",
  "tee/dd/cp 等以参数写文件的命令不识别为写操作",
  "虚拟操作的语义裁决（uncertain/危险模式/cd 保守）在链上受首匹配层序影响，可被用户层 allow 压过；保留名单硬拦已升出口级（protected-paths 消费本扫描器，不可被规则授权）",
  "不模拟 set -e、管道失败与子 shell 语义",
] as const);

// ---------------------------------------------------------------------------
// B 档扫描器
// ---------------------------------------------------------------------------

interface Segment {
  readonly text: string;
  /** 段内出现命令替换（引号外）——整段 uncertain。 */
  readonly hasSubstitution: boolean;
}

/** 按引号外 && / || / ; / | / 换行切段；命令替换 $( ) 区域按不透明跳过。 */
function splitSegments(command: string): Segment[] {
  const segments: Segment[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escape = false;
  let substDepth = 0; // $( ) 深度
  let hasSubstitution = false;
  let dirty = false; // 当前段有实际内容（防止空段）

  const flush = () => {
    const text = current.trim();
    if (text.length > 0 || dirty) segments.push({ text, hasSubstitution });
    current = "";
    hasSubstitution = false;
    dirty = false;
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === "\\" && !inSingle) {
      current += ch;
      escape = true;
      continue;
    }
    if (ch === "'" && substDepth === 0) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && substDepth === 0) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (!inSingle && !inDouble && ch === "$" && command[i + 1] === "(") {
      hasSubstitution = true;
      dirty = true;
      current += "$(";
      substDepth = 1;
      i += 1;
      continue;
    }
    if (substDepth > 0) {
      current += ch;
      if (ch === "(") substDepth += 1;
      if (ch === ")") substDepth -= 1;
      continue;
    }
    if (!inSingle && !inDouble) {
      const two = command.slice(i, i + 2);
      if (two === "&&" || two === "||") {
        flush();
        i += 1;
        continue;
      }
      if (ch === ";" || ch === "|" || ch === "\n") {
        flush();
        continue;
      }
    }
    if (ch !== " " && ch !== "\t") dirty = true;
    current += ch;
  }
  flush();
  return segments.filter((s) => s.text.length > 0);
}

/** 抽取段内引号外的重定向；返回剩余命令文本与文件操作。
 * 带文件描述符的重定向（如 2>）按 LIMITATIONS #5 不抽取，原样保留。 */
function extractRedirects(text: string): {
  command: string;
  writes: string[];
  reads: string[];
} {
  const writes: string[] = [];
  const reads: string[] = [];
  let rest = "";
  let inSingle = false;
  let inDouble = false;
  let escape = false;
  const isWs = (c: string | undefined) => c !== undefined && /\s/.test(c);
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (escape) {
      rest += ch;
      escape = false;
      i += 1;
      continue;
    }
    if (ch === "\\" && !inSingle) {
      rest += ch;
      escape = true;
      i += 1;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      rest += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      rest += ch;
      i += 1;
      continue;
    }
    // 前一字符是数字的 ">" 视作 fd 重定向（2>&1 / 2> file），不抽取
    if (!inSingle && !inDouble && ch === ">" && /\d/.test(text[i - 1] ?? "")) {
      rest += ch;
      i += 1;
      continue;
    }
    if (!inSingle && !inDouble && (ch === ">" || ch === "<")) {
      const isAppend = ch === ">" && text[i + 1] === ">";
      const isRead = ch === "<";
      let j = i + (isAppend ? 2 : 1);
      while (j < text.length && isWs(text[j])) j += 1;
      let target = "";
      while (j < text.length && !isWs(text[j])) {
        target += text[j]!;
        j += 1;
      }
      if (target.length > 0) {
        (isRead ? reads : writes).push(target);
        i = j;
        continue;
      }
    }
    rest += ch;
    i += 1;
  }
  return { command: rest.replace(/\s+/g, " ").trim(), writes, reads };
}

function isDynamicTarget(target: string): boolean {
  return target.includes("$") || target.includes("`");
}

/** 主入口：把一条 bash 命令分析成虚拟操作（B 档）。 */
export function analyzeShellCommand(command: string): ShellAnalysis {
  const ops: VirtualOp[] = [];
  let uncertain = false;
  let cwdUnknown = false;
  let pathMayDependOnCwd = false;
  // cd 状态跨段传播：undefined=尚未 cd；literal=cd 到字面目录；unknown=动态目标
  let cdState: "unknown" | "literal" | undefined;

  for (const segment of splitSegments(command)) {
    if (segment.hasSubstitution) {
      uncertain = true;
      ops.push({
        kind: "command",
        command: segment.text,
        uncertain: true,
        reason: "命令替换 $(…) / 反引号不可静态分析",
      });
      continue;
    }
    const { command: bare, writes, reads } = extractRedirects(segment.text);
    const firstWord = bare.split(/\s+/)[0] ?? "";
    if (firstWord === "eval" || firstWord === "source" || firstWord === ".") {
      uncertain = true;
      ops.push({
        kind: "command",
        command: bare,
        uncertain: true,
        reason: `eval/source 类动态构造（${firstWord}）不可静态分析`,
      });
      continue;
    }
    if (firstWord === "cd") {
      const target = bare.slice(2).trim();
      cdState = isDynamicTarget(target) ? "unknown" : "literal";
      if (cdState === "unknown") cwdUnknown = true;
      pathMayDependOnCwd = true;
      ops.push({ kind: "command", command: bare });
      continue;
    }
    ops.push({
      kind: "command",
      command: bare,
      ...(cdState === "unknown" ? { cwdUnknown: true, pathMayDependOnCwd: true } : {}),
      ...(cdState === "literal" ? { pathMayDependOnCwd: true } : {}),
    });
    for (const path of writes) {
      ops.push({
        kind: "file-write",
        path,
        ...(cdState === "unknown" ? { cwdUnknown: true } : {}),
        ...(!path.startsWith("/") && !path.startsWith("~")
          ? { pathMayDependOnCwd: true }
          : {}),
      });
    }
    for (const path of reads) {
      ops.push({ kind: "file-read", path });
    }
  }
  return { ops, uncertain, cwdUnknown, pathMayDependOnCwd };
}

// ---------------------------------------------------------------------------
// 链上模块：虚拟操作交既有规则面
// ---------------------------------------------------------------------------

/**
 * shell 语义分析作为链上一环（核心层，与危险库同位——它内部复用危险
 * 库，装配两者其一即可）：不确定 → ask（C28）；重定向写入保留元数据
 * 目录 → deny（C46 经 C27 关闭 bash 旁路）；子命令命中危险模式 → ask；
 * cwd 不可知/路径依赖 cwd → ask（C28 保守）。
 */
export function createShellSemanticsModule(
  options: { name?: string } = {},
): PolicyModule {
  return {
    name: options.name ?? "shell-semantics",
    evaluate: (call: PolicyCall) => evaluateShell(call),
  };
}

async function evaluateShell(
  call: PolicyCall,
): Promise<PolicyOutcome | undefined> {
  if (call.tool !== "bash") return undefined;
  const command = call.args.command;
  if (typeof command !== "string") return undefined;
  const analysis = analyzeShellCommand(command);

  // C46 经 C27：bash 重定向写保留元数据目录 = 绕过文件规则的通道，deny
  for (const op of analysis.ops) {
    if (op.kind === "file-write" && op.path !== undefined) {
      const segment = findProtectedMetadataSegment(op.path);
      if (segment !== undefined) {
        return {
          action: "deny",
          reason: `重定向写入保留元数据目录 "${segment}"（C46/C27 bash 旁路关闭）`,
        };
      }
    }
  }
  // C28：不确定即按危险处理
  if (analysis.uncertain) {
    const why = analysis.ops.find((op) => op.uncertain)?.reason ?? "含不可静态分析的构造";
    return { action: "ask", reason: `shell 语义分析：${why}，按保守处理（C28/C29）` };
  }
  // 子命令命中危险模式（复用 C10 清单）
  for (const op of analysis.ops) {
    if (op.kind === "command" && op.command !== undefined) {
      const hit = findDangerousCommand(op.command);
      if (hit !== undefined) {
        return {
          action: "ask",
          reason: `子命令命中危险模式 "${hit.name}"（shell 语义分析 B 档）`,
        };
      }
    }
  }
  // C28：cd 后工作目录不可知 / 路径依赖 cwd → 保守 ask
  if (analysis.cwdUnknown || analysis.pathMayDependOnCwd) {
    return {
      action: "ask",
      reason: "cd 之后工作目录发生变化/不可知，路径按保守处理（C28）",
    };
  }
  return undefined;
}
