#!/usr/bin/env bash
# 生成 oss/SOURCES.lock：记录每个上游副本的 URL、当前 commit SHA、克隆日期、LICENSE 标识
# 调研报告必须引用这里的 SHA —— 上游随时会变，没有 SHA 的结论无法复现。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="oss/SOURCES.lock"
TODAY="$(date +%Y-%m-%d)"

{
  echo "# 上游参考仓库快照 —— 由 tools/snapshot.sh 生成，请勿手改"
  echo "# 生成日期: $TODAY"
  echo "#"
  echo "# 用途: 调研报告中每个结论都应能对应到这里的 commit，保证可复现。"
  echo "# 刷新: bash tools/snapshot.sh"
  echo
  printf '%-20s %-38s %-12s %-14s %s\n' "DIR" "REPO" "COMMIT" "DATE" "LICENSE"
  printf '%-20s %-38s %-12s %-14s %s\n' "---" "----" "------" "----" "-------"

  for base in oss refs; do
    [ -d "$base" ] || continue
    for d in "$base"/*/; do
      [ -d "$d/.git" ] || continue
      name="$(basename "$d")"
      url="$(git -C "$d" remote get-url origin 2>/dev/null \
             | sed -e 's#^https://github.com/##' -e 's#\.git$##')"
      sha="$(git -C "$d" rev-parse --short HEAD 2>/dev/null)"
      date="$(git -C "$d" log -1 --format=%cs 2>/dev/null)"

      lic="none"
      for f in LICENSE LICENSE.md LICENSE.txt COPYING COPYING.txt LICENSE-MIT LICENSE-APACHE; do
        if [ -f "$d/$f" ]; then
          # 抓第一行有实质内容的文字作为标识
          head_line="$(grep -m1 -E 'MIT|Apache|GPL|BSD|MPL|ISC|Unlicense|proprietary|Proprietary|All rights reserved|copyright' "$d/$f" 2>/dev/null | head -1 | tr -d '\r' | cut -c1-40)"
          lic="${f}${head_line:+ | $head_line}"
          break
        fi
      done
      printf '%-20s %-38s %-12s %-14s %s\n' "$name" "$url" "$sha" "$date" "$lic"
    done
  done
} > "$OUT"

echo "已写入 $OUT"
column -t -s' ' "$OUT" 2>/dev/null | tail -30 || tail -30 "$OUT"
