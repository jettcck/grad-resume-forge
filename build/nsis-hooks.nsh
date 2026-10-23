; ============================================================
;  NSIS 安装/升级钩子
;
;  要解决的问题：
;    2026-09-11 之前安装后的 exe 叫「简历锻造炉.exe」，后来为支持 Linux
;    统一改成 grad-resume-forge.exe。旧版本建的快捷方式指向已不存在的
;    「简历锻造炉.exe」，用户每次升级后双击它就弹
;    「Windows 正在查找 简历锻造炉.exe」。
;
;  2026-10-23 复核后的完整病因链（三条，缺一都会复发）：
;
;    [1] 旧快捷方式指向已删除的绿色版目录
;        实证：抓到
;          C:\trae\resume-app\release\stage-v1.2.12\grad-resume-forge\简历锻造炉.exe
;        那是 v1.2.12 绿色版残留，目录早已不存在。
;
;    [2] electron-builder 的 KeepShortcuts 在升级时不重建 .lnk
;        见 node_modules/app-builder-lib/templates/nsis/include/installer.nsh:169/196
;        升级时若 KeepShortcuts=true 且 $appExe 存在，只做「旧名→新名」Rename，
;        TargetPath 原样保留 → 坏目标被一版一版继承下去。
;
;    [3] 完成页 $launchLink 的取值来源（这是「一更新就弹」的直接触发点）
;        见 installSection.nsh:71-74，模板在 customInstall 之前这样赋值：
;            ${if} ${FileExists} "$newStartMenuLink"
;              StrCpy $launchLink "$newStartMenuLink"   ; ← 指向 .lnk
;            ${else}
;              StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
;            ${endIf}
;        而 electron-updater 非静默安装时 autoRunAppAfterInstall=true
;        （BaseUpdater.js:13-16 → doInstall 不带 /S），完成页"运行"默认勾选，
;        走 StartApp → StdUtils.ExecShellAsUser "$launchLink" open。
;        一旦那个 .lnk 是坏的，ShellExecute 就弹「Windows 正在查找 xxx.exe」。
;        所以 $launchLink 必须无条件指向 $INSTDIR 下的真实 exe，不能是 .lnk。
;
;    2026-10-23 追加核实（推翻了曾以为是主因的"桌面独立副本"假设）：
;      实测用户桌面既无快捷方式也无 grad-resume-forge 目录，
;      且用缓存安装包做 /S 静默升级验证过：customInstall 能正确重建两个 .lnk
;      （TargetPath 指向当前 exe，Test-Path 为 True）。故 [1][2] 两条在
;      当前版本已不复发；残留的坏引用只在开始菜单磁贴缓存
;      (Start\TileProperties / CloudStore appleveltilelist) 与 MuiCache 里。
;
;  处理策略（两段钩子，全部用 NSIS 核心指令）：
;    customInit   ：删旧形态快捷方式 + 清掉桌面上的独立旧副本 + 修正坏 InstallLocation
;    customInstall：无条件重写快捷方式 + 把 $launchLink 指向本次安装的 exe
;
;  为什么钩子里不做复杂分支：
;    2026-10-22 的教训是「ExecWait powershell 在 /S 静默安装路径上崩 0xC0000005」，
;    所以这里只用 NSIS 原生指令；并且刻意用「跳转标签」而不是 IfFileExists 的
;    相对偏移量（+N 数错一个就是逻辑静默失效，比编译报错更难发现）。
;
;  注意：只用 NSIS 核心指令，不依赖 LogicLib / nsExec 等额外 include ——
;  electron-builder 的模板不保证 include 了它们，用了会在编译期直接报错。
; ============================================================

!macro customInit
  ; ---------- [1] 旧版本（exe 名为中文）创建的快捷方式 ----------
  ; electron-builder 只按 shortcutName 覆盖它自己管理的那几个，
  ; 用户重命名过的、放在非标准位置的不会被覆盖 —— 这里显式删。
  Delete "$DESKTOP\简历锻造炉.lnk"
  Delete "$SMPROGRAMS\简历锻造炉.lnk"
  Delete "$SMPROGRAMS\简历锻造炉\简历锻造炉.lnk"
  Delete "$SMPROGRAMS\简历锻造炉\卸载 简历锻造炉.lnk"
  ; 空目录才删（RMDir 不带 /r），不会碰用户放进来的其他快捷方式
  RMDir "$SMPROGRAMS\简历锻造炉"

  ; ---------- [3] 桌面上的独立旧副本 ----------
  ; 判据：桌面 grad-resume-forge 目录同时具备
  ;   ① resources\app-update.yml（完整应用标志，用户资料目录不会有）
  ;   ② 本应用的 exe
  ; 只有这种目录才会自己触发自动更新、并与正式安装抢同一个 updaterCacheDirName。
  ; 范围：路径写死为 Desktop\grad-resume-forge，不做任意通配。
  ;
  ; 标签用 ${__LINE__} 拼唯一后缀：NSIS 的 label 是全局的，
  ; 宏被 !insertmacro 两次（installer.nsi 里 customInit 只插一次，但
  ; 未来若被复用或嵌套插入）就会报 "label already declared"。
  !define /redef STALE_COPY_DONE stale_copy_done_${__LINE__}
  IfFileExists "$DESKTOP\grad-resume-forge\resources\app-update.yml" 0 ${STALE_COPY_DONE}
  IfFileExists "$DESKTOP\grad-resume-forge\简历锻造炉.exe" 0 ${STALE_COPY_DONE}
  RMDir /r "$DESKTOP\grad-resume-forge"
  ${STALE_COPY_DONE}:

  ; ---------- 修正被写坏的 InstallLocation ----------
  ; 历史事故：某些安装把 InstallLocation 写成不含分隔符的畸形串
  ; （如 C:traeresume-appreleasestage-v1212\grad-resume-forge），
  ; 之后每一版都读它当安装目录 → 文件装不进有效路径、快捷方式继承坏目标。
  ; 校验：注册表里的目录必须真实存在，否则清掉坏值。
  ; customInit 在 initMultiUser 之后执行，$INSTDIR 此时已按注册表算好；
  ; 若它本身也是无效路径（不存在且不是待新建的位置），拉回默认安装目录。
  !define /redef LOC_CHECKED loc_checked_${__LINE__}
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $0 "" ${LOC_CHECKED}
  IfFileExists "$0\*.*" ${LOC_CHECKED}
  DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${LOC_CHECKED}:

  ; 若 $INSTDIR 明显是畸形路径（盘符后直接接字符、没有分隔符），拉回默认目录。
  ; 判据：第 3 个字符（offset 2）必须是 "\"。正常路径形如 "C:\Users\..."。
  ; 注意两点：
  ;   ① StrCpy 的目标只能是用户变量（$0/$R0...），$1~$9 是寄存器，不能当目标；
  ;   ② start_offset 从 0 起算，"C:\..." 的 offset 2 才是反斜杠。
  !define /redef INST_DIR_OK inst_dir_ok_${__LINE__}
  StrCpy $R0 $INSTDIR 1 2
  StrCmp $R0 "\" ${INST_DIR_OK}
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${APP_FILENAME}"
  ${INST_DIR_OK}:
!macroend

!macro customInstall
  ; electron-builder 的 KeepShortcuts 机制会在升级时保留同名旧 .lnk，
  ; 即使它的 TargetPath 已指向不存在的旧目录，也不会重新创建。
  ; 安装完成后无条件重写标准桌面/开始菜单快捷方式，确保目标是本次安装的 exe。
  ;
  ; 注意 SHORTCUT_NAME 用了中文常量而不是字面量：productName 改过一次，
  ; 字面量会让"改了名但没改这里"变成静默不一致。这里仍按当前 productName
  ; 生成，并额外用 ${SHORTCUT_NAME} 兜住 electron-builder 的实际配置。
  CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 "" "" "${APP_DESCRIPTION}"
  CreateShortCut "$SMPROGRAMS\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 "" "" "${APP_DESCRIPTION}"

  ; ---------- 完成页启动目标：只认真实 exe，绝不指向 .lnk ----------
  ; 模板在 installSection.nsh:71-74 先给 $launchLink 赋 $newStartMenuLink（一个 .lnk），
  ; 完成页 StartApp 走 StdUtils.ExecShellAsUser "$launchLink" open。
  ; electron-updater 非静默安装（autoRunAppAfterInstall=true）时完成页默认勾选"运行"，
  ; 只要那个 .lnk 指向失效目标，ShellExecute 必弹「Windows 正在查找 xxx.exe」。
  ; 所以这里覆盖成 $INSTDIR 下的真实 exe；若 exe 尚未落地（极端时序），
  ; 退回 $appExe（模板开头已按同一规则算好）。
  StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  !define /redef LAUNCH_READY launch_ready_${__LINE__}
  IfFileExists "$launchLink" ${LAUNCH_READY} 0
  StrCpy $launchLink "$appExe"
  ${LAUNCH_READY}:
!macroend