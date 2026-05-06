$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Dist = Join-Path $Root "dist"
$Temp = Join-Path $Dist "_build"

if (Test-Path $Dist) { Remove-Item $Dist -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Temp | Out-Null

Copy-Item (Join-Path $Root "manifest.json") $Temp
Copy-Item (Join-Path $Root "src") (Join-Path $Temp "src") -Recurse

Compress-Archive -Path (Join-Path $Temp "*") -DestinationPath (Join-Path $Dist "local-totp-autofill.zip") -Force
Remove-Item $Temp -Recurse -Force

Write-Host "done: dist/local-totp-autofill.zip"
