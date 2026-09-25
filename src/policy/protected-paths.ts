/**
 * 保留元数据路径硬拦（C46）——规则不得授权的最终出口。
 *
 * 清单取 codex·permissions.rs 的 PROTECTED_METADATA_PATH_NAMES：
 * .git / .agents / .codex（版本控制元数据 + agent 指令/配置目录）。
 * C36 纪律现在就立：**清单只能追加、不能替换**——收缩清单等于打开
 * 元数据篡改口，追加走代码评审。
 *
 * 语义取 codex 的 forbidden_agent_metadata_write：agent 对含保留名路径
 * 的**写**操作在执行前无条件拦截，链上任何 allow/ask 规则都压不过它
 * （硬拦在链的最终出口，见 withProtectedPaths）。读不在拦的范围内——
 * git 日常操作要读 .git，codex 同款只拦写。与 T-5-07（C35）的分工：
 * 本文件管"元数据目录"的路径级硬拦；C35 管"权限配置与指令文件"的
 * 编辑器级防线，两张清单互补不重复。
 *
 * 方言（保守方向）：路径段比较不分大小写——Windows 盘大小写不敏感，
 * ".GIT" 就是 ".git"；POSIX 上多拦一个凑巧叫 ".GIT" 的目录是可接受的
 * 误拦方向。P0 对路径任一段命中都拦（嵌套仓库的 .git 同受保护），比
 * codex 的工作区顶层更严，记为已知取舍。
 */

import type { PolicyCall, PolicyChain } from "./chain.js";
import type { Verdict } from "./decision.js";

/** 保留元数据路径名（C46；只能追加不能替换——C36 纪律）。 */
export const PROTECTED_METADATA_PATH_NAMES = [
  ".git",
  ".agents",
  ".codex",
] as const;

/** 路径任一段命中保留名则返回该段原文；否则 undefined。 */
export function findProtectedMetadataSegment(
  path: string,
): string | undefined {
  for (const segment of path.split(/[\\/]+/)) {
    if (
      (PROTECTED_METADATA_PATH_NAMES as readonly string[]).includes(
        segment.toLowerCase(),
      )
    ) {
      return segment;
    }
  }
  return undefined;
}

/**
 * P0 写路径工具（注册表名）。bash 写操作经 T-5-14 的虚拟操作接入硬拦，
 * 本清单不收 bash——防后来者以为漏了。self-guard（C35）共用此判定。
 */
const WRITE_PATH_TOOLS: ReadonlySet<string> = new Set(["write", "edit"]);

/** 该工具是否为"写路径"类（硬拦与自我修改防线共用的判定面）。 */
export function isWritePathTool(tool: string): boolean {
  return WRITE_PATH_TOOLS.has(tool);
}

/**
 * 硬拦出口：链裁决之后、执行之前调用。写类工具的 args.path 任一段
 * 命中保留名单 → 无条件 deny（C46：规则不得授权）；其余调用原样透传。
 */
export function enforceProtectedPaths(
  verdict: Verdict,
  call: PolicyCall,
): Verdict {
  if (!isWritePathTool(call.tool)) return verdict;
  const path = call.args.path;
  if (typeof path !== "string") return verdict;
  const segment = findProtectedMetadataSegment(path);
  if (segment === undefined) return verdict;
  return {
    action: "deny",
    reason: `路径 "${path}" 含保留元数据目录 "${segment}"，硬拦不可被规则授权（C46）`,
  };
}

/**
 * 链 + 硬拦出口的组合形态：evaluate 先走链（谁裁决谁赢），再过硬拦
 * （最严压过一切）。T-5-12 的 gate 消费此形态作为最终出口。
 */
export function withProtectedPaths(chain: PolicyChain): PolicyChain {
  return {
    modules: chain.modules,
    async evaluate(call: PolicyCall) {
      return enforceProtectedPaths(await chain.evaluate(call), call);
    },
  };
}
