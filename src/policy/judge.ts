/**
 * 两阶段 LLM 判官（C42，T-P2-203）——C56 判官端口（judge-port.ts）的本体
 * 兑现：便宜路径（规则/gate）拦下待复核的调用，判官用独立配置的模型复核
 * ——Stage1 低成本快判修正 allow 假阳性，边界进 Stage2 贵路径复核。
 *
 * 结构取 qwen·classifier.ts 的两阶段 + fail-closed 行为；prompt 内容卡内
 * 定形（不抄其模板），SDK 形态换我方 provider 消费（llm-summarizer 同款
 * 旁路调用纪律——独立 system 指令、tools 不带）。
 *
 * 四件纪律（C42 验收面）：
 *   1. **两阶段路由**：Stage1 只答一个词（safe=明显安全→终局 allow；
 *      risky=边界→Stage2 复核）；Stage1 输出不合格式 = schema 失败 →
 *      unavailable（qwen 同款——连一个词都答不对的模型不值得 16 倍成本的
 *      第二次机会，预算记账也不该为它双倍花）。
 *   2. **fail-closed 且带 unavailable 标记**：任何非取消失败（API 错误/
 *      超时/格式失败）→ abstain + `unavailable: true`——判官不可用 ≠ 拒绝
 *      ＝落回人（C56 abstain 槽位：gate 把 abstain 交 broker ask）。qwen
 *      失败落 shouldBlock=true；我方 C56 已裁决落回人——语义分流记档。
 *      审计面 phase:"unavailable" 与策略裁决可区分（基础设施失败不是
 *      政策判断——qwen ClassifierResult.unavailable 注释同旨）。
 *   3. **abort 不算失败**：用户取消（signal 已中止）→ abstain、不带
 *      unavailable、审计 phase:"aborted"——取消是人的意志不是基础设施
 *      故障，不触发熔断/不计错误（qwen `if (input.signal.aborted) throw`
 *      的对应面——我方在判官内消化为 abstain，gate 收到的是普通裁决）。
 *   4. **超时预算刻意宽松并写明理由**：判官是贵路径，误杀比慢更贵——
 *      超短超时把瞬时慢变成反复落人（每次假 unavailable = 一次人工审批）。
 *      Stage1 10s（快判 p99 ~1.5s、负载下尾长）、Stage2 30s（更大提示），
 *      qwen STAGE1/STAGE2_TIMEOUT_MS 同值；两段之和 40s < gate 外层
 *      JUDGE_REVIEW_TIMEOUT_MS（90s，judge-port.ts）——层内自界、外层兜底。
 *
 * 我方边界（记档）：ChatRequest 无 maxOutputTokens 面——Stage1 的低 token
 * 由 prompt 纪律承担（只许输出一个词）；会话历史不喂判官（JudgeRequest 无
 * 历史面，喂 transcript 随需要）；判官输入自带 6000 字符防御上界（gate 的
 * 8k 请求预算之外的第二道，JUDGE_INPUT_BUDGET_CHARS 同旨）。
 */

import type { ModelIdentity } from "../models/identity.js";
import type { ChatMessage, ModelProvider } from "../models/provider.js";
import type { TokenUsage } from "../kernel/events.js";
import {
  type JudgeRequest,
  type JudgeVerdict,
  JUDGE_REVIEW_TIMEOUT_MS,
} from "./judge-port.js";

// ---------------------------------------------------------------------------
// 超时常量（刻意宽松——理由见头注释第 4 条）
// ---------------------------------------------------------------------------

/** Stage1 快判超时（毫秒）——qwen STAGE1_TIMEOUT_MS 同值。 */
export const JUDGE_STAGE1_TIMEOUT_MS = 10_000;
/** Stage2 复核超时（毫秒）——qwen STAGE2_TIMEOUT_MS 同值。 */
export const JUDGE_STAGE2_TIMEOUT_MS = 30_000;
/** 阶段超时下限（qwen resolveTimeoutMs 同款）：低于 1s 的配置回缺省并告警。 */
const STAGE_TIMEOUT_FLOOR_MS = 1_000;
/** 判官输入内 args 序列化的防御上界（字符）。 */
export const JUDGE_INPUT_CHARS_MAX = 6_000;

// ---------------------------------------------------------------------------
// 判官指令（卡内定形——不抄 qwen 模板；导出供测试与调优覆盖）
// ---------------------------------------------------------------------------

export const JUDGE_BASE_PROMPT = [
  "你是权限系统的判官，评估一次被策略拦下等待复核的工具调用。",
  "只依据「工具名、参数、原询问原因」判断；不要臆测额外上下文，不要执行任何工具。",
  "拿不准时宁可交给人工复核，绝不猜测。",
].join("\n");

export const JUDGE_STAGE1_SUFFIX = [
  "第一阶段快判：只输出一个词——",
  "safe：这次调用明显安全，可自动放行；",
  "risky：有风险、有破坏面、或你无法确定。",
  "禁止输出任何其他文字、标点或解释。",
].join("\n");

export const JUDGE_STAGE2_SUFFIX = [
  "第二阶段复核：重新审视这次调用，输出两行：",
  "<verdict>allow|deny|abstain</verdict>",
  "<reason>一句话理由</reason>",
  "allow=放行，deny=拒绝，abstain=无法判断（交人工）。",
].join("\n");

// ---------------------------------------------------------------------------
// 审计记录（L2 面——judge 决策可追溯；落 logger/库面由装配决定）
// ---------------------------------------------------------------------------

/** 判官审计阶段闭集：完成裁决 / 不可用（基础设施）/ 被取消（人的意志）。 */
export const JUDGE_AUDIT_PHASES = ["reviewed", "unavailable", "aborted"] as const;
export type JudgeAuditPhase = (typeof JUDGE_AUDIT_PHASES)[number];

export interface JudgeAuditRecord {
  readonly kind: "judge";
  readonly phase: JudgeAuditPhase;
  readonly tool: string;
  readonly at: number;
  /** 完成裁决时的三值结果（unavailable/aborted 缺席）。 */
  readonly outcome?: "allow" | "deny" | "abstain";
  readonly reason?: string;
  /** 终局在哪一阶段定型（pre-abort 未触达任何阶段时缺席）。 */
  readonly stage?: "fast" | "review";
  /** 判官模型身份键（provider:modelId——可追溯用了哪个模型）。 */
  readonly model?: string;
  readonly durationMs?: number;
  /** 两阶段 token 用量求和（成本可追溯）。 */
  readonly usage?: TokenUsage;
}

// ---------------------------------------------------------------------------
// LlmJudge
// ---------------------------------------------------------------------------

/**
 * 判官裁决（端口闭集 + C42 扩展）：`unavailable` 标记区分"基础设施失败
 * 落回人"与"判官主动弃权"；`stage` 观测终局阶段。对 JudgePort 消费方
 * （gate）结构兼容——多余字段被忽略。
 */
export type LlmJudgeVerdict = JudgeVerdict & {
  readonly unavailable?: true;
  readonly stage?: "fast" | "review";
};

/** 用户取消的类型化信号（判官内部消化，不外抛给 gate）。 */
class JudgeAbortedError extends Error {
  constructor(readonly stage: "fast" | "review") {
    super("判官复核被用户取消");
    this.name = "JudgeAbortedError";
  }
}

export interface LlmJudgeDeps {
  provider: ModelProvider;
  /** 判官模型身份（J3 配置面独立 judge 段——AssemblyOptions.judgeModel）。 */
  identity: ModelIdentity;
  /** Stage1/Stage2 超时覆盖（≥1000ms 才生效，低于下限回缺省并告警）。 */
  stage1TimeoutMs?: number;
  stage2TimeoutMs?: number;
  /** 整段覆盖判官指令（测试/调优面）。 */
  systemPrompt?: string;
  /** L2 审计 sink（装配接 logger/库面；缺省丢弃）。 */
  audit?: (record: JudgeAuditRecord) => void;
  /** 观测口（超时配置回退等）。 */
  onWarn?: (message: string) => void;
  /** 时间源（测试注入）；缺省 Date.now。 */
  now?: () => number;
}

/** 构造两阶段判官（JudgePort 实现——gate 的 judge 槽位直接消费）。 */
export function createLlmJudge(deps: LlmJudgeDeps): {
  name: string;
  review(request: JudgeRequest): Promise<LlmJudgeVerdict>;
} {
  const now = deps.now ?? Date.now;
  const stage1Timeout = resolveStageTimeout(
    deps.stage1TimeoutMs,
    JUDGE_STAGE1_TIMEOUT_MS,
    deps.onWarn,
  );
  const stage2Timeout = resolveStageTimeout(
    deps.stage2TimeoutMs,
    JUDGE_STAGE2_TIMEOUT_MS,
    deps.onWarn,
  );
  const basePrompt = deps.systemPrompt ?? JUDGE_BASE_PROMPT;
  return {
    name: "llm-judge",
    async review(request: JudgeRequest): Promise<LlmJudgeVerdict> {
      const startedAt = now();
      let usage: TokenUsage | undefined;
      const absorbUsage = (u: TokenUsage | undefined): void => {
        if (u === undefined) return;
        usage =
          usage === undefined
            ? u
            : {
                inputTokens: usage.inputTokens + u.inputTokens,
                outputTokens: usage.outputTokens + u.outputTokens,
                ...(usage.totalTokens !== undefined || u.totalTokens !== undefined
                  ? { totalTokens: (usage.totalTokens ?? 0) + (u.totalTokens ?? 0) }
                  : {}),
              };
      };
      const finish = (
        record: Omit<JudgeAuditRecord, "kind" | "at" | "tool" | "model" | "durationMs" | "usage">,
      ): void => {
        deps.audit?.({
          kind: "judge",
          at: now(),
          tool: request.tool,
          ...(deps.identity !== undefined
            ? { model: `${deps.identity.provider}:${deps.identity.modelId}` }
            : {}),
          durationMs: now() - startedAt,
          ...(usage !== undefined ? { usage } : {}),
          ...record,
        });
      };
      // abort 语义（C42 第 3 条）：进门前已取消 = 立即 abstain（不触模型、
      // 不计错误、不带 unavailable——取消不是故障）。
      if (request.signal?.aborted === true) {
        finish({ phase: "aborted", reason: "判官复核被用户取消" });
        return { outcome: "abstain", reason: "判官复核被用户取消" };
      }
      const userContent = judgeTranscript(request);
      // —— Stage1 快判（便宜路径）——
      let stage1Text: string;
      try {
        stage1Text = await callStage(deps, {
          stage: "fast",
          systemPrompt: `${basePrompt}\n\n${JUDGE_STAGE1_SUFFIX}`,
          userContent,
          timeoutMs: stage1Timeout,
          signal: request.signal,
          onUsage: absorbUsage,
        });
      } catch (error) {
        if (error instanceof JudgeAbortedError) {
          finish({ phase: "aborted", reason: error.message, stage: "fast" });
          return { outcome: "abstain", reason: error.message, stage: "fast" };
        }
        const reason = `判官不可用（Stage1）：${error instanceof Error ? error.message : String(error)}`;
        finish({ phase: "unavailable", reason, stage: "fast" });
        return { outcome: "abstain", reason, unavailable: true, stage: "fast" };
      }
      const stage1 = stage1Text.trim().toLowerCase();
      if (stage1 === "safe") {
        const reason = "判官快判：明显安全";
        finish({ phase: "reviewed", outcome: "allow", reason, stage: "fast" });
        return { outcome: "allow", reason, stage: "fast" };
      }
      if (stage1 !== "risky") {
        // schema 失败（qwen 同款）：连一个词的格式都不合 → 不可用，不进贵路径
        const reason = `判官不可用（Stage1 格式）：期望 safe|risky，得到「${truncateSnippet(stage1Text)}」`;
        finish({ phase: "unavailable", reason, stage: "fast" });
        return { outcome: "abstain", reason, unavailable: true, stage: "fast" };
      }
      // —— Stage2 复核（贵路径修正边界）——
      let stage2Text: string;
      try {
        stage2Text = await callStage(deps, {
          stage: "review",
          systemPrompt: `${basePrompt}\n\n${JUDGE_STAGE2_SUFFIX}`,
          userContent,
          timeoutMs: stage2Timeout,
          signal: request.signal,
          onUsage: absorbUsage,
        });
      } catch (error) {
        if (error instanceof JudgeAbortedError) {
          finish({ phase: "aborted", reason: error.message, stage: "review" });
          return { outcome: "abstain", reason: error.message, stage: "review" };
        }
        // Stage1 判 risky、Stage2 不可用 → abstain 落回人（C56 槽位；qwen
        // 落 shouldBlock=true 的语义分流记档——我方"落人"已是 fail-closed）
        const reason = `判官不可用（Stage2）：${error instanceof Error ? error.message : String(error)}`;
        finish({ phase: "unavailable", reason, stage: "review" });
        return { outcome: "abstain", reason, unavailable: true, stage: "review" };
      }
      const parsed = parseStage2Output(stage2Text);
      if (parsed === null) {
        const reason = `判官不可用（Stage2 格式）：期望 <verdict> 标签，得到「${truncateSnippet(stage2Text)}」`;
        finish({ phase: "unavailable", reason, stage: "review" });
        return { outcome: "abstain", reason, unavailable: true, stage: "review" };
      }
      const reason =
        parsed.reason !== undefined ? sanitizeJudgeReason(parsed.reason) : "判官复核裁决（无理由文本）";
      finish({ phase: "reviewed", outcome: parsed.verdict, reason, stage: "review" });
      return { outcome: parsed.verdict, reason, stage: "review" };
    },
  };
}

// ---------------------------------------------------------------------------
// 内部：阶段调用 / 转写 / 解析 / 消毒
// ---------------------------------------------------------------------------

/** 阶段超时解析：≥1000ms 才生效，低于下限回缺省并告警（qwen 同款）。 */
function resolveStageTimeout(
  value: number | undefined,
  fallback: number,
  onWarn?: (message: string) => void,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < STAGE_TIMEOUT_FLOOR_MS) {
    onWarn?.(
      `llm-judge: 阶段超时 ${String(value)}ms 低于下限 ${String(STAGE_TIMEOUT_FLOOR_MS)}ms，回缺省 ${String(fallback)}ms`,
    );
    return fallback;
  }
  return value;
}

/** 判官输入转写（有界）：工具名 + 参数 JSON（防御上界）+ 原询问原因。 */
function judgeTranscript(request: JudgeRequest): string {
  let argsJson: string;
  try {
    argsJson = JSON.stringify(request.args) ?? "{}";
  } catch {
    argsJson = "<参数不可序列化>";
  }
  if (argsJson.length > JUDGE_INPUT_CHARS_MAX) {
    argsJson = argsJson.slice(0, JUDGE_INPUT_CHARS_MAX) + "…（截断）";
  }
  return [
    `工具：${request.tool}`,
    `参数：${argsJson}`,
    `原询问原因：${request.askReason}`,
  ].join("\n");
}

/**
 * 单阶段旁路调用（llm-summarizer 同款 streamChat 消费）：用户信号与超时
 * 信号合并（AbortSignal.any——Node 22）注入 provider；用户取消在 catch 里
 * 先判 `userSignal.aborted`（超时触发的是合并信号、用户信号未中止——两者
 * 可区分），取消 → 类型化 JudgeAbortedError，其余错误原样上抛。
 */
async function callStage(
  deps: LlmJudgeDeps,
  opts: {
    stage: "fast" | "review";
    systemPrompt: string;
    userContent: string;
    timeoutMs: number;
    signal?: AbortSignal;
    onUsage: (u: TokenUsage | undefined) => void;
  },
): Promise<string> {
  const combined = AbortSignal.any([
    ...(opts.signal !== undefined ? [opts.signal] : []),
    AbortSignal.timeout(opts.timeoutMs),
  ]);
  const messages: ChatMessage[] = [
    { role: "system", content: opts.systemPrompt },
    { role: "user", content: opts.userContent },
  ];
  let text = "";
  try {
    for await (const chunk of deps.provider.streamChat({
      identity: deps.identity,
      messages,
      signal: combined,
    })) {
      if (chunk.type === "text-delta") text += chunk.text;
      else if (chunk.type === "usage") opts.onUsage(chunk.usage);
      else if (chunk.type === "done") break;
    }
  } catch (error) {
    if (opts.signal?.aborted === true) throw new JudgeAbortedError(opts.stage);
    throw error;
  }
  return text;
}

/** Stage2 输出解析：verdict 标签必带（三值闭集），reason 标签可选。 */
function parseStage2Output(text: string): { verdict: "allow" | "deny" | "abstain"; reason?: string } | null {
  const verdictMatch = /<verdict>\s*(allow|deny|abstain)\s*<\/verdict>/.exec(text);
  if (verdictMatch === null) return null;
  const verdict = verdictMatch[1] as "allow" | "deny" | "abstain";
  const reasonMatch = /<reason>([\s\S]*?)<\/reason>/.exec(text);
  return {
    verdict,
    ...(reasonMatch !== null && reasonMatch[1] !== undefined && reasonMatch[1].trim() !== ""
      ? { reason: reasonMatch[1].trim() }
      : {}),
  };
}

/**
 * Stage2 reason 消毒（qwen sanitizeClassifierReason 同旨——LLM 生成的
 * reason 会被插值进回喂主模型的工具错误，敌意/失控输出不得伪装系统消息
 * 或对主 agent 造段落注入）：迭代剥 <...> 伪标签（单遍 /g 会留残余，上界
 * 8 轮保 O(n)）、折叠空白、200 字符硬上界。
 */
export function sanitizeJudgeReason(raw: string): string {
  if (raw === "") return raw;
  let stripped = raw;
  for (let i = 0; i < 8; i++) {
    const next = stripped.replace(/<[^>]*>/g, "");
    if (next === stripped) break;
    stripped = next;
  }
  return stripped.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** 不可用理由里的原文片段截断（防失控输出撑爆审计面）。 */
function truncateSnippet(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

/** 层序自检（C42 验收"超时宽松常量断言"的机内化）：两段之和必须小于 gate 外层总超时。 */
export function judgeStageBudgetCoherent(): boolean {
  return JUDGE_STAGE1_TIMEOUT_MS + JUDGE_STAGE2_TIMEOUT_MS < JUDGE_REVIEW_TIMEOUT_MS;
}
