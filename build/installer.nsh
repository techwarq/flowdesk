; FlowDesk NSIS Installer Customization
; This script is included by electron-builder during Windows build

!macro customHeader
  ; Custom header actions
!macroend

!macro preInit
  ; Pre-initialization actions
!macroend

; ============================================
; AUTO-CLOSE RUNNING INSTANCES & CLEANUP
; Fixes "Failed to uninstall old application files" error
; by aggressively killing all related processes and
; retrying file removal with delays.
; ============================================
!macro customInit
  ; 1. Kill the main FlowDesk Electron process
  nsExec::ExecToLog 'taskkill /F /IM "FlowDesk.exe" /T'
  
  ; 2. Kill any orphaned Node.js backend processes spawned by FlowDesk
  ;    These can lock files in the install directory
  nsExec::ExecToLog 'cmd /c "wmic process where (CommandLine like ''%backend%dist%server.cjs%'' and Name=''FlowDesk.exe'') call terminate"'
  nsExec::ExecToLog 'taskkill /F /IM "node.exe" /FI "WINDOWTITLE eq FlowDesk*"'
  
  ; 3. Kill any Playwright/Chromium browser instances that FlowDesk may have spawned
  nsExec::ExecToLog 'cmd /c "wmic process where (CommandLine like ''%FlowDesk%browsers%'' and Name=''chromium.exe'') call terminate"'
  nsExec::ExecToLog 'cmd /c "wmic process where (CommandLine like ''%FlowDesk%browsers%'' and Name=''chrome.exe'') call terminate"'
  nsExec::ExecToLog 'cmd /c "wmic process where (CommandLine like ''%FlowDesk%browsers%'' and Name=''firefox.exe'') call terminate"'
  nsExec::ExecToLog 'cmd /c "wmic process where (CommandLine like ''%FlowDesk%browsers%'' and Name=''msedge.exe'') call terminate"'
  
  ; 4. Wait for processes to fully terminate and release file locks
  Sleep 3000
  
  ; 5. If old install directory exists, try to forcefully remove it
  ;    This handles the case where the built-in uninstaller fails
  IfFileExists "$INSTDIR\FlowDesk.exe" 0 +4
    ; Try removing with rmdir /s /q (Windows force delete)
    nsExec::ExecToLog 'cmd /c "rmdir /s /q "$INSTDIR\resources""'
    nsExec::ExecToLog 'cmd /c "del /f /q "$INSTDIR\*.exe" "$INSTDIR\*.dll" "$INSTDIR\*.pak" "$INSTDIR\*.bin" "$INSTDIR\*.dat""'
    Sleep 1000

  ; 6. One more attempt to kill anything that may have restarted
  nsExec::ExecToLog 'taskkill /F /IM "FlowDesk.exe" /T'
  Sleep 1000
!macroend

!macro customInstall
  ; Actions to perform after file installation
  
  ; Create a file to indicate successful installation
  FileOpen $0 "$INSTDIR\.installed" w
  FileWrite $0 "FlowDesk installed successfully"
  FileClose $0
  
  ; Ensure proper permissions for user data directories
  CreateDirectory "$LOCALAPPDATA\FlowDesk"
  CreateDirectory "$LOCALAPPDATA\FlowDesk\Data"
!macroend

!macro customUnInstall
  ; Kill running instance first before uninstall  
  nsExec::ExecToLog 'taskkill /F /IM "FlowDesk.exe" /T'
  
  ; Also kill child Node.js and browser processes
  nsExec::ExecToLog 'cmd /c "wmic process where (CommandLine like ''%FlowDesk%'' and Name=''node.exe'') call terminate"'
  nsExec::ExecToLog 'cmd /c "wmic process where (CommandLine like ''%FlowDesk%browsers%'' and Name=''chromium.exe'') call terminate"'
  nsExec::ExecToLog 'cmd /c "wmic process where (CommandLine like ''%FlowDesk%browsers%'' and Name=''chrome.exe'') call terminate"'
  
  ; Wait for all processes to release file handles
  Sleep 3000
  
  ; Force-remove the resources directory (largest and most likely to have locked files)
  nsExec::ExecToLog 'cmd /c "rmdir /s /q "$INSTDIR\resources""'
  Sleep 500
  
  ; Remove installed marker
  Delete "$INSTDIR\.installed"
!macroend

!macro customInstallMode
  ; Use per-user installation (no admin required)
!macroend
