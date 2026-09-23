#!/usr/bin/env bash
# 生成 oss/SOURCES.lock —— 记录每个上游副本的 URL / commit SHA / 许可 / 克隆日
# 调研报告的每条结论都应对应到这里的 commit；上游随时会变，没有 SHA 就无法复现。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source "$ROOT/tools/license-detect.sh"
OUT="oss/SOURCES.lock"
TODAY="$(date +%Y-%m-%d)"

{
echo "# 上游参考仓库快照"
echo
echo "> 由 \`tools/snapshot.sh\` 于 $TODAY 生成，**请勿手改**。刷新：\`bash tools/snapshot.sh\`"
echo ">"
echo "> 调研报告中引用代码或行为时，必须能对应到下表 commit，否则结论不可复现。"
echo
echo "| 目录 | 仓库 | Commit | 上游提交日 | 许可 | 体积 |"
echo "|------|------|--------|-----------|------|------|"

for base in oss refs; do
  [ -d "$base" ] || continue
  for d in "$base"/*/; do
    [ -d "$d/.git" ] || continue
    n="$(basename "$d")"
    url="$(git -C "$d" remote get-url origin 2>/dev/null | sed -e 's#^https://github.com/##' -e 's#\.git$##')"
    sha="$(git -C "$d" rev-parse --short HEAD 2>/dev/null)"
    udate="$(git -C "$d" log -1 --format=%cs 2>/dev/null)"
    sz="$(du -sh "$d" 2>/dev/null | cut -f1)"
    echo "| $n | $url | \`$sha\` | $udate | $(detect_license "$d") | $sz |"
  done
done

echo
echo "## 许可分级（决定能否摘代码）"
echo
echo "- **MIT / Apache-2.0 / BSD** → 可参考实现，摘代码须保留版权头并登记 \`THIRD_PARTY.md\`"
echo "- **LGPL** → 可链接调用；若修改库本身并分发，须回馈修改"
echo "- **GPL / AGPL** → 只学行为，**不摘代码**（传染性）"
echo "- **PROPRIETARY / NO-LICENSE** → 只读行为与文档，**不摘代码**"
} > "$OUT"

echo "已写入 $OUT"; echo; grep -v '^>' "$OUT" | grep -v '^$'
