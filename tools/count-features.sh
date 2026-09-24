#!/usr/bin/env bash
# 统计 docs/requirements.md §4 功能总表的各项数量。避免手工数错（本项目已数错多次）。
set -u
cd "$(dirname "$0")/.."
python - <<'PY'
import io, re
from collections import defaultdict
lines = io.open('docs/requirements.md', encoding='utf-8').read().split('\n')
try:
    start = next(i for i, l in enumerate(lines) if l.startswith('## 4. 功能总表'))
except StopIteration:
    raise SystemExit('未找到 "## 4. 功能总表" —— 文档结构变了，先修本脚本')
cur = None; counts = defaultdict(lambda: [0, 0, 0]); order = []
for l in lines[start:]:
    m = re.match(r'^### ([A-T])\. ', l)
    if m:
        cur = m.group(1)
        if cur not in order: order.append(cur)
        continue
    m2 = re.match(r'^\|\s*\*?\*?([A-T]\d+)\*?\*?\s*\|.*\|\s*\*?\*?(P[012])\*?\*?\s*\|', l)
    if m2 and cur: counts[cur][int(m2.group(2)[1])] += 1
tot = [0, 0, 0]
for k in order:
    c = counts[k]
    for i in range(3): tot[i] += c[i]
    print("%-4s P0=%-3d P1=%-3d P2=%-3d 小计=%-3d" % (k, c[0], c[1], c[2], sum(c)))
print("层数=%d 合计 P0=%d P1=%d P2=%d 总计=%d" % (len(order), tot[0], tot[1], tot[2], sum(tot)))
PY
