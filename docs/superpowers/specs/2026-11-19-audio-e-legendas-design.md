# Áudio e legendas no Diretor (bloco 1) — design

- **Estado:** proposta, esperando a aprovação do usuário.
- **Data:** 19/11/2026, sobre o Diretor 0.1.24 (`main` em 470a840).
- **Pesquisa de apoio:** `docs/pesquisa/bloco-1/` (em inglês). No fim de cada arquivo há uma checagem independente; onde ela corrige o texto, vale a correção. Este design já resolve os conflitos entre as pesquisas (seção "Correções e conflitos resolvidos").

A Parte 1 é o que o usuário aprova, em linguagem simples. A Parte 2 é para quem vai construir.

---

## Parte 1 — O plano, sem jargão

### O que foi pedido

- Tudo nesta mesma tela, sem trocar de modo como no DaVinci Resolve (Fusion, Fairlight, Color).
- Uma boa edição de áudio: editar o volume, cortar o áudio e tirar as partes em que a pessoa respira ("isso é muito importante").
- Legendas automáticas "de tal ponto até tal ponto", com a fonte e a cor que o usuário quiser, e o contraste da letra ajustável (por exemplo, letra amarela com contorno preto).
- Cor, transições, seguir um objeto e máscaras ficam para os próximos blocos: primeiro cor e transições, depois rastreamento e máscaras.

### O que vai dar para fazer

1. **Cortar no meio do clipe e apagar um trecho.** Ctrl+B (ou o botão Dividir) corta onde está a agulha. Para apagar, marca-se o trecho na régua da linha do tempo e aperta-se Shift+Delete: o buraco fecha sozinho, e legendas e títulos andam junto, sem perder a sincronia.
2. **Legendas com o visual que quiser.** Fonte (umas 10 fontes grátis já vêm no Diretor, e as fontes instaladas no PC também aparecem), cor do texto, cor e grossura do contorno, sombra, caixa atrás, tamanho, posição e MAIÚSCULAS. Estilos prontos para começar: Amarelo com borda, Karaokê (a palavra falada acende), Palavra em destaque, Branco com caixa, Impacto e Clássico. Mudar o estilo muda todas as legendas, a não ser que se peça só uma.
3. **Som igual na prévia e no vídeo final.** Um motor de áudio novo toca a prévia e monta a exportação do mesmo jeito. Cortes não dão estalo, e a faixa Áudio mostra a forma de onda, que ajuda a cortar nos silêncios.
4. **Legendas automáticas.** Marca-se o trecho (ou nada, para o vídeo todo) e clica-se em Gerar legendas, ou pede-se ao Claude ("legenda de 0:10 até 0:45"). O Diretor escuta a fala no próprio PC, sem mandar o áudio para a internet, e entrega as legendas como rascunho para aceitar ou descartar. Na primeira vez, pede licença para baixar o reconhecimento de fala (uns 575 MB, uma vez só).
5. **Tirar as respirações.** O botão Limpar fala acha as respirações e pausas e marca cada uma na faixa Áudio. O usuário confere, desmarca o que quiser manter e aplica. O padrão é cortar essas pausas, o que deixa o vídeo mais curto e dinâmico; na entrega 7 entra a opção de só abaixar o som da respiração, sem cortar. Tudo vira um rascunho, e um Ctrl+Z desfaz.
6. **Volume de verdade.** Volume em dB, até +12 dB (mais alto que o original), com pontos de animação, entrada e saída suaves (fade) e a opção de abaixar ou silenciar só um trecho, sem cortar a imagem.
7. **Corrigir palavras.** Uma aba Transcrição mostra o texto falado, destaca as palavras em que o reconhecimento ficou em dúvida e deixa corrigir com um clique.

O Claude (e o Codex) conseguem fazer tudo isso a pedido, sempre como rascunho.

### Como fica na tela

Nada de tela nova: entram botões na barra da linha do tempo, um bloco "Áudio" e um bloco "Legenda" em Propriedades, uma aba Transcrição ao lado de Mídia e uma janelinha para Gerar legendas.

```
+-------------------------------------------------------------------------------------------+
| Diretor   Abrir  Salvar                                                  [Exportar MP4]   |
+------------------------------+-----------------------------------------+------------------+
| Mídia | Propriedades | Transcrição | Prévia               [Antes|Depois] | Claude | Codex   |
| Legenda selecionada          |   +---------------------------------+   | Rascunho:        |
|  Estilo  [Amarelo com borda] |   |                                 |   |  Limpar fala     |
|  Fonte   Montserrat Black    |   |       NÃO VAI ACREDITAR         |   |  37 pausas       |
|  Cor ■   Contorno ■  ─o───   |   +---------------------------------+   |  vídeo −0:31     |
|  Sombra  Caixa  MAIÚSCULAS   |    > 0:12 / 3:10                        | [Aceitar][Descartar]
+------------------------------+-----------------------------------------+------------------+
| ↶ ↷ | Dividir | Apagar trecho | Legenda | Título | Gerar legendas | Limpar fala |  zoom ─o─ |
| 0s        5s   [====== trecho marcado ======]   10s            15s                         |
| Legendas | [NÃO VAI][ACREDITAR][NISSO]                                                     |
| Texto    |     [Título.........]                                                          |
| Vídeo    | [clipe A.......]|[clipe B....]|(−0:04)|[clipe C.............]                    |
| Áudio    | /\/\/\_(resp)_/\/\/\ [==abaixado==] /\/\ [pausa 1,2 s] /\/\/\                     |
+-------------------------------------------------------------------------------------------+
```

### Ordem das entregas

Cada item chega numa atualização automática do Diretor. O usuário testa e pede ajustes.

1. Cortar no meio e apagar trecho.
2. Visual das legendas: contorno, fontes, cores e estilos prontos.
3. Forma de onda na faixa Áudio.
4. Legendas automáticas.
5. Motor de áudio novo: prévia igual ao vídeo final e cortes sem estalo.
6. Tirar as respirações (cortando as pausas).
7. Volume em dB, entrada e saída suaves e abaixar ou silenciar trecho, incluindo "só abaixar a respiração".
8. Aba Transcrição para corrigir palavras.

Se o usuário preferir tirar as respirações antes das legendas automáticas, as entregas 5 e 6 podem vir antes da 4 (a 6 depende da 5).

### Decisões tomadas pelo Claude (o usuário pode mudar qualquer uma)

- **Tipo de vídeo:** o plano supõe vídeo em pé para Reels, TikTok e Shorts, porque o usuário ainda não respondeu. O formato do projeto já segue o primeiro vídeo importado, e os estilos de legenda se ajustam sozinhos ao formato.
- **Estilo padrão das legendas:** Amarelo com borda, o exemplo do próprio usuário, com até 3 palavras por vez.
- **Respirações:** o padrão é cortar as pausas, no ritmo "Dinâmico". Só abaixar o som é a alternativa.
- **Reconhecimento de fala:** o mais preciso para português que roda no PC, com download único de 575 MB. Um mais rápido e menos preciso pode vir depois, se ficar lento no computador do usuário.
- **Gerar legendas num trecho que já tem legendas** troca as antigas pelas novas. Como é rascunho, dá para descartar.
- **Aparar um vídeo** passa a funcionar como apagar aquele pedaço: as legendas e os títulos em cima da parte aparada saem junto, e os que vêm depois andam junto. Hoje só os vídeos andam, e as legendas perdem a sincronia.
- **Títulos** também ganham contorno e as fontes novas.
- **Cópia do áudio:** o Diretor guarda uma cópia do áudio de cada vídeo para trabalhar rápido (uns 700 MB por hora de vídeo) e apaga as mais antigas sozinho, nunca as do projeto aberto.

### Fica para depois

- Faixas de áudio separadas (música de fundo, narração).
- Melhorar a voz (tirar ruído) e deixar o volume do vídeo todo no padrão das redes.
- Arquivo de legenda separado (SRT) para subir no YouTube.
- Emojis e palavras-chave escolhidos pela IA nas legendas; animações palavra por palavra (pular, deslizar).
- Zoom alternado nos cortes (entra com as transições, no bloco 2).
- Cor e transições (bloco 2); seguir objeto e máscaras (bloco 3).

### Limites que o usuário vai notar

- As legendas automáticas precisam baixar 575 MB na primeira vez.
- Transcrever leva tempo. A estimativa inicial é de um minuto de espera por minuto de fala num notebook comum, e mais num computador fraco; a medição de verdade vem na entrega 4.
- O reconhecimento erra algumas palavras, principalmente nomes. Elas aparecem destacadas para conferir.
- A palavra que acende no Karaokê pode adiantar ou atrasar um pouco (por volta de 0,1 s).
- A detecção de respiração também erra às vezes. Por isso tudo passa pela revisão antes de aplicar.
- Emojis seguem o desenho do Windows instalado.

---

## Parte 2 — Design técnico

### Intenção

O usuário faz vídeos falados (supostamente verticais, para Reels, TikTok e Shorts) e quer resolver no Diretor o que hoje exige CapCut ou DaVinci: cortar e limpar a fala, legendar automaticamente com estilo forte e acertar o som, numa tela só, com a IA ajudando por rascunhos. Dá certo quando ele importa um vídeo falado, gera as legendas no estilo dele, tira as respirações e exporta sem sair da tela principal, e o MP4 sai igual à prévia.

### Metas

- **G1** Dividir clipes e apagar trechos com ripple em todas as faixas.
- **G2** Estilo completo de legenda: contorno, fontes embutidas e instaladas, cores, sombra, caixa, posição, maiúsculas e destaque da palavra falada. Títulos ganham contorno e fontes.
- **G3** Áudio da prévia idêntico ao da exportação (o mesmo mixer), cortes sem estalo e centenas de cortes sem quebrar a exportação.
- **G4** Legendas automáticas locais em pt-BR, com tempo por palavra, num trecho escolhido, entregues como rascunho.
- **G5** Detectar respirações e pausas, revisar e cortar (padrão) ou abaixar.
- **G6** Volume em dB (−60 a +12) com keyframes, fades, trechos abaixados ou silenciados e mudo por faixa.
- **G7** Corrigir palavras da transcrição.
- **G8** Tudo disponível para o Claude e o Codex pelas mesmas operações do MCP, com rascunho, aceite e desfazer.

### Fora do bloco 1

Faixas de áudio separadas e `linkId`; "Melhorar voz" (afftdn/arnndn); normalização de loudness; SRT/VTT; emoji e palavras-chave automáticos; animações por palavra (bounce, slideUp, reveal) e `regroupCaptions`; contorno vazado; motor rápido (Parakeet via sherpa-onnx); dicionário de nomes no reconhecimento; zoom alternado nos cortes; cor, transições, rastreamento e máscaras.

### Anti-metas (falha mesmo que "funcione")

- Uma tela ou um modo separado para áudio ou legendas.
- Prévia diferente da exportação em som, legenda ou tempo.
- Mídia ou áudio saindo do PC, ou qualquer API paga.
- Mudança destrutiva sem rascunho, por exemplo cortes de respiração aplicados sem revisão.
- Projeto antigo perdendo dados ao abrir ou salvar, ou uma versão antiga do Diretor apagando campos novos.
- Linha do tempo travando com centenas de pedaços.
- Instalador que não roda num Windows limpo por falta de DLL.

### Restrições

As restrições do código atual estão em `docs/pesquisa/bloco-1/mapa-do-codigo.md` ("Constraints"). As que mais pesam:

- **WYSIWYG:** imagem e som passam por um caminho só, no `src/core`. Nada de efeito só na prévia ou só no ffmpeg.
- **A sessão vive no renderer**, e as chamadas MCP expiram em 15 s (main) e 20 s (servidor). Decodificar, detectar, transcrever e baixar são jobs assíncronos no main, com progresso e cancelar; nenhuma ponte espera por eles.
- **Histórico** guarda o projeto inteiro antes e depois (200 entradas), e cada rascunho é um clone. Dados volumosos (PCM, picos, segmentos de fala, transcrições inteiras, marcas) ficam em cache fora do projeto.
- **`parseProject`** só aceita a versão 1 e joga fora campos desconhecidos. Todo campo novo exige subir a versão, migrar e recusar arquivos mais novos.
- **Operações** são validadas com listas fechadas de chaves (OP_KEYS, CHANGE_KEYS, STYLE_KEYS, CLIP_SPEC_KEYS). Campo novo precisa entrar nelas, nas mensagens em pt-BR, no describeOp, no OPS_HELP, no compactClip e nos testes.
- **Windows:** linha de comando de no máximo 32.767 caracteres; o whisper-cli lê argv em ANSI; DLLs de runtime precisam estar ao lado do executável.
- **Empacotamento:** só `dist/**` e o ffmpeg-static, sem addons nativos (`npmRebuild: false`). Executáveis novos entram por `extraResources`, com conferência no after-pack e download fixado por SHA-256 no CI. Modelos grandes são baixados no PC do usuário.
- **Segurança:** sandbox, contextIsolation, preload explícito, CSP `script-src 'self'` (sem blob). O `media://` ignora o host hoje; um host novo tem de ficar preso à sua pasta.
- **E2E** roda o Electron com xvfb e `--disable-gpu`, ffmpeg de verdade e CLIs falsas escolhidas por variável de ambiente. Ferramentas novas seguem o mesmo padrão.
- **Texto para o usuário** em pt-BR, sem jargão.

### Abordagens consideradas

1. **Um motor só (escolhida).** Um mixer em TypeScript puro no `src/core` faz o som da prévia (Worker → AudioWorklet) e o da exportação (no main, para um arquivo temporário que vira a única entrada de áudio do ffmpeg). As legendas são desenhadas pelo mesmo compositor Canvas 2D que já faz prévia e exportação. A fala é reconhecida pelo whisper.cpp rodando no PC. Custa mais no começo (entregas 3 e 5), mas cada recurso de áudio é escrito uma vez só e soa igual nos dois lados.
2. **Remendar o que existe.** O som da prévia continuaria saindo dos elementos `<video>` e o da exportação de filtros do ffmpeg. Os primeiros recursos chegariam antes, mas: o volume da prévia não passa de 100% (`HTMLMediaElement.volume` vai de 0 a 1), cada recurso de áudio teria duas implementações que soam diferente, e os cortes ficam frágeis (estalos, sincronia). Aproveitamos só a parte boa: na entrega 1 a exportação passa a abrir cada mídia uma vez com `asplit/atrim/concat` num `-filter_complex_script`, o que já resolve o limite da linha de comando e o estalo nos cortes enquanto o motor novo não chega.
3. **Serviços prontos na nuvem** (transcrição e limpeza de áudio por API). Descartada: manda a mídia para fora do PC e custa dinheiro, o que o usuário não quer.

Para as legendas também foram descartados ASS/libass (dois renderizadores diferentes na prévia e na exportação) e texto em DOM na prévia (o mesmo problema). Detalhes em `legendas.md`, "Options".

### Decisões técnicas

#### D1. Modelo e versões do projeto

- `parseProject` ganha uma cadeia `migrate(v → v+1)`. Aceita da versão 1 até a atual. Arquivo mais novo é recusado com "Este projeto foi salvo por uma versão mais nova do Diretor. Atualize o Diretor para abrir."
- **v2 (entrega 2):** legendas com `CaptionStyle` em unidades relativas, `CaptionClip.words?` e `preset` com os ids novos; títulos com `stroke`.
- **v3 (entrega 7):** volume em dB como propriedade, `fadeIn`, `fadeOut`, `ducks` e `Track.muted`.
- Cada migração tem teste de ida (v1 → atual) e de recusa (atual + 1).

#### D2. Dividir e apagar trecho (entrega 1)

- **Primitivas:** `splitClip {clipId, at, newId?}`, `shiftClips {clipIds, delta}` e `cutTextTime {clipId, t0, t1}`. A última encurta um título ou legenda que atravessa o trecho apagado e leva junto as palavras e os keyframes.
- **Macro:** `removeRanges {ranges}`, com até 500 trechos em segundos da linha do tempo atual. Os trechos são ordenados e unidos, e a macro age da direita para a esquerda em todas as faixas destravadas: remove os clipes de dentro, divide os que atravessam e desloca os seguintes. Uma faixa travada que mudaria gera o erro `locked`. Faixas ocultas também andam.
- **Keyframes** são repartidos com o valor da borda (`partitionKeyframes`, exportando os auxiliares privados de `operations.ts`).
- **Aparar um vídeo com ripple** passa a valer como `removeRanges` do pedaço aparado em todas as faixas: texto sobre a parte aparada é cortado ou removido, e os clipes seguintes de todas as faixas andam junto. Hoje só os vídeos seguintes andam, e as legendas perdem a sincronia (decisão do Claude, ver Parte 1).
- **Tempo:** continua arredondado a 1 ms (`round()`). O Ctrl+B manual cai no quadro mais próximo. Cortes automáticos (respirações) mantêm a precisão de 1 ms: o vídeo mostra o quadro mais próximo e o áudio corta no ponto exato.
- **Pedaços contíguos** (mesma mídia, `in` de um igual ao fim do outro) são reconhecidos com tolerância de 1 amostra a 48 kHz. Assim o arredondamento em ms nunca cria um estalo onde não há corte de verdade.
- **VideoPool por mídia** (`video.ts`): 2 ou 3 elementos por arquivo, o mesmo elemento entre pedaços contíguos, pré-busca uns 0,5 s antes de cada emenda, último quadro bom mantido durante a troca. O preflight da exportação passa a contar mídias, não clipes.
- **Exportação provisória** (até a entrega 5): uma entrada `-i` por mídia; `asplit` + `atrim` + `concat` para pedaços em sequência e `amix` só entre fontes que se sobrepõem, num `-filter_complex_script` temporário apagado como o `.part`. Na checagem isso foi bit a bit exato numa divisão e mantém a linha de comando curta (a flag existe no ffmpeg 6.1.1 do Windows; no 7.1+ virou `-/filter_complex`).
- **Linha do tempo:** trecho na régua (Shift+arrastar, ou I e O); Dividir (Ctrl+B) e Apagar trecho (Shift+Delete, conferido antes do Delete comum); emendas com chip "−0:04" nos rascunhos; `ClipBlock` com `React.memo`; agulha num assinante separado; `draftInfo` memorizado pela chave da view.
- **Prévia:** botão Antes/Depois enquanto há um rascunho com ripple aberto.

#### D3. Cache de áudio e forma de onda (entrega 3)

- **Ingestão** é um job no main, disparado ao importar e ao abrir um projeto sem cache. O ffmpeg decodifica para 48 kHz, estéreo, s16, com 3 dB de folga (ganho −3 dB, anotado em `meta.json` e compensado pelo mixer, porque o AAC decodificado passa de 1,0 e o s16 cortaria). O cache fica em `userData/audio-cache/<srcKey>/`: `base.s16`, picos min/máx a cada 128 amostras, um nível grosso e `meta.json`. `srcKey` = hash de caminho, tamanho, mtime e versão da ingestão.
- **Mídia sem áudio:** é conferida antes (probe ou `-map 0:a:0?`) e não ingere.
- **LRU** com limite (o construtor escolhe o padrão; a pesquisa sugere 10 GB), nunca tirando mídia do projeto aberto. Custa uns 691 MB por hora.
- **Host `media://audio/<srcKey>/…`** preso à pasta do cache, com checagem de `..`, `application/octet-stream` e Range.
- **Forma de onda:** um canvas do tamanho da área visível na faixa Áudio (que passa a 64 px), redesenhado só ao rolar, mudar o zoom ou mudar a view.
- **Para fala e VAD:** 16 kHz mono derivado do `base.s16` quando preciso. Não existe um segundo cache de análise.

#### D4. Motor de áudio (entrega 5)

- **`src/core/audio/plan.ts`:** `compileAudioPlan(view)` é puro e devolve segmentos `{srcKey, tl0, src0, len, ganho}`. **`src/core/audio/mix.ts`:** `mixInto(plan, frame0, n, read)` acumula em Float64 e não guarda estado. Tudo segue o "Concrete plan" de `motor-de-audio.md` (itens 5 e 6), menos "Melhorar voz" e loudness.
- **Regras do plano:**
  - (a) pedaços contíguos não ganham fade, então a divisão é perfeita;
  - (b) outros cortes ganham crossfade equal-power de 10 ms usando material de fora da borda; sem esse material, 5 ms de saída e 5 ms de entrada;
  - (c) borda encostada em silêncio ganha micro-fade de 3 ms;
  - (d) soft clip no master acima de −1 dBFS.
- **Prévia:** um Worker no renderer lê PCM com `fetch` + Range no `media://audio`, mistura e manda blocos por um MessagePort para um AudioWorklet. Worker e worklet são carregados com `?worker&url` do Vite: `?url` num `.ts` entrega TypeScript cru, e Blob URL é barrado pela CSP, que não muda.
- **Relógio:** passa a ser o do AudioContext (`getOutputTimestamp` + `outputLatency`). Os `<video>` ficam mudos e seguem o relógio: busca se a diferença passar de 80 ms, ajuste de `playbackRate` entre 20 e 80 ms. O controle de volume da prévia continua sendo só monitor.
- **Exportação:** o main compila o plano a partir do projeto que já recebe em `export:start`, mistura em blocos de 1 s (cedendo com `setImmediate`) num `f32le` temporário ao lado do `.part`, e o ffmpeg recebe `-f f32le -ar 48000 -ac 2 -i <tmp>` e codifica o AAC uma vez só. Sem `utilityProcess` no bloco 1. A limpeza cobre o temporário em cancelar, fechar, travar e sair, como já acontece com o `.part`.
- **Removido na mesma entrega:** a exportação provisória de D2 e a mixagem pelos elementos.
- **Paridade:** o PCM tirado do worklet é igual bit a bit ao da exportação (mesmo V8). Comparações que passam pelo ffmpeg (AAC) usam tolerância de SNR, nunca md5.

#### D5. Volume, fades e trechos (entrega 7)

- **`volume`** vira propriedade do registro `PROPS`: dB, −60 a +12, keyframes interpolados em dB. `status` e `compactClip` passam a ler o registro em vez de `['x','y','scale','opacity']` fixo.
- **`muted`** continua no clipe. Entram `fadeIn` e `fadeOut` (em segundos, no máximo metade da duração) e `ducks: [{s, e, gainDb, fadeMs, tag}]`, guardados em **segundos da fonte**: aparar, dividir e apagar trecho não precisam remapeá-los, e as marcas de respiração (também em segundos da fonte) entram direto. `Track.muted` é o mudo da faixa.
- **Operações:** `duckRanges {ranges, gainDb, fadeMs, tag}` (idempotente por tag: trechos da mesma tag que se sobrepõem são trocados) e `clearAudioRanges {clipIds?, tag?}`. Volume se muda com `setProperty` ou `setKeyframe`. Mandar `volume` em `updateClip` dá erro explicando a mudança.
- **Migração v2 → v3:** `volume dB = 20·log10(v)`, e v = 0 vira −60 dB, que o mixer trata como silêncio.
- **Interface:** bloco "Áudio" em Propriedades (Volume em dB com botão de keyframe, Fade de entrada e saída, Mudo, lista de trechos abaixados); na faixa Áudio, alças de fade nos cantos, blocos dos trechos abaixados e uma linha de volume opcional; o botão de mudo da faixa vira o mudo de verdade; com um trecho marcado, "Abaixar" e "Silenciar".
- A opção "abaixar as respirações" de D8 entra aqui.

#### D6. Legendas: estilo, desenho e fontes (entrega 2)

- **Modelo:** `CaptionStyle` em unidades relativas (tamanho em % da altura do quadro, contorno, sombra e caixa em em, posição em %) e `CaptionClip {text, words?, style, preset}` com `words: [{t, s, e, c?, k?, br?}]` relativos ao clipe. Tudo conforme `legendas.md`, "Concrete plan" itens 1 a 5, com as correções abaixo.
- **Desenho em `render.ts`:**
  1. caixa;
  2. caixa da palavra ativa;
  3. todos os contornos, com a sombra só nesta passada;
  4. todos os preenchimentos;
  5. a palavra de cima (ativa com escala), com a própria sombra multiplicada pela escala, porque sombra de canvas ignora a transformação.
  - Contorno com `lineJoin` e `lineCap` `round` e `lineWidth` igual a 2 vezes o contorno visível.
  - Opacidade menor que 1 desenha numa camada reaproveitada, criada com o mesmo `willReadFrequently` do destino.
  - Layout em cache (LRU) pela chave de estilo, texto, tamanho do quadro e época das fontes.
- **Presets:** `amarelo` (padrão), `karaoke`, `palavraCaixa`, `caixa`, `impacto` e `classico`, com os valores de `legendas.md` §2. No vertical, nenhuma linha pode entrar na coluna de botões do TikTok à direita (x > 780 a partir de y = 840 num quadro de 1080×1920). A largura máxima e o centro padrão do retrato são ajustados para isso, e a sobreposição de áreas seguras avisa quando uma linha cruza a coluna.
- **Destaque da palavra** (cor, caixa, escala, progressivo) é desenhado desde a entrega 2, mas só aparece quando a legenda tem `words`, o que vem na entrega 4. Sem `words`, a legenda é desenhada inteira.
- **Operações:** `setCaptionStyle {clipIds: 'all' | ids, preset?, patch?}`, `setCaptionWords {clipId, words}` e `markWords {clipId, idx, k}`. `updateClip set.text` realinha `words` por LCS. `trimClip`, `splitClip`, `cutTextTime` e `removeRanges` levam as palavras junto. "Aplicar a todas as legendas" vem ligado.
- **Títulos:** `TextStyle` ganha `stroke {color, width}` em em, as fontes novas e o mesmo desenho em duas passadas. O tamanho continua em px.
- **Fontes embutidas:** WOFF2 com subconjunto latino, mais as licenças, em `src/renderer/assets/fonts/`: Montserrat, Poppins, Inter, Anton, Bebas Neue, Oswald, Archivo Black, Luckiest Guy e Bangers. TikTok Sans é opcional. Lilita One e Titan One ficam de fora, porque têm Reserved Font Name e um subconjunto conta como versão modificada. Luckiest Guy (Apache-2.0) vai com a licença e um aviso de que foi recortada. Cada `FontFace` declara a faixa de peso real (Oswald 200–700, TikTok Sans 300–900, Montserrat e Inter 100–900). Os arquivos têm de passar de 4 KiB ou usar `assetsInlineLimit: 0`, porque o Vite embute arquivos pequenos como `data:` e a CSP bloqueia.
- **Fontes do computador:** `setPermissionCheckHandler` libera `local-fonts` só para a origem do app; `queryLocalFonts()` uma vez por sessão; lista "Fontes do computador". Se um projeto usa uma fonte que não está instalada, aparece um aviso ao abrir e a prévia usa Montserrat; ao exportar, o usuário escolhe entre trocar por Montserrat ou cancelar. Testar o nome das famílias no Windows (DirectWrite) no CI do Windows.
- **Portão de fontes na exportação:** antes do primeiro quadro, `document.fonts.load` para cada família, peso e conjunto de caracteres usados. Fonte embutida exige `FontFace.status === 'loaded'`. Fonte instalada é medida contra dois genéricos diferentes (serif e monospace), porque o genérico sans-serif do Windows já é a Arial. Nunca usar `document.fonts.check()`, que diz `true` para fonte inexistente.
- **Migração v1 → v2:** mesmo visual. O `fontFamily` antigo é uma lista CSS e vira `Inter` (embutida). Os presets antigos `padrao`, `caixa` e `destaque` viram `custom` com o estilo equivalente. A diferença de poucos pixels na linha de base é aceita.
- **Testes de imagem** usam diff com tolerância, não hash exato: hashes do Linux quebram com qualquer atualização do Chromium e não representam o Windows.

#### D7. Transcrição local (entrega 4)

- **Binários:** `scripts/fetch-stt.mjs`, rodado no CI, baixa o `whisper-bin-x64.zip` da tag b5454 (whisper.cpp v1.9.5), com SHA-256 fixado (conferir de novo antes de fixar). Fica com `whisper-cli.exe`, `whisper-vad-speech-segments.exe`, `whisper.dll`, `ggml.dll`, `ggml-base.dll` e os `ggml-cpu-*.dll`, que vão por `extraResources` para `resources/stt/whisper`. O after-pack confere que estão lá.
- **DLLs de runtime:** os binários importam `msvcp140.dll`, `vcruntime140.dll`, `vcruntime140_1.dll` **e `vcomp140.dll`** (OpenMP), e foram ligados com o MSVC 14.51. Duas saídas: copiar as quatro ao lado do exe, tiradas de um redistribuível 14.51 ou mais novo (pastas CRT e OpenMP); ou compilar a b5454 com CRT estática (`/MT`) e `-DGGML_OPENMP=OFF`. Os runners do CI já têm o VC++ instalado e não pegariam a falta, então o after-pack também confere as importações dos PE: toda DLL que não é do sistema tem de estar na pasta.
- **Modelos:**
  - o VAD `ggml-silero-v6.2.0.bin` (0,86 MB) vai no instalador, para a detecção de respirações funcionar sem o download grande;
  - o de fala, `ggml-large-v3-turbo-q5_0.bin` (574 MB), é baixado no primeiro uso, depois de um cartão pedindo licença, com `net.fetch` (respeita proxy), retomada por Range de um `.part`, SHA-256 calculado durante o download, conferência de espaço livre, renomeação atômica, cancelar e uma cópia nas releases do próprio repositório como segunda URL;
  - antes de fixar, comparar q5_0, q5_k e q8_0 em acerto (WER) e velocidade, porque a evidência de "sem perda" era do Q5_K_M.
- **Pipeline de um job (main):**
  1. trecho da linha do tempo → trechos da fonte dos clipes audíveis (não mudos, volume acima de −60 dB depois da entrega 7, faixa não muda);
  2. áudio do cache D3 → 16 kHz mono;
  3. VAD → segmentos. A saída do exe é em **centésimos de segundo**, e um teste do CI fixa o formato contra o binário embutido;
  4. `speech.wav` = segmentos unidos por 0,4 s de silêncio, mais a tabela de mapeamento, em lotes de até uns 5 min de fala;
  5. `whisper-cli` com `cwd` numa pasta do job dentro de `userData/stt` e caminhos relativos ASCII. Quando algum argumento tem acento (o prompt, por exemplo), todos vão num arquivo de resposta UTF-8 com fim de linha LF, passado como único argumento (`whisper-cli.exe @args.txt`). Flags: `-l pt -nfa -dtw large.v3.turbo -ojf -sns -np -pp -t <núcleos físicos, até 8>`. Nunca `--vad` e nunca `-p` maior que 1. O prompt é uma frase curta em pt-BR com pontuação e, com `-mc 64 --carry-initial-prompt`, tem de caber em uns 63 tokens. Medir `-bs 1 -bo 1` contra o beam 5 padrão em velocidade e acerto antes de escolher;
  6. tokens com tempo DTW → palavras com confiança → de volta ao tempo da fonte pela tabela;
  7. filtros de alucinação: texto fora da fala do VAD é descartado, repetições em laço são desfeitas e frases conhecidas ("Legendas pela comunidade Amara.org" e parecidas) são barradas;
  8. a transcrição fica em cache por mídia, em tempo da fonte (`userData/stt/cache/<srcKey>/`). Editar o projeto durante um job longo não o invalida.
- **Paginação** (`src/core/captions/chunker.ts`) segue as regras de cada preset (`legendas.md` §2): quebra na pontuação e em pausas (0,35 s nos estilos curtos, 0,6 s no Clássico); nunca termina uma página em palavra de função ("a", "de", "que", "pra"…); a página dura do início da primeira palavra até 0,15 s depois da última, sem passar o começo da próxima. No Clássico, 42 caracteres por linha e 17 caracteres por segundo (o construtor pode usar 20, o limite de SDH).
- **Resultado:** um rascunho local que remove as legendas que se sobrepõem ao trecho e adiciona as novas, com `words` e o preset padrão.
- **Progresso** vem de `progress = N%` no stderr. A estimativa de tempo vem do primeiro lote, não de uma calibração curta (um clipe de 20 s ainda paga uma janela inteira de 30 s e a carga do modelo).
- **Testes:** `DIRETOR_WHISPER_CLI` e `DIRETOR_WHISPER_VAD` apontam para `scripts/stt-simulada.mjs` no Linux e no e2e, como já se faz com o ffmpeg e as CLIs da IA.

#### D8. Respirações e pausas (entrega 6; "abaixar" na 7)

- **Detecção** é um job no main com os segmentos de fala do VAD (os mesmos de D7, em cache) e o classificador DSP em TypeScript de `respiracoes.md` ("Concrete plan" itens 3 a 5), em `src/core/speech/`. Como o exe do VAD só devolve segmentos, sem probabilidade por janela, o classificador trabalha com a máscara binária: as referências de nível vêm de dentro (fala) e de fora (não fala) dos segmentos, e o refinamento das bordas usa só sinais acústicos (periodicidade e nível). Nada de onnxruntime no bloco 1.
- **Marcas** (respiração, pausa, estalo, incerto) ficam no cache (`userData/audio-cache/<srcKey>/marks.json`) e num store do renderer, nunca no `Project`. Só o resultado aplicado (cortes ou trechos abaixados) entra no projeto.
- **Revisão:**
  - pílulas (respiração) e colchetes com a duração (pausa) na faixa Áudio;
  - barra "Respiração 3 de 37  [<] [>]  Ouvir (Espaço)  Manter/Aplicar (Enter)  Sair (Esc)";
  - os atalhos globais (Espaço, Delete, setas) são interceptados enquanto a revisão está aberta;
  - itens com nota alta vêm marcados; os duvidosos vêm desmarcados.
- **Aplicar** gera um único rascunho local.
  - **Cortar (padrão):** `removeRanges` calculado das marcas no momento de preparar a etapa, passando por `sourceTime`.
    - Sobra 100 a 150 ms depois do fim da palavra anterior e 50 a 100 ms antes da próxima. Essa folga protege as vogais finais desvozeadas do pt-BR e o /s/ final.
    - A janela mantida é posta sobre quadros silenciosos.
    - Ritmo: Natural (pausa mínima 0,6 s, sobra 0,3 s), Dinâmico (0,4 s e 0,2 s; padrão) e Acelerado (0,25 s e 0,12 s).
    - Com transcrição, os tempos das palavras ajudam a achar os vãos, mas as bordas seguem a evidência acústica.
    - Nenhum corte deixa um pedaço com menos de 0,4 s.
  - **Abaixar (entrega 7):** `duckRanges` com a tag `breath`, −20 dB (Leve −12, Forte −30), rampas de 25 ms, nunca abaixo do ruído de fundo.
- **IA:**
  - `analyze_audio` inicia o job e devolve um `jobId`;
  - `get_job` espera o resultado;
  - `get_analysis('marks')` traz as marcas em páginas;
  - a macro `cleanSpeech {analysisId, modo: 'cortar' | 'abaixar', ritmo?, forca?}` é resolvida em primitivas quando a etapa é preparada: a sessão passa as marcas para o `applyOps`, e a IA nunca lista centenas de trechos.
- **Nota legal** herdada da pesquisa: a patente Dolby US10825464 cobre classificação de respiração combinada com nivelamento automático de ganho. Não há nivelamento automático junto da cadeia de respiração no bloco 1, e qualquer normalização futura fica fora dela até ser revista.

#### D9. Rascunhos locais, jobs e downloads (entrega 4, usados depois)

- **Propostas** ganham `origin: 'ai' | 'diretor'`. Rascunhos do próprio Diretor (legendas, limpar fala) aparecem no painel direito com a origem "Diretor" e têm "Refazer" local, sem passar pelo `chat.ownerOf`. Se já há uma proposta da IA aberta, o Diretor pergunta se troca.
- **Gerenciador de jobs** no main: iniciar, progresso, cancelar e resultado; deduplicação por chave; aborto em `did-start-loading`, `render-process-gone`, `closed` e `will-quit`, como `abortAllExports`; pastas temporárias limpas.
- **Gerenciador de download** dos modelos, como em D7.
- **Histórico:** palavras e muitos pedaços engordam os snapshots. Trocar o limite fixo de 200 entradas por um orçamento de memória (o construtor escolhe o número).

#### D10. IA (MCP) e modo econômico

- **Ferramentas novas:**
  - `generate_captions {t0?, t1?, preset?}` → `jobId`;
  - `analyze_audio {t0?, t1?}` → `jobId`;
  - `get_job {jobId, wait ≤ 45}`, com a mesma exceção de espera longa do `get_proposal` em `bridgeTimeoutMs` e `callTimeoutMs`;
  - `get_analysis {kind: 'transcript' | 'marks', cursor?}`.
  - A lista exata de ferramentas em `tests/mcp.test.ts` muda junto. As descrições são curtas; a ajuda longa fica no `editor_status` e no OPS_HELP.
- **Operações novas no OPS_HELP (pt-BR):** splitClip, removeRanges, setCaptionStyle, setCaptionWords, markWords, duckRanges, clearAudioRanges e cleanSpeech; volume em dB como propriedade. `assistant.ts INSTRUCTIONS` muda junto.
- **get_context:**
  - legenda como `{id, kind, start, dur, text, preset}` mais `custom: 1` quando o estilo difere do preset;
  - `words` só com `include: ['words']` ou para clipes selecionados;
  - pedaços contíguos da mesma mídia resumidos;
  - trechos abaixados em resumo.
  - O teto de 6 KB continua valendo só com o modo econômico ligado.

#### D11. Interface numa tela só

Segue o esboço da Parte 1 e "One screen" de `mapa-do-codigo.md`:

- **Sem faixas novas:** forma de onda, fades, trechos abaixados e marcas dividem a faixa Áudio.
- **Barra da linha do tempo:** Dividir, Apagar trecho, Gerar legendas e Limpar fala.
- **Gerar legendas** abre uma janela no estilo da de exportar: trecho, estilo, idioma e o cartão de download no primeiro uso. O progresso aparece como uma faixa dentro da linha Legendas, com Cancelar. O resultado chega como cartão de rascunho no painel direito.
- **Propriedades:**
  - de uma legenda: galeria de estilos com miniaturas desenhadas pelo próprio `drawCaption`, mais Fonte, Tamanho, Cor, Contorno, Sombra, Caixa, MAIÚSCULAS, Espaçamento, Posição (Centro, Abaixo do centro, Embaixo, e arrastar na prévia), Destaque da palavra e Animação de entrada (nenhuma, surgir ou pop);
  - de um vídeo: o bloco Áudio.
- **Prévia:** botão "Áreas do TikTok/Reels/Shorts", só uma sobreposição na tela, nunca exportada. A área do Shorts vem do modelo oficial de anúncio vertical do Google e é marcada como aproximada.
- **Aba Transcrição** (entrega 8): palavras em chips; as de baixa confiança sublinhadas; clique leva até a palavra; duplo clique edita; Tab vai para a próxima duvidosa; "Substituir em tudo".

#### D12. Empacotamento e testes

- **CI:** passo de download dos binários de fala antes do `test:e2e` e do `dist`; `vendor/` no `.gitignore`.
- **after-pack:** confere os arquivos e as importações dos PE.
- **"Sobre > Licenças":** whisper.cpp (MIT), Whisper (MIT), Silero VAD (MIT), e o texto completo da OFL 1.1 e da Apache 2.0 com o copyright de cada fonte.
- **Testes por entrega:** unitários (vitest) e e2e (Electron com xvfb no Linux e o app instalado no CI do Windows), com binários falsos por variável de ambiente. Os testes de aceite estão na tabela de entregas.

### Entregas

Cada entrega é um PR, mesclado quando o CI do Windows passa (autorização do usuário no projeto), e publicado como atualização automática.

| # | Entrega | Pesquisa (fatia) | Depende de | Aceite (além dos testes unitários) |
|---|---|---|---|---|
| E1 | Dividir e apagar trecho | S1 | — | Ctrl+B divide; Shift+Delete apaga o trecho em todas as faixas e as legendas continuam sincronizadas; a reprodução passa pelas emendas sem tela preta; exportar 300 pedaços funciona no Windows; uma divisão sem corte sai perfeita no áudio exportado. |
| E2 | Visual das legendas | S2 + `legendas.md` | — | Os 6 presets saem iguais na prévia e no MP4 (diff com tolerância); contorno ajustável; fontes embutidas e do computador; arrastar a posição; projeto v1 abre com o mesmo visual; arquivo v3 é recusado. |
| E3 | Forma de onda | S3 | — | Forma de onda aparece depois de importar, com progresso; o LRU respeita o projeto aberto; `media://audio` recusa caminhos fora do cache. |
| E4 | Legendas automáticas | S5a | E2, E3 (E1 para as palavras seguirem divisões) | Licença e download com retomada e cancelar; transcrever um trecho; rascunho com palavras; Karaokê acende a palavra certa; o Claude dispara pelo MCP; cancelar no meio não deixa processo nem arquivo; o `whisper-cli.exe` abre num Windows sem VC++ (conferência de importações). |
| E5 | Motor de áudio | S4a | E1, E3 | PCM do worklet igual ao da exportação; sem estalo nas emendas; exportação com 600 pedaços no Windows; a prévia não deriva em 10 minutos de reprodução. |
| E6 | Tirar as respirações | S6a/S6b (detecção, revisão e corte) | E1, E4 (VAD, jobs, rascunhos locais), E5 | Marcas na faixa; revisão completa; rascunho de corte com as folgas; um Ctrl+Z desfaz; legendas andam junto; resumo do tempo economizado. |
| E7 | Volume, fades e trechos | S4b + "abaixar" de S6a | E5, E6 | +12 dB audível na prévia e no MP4; fades; abaixar e silenciar trecho; abaixar respirações; migração v2 → v3. |
| E8 | Transcrição | S5b | E4 | Chips, sublinhado das duvidosas, clique leva à palavra, editar, Substituir em tudo; o Claude corrige pelo `get_analysis`. |

### Riscos

- **DLLs no Windows limpo** (D7): é o que mais quebra na primeira instalação. Mitigação: conferência de importações e um teste manual numa máquina sem VC++.
- **Velocidade da transcrição** em CPU fraca: beam 5 e `-nfa` não foram medidos juntos. Mitigação: medir na E4, mostrar a estimativa, e o motor rápido fica como plano B.
- **Antivírus** pode barrar um `whisper-cli.exe` sem assinatura, como pode barrar o próprio Diretor hoje.
- **Relógio da prévia** com vídeo escravo do áudio: emendas e deriva. Mitigação: o pool por mídia com pré-busca vem antes (E1), e há métricas de deriva no e2e.
- **Falsos positivos de respiração** em pt-BR. Mitigação: folgas, revisão obrigatória e itens duvidosos desmarcados.
- **Disco:** cerca de 700 MB por hora de cache de áudio. Mitigação: LRU.
- **Fontes:** a prévia na GPU e a exportação na CPU podem diferir em subpixel. Mitigação: layout puro e testes com tolerância.
- **Áreas seguras** são medições de terceiros e mudam quando as plataformas mudam.
- **Hugging Face fora do ar.** Mitigação: segunda URL nas releases do repositório.

### Deixado para quem constrói

- Detalhes visuais seguindo o tema atual, ícones e a disposição exata dos controles.
- Limiares do classificador de respiração dentro das folgas acima, ajustados com fixtures sintéticas e gravações rotuladas.
- Limite do LRU e orçamento de memória do histórico.
- Beam, quantização e texto do prompt, depois de medir.
- Como entregar as DLLs: cópia de um redistribuível 14.51 ou mais novo, ou compilação estática.
- 17 ou 20 caracteres por segundo no Clássico.
- O texto exato das mensagens, em pt-BR e sem jargão.

### Correções e conflitos resolvidos

As pesquisas foram feitas em paralelo e às vezes se contradizem. Este design decide assim:

- **Um cache de áudio só** (48 kHz s16 estéreo com 3 dB de folga); 16 kHz mono derivado para VAD e fala. Nada de cache de análise separado nem de extração por job do arquivo original.
- **Trechos em segundos da fonte** `{s, e, gainDb, fadeMs, tag}`, não relativos ao clipe.
- **Nomes de operação:** `splitClip`, `removeRanges`, `duckRanges`, `clearAudioRanges` e `cleanSpeech` (não `removeRange`, `setGainRegions` nem `get_audio_analysis`).
- **Ferramentas MCP** seguem um padrão só de job: `jobId` + `get_job` + `get_analysis` paginado.
- **VAD:** o exe do whisper.cpp para fala e respirações. Nem onnxruntime-node nem sherpa-onnx no bloco 1, o que evita DLLs duplicadas, o runtime VC++ do onnxruntime e o download na instalação.
- **Exportação de áudio:** mixer no main, sem `utilityProcess`, com um temporário `f32le` como entrada única do ffmpeg.
- **Respirações:** só no motor novo. Nada de envelope por GainNode na prévia nem expressões `volume=eval=frame` no ffmpeg.
- **Marcas fora do `Project`** (cache), não em `project.audioMarks`.
- **Correções da checagem já aplicadas acima:**
  - `vcomp140.dll` e redistribuível 14.51 ou mais novo;
  - arquivo de resposta UTF-8 para argumentos com acento;
  - teto de uns 63 tokens no prompt;
  - VAD em centésimos;
  - Vite `?worker&url` para o worklet, sem Blob URL;
  - folga no s16;
  - tolerância de 1 amostra na contiguidade;
  - testes de imagem e de áudio do ffmpeg com tolerância;
  - Lilita One e Titan One fora, aviso de modificação na Luckiest Guy, faixas de peso reais;
  - portão de fontes com dois genéricos;
  - sombra da palavra de cima escalada;
  - camada com o mesmo `willReadFrequently`;
  - coluna de botões do TikTok;
  - área do Shorts do modelo oficial;
  - `-map 0:a:0?` para mídia sem áudio;
  - folgas para vogais desvozeadas.
- **Sem limite de 75 players:** o limite por quadro voltou a 1000 em 2021. O que pesa é decodificador e memória, e o pool por mídia continua certo.
