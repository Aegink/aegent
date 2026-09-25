/**
 * Provider 配置（J3）——不透明配置：内核不为任何厂商建模配置内容，
 * settingsConfig 以字符串原样保存，入口只校验一次 JSON 语法
 * （形状取 cc-switch·schemas/provider.ts 的 superRefine：语法错即拒、报错带位置）。
 *
 * 内容语义归适配层（如 openai-compat 自己 parse 自己的 baseUrl/apiKey）——
 * 本模块永远不展开 settingsConfig 的字段。
 *
 * 位置定位不用 V8 错误文案：Node 22 对顶层 token 错误（`not json`）的
 * JSON.parse 消息不含位置。JSON.parse 仍是权威裁决（合法性由它说了算，
 * 自写扫描器的 bug 最多让位置不准，不会误拒合法配置），失败后用
 * locateJsonError 自算第一处语法错误的行列。
 */

export interface ProviderConfig {
  /** 厂商标识（人读的名字；机器身份见 identity.ts 的 ModelIdentity） */
  name: string;
  /** 不透明配置串：必须整串是合法 JSON 文本；内容由适配层解释 */
  settingsConfig: string;
}

export class ProviderConfigError extends Error {
  readonly code = "PROVIDER_CONFIG_INVALID";
  /** 语法错误位置（1-based 行列 + 0-based 偏移）；结构错误（缺字段等）无位置 */
  readonly line?: number;
  readonly column?: number;
  readonly offset?: number;

  constructor(message: string, pos?: { line: number; column: number; offset: number }) {
    super(message);
    this.name = "ProviderConfigError";
    if (pos) {
      this.line = pos.line;
      this.column = pos.column;
      this.offset = pos.offset;
    }
  }
}

/**
 * 入口校验：raw 必须是 `{name, settingsConfig}` 形状的对象，settingsConfig
 * 必须整串是合法 JSON。合法配置原样返回（不拷贝、不改写——不透明原则）。
 */
export function parseProviderConfig(raw: unknown): ProviderConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProviderConfigError("provider 配置必须是 JSON 对象");
  }
  const rec = raw as { [key: string]: unknown };
  const name = rec["name"];
  if (typeof name !== "string" || name.trim() === "") {
    throw new ProviderConfigError("provider 配置缺少非空字符串字段 name");
  }
  const settingsConfig = rec["settingsConfig"];
  if (typeof settingsConfig !== "string" || settingsConfig.trim() === "") {
    throw new ProviderConfigError("provider 配置缺少非空字符串字段 settingsConfig");
  }
  try {
    JSON.parse(settingsConfig);
  } catch {
    const found = locateJsonError(settingsConfig);
    const pos = found ?? { offset: 0, line: 1, column: 1, reason: "未知语法错误" };
    throw new ProviderConfigError(
      `settingsConfig 不是合法 JSON：${pos.reason}（第 ${pos.line} 行，第 ${pos.column} 列，偏移 ${pos.offset}）`,
      pos,
    );
  }
  return { name, settingsConfig };
}

// ---------------------------------------------------------------------------
// JSON 语法错误定位（严格按 RFC 8259；返回第一处错误的 0-based 偏移与人话
// 原因，null 表示语法合法。charAt 越界返回空串，天然躲开索引越界分支）
// ---------------------------------------------------------------------------

interface JsonErrorPos {
  offset: number;
  line: number;
  column: number;
  reason: string;
}

function locateJsonError(text: string): JsonErrorPos | null {
  const scanner = new JsonScanner(text);
  const reason = scanner.scan();
  if (reason === null) return null;
  const before = text.slice(0, scanner.pos);
  const line = (before.match(/\n/g) ?? []).length + 1;
  const lastNl = before.lastIndexOf("\n");
  return { offset: scanner.pos, line, column: scanner.pos - lastNl, reason };
}

class JsonScanner {
  pos = 0;
  private readonly s: string;

  constructor(text: string) {
    this.s = text;
  }

  /** 扫描全串；返回第一处语法错误的原因，语法合法返回 null */
  scan(): string | null {
    const err = this.value();
    if (err !== null) return err;
    this.skipWs();
    if (this.pos !== this.s.length) return this.fail("顶层之后有多余内容");
    return null;
  }

  private fail(reason: string): string {
    return reason;
  }

  private skipWs(): void {
    while (true) {
      const c = this.s.charAt(this.pos);
      if (c === " " || c === "\t" || c === "\n" || c === "\r") this.pos++;
      else break;
    }
  }

  private expect(ch: string, what: string): string | null {
    if (this.s.charAt(this.pos) !== ch) return this.fail(`期望 ${what}`);
    this.pos++;
    return null;
  }

  /** 解析一个值；出错返回原因，成功推进 this.pos */
  private value(): string | null {
    this.skipWs();
    if (this.pos >= this.s.length) return this.fail("期望一个 JSON 值，但输入已结束");
    const c = this.s.charAt(this.pos);
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"') return this.string();
    if (c === "t") return this.literal("true");
    if (c === "f") return this.literal("false");
    if (c === "n") return this.literal("null");
    return this.number();
  }

  private literal(word: string): string | null {
    if (!this.s.startsWith(word, this.pos)) return this.fail(`期望 ${word}`);
    this.pos += word.length;
    return null;
  }

  private object(): string | null {
    this.pos++; // {
    this.skipWs();
    if (this.s.charAt(this.pos) === "}") {
      this.pos++;
      return null;
    }
    for (;;) {
      this.skipWs();
      if (this.s.charAt(this.pos) !== '"') {
        return this.fail("对象键必须是用双引号包住的字符串");
      }
      let err = this.string();
      if (err !== null) return err;
      this.skipWs();
      err = this.expect(":", "\":\"");
      if (err !== null) return err;
      err = this.value();
      if (err !== null) return err;
      this.skipWs();
      const c = this.s.charAt(this.pos);
      if (c === ",") {
        this.pos++;
        continue;
      }
      if (c === "}") {
        this.pos++;
        return null;
      }
      return this.fail("对象内期望 \",\" 或 \"}\"");
    }
  }

  private array(): string | null {
    this.pos++; // [
    this.skipWs();
    if (this.s.charAt(this.pos) === "]") {
      this.pos++;
      return null;
    }
    for (;;) {
      const err = this.value();
      if (err !== null) return err;
      this.skipWs();
      const c = this.s.charAt(this.pos);
      if (c === ",") {
        this.pos++;
        continue;
      }
      if (c === "]") {
        this.pos++;
        return null;
      }
      return this.fail("数组内期望 \",\" 或 \"]\"");
    }
  }

  private string(): string | null {
    this.pos++; // 开引号
    for (;;) {
      if (this.pos >= this.s.length) return this.fail("字符串未闭合");
      const c = this.s.charAt(this.pos);
      if (c === '"') {
        this.pos++;
        return null;
      }
      if (c === "\\") {
        this.pos++;
        const e = this.s.charAt(this.pos);
        if (e === "u") {
          for (let k = 1; k <= 4; k++) {
            if (!isHexDigit(this.s.charAt(this.pos + k))) {
              return this.fail("\\u 后必须是 4 位十六进制数字");
            }
          }
          this.pos += 5;
          continue;
        }
        if ('"\\/bfnrt'.includes(e)) {
          this.pos++;
          continue;
        }
        return this.fail("非法转义字符");
      }
      if (c.charCodeAt(0) < 0x20) return this.fail("字符串内的控制字符必须转义");
      this.pos++;
    }
  }

  private digits(): void {
    while (isDigit(this.s.charAt(this.pos))) this.pos++;
  }

  private number(): string | null {
    if (this.s.charAt(this.pos) === "-") this.pos++;
    const c = this.s.charAt(this.pos);
    if (c === "0") {
      this.pos++;
    } else if (isDigit(c)) {
      this.pos++;
      this.digits();
    } else {
      return this.fail("期望数字/true/false/null/字符串/对象/数组");
    }
    if (this.s.charAt(this.pos) === ".") {
      this.pos++;
      if (!isDigit(this.s.charAt(this.pos))) return this.fail("小数点后必须有数字");
      this.digits();
    }
    if (this.s.charAt(this.pos) === "e" || this.s.charAt(this.pos) === "E") {
      this.pos++;
      if (this.s.charAt(this.pos) === "+" || this.s.charAt(this.pos) === "-") this.pos++;
      if (!isDigit(this.s.charAt(this.pos))) return this.fail("指数后必须有数字");
      this.digits();
    }
    return null;
  }
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9"; // charAt 越界返回 ""，"" >= "0" 为 false，天然不命中
}

function isHexDigit(c: string): boolean {
  return isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
}
