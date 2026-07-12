[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$ManagerTag = "canary",
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ManagerArgs
)

$ErrorActionPreference = "Stop"
if (-not [Environment]::Is64BitOperatingSystem) {
    throw "NeuroBook Manager v1 Stage 0 只支持 Windows x64。"
}
$bunVersion = "1.3.14"
$localAppData = $env:LOCALAPPDATA
if (-not $localAppData) {
    $localAppData = Join-Path $HOME "AppData\Local"
}
$cacheRoot = Join-Path $localAppData "NeuroBook\manager\runtime\bun\$bunVersion"
$bunExe = Join-Path $cacheRoot "bun-windows-x64\bun.exe"
$assetUrl = "https://github.com/oven-sh/bun/releases/download/bun-v$bunVersion/bun-windows-x64.zip"

if (-not (Test-Path -LiteralPath $bunExe)) {
    $stage = Join-Path ([System.IO.Path]::GetTempPath()) "neuro-book-stage0-$([guid]::NewGuid())"
    New-Item -ItemType Directory -Path $stage | Out-Null
    try {
        $base = "https://github.com/oven-sh/bun/releases/download/bun-v$bunVersion"
        $archive = Join-Path $stage "bun-windows-x64.zip"
        $sums = Join-Path $stage "SHASUMS256.txt"
        Invoke-WebRequest -Uri $assetUrl -OutFile $archive
        Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -OutFile $sums
        $expected = ((Get-Content -LiteralPath $sums) | Where-Object { $_ -match "\s+bun-windows-x64.zip$" } | Select-Object -First 1).Split(" ")[0]
        $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if (-not $expected -or $actual -ne $expected.ToLowerInvariant()) {
            throw "Bun SHA256 校验失败。"
        }
        New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
        Expand-Archive -LiteralPath $archive -DestinationPath $cacheRoot -Force
    } finally {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$env:NEURO_BOOK_STAGE0_BUN_PATH = $bunExe
$env:NEURO_BOOK_STAGE0_BUN_VERSION = $bunVersion
$env:NEURO_BOOK_STAGE0_BUN_SOURCE_URL = $assetUrl
$env:NEURO_BOOK_STAGE0_BUN_SHA256 = (Get-FileHash -LiteralPath $bunExe -Algorithm SHA256).Hash.ToLowerInvariant()
& $bunExe x --bun "@notnotype/neuro-book-manager@$ManagerTag" install @ManagerArgs
exit $LASTEXITCODE
