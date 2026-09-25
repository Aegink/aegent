/**
 * 危险命令模式库（C10）——命中即升 ask 的内置模式清单。
 *
 * 三组起步模式取 pi·permission-gate.ts 原文形状（递归删除 / sudo /
 * 权限 777，大小写不敏感）；"命中即升 ask、无 UI 时 block"的语义在我方
 * 落为：模块裁决 ask → gate 走审批出口（C51 缺省 Deny——无人应答即拒，
 * 与 pi 的 non-interactive block 同向）。
 *
 * 清单纪律（C36 现在就立）：**只能追加、不能替换**——BUILTIN 常量冻结，
 * 扩展经 createDangerousCommandModule 的 patterns 参数在装配处追加
 * （验收：新增模式只需注册不改内核）；T-5-06 的保留元数据路径在硬拦
 * 出口另拦（规则与模式库都碰不到它），两道防线互补。
 *
 * 装配次序建议（写给 T-8/多模块组装者，kimi 同位序）：用户层 deny 规则
 * （首匹配先于本模块）→ 本模块（核心层前位）→ 会话批准历史 → 其他——
 * 让"用户显式 deny"压过危险提示、危险提示压过批准缓存。
 *
 * P0 只扫 bash 工具的命令原文；写路径等 shell 等价物经 T-5-14 的虚拟
 * 操作翻译后接入同一模块面。
 */

import type { PolicyCall, PolicyModule, PolicyOutcome } from "./chain.js";

export interface DangerousPattern {
  /** 人话名（进 ask 理由，可审计）。 */
  readonly name: string;
  readonly pattern: RegExp;
}

/** 内置起步清单（pi 同款三组；只能追加不能替换——C36）。 */
export const BUILTIN_DANGEROUS_PATTERNS: readonly DangerousPattern[] = Object.freeze([
  { name: "recursive-delete", pattern: /\brm\s+(-rf?|--recursive)/i },
  { name: "sudo", pattern: /\bsudo\b/i },
  { name: "privilege-777", pattern: /\b(chmod|chown)\b.*777/i },
] as const);

/** 逐模式扫描命令原文；命中返回该模式，全不命中返回 undefined。 */
export function findDangerousCommand(
  command: string,
  patterns: readonly DangerousPattern[] = BUILTIN_DANGEROUS_PATTERNS,
): DangerousPattern | undefined {
  return patterns.find((p) => p.pattern.test(command));
}

export interface DangerousCommandModuleOptions {
  /**
   * 生效模式清单；缺省内置三组。**追加**场景传入
   * [...BUILTIN_DANGEROUS_PATTERNS, 自定义]——整体替换内置清单属违反
   * C36 纪律，由装配评审把关（库不做运行时禁止）。
   */
  readonly patterns?: readonly DangerousPattern[];
  readonly name?: string;
}

/**
 * 危险命令检查作为链上一环：bash 调用命中任一模式 → 升 ask（理由带
 * 模式名），未命中或非 bash 工具 → 弃权交下一模块。
 */
export function createDangerousCommandModule(
  options: DangerousCommandModuleOptions = {},
): PolicyModule {
  const patterns = options.patterns ?? BUILTIN_DANGEROUS_PATTERNS;
  return {
    name: options.name ?? "dangerous-command-ask",
    evaluate(call: PolicyCall): Promise<PolicyOutcome | undefined> {
      if (call.tool !== "bash") return Promise.resolve(undefined);
      const command = call.args.command;
      const hit =
        typeof command === "string" ? findDangerousCommand(command, patterns) : undefined;
      return Promise.resolve(
        hit === undefined
          ? undefined
          : {
              action: "ask",
              reason: `命令命中危险模式 "${hit.name}"，默认询问（C10）`,
            },
      );
    },
  };
}
