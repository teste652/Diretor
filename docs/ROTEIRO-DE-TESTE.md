# Roteiro de teste no Windows

## Verificado automaticamente (Linux, nesta entrega)

- 16 testes unitários e de integração (`npm test`): operações, validação, rascunhos, desatualização, idempotência, desfazer/refazer, salvar/abrir, modo econômico e teto de contexto, servidor MCP real via stdio, exportação com ffmpeg (duração e áudio).
- Teste de ponta a ponta no app Electron (`npm run test:e2e`, 21 verificações): roteiro completo da especificação, com o Claude simulado por um cliente MCP real, e comparação prévia × MP4 em 0,1 s, 0,6 s, 1,2 s, 2,0 s e 3,9 s (PSNR entre 36 e 40 dB).

## Precisa ser testado no seu computador

1. **Instalação:** `npm install` e `npm start` abrem o editor. Confira a barra de título (botões de minimizar/maximizar/fechar do Windows à direita).
2. **Importar e aparar:** “Adicionar mídia” com um MP4 seu (de preferência com áudio). Arraste as bordas para aparar. A prévia deve tocar com som.
3. **Legenda:** “Adicionar legenda”, edite texto, início, fim e estilo em Propriedades.
4. **Título:** botão “Título”, selecione-o.
5. **Claude Desktop:** configure o MCP (README) e reinicie o Claude Desktop. Peça: “Faz esse título subir suavemente no começo e desaparecer no fim”.
   - O painel deve mostrar “Claude conectado” e um cartão “Rascunho” com 2 etapas.
   - A linha do tempo mostra “Rascunho da IA” tracejado e losangos vazados.
6. **Ajustar e aceitar:** mude a duração da “Entrada” em Propriedades (ou arraste o losango). Clique **Aceitar**.
7. **Descartar:** a “Saída” aparece como rascunho; clique **Descartar**. A entrada aprovada deve continuar no projeto.
8. **Desatualizado:** peça outra mudança ao Claude e, antes de decidir, edite a legenda. O cartão deve virar “Desatualizado”. Clique “Refazer com contexto atual” e diga ao Claude “refaz”.
9. **Chamada repetida:** peça ao Claude para reenviar a mesma proposta; não deve duplicar.
10. **Desfazer/refazer** (Ctrl+Z / Ctrl+Y) a entrada aceita.
11. **Salvar, fechar, reabrir** o projeto.
12. **Exportar** e comparar o MP4 com a prévia no início, meio e fim da animação; conferir duração, legenda e áudio.
13. **Teto de contexto:** em “Modo econômico”, baixe o teto para 1 KB e peça ao Claude algo que precise da linha do tempo inteira. O editor deve pedir sua autorização.
14. **Sem IA:** feche o Claude Desktop; o editor continua funcionando à mão.

## Pontos de atenção que não deu para conferir aqui

- Comportamento do Claude Desktop com `get_proposal` esperando até 50 s (tempo limite do cliente). Se der erro de tempo, reduza `waitSeconds`.
- Caminhos com acentos/espaços no Windows (o protocolo `media://` decodifica o caminho completo; testado no Linux com espaço no nome).
- Fontes: a prévia e a exportação usam a mesma fonte (Segoe UI no Windows), então devem bater; no Linux foi usada a fonte padrão do sistema.
- Desempenho da exportação em vídeos 1080p (aqui: 4 s em 1280×720 levaram ~17 s sem GPU).
