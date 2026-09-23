#!/usr/bin/env bash
# 生成 docs/research/00-inventory.md —— 从真实文件读取，禁止凭记忆。
# 每个仓输出：URL / commit / 许可 / 体积 / 顶层结构 / 语言栈 / 是否有 server·ACP·MCP
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="docs/research/00-inventory.md"
TODAY="$(date +%Y-%m-%d)"

{
echo "# 00 · 本机仓库盘点"
echo
echo "> 由 \`tools/inventory.sh\` 于 $TODAY 生成。所有字段来自实际文件读取。"
echo "> 若某仓「缺失」，说明本机未克隆 —— 报告中不得对其作任何分析。"
echo
echo "## 汇总"
echo
echo "| 目录 | 仓库 | Commit | 许可 | 体积 |"
echo "|------|------|--------|------|------|"

for base in oss refs; do
  [ -d "$base" ] || continue
  for d in "$base"/*/; do
    [ -d "$d/.git" ] || continue
    n="$(basename "$d")"
    url="$(git -C "$d" remote get-url origin 2>/dev/null | sed -e 's#^https://github.com/##' -e 's#\.git$##')"
    sha="$(git -C "$d" rev-parse --short HEAD 2>/dev/null)"
    sz="$(du -sh "$d" 2>/dev/null | cut -f1)"
    lic="—"
    for f in LICENSE LICENSE.md LICENSE.txt COPYING; do
      if [ -f "$d/$f" ]; then
        lic="$(grep -m1 -oE 'MIT|Apache License|Apache-2\.0|GNU (AFFERO )?GENERAL PUBLIC LICENSE|BSD|Mozilla Public License|ISC|The Unlicense|Business Source' "$d/$f" | head -1)"
        lic="${lic:-自定义/见文件}"
        break
      fi
    done
    echo "| $n | $url | $sha | $lic | $sz |"
  done
done
echo
echo "## 逐仓明细"
echo
for base in oss refs; do
  [ -d "$base" ] || continue
  for d in "$base"/*/; do
    [ -d "$d/.git" ] || continue
    n="$(basename "$d")"
    url="$(git -C "$d" remote get-url origin 2>/dev/null | sed -e 's#^https://github.com/##' -e 's#\.git$##')"
    echo "### $n"
    echo
    echo "- 仓库: \`$url\`"
    echo "- Commit: \`$(git -C "$d" rev-parse HEAD 2>/dev/null)\`"
    echo "- 最近提交日: $(git -C "$d" log -1 --format=%cs 2>/dev/null)"
    echo "- 体积: $(du -sh "$d" 2>/dev/null | cut -f1)"
    echo "- 顶层条目: \`$(ls "$d" | grep -v '^\.git$' | head -25 | tr '\n' ' ')\`"
    echo "- 收集 PR: $(grep -qilE 'pull request|contributing' "$d/CONTRIBUTING.md" 2>/dev/null && echo '有 CONTRIBUTING.md' || echo '无 CONTRIBUTING.md')"
    # 语言栈
    langs=""
    [ -f "$d/package.json" ]           && langs="$langs Node/TS"
    [ -f "$d/Cargo.toml" ]             && langs="$langs Rust"
    [ -f "$d/go.mod" ]                 && langs="$langs Go"
    [ -f "$d/pyproject.toml" ]         && langs="$langs Python"
    [ -f "$d/requirements.txt" ]       && langs="$langs Python"
    [ -d "$d/packages" ]               && langs="$langs +monorepo(packages/)"
    echo "- 语言栈:${langs:- 未识别}"
    # 多端信号
    sig=""
    [ -d "$d/packages/server" ] || [ -d "$d/server" ] || [ -d "$d/crates/server" ] && sig="$sig server"
    grep -rqil "agent-client-protocol\|acp://" "$d" --include='*.json' --include='*.md' --include='*.ts' --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null && sig="$sig ACP"
    grep -rqil "modelcontextprotocol\|@modelcontextprotocol" "$d" --include='*.json' --include='*.ts' --include='*.py' --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null && sig="$sig MCP"
    echo "- 多端/扩展信号:${sig:- 无}"
    echo
  done
done
} > "$OUT"

echo "已写入 $OUT ($(wc -l < "$OUT") 行)"
