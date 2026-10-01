/**
 * 一键润色旁路调用（T-P3-146 I——pi-desktop prompt-enhancement 同构面）：
 * Composer 草稿 → 一次 LLM 调用 → 更优表达。不经会话流不开轮（polish/
 * polish_result 协议对——policy/check 回执对同构）；模型取
 * enhancement.polish → summarizer → 主模型回退链（装配面解析）。
 *
 * 纪律（pi-desktop prompt-enhancement.ts 锚）：
 *   - 用户模板 `{{draft}}` 单占位；split/join 替换（replace 的 `$&` 注入面
 *     不存在——D123 纪律）；customTemplate 关闭或缺占位符 = 内置默认模板；
 *   - system 指令固定不可覆盖（角色/改写原则/输出契约——只放 user 模板面）；
 *   - 结果后处理：剥离包裹引号与模型前缀标签（Enhanced:/改写: 等）；
 *   - 空输出 = 类型化失败（不静默回原文——UI 需知道润色没成）。
 */

import type { ModelIdentity } from "../models/identity.js";
import type { ModelProvider } from "../models/provider.js";

/** 润色固定 system 指令（pi 七段式的压缩版；模板面只管 user 半边）。 */
export const POLISH_SYSTEM_PROMPT = [
  "你是输入润色助手。把用户的草稿改写成更清晰、更具体、更适合发给 AI 编码助手的指令。",
  "原则：保留原意与全部关键信息；补全模糊指代；按需重组语序；不添加用户没有的新要求。",
  "语言跟随草稿；输出只有改写后的文本，不要解释、不要前后缀。",
].join("\n");

/** 用户模板（customTemplate 关闭/缺占位符时的缺省——含 {{draft}} 单占位）。 */
export const POLISH_DEFAULT_USER_TEMPLATE = "{{draft}}";

/** 模板填充（split/join 防 replacement pattern 注入）。 */
export function applyPolishTemplate(template: string, draft: string): string {
  return template.split("{{draft}}").join(draft);
}

/** 结果后处理：剥包裹引号（四种引号对）与常见前缀标签。 */
export function stripPolishArtifacts(text: string): string {
  let out = text.trim();
  const pairs: [string, string][] = [
    ['"""', '"""'],
    ["```", "```"],
    ['"', '"'],
    ["'", "'"],
    ["「", "」"],
  ];
  for (const [open, close] of pairs) {
    if (out.length > open.length + close.length && out.startsWith(open) && out.endsWith(close)) {
      out = out.slice(open.length, out.length - close.length).trim();
      break;
    }
  }
  out = out.replace(/^(?:enhanced|output|改写|润色|润色后)\s*[:：]\s*/i, "");
  return out.trim();
}

export interface PromptPolishDeps {
  provider: ModelProvider;
  identity: ModelIdentity;
  draft: string;
  /** 用户润色配置（settings enhancement.polish 的模板半边——装配面透传）。 */
  custom?: { customTemplate?: boolean; template?: string };
}

/** 一次润色调用（streamChat 全量收集——润色输出短，不需要流式端面）。 */
export async function runPromptPolish(deps: PromptPolishDeps): Promise<string> {
  const hasCustom =
    deps.custom?.customTemplate === true &&
    typeof deps.custom.template === "string" &&
    deps.custom.template.includes("{{draft}}");
  const userContent = hasCustom
    ? applyPolishTemplate(deps.custom!.template!, deps.draft)
    : applyPolishTemplate(POLISH_DEFAULT_USER_TEMPLATE, deps.draft);
  let text = "";
  for await (const chunk of deps.provider.streamChat({
    identity: deps.identity,
    messages: [
      { role: "system", content: POLISH_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  })) {
    if (chunk.type === "text-delta") text += chunk.text;
    else if (chunk.type === "done") break;
  }
  const polished = stripPolishArtifacts(text);
  if (polished === "") {
    const error = new Error("润色输出为空（模型未返回内容）");
    (error as unknown as { code: string }).code = "POLISH_EMPTY";
    throw error;
  }
  return polished;
}
