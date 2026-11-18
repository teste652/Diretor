# Roteiro de teste no Windows

## Verificado automaticamente

No Linux (nesta entrega) e no Windows pelo GitHub Actions (`.github/workflows/ci.yml`, a cada PR):

- 60 testes unitários e de integração (`npm test`): operações e validação estrita, presets combinados sem apagar o valor de repouso, aparar com animações e com vídeos seguintes, rascunhos, desatualização, chamada repetida e conflito de `requestId`, desfazer/refazer (inclusive dentro do rascunho), salvar/abrir (com arquivo inválido), modo econômico e teto de contexto, notas do usuário, servidor MCP real via stdio, exportação com ffmpeg (duração, áudio, áudio que começa depois, cores BT.709, vídeo girado de celular).
- Teste de ponta a ponta no app Electron (`npm run test:e2e`, 32 verificações): o roteiro completo da especificação, com o Claude simulado por um cliente MCP real; arquivo com acento e espaço no nome; Ctrl+Z dentro do rascunho; prévia × MP4 em 10 quadros (PSNR entre 36 e 39 dB) e conferência, pelo contador do vídeo de teste, de que os dois mostram o quadro exato do original; vídeo ausente na exportação; cancelar a exportação no meio.

## Precisa ser testado no seu computador

1. **Instalação:** `npm install` e `npm start` abrem o editor. Confira a barra de título (botões de minimizar/maximizar/fechar do Windows à direita).
2. **Importar e aparar:** “Adicionar mídia” com um MP4 seu (de preferência com áudio e com acento no nome). Arraste as bordas para aparar. A prévia deve tocar com som, sem engasgar, e o fps do projeto deve ser o do vídeo.
3. **Vídeo de celular:** importe um vídeo gravado em pé. Ele deve aparecer em pé, sem esticar, e o projeto deve ficar na vertical.
4. **Legenda:** “Adicionar legenda”, edite texto, início, fim e estilo em Propriedades.
5. **Título:** botão “Título”, selecione-o.
6. **Claude Desktop:** configure o MCP (README) e reinicie o Claude Desktop. Peça: “Faz esse título subir suavemente no começo e desaparecer no fim”.
   - O painel deve mostrar “Claude conectado” e um cartão “Rascunho” com 2 etapas.
   - A linha do tempo mostra “Rascunho da IA” tracejado e losangos vazados.
7. **Ajustar e aceitar:** mude a duração da “Entrada” em Propriedades (ou arraste o losango). Aperte Ctrl+Z: só o seu ajuste volta, o rascunho continua. Ctrl+Y refaz. Clique **Aceitar**.
8. **Descartar:** a “Saída” aparece como rascunho; clique **Descartar**. A entrada aprovada deve continuar no projeto.
9. **Desatualizado:** peça outra mudança ao Claude e, antes de decidir, edite a legenda. O cartão deve virar “Desatualizado” e o Claude deve esperar (não refazer sozinho). Clique “Refazer com contexto atual” e diga ao Claude “refaz”.
10. **Chamada repetida:** peça ao Claude para reenviar a mesma proposta; não deve duplicar.
11. **Nota para o Claude:** escreva uma nota no painel enquanto ele espera a sua decisão. Ele deve recebê-la na hora.
12. **Desfazer/refazer** (Ctrl+Z / Ctrl+Y) a entrada aceita.
13. **Salvar, fechar, reabrir** o projeto. Mude algo e tente fechar a janela: o editor deve perguntar antes de sair sem salvar.
14. **Exportar** e comparar o MP4 com a prévia no início, meio e fim da animação; conferir duração, legenda, cores e áudio. Exporte de novo e clique **Cancelar** no meio: deve parar na hora, sem deixar arquivo pela metade.
15. **Teto de contexto:** em “Modo econômico”, baixe o teto para 1 KB e peça ao Claude algo que precise da linha do tempo inteira. O editor deve pedir sua autorização; se recusar, o Claude não deve pedir de novo.
16. **Sem IA:** feche o Claude Desktop; o editor continua funcionando à mão.

## Pontos de atenção que não deu para conferir aqui

- O Claude Desktop real: tempo limite das ferramentas (o `get_proposal` espera no máximo 45 s, abaixo dos ~60 s do cliente) e se ele segue as instruções de esperar a sua decisão.
- Fontes: a prévia e a exportação usam a mesma fonte (Segoe UI no Windows), então devem bater; no Linux foi usada a fonte padrão do sistema.
- Desempenho da exportação em vídeos 1080p (aqui: 4 s em 1280×720 levaram ~17 s sem GPU). Vídeos de câmera ou celular com quadros-chave muito espaçados podem exportar mais devagar, porque cada quadro é buscado no tempo exato.
- Windows ARM: o pacote do ffmpeg não tem versão para ARM; instale o ffmpeg e aponte `DIRETOR_FFMPEG` (o editor avisa se não encontrar).
