#!/usr/bin/env bash
# 统计需求文档功能清单的各项数量。避免手工数错（本项目已数错过两次）。
set -u
cd "$(dirname "$0")/.."
python - <<'PY'
import io, re
from collections import defaultdict
s = io.open('docs/requirements.md', encoding='utf-8').read()
body = s[s.index('### A. Agent Loop'):].split('### 合计',1)[0]
cur=None; counts=defaultdict(lambda:[0,0,0]); order=[]
for line in body.split('\n'):
    m = re.match(r'^### ([A-S])\.', line)
    if m:
        cur=m.group(1)
        if cur not in order: order.append(cur)
        continue
    m2 = re.match(r'^\|\s*\*?\*?([A-S]\d+)\*?\*?\s*\|.*\|\s*\*?\*?(P[012])\*?\*?\s*\|', line)
    if m2 and cur: counts[cur][int(m2.group(2)[1])] += 1
tot=[0,0,0]
for k in order:
    c=counts[k]
    for i in range(3): tot[i]+=c[i]
    print("%-4s P0=%-3d P1=%-3d P2=%-3d 小计=%-3d" % (k,c[0],c[1],c[2],sum(c)))
print("合计 P0=%d P1=%d P2=%d 总计=%d" % (tot[0],tot[1],tot[2],sum(tot)))
PY
