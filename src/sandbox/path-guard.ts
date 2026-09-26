/**
 * 路径守卫（T-6-01 · C7/D1）——所有文件操作的唯一入口：工作区边界 +
 * 显式白名单两段式允许集（形状取 codex sandboxing/windows.rs 的
 * read_roots/write_roots 策略：WorkspaceWrite 允许集 + 白名单覆盖）。
 *
 * 部署位置是刻意的：守卫接在**工具执行层**（read/write/edit 的参数路径、
 * bash 经 T-5-14 的虚拟文件操作），位于策略链（审批面）之后、真实 I/O
 * 之前——因此它是**出口级硬拦**：任何 allow 规则或用户批准都绕不过它。
 * （对照 C29 #7：链上裁决受首匹配层序影响、可能被用户层规则遮蔽，守卫
 * 没有这个问题——这正是 C7 要的"越界写被拒"的强制面。）
 *
 * fs 写能力同时收进本守卫（read/write 方法）：四个文件工具本体不再直接
 * 接触 node:fs 写函数，且类型上工厂必收守卫实例——无旁路由构造保证。
 * 这也是卡面 grep 证伪（src/kernel/tools/builtin/ 内零写函数字面量）的
 * 达成方式。glob/grep 只读且 P0 读面不限，不接守卫（见 LIMITATIONS #5）。
 * 内核自用存储（事件库、spill 落盘、日志）是装配面路径而非模型可控输入，
 * 不在守卫范围。
 *
 * ── 已知边界（LIMITATIONS，docs/sandbox-path-limitations.md 有同源拷贝）──
 */

import { mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

export const PATH_GUARD_LIMITATIONS: readonly string[] = Object.freeze([
  "符号链接逃逸按 realpath 归一后判定（目标存在取真身、不存在取最近存在祖先）；创建符号链接需要特权的环境无法实测逃逸路径，用例仅在可创建时运行",
  "bash 侧覆盖面 = T-5-14 B 档虚拟操作（> >> < 三种重定向）；fd 重定向（2>、&>）与 tee/dd/cp 参数式写不在守卫范围（C29 #5/#6），>&N 形式的 fd 复制目标按非文件跳过",
  "bash 命令里反斜杠是转义符（实际写入路径与字面目标可能不同），Windows 上含反斜杠的写目标按不可验证拒绝——bash 里请用正斜杠",
  "含 $VAR/反引号/引号的写目标、cd 之后的相对路径、Windows 上无盘符的 POSIX 形式路径（/tmp/x）一律判为不可静态验证，fail-closed 拒绝执行",
  "读面 P0 不限（与 C46 聚合出口 read 不拦一致）；仅当显式配置 readRoots 时才启用读边界",
  "断言与 I/O 之间存在 TOCTOU 竞窗；单进程 + 写队列串行下已最小化，跨进程攻击者不在 P0 威胁模型",
  "内核自用存储（事件库、spill 落盘、日志）是装配面路径而非模型可控输入，不在守卫范围",
] as const);

// ---------------------------------------------------------------------------
// 错误与配置
// ---------------------------------------------------------------------------

export type PathGuardErrorCode =
  | "PATH_OUTSIDE_WRITABLE"
  | "PATH_OUTSIDE_READABLE"
  | "PATH_UNVERIFIABLE";

/** 越界/不可验证——报错必含目标路径（C7 场景④"报错明确"）。 */
export class PathGuardError extends Error {
  override readonly name = "PathGuardError";

  constructor(
    readonly code: PathGuardErrorCode,
    readonly targetPath: string,
    message: string,
  ) {
    super(message);
  }
}

export interface PathGuardConfig {
  /** 工作区根（一个或多个）——读写允许集的基座。 */
  workspaceRoots: readonly string[];
  /** 工作区之外的显式写白名单（codex 白名单覆盖形状）。 */
  writeWhitelist?: readonly string[];
  /** 读边界：缺省 undefined = 全盘可读（P0 与 C46 出口 read 不拦一致）；给数组 = 工作区 ∪ 该列表。 */
  readRoots?: readonly string[];
}

/** bash 虚拟操作的最小结构面（T-5-14 的 VirtualOp 按结构兼容传入，沙箱不反向依赖策略层）。 */
export interface ShellOpLike {
  readonly kind: string;
  readonly command?: string;
  readonly path?: string;
  readonly cwdUnknown?: boolean;
  readonly pathMayDependOnCwd?: boolean;
}

// ---------------------------------------------------------------------------
// 路径归一与判定
// ---------------------------------------------------------------------------

/** Windows 上文件名大小写不敏感：比较前把双方小写（realpath 已归一真身大小写，这里兜底不存在段的字面大小写）。 */
function isInside(target: string, root: string): boolean {
  const lower = process.platform === "win32";
  const rel = path.relative(
    lower ? root.toLowerCase() : root,
    lower ? target.toLowerCase() : target,
  );
  // path.relative 而非 startsWith：防 "F:\aegent" 误放行 "F:\aegent-evil"
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** 目标存在取 realpath；不存在则取最近存在祖先的 realpath + 余下段（写目标常尚未创建）。 */
async function toRealTarget(abs: string): Promise<string> {
  try {
    return await realpath(abs);
  } catch {
    // 目标不存在或不可达——向上找
  }
  const parts: string[] = [];
  let cur = abs;
  for (;;) {
    const parent = path.dirname(cur);
    if (parent === cur) return abs; // 到文件系统根仍不存在：按原样判定，真实错误由 I/O 给出
    parts.unshift(path.basename(cur));
    cur = parent;
    try {
      return path.join(await realpath(cur), ...parts);
    } catch {
      // 继续向上
    }
  }
}

function realpathOrSelf(p: string): Promise<string> {
  return realpath(p).catch(() => p);
}

// ---------------------------------------------------------------------------
// shell 目标解析（bash 虚拟操作 → 可判定的绝对路径）
// ---------------------------------------------------------------------------

export type ShellTargetResolution = { abs: string } | { unverifiable: true; reason: string };

/**
 * 把 bash 重定向目标解析成可判定的绝对路径；解析不动的返回 unverifiable
 * （消费方 fail-closed）。只管"目标在哪"，允许集判定归 PathGuard.check。
 */
export function resolveShellTarget(
  raw: string,
  hints: { cwdUnknown?: boolean; cdHappened?: boolean } = {},
): ShellTargetResolution {
  if (raw.includes("$") || raw.includes("`")) {
    return { unverifiable: true, reason: "目标含变量/命令替换，实际位置运行期才可知" };
  }
  if (raw.includes('"') || raw.includes("'")) {
    return { unverifiable: true, reason: "目标带引号（扫描器不摘引号，字面目标与实际路径不同）" };
  }
  if (process.platform === "win32" && raw.includes("\\")) {
    return {
      unverifiable: true,
      reason: "bash 中反斜杠是转义符，字面目标与实际写入路径可能不同——请使用正斜杠",
    };
  }
  let candidate = raw;
  if (candidate === "~") {
    candidate = homedir();
  } else if (candidate.startsWith("~/")) {
    candidate = path.join(homedir(), candidate.slice(2));
  } else if (candidate.startsWith("~")) {
    return { unverifiable: true, reason: "~user 形式的家目录展开不可静态判定" };
  }
  if (process.platform === "win32") {
    const msys = /^\/([a-zA-Z])(\/.*)?$/.exec(candidate);
    if (msys !== null) {
      // MSYS 盘符形式（/c/... 即 C:\...）：Git Bash 对这类目标的真实写入位置
      const rest = (msys[2] ?? "").replace(/\//g, "\\");
      candidate = `${msys[1]!.toUpperCase()}:${rest === "" ? "\\" : rest}`;
    } else if (candidate.startsWith("/")) {
      return {
        unverifiable: true,
        reason: "无盘符的 POSIX 形式路径在 Windows 的挂载语义不可静态判定",
      };
    }
  }
  if (!path.isAbsolute(candidate)) {
    // 相对目标的落点由 shell cwd 决定：bash 工具不传 cwd，shell 继承进程 cwd。
    // 动态 cd（cwdUnknown）与任何已发生的 cd（含字面 cd——cd 目标未被追踪）都
    // 使相对路径不可定位；无 cd 时落点确定，可判定。
    if (hints.cwdUnknown === true) {
      return { unverifiable: true, reason: "cd 之后工作目录不可知，相对路径无法定位" };
    }
    if (hints.cdHappened === true) {
      return { unverifiable: true, reason: "cd（字面目标）已改变工作目录且目标未被追踪，相对路径无法定位" };
    }
    return { abs: path.resolve(process.cwd(), candidate) };
  }
  return { abs: path.resolve(candidate) };
}

// ---------------------------------------------------------------------------
// 守卫本体
// ---------------------------------------------------------------------------

interface ResolvedRoots {
  readonly writable: readonly string[];
  /** null = 读面不限（P0 缺省）。 */
  readonly readable: readonly string[] | null;
}

export class PathGuard {
  private readonly config: PathGuardConfig;
  private roots?: Promise<ResolvedRoots>;

  private constructor(config: PathGuardConfig) {
    this.config = config;
  }

  /** 装配缺省：单工作区根（测试/子进程用进程 cwd 或显式夹具目录）。 */
  static forWorkspace(
    workspaceRoot: string,
    extra: Omit<PathGuardConfig, "workspaceRoots"> = {},
  ): PathGuard {
    return new PathGuard({ workspaceRoots: [workspaceRoot], ...extra });
  }

  get readsUnrestricted(): boolean {
    return this.config.readRoots === undefined;
  }

  /** 可写范围的人话描述（T-6-02 提示词模板的 {{WRITABLE_ROOTS}} 注入源）。 */
  async describeWritableRoots(): Promise<string> {
    const roots = await this.ensureRoots();
    const all = roots.writable;
    return all.length > 0 ? all.join("、") : "(未配置)";
  }

  /** 写边界（出口级硬拦）：越界抛 PathGuardError，报错含目标路径（场景④）。 */
  async assertWritable(absPath: string): Promise<void> {
    await this.check(path.resolve(absPath), "write");
  }

  /** 读边界：P0 缺省读面不限（直通）；配置 readRoots 后生效。 */
  async assertReadable(absPath: string): Promise<void> {
    await this.check(path.resolve(absPath), "read");
  }

  /** 守卫内的读取入口（工具不直接接触文件系统）。 */
  async read(absPath: string): Promise<string> {
    const abs = path.resolve(absPath);
    await this.assertReadable(abs);
    return readFile(abs, "utf8");
  }

  /** 守卫内的写入入口：先断言后落盘（父目录自动创建，write 工具语义）。 */
  async write(absPath: string, content: string): Promise<void> {
    const abs = path.resolve(absPath);
    await this.assertWritable(abs);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }

  /**
   * 守卫内的删除入口（T-P1-56 apply_patch 的 delete/move 需要删除能力）：
   * 删除是写面的否定操作——同一 write 边界断言后才 unlink，工具本体
   * 不直接接触 fs 删除函数（守卫家族完整性与 write 同理）。
   */
  async remove(absPath: string): Promise<void> {
    const abs = path.resolve(absPath);
    await this.assertWritable(abs);
    await unlink(abs);
  }

  /**
   * bash 的接入点（T-5-14 虚拟文件操作）：按 op 顺序逐个校验 file-write/
   * file-read 目标。写目标不可静态解析 = 拒绝执行（fail-closed）；读目标
   * 在 P0 读面不限的缺省下直通（写边界才是 C7 的强制面）。cd 追踪与
   * T-5-14 扫描器的 firstWord === "cd" 判定一致——扫描器能看到的 cd 这里
   * 都能看到，不引入额外盲区。
   */
  async assertShellFileOps(ops: readonly ShellOpLike[]): Promise<void> {
    let cdHappened = false;
    for (const op of ops) {
      if (op.kind === "command" && op.command !== undefined) {
        const firstWord = op.command.trim().split(/\s+/)[0] ?? "";
        if (firstWord === "cd") cdHappened = true;
        continue;
      }
      if (op.kind !== "file-write" && op.kind !== "file-read") continue;
      const raw = op.path;
      if (raw === undefined || raw === "") continue;
      if (raw.startsWith("&")) continue; // >&N / <&N 的 fd 复制目标，不是文件
      if (op.kind === "file-read" && this.readsUnrestricted) continue;
      const resolved = resolveShellTarget(raw, {
        cwdUnknown: op.cwdUnknown,
        cdHappened,
      });
      if ("unverifiable" in resolved) {
        throw new PathGuardError(
          "PATH_UNVERIFIABLE",
          raw,
          `无法静态验证${op.kind === "file-write" ? "写入" : "读取"}目标 "${raw}"（${resolved.reason}），已拒绝执行——请改用工作区内的绝对路径`,
        );
      }
      if (op.kind === "file-write") {
        await this.assertWritable(resolved.abs);
      } else {
        await this.assertReadable(resolved.abs);
      }
    }
  }

  private async ensureRoots(): Promise<ResolvedRoots> {
    this.roots ??= (async () => {
      const writable = await Promise.all(
        [...this.config.workspaceRoots, ...(this.config.writeWhitelist ?? [])].map(realpathOrSelf),
      );
      const readable =
        this.config.readRoots === undefined
          ? null
          : await Promise.all(
              [...this.config.workspaceRoots, ...this.config.readRoots].map(realpathOrSelf),
            );
      return { writable, readable };
    })();
    return this.roots;
  }

  private async check(abs: string, mode: "write" | "read"): Promise<void> {
    const roots = await this.ensureRoots();
    const allowed = mode === "write" ? roots.writable : roots.readable;
    if (allowed === null) return; // P0 读面不限
    const real = await toRealTarget(abs);
    if (allowed.some((root) => isInside(real, root))) return;
    const where = allowed.join("、");
    throw mode === "write"
      ? new PathGuardError(
          "PATH_OUTSIDE_WRITABLE",
          abs,
          `越界写入被拒绝：${abs} 不在可写范围内（允许写：${where}）。请把目标放在工作区内，或让用户把该目录加入写白名单。`,
        )
      : new PathGuardError(
          "PATH_OUTSIDE_READABLE",
          abs,
          `越界读取被拒绝：${abs} 不在可读范围内（允许读：${where}）。`,
        );
  }
}
