# DPAPI helper (T-6-04 / D8) -- Windows PowerShell 5.1+, no third-party deps.
#
# NOTE: this file must stay pure ASCII. PowerShell 5.1 reads BOM-less .ps1
# files with the system ANSI codepage (GBK on zh-CN machines); non-ASCII
# comments are misread byte-wise and can break the parser depending on
# UTF-8 byte alignment. Rationale and protocol docs live in the TS wrapper
# (src/sandbox/dpapi/index.ts header, in Chinese).
#
# Cross-process protocol (T9: serializable values only):
#   argv    action name (protect | unprotect)
#   stdin   base64(UTF-8 payload) -- plaintext never goes on the command line
#           (the command line is visible to other local processes)
#   stdout  base64(UTF-8 result); protect yields the PowerShell DPAPI blob
#           (hex text) re-encoded as base64
# Base64 on both sides bypasses console codepage issues entirely.
#
# Scope: ConvertTo/From-SecureString uses per-user DPAPI (same Windows user
# can decrypt; other users/machines cannot) -- tighter than codex dpapi.rs
# machine scope (CRYPTPROTECT_LOCAL_MACHINE); P0 keys belong to the current
# user and need no elevation-shared decryption.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("protect", "unprotect")]
  [string]$Action
)
$ErrorActionPreference = "Stop"
$payloadB64 = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($payloadB64)
$text = [Text.Encoding]::UTF8.GetString($bytes)
if ($Action -eq "protect") {
  $sec = ConvertTo-SecureString -String $text -AsPlainText -Force
  $blob = ConvertFrom-SecureString -SecureString $sec
  [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($blob)))
} else {
  $sec = ConvertTo-SecureString -String $text
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plain)))
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}
