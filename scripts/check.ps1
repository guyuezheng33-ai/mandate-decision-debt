# 一条命令跑完整闸门。Windows PowerShell 7 可直接执行：
#   pwsh scripts/check.ps1
$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
npm run check
