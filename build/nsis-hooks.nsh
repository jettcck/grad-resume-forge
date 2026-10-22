; ============================================================
;  NSIS 安装/升级钩子
;
;  要解决的问题：
;    2026-09-11 之前安装后的 exe 叫「简历锻造炉.exe」，后来为支持 Linux
;    统一改成 grad-resume-forge.exe。旧版本建的快捷方式指向已不存在的
;    「简历锻造炉.exe」，用户每次升级后双击它就弹
;    「Windows 正在查找 简历锻造炉.exe」。
;
;  处理：安装/升级前删掉已知的旧形态（桌面 + 开始菜单里指向废弃 exe 名的项）。
;
;  为什么不再调 PowerShell 兜底扫描（2026-10-22 的教训）：
;    原本 customInstall 里用 ExecWait 调 fix-shortcuts.ps1 扫桌面/开始菜单/任务栏，
;    但在 CI 的 NSIS 安装器冒烟里稳定复现 0xC0000005（访问冲突）崩溃 ——
;    静默安装（/S）路径上同步拉起 PowerShell 会与安装器状态冲突。
;    稳定性优先：清理是增强项，装不上才是事故。
;    现在 fix-shortcuts.ps1 仍随应用打包（resources/fix-shortcuts.ps1），
;    作为用户可手动执行的修复工具；自动清理只保留纯 NSIS 指令这一段。
;
;  注意：只用 NSIS 核心指令，不依赖 LogicLib / nsExec 等额外 include ——
;  electron-builder 的模板不保证 include 了它们，用了会在编译期直接报错。
; ============================================================

!macro customInit
  ; 旧版本（exe 名为中文）创建的快捷方式，新版 exe 改名后必然失效。
  ; electron-builder 只按 shortcutName 覆盖它自己管理的那几个，
  ; 用户重命名过的、放在非标准位置的不会被覆盖 —— 这里显式删。
  Delete "$DESKTOP\简历锻造炉.lnk"
  Delete "$SMPROGRAMS\简历锻造炉\简历锻造炉.lnk"
  Delete "$SMPROGRAMS\简历锻造炉\卸载 简历锻造炉.lnk"
  ; 空目录才删（RMDir 不带 /r），不会碰用户放进来的其他快捷方式
  RMDir "$SMPROGRAMS\简历锻造炉"
!macroend
