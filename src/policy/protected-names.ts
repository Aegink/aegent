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

/** 保留元数据路径名（C46；只能追加不能替换——C36 纪律）。运行时冻结：
 * 任何 mutate（push/splice）直接 throw，追加只能走 extendProtectedNames。 */
export const PROTECTED_METADATA_PATH_NAMES: readonly string[] = Object.freeze([
  ".git",
  ".agents",
  ".codex",
]);

/**
 * 保护清单的唯一追加入口（C36 机制，T-P1-70）：返回**新**冻结清单，
 * 原清单不变；重复追加幂等（大小写不敏感——与段匹配方言一致）；空串
 * 忽略。追加生效于调用方持有的清单实例（未来用户配置/插件扩展保护名
 * 时，把扩展清单传入消费面——findProtectedMetadataSegment 的清单参数
 * 已预留，YAGNI 不做主动接线）。
 */
export function extendProtectedNames(
  list: readonly string[],
  additions: readonly string[],
): readonly string[] {
  const seen = new Set(list.map((s) => s.toLowerCase()));
  const out = [...list];
  for (const addition of additions) {
    const key = addition.trim().toLowerCase();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(addition);
  }
  return Object.freeze(out);
}

/** 路径任一段命中保留名则返回该段原文；否则 undefined。 */
export function findProtectedMetadataSegment(
  path: string,
  names: readonly string[] = PROTECTED_METADATA_PATH_NAMES,
): string | undefined {
  for (const segment of path.split(/[\\/]+/)) {
    if ((names as readonly string[]).includes(segment.toLowerCase())) {
      return segment;
    }
  }
  return undefined;
}
