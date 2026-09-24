#!/usr/bin/env bash
# 校验文档里的相对链接是否指向真实文件。文档整理后必跑。
# 用法: bash tools/check-doc-links.sh [docs/requirements.md ...]
set -u
cd "$(dirname "$0")/.."
python - "$@" <<'PY'
import io,os,re,sys
files = sys.argv[1:] or ['docs/requirements.md','docs/reference-cases.md','docs/research/README.md','README.md']
bad=[]; tot=0
for f in files:
    if not os.path.exists(f): print('SKIP (不存在):',f); continue
    base=os.path.dirname(f)
    for i,line in enumerate(io.open(f,encoding='utf-8').read().split('\n'),1):
        for m in re.finditer(r'\]\((?!https?:)([^)#\s]+)(#[^)\s]*)?\)', line):
            p=m.group(1); tot+=1
            if not os.path.exists(os.path.normpath(os.path.join(base,p))):
                bad.append((f,i,p))
print('检查 %d 个链接，%d 个失效' % (tot,len(bad)))
for f,i,p in bad: print('  MISS %s:%d  %s' % (f,i,p))
PY
