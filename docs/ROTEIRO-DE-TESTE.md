# Roteiro de teste no Windows

## Verificado automaticamente

No Linux (nesta entrega) e no Windows pelo GitHub Actions (`.github/workflows/ci.yml`, a cada PR):

- 84 testes unitários e de integração (`npm test`): operações e validação estrita (campo com nome errado é recusado), presets combinados sem apagar o valor de repouso, aparar com várias animações e com vídeos seguintes, rascunhos, desatualização e a orientação ao Claude para esperar, chamada repetida e conflito de `requestId`, desfazer/refazer (inclusive dentro do rascunho), salvar/abrir (com arquivo inválido), modo econômico e teto de contexto, notas do usuário (inclusive com o Claude cancelando a espera, pelo servidor MCP real), exportação com ffmpeg (duração, áudio, áudio que começa depois, cores BT.709, vídeo girado de celular, 23,976 fps sem escorregar quadro, temporário sem extensão .mp4), troca do destino com arquivo preso (tenta de novo, salva como “nome (1).mp4”, nunca apaga o vídeo pronto) e o painel de animação com o playhead fora do clipe.
- Teste de ponta a ponta no app Electron (`npm run test:e2e`, 43 verificações): o roteiro completo da especificação, com o Claude simulado por um cliente MCP real; arquivo com acento e espaço no nome; Ctrl+Z dentro do rascunho; o Claude parando no meio de uma espera sem perder a sua nota; prévia × MP4 em 10 quadros (PSNR entre 36 e 39 dB) e conferência, pelo contador do vídeo de teste, de que os dois mostram o quadro exato do original; vídeo que sumiu do disco; cancelar a exportação no meio, na conferência dos vídeos e no último quadro, sem apagar um arquivo que já existia e sem deixar ffmpeg rodando; exportar com nome longo e acentuado; exportar por cima de um MP4 aberto em outro programa (no Windows, preso de verdade por outro processo); a interface caindo no meio da exportação; campo numérico ao trocar de clipe, arrasto da borda do vídeo, lixeira com ponto selecionado e painel do modo econômico.

## Precisa ser testado no seu computador

1. **Instalação:** `npm install` e `npm start` abrem o editor. Confira a barra de título (botões de minimizar/maximizar/fechar do Windows à direita).
2. **Importar e aparar:** “Adicionar mídia” com um MP4 seu (de preferência com áudio e com acento no nome). Arraste as bordas para aparar: durante o arrasto o clipe já aparece como vai ficar. A prévia deve tocar com som, sem engasgar, e o fps do projeto deve ser o do vídeo (um vídeo de câmera em 23,976 ou 29,97 aparece assim, não arredondado).
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
11. **Nota para o Claude:** escreva uma nota no painel enquanto ele espera a sua decisão. Ele deve recebê-la na hora. Depois, enquanto ele espera, aperte o botão de parar no Claude Desktop, escreva outra nota e peça para ele continuar: a nota deve chegar.
12. **Desfazer/refazer** (Ctrl+Z / Ctrl+Y) a entrada aceita.
13. **Salvar, fechar, reabrir** o projeto. Mude algo e tente fechar a janela: o editor deve perguntar antes de sair sem salvar. Renomeie um dos vídeos na pasta e reabra o projeto: o aviso deve dizer que o arquivo não foi encontrado.
14. **Exportar** e comparar o MP4 com a prévia no início, meio e fim da animação; conferir duração, legenda, cores e áudio. Exporte de novo **por cima do mesmo arquivo** e clique **Cancelar** no meio: deve parar na hora e o MP4 anterior continua lá, inteiro. Exporte mais uma vez e tente fechar a janela: o editor pergunta antes. Por fim, abra o MP4 exportado num player (Filmes e TV, Windows Media Player ou VLC), deixe-o tocando e exporte de novo para o mesmo nome: se o player prender o arquivo, o editor avisa que salvou como “nome (1).mp4”; se não prender, substitui. Em nenhum caso um vídeo some ou fica pela metade.
15. **Teto de contexto:** em “Modo econômico”, baixe o teto para 1 KB e peça ao Claude algo que precise da linha do tempo inteira. O editor deve pedir sua autorização; se recusar, o Claude não deve pedir de novo.
16. **Sem IA:** feche o Claude Desktop; o editor continua funcionando à mão.

## Pontos de atenção que não deu para conferir aqui

- O Claude Desktop real: tempo limite das ferramentas (o `get_proposal` espera no máximo 45 s, abaixo dos ~60 s do cliente) e se ele segue as instruções de esperar a sua decisão.
- Fontes: a prévia e a exportação usam a mesma fonte (Segoe UI no Windows), então devem bater; no Linux foi usada a fonte padrão do sistema.
- Desempenho da exportação em vídeos 1080p (aqui: 4 s em 1280×720 levaram ~17 s sem GPU). Vídeos de câmera ou celular com quadros-chave muito espaçados podem exportar mais devagar, porque cada quadro é buscado no tempo exato.
- Windows ARM: o pacote do ffmpeg não tem versão para ARM; instale o ffmpeg e aponte `DIRETOR_FFMPEG` (o editor avisa se não encontrar).
