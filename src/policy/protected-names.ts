/**
 * 保留元数据路径名清单（C46 的数据面）——唯一权威定义处。
 *
 * 清单取 codex·permissions.rs 的 PROTECTED_METADATA_PATH_NAMES：
 * .git / .agents / .codex（版本控制元数据 + agent 指令/配置目录）。
 * C36 纪律现在就立：**清单只能追加、不能替换**——收缩清单等于打开
 * 元数据篡改口，追加走代码评审。
 *
 * 独立成文件的原因：清单同时被硬拦出口（protected-paths.ts）与 shell
 * 语义分析（shell-semantics.ts）消费，各自单向 import 本文件，避免
 * protected-paths ↔ shell-semantics 互指成环（T-P1-01 起出口级硬拦
 * 反向消费 shell 扫描器）。
 *
 * 方言（保守方向）：路径段比较不分大小写——Windows 盘大小写不敏感，
 * ".GIT" 就是 ".git"；POSIX 上多拦一个凑巧叫 ".GIT" 的目录是可接受的
 * 误拦方向。对路径任一段命中都拦（嵌套仓库的 .git 同受保护），比
 * codex 的工作区顶层更严，记为已知取舍。
 */

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
