# Diretor

Editor de vídeo para Windows com foco em motion graphics, feito para editar à mão **e** colaborar com o Claude Desktop na mesma linha do tempo. Você pede em linguagem natural (com detalhes, “do frame 15 ao 45”, ou sem detalhes, “faz do melhor jeito”) e vê cada etapa aparecer como **rascunho editável** na prévia e na linha do tempo. Você ajusta à mão, aceita ou descarta. Nada é gravado sem a sua aprovação.

![Rascunho da IA na linha do tempo](docs/capturas/1-rascunho-entrada.png)

## Tecnologia (por quê)

- **Electron + React + TypeScript.** Roda no Windows com uma única base de código, e a prévia usa o Chromium, que decodifica H.264 e desenha texto com qualidade.
- **Um único compositor (`src/core/render.ts`).** A prévia e a exportação usam o mesmo código de desenho no mesmo motor, então enquadramento, tempo, legendas e animação saem iguais. O teste automático compara prévia e MP4 quadro a quadro.
- **ffmpeg local** (pacote `ffmpeg-static`) só para ler os vídeos, codificar o MP4 (H.264, cores BT.709) e misturar o áudio aparado do original. Nada é enviado para a internet.
- **MCP local (stdio)** para o Claude Desktop, usando a sua conta já autenticada. Sem chave de API, sem créditos próprios, sem cobrança por comando.

## Instalação (Windows)

Requisitos: [Node.js 22.12 ou mais novo](https://nodejs.org) (a versão LTS atual serve) e Git.

```powershell
git clone https://github.com/teste652/Diretor.git
cd Diretor
npm install
npm start
```

`npm start` compila e abre o editor (na primeira vez, baixa o Electron, uns 100 MB). Para desenvolver com recarga automática: `npm run dev`.

O `npm install` baixa o ffmpeg para Windows x64. Em Windows ARM (ou se a rede bloquear o download) a instalação continua sem ele: instale o ffmpeg, deixe-o no PATH ou aponte a variável `DIRETOR_FFMPEG` para o `ffmpeg.exe`. O editor avisa se não encontrar o ffmpeg.

## Conectar ao Claude Desktop

1. Rode `npm run build` uma vez (gera `dist\mcp\server.cjs`).
2. Rode `npm run mcp:config`. Ele imprime o trecho de configuração com os caminhos certos do seu computador.
3. No Claude Desktop, abra **Configurações → Desenvolvedor → Editar configuração** e cole o trecho dentro de `claude_desktop_config.json` (se já houver outros servidores em `mcpServers`, só acrescente `"diretor"`). Exemplo:

   ```json
   {
     "mcpServers": {
       "diretor": { "command": "node", "args": ["C:\\caminho\\para\\Diretor\\dist\\mcp\\server.cjs"] }
     }
   }
   ```

   Sem Node no PATH, use a opção B que o comando imprime (o próprio Electron do projeto com `ELECTRON_RUN_AS_NODE=1`).
4. Reinicie o Claude Desktop. O conector “diretor” deve aparecer na lista de ferramentas.
5. Deixe o editor aberto. O painel da direita mostra “Claude conectado” quando o Claude usa as ferramentas.

Como funciona: o Claude Desktop inicia `server.cjs`; ele conversa com o editor aberto por uma ponte em `127.0.0.1` protegida por um token aleatório (arquivo `%LOCALAPPDATA%\Diretor\bridge.json`). O editor funciona normalmente sem a IA.

### Ferramentas que o Claude recebe

| Ferramenta | O que faz |
|---|---|
| `get_context` | Lê revisão, seleção (clipes compactos, com keyframes) e playhead. Mínimo por padrão; `knownRevision` reaproveita o que o Claude já tem. |
| `propose_edit` | Envia uma proposta em **etapas** (ex.: “Entrada”, “Saída”). Cada etapa vira rascunho, uma por vez. `requestId` torna a chamada idempotente. |
| `get_proposal` | Mostra o que você decidiu (aceitou, ajustou, descartou) e as notas que você escreveu no painel. Pode esperar até 45 s por uma decisão (abaixo do limite de ~60 s do Claude Desktop). Se você parar o Claude no meio da espera, o editor desiste na hora e a sua nota fica para a próxima chamada. |
| `cancel_proposal` | Cancela uma proposta pendente. |
| `editor_status` | Confere se o editor está aberto. |

As operações são as mesmas que a interface usa (`src/core/operations.ts`): `animate` (presets que viram keyframes editáveis), `setKeyframe`, `retimeGroup`, `setProperty`, `addClip`, `updateClip`, `trimClip` (aparar como nas bordas do clipe), `removeClip` etc. O editor valida alvo, parâmetros (tipos, faixas, campos desconhecidos: um campo com nome errado é recusado, não ignorado), intervalo e revisão antes de mostrar qualquer coisa. Importar mídia, mexer nas faixas, renomear o projeto e mudar o formato ficam só na interface e nunca entram num rascunho do Claude.

## Usando

- **Mídia:** “Adicionar mídia” importa um MP4 (o original nunca é alterado). O primeiro vídeo define o formato do projeto (tamanho, orientação e quadros por segundo, inclusive 23,976/29,97 exatos). Se um vídeo do projeto foi movido ou apagado, o editor diz isso (não “formato não suportado”).
- **Aparar:** arraste as bordas do clipe na linha do tempo, ou edite “Corte inicial” e “Duração” em Propriedades. Aparar o início de um vídeo mantém o clipe no lugar e puxa os vídeos seguintes da faixa, sem deixar buraco. As animações acompanham o conteúdo (entrada e saída presas às bordas acompanham a borda).
- **Título e legendas:** botões “Título” e “Adicionar legenda”. Texto, início, fim e estilo ficam em Propriedades.
- **Animação:** em Propriedades, cada propriedade (posição, escala, opacidade) tem o losango para criar/remover ponto no playhead. Pontos podem ser arrastados na linha do tempo; clique num ponto para editar tempo, valor e suavização (com um ponto selecionado, Delete e a lixeira removem só o ponto). Grupos (Entrada, Saída) têm início e duração editáveis. “Animação pronta” aplica presets. Quando duas animações se encontram no mesmo instante, o painel edita o ponto que a prévia mostra.
- **Rascunho da IA:** aparece tracejado na linha do tempo e com o selo “Rascunho” na prévia. Editar um ponto do rascunho ajusta o rascunho. “Ajustar na linha do tempo” manda qualquer edição manual para o rascunho. Com o rascunho aberto, Ctrl+Z desfaz só os seus ajustes nele. “Aceitar” grava a etapa (uma entrada de histórico por etapa); “Descartar” pula para a próxima. Clipes que a proposta remove aparecem hachurados em vermelho na linha do tempo.
- **Desatualizado:** se você editar o projeto ou selecionar outro clipe enquanto há um rascunho, ele fica “Desatualizado”. O Claude não refaz por conta própria: “Refazer com contexto atual” registra o pedido e, quando você disser “refaz” no Claude Desktop, ele recebe o contexto novo.
- **Modo econômico** (ligado por padrão, lembrado entre sessões): contexto mínimo, respostas curtas, teto configurável de tamanho por ação. Se o Claude precisar de mais, recebe uma versão reduzida que cabe no teto e o editor pede sua autorização (vale uma vez; se você recusar, ele não pede de novo até você mudar o teto). Os tamanhos mostrados são métricas do editor; cota e consumo de tokens são do Claude Desktop. Nenhuma imagem ou trecho de vídeo é enviado ao chat nesta fase.
- **Atalhos:** Espaço (reproduzir), Ctrl+Z / Ctrl+Y, Ctrl+S, Ctrl+O, Delete, ← → (quadro a quadro).
- **Salvar / Abrir:** projeto em `.diretor.json`, que guarda caminhos para os originais. O editor avisa antes de fechar ou abrir outro projeto com mudanças não salvas.
- **Exportar:** gera MP4 (H.264 + AAC) com o que já foi aceito. Antes de começar, confere se todos os vídeos abrem. O MP4 é gravado num arquivo temporário na mesma pasta e só substitui o destino quando fica pronto: “Cancelar” (em qualquer momento, inclusive na conferência e na finalização), fechar a janela ou o editor cair nunca deixam arquivo pela metade nem apagam um arquivo que já existia. Fechar a janela durante a exportação pede confirmação.

## Testes

```bash
npm test            # 75 testes: unitários + MCP real (cliente MCP → servidor stdio → ponte → editor) + exportação com ffmpeg
npm run typecheck
npm run test:e2e    # abre o app Electron e roda o roteiro da especificação (no Linux sem tela: xvfb-run -a node scripts/e2e.mjs)
```

O teste de ponta a ponta (41 verificações) importa e apara um MP4 com acento no nome, cria legenda e título, faz um cliente MCP pedir “subir suavemente no começo e desaparecer no fim”, ajusta a duração à mão (e desfaz/refaz dentro do rascunho), aceita a entrada, descarta a saída, testa proposta desatualizada, chamada repetida e conflito de `requestId`, o Claude parando no meio de uma espera, desfaz/refaz, salva/reabre e exporta. Depois compara prévia × MP4 em 10 quadros (PSNR > 30 dB) e confere, pelo contador do vídeo de teste, que os dois mostram o quadro exato do original. Também testa vídeo ausente, cancelar a exportação no meio, na conferência e no último quadro (sem apagar o arquivo que já existia nem deixar ffmpeg rodando), a interface caindo no meio da exportação, e na interface: campo numérico ao trocar de clipe, arrasto da borda do vídeo, lixeira com ponto selecionado e o painel do modo econômico. Capturas e o MP4 ficam em `.test-output/`.

O GitHub Actions roda tudo isso no Windows em cada PR (`.github/workflows/ci.yml`) e guarda as capturas e o MP4 como artefato.

### Roteiro para testar no seu computador

Veja [docs/ROTEIRO-DE-TESTE.md](docs/ROTEIRO-DE-TESTE.md).

## Estrutura

```
src/core/       modelo, operações, sessão (rascunhos, histórico), API do MCP, compositor, exportação
src/main/       processo principal do Electron: janela, arquivos, ffmpeg, ponte local
src/preload/    ponte segura entre a interface e o processo principal
src/renderer/   interface (React)
src/mcp/        servidor MCP stdio para o Claude Desktop
tests/          testes automáticos (vitest)
scripts/        build, e2e, configuração do MCP
docs/           plano, roteiro de teste e capturas
```
