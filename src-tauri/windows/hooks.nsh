!macro NEUROBOOK_STOP_RUNNING_APP
  DetailPrint "Stopping running NeuroBook processes..."
  nsExec::ExecToLog 'taskkill /T /F /IM neuro-book-tauri.exe'

  DetailPrint "Stopping bundled Bun runtime from install directory..."
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$target = [System.IO.Path]::GetFullPath(\"$INSTDIR\runtime\bun\bun.exe\"); Get-CimInstance Win32_Process -Filter \"Name = ''bun.exe''\" | Where-Object { $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $target) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"'
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro NEUROBOOK_STOP_RUNNING_APP
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro NEUROBOOK_STOP_RUNNING_APP
!macroend
