/**
 * 批准写回项目规则（W13a/T9-3——zcode persistProjectPermissionUpdates
 * 最优评估 §17 同构）：scope="always" 的批准落回 `<workspace>/.aegent/
 * rules.txt`（project 层——**结构性限层**：本服务只持项目路径一个出口，
 * 用户层/系统层无从触达）。
 *
 * 三条纪律：
 *   - **原子写**：tmp + rename（settings-instruction-ops 同款——中途崩溃
 *     留 tmp，原文件完好）；
 *   - **schema 校验**：写前行经 parseRulesText 往返校验（shape 不合/动作
 *     词非法 = 类型化拒绝不落盘——"看不懂的行不装进权限层"的写侧对偶）；
 *   - **并发锁**：模块级 promise 链串行化（settings-rmw 同款——进程内
 *     read-modify-write 不交错）。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { parseRulesText } from "./rule-loader.js";

export type RuleWritebackErrorCode =
  | "RULE_WRITEBACK_INVALID"
  | "RULE_WRITEBACK_IO"
  | "RULE_WRITEBACK_PATH";

export class RuleWritebackError extends Error {
  override readonly name = "RuleWritebackError";
  constructor(
    readonly code: RuleWritebackErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RuleWritebackError";
  }
}

/** 项目规则路径守卫（限层的显式面）：只认 `<...>/.aegent/rules.txt` 形状
 * ——装配传错路径（如用户层文件）在构造期即类型化拒绝。 */
export function assertProjectRulesPath(path: string): void {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized.endsWith("/.aegent/rules.txt")) {
    throw new RuleWritebackError(
      "RULE_WRITEBACK_PATH",
      `写回目标须为项目层规则文件（<workspace>/.aegent/rules.txt）：${path}`,
    );
  }
}

export interface ProjectRuleWriteback {
  /** 追加规则行（幂等——同 raw+action 已存在则 no-op）。返回实际写入的行。 */
  appendRule(raw: string, action: "allow" | "ask" | "deny"): Promise<{ written: boolean; line: string }>;
}

/** 进程内写锁（read-modify-write 串行化——settings-rmw 同款）。 */
let writeChain: Promise<unknown> = Promise.resolve();

export function createProjectRuleWriteback(options: {
  /** 项目规则文件路径（构造期限层校验——非 `.aegent/rules.txt` 即拒）。 */
  projectRulesPath: string;
}): ProjectRuleWriteback {
  assertProjectRulesPath(options.projectRulesPath);
  const path = options.projectRulesPath;
  return {
    async appendRule(raw, action) {
      // schema 校验（写前往返——构造的行必须能被读侧原样解析；async 使
      // 校验异常走 rejection 通道——调用方以 await/ rejects 一致消费）
      const line = `${raw} -> ${action}`;
      const parsed = parseRulesText(`${line}\n`);
      if (parsed.issues.length > 0 || parsed.sources.length !== 1 || parsed.sources[0]!.raw !== raw) {
        throw new RuleWritebackError(
          "RULE_WRITEBACK_INVALID",
          `规则行不合 schema（"<规则> -> <allow|ask|deny>"）：${line.slice(0, 80)}`,
        );
      }
      const run = writeChain.then(async () => {
        // 读现状（缺文件 = 空规则集——首条规则直写）
        let existing = "";
        try {
          existing = readFileSync(path, "utf-8");
        } catch {
          existing = "";
        }
        // 幂等：同 raw+action 已在（忽略注释/空白差异）→ no-op
        const current = parseRulesText(existing);
        if (current.sources.some((s) => s.raw === raw && s.action === action)) {
          return { written: false, line };
        }
        const next =
          existing === ""
            ? `${line}\n`
            : existing.endsWith("\n")
              ? `${existing}${line}\n`
              : `${existing}\n${line}\n`;
        // 原子写：tmp + rename（同目录——中途崩溃留 tmp，原文件完好）；
        // 目录确保（.aegent 缺席的首写场景——装配纪律不依赖外部先行创建）
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.tmp`;
        try {
          writeFileSync(tmp, next, "utf-8");
          renameSync(tmp, path);
        } catch (e) {
          throw new RuleWritebackError(
            "RULE_WRITEBACK_IO",
            `规则写回失败：${e instanceof Error ? e.message : String(e)}`,
          );
        }
        return { written: true, line };
      });
      writeChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
