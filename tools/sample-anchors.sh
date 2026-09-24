#!/usr/bin/env bash
# 从 docs/requirements.md §4 随机抽取若干条，输出「待核对清单」。
# 用途：给独立复核会话一个可复现、不靠自觉的抽样靶子。
# 用法: bash tools/sample-anchors.sh [条数=30] [随机种子=20260925]
set -u
cd "$(dirname "$0")/.."
N="${1:-30}"; SEED="${2:-20260925}"
python - "$N" "$SEED" <<'PY'
import io,os,random,re,sys
try: sys.stdout.reconfigure(encoding='utf-8')   # Windows 控制台默认 GBK，会炸在 ✅ 上
except Exception: pass
N=int(sys.argv[1]); seed=sys.argv[2]
lines=io.open('docs/requirements.md',encoding='utf-8').read().split('\n')
st=next(i for i,l in enumerate(lines) if l.startswith('## 4. 功能总表'))
en=next(i for i,l in enumerate(lines) if l.startswith('## 5. '))
cur=None; rows=[]
for l in lines[st:en]:
    m=re.match(r'^### ([A-T])\. ',l)
    if m: cur=m.group(1); continue
    m2=re.match(r'^\|\s*\*?\*?([A-T]\d+)\*?\*?\s*\|\s*(.+?)\s*\|\s*\*?\*?(P[012])\*?\*?\s*\|\s*(.+?)\s*\|',l)
    if not m2: continue
    rid,desc,pri,ref=m2.group(1),m2.group(2),m2.group(3),m2.group(4)
    lm=re.search(r'\]\(\.\./([^)#]+)(?:#(L\d+))?\)',ref)
    path,anchor=(lm.group(1),lm.group(2) or '') if lm else (None,None)
    rows.append((rid,cur,pri,desc,path,anchor,ref))
# 分层抽样：P0 占 60%，P1 占 30%，P2 占 10%（四舍五入后补齐）
by={p:[r for r in rows if r[2]==p] for p in ('P0','P1','P2')}
random.seed(seed)
want={'P0':round(N*0.6),'P1':round(N*0.3)}
want['P2']=max(0,N-want['P0']-want['P1'])
picked=[]
for p in ('P0','P1','P2'):
    k=min(want[p],len(by[p])); picked+=random.sample(by[p],k)
picked.sort(key=lambda r:(r[1],int(r[0][1:])))
print('# 锚点抽样核对清单（%d 条 / 全表 %d 条 · seed=%s）\n'%(len(picked),len(rows),seed))
print('判定说明：**✅** 文件存在且行号落在声称的位置、语义支撑需求 ｜ '
      '**⚠️** 文件对但行号偏（语义仍对） ｜ **❌** 指错文件或语义不符\n')
print('| # | ID | 层 | 优先级 | 需求声称 | 指向（仓·路径:行） | 判定 | 备注 |')
print('| --- | --- | --- | --- | --- | --- | --- | --- |')
for i,(rid,layer,pri,desc,path,anchor,ref) in enumerate(picked,1):
    loc='`%s%s`'%(path,(':'+anchor) if anchor else '') if path else '**无链接**'
    print('| %d | %s | %s | %s | %s | %s | | |'%(i,rid,layer,pri,desc,loc))
miss=[r for r in picked if not r[4]]
if miss: print('\n> 注意：抽样中有 %d 条**没有可点链接**（自研或跨仓综合），只能按语义判断。'%len(miss))
PY
