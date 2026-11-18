; Instalador do Windows (electron-builder, NSIS): o que muda em relação ao padrão.
; O electron-builder inclui este arquivo sozinho (ele fica na pasta build).
;
; Instalar por cima e desinstalar: o padrão fecha à força tudo o que roda da pasta do
; Diretor. Aqui:
; - o servidor que o Claude Desktop abriu (Diretor.exe rodando server.cjs) é fechado sem
;   perguntar, porque não guarda nada. O Claude só o abre de novo quando reinicia, então o
;   instalador avisa para fechar e abrir o Claude depois.
; - o editor nunca é fechado à força com a pessoa olhando: pode ter um projeto sem salvar.
;   O instalador pede para salvar e fechar. Só no modo silencioso (/S) ele é fechado.
;
; Desinstalar (não ao atualizar): tira o Diretor da configuração do Claude Desktop.

; Processos que rodam da pasta do Diretor ($l), menos o próprio instalador (o pai deste
; PowerShell). A pasta vem por variável de ambiente, para aspas no caminho não quebrarem nada.
!define DIRETOR_PS_LIST "$$a=Get-CimInstance Win32_Process;$$p=($$a|?{$$_.ProcessId -eq $$PID}).ParentProcessId;$$d=$$env:DIRETOR_INSTDIR.TrimEnd('\')+'\';$$l=@($$a|?{$$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$d,'OrdinalIgnoreCase') -and $$_.ProcessId -ne $$p})"
; Fecha o servidor do Claude. Sai com 10 se havia algum.
!define DIRETOR_PS_KILL_SERVER "$$s=@($$l|?{$$_.CommandLine -match 'server\.cjs'});$$s|%{Stop-Process -Id $$_.ProcessId -Force -EA 0};if($$s.Count){exit 10}"
; Sai com 10 se o editor (qualquer outro processo da pasta) está aberto.
!define DIRETOR_PS_EDITOR "if(@($$l|?{$$_.CommandLine -notmatch 'server\.cjs'}).Count){exit 10}"
!define DIRETOR_PS_KILL_ALL "$$l|%{Stop-Process -Id $$_.ProcessId -Force -EA 0}"

!define DIRETOR_MSG_CLOSE "O Diretor está aberto.$\r$\n$\r$\nSalve o seu projeto, feche o Diretor e clique em Repetir."
; Sem PowerShell não dá para separar o editor do servidor que o Claude Desktop abriu.
!define DIRETOR_MSG_CLOSE_ALL "O Diretor está aberto, ou o Claude Desktop está usando o Diretor.$\r$\n$\r$\nSalve o seu projeto, feche o Diretor e o Claude Desktop e clique em Repetir."
!define DIRETOR_MSG_RESTART_CLAUDE "O Claude Desktop estava conectado ao Diretor, e a conexão foi fechada para instalar.$\r$\n$\r$\nQuando a instalação terminar, feche o Claude Desktop por completo (botão direito no ícone dele, perto do relógio → Sair) e abra de novo."

; Devolve 10 em _RETURN se o editor está aberto.
!macro diretorEditorRunning _RETURN
  ${if} $IsPowerShellAvailable == 0
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -Command "${DIRETOR_PS_LIST};${DIRETOR_PS_EDITOR}"`
    Pop ${_RETURN}
  ${else}
    nsExec::Exec `"$CmdPath" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
    Pop ${_RETURN}
    ${if} ${_RETURN} == 0
      StrCpy ${_RETURN} 10
    ${endIf}
  ${endIf}
!macroend

!macro diretorKillAll
  ${if} $IsPowerShellAvailable == 0
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -Command "${DIRETOR_PS_LIST};${DIRETOR_PS_KILL_ALL}"`
  ${else}
    nsExec::Exec `"$CmdPath" /C taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
  ${endIf}
  Pop $R2
!macroend

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  System::Call 'kernel32::SetEnvironmentVariable(t "DIRETOR_INSTDIR", t "$INSTDIR")'
  Var /GLOBAL diretorClaudeClosed
  StrCpy $diretorClaudeClosed 0

  ${if} $IsPowerShellAvailable == 0
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -Command "${DIRETOR_PS_LIST};${DIRETOR_PS_KILL_SERVER}"`
    Pop $R0
    ${if} $R0 == 10
      StrCpy $diretorClaudeClosed 1
      ; os arquivos ficam livres
      Sleep 1000
    ${endIf}
  ${endIf}

  StrCpy $R1 0
  diretor_check_editor:
    !insertmacro diretorEditorRunning $R0
    ${if} $R0 == 10
      ${if} ${Silent}
      ${OrIf} ${isUpdated}
        IntOp $R1 $R1 + 1
        ${if} $R1 > 5
          MessageBox MB_OK|MB_ICONSTOP "$(appCannotBeClosed)" /SD IDOK
          SetErrorLevel 2
          Quit
        ${endIf}
        DetailPrint "$(appClosing)"
        !insertmacro diretorKillAll
        Sleep 1500
        Goto diretor_check_editor
      ${endIf}
      ${if} $IsPowerShellAvailable == 0
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${DIRETOR_MSG_CLOSE}" IDRETRY diretor_check_editor
      ${else}
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${DIRETOR_MSG_CLOSE_ALL}" IDRETRY diretor_check_editor
      ${endIf}
      SetErrorLevel 1
      Quit
    ${endIf}

  !ifndef BUILD_UNINSTALLER
    ${if} $diretorClaudeClosed == 1
    ${andIfNot} ${Silent}
      MessageBox MB_OK|MB_ICONINFORMATION "${DIRETOR_MSG_RESTART_CLAUDE}"
    ${endIf}
  !endif
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Tira o Diretor da configuração do Claude Desktop (só a entrada que aponta para esta
    ; instalação), para o Claude não ficar tentando abrir um programa que não existe mais.
    ; O Diretor.exe roda como Node, como quando o Claude abre o servidor.
    System::Call 'kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1")'
    nsExec::ExecToLog /TIMEOUT=20000 `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\app.asar.unpacked\dist\mcp\desconectar.cjs"`
    Pop $R0
    System::Call 'kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", p 0)'
  ${endIf}
!macroend
