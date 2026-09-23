#!/usr/bin/env bash
# 幂等克隆上游参考仓库到 oss/ 与 refs/
# 已存在则跳过（可安全重跑）。上游副本不纳入我方 git，版本由 oss/SOURCES.lock 固定。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p oss refs

# 格式: 本地目录名|GitHub owner/repo|分组
#
# 注: anomalyco/opencode 与 sst/opencode 在 2026-09-23 指向同一 commit 18ef3cc
#     (tree 9c24c963...)，内容完全一致，因此只克隆一份。若日后分叉，再补拉另一份。
REPOS="
pi|earendil-works/pi|primary
opencode|anomalyco/opencode|primary
deepseek-harness|deepseek-ai/deepseek-harness|primary
codex|openai/codex|primary
kimi-code|MoonshotAI/kimi-code|primary
zcode|zai-org/ZCode|primary
qwen-code|QwenLM/qwen-code|primary
grok-build|xai-org/grok-build|primary
hermes-agent|NousResearch/hermes-agent|primary
pi-desktop|vastsa/PI-Desktop|primary
pideck|ayuayue/PiDeck|primary
pi-mono|lue-labs/pi-mono|supplement
mini-agent|MiniMax-AI/Mini-Agent|supplement
mini-swe-agent|SWE-agent/mini-swe-agent|supplement
agentscope|modelscope/agentscope|supplement
cc-switch|farion1231/cc-switch|supplement
claude-official|anthropics/claude-code|refs
"

ok=0; skip=0; fail=0
while IFS='|' read -r name slug group; do
  [ -z "$name" ] && continue
  case "$group" in
    refs) dest="refs/$name" ;;
    *)    dest="oss/$name" ;;
  esac
  if [ -d "$dest/.git" ]; then
    echo "SKIP    $dest ($slug)"; skip=$((skip+1)); continue
  fi
  echo "CLONE   $dest <- $slug"
  if git clone --depth 1 --quiet "https://github.com/$slug.git" "$dest" 2>&1; then
    ok=$((ok+1))
  else
    echo "FAIL    $dest <- $slug"; fail=$((fail+1))
  fi
done <<< "$REPOS"

echo "======================================"
echo "cloned=$ok skipped=$skip failed=$fail"
