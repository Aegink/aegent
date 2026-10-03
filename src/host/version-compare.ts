/**
 * 轻量版本比较（T-P3-155 C1——pideck versionCompare.ts:12-33 锚）：数字段
 * 逐段补零比较；预发布标识（含 -）低于同号正式版；无第三方依赖。
 */

export function compareVersions(a: string, b: string): number {
  const norm = (v: string) => v.trim().replace(/^v/i, "");
  const [aMain, aPre] = norm(a).split("-");
  const [bMain, bPre] = norm(b).split("-");
  const aSegs = aMain!.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const bSegs = bMain!.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(aSegs.length, bSegs.length);
  for (let i = 0; i < len; i++) {
    const av = aSegs[i] ?? 0;
    const bv = bSegs[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  // 主版本相等：预发布 < 正式；同为预发布按字典序（近似——够用）
  if (aPre !== undefined && bPre === undefined) return -1;
  if (aPre === undefined && bPre !== undefined) return 1;
  if (aPre === undefined && bPre === undefined) return 0;
  return aPre!.localeCompare(bPre!);
}
