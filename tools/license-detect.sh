#!/usr/bin/env bash
# 精确识别一个仓库的根许可证。可被其他脚本 source。
# 用法: lic=$(detect_license /path/to/repo); licfile=$(detect_license_file /path/to/repo)
set -u

detect_license_file() {
  local d="$1"
  for f in LICENSE LICENSE.md LICENSE.txt COPYING COPYING.txt LICENSE-MIT LICENSE-APACHE; do
    [ -f "$d/$f" ] && { echo "$f"; return; }
  done
  echo ""
}

detect_license() {
  local d="$1" f txt
  f="$(detect_license_file "$d")"
  [ -z "$f" ] && { echo "NO-LICENSE (未找到许可文件)"; return; }
  txt="$(tr -d '\r' < "$d/$f")"

  # 顺序要紧：先判 LESSER，再判 GPL，否则 LGPL 会被误判成 GPL
  if grep -qiE "GNU LESSER GENERAL PUBLIC LICENSE" <<<"$txt"; then
      local v; v=$(grep -oiE "Version [0-9]+" <<<"$txt" | head -1)
      echo "LGPL ($v) [$f]"; return
  fi
  if grep -qiE "GNU AFFERO GENERAL PUBLIC LICENSE" <<<"$txt"; then echo "AGPL-3.0 [$f]"; return; fi
  if grep -qE "GNU GENERAL PUBLIC LICENSE" <<<"$txt"; then
      local v; v=$(grep -oiE "Version [0-9]+" <<<"$txt" | head -1)
      echo "GPL ($v) [$f]"; return
  fi
  if grep -qiE "Apache License" <<<"$txt"; then echo "Apache-2.0 [$f]"; return; fi
  if grep -qiE "Mozilla Public License" <<<"$txt"; then echo "MPL-2.0 [$f]"; return; fi
  if grep -qiE "Business Source License" <<<"$txt"; then echo "BUSL (非开源) [$f]"; return; fi
  if grep -qiE "Permission is hereby granted, free of charge" <<<"$txt"; then echo "MIT [$f]"; return; fi
  if grep -qiE "Redistribution and use in source and binary forms" <<<"$txt"; then echo "BSD [$f]"; return; fi
  if grep -qiE "All rights reserved" <<<"$txt"; then
      echo "PROPRIETARY (保留所有权利，不可复制) [$f]"; return
  fi
  echo "UNKNOWN (需人工判读) [$f]"
}
