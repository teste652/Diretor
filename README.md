# Diretor

Editor de vídeo para Windows com foco em motion graphics, feito para editar à mão **e** colaborar com o Claude Desktop na mesma linha do tempo. Você pede em linguagem natural (com detalhes, “do frame 15 ao 45”, ou sem detalhes, “faz do melhor jeito”) e vê cada etapa aparecer como **rascunho editável** na prévia e na linha do tempo. Você ajusta à mão, aceita ou descarta. Nada é gravado sem a sua aprovação.

![Rascunho da IA na linha do tempo](docs/capturas/1-rascunho-entrada.png)

## Tecnologia (por quê)

- **Electron + React + TypeScript.** Roda no Windows com uma única base de código, e a prévia usa o Chromium, que decodifica H.264 e desenha texto com qualidade.
- **Um único compositor (`src/core/render.ts`).** A prévia e a exportação usam o mesmo código de desenho no mesmo motor, então enquadramento, tempo, legendas e animação saem iguais. O teste automático compara prévia e MP4 quadro a quadro.
- **ffmpeg local** (pacote `ffmpeg-static`) só para codificar o MP4 e misturar o áudio aparado do original. Nada é enviado para a internet.
- **MCP local (stdio)** para o Claude Desktop, usando a sua conta já autenticada. Sem chave de API, sem créditos próprios, sem cobrança por comando.

## Instalação (Windows)

Requisitos: [Node.js 20 LTS ou mais novo](https://nodejs.org) e Git.

```powershell
git clone https://github.com/teste652/Diretor.git
cd Diretor
npm install
npm start
```

`npm start` compila e abre o editor. Para desenvolver com recarga automática: `npm run dev`.

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

Como funciona: o Claude Desktop inicia `server.cjs`; ele conversa com o editor aberto por uma ponte em `127.0.0.1` protegida por um token aleatório (arquivo `%APPDATA%\Diretor\bridge.json`). O editor funciona normalmente sem a IA.

### Ferramentas que o Claude recebe

| Ferramenta | O que faz |
|---|---|
| `get_context` | Lê revisão, seleção (clipes compactos, com keyframes) e playhead. Mínimo por padrão; `knownRevision` reaproveita o que o Claude já tem. |
| `propose_edit` | Envia uma proposta em **etapas** (ex.: “Entrada”, “Saída”). Cada etapa vira rascunho, uma por vez. `requestId` torna a chamada idempotente. |
| `get_proposal` | Mostra o que você decidiu (aceitou, ajustou, descartou). Pode esperar até 50 s por uma decisão. |
| `cancel_proposal` | Cancela uma proposta pendente. |
| `editor_status` | Confere se o editor está aberto. |

As operações são as mesmas que a interface usa (`src/core/operations.ts`): `animate` (presets que viram keyframes editáveis), `setKeyframe`, `retimeGroup`, `setProperty`, `addClip`, `updateClip`, `removeClip` etc. O editor valida alvo, parâmetros, intervalo e revisão antes de mostrar qualquer coisa.

## Usando

- **Mídia:** “Adicionar mídia” importa um MP4 (o original nunca é alterado). O primeiro vídeo define o formato do projeto.
- **Aparar:** arraste as bordas do clipe na linha do tempo, ou edite “Corte inicial” e “Duração” em Propriedades.
- **Título e legendas:** botões “Título” e “Adicionar legenda”. Texto, início, fim e estilo ficam em Propriedades.
- **Animação:** em Propriedades, cada propriedade (posição, escala, opacidade) tem o losango para criar/remover ponto no playhead. Pontos podem ser arrastados na linha do tempo; clique num ponto para editar tempo, valor e suavização. Grupos (Entrada, Saída) têm início e duração editáveis. “Animação pronta” aplica presets.
- **Rascunho da IA:** aparece tracejado na linha do tempo e com o selo “Rascunho” na prévia. Editar um ponto do rascunho ajusta o rascunho. “Ajustar na linha do tempo” manda qualquer edição manual para o rascunho. “Aceitar” grava a etapa (uma entrada de histórico por etapa); “Descartar” pula para a próxima.
- **Desatualizado:** se você editar o projeto ou selecionar outro clipe enquanto há um rascunho, ele fica “Desatualizado”. “Refazer com contexto atual” devolve ao Claude o contexto novo para ele refazer.
- **Modo econômico** (ligado por padrão): contexto mínimo, respostas curtas, teto configurável de tamanho por ação. Se o Claude precisar de mais, o editor pede sua autorização. Os tamanhos mostrados são métricas do editor; cota e consumo de tokens são do Claude Desktop. Nenhuma imagem ou trecho de vídeo é enviado ao chat nesta fase.
- **Atalhos:** Espaço (reproduzir), Ctrl+Z / Ctrl+Y, Ctrl+S, Ctrl+O, Delete, ← → (quadro a quadro).
- **Salvar / Abrir:** projeto em `.diretor.json`, que guarda caminhos para os originais.
- **Exportar:** gera MP4 (H.264 + AAC) com o que já foi aceito.

## Testes

```bash
npm test            # unitários + MCP real (cliente MCP → servidor stdio → ponte → editor) + exportação com ffmpeg
npm run typecheck
npm run test:e2e    # abre o app Electron e roda o roteiro da especificação (no Linux sem tela: xvfb-run -a node scripts/e2e.mjs)
```

O teste de ponta a ponta importa e apara um MP4, cria legenda e título, faz um cliente MCP pedir “subir suavemente no começo e desaparecer no fim”, ajusta a duração à mão, aceita a entrada, descarta a saída, testa proposta desatualizada e chamada repetida, desfaz/refaz, salva/reabre, exporta e compara prévia × MP4 em 5 instantes (PSNR > 30 dB). Capturas e o MP4 ficam em `.test-output/`.

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
