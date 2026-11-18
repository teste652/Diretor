; Instalador do Windows (electron-builder, NSIS): o que muda em relação ao padrão.
; O electron-builder inclui este arquivo sozinho (ele fica na pasta build).
;
; Instalar por cima e desinstalar: o padrão fecha à força tudo o que roda da pasta do
; Diretor. Aqui:
; - o editor nunca é fechado à força com a pessoa olhando: pode ter um projeto sem salvar.
;   O instalador pede para salvar e fechar. Só no modo silencioso (/S) ele é fechado.
; - depois, o servidor que o Claude Desktop abriu (Diretor.exe rodando server.cjs) é fechado
;   sem perguntar, porque não guarda nada. O Claude só o abre de novo quando reinicia, então,
;   com os arquivos novos no lugar, o instalador avisa para fechar e abrir o Claude.
; - só fecha o que roda da pasta instalada: um Diretor.exe de outra pasta continua aberto.
;
; Desinstalar (não ao atualizar): tira o Diretor da configuração do Claude Desktop. Antes,
; se o Claude Desktop está aberto, pede para fechá-lo, senão ele pode gravar de volta a
; configuração que carregou ao abrir.

; Processos que rodam da pasta do Diretor ($l), menos o próprio instalador (o pai deste
; PowerShell). A pasta vem por variável de ambiente, para aspas no caminho não quebrarem nada.
!define DIRETOR_PS_LIST "$$a=Get-CimInstance Win32_Process;$$p=($$a|?{$$_.ProcessId -eq $$PID}).ParentProcessId;$$d=$$env:DIRETOR_INSTDIR.TrimEnd('\')+'\';$$l=@($$a|?{$$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$d,'OrdinalIgnoreCase') -and $$_.ProcessId -ne $$p})"
; Fecha o servidor do Claude. Sai com 10 se havia algum.
!define DIRETOR_PS_KILL_SERVER "$$s=@($$l|?{$$_.CommandLine -match 'server\.cjs'});$$s|%{Stop-Process -Id $$_.ProcessId -Force -EA 0};if($$s.Count){exit 10}"
; Sai com 10 se o editor (qualquer outro processo da pasta) está aberto.
!define DIRETOR_PS_EDITOR "if(@($$l|?{$$_.CommandLine -notmatch 'server\.cjs'}).Count){exit 10}"
!define DIRETOR_PS_KILL_ALL "$$l|%{Stop-Process -Id $$_.ProcessId -Force -EA 0}"
; Sai com 10 se o Claude Desktop (o da Microsoft Store ou o do instalador clássico) está aberto.
; O Claude Code também se chama claude.exe; por isso olha a pasta de onde ele roda.
!define DIRETOR_PS_CLAUDE "if(@(Get-CimInstance Win32_Process|?{$$_.Name -eq 'claude.exe' -and $$_.ExecutablePath -match 'WindowsApps|AnthropicClaude'}).Count){exit 10}"

!define DIRETOR_MSG_CLOSE "O Diretor está aberto.$\r$\n$\r$\nSalve o seu projeto, feche o Diretor e clique em Repetir."
; Sem PowerShell não dá para separar o editor do servidor que o Claude Desktop abriu.
!define DIRETOR_MSG_CLOSE_ALL "O Diretor está aberto, ou o Claude Desktop está usando o Diretor.$\r$\n$\r$\nSalve o seu projeto e feche o Diretor. Feche também o Claude Desktop por completo (botão direito no ícone dele, perto do relógio → Sair). Depois clique em Repetir."
!define DIRETOR_MSG_RESTART_CLAUDE "O Diretor foi atualizado. O Claude Desktop estava conectado a ele, e a conexão foi fechada para instalar.$\r$\n$\r$\nPara conectar de novo, feche o Claude Desktop por completo (botão direito no ícone dele, perto do relógio → Sair) e abra de novo."
!define DIRETOR_MSG_QUIT_CLAUDE "O Claude Desktop está aberto.$\r$\n$\r$\nPara o Diretor sair da configuração dele, feche o Claude Desktop por completo (botão direito no ícone dele, perto do relógio → Sair) e clique em Repetir. Ou clique em Ignorar para desinstalar assim mesmo."

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
  ; Aberto de um terminal do PowerShell 7 (como no CI), o instalador herda uma lista de
  ; módulos que o Windows PowerShell não carrega, e aí parece que não há PowerShell. Sem a
  ; variável, ele monta a lista padrão.
  System::Call 'kernel32::SetEnvironmentVariable(t "PSModulePath", p 0)'
  !insertmacro IS_POWERSHELL_AVAILABLE
  System::Call 'kernel32::SetEnvironmentVariable(t "DIRETOR_INSTDIR", t "$INSTDIR")'
  Var /GLOBAL diretorClaudeClosed
  StrCpy $diretorClaudeClosed 0

  ; Primeiro o editor (o servidor do Claude não conta): se a pessoa cancelar, nada foi fechado.
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

  !ifdef BUILD_UNINSTALLER
    ; Desinstalar com o Claude Desktop aberto: ele pode gravar de volta a configuração com o
    ; Diretor, que o desinstalador vai tirar. Pede para fechar (ou seguir assim mesmo).
    ${ifNot} ${isUpdated}
    ${andIfNot} ${Silent}
    ${andIf} $IsPowerShellAvailable == 0
      diretor_check_claude:
        nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -Command "${DIRETOR_PS_CLAUDE}"`
        Pop $R0
        ${if} $R0 == 10
          MessageBox MB_ABORTRETRYIGNORE|MB_ICONEXCLAMATION "${DIRETOR_MSG_QUIT_CLAUDE}" IDRETRY diretor_check_claude IDIGNORE diretor_claude_ok
          SetErrorLevel 1
          Quit
        ${endIf}
      diretor_claude_ok:
    ${endIf}
  !endif

  ; Por último, o servidor que o Claude Desktop abriu: não guarda nada, então fecha sem perguntar.
  ${if} $IsPowerShellAvailable == 0
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -Command "${DIRETOR_PS_LIST};${DIRETOR_PS_KILL_SERVER}"`
    Pop $R0
    ${if} $R0 == 10
      StrCpy $diretorClaudeClosed 1
      ; os arquivos ficam livres
      Sleep 1000
    ${endIf}
  ${endIf}
!macroend

; Com os arquivos novos no lugar: se o servidor do Claude foi fechado, avisa para reabrir o Claude.
!macro customInstall
  ${if} $diretorClaudeClosed == 1
  ${andIfNot} ${Silent}
    MessageBox MB_OK|MB_ICONINFORMATION "${DIRETOR_MSG_RESTART_CLAUDE}"
  ${endIf}
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
