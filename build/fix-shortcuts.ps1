# 修复失效的应用快捷方式
#
# 背景：2026-09-11 之前，安装后的 exe 叫「简历锻造炉.exe」；后来为了支持 Linux
# 统一改成 grad-resume-forge.exe。旧版本创建的快捷方式指向已不存在的
# 「简历锻造炉.exe」，用户双击后会看到
# 「Windows 正在查找 简历锻造炉.exe。如果想亲自查找文件，请单击"浏览"」。
#
# 本脚本由 NSIS 安装钩子在每次安装/升级时调用，负责把这类失效快捷方式清掉。
#
# 删除条件（两个都要满足，避免误伤）：
#   1) 快捷方式的目标路径含「简历锻造炉」或「grad-resume-forge」（是本应用的）
#   2) 该目标当前不存在（也就是已经打不开的失效项）
#
# 用法（手工执行也可）：
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

Write-Output ("快捷方式修复完成：删除 {0} 个失效项，保留 {1} 个有效项" -f $removed, $kept)
exit 0
