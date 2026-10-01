/**
 * 提示词模板参数展开纯函数（T-P3-146 A——参数化自定义命令内核面）。
 *
 * 语法族取四仓交集（pi-mono substituteArgs 为仲裁实现，见
 * docs/20261001_提示词模板对比与改造建议.md §3.1）：
 *   - `$ARGUMENTS` = 参数整串原文（含引号原样）；
 *   - `$1..$N` = 位置参数（引号感知切分后取位，缺位补空串）；
 *   - 模板无任何占位符且参数非空 → 参数以空行追加到展开文本尾部
 *     （pi-desktop 无占位符追加语义——参数绝不静默丢失）。
 * `{{var}}` 占位不在本面（插入时手改流，见 session/prompt-library.ts）。
 * 替换用单趟 replace 全量扫描：`$&`/`$'` 等 replacement pattern 注入面
 * 不存在（pi-desktop prompt-enhancement split/join 纪律的 replace 安全版）。
 */

/** 斜杠调用解析：首 token 为 `/name`，其余全部并入参数原文（opencode
 * "首行 = 命令、其余行并入参数"同构——多行参数合法）。首字符非 `/` 返回
 * null（正文普通文本，不展开不拦截）。 */
export function parseSlashInvocation(content: string): { name: string; argsRaw: string } | null {
  if (!content.startsWith("/")) return null;
  const m = /^\/([^\s]+)(?:[ \t]([^\n]*))?/.exec(content);
  if (m === null) return null;
  const name = m[1]!;
  // 参数原文 = 首行剩余 + 后续行（保留原始换行——多行参数语义）
  const restOfLine = m[2] ?? "";
  const afterLine = content.slice(m[0].length);
  const argsRaw = afterLine.startsWith("\n") || restOfLine === ""
    ? `${restOfLine}${afterLine}`.trim()
    : `${restOfLine}${afterLine}`.trim();
  return { name, argsRaw };
}

/**
 * 参数切分（pi parseCommandArgs 同构）：空格/tab 分词；单/双引号包裹的
 * 段落整体成词（内部转义 `\"`/`\'`/`\\`）；引号外反斜杠转义下一字符。
 * 缺陷容忍：未闭合引号按原文收尾（不抛错——模板参数是宽容面）。
 */
export function parseCommandArgs(raw: string): string[] {
  const args: string[] = [];
  let current = "";
  let hasToken = false;
  let quote: '"' | "'" | undefined;
  let i = 0;
  const push = (): void => {
    if (hasToken) args.push(current);
    current = "";
    hasToken = false;
  };
  while (i < raw.length) {
    const ch = raw[i]!;
    if (quote !== undefined) {
      if (ch === "\\" && i + 1 < raw.length && (raw[i + 1] === quote || raw[i + 1] === "\\")) {
        current += raw[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = undefined;
        i += 1;
        continue;
      }
      current += ch;
      hasToken = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      // 词首才成引用（pi 同语义——`it's` 的词中撇号是字面量，不吞后续词）
      if (current === "") {
        quote = ch;
        hasToken = true;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }
    if (ch === "\\" && i + 1 < raw.length) {
      current += raw[i + 1]!;
      hasToken = true;
      i += 2;
      continue;
    }
    if (ch === " " || ch === "\t") {
      push();
      i += 1;
      continue;
    }
    current += ch;
    hasToken = true;
    i += 1;
  }
  push();
  return args;
}

/** 模板是否携带参数占位（$ARGUMENTS / $N / $@ / ${@:N} 家族任一）。 */
export function hasArgPlaceholders(template: string): boolean {
  return /\$(?:ARGUMENTS|[0-9]+|@|\{@?:?)/.test(template);
}

/** 模板内出现的占位符清单（去重保序——UI hint 面与"有参模板"判定共用）。 */
export function templatePlaceholders(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/\$(?:ARGUMENTS|[0-9]+|@|\{@:\d+(?::\d+)?\}|\{@\})/g)) {
    const token = m[0];
    if (token !== undefined && !out.includes(token)) out.push(token);
  }
  return out;
}

/**
 * 参数展开（发送时——opencode/zcode/pi 三仓统一时机）：`$ARGUMENTS` 整串、
 * `$N` 位置取词（缺位空串）、`$@` 同 $ARGUMENTS；无占位符且参数非空 →
 * 空行追加原文。`{{var}}` 不在替换面。
 */
export function substituteArgs(template: string, argsRaw: string): string {
  if (!hasArgPlaceholders(template)) {
    return argsRaw.trim() === "" ? template : `${template}\n\n${argsRaw}`;
  }
  const args = parseCommandArgs(argsRaw);
  return template.replace(/\$(?:ARGUMENTS|[0-9]+|@|\{@:\d+(?::\d+)?\}|\{@\})/g, (token) => {
    if (token === "$ARGUMENTS" || token === "$@" || token === "${@}") return argsRaw;
    const slice = /^\$\{@:(\d+)(?::(\d+))?\}$/.exec(token);
    if (slice !== null) {
      const start = Number(slice[1]!) - 1;
      const rest = args.slice(Math.max(0, start));
      const len = slice[2] !== undefined ? Number(slice[2]) : undefined;
      return (len !== undefined ? rest.slice(0, len) : rest).join(" ");
    }
    const idx = Number(token.slice(1)) - 1;
    return idx >= 0 ? (args[idx] ?? "") : "";
  });
}
