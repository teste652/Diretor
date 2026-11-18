# Diretor

Editor de vídeo para Windows com foco em motion graphics, feito para editar à mão **e** colaborar com o Claude Desktop na mesma linha do tempo. Você pede em linguagem natural (com detalhes, “do frame 15 ao 45”, ou sem detalhes, “faz do melhor jeito”) e vê cada etapa aparecer como **rascunho editável** na prévia e na linha do tempo. Você ajusta à mão, aceita ou descarta. Nada é gravado sem a sua aprovação.

![Rascunho da IA na linha do tempo](docs/capturas/1-rascunho-entrada.png)

## Tecnologia (por quê)

- **Electron + React + TypeScript.** Roda no Windows com uma única base de código, e a prévia usa o Chromium, que decodifica H.264 e desenha texto com qualidade.
- **Um único compositor (`src/core/render.ts`).** A prévia e a exportação usam o mesmo código de desenho no mesmo motor, então enquadramento, tempo, legendas e animação saem iguais. O teste automático compara prévia e MP4 quadro a quadro.
- **ffmpeg local** (pacote `ffmpeg-static`) só para ler os vídeos, codificar o MP4 (H.264, cores BT.709) e misturar o áudio aparado do original. Nada é enviado para a internet.
- **MCP local (stdio)** para o Claude Desktop, usando a sua conta já autenticada. Sem chave de API, sem créditos próprios, sem cobrança por comando.

## Baixar a versão de teste (Windows)

**[Diretor-Setup.exe](https://github.com/teste652/Diretor/releases/download/teste/Diretor-Setup.exe)**: sempre a versão mais nova da `main`, sem precisar de Node, Git nem comandos. O repositório é privado, então abra o link com a sua conta do GitHub conectada no navegador. Notas de cada versão: [versão de teste](https://github.com/teste652/Diretor/releases/tag/teste).

1. Baixe e abra o `Diretor-Setup.exe`. O instalador ainda não tem assinatura digital, então o Windows pode avisar “O Windows protegeu o computador”: clique em **Mais informações → Executar assim mesmo**. Se o navegador disser que o arquivo não é baixado com frequência, escolha **Manter**.
2. Ele instala sozinho, só para o seu usuário (em `%LOCALAPPDATA%\Programs`, sem pedir senha de administrador), cria o atalho no menu Iniciar e abre o Diretor. O ffmpeg e o servidor do Claude vêm dentro dele.
3. Para atualizar, baixe de novo pelo mesmo link e instale por cima. A versão instalada aparece ao lado do nome, no canto superior esquerdo.

O GitHub Actions gera esse instalador a cada mudança na `main`, instala, roda nele o roteiro de ponta a ponta inteiro e só então troca o arquivo do link.

## Instalação para desenvolver (Windows)

Requisitos: [Node.js 22.12 ou mais novo](https://nodejs.org) (a versão LTS atual serve) e Git.

```powershell
git clone https://github.com/teste652/Diretor.git
cd Diretor
npm install
npm start
```

`npm start` compila e abre o editor (na primeira vez, baixa o Electron, uns 100 MB). Para desenvolver com recarga automática: `npm run dev`.

O `npm install` baixa o ffmpeg para Windows x64. Em Windows ARM (ou se a rede bloquear o download) a instalação continua sem ele: instale o ffmpeg, deixe-o no PATH ou aponte a variável `DIRETOR_FFMPEG` para o `ffmpeg.exe`. O editor avisa se não encontrar o ffmpeg.

Para gerar o instalador no seu computador: `npm run dist` (no Windows; sai em `release\Diretor-Setup.exe`). O ícone fica em `build/` (`node scripts/make-icon.mjs` redesenha a partir de `build/icon.svg`).

## Conectar ao Claude Desktop

1. Abra o Claude Desktop pelo menos uma vez neste computador.
2. No Diretor, no painel do Claude (à direita), clique em **Conectar**.
3. Feche o Claude Desktop por completo (botão direito no ícone dele, perto do relógio → **Sair**) e abra de novo. O conector “diretor” aparece na lista de ferramentas.
4. Deixe o editor aberto. O painel mostra “Claude conectado” quando o Claude usa as ferramentas.

O botão grava o servidor “diretor” no `claude_desktop_config.json` do Claude Desktop e mantém o resto do arquivo (outros servidores e preferências). Antes, guarda uma cópia do arquivo como estava em `claude_desktop_config.antes-do-diretor.json`, na mesma pasta. Ele grava nas duas pastas que o Claude Desktop usa no Windows quando elas existem: a do instalador atual (pacote da Microsoft Store/MSIX, `%LOCALAPPDATA%\Packages\Claude_…\LocalCache\Roaming\Claude`) e a da instalação antiga (`%APPDATA%\Claude`). Arquivo com erro de formato não é tocado: o editor avisa e mostra onde ele está. O servidor roda com o próprio `Diretor.exe` (`ELECTRON_RUN_AS_NODE=1`), então não precisa do Node.

**À mão:** “Copiar configuração”, no mesmo painel, copia o trecho com os caminhos certos deste computador. Cole dentro de `claude_desktop_config.json` (se já houver outros servidores em `mcpServers`, só acrescente `"diretor"`). No app instalado, fica assim:

```json
{
  "mcpServers": {
    "diretor": {
      "command": "C:\\Users\\voce\\AppData\\Local\\Programs\\diretor\\Diretor.exe",
      "args": ["C:\\Users\\voce\\AppData\\Local\\Programs\\diretor\\resources\\app.asar.unpacked\\dist\\mcp\\server.cjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

Na cópia de desenvolvimento, o botão grava o Electron do projeto no lugar do `Diretor.exe`; `npm run build` e depois `npm run mcp:config` imprimem o trecho (também numa versão com `node`). Atenção: no Claude Desktop do instalador atual, **Configurações → Desenvolvedor → Editar configuração** pode abrir o arquivo da instalação antiga, que ele não lê; o botão **Conectar** grava nos dois.

Como funciona: o Claude Desktop inicia `server.cjs`; ele conversa com o editor aberto por uma ponte em `127.0.0.1` protegida por um token aleatório (arquivo `%LOCALAPPDATA%\Diretor\bridge.json`). O editor funciona normalmente sem a IA.

### Ferramentas que o Claude recebe

| Ferramenta | O que faz |
|---|---|
| `get_context` | Lê revisão, seleção (clipes compactos, com keyframes) e playhead. Mínimo por padrão; `knownRevision` reaproveita o que o Claude já tem. |
| `propose_edit` | Envia uma proposta em **etapas** (ex.: “Entrada”, “Saída”). Cada etapa vira rascunho, uma por vez. `requestId` torna a chamada idempotente. |
| `get_proposal` | Mostra o que você decidiu (aceitou, ajustou, descartou) e as notas que você escreveu no painel. Pode esperar até 45 s por uma decisão (abaixo do limite de ~60 s do Claude Desktop). Se você parar o Claude no meio da espera, o editor desiste na hora e a sua nota fica para a próxima chamada. |
| `cancel_proposal` | Cancela uma proposta pendente. |
| `editor_status` | Confere se o editor está aberto. |

As operações são as mesmas que a interface usa (`src/core/operations.ts`): `animate` (presets que viram keyframes editáveis), `setKeyframe`, `retimeGroup`, `setProperty`, `addClip`, `updateClip`, `trimClip` (aparar como nas bordas do clipe), `removeClip` etc. O editor valida alvo, parâmetros (tipos, faixas, campos desconhecidos: um campo com nome errado é recusado, não ignorado), intervalo e revisão antes de mostrar qualquer coisa. Importar mídia e mexer nas faixas ficam só na interface. E quando você renomeia o projeto, importa mídia ou muda o formato com um rascunho aberto (mesmo com “Ajustar na linha do tempo” ligado), isso vai para o projeto, nunca para a etapa do Claude.

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
- **Exportar:** gera MP4 (H.264 + AAC) com o que já foi aceito. Antes de começar, confere se todos os vídeos abrem. O MP4 é gravado num arquivo temporário na mesma pasta (`.diretor-….part`) e só substitui o destino quando fica pronto: “Cancelar” (em qualquer momento, inclusive na conferência e na finalização), fechar a janela ou o editor cair nunca deixam arquivo pela metade nem apagam um arquivo que já existia. Fechar a janela durante a exportação pede confirmação. Se o destino estiver aberto em outro programa (um player, no Windows), o editor tenta de novo por alguns segundos (“Finalizando e gravando o MP4…”) e, se continuar preso, salva o vídeo ao lado como “nome (1).mp4” e avisa, em vez de perder o vídeo pronto. Cancelar ou fechar durante essas tentativas cancela a exportação como em qualquer outro momento: o destino não muda.

## Testes

```bash
npm test            # 100 testes: unitários + MCP real (cliente MCP → servidor stdio → ponte → editor) + exportação com ffmpeg
npm run typecheck
npm run test:e2e    # abre o app Electron e roda o roteiro da especificação (no Linux sem tela: xvfb-run -a node scripts/e2e.mjs)
```

O teste de ponta a ponta (45 verificações) conecta o Claude Desktop pelo botão **Conectar** (num perfil de usuário de mentira, com outra configuração que precisa continuar intacta), importa e apara um MP4 com acento no nome, cria legenda e título, faz um cliente MCP, iniciado exatamente pelo comando que o botão gravou, pedir “subir suavemente no começo e desaparecer no fim”, ajusta a duração à mão (e desfaz/refaz dentro do rascunho), aceita a entrada, descarta a saída, testa proposta desatualizada, chamada repetida e conflito de `requestId`, o Claude parando no meio de uma espera, desfaz/refaz, salva/reabre e exporta. Depois compara prévia × MP4 em 10 quadros (PSNR > 30 dB) e confere, pelo contador do vídeo de teste, que os dois mostram o quadro exato do original. Também testa vídeo ausente, cancelar a exportação no meio, na conferência e no último quadro (sem apagar o arquivo que já existia nem deixar ffmpeg rodando), exportar com nome longo e acentuado, exportar por cima de um arquivo aberto em outro programa e cancelar enquanto o editor espera ele soltar (no Windows, preso de verdade por outro processo; no Linux, um arquivo imutável), a interface caindo no meio da exportação, e na interface: campo numérico ao trocar de clipe, arrasto da borda do vídeo, lixeira com ponto selecionado e o painel do modo econômico. Capturas e o MP4 ficam em `.test-output/`.

O GitHub Actions roda tudo isso no Windows em cada PR e na `main` (`.github/workflows/ci.yml`) e guarda as capturas e o MP4 como artefato. Depois gera o instalador, instala do jeito que um usuário instalaria e roda o mesmo roteiro no app instalado (`DIRETOR_APP=<Diretor.exe> node scripts/e2e.mjs`, 47 verificações: também confere que o ffmpeg e o servidor do Claude usados são os que vêm dentro dele). Na `main`, só então publica o instalador no link fixo.

### Roteiro para testar no seu computador

Veja [docs/ROTEIRO-DE-TESTE.md](docs/ROTEIRO-DE-TESTE.md).

## Estrutura

```
src/core/       modelo, operações, sessão (rascunhos, histórico), API do MCP, compositor, exportação
src/main/       processo principal do Electron: janela, arquivos, ffmpeg, ponte local
src/main/claudeDesktop.ts  botão "Conectar": grava o servidor no claude_desktop_config.json
src/preload/    ponte segura entre a interface e o processo principal
src/renderer/   interface (React)
src/mcp/        servidor MCP stdio para o Claude Desktop
tests/          testes automáticos (vitest)
scripts/        build, e2e, configuração do MCP, ícone
build/          ícone e recursos do instalador (electron-builder)
docs/           plano, roteiro de teste e capturas
```
