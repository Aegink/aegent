#!/usr/bin/env bash
# 对一个上游仓做结构化探针，输出调研所需的机械事实（不做判断）。
# 用法: bash tools/probe-repo.sh oss/<name>
set -u
d="${1:?用法: probe-repo.sh <repo-path>}"
[ -d "$d" ] || { echo "不存在: $d"; exit 1; }
name="$(basename "$d")"
ex="--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build"
# find 不认 grep 的 --exclude-dir，单独一套剪枝表达式
fex='-not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/test/*" -not -path "*/tests/*" -not -path "*/__tests__/*" -not -path "*/target/*" -not -path "*/vendor/*"'
_ev() { eval "true"; }

echo "##### $name #####"
echo "-- 顶层:"; ls "$d" | grep -v '^\.git$' | head -22 | tr '\n' ' '; echo
echo "-- 语言:"; { [ -f "$d/package.json" ] && echo -n " Node"; [ -f "$d/Cargo.toml" ] && echo -n " Rust";
  [ -f "$d/go.mod" ] && echo -n " Go"; [ -f "$d/pyproject.toml" ] && echo -n " Python"; } ; echo
echo "-- workspace/子包:"; { [ -d "$d/packages" ] && ls "$d/packages" | head -30 | tr '\n' ' ';
  [ -d "$d/crates" ] && ls "$d/crates" | head -25 | tr '\n' ' ';
  find "$d" -maxdepth 2 -name "go.mod" 2>/dev/null | head -8 | xargs -I{} dirname {} 2>/dev/null | tr '\n' ' '; }; echo
echo "-- loop 入口候选:"
grep -rlE "agent.?loop|runAgent|AgentLoop" "$d" --include='*.ts' --include='*.rs' --include='*.go' --include='*.py' $ex 2>/dev/null | grep -viE "/test|/tests|spec\." | head -6 | sed 's/^/   /'
echo "-- 工具目录:"
eval "find \"$d\" -maxdepth 5 -type d \( -name tools -o -name tool \) $fex" 2>/dev/null | head -5 | sed 's/^/   /'
echo "-- 会话/存储:"
eval "find \"$d\" -maxdepth 5 -type d \( -name \"session*\" -o -name storage -o -name history -o -name transcript -o -name conversation \) $fex" 2>/dev/null | head -6 | sed 's/^/   /'
echo "-- 权限/沙箱:"
eval "find \"$d\" -maxdepth 5 -type d \( -name \"permission*\" -o -name \"sandbox*\" -o -name policy -o -name guard -o -name safety \) $fex" 2>/dev/null | head -5 | sed 's/^/   /'
echo "-- 多端信号:"
grep -rlE "agent-client-protocol|acp|websocket|slack|telegram|discord" "$d" --include='*.json' --include='*.toml' --include='*.md' --include='*.ts' --include='*.py' --include='*.rs' --include='*.go' $ex 2>/dev/null | head -5 | sed 's/^/   /'
echo "-- plan/compaction/subagent 文件:"
eval "find \"$d\" -maxdepth 5 -type f \( -name \"*compact*\" -o -name \"*plan*\" -o -name \"*subagent*\" -o -name \"*sub-agent*\" -o -name \"*fork*\" -o -name \"*rewind*\" -o -name \"*goal*\" -o -name \"*job*\" \) $fex" 2>/dev/null | head -10 | sed 's/^/   /'
echo
