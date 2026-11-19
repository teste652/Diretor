# Áudio e legendas no Diretor (bloco 1) — design

- **Estado:** proposta, esperando a aprovação do usuário.
- **Data:** 19/11/2026, sobre o Diretor 0.1.24 (`main` em 470a840).
- **Checagem de quem constrói:** feita em 19/11/2026. As respostas entraram no texto (respirações com cortar e abaixar na entrega 6, ordem, correções de palavras, áreas do TikTok e medição de velocidade); as perguntas que só o usuário responde estão marcadas como suposições em "Decisões tomadas pelo Claude".
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
5. **Tirar as respirações.** O botão Limpar fala acha as respirações e as pausas e marca cada uma na faixa Áudio. O usuário confere, desmarca o que quiser manter e aplica. O padrão é cortar as pausas: o vídeo fica mais curto e dinâmico, e a imagem dá um pulinho em cada corte. A respiração que fica numa pausa curta demais para cortar é abaixada até quase sumir. Também dá para escolher só abaixar o som das respirações, sem cortar nada, e o vídeo fica do mesmo tamanho. Tudo vira um rascunho, e um Ctrl+Z desfaz.
6. **Volume de verdade.** Volume em dB, até +12 dB (mais alto que o original), com pontos de animação, entrada e saída suaves (fade) e a opção de abaixar ou silenciar só um trecho, sem cortar a imagem.
7. **Corrigir palavras.** Uma aba Transcrição mostra o texto das legendas, palavra por palavra, destaca as palavras em que o reconhecimento ficou em dúvida e deixa corrigir com um clique. A correção continua valendo quando o usuário gera as legendas de novo ou troca o estilo.

O Claude (e o Codex) conseguem fazer tudo isso a pedido, sempre como rascunho.

### Como fica na tela

Nada de tela nova: entram botões na barra da linha do tempo, um bloco "Áudio" e um bloco "Legenda" em Propriedades, uma aba Transcrição ao lado de Mídia e uma janelinha para Gerar legendas.

```
+-------------------------------------------------------------------------------------------+
| Diretor   Abrir  Salvar                                                  [Exportar MP4]   |
+------------------------------+-----------------------------------------+------------------+
| Mídia | Propriedades | Transcrição | Prévia               [Antes|Depois] | Claude | Codex   |
| Legenda selecionada          |   +---------------------------------+   | Limpar fala      |
|  Estilo  [Amarelo com borda] |   |                                 |   |  21 respirações  |
|  Fonte   Montserrat Black    |   |       NÃO VAI ACREDITAR         |   |  16 pausas       |
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
6. Tirar as respirações: cortar as pausas ou só abaixar o som da respiração.
7. Volume em dB, entrada e saída suaves e abaixar ou silenciar um trecho.
8. Aba Transcrição para corrigir palavras.

Outra ordem possível, se o usuário preferir as respirações antes das legendas automáticas: 1, 2, 3, 5, 6, 4, 7, 8. Aí as respirações chegam na 5ª atualização em vez da 6ª, e as legendas automáticas na 6ª em vez da 4ª, porque tirar respirações precisa do motor de áudio novo (5) e as legendas automáticas não. A entrega das respirações fica maior, porque leva junto peças que hoje chegam com as legendas automáticas, mas continua sem o download de 575 MB.

### Decisões tomadas pelo Claude (o usuário pode mudar qualquer uma)

- **Tipo de vídeo:** o plano supõe vídeo em pé para Reels, TikTok e Shorts, porque o usuário ainda não respondeu. O formato do projeto já segue o primeiro vídeo importado, e os estilos de legenda se ajustam sozinhos ao formato. No vídeo em pé, as legendas ficam um pouco mais estreitas para não passar por baixo dos botões do TikTok; se o usuário não publica no TikTok, essa margem sai.
- **Estilo padrão das legendas:** Amarelo com borda, o exemplo do próprio usuário, com até 3 palavras por vez.
- **Respirações:** o padrão é cortar as pausas, no ritmo "Dinâmico", porque o pedido foi "tirar as partes que a pessoa respira". Cortar deixa o vídeo mais curto, mas a imagem pula em cada corte (o zoom que disfarça isso vem no bloco 2). A respiração que não dá para cortar fica bem baixinha. A alternativa é só abaixar o som das respirações: o vídeo fica do mesmo tamanho e a imagem não pula. O ritmo "Acelerado" corta mais. As pausas e as respirações mais claras já vêm marcadas; as duvidosas vêm desmarcadas.
- **Ordem:** as legendas automáticas (entrega 4) vêm antes das respirações (entrega 6). Elas não precisam do motor de áudio novo, então chegam duas atualizações mais cedo, e as peças que as duas usam (o programa de fala no Windows, as tarefas com barra de progresso e os rascunhos do próprio Diretor) são testadas antes nas legendas, onde um defeito atrapalha menos. A outra ordem adianta as respirações em uma atualização (ver "Ordem das entregas").
- **Reconhecimento de fala:** o mais preciso para português que roda no PC, com download único de 575 MB. A entrega 4 mostra quanto tempo levou no computador do usuário; se ficar lento, entra a opção "Mais rápido": um reconhecimento menor, do mesmo programa, com uns 260 MB a mais para baixar, que erra mais palavras.
- **Gerar legendas num trecho que já tem legendas** refaz as legendas desse trecho no estilo escolhido, aproveitando o texto que já está nelas, com as correções; só as partes sem legenda são escutadas. Assim, para passar de Amarelo (até 3 palavras) para Clássico (duas linhas), basta gerar de novo com o Clássico, sem esperar nova transcrição. Para escutar um trecho do zero, o usuário apaga antes as legendas dele. Como é rascunho, dá para descartar.
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
- Transcrever leva tempo: de menos de um minuto a uns três minutos de espera por minuto de fala, conforme o computador. A entrega 4 mede no PC do usuário e mostra o tempo.
- O reconhecimento erra algumas palavras, principalmente nomes. Elas aparecem destacadas para conferir.
- A palavra que acende no Karaokê pode adiantar ou atrasar um pouco (por volta de 0,1 s).
- A detecção de respiração também erra às vezes. Por isso tudo passa pela revisão antes de aplicar.
- Cortar pausas faz a imagem pular em cada corte; o zoom que disfarça isso fica para o bloco 2.
- Se a gravação tiver música, TV ou outra pessoa falando junto da voz, o Diretor avisa e não marca nada sozinho, porque cortar ou abaixar mexe nesse som também.
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

Faixas de áudio separadas e `linkId`; "Melhorar voz" (afftdn/arnndn); normalização de loudness; SRT/VTT; emoji e palavras-chave automáticos; animações por palavra (bounce, slideUp, reveal) e a operação `regroupCaptions` (no bloco 1, reagrupar é gerar de novo sobre legendas que já têm palavras; ver D7); contorno vazado; motor rápido (Parakeet via sherpa-onnx); dicionário de nomes no reconhecimento e substituições automáticas em trechos legendados depois; zoom alternado nos cortes; cor, transições, rastreamento e máscaras.

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
- **v3 (entrega 6):** `ducks` nos clipes de vídeo.
- **v4 (entrega 7):** volume em dB como propriedade, `fadeIn`, `fadeOut` e `Track.muted`. A entrega 8 não muda o arquivo.
- Os números são fixos porque a entrega 7 depende da 6, nas duas ordens possíveis.
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
  - (d) soft clip no master acima de −1 dBFS;
  - (e) ganho = volume × rampas dos trechos abaixados (em dB; −60 = silêncio) × mudo, como em `motor-de-audio.md` item 5(e). A entrega 5 já calcula as rampas; os `ducks` chegam na 6.
- **Prévia:** um Worker no renderer lê PCM com `fetch` + Range no `media://audio`, mistura e manda blocos por um MessagePort para um AudioWorklet. Worker e worklet são carregados com `?worker&url` do Vite: `?url` num `.ts` entrega TypeScript cru, e Blob URL é barrado pela CSP, que não muda.
- **Relógio:** passa a ser o do AudioContext (`getOutputTimestamp` + `outputLatency`). Os `<video>` ficam mudos e seguem o relógio: busca se a diferença passar de 80 ms, ajuste de `playbackRate` entre 20 e 80 ms. O controle de volume da prévia continua sendo só monitor.
- **Exportação:** o main compila o plano a partir do projeto que já recebe em `export:start`, mistura em blocos de 1 s (cedendo com `setImmediate`) num `f32le` temporário ao lado do `.part`, e o ffmpeg recebe `-f f32le -ar 48000 -ac 2 -i <tmp>` e codifica o AAC uma vez só. Sem `utilityProcess` no bloco 1. A limpeza cobre o temporário em cancelar, fechar, travar e sair, como já acontece com o `.part`.
- **Removido na mesma entrega:** a exportação provisória de D2 e a mixagem pelos elementos.
- **Paridade:** o PCM tirado do worklet é igual bit a bit ao da exportação (mesmo V8). Comparações que passam pelo ffmpeg (AAC) usam tolerância de SNR, nunca md5.

#### D5. Trechos abaixados (entrega 6), volume e fades (entrega 7)

- **Entrega 6 (v3):** `ducks: [{s, e, gainDb, fadeMs, tag}]` no clipe de vídeo, guardados em **segundos da fonte**: aparar, dividir e apagar trecho não precisam remapeá-los, e as marcas de respiração (também em segundos da fonte) entram direto.
  - Operações `duckRanges {clipId, ranges, gainDb, fadeMs, tag}` (segundos da fonte daquele clipe; idempotente por tag: trechos da mesma tag que se sobrepõem são trocados; nunca `all: true` entre mídias) e `clearAudioRanges {clipIds?, tag?}`.
  - Na faixa Áudio, blocos dos trechos abaixados; no `get_context`, um resumo deles. As listas de chaves, o describeOp, o OPS_HELP, o compactClip e os testes mudam junto.
- **Entrega 7 (v4):** `volume` vira propriedade do registro `PROPS`: dB, −60 a +12, keyframes interpolados em dB. `status` e `compactClip` passam a ler o registro em vez de `['x','y','scale','opacity']` fixo.
  - `muted` continua no clipe. Entram `fadeIn` e `fadeOut` (em segundos, no máximo metade da duração) e `Track.muted`, o mudo da faixa.
  - Volume se muda com `setProperty` ou `setKeyframe`. Mandar `volume` em `updateClip` dá erro explicando a mudança.
- **Migração v3 → v4:** `volume dB = 20·log10(v)`, e v = 0 vira −60 dB, que o mixer trata como silêncio.
- **Interface (entrega 7):** bloco "Áudio" em Propriedades (Volume em dB com botão de keyframe, Fade de entrada e saída, Mudo, lista de trechos abaixados); na faixa Áudio, alças de fade nos cantos e uma linha de volume opcional; o botão de mudo da faixa vira o mudo de verdade; com um trecho marcado, "Abaixar" e "Silenciar".

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
- **Presets:** `amarelo` (padrão), `karaoke`, `palavraCaixa`, `caixa`, `impacto` e `classico`, com os valores de `legendas.md` §2. No vertical, nenhuma linha pode entrar na coluna de botões do TikTok à direita (x > 780 a partir de y = 840 num quadro de 1080×1920). A largura máxima e o centro padrão do retrato são ajustados para isso, e a sobreposição de áreas seguras avisa quando uma linha cruza a coluna. A regra vale só em 9:16, mede a linha com o contorno (borda direita abaixo de 780 px a partir de y = 840 em 1080×1920), vem ligada e é desligada se o usuário não publica no TikTok. Não usar a alternativa da pesquisa "centro em 45% com largura até 61%", que chega a ~815 px. Amarelo é o padrão em todos os formatos.
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
  - antes de fixar, comparar q5_0, q5_k e q8_0 em acerto (WER) e velocidade, porque a evidência de "sem perda" era do Q5_K_M. Acerto em FLEURS-pt e nos 15 clipes informais da tech4humans (se a licença permitir); velocidade relativa no CI.
- **Pipeline de um job (main):**
  1. trecho da linha do tempo → trechos da fonte dos clipes audíveis (não mudos, volume acima de −60 dB depois da entrega 7, faixa não muda);
  2. áudio do cache D3 → 16 kHz mono;
  3. VAD → segmentos com os parâmetros da fala (`-vspd 250 -vsd 300 -vp 200 -vmsd 25`, conferidos no `--help` do exe embutido), rodando na pasta do job com caminhos relativos ASCII (o exe do VAD também lê argv em ANSI). A saída do exe é em **centésimos de segundo**, e um teste do CI fixa o formato contra o binário embutido. Esses segmentos servem só para a transcrição; as respirações têm passada própria (D8);
  4. `speech.wav` = segmentos unidos por 0,4 s de silêncio, mais a tabela de mapeamento, em lotes de até uns 5 min de fala;
  5. `whisper-cli` com `cwd` numa pasta do job dentro de `userData/stt` e caminhos relativos ASCII. Quando algum argumento tem acento (o prompt, por exemplo), todos vão num arquivo de resposta UTF-8 com fim de linha LF, passado como único argumento (`whisper-cli.exe @args.txt`). Flags: `-l pt -nfa -dtw large.v3.turbo -ojf -sns -np -pp -t <núcleos físicos, até 8>`. Nunca `--vad` e nunca `-p` maior que 1. O prompt é uma frase curta em pt-BR com pontuação e, com `-mc 64 --carry-initial-prompt`, tem de caber em uns 63 tokens. Medir `-bs 1 -bo 1` contra o beam 5 padrão em velocidade e acerto antes de escolher: o vencedor vira o padrão de todos, não uma opção do usuário;
  6. tokens com tempo DTW → palavras com confiança → de volta ao tempo da fonte pela tabela;
  7. filtros de alucinação: texto fora da fala do VAD é descartado, repetições em laço são desfeitas e frases conhecidas ("Legendas pela comunidade Amara.org" e parecidas) são barradas;
  8. a transcrição fica em cache por mídia, em tempo da fonte (`userData/stt/cache/<srcKey>/`). Editar o projeto durante um job longo não o invalida. O cache registra quais trechos da fonte já foram transcritos, e gerar de novo só transcreve o que falta. Ele segue o LRU de D3 (nunca a mídia do projeto aberto).
- **Paginação** (`src/core/captions/chunker.ts`) segue as regras de cada preset (`legendas.md` §2): quebra na pontuação e em pausas (0,35 s nos estilos curtos, 0,6 s no Clássico); nunca termina uma página em palavra de função ("a", "de", "que", "pra"…); a página dura do início da primeira palavra até 0,15 s depois da última, sem passar o começo da próxima. No Clássico, 42 caracteres por linha e 17 caracteres por segundo (o construtor pode usar 20, o limite de SDH).
- **Resultado:** um rascunho local que troca as legendas que encostam no trecho.
  - As palavras vêm primeiro das legendas que já têm `words` (texto, tempos, `c` e `k`, só as de dentro do clipe). A transcrição (do cache, transcrevendo só o que falta) preenche só as partes da linha do tempo que essas legendas não cobrem, e uma palavra do cache cujo meio cai dentro de uma delas é descartada.
  - Legendas sem `words` são trocadas como antes.
  - Tudo é paginado com o preset escolhido na janela (Amarelo por padrão). O modelo só é pedido se alguma parte precisar ser transcrita. O cartão diz que o texto existente foi mantido.
  - Reagrupar (por exemplo, de Amarelo para Clássico) é este mesmo caminho sem nada para transcrever. Para escutar de novo do zero, o usuário apaga antes as legendas do trecho.
- **Progresso** vem de `progress = N%` no stderr. A estimativa de tempo vem do primeiro lote, não de uma calibração curta (um clipe de 20 s ainda paga uma janela inteira de 30 s e a carga do modelo). O tempo medido (sem a carga do modelo) aparece no cartão do resultado e fica salvo para a estimativa do próximo job. Se passar dos limites do passo E de `fala-para-texto.md`, um ajuste da entrega 4 acrescenta "Mais rápido": `ggml-small` q8_0 no mesmo `whisper-cli` (264 MB, SHA-256 fixado, cartão de licença próprio, `-dtw small`), o plano B da própria pesquisa ("Fallback").
- **Testes:** `DIRETOR_WHISPER_CLI` e `DIRETOR_WHISPER_VAD` apontam para `scripts/stt-simulada.mjs` no Linux e no e2e, como já se faz com o ffmpeg e as CLIs da IA.

#### D8. Respirações e pausas (entrega 6)

- **Detecção** é um job no main com uma passada própria do exe do VAD com parâmetros de respiração (folga até 30 ms, silêncio mínimo ~100 ms, fala mínima ~100 ms; conferir no `--help`), guardada em `audio-cache/<srcKey>/` à parte dos segmentos de D7, cuja folga de 200 ms esconderia as pausas curtas, e o classificador DSP em TypeScript de `respiracoes.md` ("Concrete plan" itens 3 a 5), em `src/core/speech/`. Como o exe do VAD só devolve segmentos, sem probabilidade por janela, o classificador trabalha com a máscara binária: as referências de nível vêm de dentro (fala) e de fora (não fala) dos segmentos, e o refinamento das bordas usa só sinais acústicos (periodicidade e nível). Nada de onnxruntime no bloco 1. Bordas e folgas vêm da borda acústica da fala, sem precisar de transcrição; nenhum corte cobre quadros com voz; com transcrição, nenhum corte entra numa palavra.
- **Marcas** (respiração, pausa, estalo, incerto, e "música/ruído" por mídia quando o ruído de fundo é alto e estável ou tonal: aviso e nada marcado) ficam no cache (`userData/audio-cache/<srcKey>/marks.json`) e num store do renderer, nunca no `Project`. Só o resultado aplicado (cortes ou trechos abaixados) entra no projeto.
- **Revisão:**
  - um item por vão: "Respiração" se o vão tem respiração (nota ≥ 0,4), senão "Pausa" (só se o vão passa da pausa mínima; no modo Abaixar, só respirações);
  - pílulas (respiração) e colchetes com a duração (pausa) na faixa Áudio;
  - barra "Respiração 3 de 41" ou "Pausa 5 de 41"  [<] [>]  Ouvir (Espaço)  Manter/Aplicar (Enter)  Sair (Esc); cada item diz o que aplicar faz (cortar ou abaixar);
  - os atalhos globais (Espaço, Delete, setas) são interceptados enquanto a revisão está aberta;
  - vêm marcados os cortes de pausa e as respirações com nota ≥ 0,7; vêm desmarcadas as de 0,4 a 0,7, todo "incerto" e tudo numa mídia com "música/ruído"; "estalo" só aparece na faixa;
  - resumo "N respirações e M pausas · vídeo −X s", com X somado dos cortes já unidos;
  - o Antes/Depois (D2) também vale para o rascunho que só abaixa.
- **Aplicar** gera um único rascunho local.
  - **Cortar (padrão):** `removeRanges` calculado das marcas no momento de preparar a etapa, passando por `sourceTime`.
    - Só se corta vão com pelo menos a pausa mínima do ritmo, e o corte deixa a sobra do ritmo; assim, nenhum corte é menor que pausa mínima − sobra (0,3, 0,2 ou 0,1 s).
    - Fica pelo menos 100 ms depois do fim acústico da fala e 50 ms antes da próxima; a sobra se divide 60/40: depois = máx(100 ms; 0,6·sobra), antes = máx(50 ms; sobra − depois). Essa folga protege as vogais finais desvozeadas do pt-BR e o /s/ final.
    - Cada borda do corte vai para o ponto mais baixo em ±10 ms, sem invadir as folgas.
    - Ritmo: Natural (pausa mínima 0,6 s, sobra 0,3 s), Dinâmico (0,4 s e 0,2 s; padrão) e Acelerado (0,25 s e 0,15 s). As folgas valem mais que o ritmo.
    - Com transcrição, os tempos das palavras ajudam a achar os vãos, mas as bordas seguem a evidência acústica.
    - Nenhum corte deixa um pedaço com menos de 0,4 s: pula-se o corte menor, e a respiração dele é abaixada.
    - A respiração que sobra na parte mantida, a de um vão menor que a pausa mínima e a de um corte pulado entram como `duckRanges` com a tag `breath` no mesmo rascunho (como no passo 6b de `respiracoes.md`).
  - **Abaixar:** nada é cortado; as respirações marcadas vão em `duckRanges` com a tag `breath`, −20 dB (Leve −12, Forte −30), rampas de 25 ms, nunca abaixo do ruído de fundo.
- **IA:**
  - `analyze_audio` inicia o job e devolve um `jobId`;
  - `get_job` espera o resultado;
  - `get_analysis('marks')` traz os itens (tipo, ação, motivo) em segundos da linha do tempo, em páginas, com a revisão;
  - a macro `cleanSpeech {analysisId, modo: 'cortar' | 'abaixar', ritmo?, forca?}` usa as decisões da revisão guardadas nas marcas e é resolvida numa etapa quando ela é preparada: `clearAudioRanges {tag: 'breath'}`, depois `duckRanges` por `clipId` (segundos da fonte, antes dos cortes), depois `removeRanges`. A sessão passa as marcas para o `applyOps`, e a IA nunca lista centenas de trechos.
- **Nota legal** herdada da pesquisa: a patente Dolby US10825464 cobre classificação de respiração combinada com nivelamento automático de ganho. Não há nivelamento automático junto da cadeia de respiração no bloco 1, e qualquer normalização futura fica fora dela até ser revista.

#### D9. Rascunhos locais, jobs e downloads (entrega 4, ou 6 se as respirações vierem antes; usados depois)

- **Propostas** ganham `origin: 'ai' | 'diretor'`. Rascunhos do próprio Diretor (legendas, limpar fala) aparecem no painel direito com a origem "Diretor" e têm "Refazer" local, sem passar pelo `chat.ownerOf`. Se já há uma proposta da IA aberta, o Diretor pergunta se troca.
- **Gerenciador de jobs** no main: iniciar, progresso, cancelar e resultado; deduplicação por chave; aborto em `did-start-loading`, `render-process-gone`, `closed` e `will-quit`, como `abortAllExports`; pastas temporárias limpas.
- **Gerenciador de download** dos modelos, como em D7.
- **Histórico:** palavras e muitos pedaços engordam os snapshots. Trocar o limite fixo de 200 entradas por um orçamento de memória (o construtor escolhe o número).

#### D10. IA (MCP) e modo econômico

- **Ferramentas novas:**
  - `generate_captions {t0?, t1?, preset?}` → `jobId`; sobre trecho com legendas, reaproveita as palavras delas, e é também como a IA reagrupa, com `{preset}`;
  - `analyze_audio {t0?, t1?}` → `jobId`;
  - `get_job {jobId, wait ≤ 45}`, com a mesma exceção de espera longa do `get_proposal` em `bridgeTimeoutMs` e `callTimeoutMs`;
  - `get_analysis {kind: 'transcript' | 'marks', range?, cursor?, limit ≤ 100}`. "transcript" devolve as palavras das legendas da linha do tempo `{clipId, i, t, início, c}` e a revisão; a IA corrige com `setCaptionWords` ou `updateClip set.text`. O OPS_HELP e as INSTRUCTIONS dizem o mesmo.
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
- **Prévia:** botão "Áreas do TikTok/Reels/Shorts", só uma sobreposição na tela, nunca exportada. A área do Shorts vem do modelo oficial de anúncio vertical do Google e é marcada como aproximada. A sobreposição mostra a interseção das áreas do TikTok, Reels e Shorts até o usuário dizer onde publica; depois, as plataformas dele.
- **Aba Transcrição** (entrega 8): mostra as palavras das legendas da linha do tempo, em ordem (`mapa-do-codigo.md` F4c), sem precisar do cache; palavras em chips; as de baixa confiança sublinhadas; clique leva até a palavra; duplo clique edita; Tab vai para a próxima duvidosa; "Substituir em tudo".
  - Editar é `setCaptionWords` ou `updateClip` naquela legenda: uma entrada no histórico, ou um ajuste se ela está num rascunho aberto.
  - "Substituir em tudo" é um lote só, fica desligado com um rascunho de legendas aberto (o `shouldRouteToDraft` levaria o lote inteiro para o rascunho) e não vale para trechos legendados depois.
  - As correções ficam só nas legendas: não há tabela de correções no `Project` nem escrita no cache. Uma correção dentro de uma legenda apagada se perde (o Ctrl+Z traz de volta).

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
| E2 | Visual das legendas | S2 + `legendas.md` | — | Os 6 presets saem iguais na prévia e no MP4 (diff com tolerância); contorno ajustável; fontes embutidas e do computador; arrastar a posição; projeto v1 abre com o mesmo visual; arquivo v3 é recusado; imagem testada em 1080×1920 e 1920×1080; com a regra do TikTok ligada, nenhuma linha, com contorno, cruza a coluna. |
| E3 | Forma de onda | S3 | — | Forma de onda aparece depois de importar, com progresso; o LRU respeita o projeto aberto; `media://audio` recusa caminhos fora do cache. |
| E4 | Legendas automáticas | S5a | E2, E3 (E1 para as palavras seguirem divisões) | Licença e download com retomada e cancelar; transcrever um trecho; rascunho com palavras; Karaokê acende a palavra certa; o Claude dispara pelo MCP; cancelar no meio não deixa processo nem arquivo; o `whisper-cli.exe` abre num Windows sem VC++ (conferência de importações); o tempo medido aparece no cartão; gerar de novo num trecho com legendas mantém o texto delas (inclusive o editado em Propriedades) e refaz as páginas; gerar com Clássico sobre legendas Amarelo refaz as páginas sem transcrever e sem o modelo. |
| E5 | Motor de áudio | S4a | E1, E3 | PCM do worklet igual ao da exportação; sem estalo nas emendas; exportação com 600 pedaços no Windows; a prévia não deriva em 10 minutos de reprodução. |
| E6 | Tirar as respirações (cortar e abaixar) | S6a + S6b (detecção, revisão, abaixar e cortar) | E1, E4 (VAD, jobs, rascunhos locais, `get_job`), E5 | Marcas na faixa; um item por vão; vãos de respiração de 0,30, 0,38 e 0,6 s tratados pela regra em cada ritmo; nenhum corte menor que pausa mínima − sobra; nenhuma parte mantida abaixo de 100/50 ms em nenhum ritmo; o −X s do resumo igual ao encurtamento; palavra curta dentro de pausa nunca cortada; "incerto" nunca marcado; fixture com música avisa e não marca nada; modo Abaixar não muda a duração e baixa ~20 dB nas marcas no MP4; um Ctrl+Z desfaz; legendas andam junto; migração v2 → v3; arquivo v4 recusado. Antes de publicar, um job de medição separado, com o modelo de verdade: limpar fala pública pt-BR e transcrever de novo não perde palavra. |
| E7 | Volume, fades e trechos | S4b | E5, E6 | +12 dB audível na prévia e no MP4; fades; abaixar e silenciar trecho; migração v3 → v4; arquivo v5 recusado. |
| E8 | Transcrição | S5b | E4 | Chips, sublinhado das duvidosas, clique leva à palavra, editar, Substituir em tudo; uma palavra corrigida na aba continua corrigida depois de gerar de novo no mesmo trecho e de gerar com o Clássico; a aba mostra o mesmo texto da prévia; o Claude corrige com `setCaptionWords` a partir do `get_analysis("transcript")`. |

**Se o usuário pedir as respirações antes** (ordem 1, 2, 3, 5, 6, 4, 7, 8), a E6 depende só de E1 e E5 e leva junto:

- `fetch-stt` com o exe do VAD, as DLLs do whisper/ggml e o `ggml-silero` no instalador;
- as quatro DLLs do VC++ (com `vcomp140`), a conferência de importações no after-pack, o passo do CI e `vendor/` no `.gitignore`;
- o gerenciador de jobs e a pasta do job com caminhos ASCII;
- rascunhos locais (origem "diretor", Refazer local);
- `get_job` e `get_analysis` com a exceção de espera longa (hoje só o `get_proposal` tem) e a lista de `tests/mcp.test.ts`;
- o `DIRETOR_WHISPER_VAD` falso e o teste dos centésimos;
- Licenças (whisper.cpp, Silero) e o orçamento de memória do histórico.

O aceite da E6 ganha "o `whisper-vad-speech-segments.exe` abre num Windows sem VC++". Não vão para a E6: o `whisper-cli`, o modelo de 574 MB, o gerenciador de download e o cartão de licença.

### Riscos

- **DLLs no Windows limpo** (D7): é o que mais quebra na primeira instalação, e vale para a entrega que trouxer o exe primeiro (4, ou 6 se as respirações vierem antes). Mitigação: conferência de importações e um teste manual numa máquina sem VC++.
- **Velocidade da transcrição** em CPU fraca: beam 5 e `-nfa` não foram medidos juntos. Mitigação: medir na E4 e mostrar o tempo; o plano B é o `ggml-small` no mesmo motor (Parakeet fica fora do bloco 1).
- **Antivírus** pode barrar um `whisper-cli.exe` sem assinatura, como pode barrar o próprio Diretor hoje.
- **Relógio da prévia** com vídeo escravo do áudio: emendas e deriva. Mitigação: o pool por mídia com pré-busca vem antes (E1), e há métricas de deriva no e2e.
- **Falsos positivos de respiração** em pt-BR. Mitigação: folgas mínimas na borda acústica, nenhum corte sobre voz, revisão obrigatória, duvidosos desmarcados e ajuste pelo que o usuário relatar ao testar a E6.
- **Música ou outra voz no mesmo áudio:** cortar picota e abaixar abaixa junto. Mitigação: marca "música/ruído", aviso e nada marcado.
- **Imagem pulando** em 9 a 17 respirações por minuto, sem o zoom que só vem no bloco 2. Mitigação: só vãos com pelo menos a pausa mínima são cortados; o resto é abaixado.
- **A amostra do usuário pode não chegar.** Mitigação: fixtures, fala pública e o retorno dele ao testar.
- **Disco:** cerca de 700 MB por hora de cache de áudio. Mitigação: LRU.
- **Fontes:** a prévia na GPU e a exportação na CPU podem diferir em subpixel. Mitigação: layout puro e testes com tolerância.
- **Áreas seguras** são medições de terceiros e mudam quando as plataformas mudam.
- **Hugging Face fora do ar.** Mitigação: segunda URL nas releases do repositório.

### Deixado para quem constrói

- Detalhes visuais seguindo o tema atual, ícones e a disposição exata dos controles.
- Limiares do classificador de respiração dentro das folgas acima, ajustados com fixtures sintéticas (inclusive finais de vogal desvozeada e /s/), fala pública pt-BR (só para conferir que nenhum corte come palavra; não há rótulo de respiração), as gravações do usuário se ele mandar e o que ele relatar ao testar a entrega 6. Nunca pedir ao usuário que marque respirações.
- Parâmetros do VAD das respirações (folga até 30 ms, silêncio mínimo ~100 ms, fala mínima ~100 ms), conferidos no `--help`.
- Limite do LRU e orçamento de memória do histórico.
- Beam, quantização e texto do prompt, depois de medir em FLEURS-pt e tech4humans (acerto) e no CI (velocidade relativa).
- Como entregar as DLLs: cópia de um redistribuível 14.51 ou mais novo, ou compilação estática.
- 17 ou 20 caracteres por segundo no Clássico.
- O texto exato das mensagens, em pt-BR e sem jargão.

### Correções e conflitos resolvidos

As pesquisas foram feitas em paralelo e às vezes se contradizem. Este design decide assim:

- **Um cache de áudio só** (48 kHz s16 estéreo com 3 dB de folga); 16 kHz mono derivado para VAD e fala. Nada de cache de análise separado nem de extração por job do arquivo original.
- **Trechos em segundos da fonte** `{s, e, gainDb, fadeMs, tag}`, não relativos ao clipe.
- **Nomes de operação:** `splitClip`, `removeRanges`, `duckRanges`, `clearAudioRanges` e `cleanSpeech` (não `removeRange`, `setGainRegions` nem `get_audio_analysis`).
- **Ferramentas MCP** seguem um padrão só de job: `jobId` + `get_job` + `get_analysis` paginado.
- **VAD:** o exe do whisper.cpp para fala e respirações, com parâmetros diferentes: a folga de 200 ms da fala esconde as pausas curtas. Nem onnxruntime-node nem sherpa-onnx no bloco 1, o que evita DLLs duplicadas, o runtime VC++ do onnxruntime e o download na instalação.
- **Exportação de áudio:** mixer no main, sem `utilityProcess`, com um temporário `f32le` como entrada única do ffmpeg.
- **Respirações:** só no motor novo. Nada de envelope por GainNode na prévia nem expressões `volume=eval=frame` no ffmpeg.
- **Marcas fora do `Project`** (cache), não em `project.audioMarks`.
- **Respirações: cortar é o padrão**, contra a pesquisa (que recomendava abaixar). É a leitura do pedido "tirar as partes que a pessoa respira", e o usuário pode trocar. Abaixar vem na mesma entrega 6 (como na pesquisa, que abaixa antes de cortar) e cobre o que o corte não tira (`respiracoes.md`, passo 6b).
- **Acelerado mantém 0,15 s**, não 0,12 s: as folgas valem mais que o ritmo.
- **Itens marcados sozinhos:** a avaliação com 20 a 30 min rotulados (pesquisa, passo 12) não é possível. No lugar dela: fixtures, conferência de palavras em fala pública e o retorno do usuário.
- **"Música/ruído" volta** (pesquisa, passo 5): aviso e nada marcado.
- **Aba Transcrição** mostra as palavras das legendas (mapa F4c), não o cache (mapa l. 249). As correções ficam só nas legendas, e gerar de novo as reaproveita; não há tabela de correções no `Project`.
- **Plano B de velocidade:** `ggml-small` no mesmo motor (pesquisa, "Fallback"), não a busca gulosa, que é escolhida por medição como padrão de todos.
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
