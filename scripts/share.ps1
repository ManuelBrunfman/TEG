$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$cloudflared = Join-Path $root ".tools\cloudflared.exe"

if (-not (Test-Path -LiteralPath $cloudflared)) {
  throw "Falta .tools\cloudflared.exe. Descargalo desde la documentación oficial de Cloudflare Tunnel."
}

try {
  Invoke-RestMethod -Uri "http://127.0.0.1:3100/api/health" -TimeoutSec 2 | Out-Null
} catch {
  Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory $root -WindowStyle Hidden
  Start-Sleep -Seconds 3
  Invoke-RestMethod -Uri "http://127.0.0.1:3100/api/health" -TimeoutSec 5 | Out-Null
}

Write-Host ""
Write-Host "Creando enlace HTTPS temporal para testers..." -ForegroundColor Cyan
Write-Host "Mantené esta ventana abierta mientras estén jugando." -ForegroundColor Yellow
Write-Host ""

& $cloudflared tunnel --url "http://127.0.0.1:3100" --no-autoupdate
