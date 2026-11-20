# Áudio e legendas no Diretor (bloco 1) — design

- **Estado:** aprovado pelo usuário em 19/11/2026. Nas respostas, ele pediu que o Diretor sirva para qualquer vídeo, curto ou longo; disse que as gravações podem ter música, TV ou outra voz; e pediu um modo de tirar ruído, que virou a entrega 8 (a aba Transcrição passou a ser a 9). Depois escolheu fazer a Exportação rápida para vídeos longos logo depois da entrega 1 (E1b).
- **Data:** 19/11/2026, sobre o Diretor 0.1.24 (`main` em 470a840).
- **Checagem de quem constrói:** feita em 19/11/2026. As respostas entraram no texto (respirações com cortar e abaixar na entrega 6, ordem, correções de palavras, áreas do TikTok e medição de velocidade); as perguntas que só o usuário responde estão marcadas como suposições em "Decisões tomadas pelo Claude". A entrega 8 (Tirar ruído) entrou depois dessa checagem.
- **Segunda checagem (tirar ruído e vídeos longos):** feita em 19/11/2026; as correções entraram no texto.
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
7. **Tirar ruído.** No bloco Áudio, Leve ou Forte limpa chiado, ventilador e barulho de rua da voz. Não separa vozes: a TV e outra pessoa falando continuam. O Diretor processa no próprio PC. Na primeira vez, a prévia toca o som original por um instante, com um aviso, e fica limpa assim que o trecho fica pronto (alguns segundos). O Forte limpa mais, mas pode tirar a música de fundo nas pausas e as risadas.
8. **Corrigir palavras.** Uma aba Transcrição mostra o texto das legendas, palavra por palavra, destaca as palavras em que o reconhecimento ficou em dúvida e deixa corrigir com um clique. A correção continua valendo quando o usuário gera as legendas de novo ou troca o estilo.

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
| Vídeo    | [clipe A.......]|[clipe B....]|(−4,0 s)|[clipe C.............]                   |
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
8. Tirar ruído da voz (Leve ou Forte).
9. Aba Transcrição para corrigir palavras.

Outra ordem possível, se o usuário preferir as respirações antes das legendas automáticas: 1, 2, 3, 5, 6, 4, 7, 8, 9. Aí as respirações chegam na 5ª atualização em vez da 6ª, e as legendas automáticas na 6ª em vez da 4ª, porque tirar respirações precisa do motor de áudio novo (5) e as legendas automáticas não. A entrega das respirações fica maior, porque leva junto peças que hoje chegam com as legendas automáticas, mas continua sem o download de 575 MB.

Entrega extra E1b, escolhida pelo usuário em 19/11/2026 para vir logo depois da entrega 1: Exportação rápida para vídeos longos, que decodifica cada pedaço em sequência e só busca nas emendas. Ela tem design e aceite próprios, feitos antes de construir; as outras entregas mantêm os números.

### Decisões tomadas pelo Claude (o usuário pode mudar qualquer uma)

- **Tipo de vídeo:** o usuário quer o Diretor para qualquer vídeo, curto ou longo. O formato do projeto segue o primeiro vídeo importado, e os estilos de legenda se ajustam sozinhos ao formato em pé ou deitado. No vídeo em pé, as legendas ficam um pouco mais estreitas para não passar por baixo dos botões do TikTok; dá para desligar essa margem. O padrão é Amarelo com borda nos dois formatos; num vídeo deitado e longo, o Clássico pode combinar mais, e os estilos estão a um clique. Com o Amarelo, uma hora de vídeo dá umas 3.000 legendas, e o Diretor foi pensado para aguentar isso.
- **Estilo padrão das legendas:** Amarelo com borda, o exemplo do próprio usuário, com até 3 palavras por vez.
- **Respirações:** o padrão é cortar as pausas, no ritmo "Dinâmico", porque o pedido foi "tirar as partes que a pessoa respira". Cortar deixa o vídeo mais curto, mas a imagem pula em cada corte (o zoom que disfarça isso vem no bloco 2). A respiração que não dá para cortar fica bem baixinha. A alternativa é só abaixar o som das respirações: o vídeo fica do mesmo tamanho e a imagem não pula. O ritmo "Acelerado" corta mais. As pausas e as respirações mais claras já vêm marcadas; as duvidosas vêm desmarcadas.
- **Ordem:** as legendas automáticas (entrega 4) vêm antes das respirações (entrega 6). Elas não precisam do motor de áudio novo, então chegam duas atualizações mais cedo, e as peças que as duas usam (o programa de fala no Windows, as tarefas com barra de progresso e os rascunhos do próprio Diretor) são testadas antes nas legendas, onde um defeito atrapalha menos. A outra ordem adianta as respirações em uma atualização (ver "Ordem das entregas").
- **Reconhecimento de fala:** dois níveis desde a entrega 4, porque vídeos longos demoram. O Preciso é o mais preciso para português que roda no PC (download único de 575 MB) e é o padrão: ele trabalha enquanto o usuário edita. O Mais rápido é um reconhecimento menor, do mesmo programa (uns 260 MB a mais, baixados só se for usado), que erra quase o dobro de palavras. A janela de Gerar legendas mostra quanto cada um deve levar no computador do usuário e só sugere o Mais rápido quando o PC é lento (o Preciso levaria mais de uma vez e meia o tempo da fala), dizendo o custo: num vídeo de uma hora, umas 300 palavras erradas a mais para conferir. Antes de medir, começa pelo Preciso; depois do primeiro pedaço, mostra a estimativa e oferece trocar sem perder o que já foi feito.
- **Gerar legendas num trecho que já tem legendas** refaz as legendas desse trecho no estilo escolhido, aproveitando o texto que já está nelas, com as correções; só as partes sem legenda são escutadas. Assim, para passar de Amarelo (até 3 palavras) para Clássico (duas linhas), basta gerar de novo com o Clássico, sem esperar nova transcrição. Para escutar um trecho do zero, o usuário apaga antes as legendas dele. Como é rascunho, dá para descartar.
- **Aparar um vídeo** passa a funcionar como apagar aquele pedaço: as legendas e os títulos em cima da parte aparada saem junto, e os que vêm depois andam junto. Hoje só os vídeos andam, e as legendas perdem a sincronia.
- **Títulos** também ganham contorno e as fontes novas.
- **Cópia do áudio:** o Diretor guarda uma cópia do áudio de cada vídeo para trabalhar rápido (uns 700 MB por hora de vídeo) e apaga as mais antigas sozinho, nunca as do projeto aberto.
- **Tirar ruído:** vem desligado e vale por clipe, com botões para aplicar a todos os clipes ou só aos do trecho marcado. O Leve é o indicado quando há música de fundo. O Forte limpa mais; o tipo de limpeza dele é escolhido por teste, entre o que mais limpa a fala, um que mantém risadas e um que mantém música.

### Fica para depois

- Faixas de áudio separadas (música de fundo, narração).
- Deixar o volume do vídeo todo no padrão das redes, e o resto da limpeza de voz (compressor e tirar o chiado do "s").
- Arquivo de legenda separado (SRT) para subir no YouTube.
- Emojis e palavras-chave escolhidos pela IA nas legendas; animações palavra por palavra (pular, deslizar).
- Zoom alternado nos cortes (entra com as transições, no bloco 2).
- Cor e transições (bloco 2); seguir objeto e máscaras (bloco 3).

### Limites que o usuário vai notar

- As legendas automáticas precisam baixar 575 MB na primeira vez.
- Transcrever leva tempo: de menos de um minuto a uns três minutos de espera por minuto de fala, conforme o computador. A entrega 4 mede no PC do usuário e mostra o tempo. Num vídeo de uma hora, o Preciso pode levar de uns 40 minutos a umas 3 horas, e o Mais rápido de uns 10 a uns 45 minutos (estimativas, a medir na entrega 4). Dá para continuar editando enquanto isso, e o que já foi transcrito fica guardado se o Diretor fechar: para continuar, é só gerar de novo no mesmo trecho.
- Enquanto transcreve, o PC fica ocupado e a prévia pode engasgar. O Diretor não deixa o PC dormir até terminar.
- Exportar um vídeo longo demora. Hoje a exportação posiciona o vídeo quadro a quadro, e uma hora em 1080p pode levar horas num PC sem aceleração de vídeo (medido: cerca de 0,1 s por quadro). A entrega 5 mede no Windows e mostra a estimativa antes de exportar.
- Depois de importar um vídeo longo, o som leva de segundos a alguns minutos para ficar pronto.
- O reconhecimento erra algumas palavras, principalmente nomes. Elas aparecem destacadas para conferir.
- A palavra que acende no Karaokê pode adiantar ou atrasar um pouco (por volta de 0,1 s).
- A detecção de respiração também erra às vezes. Por isso tudo passa pela revisão antes de aplicar.
- Cortar pausas faz a imagem pular em cada corte; o zoom que disfarça isso fica para o bloco 2.
- Num vídeo longo, a revisão das respirações pode ter centenas de itens. Não é preciso passar um por um: Aplicar usa o que já vem marcado, e dá para ir direto às duvidosas ou marcar e desmarcar várias de uma vez.
- Tirar ruído leva alguns segundos por minuto de vídeo na primeira vez e ocupa mais espaço no disco. Na primeira vez, a prévia toca o som original por um instante, com um aviso. Não separa vozes: a TV e outra pessoa falando continuam. O nível Forte pode tirar a música de fundo nas pausas e as risadas.
- Num vídeo longo, se o ruído ainda não foi tirado, a exportação espera uns minutos, mostrando o progresso.
- Se a gravação tiver música, TV ou outra pessoa falando junto da voz, o Diretor avisa e não marca nada sozinho, porque cortar ou abaixar mexe nesse som também. Barulho constante, como ventilador ou chiado, não impede: as respirações vêm marcadas, e o Diretor sugere Tirar ruído.
- Emojis seguem o desenho do Windows instalado.

---

## Parte 2 — Design técnico

### Intenção

O usuário faz vídeos falados, curtos (em pé, para Reels, TikTok e Shorts) e longos (deitados, para o YouTube), e quer resolver no Diretor o que hoje exige CapCut ou DaVinci: cortar e limpar a fala, legendar automaticamente com estilo forte e acertar o som, numa tela só, com a IA ajudando por rascunhos. Dá certo quando ele importa um vídeo falado, gera as legendas no estilo dele, tira as respirações e exporta sem sair da tela principal, e o MP4 sai igual à prévia.

### Metas

- **G1** Dividir clipes e apagar trechos com ripple em todas as faixas.
- **G2** Estilo completo de legenda: contorno, fontes embutidas e instaladas, cores, sombra, caixa, posição, maiúsculas e destaque da palavra falada. Títulos ganham contorno e fontes.
- **G3** Áudio da prévia idêntico ao da exportação (o mesmo mixer), cortes sem estalo e milhares de cortes sem quebrar a exportação (um vídeo de uma hora com as respirações cortadas). O tempo de exportar um vídeo longo é medido e mostrado antes de exportar; acelerá-lo é a entrega E1b, Exportação rápida (Riscos).
- **G4** Legendas automáticas locais em pt-BR, com tempo por palavra, num trecho escolhido, entregues como rascunho.
- **G5** Detectar respirações e pausas, revisar e cortar (padrão) ou abaixar.
- **G6** Volume em dB (−60 a +12) com keyframes, fades, trechos abaixados ou silenciados e mudo por faixa.
- **G7** Corrigir palavras da transcrição.
- **G8** Tudo disponível para o Claude e o Codex pelas mesmas operações do MCP, com rascunho, aceite e desfazer.
- **G9** Tirar ruído da voz em dois níveis, com o mesmo som na prévia e na exportação depois de processado.

### Fora do bloco 1

Faixas de áudio separadas e `linkId`; "Melhorar voz" completo (de-esser, compressor e limitador; só a redução de ruído entra, na entrega 8); normalização de loudness; SRT/VTT; emoji e palavras-chave automáticos; animações por palavra (bounce, slideUp, reveal) e a operação `regroupCaptions` (no bloco 1, reagrupar é gerar de novo sobre legendas que já têm palavras; ver D7); contorno vazado; motor rápido (Parakeet via sherpa-onnx); dicionário de nomes no reconhecimento e substituições automáticas em trechos legendados depois; zoom alternado nos cortes; cor, transições, rastreamento e máscaras.

### Anti-metas (falha mesmo que "funcione")

- Uma tela ou um modo separado para áudio ou legendas.
- Prévia diferente da exportação em som, legenda ou tempo, fora das esperas sempre sinalizadas na tela (áudio sendo preparado, D3; "Tirando ruído…", D13).
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
- **v4 (entrega 7):** volume em dB como propriedade, `fadeIn`, `fadeOut` e `Track.muted`.
- **v5 (entrega 8):** `denoise` no clipe de vídeo (sem o campo, desligado; a migração não grava nada). A entrega 9 não muda o arquivo.
- Nas duas ordens listadas, os números acima valem: a entrega 7 depende da 6, e a 8 vem depois da 7. Se o usuário pedir outra ordem, cada entrega que muda o arquivo usa a próxima versão na ordem de mescla, e os aceites ficam "migração da versão anterior; a seguinte é recusada". Se a 8 vier antes da 7, ela cria o bloco Áudio.
- Cada migração tem teste de ida (v1 → atual) e de recusa (atual + 1).

#### D2. Dividir e apagar trecho (entrega 1)

- **Primitivas:** `splitClip {clipId, at, newId?}`, `shiftClips {clipIds, delta}` e `cutTextTime {clipId, t0, t1}`. A última encurta um título ou legenda que atravessa o trecho apagado e leva junto as palavras e os keyframes.
  - `splitClip` clona o clipe inteiro e só ajusta tempos, keyframes, palavras, trechos abaixados e fades. Campos que chegarem depois (como o `denoise` da E8) passam às duas partes sem mexer nele. Os campos em segundos da fonte (os `ducks`, a partir da E6) são repartidos pelo ponto de corte (D5), nunca copiados inteiros.
- **Macro:** `removeRanges {ranges}`, com até 500 trechos por chamada direta (a expansão do `cleanSpeech` dentro da sessão não tem esse teto: um vídeo de uma hora passa de mil cortes), em segundos da linha do tempo atual. Os trechos são ordenados e unidos e valem em todas as faixas destravadas: os clipes de dentro saem, os que atravessam são divididos e os seguintes andam. Uma faixa travada que mudaria gera o erro `locked`. Faixas ocultas também andam.
  - A expansão é linear no número de clipes: os trechos ordenados viram uma tabela de deslocamento acumulado; cada clipe recebe no máximo um deslocamento (`shiftClips` agrupado por delta), e só os clipes que encostam num trecho são divididos, encurtados ou removidos. Ao pé da letra (um deslocamento por clipe seguinte a cada trecho, como o ripple do `trimClip` hoje), mil cortes numa hora dariam uns 2,5 milhões de operações.
  - A partir da E6, `applyOps` valida e aplica com um índice id → clipe (`Map`) em vez de `findClip` linear. Os números de aceite estão na E6.
  - **Mais de 500 trechos:** várias `removeRanges` na mesma etapa, enviadas do fim do vídeo para o começo. Cada uma usa os tempos da linha do tempo como a anterior deixou, e cortar mais adiante não muda os tempos de antes, então os trechos continuam valendo. O OPS_HELP diz isso.
- **Keyframes** são repartidos com o valor da borda (`partitionKeyframes`, exportando os auxiliares privados de `operations.ts`).
- **Aparar um vídeo com ripple** passa a valer como `removeRanges` do pedaço aparado em todas as faixas: texto sobre a parte aparada é cortado ou removido, e os clipes seguintes de todas as faixas andam junto. Hoje só os vídeos seguintes andam, e as legendas perdem a sincronia (decisão do Claude, ver Parte 1).
- **Tempo:** continua arredondado a 1 ms (`round()`). O Ctrl+B manual cai no quadro mais próximo. Cortes automáticos (respirações) mantêm a precisão de 1 ms: o vídeo mostra o quadro mais próximo e o áudio corta no ponto exato.
- **Pedaços contíguos** (mesma mídia, `in` de um igual ao fim do outro) são reconhecidos com tolerância de 1 amostra a 48 kHz. Assim o arredondamento em ms nunca cria um estalo onde não há corte de verdade.
- **VideoPool por mídia** (`video.ts`): 2 ou 3 elementos por arquivo, o mesmo elemento entre pedaços contíguos, pré-busca uns 0,5 s antes de cada emenda, último quadro bom mantido durante a troca. O preflight da exportação passa a contar mídias, não clipes.
- **Exportação provisória** (até a entrega 5): uma entrada `-i` por mídia; `asplit` + `atrim` + `concat` para pedaços em sequência e `amix` só entre fontes que se sobrepõem, num `-filter_complex_script` temporário apagado como o `.part`. Na checagem isso foi bit a bit exato numa divisão e mantém a linha de comando curta (a flag existe no ffmpeg 6.1.1 do Windows; no 7.1+ virou `-/filter_complex`). O custo cresce mais rápido que o número de pedaços (medido: ffmpeg 7.0.2, 4 vCPU, áudio só: 300 pedaços de uma fonte de 1 h = 74 s; 1.000 = 520 s). Até a E5, com mais de 300 pedaços a janela de exportar avisa que o som pode demorar alguns minutos a mais.
- **Linha do tempo:** trecho na régua (Shift+arrastar, ou I e O); Dividir (Ctrl+B) e Apagar trecho (Shift+Delete, conferido antes do Delete comum); emendas com chip "−0,4 s" nos rascunhos ("−1:15" a partir de 10 s); `ClipBlock` com `React.memo` e só os pedaços visíveis desenhados (um vídeo longo tem milhares); agulha num assinante separado; `draftInfo` memorizado pela chave da view.
  - O zoom mínimo cabe o projeto inteiro na janela (cerca de 0,3 px/s em 1 h; hoje ele para em 20 px/s, e uma hora nunca cabe). A régua desenha só os rótulos visíveis e passa a minutos e a passos maiores quando o zoom diminui. A E1 faz esse zoom, a régua só com rótulos visíveis e só os pedaços visíveis.
  - **Nível de detalhe** (especificado aqui, feito na E6, quando chegam os mil cortes): abaixo de uns 4 px por pedaço, cada corrida da mesma mídia é desenhada como um bloco só, com a contagem ("312 pedaços"); a faixa Legendas vira uma faixa de densidade; e os chips de emenda somem, com o total cortado no resumo.
- **Prévia:** botão Antes/Depois enquanto há um rascunho com ripple aberto. Trocar mantém o mesmo instante do conteúdo: a agulha é convertida pelo tempo da fonte do pedaço de vídeo sob ela (`sourceTime` numa versão, a inversa na outra); se aquele instante foi cortado, ela vai para a borda do corte.

#### D3. Cache de áudio e forma de onda (entrega 3)

- **Ingestão** é um job no main, disparado ao importar e ao abrir um projeto sem cache. O ffmpeg decodifica para 48 kHz, estéreo, s16, com 3 dB de folga (ganho −3 dB, anotado em `meta.json` e compensado pelo mixer, porque o AAC decodificado passa de 1,0 e o s16 cortaria). O cache fica em `userData/audio-cache/<srcKey>/`: `base.s16`, picos min/máx a cada 128 amostras, um nível grosso e `meta.json`. `srcKey` = hash de caminho, tamanho, mtime e versão da ingestão.
  - Num vídeo de celular, a ingestão lê o arquivo quase inteiro, porque o áudio vem intercalado com a imagem: uma hora tem uns 4 a 22 GB, de segundos num SSD a uns 4 min num HD externo. O `base.s16` é escrito em ordem, e o main informa até onde já escreveu. A partir da E5, a prévia toca a parte escrita, e só o resto fica mudo, com o selo "Preparando o áudio… N%".
- **Mídia sem áudio:** é conferida antes (probe ou `-map 0:a:0?`) e não ingere.
- **LRU** com limite (o construtor escolhe o padrão; a pesquisa sugere 10 GB), nunca tirando mídia do projeto aberto. Custa uns 691 MB por hora.
- **Espaço livre:** antes de ingerir, processar blocos (D13) e exportar, o Diretor confere o espaço livre com `fs.statfs`: ingestão ~0,7 GB por hora de mídia; cada nível de Tirar ruído mais ~0,7 GB/h; exportação ~1,4 GB por hora de vídeo no temporário f32 (a partir da E5) mais o MP4 (uns 2 a 5 GB/h em 1080p) na pasta de destino. Sem espaço, aviso em pt-BR antes de começar. O LRU limita o tamanho do cache, mas não protege contra disco cheio.
- **Host `media://audio/<srcKey>/…`** preso à pasta do cache, com checagem de `..`, `application/octet-stream` e Range.
- **Forma de onda:** um canvas do tamanho da área visível na faixa Áudio (que passa a 64 px), redesenhado só ao rolar, mudar o zoom ou mudar a view.
- **Para fala e VAD:** 16 kHz mono derivado do `base.s16` quando preciso, em fluxo, sem ler o arquivo inteiro na memória. Não existe um segundo cache de análise.

#### D4. Motor de áudio (entrega 5)

- **`src/core/audio/plan.ts`:** `compileAudioPlan(view)` é puro e devolve segmentos `{srcKey, tl0, src0, len, ganho}`. **`src/core/audio/mix.ts`:** `mixInto(plan, frame0, n, read)` acumula em Float64 e não guarda estado. Tudo segue o "Concrete plan" de `motor-de-audio.md` (itens 5 e 6), menos "Melhorar voz" e loudness.
- **Regras do plano:**
  - (a) pedaços contíguos não ganham fade, então a divisão é perfeita;
  - (b) outros cortes ganham crossfade equal-power de 10 ms usando material de fora da borda; sem esse material, 5 ms de saída e 5 ms de entrada. Uma borda contígua na fonte em que só o Tirar ruído muda não é corte: usa o crossfade de ganho constante de D13;
  - (c) borda encostada em silêncio ganha micro-fade de 3 ms;
  - (d) soft clip no master acima de −1 dBFS;
  - (e) ganho = volume × rampas dos trechos abaixados (em dB; −60 = silêncio) × mudo, como em `motor-de-audio.md` item 5(e). A entrega 5 já calcula as rampas; os `ducks` chegam na 6.
- **Prévia:** um Worker no renderer lê PCM com `fetch` + Range no `media://audio`, mistura e manda blocos por um MessagePort para um AudioWorklet. Worker e worklet são carregados com `?worker&url` do Vite: `?url` num `.ts` entrega TypeScript cru, e Blob URL é barrado pela CSP, que não muda.
- **Relógio:** passa a ser o do AudioContext (`getOutputTimestamp` + `outputLatency`). Os `<video>` ficam mudos e seguem o relógio: busca se a diferença passar de 80 ms, ajuste de `playbackRate` entre 20 e 80 ms. Com uma busca em curso não se pede outra: a busca mira o tempo previsto ao fim dela (alvo + latência da última busca daquela mídia) e, se o quadro não chega, a prévia segura o último quadro em vez de perseguir o relógio (com mil emendas por hora e pedaços de 0,4 s, cada busca em 1080p leva uns 90 ms). O controle de volume da prévia continua sendo só monitor.
- **Exportação:** o main compila o plano a partir do projeto que já recebe em `export:start`, mistura em blocos de 1 s (cedendo com `setImmediate`) num `f32le` temporário ao lado do `.part`, e o ffmpeg recebe `-f f32le -ar 48000 -ac 2 -i <tmp>` e codifica o AAC uma vez só. Sem `utilityProcess` no bloco 1. A limpeza cobre o temporário em cancelar, fechar, travar e sair, como já acontece com o `.part`.
- **Preparar o áudio:** a espera pelo áudio fica dentro do job de exportação, no main. Logo depois de escolhido o arquivo, o `export:start` registra o job em `jobs` (com `AbortController` e fase "preparando") antes de qualquer outro `await` e devolve o `jobId` na hora. Essa fase espera a ingestão D3 que faltar (e, a partir da E8, os blocos de Tirar ruído; D13), com progresso na janela de exportar por `export:progress` e Cancelar por `export:cancel`; `abortAllExports`, o aviso ao recarregar (`will-prevent-unload`) e o `will-quit` passam a vê-la e limpam processos e temporários. Só depois vêm a mixagem e o ffmpeg, e o renderer começa a mandar quadros. Se algo ainda faltar, a exportação falha com mensagem clara; nunca usa o original no lugar do processado.
- **Tempo de exportar:** num vídeo longo, o que pesa é o laço de quadros, não o áudio (ver Riscos). A E5 mede o tempo por quadro no Windows, e a janela de exportar mostra a estimativa antes de começar.
- **Removido na mesma entrega:** a exportação provisória de D2 e a mixagem pelos elementos.
- **Paridade:** o PCM tirado do worklet é igual bit a bit ao da exportação (mesmo V8). Comparações que passam pelo ffmpeg (AAC) usam tolerância de SNR, nunca md5.

#### D5. Trechos abaixados (entrega 6), volume e fades (entrega 7)

- **Entrega 6 (v3):** `ducks: [{s, e, gainDb, fadeMs, tag}]` no clipe de vídeo, guardados em **segundos da fonte**: aparar, dividir e apagar trecho não precisam remapeá-los, e as marcas de respiração (também em segundos da fonte) entram direto.
  - Remapear não é preciso; repartir é. `splitClip` e as divisões feitas por `removeRanges` repartem os `ducks` pelo ponto de corte na fonte: o pedaço da esquerda fica com os que começam antes do ponto, o da direita com os que terminam depois, e um que atravessa vai para os dois, recortado. `trimClip` pode manter os de fora, para que voltar a aparar os traga de volta. Copiados inteiros, cada um dos ~1.000 pedaços de uma hora levaria todos os trechos (medido: 34 MB de JSON e 465 ms por clone).
  - Operações `duckRanges {clipId, ranges, gainDb, fadeMs, tag}` (segundos da fonte daquele clipe; até 500 trechos por chamada direta, e a expansão do `cleanSpeech` não tem esse teto; idempotente por tag: trechos da mesma tag que se sobrepõem são trocados; nunca `all: true` entre mídias) e `clearAudioRanges {clipIds?, tag?}`.
  - Na faixa Áudio, blocos dos trechos abaixados; no `get_context`, um resumo deles. As listas de chaves, o describeOp, o OPS_HELP, o compactClip e os testes mudam junto.
- **Entrega 7 (v4):** `volume` vira propriedade do registro `PROPS`: dB, −60 a +12, keyframes interpolados em dB. `status` e `compactClip` passam a ler o registro em vez de `['x','y','scale','opacity']` fixo.
  - `muted` continua no clipe. Entram `fadeIn` e `fadeOut` (em segundos, no máximo metade da duração) e `Track.muted`, o mudo da faixa.
  - Volume se muda com `setProperty` ou `setKeyframe`. Mandar `volume` em `updateClip` dá erro explicando a mudança.
- **Migração v3 → v4:** `volume dB = 20·log10(v)`, e v = 0 vira −60 dB, que o mixer trata como silêncio.
- **Interface (entrega 7):** bloco "Áudio" em Propriedades (Volume em dB com botão de keyframe, Fade de entrada e saída, Mudo, lista de trechos abaixados); na faixa Áudio, alças de fade nos cantos e uma linha de volume opcional; o botão de mudo da faixa vira o mudo de verdade; com um trecho marcado, "Abaixar" e "Silenciar".

#### D6. Legendas: estilo, desenho e fontes (entrega 2)

- **Modelo:** `CaptionStyle` em unidades relativas (tamanho em % da altura do quadro, contorno, sombra e caixa em em, posição em %) e `CaptionClip {text, words?, style, preset}` com `words: [{t, s, e, c?, k?, br?}]` relativos ao clipe. Tudo conforme `legendas.md`, "Concrete plan" itens 1 a 5, com as correções abaixo. Na legenda, o `style` guarda só o que difere do preset, e o estilo completo é resolvido no desenho: num projeto de 1 h isso tira uns 30% de cada entrada do histórico (D9).
- **Desenho em `render.ts`:**
  1. caixa;
  2. caixa da palavra ativa;
  3. todos os contornos, com a sombra só nesta passada;
  4. todos os preenchimentos;
  5. a palavra de cima (ativa com escala), com a própria sombra multiplicada pela escala, porque sombra de canvas ignora a transformação.
  - Contorno com `lineJoin` e `lineCap` `round` e `lineWidth` igual a 2 vezes o contorno visível.
  - Opacidade menor que 1 desenha numa camada reaproveitada, criada com o mesmo `willReadFrequently` do destino.
  - Layout em cache (LRU) pela chave de estilo, texto, tamanho do quadro e época das fontes.
- **Presets:** `amarelo` (padrão), `karaoke`, `palavraCaixa`, `caixa`, `impacto` e `classico`, com os valores de `legendas.md` §2. No vertical, nenhuma linha pode entrar na coluna de botões do TikTok à direita (x > 780 a partir de y = 840 num quadro de 1080×1920). A largura máxima e o centro padrão do retrato são ajustados para isso, e a sobreposição de áreas seguras avisa quando uma linha cruza a coluna. A regra vale só em 9:16, mede a linha com o contorno (borda direita abaixo de 780 px a partir de y = 840 em 1080×1920), vem ligada e é desligada se o usuário não publica no TikTok. Não usar a alternativa da pesquisa "centro em 45% com largura até 61%", que chega a ~815 px. Amarelo é o padrão em todos os formatos, também no vídeo deitado e longo (decisão do Claude): uma hora dá umas 3.000 legendas, contra ~700 no Clássico, e os orçamentos do histórico (D9), do `get_context` (D10) e da aba Transcrição (D11) são dimensionados para isso.
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
  1. trecho da linha do tempo → trechos da fonte dos clipes audíveis (não mudos, volume acima de −60 dB depois da entrega 7, faixa não muda). Trechos da mesma mídia separados por vãos de até ~2 s na fonte (como os cortes de respiração) são unidos antes do VAD: VAD e transcrição rodam uma vez por trecho unido, o cache marca o trecho unido como transcrito, e as palavras que caem em partes cortadas são descartadas ao montar as legendas. Sem isso, uma hora depois de Limpar fala daria uns mil trechos minúsculos, cada um com seu processo;
  2. áudio do cache D3 → 16 kHz mono;
  3. VAD → segmentos com os parâmetros da fala (`-vspd 250 -vsd 300 -vp 200 -vmsd 25`, conferidos no `--help` do exe embutido), rodando na pasta do job com caminhos relativos ASCII (o exe do VAD também lê argv em ANSI). A saída do exe é em **centésimos de segundo**, e um teste do CI fixa o formato contra o binário embutido. Esses segmentos servem só para a transcrição; as respirações têm passada própria (D8);
  4. `speech.wav` = segmentos unidos por 0,4 s de silêncio, mais a tabela de mapeamento, em lotes de até uns 5 min de fala;
  5. `whisper-cli` com `cwd` numa pasta do job dentro de `userData/stt` e caminhos relativos ASCII. Quando algum argumento tem acento (o prompt, por exemplo), todos vão num arquivo de resposta UTF-8 com fim de linha LF, passado como único argumento (`whisper-cli.exe @args.txt`). Flags: `-l pt -nfa -dtw large.v3.turbo -ojf -sns -np -pp -t <núcleos físicos − 1, mínimo 2, até 8>` (D9). Nunca `--vad` e nunca `-p` maior que 1. O prompt é uma frase curta em pt-BR com pontuação e, com `-mc 64 --carry-initial-prompt`, tem de caber em uns 63 tokens. Medir `-bs 1 -bo 1` contra o beam 5 padrão em velocidade e acerto antes de escolher: o vencedor vira o padrão de todos, não uma opção do usuário;
  6. tokens com tempo DTW → palavras com confiança → de volta ao tempo da fonte pela tabela;
  7. filtros de alucinação: texto fora da fala do VAD é descartado, repetições em laço são desfeitas e frases conhecidas ("Legendas pela comunidade Amara.org" e parecidas) são barradas;
  8. a transcrição fica em cache por mídia, em tempo da fonte (`userData/stt/cache/<chave>/`). Editar o projeto durante um job longo não o invalida. Cada lote, ao terminar, é gravado de forma atômica (`.tmp` + rename) com o trecho da fonte que cobre, o modelo e a versão dos parâmetros. Gerar de novo com o mesmo modelo continua do primeiro trecho que falta, sempre numa borda de silêncio do VAD, e palavra cujo meio cai num trecho já feito é descartada. Trecho feito com o Mais rápido não conta como feito para o Preciso (a janela mostra quantos minutos já foram transcritos com o Mais rápido e pergunta se refaz); trecho feito com o Preciso vale para os dois. Este cache não sai junto com o PCM: tem teto próprio (uns 200 MB; os mais antigos saem primeiro, nunca os do projeto aberto), porque uma hora de transcrição pesa ~1 MB e leva de 40 min a 3 h para refazer. A chave usa tamanho, duração e um hash do começo e do fim do arquivo, não o caminho, para sobreviver a mover a pasta.
- **Paginação** (`src/core/captions/chunker.ts`) segue as regras de cada preset (`legendas.md` §2): quebra na pontuação e em pausas (0,35 s nos estilos curtos, 0,6 s no Clássico); nunca termina uma página em palavra de função ("a", "de", "que", "pra"…); a página dura do início da primeira palavra até 0,15 s depois da última, sem passar o começo da próxima. No Clássico, 42 caracteres por linha e 17 caracteres por segundo (o construtor pode usar 20, o limite de SDH).
- **Resultado:** um rascunho local que troca as legendas que encostam no trecho.
  - As palavras vêm primeiro das legendas que já têm `words` (texto, tempos, `c` e `k`, só as de dentro do clipe). A transcrição (do cache, transcrevendo só o que falta) preenche só as partes da linha do tempo que essas legendas não cobrem, e uma palavra do cache cujo meio cai dentro de uma delas é descartada.
  - Legendas sem `words` são trocadas como antes.
  - Tudo é paginado com o preset escolhido na janela (Amarelo por padrão). O modelo só é pedido se alguma parte precisar ser transcrita. O cartão diz que o texto existente foi mantido.
  - Reagrupar (por exemplo, de Amarelo para Clássico) é este mesmo caminho sem nada para transcrever. Para escutar de novo do zero, o usuário apaga antes as legendas do trecho.
- **Progresso** vem de `progress = N%` no stderr. A estimativa de tempo vem do primeiro lote, não de uma calibração curta (um clipe de 20 s ainda paga uma janela inteira de 30 s e a carga do modelo), e é refeita a cada lote, porque em jobs de 40 min a 3 h o notebook esquenta e fica mais lento. O tempo medido (sem a carga do modelo) aparece no cartão do resultado e fica salvo para a estimativa do próximo job. Como o usuário faz vídeos longos, a entrega 4 já traz o "Mais rápido": `ggml-small` q8_0 no mesmo `whisper-cli` (264 MB, SHA-256 fixado, baixado só no primeiro uso dele, com cartão de licença próprio, `-dtw small`), o plano B da própria pesquisa ("Fallback").
- **Preciso ou Mais rápido:** o Preciso é o padrão e roda em segundo plano. A janela mostra a estimativa dos dois pelo tempo medido (antes da primeira medição, pelos números de "User-facing constraints" de `fala-para-texto.md`, marcados como não medidos) e sugere o Mais rápido só quando o PC é lento para aquele trecho (Preciso acima de ~1,5× a duração da fala), dizendo o custo: quase o dobro de palavras erradas (FLEURS-pt: 7,65% contra 4,17%), umas 300 a mais para conferir num vídeo de 1 h. Sem medição ainda, começa no Preciso; depois das primeiras janelas de 30 s, mostra a estimativa e oferece trocar para o Mais rápido sem perder o que já foi feito (item 8 do pipeline).
- **Medição:** a E4 mede o turbo e o small com as opções finais (`-nfa`, `-dtw` e o beam escolhido) no CI e no PC do usuário, e os números da Parte 1 são atualizados. Os de hoje vêm de testes sem essas opções, e a diferença de velocidade entre os dois pode encolher com o beam 5.
- **Testes:** `DIRETOR_WHISPER_CLI` e `DIRETOR_WHISPER_VAD` apontam para `scripts/stt-simulada.mjs` no Linux e no e2e, como já se faz com o ffmpeg e as CLIs da IA.

#### D8. Respirações e pausas (entrega 6)

- **Detecção** é um job no main com uma passada própria do exe do VAD com parâmetros de respiração (folga até 30 ms, silêncio mínimo ~100 ms, fala mínima ~100 ms; conferir no `--help`), guardada em `audio-cache/<srcKey>/` à parte dos segmentos de D7, cuja folga de 200 ms esconderia as pausas curtas, e o classificador DSP em TypeScript de `respiracoes.md` ("Concrete plan" itens 3 a 5), em `src/core/speech/`. Como o exe do VAD só devolve segmentos, sem probabilidade por janela, o classificador trabalha com a máscara binária: as referências de nível vêm de dentro (fala) e de fora (não fala) dos segmentos, e o refinamento das bordas usa só sinais acústicos (periodicidade e nível). Nada de onnxruntime no bloco 1. Bordas e folgas vêm da borda acústica da fala, sem precisar de transcrição; nenhum corte cobre quadros com voz; com transcrição, nenhum corte entra numa palavra. O classificador roda em blocos de ~1 s cedendo com `setImmediate`, como a mixagem da exportação, para não segurar a ponte MCP nem o IPC dos quadros (uma hora são ~360 mil janelas de 10 ms).
- **Marcas** (respiração, pausa, estalo, incerto, e "música/ruído" por mídia) ficam no cache (`userData/audio-cache/<srcKey>/marks.json`) e num store do renderer, nunca no `Project`. Só o resultado aplicado (cortes ou trechos abaixados) entra no projeto.
  - "Música/ruído" vale para música, TV e outra voz junto da fala (som tonal ou que não é estacionário): aviso e nada marcado. Ruído alto e estável (ventilador, chiado) não impede marcar: as marcas seguem as regras normais, e a partir da E8 a revisão sugere Tirar ruído. São justamente as gravações que a E8 limpa.
- **Revisão:**
  - um item por vão: "Respiração" se o vão tem respiração (nota ≥ 0,4), senão "Pausa" (só se o vão passa da pausa mínima; no modo Abaixar, só respirações);
  - pílulas (respiração) e colchetes com a duração (pausa) na faixa Áudio;
  - barra "Respiração 3 de 41" ou "Pausa 5 de 41"  [<] [>]  Ouvir (Espaço)  Manter/Aplicar (Enter)  Sair (Esc); cada item diz o que aplicar faz (cortar ou abaixar);
  - Ouvir toca o item em Depois (1,5 s antes e 1 s depois); com Antes ligado, o mesmo trecho do original;
  - a barra também tem "próximo duvidoso" (como o Tab da Transcrição: só os desmarcados de 0,4 a 0,7 e os incertos) e as ações em lote "Marcar todas acima de X" e "Desmarcar incertas";
  - os atalhos globais (Espaço, Delete, setas) são interceptados enquanto a revisão está aberta;
  - vêm marcados os cortes de pausa e as respirações com nota ≥ 0,7; vêm desmarcadas as de 0,4 a 0,7, todo "incerto" e tudo numa mídia com "música/ruído"; "estalo" só aparece na faixa;
  - resumo "N respirações e M pausas · vídeo −X s", com X somado dos cortes já unidos;
  - o Antes/Depois (D2) também vale para o rascunho que só abaixa.
- **Aplicar** gera um único rascunho local com o que está marcado; não é preciso visitar cada item (num vídeo de uma hora são centenas).
  - **Cortar (padrão):** `removeRanges` calculado das marcas no momento de preparar a etapa, passando por `sourceTime`.
    - Só se corta vão com pelo menos a pausa mínima do ritmo, e o corte deixa a sobra do ritmo; assim, nenhum corte é menor que pausa mínima − sobra (0,3, 0,2 ou 0,1 s).
    - Fica pelo menos 100 ms depois do fim acústico da fala e 50 ms antes da próxima; a sobra se divide 60/40: depois = máx(100 ms; 0,6·sobra), antes = máx(50 ms; sobra − depois). Essa folga protege as vogais finais desvozeadas do pt-BR e o /s/ final.
    - Cada borda do corte vai para o ponto mais baixo em ±10 ms, sem invadir as folgas.
    - Ritmo: Natural (pausa mínima 0,6 s, sobra 0,3 s), Dinâmico (0,4 s e 0,2 s; padrão) e Acelerado (0,25 s e 0,15 s). As folgas valem mais que o ritmo.
    - Com transcrição, os tempos das palavras ajudam a achar os vãos, mas as bordas seguem a evidência acústica.
    - Nenhum corte deixa um pedaço com menos de 0,4 s: pula-se o corte menor, e a respiração dele é abaixada.
    - A respiração que sobra na parte mantida, a de um vão menor que a pausa mínima e a de um corte pulado entram como `duckRanges` com a tag `breath` no mesmo rascunho (como no passo 6b de `respiracoes.md`).
  - **Abaixar:** nada é cortado; as respirações marcadas vão em `duckRanges` com a tag `breath`, −20 dB (Leve −12, Forte −30), rampas de 25 ms, nunca abaixo do ruído de fundo (com Tirar ruído ligado, o fundo medido nos blocos processados; D13).
- **IA:**
  - `analyze_audio` inicia o job e devolve um `jobId`;
  - `get_job` espera o resultado;
  - `get_analysis('marks')` traz os itens em segundos da linha do tempo, em linhas `[s, e, tipo, ação, nota]` e páginas de até 6 KB (D10), com a revisão;
  - a macro `cleanSpeech {analysisId, modo: 'cortar' | 'abaixar', ritmo?, forca?}` usa as decisões da revisão guardadas nas marcas e é resolvida numa etapa quando ela é preparada: `clearAudioRanges {tag: 'breath'}`, depois `duckRanges` por `clipId` (segundos da fonte, antes dos cortes), depois `removeRanges`. A sessão passa as marcas para o `applyOps`, e a IA nunca lista centenas de trechos.
- **Nota legal** herdada da pesquisa: a patente Dolby US10825464 cobre classificação de respiração combinada com nivelamento automático de ganho. Não há nivelamento automático junto da cadeia de respiração no bloco 1, e qualquer normalização futura fica fora dela até ser revista.

#### D9. Rascunhos locais, jobs e downloads (entrega 4, ou 6 se as respirações vierem antes; usados depois)

- **Propostas** ganham `origin: 'ai' | 'diretor'`. Rascunhos do próprio Diretor (legendas, limpar fala) aparecem no painel direito com a origem "Diretor" e têm "Refazer" local, sem passar pelo `chat.ownerOf`. Se já há uma proposta da IA aberta, o Diretor pergunta se troca.
- **Gerenciador de jobs** no main: iniciar, progresso, cancelar e resultado; deduplicação por chave; aborto em `did-start-loading`, `render-process-gone`, `closed` e `will-quit`, como `abortAllExports`; pastas temporárias limpas.
  - **Fila e prioridade:** primeiro o que o usuário está esperando (exportação), a transcrição por último; exportar pausa a transcrição (cancela o lote em curso e retoma depois pelo cache, D7 item 8). Os blocos de Tirar ruído têm fila própria (D13) e não esperam uma transcrição. Processos de fundo rodam com prioridade abaixo do normal (`os.setPriority` com `PRIORITY_BELOW_NORMAL`), e o whisper com `-t` = núcleos físicos − 1 (mínimo 2). Enquanto houver transcrição ou exportação, `powerSaveBlocker.start('prevent-app-suspension')` impede o PC de dormir.
- **Gerenciador de download** dos modelos, como em D7.
- **Histórico:** palavras e muitos pedaços engordam os snapshots (medido num projeto de 1 h com ~2.000 pedaços e ~3.000 legendas: 7,3 MB e 52 ms de clone por entrada; 200 entradas dariam ~1,5 GB). O limite fixo de 200 entradas vira um orçamento de uns 300 MB, com pelo menos 30 passos de desfazer nesse projeto. O tamanho de cada entrada é estimado pela contagem de clipes e palavras, não por `JSON.stringify` a cada edição. Se o orçamento não der 30 passos, `applyOps` passa a copiar só os clipes tocados (cópia rasa do projeto e da lista, clone por clipe), e cada entrada fica do tamanho do que mudou.

#### D10. IA (MCP) e modo econômico

- **Ferramentas novas:**
  - `generate_captions {t0?, t1?, preset?, modelo?}` → `{jobId, modelo, etaMin}`; sobre trecho com legendas, reaproveita as palavras delas, e é também como a IA reagrupa, com `{preset}`. Um job pedido pela IA com `etaMin` acima de 10 pede confirmação ao usuário num cartão;
  - `analyze_audio {t0?, t1?}` → `jobId`;
  - `get_job {jobId, wait ≤ 45}`, com a mesma exceção de espera longa do `get_proposal` em `bridgeTimeoutMs` e `callTimeoutMs`; devolve o progresso e o `etaMin`. As INSTRUCTIONS dizem para não esperar job com `etaMin` acima de ~2 min: avisar o usuário e voltar depois;
  - `get_analysis {kind: 'transcript' | 'marks', range?, cursor?, duvidosas?}`, em páginas limitadas por bytes (≤ 6 KB), com linhas em lista e a revisão. "transcript" vem por legenda, `[clipId, início, texto, [índices duvidosos]]` (~50 B por legenda de 3 palavras), e `duvidosas: true` traz só as legendas com alguma palavra de `c` < 0,5; "marks" vem como `[s, e, tipo, ação, nota]`. A IA corrige com `setCaptionWords` ou `updateClip set.text`. O OPS_HELP e as INSTRUCTIONS dizem o mesmo, e que num vídeo longo (~9.000 palavras por hora) a IA corrige pelas duvidosas, sem ler a transcrição inteira.
  - A lista exata de ferramentas em `tests/mcp.test.ts` muda junto. As descrições são curtas; a ajuda longa fica no `editor_status` e no OPS_HELP.
- **Operações novas no OPS_HELP (pt-BR):** splitClip, removeRanges (com a regra de mais de 500 trechos, D2), setCaptionStyle, setCaptionWords, markWords, duckRanges, clearAudioRanges, cleanSpeech e setDenoise (E8); volume em dB como propriedade. `assistant.ts INSTRUCTIONS` muda junto.
- **get_context:**
  - legenda como `{id, kind, start, dur, text, preset}` mais `custom: 1` quando o estilo difere do preset;
  - `words` só com `include: ['words']` ou para clipes selecionados;
  - pedaços seguidos da mesma mídia, contíguos ou com cortes entre eles, viram uma corrida `{media, pedaços, início, fim, cortado}`; a corrida só junta pedaços com o mesmo `denoise`;
  - com mais de ~300 clipes, `include: ['timeline']` sem `range` devolve um resumo por minuto (pedaços, segundos cortados, começo das legendas); a lista completa vem só por `range`;
  - trechos abaixados em resumo.
  - O teto de 6 KB continua valendo com o modo econômico ligado, e um teto absoluto de uns 60 KB vale também com ele desligado (medido: a linha do tempo inteira de 1 h daria 1,9 MB). Teste: o `get_context` de um projeto de 1 h fica ≤ 6 KB no econômico e ≤ 60 KB desligado.

#### D11. Interface numa tela só

Segue o esboço da Parte 1 e "One screen" de `mapa-do-codigo.md`:

- **Sem faixas novas:** forma de onda, fades, trechos abaixados e marcas dividem a faixa Áudio.
- **Barra da linha do tempo:** Dividir, Apagar trecho, Gerar legendas e Limpar fala.
- **Gerar legendas** abre uma janela no estilo da de exportar: trecho, estilo, idioma e o cartão de download no primeiro uso. O progresso aparece como uma faixa dentro da linha Legendas, com Cancelar. O resultado chega como cartão de rascunho no painel direito.
- **Propriedades:**
  - de uma legenda: galeria de estilos com miniaturas desenhadas pelo próprio `drawCaption`, mais Fonte, Tamanho, Cor, Contorno, Sombra, Caixa, MAIÚSCULAS, Espaçamento, Posição (Centro, Abaixo do centro, Embaixo, e arrastar na prévia), Destaque da palavra e Animação de entrada (nenhuma, surgir ou pop);
  - de um vídeo: o bloco Áudio, com "Tirar ruído" (Desligado, Leve ou Forte) a partir da entrega 8.
- **Prévia:** botão "Áreas do TikTok/Reels/Shorts", só uma sobreposição na tela, nunca exportada. A área do Shorts vem do modelo oficial de anúncio vertical do Google e é marcada como aproximada. A sobreposição mostra a interseção das áreas do TikTok, Reels e Shorts até o usuário dizer onde publica; depois, as plataformas dele.
- **Aba Transcrição** (entrega 9): mostra as palavras das legendas da linha do tempo, em ordem (`mapa-do-codigo.md` F4c), sem precisar do cache; palavras em chips; as de baixa confiança sublinhadas; clique leva até a palavra; duplo clique edita; Tab vai para a próxima duvidosa; "Substituir em tudo".
  - A aba é virtualizada: uma linha por legenda e só as linhas visíveis no DOM, memorizadas por clipe. A palavra atual é destacada por um assinante próprio da reprodução, que troca a classe de um chip sem re-renderizar a lista; Tab rola até a próxima duvidosa. Uma hora tem ~9.000 palavras em ~3.000 legendas.
  - Editar é `setCaptionWords` ou `updateClip` naquela legenda: uma entrada no histórico, ou um ajuste se ela está num rascunho aberto.
  - "Substituir em tudo" é um lote só, fica desligado com um rascunho de legendas aberto (o `shouldRouteToDraft` levaria o lote inteiro para o rascunho) e não vale para trechos legendados depois.
  - As correções ficam só nas legendas: não há tabela de correções no `Project` nem escrita no cache. Uma correção dentro de uma legenda apagada se perde (o Ctrl+Z traz de volta).

#### D12. Empacotamento e testes

- **CI:** passo de download dos binários de fala antes do `test:e2e` e do `dist`; `vendor/` no `.gitignore`.
- **after-pack:** confere os arquivos e as importações dos PE.
- **"Sobre > Licenças":** whisper.cpp (MIT), Whisper (MIT), Silero VAD (MIT), o texto completo da OFL 1.1 e da Apache 2.0 com o copyright de cada fonte, e o crédito do modelo RNNoise do Tirar ruído (sem licença: o autor declara que os modelos não estão sujeitos a direito autoral; D13).
- **Testes por entrega:** unitários (vitest) e e2e (Electron com xvfb no Linux e o app instalado no CI do Windows), com binários falsos por variável de ambiente. Os testes de aceite estão na tabela de entregas.

#### D13. Tirar ruído (entrega 8)

- **Ajuste por clipe de vídeo:** `denoise?: 'leve' | 'forte'` (sem o campo, desligado). `updateClip set.denoise` aceita `'off' | 'leve' | 'forte'`, e `'off'` apaga o campo; assim a interface e a IA conseguem desligar (hoje o `updateClip` recusa `null`, e omitir o campo quer dizer "não mudar"). O `parseProject` descarta valor desconhecido (fica desligado), e a migração v4 → v5 não grava nada. O campo entra em CHANGE_KEYS e no tipo `ClipChanges`; em título ou legenda, o erro passa a dizer "in, volume, muted e denoise só valem para vídeo". O describeOp diz "Tirar ruído: Forte" (ou "desligado"), o OPS_HELP mostra `"denoise"?("off"|"leve"|"forte")`, e o compactClip só mostra o campo quando ele existe. `splitClip` copia o ajuste para as duas partes (D2). Testes unitários: valor válido e inválido, `'off'`, só em vídeo, `splitClip` copiando, parse e migração.
- **Vários clipes:** a macro `setDenoise {clipIds: 'all' | ids, nivel: 'off' | 'leve' | 'forte'}` é expandida ao preparar em um `updateClip` por clipe, como o `setCaptionStyle`, e entra no OP_KEYS, no OPS_HELP e no describeOp ("Tirar ruído em N clipes"). Depois de limpar a fala, uma hora tem uns mil pedaços, e a IA não teria como mandar um por um.
- **Interface:** no bloco Áudio, "Tirar ruído: Desligado / Leve / Forte" vale para o clipe selecionado (o Diretor não tem seleção múltipla), com "Aplicar a todos os clipes" ao lado e, com um trecho marcado na régua, "Aplicar no trecho" (os clipes de vídeo que encostam nele). Os dois botões usam `setDenoise` e ficam desligados com um rascunho aberto, como o "Substituir em tudo" de D11.
- **Cadeias,** só a redução de ruído do "Melhorar voz" da pesquisa, sem de-esser, compressor ou limitador:
  - leve = `highpass=f=70,afftdn=nr=10:nf=-50:tn=1`;
  - forte = `highpass=f=90,arnndn=m=<modelo>.rnnn:mix=0.85`. O modelo é escolhido por medição antes de fixar, entre `sh` (fala), `bd` (voz, mantém risadas) e `cb` (sinal geral, mantém música), do mesmo repositório e no mesmo formato. Fixtures: fala real com ruído, com música, com risadas e com fala de banda estreita. Critérios: voz a −2 dB ou mais, quanto o ruído cai nas pausas e nenhuma mudança de nível entre blocos. Medido com música de fundo: o `sh` baixou a música nas pausas em 7 a 10 dB, o `cb` em ~1 dB; e o `sh` foi o único dos cinco modelos testados cujo resultado dependia de onde o processamento começava.
  - `chainHash` = hash do texto da cadeia, do SHA-256 do modelo, da versão do ffmpeg (primeira linha de `-version`), da pré-rolagem, do tamanho do bloco, da sobreposição e do atraso medido. Blocos feitos com qualquer um desses diferente nunca se encontram numa emenda.
- **Blocos:** um job no main roda o ffmpeg embutido sobre o `base.s16` e grava em `audio-cache/<srcKey>/fx/<chainHash>/`. Cada bloco cobre 30 s mais 50 ms de sobreposição.
  - **Pré-rolagem por cadeia,** cortada depois (`motor-de-audio.md` item 4): Leve 5 s, Forte 20 s (ou o que a medição mostrar), sempre múltipla de 50 ms para manter a grade dos filtros (480 e 600 amostras). O RNNoise demora a convergir: medido no Forte, os dois blocos diferem na sobreposição em −12 dB do sinal com 5 s de pré-rolagem e em −51 dB com 20 s. O Forte passa de uns 35/30 para 50/30 do tempo do áudio (cerca de 1,9 min de CPU por hora de mídia estéreo no Xeon da pesquisa).
  - Depois de gravar o bloco n+1, o job compara os 50 ms de sobreposição com o bloco n. Se a diferença passar de −30 dB do sinal, refaz o n+1 com pré-rolagem desde o início do bloco n; se continuar, avisa no clipe.
  - Cada bloco é gravado como `tile-n.s16.part` e renomeado quando o ffmpeg sai com 0 e o tamanho confere. O plano só usa blocos completos, e o `media://audio` nunca serve `.part`.
- **Atraso compensado** (correção da checagem): o atraso de cada cadeia é medido em tempo de execução com um impulso, por cadeia, modelo e versão do ffmpeg (na checagem: afftdn 1200 amostras = 2·48000/80, arnndn 480), e entra no `chainHash`. Os dois filtros não esvaziam a linha de atraso no fim: a saída tem o tamanho da entrada.
  - O ffmpeg lê pré-rolagem + bloco + 50 ms + atraso, em amostras exatas do `base.s16`, e a saída é cortada com `atrim=start_sample=<pré + atraso>:end_sample=<pré + atraso + bloco + 50 ms>` (no fim da mídia, até o fim dela).
  - No último bloco da mídia, a entrada ganha zeros antes da cadeia (`apad=pad_len=<atraso>` no início do `-af`), para o filtro devolver as últimas amostras de verdade.
  - Nunca `apad` depois da cadeia, e nunca `apad` sem `pad_len` ou `whole_len`: sem limite, o ffmpeg grava até encher o disco. Com o `apad` depois da cadeia, o fim de cada bloco ficaria em silêncio dentro da emenda.
- **Mixer:** o plano escolhe, por segmento, o áudio original ou o processado. A leitura dos blocos faz crossfade de ganho constante (cos² sai, sen² entra; os ganhos somam 1) nos 50 ms de sobreposição, porque os dois blocos têm o mesmo som; igual na prévia e na exportação. Numa borda contígua na fonte em que só o Tirar ruído muda (original, Leve, Forte), o crossfade também é de ganho constante, com 50 ms. O equal-power da regra (b) de D4 vale só para cortes entre trechos diferentes: em som igual, ele soma até +3 dB (medido: +2,8 dB no meio de cada emenda, a cada 30 s; com ganho constante, 0,0 dB).
- **Estado dos blocos** (quem pede e quem avisa):
  1. O plano continua puro: cada segmento leva `{srcKey, fx: nenhum | 'leve' | 'forte'}` só pelo ajuste do clipe, nunca por estar pronto.
  2. Uma função única em `src/core/audio` lê as fontes: faz o crossfade entre blocos e, só na prévia, troca um bloco que falta pelo original. O Worker e o main usam a mesma função; na exportação, depois de "Preparar o áudio" (D4), arquivo faltando é erro.
  3. O renderer manda ao main `audio:fxDemand {srcKey, nível, trechos da fonte, agulha}`, calculado da `session.view` (com rascunhos, então uma sugestão da IA já é processada enquanto o usuário a confere), ao editar, buscar e dar Play. Os trechos levam as alças dos crossfades de borda (até 25 ms de cada lado). O main mantém a fila própria dos blocos por `(srcKey, chainHash, n)`, sem repetir blocos: primeiro os da agulha e logo depois dela, depois os da exportação em curso, depois todos os outros usados no projeto. Os blocos pedidos ficam presos no LRU.
  4. O main avisa `audio:fxReady {srcKey, chainHash, n}` e o progresso. O renderer repassa ao Worker, que passa a ler o processado, e à faixa, que tira o selo.
  5. O main expõe `audio:fxChains → {leve, forte}` com o `chainHash` de cada um, para o Worker montar a URL dos blocos.
- **Enquanto processa,** a prévia toca o som original daquele trecho, com o selo "Tirando ruído…" no clipe. Como o áudio que ainda está sendo preparado (D3), é uma exceção sempre visível; a exportação nunca usa o original no lugar do processado. Quando um bloco fica pronto durante a reprodução, a troca do original para o processado é feita com um crossfade de ganho constante de 50 ms, para não estalar.
- **Exportar:** a fase "Preparar o áudio" do job de exportação (D4) também pede e espera os blocos do projeto exportado, com "Tirando ruído… N%" na janela de exportar e Cancelar. A demanda da exportação fica registrada à parte da prévia e prende esses blocos no LRU até a exportação acabar, então trocar o nível durante a exportação não a trava. Um bloco com erro (disco cheio, modelo ausente) encerra a espera com a mensagem dele.
- **Modelo:** o arquivo escolhido (hoje `sh.rnnn`, 297.646 bytes, SHA-256 `70bb6685eb0c2a1d18e2918dca3fbfbd39317010b1802eb1b6ea73a92f3fdec0`, de um commit fixado do repositório rnnoise-models citado na checagem de `motor-de-audio.md`) fica versionado em `assets/models/`, fora do `vendor/` ignorado, com `*.rnnn -text` no `.gitattributes`: o checkout do Windows trocaria LF por CRLF e mudaria o hash. O autor declara no README que os modelos não são obra criativa e não estão sujeitos a direito autoral; não há licença, e o crédito vai em "Sobre > Licenças" (D12).
  - No `package.json`, `build.extraResources` (em `build`, não só em `build.win`) ganha `{ "from": "assets/models", "to": "models" }`, fora do asar.
  - O main acha a pasta como acha o ffmpeg: `DIRETOR_MODELS_DIR` em desenvolvimento e no e2e, `join(process.resourcesPath, 'models')` no app empacotado e `assets/models` do repositório sem empacotar.
  - O ffmpeg roda com `cwd` nessa pasta, para o filtro não precisar escapar `C:` (um caminho com `,`, `:` ou apóstrofo quebra o filtro); entrada e saída vão com caminho absoluto.
  - Um teste unitário confere o SHA-256, e o after-pack (que roda depois de copiar os extraResources) confere `resources/models/` com o tamanho e o SHA-256 fixados.
- **Respirações e transcrição** continuam lendo o áudio original, e a forma de onda mostra o original. Com Tirar ruído ligado: ruído estável não impede marcar respirações (D8); o "nunca abaixo do ruído de fundo" do Abaixar usa o fundo medido nos blocos processados, quando existem; e a revisão diz quando o Forte já abaixou as respirações (ele leva o que não é fala para perto de −16,5 dB).
- **Disco:** cada nível usado custa mais uns 0,7 GB por hora de mídia, no mesmo LRU de D3, e o espaço livre é conferido antes de processar (D3).
- **Música, risadas e vozes:** nenhum dos dois níveis separa vozes: TV e outra pessoa falando continuam. O Forte com o `sh` tira a música de fundo nas pausas e as risadas; o bloco Áudio avisa. O Leve mexe menos (música nas pausas ~−0,7 dB).
- **IA:** `updateClip {set: {denoise}}` num clipe e `setDenoise` para vários; o `get_context` mostra o nível no clipe.
- **Testes:**
  - fixtures de fala real gravada (domínio público ou CC0, inclusive uma de banda estreita, 16 kHz), misturada no código com ruído rosa, ventilador, música, risadas e TV, para ter a referência limpa;
  - métricas com tolerância (nunca md5: o ffmpeg muda bits conforme a CPU): queda do ruído nas pausas (o construtor fixa o mínimo), voz a −2 dB ou mais e SI-SDR melhor que o original;
  - emendas bloco a bloco contra o processamento contínuo: um sinal estacionário não sobe nem desce mais de 0,2 dB; nas fixtures de fala com ruído, música e risadas, a emenda fica a ±0,5 dB e a voz não muda mais de 1 dB entre blocos;
  - os últimos 50 ms de cada bloco e o fim da mídia batem com o processamento contínuo;
  - no CI do Windows, com o ffmpeg 6.1.1 do instalador: o atraso medido é o da estrutura dos filtros (1200 e 480); o bloco compensado correlaciona em atraso 0 com o `base.s16` passado pelo mesmo highpass; e, contra o `base.s16` cru, o desvio fica em no máximo 1 amostra (o highpass desloca a fase dos graves);
  - um bloco ainda sendo gravado nunca é lido; paridade do PCM do worklet com a exportação para os mesmos blocos; cancelar; LRU contando os blocos.

### Entregas

Cada entrega é um PR, mesclado quando o CI do Windows passa (autorização do usuário no projeto), e publicado como atualização automática.

| # | Entrega | Pesquisa (fatia) | Depende de | Aceite (além dos testes unitários) |
|---|---|---|---|---|
| E1 | Dividir e apagar trecho | S1 | — | Ctrl+B divide; Shift+Delete apaga o trecho em todas as faixas e as legendas continuam sincronizadas; a reprodução passa pelas emendas sem tela preta; exportar 300 pedaços de uma mídia de 1 h funciona no Windows, com o tempo do áudio medido no CI; uma divisão sem corte sai perfeita no áudio exportado. |
| E1b | Exportação rápida para vídeos longos | "Exportação lenta em vídeo longo" (Riscos) | E1 | Design e aceite próprios, escritos e aprovados antes de construir. |
| E2 | Visual das legendas | S2 + `legendas.md` | — | Os 6 presets saem iguais na prévia e no MP4 (diff com tolerância); contorno ajustável; fontes embutidas e do computador; arrastar a posição; projeto v1 abre com o mesmo visual; arquivo v3 é recusado; imagem testada em 1080×1920 e 1920×1080; com a regra do TikTok ligada, nenhuma linha, com contorno, cruza a coluna. |
| E3 | Forma de onda | S3 | — | Forma de onda aparece depois de importar, com progresso; a ingestão de um arquivo de 1 h com imagem (≥ 2 GB) mostra progresso e não trava a interface; o LRU respeita o projeto aberto; `media://audio` recusa caminhos fora do cache. |
| E4 | Legendas automáticas | S5a | E2, E3 (E1 para as palavras seguirem divisões) | Licença e download com retomada e cancelar; transcrever um trecho; rascunho com palavras; Karaokê acende a palavra certa; o Claude dispara pelo MCP; cancelar no meio não deixa processo nem arquivo; o `whisper-cli.exe` abre num Windows sem VC++ (conferência de importações); o tempo medido aparece no cartão; o Mais rápido só baixa quando escolhido e transcreve; a janela mostra as estimativas dos dois; gerar de novo num trecho com legendas mantém o texto delas (inclusive o editado em Propriedades) e refaz as páginas; gerar com Clássico sobre legendas Amarelo refaz as páginas sem transcrever e sem o modelo; fechar o Diretor no meio de um job de 3 lotes e gerar de novo transcreve só os lotes que faltam (a CLI falsa conta os lotes); a janela começa no Preciso e só sugere o Mais rápido quando o PC é lento. |
| E5 | Motor de áudio | S4a | E1, E3 | PCM do worklet igual ao da exportação; sem estalo nas emendas; no CI do Windows, 2000 pedaços de uma fonte 320×180 só com quadros-chave exportam dentro do tempo do job; a exportação de 1 h em 1080p é medida num job manual, e o tempo é informado ao usuário com a entrega; a janela de exportar mostra a estimativa de tempo; Cancelar durante "Preparar o áudio" para na hora; a prévia não deriva em 10 minutos de reprodução; 10 min de reprodução num fixture 1080p com GOP de 2 s e um corte a cada 0,4 a 4 s: nenhum quadro preto e congelamentos contados abaixo de um teto; a prévia toca o começo de uma mídia ainda em ingestão. |
| E6 | Tirar as respirações (cortar e abaixar) | S6a + S6b (detecção, revisão, abaixar e cortar) | E1, E4 (VAD, jobs, rascunhos locais, `get_job`), E5 | Marcas na faixa; um item por vão; vãos de respiração de 0,30, 0,38 e 0,6 s tratados pela regra em cada ritmo; nenhum corte menor que pausa mínima − sobra; nenhuma parte mantida abaixo de 100/50 ms em nenhum ritmo; o −X s do resumo igual ao encurtamento; palavra curta dentro de pausa nunca cortada; "incerto" nunca marcado; fixture com música avisa e não marca nada; fixture com ventilador marca normalmente; modo Abaixar não muda a duração e baixa ~20 dB nas marcas no MP4; um Ctrl+Z desfaz; legendas andam junto; no CI do Windows, uma hora com 1.000 cortes e 3.000 legendas: preparar o rascunho ≤ 3 s, aceitar ≤ 1 s, Ctrl+Z ≤ 1 s, quadro de rolagem ≤ 50 ms, e no máximo um deslocamento por clipe; no zoom mínimo de 1 h com 1.000 cortes, a linha do tempo tem menos de ~500 elementos no DOM; depois de limpar a fala de 1 h, cada trecho abaixado aparece em um só pedaço (nenhum duplicado); migração v2 → v3; arquivo v4 recusado. Antes de publicar, um job de medição separado, com o modelo de verdade: limpar fala pública pt-BR e transcrever de novo não perde palavra. |
| E7 | Volume, fades e trechos | S4b | E5, E6 | +12 dB audível na prévia e no MP4; fades; abaixar e silenciar trecho; migração v3 → v4; arquivo v5 recusado. |
| E8 | Tirar ruído | `motor-de-audio.md` item 4 (só a redução de ruído) e a checagem | E3, E5 e o gerenciador de jobs (E4, ou E6 na outra ordem); E7 só pela ordem (versão do arquivo e bloco Áudio) | Em fixtures de fala real com ruído, Leve e Forte baixam o ruído nas pausas (o construtor fixa o mínimo), deixam a voz a −2 dB ou mais e melhoram o SI-SDR; com ruído, música e risadas, a emenda fica a ±0,5 dB do processamento contínuo e a voz não muda mais de 1 dB entre blocos; o fim da mídia sai sem zeros; no CI do Windows (ffmpeg 6.1.1), atraso igual ao da estrutura dos filtros e bloco alinhado em atraso 0 com o base passado pelo mesmo highpass; processar 1 h no Leve e no Forte nesse CI, com o tempo registrado; PCM da prévia igual ao da exportação com os mesmos blocos, e bloco ainda sendo gravado nunca lido; a prévia toca o original com selo enquanto processa e troca sem estalo; a exportação mostra "Tirando ruído… N%" enquanto espera os blocos, Cancelar nessa fase para na hora, fechar ou recarregar não deixa ffmpeg nem arquivo, e trocar o nível durante a exportação não a trava; "Desligado" funciona pelo bloco Áudio e pela IA, e `setDenoise` aplica a todos; o modelo do Forte achado fora do asar no Windows instalado, com o SHA-256 conferido; o LRU conta os blocos; migração v4 → v5; arquivo v6 recusado. |
| E9 | Transcrição | S5b | E4 | Chips, sublinhado das duvidosas, clique leva à palavra, editar, Substituir em tudo; uma palavra corrigida na aba continua corrigida depois de gerar de novo no mesmo trecho e de gerar com o Clássico; a aba mostra o mesmo texto da prévia; o Claude corrige com `setCaptionWords` a partir do `get_analysis("transcript")`; com 1 h de legendas (~9 mil palavras), a aba abre em menos de 1 s, rola sem travar, e tocar a prévia não re-renderiza a lista. |

**Se o usuário pedir as respirações antes** (ordem 1, 2, 3, 5, 6, 4, 7, 8, 9), a E6 depende só de E1 e E5 e leva junto:

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
- **Velocidade da transcrição** em CPU fraca: beam 5 e `-nfa` não foram medidos juntos. Mitigação: medir o turbo e o small com as opções finais na E4, refazer a estimativa a cada lote, mostrar o tempo e oferecer o Mais rápido (`ggml-small` no mesmo motor) em PC lento desde a E4; Parakeet fica fora do bloco 1.
- **Jobs de horas** (transcrição de 1 h, exportação longa): ocupam a CPU, a prévia engasga e o PC pode dormir. Mitigação: fila com prioridade, processos abaixo do normal, `-t` = núcleos físicos − 1 e `powerSaveBlocker` (D9).
- **Antivírus** pode barrar um `whisper-cli.exe` sem assinatura, como pode barrar o próprio Diretor hoje.
- **Relógio da prévia** com vídeo escravo do áudio: emendas e deriva. Mitigação: o pool por mídia com pré-busca vem antes (E1), uma busca de cada vez mirando o tempo previsto (D4), e há métricas de deriva e de congelamentos no e2e.
- **Exportação lenta em vídeo longo** (D4): o laço de quadros do `exporter.ts` faz uma `seekExact` por quadro em cada clipe ativo, e o custo cresce com o GOP. Medido no Electron com `--disable-gpu`: ~0,1 s por quadro (89 ms só na busca) em 1080p30 com GOP de 2 s, umas 3 h para uma hora de vídeo, contra 2,6 ms por quadro numa fonte 320×180 só de quadros-chave; a decodificação por hardware no Windows não foi medida. Mitigação: a entrega E1b, "Exportação rápida para vídeos longos", que decodifica cada pedaço em sequência (por exemplo com o `VideoDecoder` do WebCodecs) e só busca nas emendas, logo depois da E1 (escolha do usuário em 19/11/2026); a E5 mede no Windows e mostra a estimativa antes de exportar.
- **Falsos positivos de respiração** em pt-BR. Mitigação: folgas mínimas na borda acústica, nenhum corte sobre voz, revisão obrigatória, duvidosos desmarcados e ajuste pelo que o usuário relatar ao testar a E6.
- **Música ou outra voz no mesmo áudio:** cortar picota e abaixar abaixa junto. Mitigação: marca "música/ruído" só para música, TV e outra voz, aviso e nada marcado; ruído estável (ventilador, chiado) marca normalmente.
- **Imagem pulando** em 9 a 17 respirações por minuto, sem o zoom que só vem no bloco 2. Mitigação: só vãos com pelo menos a pausa mínima são cortados; o resto é abaixado.
- **A amostra do usuário pode não chegar.** Mitigação: fixtures, fala pública e o retorno dele ao testar.
- **Disco:** cerca de 700 MB por hora de cache de áudio, mais uns 700 MB por hora para cada nível de Tirar ruído usado, e na exportação ~1,4 GB por hora de temporário f32 mais o MP4. Mitigação: LRU e conferência de espaço livre antes de ingerir, processar e exportar (D3).
- **Tirar ruído** não separa vozes, pode tirar a música nas pausas e as risadas (Forte com o `sh`) e atrasaria o som se o atraso do filtro não fosse compensado. Mitigação: modelo do Forte escolhido por medição, aviso no bloco Áudio, Leve com afftdn, atraso medido por cadeia, leitura estendida pelo atraso e testes de alinhamento e de fim de mídia.
- **Emendas entre blocos do Forte:** o RNNoise demora a convergir e, em algumas gravações, fica em um de dois estados conforme onde começou; um crossfade não esconde isso (medido: a voz mudou 13 dB entre dois blocos com 5 s de pré-rolagem). Mitigação: 20 s de pré-rolagem no Forte, comparação da sobreposição com refazer e aviso no clipe, e testes de emenda contra o processamento contínuo.
- **Exportação esperando o Tirar ruído:** num vídeo longo, uns minutos de blocos antes do primeiro quadro (o Forte roda a ~74× o tempo real num servidor rápido; num notebook, provavelmente 2 a 3 min por hora, sem medição). Mitigação: fase "Preparar o áudio" dentro do job de exportação, com progresso, Cancelar e limpeza (D4, D13), e fila própria dos blocos.
- **Fontes:** a prévia na GPU e a exportação na CPU podem diferir em subpixel. Mitigação: layout puro e testes com tolerância.
- **Áreas seguras** são medições de terceiros e mudam quando as plataformas mudam.
- **Hugging Face fora do ar.** Mitigação: segunda URL nas releases do repositório.

### Deixado para quem constrói

- Detalhes visuais seguindo o tema atual, ícones e a disposição exata dos controles.
- Limiares do classificador de respiração dentro das folgas acima, ajustados com fixtures sintéticas (inclusive finais de vogal desvozeada e /s/), fala pública pt-BR (só para conferir que nenhum corte come palavra; não há rótulo de respiração), as gravações do usuário se ele mandar e o que ele relatar ao testar a entrega 6. Nunca pedir ao usuário que marque respirações.
- Ajuste fino das cadeias de Tirar ruído (`nr`, `nf`, `mix`) e da pré-rolagem do Forte, por métricas em fixtures e pelo retorno do usuário; a escolha do modelo do Forte segue os critérios de D13.
- Tirar ruído em mono quando L e R são praticamente iguais (medido na ingestão): o estéreo custa 1,5 a 1,75 vez a CPU do mono, e o bloco mono duplicado (ou gravado em mono) gasta metade do disco. Em estéreo de verdade, medir se vale processar só o meio, (L+R)/2, para a voz não variar entre os lados.
- O teto de congelamentos da prévia no aceite da E5.
- Parâmetros do VAD das respirações (folga até 30 ms, silêncio mínimo ~100 ms, fala mínima ~100 ms), conferidos no `--help`.
- Limite do LRU (o orçamento do histórico está em D9).
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
- **Tirar ruído** usa só a parte de redução de ruído do "Melhorar voz" da pesquisa (sem de-esser, compressor e limitador), com o atraso compensado como pede a checagem e o modelo fora do asar.
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
- **Segunda checagem (tirar ruído e vídeos longos), já aplicada acima:**
  - crossfade de ganho constante (cos²/sen²) entre blocos de Tirar ruído e entre níveis na mesma fonte; equal-power só para cortes de verdade (regra b), porque em som igual soma até +3 dB;
  - atraso: ler pré-rolagem + bloco + 50 ms + atraso e cortar com `atrim`; `apad` só no último bloco, no início da cadeia e com `pad_len`;
  - pré-rolagem por cadeia (Forte 20 s) e comparação das sobreposições; modelo do Forte escolhido por medição entre `sh`, `bd` e `cb`;
  - a exportação espera o áudio dentro do próprio job, com progresso, Cancelar e limpeza; o renderer pede os blocos e o main avisa quando ficam prontos;
  - "Desligado" pelo `updateClip` (`'off'` apaga o campo) e `setDenoise` para vários clipes;
  - "música/ruído" só para música, TV e outra voz: ventilador e chiado marcam normalmente;
  - `removeRanges` linear (no máximo um deslocamento por clipe) e, acima de 500 trechos, várias chamadas do fim do vídeo para o começo;
  - `ducks` repartidos nas divisões, não copiados;
  - Antes/Depois mantém o instante do conteúdo; zoom mínimo que cabe o projeto inteiro, com nível de detalhe na E6;
  - tempos de transcrição corrigidos (Mais rápido de 10 a 45 min por hora) e o Preciso como padrão: a regra antiga ("mais de 10 minutos de espera") mandaria todo vídeo longo para o Mais rápido;
  - cache de transcrição por modelo, gravado a cada lote e com teto próprio;
  - histórico com orçamento de uns 300 MB; `get_context` em corridas e `get_analysis` em páginas por bytes;
  - exportação longa: tempo medido e mostrado, e a Exportação rápida como proposta em aberto.
