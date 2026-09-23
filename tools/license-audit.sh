#!/usr/bin/env bash
# 合规审计：对 oss/ 与 refs/ 下每个副本检查
#   1. 是否含 LICENSE / 许可证类型
#   2. 是否含泄露迹象（sourcemap、minified CC 产物、README 自述 leaked 等）
#   3. 是否声明为 clean-room
# 命中泄露迹象的仓 -> 人工复核后移入报告「排除清单」
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 泄露/可疑关键词。命中即打标，需人工判断，不自动删除。
LEAK_PAT='leaked|leak of|sourcemap.*claude|claude-code.*deobfusc|deobfuscated|反混淆|逆向.*claude'
CLEAN_PAT='clean.?room|未使用.*泄露|no leaked|without.*leaked'

for base in oss refs; do
  [ -d "$base" ] || continue
  for d in "$base"/*/; do
    [ -d "$d/.git" ] || continue
    name="$(basename "$d")"
    echo "=============================================================="
    echo "REPO: $name"
    echo "URL : $(git -C "$d" remote get-url origin 2>/dev/null)"

    # --- LICENSE ---
    licfile=""
    for f in LICENSE LICENSE.md LICENSE.txt COPYING COPYING.txt NOTICE; do
      [ -f "$d/$f" ] && { licfile="$f"; break; }
    done
    if [ -n "$licfile" ]; then
      echo "LIC : $licfile -> $(head -3 "$d/$licfile" | tr -d '\r' | tr '\n' ' ' | cut -c1-90)"
    else
      echo "LIC : !! 未找到 LICENSE 文件 —— 默认不可参考实现，只能看行为"
    fi

    # --- 仓库体积（异常巨大 = 可能打包了构建产物/泄露包）---
    size="$(du -sh "$d" 2>/dev/null | cut -f1)"
    echo "SIZE: $size"

    # --- 泄露迹象扫描（只扫 README/顶层描述性文件，不全仓 grep）---
    hits="$(grep -rilE "$LEAK_PAT" "$d" --include='README*' --include='*.md' \
              --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | head -3)"
    if [ -n "$hits" ]; then
      echo "WARN: 泄露关键词命中 ->"; echo "$hits" | sed 's/^/        /'
    else
      echo "LEAK: 未在文档中命中泄露关键词"
    fi

    # --- clean-room 声明 ---
    if grep -rilE "$CLEAN_PAT" "$d" --include='README*' --include='*.md' \
         --exclude-dir=node_modules --exclude-dir=.git >/dev/null 2>&1; then
      echo "CLEAN-ROOM: 有声明"
    else
      echo "CLEAN-ROOM: 无明确声明"
    fi

    # --- sourcemap 存在性（专有产物常见特征）---
    sm="$(find "$d" -maxdepth 3 -name '*.js.map' -not -path '*/node_modules/*' 2>/dev/null | head -3)"
    [ -n "$sm" ] && { echo "SOURCEMAP: 发现 ->"; echo "$sm" | sed 's/^/        /'; } || echo "SOURCEMAP: 无"
  done
done
