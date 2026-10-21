# Rebuild desktop shortcut for GradResume Forge.
# No non-ASCII literals in this file: the exe name and shortcut name are
# derived from the filesystem, so PowerShell 5.1's ANSI script decoding
# can never corrupt them.
param(
  [string]$InstallDir = "$env:LOCALAPPDATA\Programs\grad-resume-forge"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $InstallDir)) {
  Write-Output ("INSTALL_DIR_MISSING=" + $InstallDir)
  exit 2
}

$exe = Get-ChildItem -LiteralPath $InstallDir -Filter *.exe -File |
  Where-Object { $_.Length -gt 50MB } |
  Sort-Object Length -Descending |
  Select-Object -First 1

if (-not $exe) {
  Write-Output "EXE_NOT_FOUND"
  exit 3
}

$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop ($exe.BaseName + '.lnk')

# remove any stale shortcut with the same display name
if (Test-Path -LiteralPath $lnkPath) {
  Remove-Item -LiteralPath $lnkPath -Force
  Write-Output "OLD_LNK_DELETED"
}

$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnkPath)
$sc.TargetPath = $exe.FullName
$sc.WorkingDirectory = $exe.DirectoryName
$sc.IconLocation = $exe.FullName + ',0'
$sc.Description = 'GradResume Forge'
$sc.WindowStyle = 1
$sc.Save()

$check = $ws.CreateShortcut($lnkPath)
Write-Output ("LNK=" + $lnkPath)
Write-Output ("TARGET=" + $check.TargetPath)
Write-Output ("MATCH=" + ($check.TargetPath -eq $exe.FullName))
Write-Output ("EXISTS=" + (Test-Path -LiteralPath $check.TargetPath))
