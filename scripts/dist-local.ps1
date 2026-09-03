# ============================================================
#  本地构建一键脚本（绕过国内网络对 electron-builder 的封锁）
#  用法：npm run dist:local
#  前置：npm install 已完成；.local-bin 由本脚本按需准备
#  幂等：重复执行无副作用
# ============================================================
$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $ROOT

function Get-CProcess { param($Name, $ErrorAction) Get-Process -Name $Name -ErrorAction $ErrorAction }

# ---- 1) 准备本地二进制（winCodeSign 消毒包 + nsis）----
$binRoot = Join-Path $ROOT '.local-bin'
$sevenZip = Join-Path $ROOT 'node_modules\7zip-bin\win\x64\7za.exe'
if (-not (Test-Path $sevenZip)) { throw '7za.exe 不存在，先 npm install' }

New-Item -ItemType Directory -Force -Path "$binRoot\nsis-3.0.4.1", "$binRoot\nsis-resources-3.4.1", "$binRoot\winCodeSign-2.6.0" | Out-Null

# nsis 两个小包：从 npmmirror 拉（若已存在则跳过）
foreach ($pkg in @(
  @{ dir = 'nsis-3.0.4.1'; url = 'https://npmmirror.com/mirrors/electron-builder-binaries/nsis-3.0.4.1/nsis-3.0.4.1.7z' },
  @{ dir = 'nsis-resources-3.4.1'; url = 'https://npmmirror.com/mirrors/electron-builder-binaries/nsis-resources-3.4.1/nsis-resources-3.4.1.7z' }
)) {
  $dst = Join-Path $binRoot "$($pkg.dir)\$($pkg.dir).7z"
  if (-not (Test-Path $dst)) {
    Write-Host "下载 $($pkg.dir) ..."
    curl.exe -L --max-time 300 $pkg.url -o $dst --silent --show-error
    if (-not (Test-Path $dst) -or (Get-Item $dst).Length -lt 10KB) { throw "下载失败 $($pkg.dir)" }
  }
}

# winCodeSign 消毒包：优先从 npmmirror 拉原始包，解压时排除 darwin/mas（符号链接目录），再重新压包
$wcsDir = Join-Path $binRoot 'winCodeSign-2.6.0'
$wcs7z = Join-Path $wcsDir 'winCodeSign-2.6.0.7z'
if (-not (Test-Path $wcs7z)) {
  Write-Host '准备 winCodeSign 消毒包（下载 + 解压排除 darwin + 重压）...'
  $tmp = Join-Path $env:TEMP "winCodeSign-orig-$(Get-Random)"
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  curl.exe -L --max-time 300 'https://npmmirror.com/mirrors/electron-builder-binaries/winCodeSign-2.6.0/winCodeSign-2.6.0.7z' -o "$tmp\winCodeSign-2.6.0.7z" --silent --show-error
  if (-not (Test-Path "$tmp\winCodeSign-2.6.0.7z") -or (Get-Item "$tmp\winCodeSign-2.6.0.7z").Length -lt 1MB) { throw 'winCodeSign 原始包下载失败' }
  $wcsArgs = @('x', '-bd', "$tmp\winCodeSign-2.6.0.7z", "-o$tmp\extracted", '-x!darwin', '-x!mas')
  & $sevenZip @wcsArgs | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'winCodeSign 解压失败' }
  Push-Location "$tmp\extracted"
  & $sevenZip a -bd $wcs7z * | Out-Null
  Pop-Location
  if (-not (Test-Path $wcs7z)) { throw 'winCodeSign 消毒包打包失败' }
  # 同时留一份解压好的（RCEDIT_LOCAL_EXE / WINCODESIGN_LOCAL_DIR 用）
  Copy-Item "$tmp\extracted" (Join-Path $wcsDir 'extracted') -Recurse -Force
  Remove-Item $tmp -Recurse -Force
}

$wcsExtracted = Join-Path $wcsDir 'extracted'
if (-not (Test-Path $wcsExtracted)) {
  # 消毒包已存在但解压目录缺失（比如被清理过）
  $tmp = Join-Path $env:TEMP "winCodeSign-re-$(Get-Random)"
  & $sevenZip x -bd $wcs7z "-o$tmp" | Out-Null
  Copy-Item $tmp $wcsExtracted -Recurse -Force
  Remove-Item $tmp -Recurse -Force
}

# ---- 2) 打 node_modules 补丁 ----
node scripts\apply-local-patches.js
if ($LASTEXITCODE -ne 0) { throw '补丁失败' }

# ---- 3) 起本地二进制源（已运行则复用）----
$srcRunning = Get-CProcess -Name 'node' -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'local-bin-source' }
if (-not $srcRunning) {
  Start-Process -FilePath 'node' -ArgumentList 'scripts\local-bin-source.js', '.local-bin', '17891' -WorkingDirectory $ROOT -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

# ---- 4) 构建环境变量 + 构建 ----
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'http://127.0.0.1:17891/'
$env:RCEDIT_LOCAL_EXE = Join-Path $wcsExtracted 'rcedit-x64.exe'
$env:WINCODESIGN_LOCAL_DIR = $wcsExtracted

Write-Host "`n开始构建..."
npm run dist
if ($LASTEXITCODE -ne 0) { throw '构建失败' }

Write-Host "`n✅ 本地构建完成，产物在 release\ 目录"
Get-ChildItem (Join-Path $ROOT 'release') -File -Filter '*.exe' | ForEach-Object { Write-Host ("  {0}  {1:N1} MB" -f $_.Name, ($_.Length/1MB)) }
