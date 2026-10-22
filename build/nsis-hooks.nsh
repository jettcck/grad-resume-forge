; ============================================================
;  NSIS 安装/升级钩子
;
;  要解决的问题：
;    2026-09-11 之前安装后的 exe 叫「简历锻造炉.exe」，后来为支持 Linux
;    统一改成 grad-resume-forge.exe。旧版本建的快捷方式指向已不存在的
;    「简历锻造炉.exe」，用户每次升级后双击它就弹
;    「Windows 正在查找 简历锻造炉.exe」。
;
;  两层处理：
;    1) customInit：删掉已知的旧形态（桌面 + 开始菜单里指向废弃 exe 名的项）
;    2) customInstall：跑 fix-shortcuts.ps1 兜底扫描，清理用户重命名过、
;       或固定到别处的失效快捷方式
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

!macro customInstall
  ; 文件已就位（$INSTDIR\resources 存在），跑兜底扫描。
  ; ExecWait 是 NSIS 核心指令（等子进程结束、把退出码取到 $0），不需要额外 include。
  ; 失败不阻断安装 —— 清理是增强项，装不上才是事故。
  IfFileExists "$INSTDIR\resources\fix-shortcuts.ps1" 0 done
    ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\fix-shortcuts.ps1"' $0
    IntCmp $0 0 0 notzero
    Goto done
  notzero:
    DetailPrint "快捷方式清理脚本返回非 0（$0），已跳过，不影响安装"
  done:
!macroend
