# One-click local deploy: build app.asar from current source, drop it into the
# fixed install dir, then re-create the desktop shortcut.
# The install dir never changes, so the shortcut path stays valid across updates.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy-installed.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy-installed.ps1 -SkipBuild
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\grad-resume-forge'

# --- 1. read target version -------------------------------------------------
# node reads package.json as UTF-8; PowerShell 5.1's ConvertFrom-Json would
# mangle the Chinese description and fail.
Push-Location $repo
try {
  $version = (& node -p "require('./package.json').version").Trim()
} finally {
  Pop-Location
}
if (-not $version) { Write-Output 'VERSION_UNREADABLE'; exit 2 }
Write-Output ("VERSION=" + $version)

# --- 2. ensure runtime exists in install dir --------------------------------
if (-not (Test-Path -LiteralPath $installDir)) {
  New-Item -ItemType Directory -Path $installDir | Out-Null
}
$exe = Get-ChildItem -LiteralPath $installDir -Filter *.exe -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Length -gt 50MB } | Select-Object -First 1

if (-not $exe) {
  $seed = Join-Path $repo 'release\win-unpacked'
  if (-not (Test-Path -LiteralPath $seed)) {
    Write-Output "NO_RUNTIME_SOURCE: $seed"
    exit 3
  }
  Write-Output 'SEEDING_RUNTIME...'
  Copy-Item -Path (Join-Path $seed '*') -Destination $installDir -Recurse -Force
  $exe = Get-ChildItem -LiteralPath $installDir -Filter *.exe -File |
    Where-Object { $_.Length -gt 50MB } | Select-Object -First 1
}

# --- 3. build dist + asar ---------------------------------------------------
$asarOut = Join-Path $repo ("release\app-" + $version + ".asar")
if (-not $SkipBuild) {
  Push-Location $repo
  try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "build failed ($LASTEXITCODE)" }
    $ref = Join-Path $installDir 'resources\app.asar'
    & node (Join-Path $repo 'scripts\build-asar.js') $asarOut $ref
    if ($LASTEXITCODE -ne 0) { throw "build-asar failed ($LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
}
if (-not (Test-Path -LiteralPath $asarOut)) { Write-Output "ASAR_MISSING: $asarOut"; exit 4 }

# --- 4. back up old asar, then swap ----------------------------------------
$liveAsar = Join-Path $installDir 'resources\app.asar'
if (Test-Path -LiteralPath $liveAsar) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Copy-Item -LiteralPath $liveAsar -Destination ($liveAsar + '.bak-' + $stamp) -Force
  Write-Output ("BACKUP=" + $liveAsar + ".bak-" + $stamp)
}
Copy-Item -LiteralPath $asarOut -Destination $liveAsar -Force
Write-Output ("DEPLOYED=" + $liveAsar)

# --- 5. re-create shortcut (idempotent) ------------------------------------
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\fix-desktop-shortcut.ps1')
if ($LASTEXITCODE -ne 0) { Write-Output 'SHORTCUT_FAILED'; exit 5 }

Write-Output ("DONE version=" + $version)
