$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location -LiteralPath $root
Write-Host "正在啟動 Agent...（要停止請按 Ctrl+C）"
npm start
