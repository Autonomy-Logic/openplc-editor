; OpenPLC Editor Windows installer (DOPE-486), included by electron-builder
; from the build resources folder. It turns the one-click installer, which
; installed and launched with no window at all, into an ordinary one: a
; welcome page, the licence, the progress and a finish page.

; Welcome page before the licence.
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

; Per user, as the one-click installer always installed, so an update lands
; on the existing installation instead of next to it. Skips the
; "for me / for everyone" page.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; electron-builder's own check offers to close a running editor by killing
; it, which would lose unsaved work. Ask the user to close it instead, and
; never close it from here.
!macro customCheckAppRunning
  oplc_check_app_running:
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${PRODUCT_NAME} is open.$\r$\n$\r$\nSave your work and close it, then click Retry to continue the installation." /SD IDCANCEL IDRETRY oplc_check_app_running
      Quit
    ${endIf}
!macroend
