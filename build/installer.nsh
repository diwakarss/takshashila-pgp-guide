; Replaces electron-builder's default "is the app running?" check, which
; false-positives (dialog: "PGP Guide cannot be closed") even with no
; PGP Guide.exe / node.exe alive — seen repeatedly on the first Windows
; laptop. Instead: force-kill by image name, settle, and proceed.
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /F /IM "PGP Guide.exe" /T'
  Pop $0
  Sleep 1000
!macroend
