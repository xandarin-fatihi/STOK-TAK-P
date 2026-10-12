param(
    [switch]$WithoutNodeModules
)

$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$desktopRoot = [Environment]::GetFolderPath('Desktop')
$zipPath = Join-Path $desktopRoot 'PAKET 3 TEMİZ.zip'
$stagingBase = Join-Path ([IO.Path]::GetTempPath()) ("menu-suite-clean-" + [Guid]::NewGuid().ToString('N'))
$stagingRoot = Join-Path $stagingBase 'PAKET 3'

function Assert-ChildPath {
    param([string]$Path, [string]$Parent)
    $resolvedPath = [IO.Path]::GetFullPath($Path)
    $resolvedParent = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedPath.StartsWith($resolvedParent, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Güvenli klasör sınırı aşıldı: $resolvedPath"
    }
}

function Copy-PackageDirectory {
    param([string]$Name)
    $source = Join-Path $sourceRoot $Name
    $target = Join-Path $stagingRoot $Name
    if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "Kaynak klasör bulunamadı: $source" }
    Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
}

try {
    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
    foreach ($name in @('LOCAL', 'ORTAK', 'PERSONEL', 'YÖNETİCİ PANELİ')) {
        Copy-PackageDirectory -Name $name
    }

    $stagedData = Join-Path $stagingRoot 'ORTAK\VERİ'
    Assert-ChildPath -Path $stagedData -Parent $stagingRoot
    if (Test-Path -LiteralPath $stagedData) { Remove-Item -LiteralPath $stagedData -Recurse -Force }
    New-Item -ItemType Directory -Path (Join-Path $stagedData 'MEDIA') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $stagedData 'STORE') -Force | Out-Null

    $localRuntimePaths = @(
        (Join-Path $stagingRoot 'LOCAL\.local.env'),
        (Join-Path $stagingRoot 'LOCAL\REVISION-TEST-DATA'),
        (Join-Path $stagingRoot 'LOCAL\revision-results.json'),
        (Join-Path $stagingRoot 'LOCAL\revision-smoke.cjs')
    )
    foreach ($runtimePath in $localRuntimePaths) {
        Assert-ChildPath -Path $runtimePath -Parent $stagingRoot
        if (Test-Path -LiteralPath $runtimePath) { Remove-Item -LiteralPath $runtimePath -Recurse -Force }
    }

    @(
        'PORT=6063',
        'ADMIN_USERNAME=admin',
        'DEFAULT_PANEL_PASSWORD=change-this-on-first-run'
    ) | Set-Content -LiteralPath (Join-Path $stagingRoot 'LOCAL\.local.env') -Encoding UTF8

    $node = (Get-Command node -ErrorAction Stop).Source
    $generator = @'
const fs = require("fs");
const path = require("path");
const sourceRoot = process.argv[1];
const stagingRoot = process.argv[2];
const bcrypt = require(path.join(sourceRoot, "ORTAK", "node_modules", "bcryptjs"));
const { defaultStore } = require(path.join(sourceRoot, "ORTAK", "API", "src", "store", "file-store"));
const passwordHash = bcrypt.hashSync("change-this-on-first-run", 12);
const store = defaultStore(passwordHash);
const target = path.join(stagingRoot, "ORTAK", "VERİ", "STORE", "store.json");
fs.writeFileSync(target, `${JSON.stringify(store, null, 2)}\n`, "utf8");
'@
    & $node -e $generator $sourceRoot $stagingRoot
    if ($LASTEXITCODE -ne 0) { throw "Nötr store oluşturulamadı." }

    $auditTarget = Join-Path $stagingRoot 'DENETIM'
    New-Item -ItemType Directory -Path $auditTarget -Force | Out-Null
    foreach ($reportName in @(
        'FINAL_ANONIMLESTIRME.md',
        'FINAL_BILDIRIM_SENARYOLARI.csv',
        'FINAL_NAMESPACE_HARITASI.csv',
        'FINAL_TEMIZ_PAKET_KONTROLU.md'
    )) {
        $reportSource = Join-Path $sourceRoot (Join-Path 'DENETIM' $reportName)
        if (Test-Path -LiteralPath $reportSource -PathType Leaf) {
            Copy-Item -LiteralPath $reportSource -Destination (Join-Path $auditTarget $reportName) -Force
        }
    }

    if ($WithoutNodeModules) {
        $modulesPath = Join-Path $stagingRoot 'ORTAK\node_modules'
        Assert-ChildPath -Path $modulesPath -Parent $stagingRoot
        if (Test-Path -LiteralPath $modulesPath) { Remove-Item -LiteralPath $modulesPath -Recurse -Force }
    }

    Push-Location (Join-Path $stagingRoot 'ORTAK')
    try {
        & $node 'WHITE-LABEL-CHECK.js'
        if ($LASTEXITCODE -ne 0) { throw "Temiz paket white-label kontrolü başarısız." }
    }
    finally { Pop-Location }

    $forbidden = Get-ChildItem -LiteralPath $stagingRoot -Recurse -Force | Where-Object {
        $relative = $_.FullName.Substring($stagingRoot.Length).TrimStart('\').Replace('/', '\')
        $relative -match '(?:writer\.lock|^DENETIM\\\.|^LOCAL\\REVISION-TEST-DATA(?:\\|$)|^ORTAK\\VERİ\\STORE\\(?:data-import-cold|backups)(?:\\|$))'
    }
    if ($forbidden) { throw "Temiz pakette runtime veya yedek kalıntısı bulundu." }

    $neutralStore = Get-Content -Raw -LiteralPath (Join-Path $stagedData 'STORE\store.json') | ConvertFrom-Json
    if ($neutralStore.authSessions.Count -or $neutralStore.pushSubscriptions.Count -or $neutralStore.notifications.Count -or
        $neutralStore.securityAudit.Count -or $neutralStore.recipeUsers.Count -or $neutralStore.menuState.categories.Count) {
        throw "Nötr store kişisel veya aktif kullanıcı verisi içeriyor."
    }

    if (Test-Path -LiteralPath $zipPath) {
        $resolvedDesktop = [IO.Path]::GetFullPath($desktopRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        $resolvedZip = [IO.Path]::GetFullPath($zipPath)
        if (-not $resolvedZip.StartsWith($resolvedDesktop, [StringComparison]::OrdinalIgnoreCase) -or
            [IO.Path]::GetFileName($resolvedZip) -ne 'PAKET 3 TEMİZ.zip') {
            throw "ZIP hedefi güvenli değil: $resolvedZip"
        }
        Remove-Item -LiteralPath $zipPath -Force
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stagingRoot, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $true)

    $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $badEntry = $archive.Entries | Where-Object {
            $relative = $_.FullName -replace '^PAKET 3/', ''
            $relative -match '(?:writer\.lock|^DENETIM/\.|^LOCAL/REVISION-TEST-DATA(?:/|$)|^ORTAK/VERİ/STORE/(?:data-import-cold|backups)(?:/|$))'
        } | Select-Object -First 1
        if ($badEntry) { throw "ZIP içinde yasak kalıntı bulundu: $($badEntry.FullName)" }
        if (-not ($archive.Entries | Where-Object { $_.FullName -eq 'PAKET 3/ORTAK/VERİ/STORE/store.json' })) {
            throw "ZIP içinde nötr store bulunamadı."
        }
    }
    finally { $archive.Dispose() }

    Write-Host "Temiz paket oluşturuldu: $zipPath" -ForegroundColor Green
    Write-Host ($(if ($WithoutNodeModules) { 'Sunucu kaynak paketi: node_modules hariç.' } else { 'Portable paket: node_modules dahil.' }))
}
finally {
    if (Test-Path -LiteralPath $stagingBase) {
        Assert-ChildPath -Path $stagingBase -Parent ([IO.Path]::GetTempPath())
        Remove-Item -LiteralPath $stagingBase -Recurse -Force
    }
}
