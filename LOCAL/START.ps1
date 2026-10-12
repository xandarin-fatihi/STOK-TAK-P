$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $packageRoot 'ORTAK'
$dataRoot = Join-Path $runtimeRoot ('VER' + [char]0x0130)
Set-Location -LiteralPath $runtimeRoot

$localEnv = Join-Path $PSScriptRoot '.local.env'
if (Test-Path -LiteralPath $localEnv) {
    Get-Content -LiteralPath $localEnv | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
        }
    }
}

if (-not $env:PORT) { $env:PORT = '6075' }
if (-not $env:ADMIN_USERNAME) { $env:ADMIN_USERNAME = 'admin' }
if (-not $env:NODE_ENV) { $env:NODE_ENV = 'development' }
if (-not $env:NOTIFICATION_WORKERS_ENABLED) { $env:NOTIFICATION_WORKERS_ENABLED = 'false' }
if (-not $env:DATA_FILE) { $env:DATA_FILE = Join-Path $dataRoot 'STORE\store.json' }
if (-not $env:MEDIA_DIR) { $env:MEDIA_DIR = Join-Path $dataRoot 'MEDIA' }
if (-not $env:PROCUREMENT_DOCUMENTS_DIR) { $env:PROCUREMENT_DOCUMENTS_DIR = Join-Path $dataRoot 'PROCUREMENT-DOCUMENTS' }
if (-not $env:DATA_IMPORT_COLD_DIR) { $env:DATA_IMPORT_COLD_DIR = Join-Path $dataRoot 'STORE\data-import-cold' }
if (-not $env:BACKUP_DIR) { $env:BACKUP_DIR = Join-Path $dataRoot 'STORE\backups' }
if (-not $env:LOG_DIR) { $env:LOG_DIR = Join-Path $packageRoot 'DENETIM\logs' }
if (-not $env:ADMIN_COOKIE_NAME) { $env:ADMIN_COOKIE_NAME = 'stok_takip_admin_session' }
if (-not $env:RECIPE_COOKIE_NAME) { $env:RECIPE_COOKIE_NAME = 'stok_takip_personel_session' }
if (-not $env:JWT_ISSUER) { $env:JWT_ISSUER = 'stok-takip-sistemi-backend' }
if (-not $env:JWT_AUDIENCE) { $env:JWT_AUDIENCE = 'stok-takip-sistemi-apps' }

if (-not $env:JWT_SECRET) {
    $jwtBytes = New-Object byte[] 48
    $jwtRandom = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $jwtRandom.GetBytes($jwtBytes)
    }
    finally {
        $jwtRandom.Dispose()
    }
    $env:JWT_SECRET = [Convert]::ToBase64String($jwtBytes).Replace('=','').Replace('/','x').Replace('+','Z')
    Add-Content -LiteralPath $localEnv -Encoding UTF8 -Value "JWT_SECRET=$($env:JWT_SECRET)"
    Write-Host "Kalici yerel oturum anahtari LOCAL/.local.env dosyasina kaydedildi; konsola yazdirilmadi." -ForegroundColor Yellow
}

$resolvedPackageRoot = [IO.Path]::GetFullPath($packageRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
foreach ($pathVariable in @('DATA_FILE','MEDIA_DIR','PROCUREMENT_DOCUMENTS_DIR','DATA_IMPORT_COLD_DIR','BACKUP_DIR','LOG_DIR')) {
    $resolvedValue = [IO.Path]::GetFullPath([string][Environment]::GetEnvironmentVariable($pathVariable, 'Process'))
    if (-not $resolvedValue.StartsWith($resolvedPackageRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$pathVariable STOK-TAKIP-SISTEMI disina cozumleniyor; baslatma durduruldu: $resolvedValue"
    }
    [Environment]::SetEnvironmentVariable($pathVariable, $resolvedValue, 'Process')
}
foreach ($directoryVariable in @('MEDIA_DIR','PROCUREMENT_DOCUMENTS_DIR','DATA_IMPORT_COLD_DIR','BACKUP_DIR','LOG_DIR')) {
    New-Item -ItemType Directory -Path ([Environment]::GetEnvironmentVariable($directoryVariable, 'Process')) -Force | Out-Null
}

$portNumber = 0
if (-not [int]::TryParse([string]$env:PORT, [ref]$portNumber) -or $portNumber -lt 1 -or $portNumber -gt 65535) {
    throw "Gecersiz PORT degeri: $($env:PORT)"
}

$healthUrl = "http://127.0.0.1:$portNumber/api/health"
$runningPackage = $null
try {
    $runningPackage = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2 -ErrorAction Stop
}
catch {
    $runningPackage = $null
}

if ($runningPackage -and $runningPackage.ok -eq $true -and $runningPackage.service -eq 'STOK-TAKIP-SISTEMI') {
    Write-Host "STOK-TAKIP-SISTEMI sunucusu zaten calisiyor." -ForegroundColor Green
    Write-Host "Yonetici  : http://localhost:$portNumber/yonetici/"
    Write-Host "Personel  : http://localhost:$portNumber/personel/"
    Write-Host "Health    : http://localhost:$portNumber/api/health"
    exit 0
}

$listener = Get-NetTCPConnection -LocalPort $portNumber -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $processName = 'Bilinmeyen surec'
    try {
        $processName = (Get-Process -Id $listener.OwningProcess -ErrorAction Stop).ProcessName
    }
    catch {}
    throw "Port $portNumber baska bir surec tarafindan kullaniliyor. PID: $($listener.OwningProcess), surec: $processName. Farkli bir PORT degeri belirleyin veya bu sureci kapatin."
}

$storeFile = [Environment]::GetEnvironmentVariable('DATA_FILE', 'Process')
if (-not (Test-Path -LiteralPath $storeFile) -and -not $env:DEFAULT_PANEL_PASSWORD) {
    $bytes = New-Object byte[] 18
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($bytes)
    }
    finally {
        $random.Dispose()
    }
    $env:DEFAULT_PANEL_PASSWORD = [Convert]::ToBase64String($bytes).Replace('=','').Replace('/','x').Replace('+','Z')
    Add-Content -LiteralPath $localEnv -Encoding UTF8 -Value @("ADMIN_USERNAME=$($env:ADMIN_USERNAME)", "DEFAULT_PANEL_PASSWORD=$($env:DEFAULT_PANEL_PASSWORD)")
    Write-Host "Ilk yonetici parolasi LOCAL/.local.env dosyasina kaydedildi; konsola yazdirilmadi." -ForegroundColor Yellow
}

if (-not (Test-Path -LiteralPath (Join-Path $runtimeRoot 'node_modules'))) {
    npm install --no-audit --no-fund
}

Write-Host "Yonetici  : http://localhost:$($env:PORT)/yonetici/"
Write-Host "Personel  : http://localhost:$($env:PORT)/personel/"
Write-Host "Health    : http://localhost:$($env:PORT)/api/health"
Write-Host "Veri guvenligi: Her DATA_FILE icin yalniz bir Node yazici sureci calistirin. Ikinci port ikinci yazici izni vermez." -ForegroundColor Yellow
npm start
