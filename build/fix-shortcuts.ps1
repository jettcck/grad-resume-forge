# 修复失效的应用快捷方式
#
# 背景：2026-09-11 之前，安装后的 exe 叫「简历锻造炉.exe」；后来为了支持 Linux
# 统一改成 grad-resume-forge.exe。旧版本创建的快捷方式指向已不存在的
# 「简历锻造炉.exe」，用户双击后会看到
# 「Windows 正在查找 简历锻造炉.exe。如果想亲自查找文件，请单击"浏览"」。
#
# 本脚本是手动兜底工具。安装器内置的自动修复只使用 NSIS 原生指令，
# 避免在静默升级中启动 PowerShell 导致安装器崩溃。
#
# 它会删除桌面/开始菜单/任务栏里指向本应用且已经不存在的快捷方式，
# 然后重写桌面和开始菜单的标准快捷方式，确保目标落到当前安装目录。
#
# 用法（从已安装目录的 resources 中执行）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File fix-shortcuts.ps1

$ErrorActionPreference = 'SilentlyContinue'

$shell = New-Object -ComObject WScript.Shell

# 只扫「用户自己会点的位置」：桌面、开始菜单、任务栏固定。
# 不碰 $PUBLIC（所有用户）与开始菜单的厂商子目录，减少误伤面。
$locations = @(
    (Join-Path $env:USERPROFILE 'Desktop'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
    (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
)

$removed = 0
$kept = 0

# 在已安装目录执行时，脚本位于 resources/，当前 exe 在上一级目录。
# 从源码目录手工执行时若找不到 exe，则只做失效项清理。
$appExe = Join-Path (Split-Path -Parent $PSScriptRoot) '简历锻造炉.exe'
$appExeExists = Test-Path -LiteralPath $appExe

foreach ($dir in $locations) {
    if (-not (Test-Path $dir)) { continue }

    Get-ChildItem -Path $dir -Filter *.lnk -Recurse | ForEach-Object {
        $link = $_
        try {
            $target = $shell.CreateShortcut($link.FullName).TargetPath
        } catch {
            return
        }

        if ([string]::IsNullOrWhiteSpace($target)) { return }

        # 是不是本应用的快捷方式
        $isOurs = ($target -match '简历锻造炉') -or ($target -match 'grad-resume-forge')
        if (-not $isOurs) { return }

        if (Test-Path $target) {
            # 目标还在，说明是有效的，保留
            $kept++
            return
        }

        # 目标不存在：失效的旧快捷方式，删掉
        try {
            Remove-Item -LiteralPath $link.FullName -Force
            Write-Output ("已删除失效快捷方式: {0} -> {1}" -f $link.Name, $target)
            $removed++
        } catch {
            Write-Output ("删除失败: {0} ({1})" -f $link.FullName, $_.Exception.Message)
        }
    }
}

# 开始菜单里如果因为删除而空了目录，顺手清掉（RMDir 语义：空才删）
$smDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\简历锻造炉'
if ((Test-Path $smDir) -and (-not (Get-ChildItem $smDir -Recurse -Force))) {
    Remove-Item $smDir -Force
    Write-Output '已清理空的开始菜单目录'
}

# 如果脚本从安装目录执行，修复标准入口的 TargetPath。
if ($appExeExists) {
    foreach ($linkPath in @(
        (Join-Path $env:USERPROFILE 'Desktop\简历锻造炉.lnk'),
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\简历锻造炉.lnk')
    )) {
        try {
            $link = $shell.CreateShortcut($linkPath)
            $link.TargetPath = $appExe
            $link.WorkingDirectory = Split-Path -Parent $appExe
            $link.IconLocation = "$appExe,0"
            $link.Save()
            Write-Output ("已重写快捷方式: {0} -> {1}" -f $linkPath, $appExe)
        } catch {
            Write-Output ("重写失败: {0} ({1})" -f $linkPath, $_.Exception.Message)
        }
    }
}

Write-Output ("快捷方式修复完成：删除 {0} 个失效项，保留 {1} 个有效项" -f $removed, $kept)
exit 0
