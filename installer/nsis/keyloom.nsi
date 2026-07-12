!include "LogicLib.nsh"

!macro KEYLOOM_RESTORE_PREVIOUS_RUNTIME
  RMDir /r "$INSTDIR\runtime"
  ${If} ${FileExists} "$INSTDIR\runtime.previous\python.exe"
    Rename "$INSTDIR\runtime.previous" "$INSTDIR\runtime"
  ${EndIf}
  Delete "$LOCALAPPDATA\Keyloom\install-state.json"
  ${If} ${FileExists} "$LOCALAPPDATA\Keyloom\install-state.json.previous"
    Rename "$LOCALAPPDATA\Keyloom\install-state.json.previous" "$LOCALAPPDATA\Keyloom\install-state.json"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  FindWindow $0 "" "Keyloom"
  ${If} $0 != 0
    Abort "请先关闭 Keyloom 后再升级。"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\runtime\python.exe"
    RMDir /r "$INSTDIR\runtime.previous"
    ClearErrors
    Rename "$INSTDIR\runtime" "$INSTDIR\runtime.previous"
    ${If} ${Errors}
      Abort "无法备份现有 Keyloom 私有运行时。"
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$LOCALAPPDATA\Keyloom\install-state.json"
    Delete "$LOCALAPPDATA\Keyloom\install-state.json.previous"
    ClearErrors
    Rename "$LOCALAPPDATA\Keyloom\install-state.json" "$LOCALAPPDATA\Keyloom\install-state.json.previous"
    ${If} ${Errors}
      ${If} ${FileExists} "$INSTDIR\runtime.previous\python.exe"
        Rename "$INSTDIR\runtime.previous" "$INSTDIR\runtime"
      ${EndIf}
      Abort "无法备份现有 Keyloom 安装状态。"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${IfNot} ${FileExists} "$INSTDIR\runtime\python.exe"
    !insertmacro KEYLOOM_RESTORE_PREVIOUS_RUNTIME
    Abort "Keyloom private runtime is missing python.exe."
  ${EndIf}
  ${IfNot} ${FileExists} "$INSTDIR\runtime\pythonw.exe"
    !insertmacro KEYLOOM_RESTORE_PREVIOUS_RUNTIME
    Abort "Keyloom private runtime is missing pythonw.exe."
  ${EndIf}
  ${IfNot} ${FileExists} "$INSTDIR\runtime\Lib\site-packages\auto_model_key_router\__init__.py"
    !insertmacro KEYLOOM_RESTORE_PREVIOUS_RUNTIME
    Abort "Keyloom private runtime is missing AMKR."
  ${EndIf}
  ${IfNot} ${FileExists} "$INSTDIR\runtime\install-state.json"
    !insertmacro KEYLOOM_RESTORE_PREVIOUS_RUNTIME
    Abort "Keyloom private runtime install state is missing."
  ${EndIf}

  CreateDirectory "$LOCALAPPDATA\Keyloom"
  ClearErrors
  CopyFiles /SILENT "$INSTDIR\runtime\install-state.json" "$LOCALAPPDATA\Keyloom\install-state.json"
  ${If} ${Errors}
    !insertmacro KEYLOOM_RESTORE_PREVIOUS_RUNTIME
    Abort "Keyloom could not persist the private runtime install state."
  ${EndIf}
  Delete "$INSTDIR\runtime\install-state.json"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$LOCALAPPDATA\Keyloom\install-state.json"
  Delete "$LOCALAPPDATA\Keyloom\install-state.json.previous"
  RMDir "$LOCALAPPDATA\Keyloom"
!macroend
