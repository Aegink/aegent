/**
 * mutation 重试预算（B13/T-P1-57）——同路径反复失败的修改尝试按
 * prompt × path 双作用域计数，三次计数失败终止当前轮（行为取
 * pi-desktop ADR 0207："counters are scoped to the prompt and path" +
 * "the third carries terminate: true" + MUTATION_RETRY_BUDGET_EXHAUSTED）。
 *
 * 与相邻两层的分域（不混）：
 *   - D15/T-6-06 bash-retry-guard：单次执行"已启动不自动重试"的幂等边界；
 *   - A5/J26 provider 重试：网络层同款退避，与本预算无关（ADR：
 *     "Provider retry budgets … are unaffected"）。
 *
 * 预算规则（ADR 四条）：
 *   1. 同一 prompt 内同一路径第 3 次**计数失败** → terminate（前两次照常
 *      返回错误提示，轮照跑）；
 *   2. 可恢复错误码各有一次**宽限**（首次出现不计数，第二次才计——给模型
 *      一次免计费的修正机会）；不可恢复/未知错误码保守直接计数；
 *   3. 计数器键 = promptId × 规范化路径（新输入 = 新预算，结构保证）；
 *   4. 该路径 mutation 成功 → 清空其失败历史。
 *
 * 终止语义落我方 TurnEndReason 既有 blocked 槽位（显式护栏终止非
 * completed，T-P1-50 同款）+ logger.warn（可观测面，MUTATION_RETRY_BUDGET_
 * EXHAUSTED 可检索）。
 */

/** 预算耗尽时的稳定码（ADR 0207 同名事实，warn/日志可检索）。 */
export const MUTATION_RETRY_BUDGET_EXHAUSTED = "MUTATION_RETRY_BUDGET_EXHAUSTED";

/**
 * 可恢复错误码清单（首次出现给一次宽限）：edit 与 apply_patch 的
 * "模型可自修"类失败。冻结只追加（C10 先例）；未知码保守计数。
 */
export const RECOVERABLE_MUTATION_CODES: ReadonlySet<string> = new Set([
  "OLD_TEXT_NOT_FOUND",
  "OLD_TEXT_NOT_UNIQUE",
  "HUNK_NOT_APPLIED",
]);

export interface MutationFailureVerdict {
  /** true = 第 3 次计数失败，调用方应终止当前轮（blocked）。 */
  terminate: boolean;
  /** 已计数失败次数（1-3）。 */
  countedFailures: number;
}

/** 单路径失败账本：计数失败次数 + 已宽限过的错误码。 */
interface PathRecord {
  countedFailures: number;
  gracedCodes: Set<string>;
}

export class MutationRetryBudget {
  private readonly records = new Map<string, PathRecord>();

  /**
   * 上报一次 mutation 失败。path 由调用方规范化（建议 path.resolve 后的
   * 绝对路径，Windows 大小写不敏感——统一 toLowerCase 折叠）。
   */
  record(
    promptId: string,
    normalizedPath: string,
    errorCode: string | undefined,
  ): MutationFailureVerdict {
    const key = `${promptId}\u0000${normalizedPath}`;
    let record = this.records.get(key);
    if (record === undefined) {
      record = { countedFailures: 0, gracedCodes: new Set() };
      this.records.set(key, record);
    }
    const recoverable = errorCode !== undefined && RECOVERABLE_MUTATION_CODES.has(errorCode);
    if (recoverable && !record.gracedCodes.has(errorCode)) {
      // 首次出现的可恢复码：一次宽限，不计数
      record.gracedCodes.add(errorCode);
      return { terminate: false, countedFailures: record.countedFailures };
    }
    record.countedFailures += 1;
    return { terminate: record.countedFailures >= 3, countedFailures: record.countedFailures };
  }

  /** 该路径的 mutation 成功：清空其失败历史（含宽限记账）。 */
  clear(promptId: string, normalizedPath: string): void {
    this.records.delete(`${promptId}\u0000${normalizedPath}`);
  }
}
