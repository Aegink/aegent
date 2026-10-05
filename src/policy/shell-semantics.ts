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
  /**
   * T6/T-P1-123：输入降级标志（畸形输入永不失控抛出——降级返回 + 显式标志）。
   * 置位时 ops 为空且 uncertain 恒 true（fail-closed：分析不了按危险处理——
   * C28 消费纪律），绝不 throw。non_string = 运行时收到非字符串；too_long =
   * 超过 MAX_COMMAND_LENGTH；contains_nul = 含 NUL（shell 参数硬限制）。
   */
  readonly degraded?: "non_string" | "too_long" | "contains_nul";
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
  "pwsh 通道（B1 补口）：对象管道/别名/参数缩写组合（-Path 之外的位置约定）与 .NET 方法全覆盖不可静态分析——只识别常见写 cmdlet（Set-Content/Add-Content/Out-File/New-Item/Export-* /Tee-Object）与 [IO.File]::WriteAll* 的首参数；-EncodedCommand（base64 脚本）整条判 uncertain",
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

/** 主入口：把一条 shell 命令分析成虚拟操作（B 档）。
 *
 * shell 形态（B1 补口）：bash（缺省，行为与历史完全一致）与 pwsh。pwsh
 * 是注册的内置工具（BUILTIN_TOOL_NAMES），此前虚拟写目标扫描只挂 bash
 * ——Set-Content/Out-File 等 pwsh 写法不经重定向即写文件，保留元数据
 * 目录可被一条 pwsh allow 规则绕过（C46 承诺破口）。pwsh 模式在既有
 * 重定向抽取之上追加 pwsh 写 cmdlet 识别与 -EncodedCommand 保守化；
 * 两种 shell 共享同一套降级/cd/uncertain 纪律。 */
/**
 * 单条命令的扫描输入上限（T5/T-P1-123——预算 cap 总工作量，不 cap 语义能力）。
 * 依据：单条 bash 命令的 OS 硬限制约 ARG_MAX 128KB 的一半取整；本扫描器为
 * 线性扫描（B 档五构造 + 重定向抽取），64KB 输入实测毫秒级完成——上限保证
 * 最坏情况工作量有界，且远超真实交互输入（模型产出的单命令通常 <4KB）。
 * 超限走 degraded 降级（见 ShellAnalysis.degraded），不抛异常。
 */
export const MAX_COMMAND_LENGTH = 65_536;

/** pwsh 写路径 cmdlet（首个非 flag 参数 = 目标路径）。覆盖常见文件写面；
 * 未覆盖的写法落 SHELL_ANALYSIS_LIMITATIONS（B 档承诺强度声明）。 */
const PWSH_WRITE_CMDLETS: ReadonlySet<string> = new Set([
  "set-content",
  "add-content",
  "out-file",
  "new-item",
  "export-csv",
  "export-clixml",
  "export-formatdata",
  "tee-object",
]);

/** pwsh 侧写路径提取：cmdlet 调用的首个非 `-` 开头参数。返回 undefined =
 * 该段不是已识别的写 cmdlet（或路径不可静态确认）。 */
function extractPwshCmdletWrite(bare: string): string | undefined {
  const tokens = bare.split(/\s+/);
  const head = (tokens[0] ?? "").toLowerCase();
  // [IO.File]::WriteAllText(path, …) 等 .NET 静态方法写面——括号内第一参数
  //（单/双引号均可包裹，捕获前剥掉）
  const dotnet = bare.match(/^\[[^\]]+\]::(WriteAllText|WriteAllBytes|AppendAllText|WriteAllLines)\s*\(\s*["']?([^",)\s'"]+)/);
  if (dotnet !== null) return dotnet[2];
  if (!PWSH_WRITE_CMDLETS.has(head)) return undefined;
  for (const token of tokens.slice(1)) {
    if (token.startsWith("-")) continue;
    if (token === "") continue;
    return token.replace(/^["']|["']$/g, "");
  }
  return undefined;
}

export function analyzeShellCommand(
  command: string,
  options: { shell?: "bash" | "pwsh" } = {},
): ShellAnalysis {
  const shell = options.shell ?? "bash";
  // T6/T-P1-123：畸形输入降级返回 + 显式标志（uncertain 恒 true——fail-closed），
  // 绝不因输入形态异常抛出失控异常。
  if (typeof (command as unknown) !== "string") {
    return { ops: [], uncertain: true, cwdUnknown: false, pathMayDependOnCwd: false, degraded: "non_string" };
  }
  if ((command as string).includes("\0")) {
    return { ops: [], uncertain: true, cwdUnknown: false, pathMayDependOnCwd: false, degraded: "contains_nul" };
  }
  if ((command as string).length > MAX_COMMAND_LENGTH) {
    return { ops: [], uncertain: true, cwdUnknown: false, pathMayDependOnCwd: false, degraded: "too_long" };
  }
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
    // B1 补口（pwsh 模式）：写 cmdlet 与 .NET 静态方法的路径参数 → file-write
    // （pwsh 写文件大多不经重定向；重定向抽取只覆盖 `>`/`>>` 一族）。
    if (shell === "pwsh") {
      const cmdletPath = extractPwshCmdletWrite(bare);
      if (cmdletPath !== undefined) {
        ops.push({
          kind: "file-write",
          path: cmdletPath,
          ...(cdState === "unknown" ? { cwdUnknown: true } : {}),
          ...(!cmdletPath.startsWith("/") &&
          !cmdletPath.startsWith("~") &&
          !/^[A-Za-z]:/.test(cmdletPath)
            ? { pathMayDependOnCwd: true }
            : {}),
        });
      }
      // -EncodedCommand 把任意脚本藏进 base64——静态分析零能力，整条保守
      if (/(^|\s)-(EncodedCommand|e)\b/i.test(bare)) {
        uncertain = true;
        ops.push({
          kind: "command",
          command: bare,
          uncertain: true,
          reason: "pwsh -EncodedCommand（base64 脚本）不可静态分析",
        });
      }
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
  // B1 补口：pwsh 与 bash 同挂语义分析（此前只判 bash——pwsh 是注册的
  // 内置工具，写 .git/ 等不经任何检查）。
  if (call.tool !== "bash" && call.tool !== "pwsh") return undefined;
  const command = call.args.command;
  if (typeof command !== "string") return undefined;
  const analysis = analyzeShellCommand(command, { shell: call.tool === "pwsh" ? "pwsh" : "bash" });

  // C46 经 C27：重定向/cmdlet 写保留元数据目录 = 绕过文件规则的通道，deny
  for (const op of analysis.ops) {
    if (op.kind === "file-write" && op.path !== undefined) {
      const segment = findProtectedMetadataSegment(op.path);
      if (segment !== undefined) {
        return {
          action: "deny",
          reason: `写入保留元数据目录 "${segment}"（C46/C27 ${call.tool} 旁路关闭）`,
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
