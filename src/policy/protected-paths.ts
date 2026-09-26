/**
 * 保留元数据路径硬拦（C46）——规则不得授权的**出口级**最终组合。
 *
 * 语义取 codex 的 forbidden_agent_metadata_write：agent 对含保留名路径
 * 的**写**操作在执行前无条件拦截，链上任何 allow/ask 规则都压不过它。
 * T-P1-01 起硬拦面覆盖两个通道：
 *   - write/edit 工具的 args.path（P0 即有）；
 *   - bash 命令经 T-5-14 B 档扫描产出的虚拟 file-write 目标——此前只在
 *     链上模块裁决、受首匹配层序影响，用户层 allow 规则可先于核心层
 *     shell-semantics 胜出（即 shell-semantics LIMITATIONS #7 的旁路）；
 *     现在出口处对 bash 命令重扫虚拟写目标，无条件压过链裁决。
 * 读不在拦的范围内——git 日常操作要读 .git，codex 同款只拦写。
 *
 * 与 T-5-07（C35）的分工：本文件管"元数据目录"的路径级硬拦；C35 管
 * "权限配置与指令文件"的编辑器级防线，两张清单互补不重复。
 *
 * 调用位（两处出口同构，都在链裁决之后、执行之前）：
 *   - gate（C9 规范执行面，toolCall 点位）；
 *   - createRevalidator（C57 执行点重算，无 gate 的旁路装配）。
 */

import type { PolicyCall, PolicyChain } from "./chain.js";
import type { Verdict } from "./decision.js";
import { analyzeShellCommand } from "./shell-semantics.js";
import { findProtectedMetadataSegment } from "./protected-names.js";

// 清单与段匹配的唯一权威在 protected-names.ts，re-export 保持既有
// import 面稳定（aggregate.test 等从本文件取）。
export {
  PROTECTED_METADATA_PATH_NAMES,
  findProtectedMetadataSegment,
} from "./protected-names.js";

/** 写路径工具（注册表名）。bash 不在此列——走下方的虚拟写目标分支；
 * apply_patch 同理——其目标路径藏在 patchText 里，走再下方的 patch 分支。 */
const WRITE_PATH_TOOLS: ReadonlySet<string> = new Set(["write", "edit"]);

/** 该工具是否为"写路径"类（硬拦与自我修改防线共用的判定面）。 */
export function isWritePathTool(tool: string): boolean {
  return WRITE_PATH_TOOLS.has(tool);
}

/**
 * 写/执行类工具（注册表名）——plan 模式硬关（G7，T-P1-11）判定面的唯一
 * 权威：plan 激活时这些工具在出口级无条件 deny，规则/白名单压不过。
 * todo_write 在列——它是会话状态写入（元进度），plan 模式"只读研究"下
 * 不可写（T-P1-10 验收④的铺垫；出口级硬关在 T-P1-11 落地时消费本清单）。
 * 与 WRITE_PATH_TOOLS 的分工：后者是 C46 路径硬拦的入口判定（按 args.path
 * 段匹配），本清单是模式级"能否调用"的类别判定——两用途不混用。
 * 冻结只追加（C10 先例）。
 */
export const WRITE_EXECUTE_TOOLS: ReadonlySet<string> = new Set([
  "write",
  "edit",
  "bash",
  "pwsh",
  "todo_write",
  "apply_patch",
]);

/** 该工具是否为写/执行类（plan 硬关面；非写执行类 = plan 模式下可用）。 */
export function isWriteExecuteTool(tool: string): boolean {
  return WRITE_EXECUTE_TOOLS.has(tool);
}

/** bash 命令里命中保留名单的虚拟写目标（出口级 bash 通道）。 */
function findProtectedBashWriteTarget(
  command: string,
): { path: string; segment: string } | undefined {
  for (const op of analyzeShellCommand(command).ops) {
    if (op.kind !== "file-write" || op.path === undefined) continue;
    const segment = findProtectedMetadataSegment(op.path);
    if (segment !== undefined) return { path: op.path, segment };
  }
  return undefined;
}

/**
 * V4A patch 文本的目标路径提取（T-P1-56 apply_patch 通道的扫描器——
 * 与 bash 虚拟写目标扫描同构的本地实现，不 import 工具层解析器以免
 * policy→kernel 反向依赖）。前缀集与工具解析器（apply-patch.ts）一致，
 * 由 apply-patch.test.ts 的扫描器对齐用例钉死；漏认行进不了工具变更
 * （工具解析失败整 patch 拒绝），故"扫描器 ⊇ 解析器"的偏置方向安全。
 * （供 protected-paths 与 self-guard 两个出口共用。）
 */
export function extractPatchWritePaths(patchText: string): string[] {
  const paths: string[] = [];
  for (const line of patchText.split("\n")) {
    for (const header of ["*** Add File:", "*** Update File:", "*** Delete File:", "*** Move to:"]) {
      if (line.startsWith(header)) {
        const target = line.slice(header.length).trim();
        if (target !== "") paths.push(target);
        break;
      }
    }
  }
  return paths;
}

/**
 * 硬拦出口：链裁决之后、执行之前调用。写类工具的 args.path 任一段
 * 命中保留名单、或 bash 命令的虚拟写目标命中 → 无条件 deny（C46：
 * 规则不得授权）；其余调用原样透传。
 */
export function enforceProtectedPaths(
  verdict: Verdict,
  call: PolicyCall,
): Verdict {
  if (isWritePathTool(call.tool)) {
    const path = call.args.path;
    if (typeof path === "string") {
      const segment = findProtectedMetadataSegment(path);
      if (segment !== undefined) {
        return {
          action: "deny",
          reason: `路径 "${path}" 含保留元数据目录 "${segment}"，硬拦不可被规则授权（C46）`,
        };
      }
    }
    return verdict;
  }
  if (call.tool === "bash") {
    const command = call.args.command;
    if (typeof command === "string") {
      const hit = findProtectedBashWriteTarget(command);
      if (hit !== undefined) {
        return {
          action: "deny",
          reason: `bash 虚拟写目标 "${hit.path}" 含保留元数据目录 "${hit.segment}"，硬拦不可被规则授权（C46 出口级）`,
        };
      }
    }
  }
  if (call.tool === "apply_patch") {
    const patchText = call.args.patchText;
    if (typeof patchText === "string") {
      for (const target of extractPatchWritePaths(patchText)) {
        const segment = findProtectedMetadataSegment(target);
        if (segment !== undefined) {
          return {
            action: "deny",
            reason: `patch 目标 "${target}" 含保留元数据目录 "${segment}"，硬拦不可被规则授权（C46 出口级）`,
          };
        }
      }
    }
  }
  return verdict;
}

/**
 * 链 + 硬拦出口的组合形态：evaluate 先走链（谁裁决谁赢），再过硬拦
 * （最严压过一切）。T-5-12 的 gate 在层内自调 enforceProtectedPaths，
 * 本形态供无 gate 的旁路装配直接包链使用。
 */
export function withProtectedPaths(chain: PolicyChain): PolicyChain {
  return {
    modules: chain.modules,
    async evaluate(call: PolicyCall) {
      return enforceProtectedPaths(await chain.evaluate(call), call);
    },
  };
}
