$ErrorActionPreference = 'Stop'
$localEnv = Join-Path $PSScriptRoot '.local.env'
$port = 6075
if (Test-Path -LiteralPath $localEnv) {
    $portLine = Get-Content -LiteralPath $localEnv | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -Last 1
    if ($portLine) {
        $candidate = 0
        if ([int]::TryParse(($portLine -split '=', 2)[1].Trim(), [ref]$candidate)) { $port = $candidate }
    }
}

$health = $null
try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2 } catch {}
if (-not $health -or $health.service -ne 'STOK-TAKIP-SISTEMI') {
    Write-Host 'Calisan STOK-TAKIP-SISTEMI sunucusu bulunamadi.' -ForegroundColor Yellow
    exit 0
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $listener) {
    Write-Host 'Sunucu saglikli yanit verdi ancak dinleyici sureci bulunamadi.' -ForegroundColor Yellow
    exit 1
}

Stop-Process -Id $listener.OwningProcess -Force
Write-Host "STOK-TAKIP-SISTEMI durduruldu. PID: $($listener.OwningProcess)" -ForegroundColor Green
