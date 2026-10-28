Unicode True
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!ifndef PROJECT_ROOT
  !define PROJECT_ROOT ".."
!endif
!cd "${PROJECT_ROOT}"
Name "Kynex Launcher"
OutFile "${PROJECT_ROOT}\Windows\Setup\.Kynex-Launcher.build.exe"
InstallDir "$LOCALAPPDATA\Programs\Kynex Launcher"
RequestExecutionLevel user
CRCCheck force
SetCompressor zlib
Icon "${PROJECT_ROOT}\src-tauri\icons\icon.ico"
UninstallIcon "${PROJECT_ROOT}\src-tauri\icons\icon.ico"
!define MUI_ABORTWARNING
!define MUI_ICON "${PROJECT_ROOT}\src-tauri\icons\icon.ico"
!define MUI_UNICON "${PROJECT_ROOT}\src-tauri\icons\icon.ico"

; 检测旧版本安装目录：兼容 KXL 与 Kynex Launcher 两种卸载注册表键。
!macro TryInstalledKey KEY
  SetRegView 32
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}" "InstallLocation"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}" "UninstallString"
  ${EndIf}
  ${If} $0 == ""
    SetRegView 64
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}" "InstallLocation"
    ${If} $0 == ""
      ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}" "UninstallString"
    ${EndIf}
  ${EndIf}
  SetRegView 32
  ${If} $0 != ""
    StrCpy $1 $0 1
    ${If} $1 == '"'
      StrCpy $0 $0 "" 1
    ${EndIf}
    StrCpy $1 $0 1 -1
    ${If} $1 == '"'
      StrCpy $0 $0 -1
    ${EndIf}
    ${GetFileName} "$0" $1
    ${If} $1 == "Uninstall.exe"
    ${OrIf} $1 == "uninstall.exe"
      ${GetParent} "$0" $0
    ${EndIf}
    ${If} ${FileExists} "$0\Kynex Launcher.exe"
      StrCpy $INSTDIR "$0"
      StrCpy $3 "1"
    ${EndIf}
  ${EndIf}
!macroend

Function .onInit
  StrCpy $3 "0"
  !insertmacro TryInstalledKey "Kynex Launcher"
  ${If} $3 == "0"
    !insertmacro TryInstalledKey "KXL"
  ${EndIf}
FunctionEnd

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Kynex Launcher.exe"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"
Section "Kynex Launcher" SEC01
SetOutPath "$INSTDIR"
File "${PROJECT_ROOT}\Windows\Kynex Launcher.exe"
File "${PROJECT_ROOT}\Windows\WebView2Loader.dll"
File "${PROJECT_ROOT}\Windows\README.txt"
File "${PROJECT_ROOT}\Windows\THIRD-PARTY-NOTICES.txt"
WriteUninstaller "$INSTDIR\uninstall.exe"
CreateDirectory "$SMPROGRAMS\Kynex Launcher"
CreateShortcut "$SMPROGRAMS\Kynex Launcher\Kynex Launcher.lnk" "$INSTDIR\Kynex Launcher.exe"
CreateShortcut "$DESKTOP\Kynex Launcher.lnk" "$INSTDIR\Kynex Launcher.exe"
WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kynex Launcher" "DisplayName" "Kynex Launcher"
WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kynex Launcher" "DisplayVersion" "1.0.0"
WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kynex Launcher" "Publisher" "珂珂"
WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kynex Launcher" "DisplayIcon" "$INSTDIR\Kynex Launcher.exe"
WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kynex Launcher" "InstallLocation" "$INSTDIR"
WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kynex Launcher" "UninstallString" '"$INSTDIR\uninstall.exe"'
WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kynex Launcher" "NoModify" 1
WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kynex Launcher" "NoRepair" 1
SectionEnd
Section "Uninstall"
Delete "$INSTDIR\Kynex Launcher.exe"
Delete "$INSTDIR\WebView2Loader.dll"
Delete "$INSTDIR\README.txt"
Delete "$INSTDIR\THIRD-PARTY-NOTICES.txt"
Delete "$INSTDIR\uninstall.exe"
Delete "$DESKTOP\Kynex Launcher.lnk"
Delete "$SMPROGRAMS\Kynex Launcher\Kynex Launcher.lnk"
RMDir "$SMPROGRAMS\Kynex Launcher"
RMDir "$INSTDIR"
DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KXL"
DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kynex Launcher"
SectionEnd
