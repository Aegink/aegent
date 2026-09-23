#!/usr/bin/env bash
# 全仓横向扫描（定向版）：只找实现痕迹（目录名 / 具体类型名），不用泛词。
# 泛词会大面积命中 CHANGELOG 与文档，噪音淹没信号。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
EX="-not -path */node_modules/* -not -path */.git/* -not -path */dist/* -not -path */target/* -not -path */__pycache__/* -not -path */test/* -not -path */tests/*"

# 关注点|目录名正则（找实现目录/文件，不找文档）
TOPICS='
取消与中断|cancel[_-]?turn|CancelToken|interrupt[_-]?turn|abort[_-]?turn|do_cancel
重复调用防护|repeat[_-]tool|repeat[_-]reminder|no[_-]progress|loop[_-]detect|stall
限流与配额|retry[_-]budget|retry[_-]policy|rate[_-]limit|admission|quota|throttl
成本核算|accounting|billing|cost[_-]track|usage[_-]report|token[_-]cost
会话格式迁移|format[_-]v[0-9]|session[_-]migration|migrat|legacy|upgrade[_-]session
子代理多后端|subagent|sub[_-]agent
Windows沙箱|windows[_-]acl|windows[_-]sandbox|win32|pwsh|powershell
远程执行|ssh|remote[_-]exec|remote[_-]host
时间上下文|time[_-]context|current[_-]time|now[_-]provider|clock
大输出落盘|spill|offload|overflow[_-]to[_-]disk
图片卸载|image[_-]offload|image[_-]prune|media[_-]offload
工具结果裁剪|result[_-]prun|tool[_-]result[_-]limit|truncat
不变量检查|invariant
会话查询|session[_-]query|query[_-]session
Hook协议兼容|hook[_-]protocol|hooks[_-]claude|hooks[_-]codex
LLM回放测试|llm[_-]replay|replay[_-]fixture|cassette|golden
预设与人设|agent[_-]preset|persona|preset[_-]registry
超时策略|timeout[_-]policy|idle[_-]timeout|deadline
审批交互|user[_-]approval|tool[_-]ask|elicitation|permission[_-]preset
定时任务|schedule|cron|scheduled[_-]task
webhook|webhook
附件|attachment
浏览器与计算机使用|browser[_-]use|computer[_-]use
反馈机制|feedback
'

while IFS='|' read -r label pat; do
  [ -z "$label" ] && continue
  echo "################ $label"
  for d in oss/*/ refs/*/; do
    [ -d "$d/.git" ] || continue
    n="$(basename "$d")"
    # 找目录/文件名命中
    hits=$(eval "find \"$d\" -maxdepth 6 \( -type d -o -type f \) $EX" 2>/dev/null \
           | grep -iE "$pat" | sed "s|^$d||" | grep -viE '\.(md|json|lock|txt)$' | head -3)
    [ -n "$hits" ] && { printf '%-18s' "$n"; echo "$hits" | tr '\n' ' '; echo; }
  done
  echo
done <<< "$TOPICS"
