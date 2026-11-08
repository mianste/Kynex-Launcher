; beta 版与正式版共用 productName（Kynex Launcher），安装目录和卸载注册表键因此一致，
; 两个通道可以互相覆盖升级。这里只把“应用和功能”里的显示名改回 beta 名称。
;
; 注意：Tauri 的 NSIS 模板固定按 productName 计算安装目录，不会沿用用户自定义的 /D 路径；
; 如需保留自定义目录，只能替换成自定义 NSIS 模板。
!macro NSIS_HOOK_PREINSTALL
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kynex Launcher" "DisplayName" "Kynex Launcher Beta"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
