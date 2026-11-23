# Exportação rápida para vídeos longos (entrega E1b) — design

- **Estado:** rascunho para aprovação do usuário (23/11/2026). Faz parte do bloco 1 (`docs/superpowers/specs/2026-11-19-audio-e-legendas-design.md`), que pede para esta entrega "design e aceite próprios, escritos e aprovados antes de construir".
- **Data:** 23/11/2026, sobre o Diretor 0.1.28 (`main` em 3d842f6).
- **Medições de apoio:** feitas num computador de teste (Linux, 4 núcleos, sem placa de vídeo, Electron 45.3.4 com `--disable-gpu`, como o teste de ponta a ponta), em protótipos descartáveis fora do repositório. A rodada 1 mediu o caminho de hoje e as peças do caminho novo. A rodada 2 comparou os dois caminhos quadro a quadro em mais de 50 arquivos de teste e mediu a exportação completa pelo pipe real do app; depois, um revisor independente refez os testes principais com um protótipo próprio. Os números estão na Parte 2, em "Medições". Nada foi medido com a placa de vídeo ligada (ver "Riscos").

A Parte 1 é o que o usuário aprova, em linguagem simples. A Parte 2 é para quem vai construir.

---

## Parte 1 — O plano, sem jargão

### O que foi pedido

- "Quero que o app funcione para qualquer tipo de vídeo, tanto os curtos quanto os longos."
- No plano do bloco 1, você escolheu fazer a exportação rápida para vídeos longos logo depois da entrega 1.

### Como é hoje

Para montar o vídeo final, o Diretor vai até cada quadro do vídeo original, um de cada vez, como quem arrasta a agulha 30 vezes por segundo de vídeo. Cada pulo obriga o computador a reler o vídeo desde o último "quadro-chave", que pode estar até uns 2 segundos antes. Por isso exportar um vídeo longo demora: no computador de teste, uma hora de vídeo em 1080p leva **de 3 a quase 8 horas**, conforme o arquivo.

### O que muda

- O Diretor passa a ler cada pedaço do vídeo do começo ao fim, em sequência, como um player, e só pula nas emendas (nos cortes). Enquanto um quadro pronto vai para a gravação, os próximos já estão sendo montados.
- **O vídeo final sai igual ao de hoje:** o mesmo quadro em cada instante, a mesma imagem, as mesmas cores, a mesma qualidade e o mesmo programa gravando o MP4. Só fica pronto mais cedo. Há uma diferença, para melhor: num PC ocupado, o jeito de hoje às vezes repete o quadro anterior no lugar do certo; o jeito novo não faz isso.
- **Quanto mais rápido:** no computador de teste, uma hora de vídeo em 1080p cai de umas 7 horas e meia para cerca de 1 hora e 15 minutos, já com cortes de respiração. É umas 6 vezes mais rápido. Cada corte soma só uma fração de segundo (de 0,1 a 0,3 s). No seu PC o tempo será outro, porque depende do processador, e daqui eu não consigo medir no seu PC.
- **A janela de exportar mostra quanto tempo falta**, por exemplo "Faltam cerca de 40 minutos".
- Depois que você escolhe onde salvar, o Diretor confere cada vídeo do projeto em 3 momentos: o jeito novo precisa mostrar exatamente a mesma imagem que o de hoje. Isso leva de um a três segundos por vídeo.
- Se algum vídeo não puder ser lido do jeito novo, ou não passar na conferência, só esse vídeo é lido do jeito de hoje, mais devagar. A exportação não falha e você não precisa fazer nada. A janela de exportar avisa, numa linha, qual vídeo foi pelo jeito de hoje.

### O que já testei

Antes de escrever este plano, montei um protótipo descartável (fora do Diretor) e comparei o jeito novo com o de hoje, pixel por pixel, em mais de 50 vídeos de teste: deitados e em pé (girados e espelhados), cores de Android e de iPhone, MOV, WebM, 24, 30 e 60 quadros por segundo, quadros por segundo variáveis e vídeos cortados. Depois medi a exportação completa, com cortes de respiração, e pedi a um revisor independente que refizesse os testes principais do zero, desconfiando de tudo.

- Nos vídeos comuns, o jeito novo mostrou o mesmo quadro e a mesma imagem que o de hoje, pixel por pixel, em todos os instantes testados. Os vídeos exportados pelos dois jeitos saíram idênticos, byte a byte.
- Os testes acharam dois cuidados, e os dois já funcionam no protótipo: o vídeo de celular em pé precisa que o Diretor passe a rotação adiante; e o vídeo HD sem informação de cor precisa usar a mesma cor que o player do Diretor escolhe.
- Alguns arquivos raros (por exemplo, um vídeo cortado por um programa que não recodifica e que começa no meio de um quadro) vão pelo jeito de hoje.
- Vídeo HEVC, o formato padrão do iPhone: no computador de teste ele não abre nem hoje, porque precisa da placa de vídeo. No seu PC, se a placa abrir, a conferência decide qual jeito usar.
- O revisor confirmou os resultados e corrigiu três detalhes das medições; nenhum muda o plano.
- Todos esses testes rodaram num computador sem placa de vídeo, como o teste automático. No seu PC, a placa de vídeo pode mudar um detalhe da imagem num dos dois jeitos. Por isso a conferência roda no seu PC, a cada exportação: se a imagem não bater, aquele vídeo vai pelo jeito de hoje, certo, mas sem ganhar velocidade. A linha na janela de exportar mostra quando isso acontece.

### Como vou saber que ficou certo

1. **Mesmo vídeo de antes.** O vídeo exportado do jeito novo mostra o mesmo quadro e a mesma imagem que o de hoje, com vídeos de teste parecidos com os de celular e câmera: deitado e em pé, cores de Android, MOV de iPhone, WebM, 24, 30 e 60 quadros por segundo e quadros por segundo variáveis.
2. **Mais rápido.** No teste automático do Windows, exportar um vídeo 1080p fica pelo menos 3 vezes mais rápido que hoje no mesmo arquivo. No computador de teste, eu meço uma exportação de 1 hora em 1080p e te passo o tempo junto com a entrega.
3. **Nada quebra.** Os 73 testes do app aberto de verdade continuam passando: cancelar para na hora, destino preso, vídeo que sumiu, 300 pedaços, a janela que cai no meio.
4. **Sem beco sem saída.** Um vídeo que não pode usar o jeito novo exporta pelo jeito de hoje, como hoje.

### Fica para depois

- **Usar a placa de vídeo também para gravar o MP4.** Ficaria bem mais rápido (minutos por hora de vídeo, como no CapCut), mas a qualidade e as cores mudariam um pouco de um PC para outro, e o teste automático não tem placa de vídeo para conferir. Depois que você exportar um vídeo longo no seu PC com esta entrega, você me diz se o tempo ficou bom. Se não ficou, essa vira a próxima conversa.
- Continuar editando enquanto exporta.

### Decisões que tomei por você (pode mudar qualquer uma)

1. **O MP4 continua sendo gravado do mesmo jeito** (mesmo programa e mesma qualidade). Assim nada muda no arquivo final. Se eu errei: a exportação fica mais lenta do que poderia.
2. **Vídeo que não serve para o jeito novo vai pelo jeito de hoje, sem perguntar**, e a janela de exportar diz qual foi. Se eu errei: você preferia ser avisado antes de a exportação começar.
3. **A conferência de 3 momentos por vídeo roda sempre**, mesmo quando o vídeo é de um tipo que já testei. Se eu errei: a exportação começa alguns segundos mais tarde por vídeo, sem precisar.
4. **Arquivos raros vão pelo jeito de hoje**, em vez de eu adaptar o jeito novo a cada um. Se eu errei: esses arquivos continuam lentos.
5. **Aparece o tempo que falta** durante a exportação.
6. **Entra no Diretor uma peça de código aberto que lê os arquivos de vídeo** (Mediabunny, licença MPL-2.0, grátis). O crédito dela vai junto com o Diretor.

### Limites que você vai notar

- A velocidade depende do PC. Num PC fraco, uma hora de vídeo ainda pode levar mais de uma hora.
- Enquanto exporta, o PC trabalha pesado (ventoinha, bateria).

---

## Parte 2 — Design técnico

### Intenção

O usuário faz vídeos falados, curtos e longos (YouTube, deitado), com muitos cortes (as respirações, entrega 6). Esta entrega deixa a exportação de vídeo longo várias vezes mais rápida sem mudar o que sai: o mesmo quadro de cada mídia em cada instante, a mesma orientação, as mesmas cores, a mesma composição (`renderFrame`) e o mesmo codificador (libx264 `veryfast`, CRF 18, BT.709).

### Metas

- **R1 Mesma saída.** Para cada quadro da saída, cada clipe mostra o mesmo quadro da mídia, com a mesma orientação, proporção e conversão de cor, que o caminho de hoje (`seekExact` + `drawImage` do `<video>`) mostra **depois de assentado**. (Logo depois do `seeked`, o caminho de hoje às vezes ainda desenha o quadro anterior; ver "Medições". O caminho novo não herda isso.)
- **R2 Mais rápido.** No CI do Windows (`--disable-gpu`), um 1080p30 exporta pelo menos 3× mais rápido que o caminho de hoje no mesmo arquivo e na mesma execução. No computador de teste, 1 h de 1080p30 com GOP de 2 s cai de 3,3–7,7 h para cerca de 1 h 11 min sem cortes e 1 h 14 min com uma emenda a cada ~5 s (projeção; medido 6,4× e 6,2×).
- **R3 Cortes baratos.** Uma linha do tempo de respirações cortadas (emenda a cada ~5 s) exporta no máximo 15% mais devagar que a mesma mídia sem cortes (medido: 4%; o quadro da emenda leva ~100 ms). Conferido na medição manual da entrega, não no CI (a diferença fica dentro do ruído de uma execução curta); a regra das emendas é testada no vitest.
- **R4 Queda por arquivo.** Arquivo que o caminho novo não lê, ou que não passa nas condições e na conferência (D5), exporta pelo caminho de hoje, sem erro e sem pergunta, e a janela diz qual.
- **R5 Mesmo comportamento.** Cancelar, falhas, renderer que cai, destino preso, nome longo e limpeza dos temporários continuam iguais (os 73 checks do e2e).
- **R6 Tempo restante** na janela de exportar.

### Fora desta entrega

Codificador por hardware (`VideoEncoder`), mudanças na prévia (ela continua no `<video>`), exportar em segundo plano, exportar dentro de um Worker (as fontes do `document.fonts` não chegam lá; ver o mapa do código), qualquer campo novo no projeto (o que o caminho novo precisa saber da mídia é lido na hora de exportar), mudança na CSP, consertar o caminho de hoje para arquivos que ele já não lê (GOP aberto, HEVC sem placa), deslocar os tempos para o caminho novo aceitar o corte sem recodificar (o revisor confirmou a conta, mas não em pixels), e o repasse do quadro pelo mundo do preload (D7).

### Anti-metas

- Imagem diferente da de hoje em tempo, orientação, cor ou enquadramento, em qualquer arquivo que passe na conferência.
- Um arquivo que exportava antes e deixa de exportar.
- Exportação travada esperando o decodificador, em vez de cair para o caminho de hoje ou falhar com mensagem.
- Memória crescendo ao longo de uma exportação de 1 h.
- Rede, API paga, WASM ou `'wasm-unsafe-eval'`.

### Restrições

As do bloco 1 continuam (WYSIWYG, CSP `script-src 'self'` sem blob, empacotamento só `dist/**` + ffmpeg-static, `src/core` testável no Node sem DOM, e2e com xvfb e `--disable-gpu`, texto em pt-BR). As específicas:

- `src/core/render.ts` declara `interface VideoFrame { image; width; height }`, que sombreia o `VideoFrame` do WebCodecs: o código novo usa um alias, e nada de WebCodecs entra em `src/core`.
- `media://` serve só `.mp4 .m4v .mov .webm`, com um único Range por pedido (206), e roda no mesmo laço de eventos do main que recebe os quadros.
- `MediaItem` não guarda fps, rotação, codec nem cor; `parseProject` descarta campos desconhecidos. O caminho novo lê tudo do arquivo ao exportar. (A duração da mídia no projeto vem do `Duration:` do ffmpeg na importação; a duração que o `seekExact` usa é o `el.duration` do Chromium.)
- O teste de cancelar exige que o último progresso informado seja no máximo o quadro 12 quando o cancelamento chega no quadro 10 (por isso no máximo 3 quadros a caminho). O teste "cancelar durante a conferência dos vídeos" cancela antes da janela de salvar. O da queda do renderer exige exatamente 2 temporários (`.part` e `.filtro`) durante a exportação.

### Abordagens consideradas

1. **Ler em sequência com o WebCodecs (escolhida).** Mediabunny lê o contêiner pelo `media://`, um `VideoDecoder` por leitor decodifica em ordem, o quadro certo vai como imagem para o mesmo `renderFrame`, e o resto (`getImageData`, IPC, ffmpeg) fica igual, com até 3 quadros a caminho. Medido aqui, ponta a ponta em 1080p30: 25,2 quadros por segundo contra 3,9 do caminho de hoje (6,4×); com respirações cortadas, 24,3 (6,2×). Cada arquivo que não passa nas condições do D5 usa o caminho de hoje.
2. **O mesmo, mais o codificador da placa de vídeo (`VideoEncoder`).** Tira o `getImageData` e os 8,3 MB por quadro do IPC, e pode levar a minutos por hora de vídeo. Mas não há CRF (só taxa constante ou variável no Media Foundation), o quadro do canvas tende a ser convertido em BT.601, a saída muda de PC para PC, o CI não tem GPU para testar, e o libx264 continua necessário como reserva. Fica para depois de o usuário medir a E1b no PC dele. A abordagem 1 é pré-requisito dela.
3. **O ffmpeg compõe o vídeo** (filtros de sobreposição e texto). Seria o mais rápido em CPU, mas cria um segundo caminho de imagem, contra a regra do WYSIWYG. Descartada.
4. **O ffmpeg decodifica no main e manda os quadros ao renderer.** Lê qualquer codec, mas soma uns 3 MB por quadro de IPC (I420) aos 8,3 MB de volta, troca a conversão de cor do Chromium pela do swscale e usa uma versão do FFmpeg diferente da do Chromium para decidir o tempo dos quadros. Mais lenta que a 1 e mais arriscada para R1. Descartada.
5. **Vários `<video>` buscando em paralelo.** Cada quadro ainda decodifica, em média, meio GOP; no máximo 2 a 3× em 4 núcleos. Descartada.

### Medições

Rodada 1 (`scratchpad/e1b-spike`), arquivo 1080p30 de 16 Mb/s, GOP de 2 s, quadros B:

| Medida | Resultado |
|---|---|
| Caminho de hoje, ponta a ponta | 189 ms por quadro (5,3 fps); 109 ms com 6,8 Mb/s |
| Só decodificar (WebCodecs, software) | ~250 fps |
| Decodificar + desenhar + `getImageData` | 89–90 fps |
| Pipe completo (protótipo), 1 quadro a caminho | 23,5 fps |
| Pipe completo (protótipo), 3 quadros a caminho | 30 fps (por `MessagePort`: 31,5–34) |
| Só o ffmpeg (`veryfast`) | 70 fps |
| IPC de um quadro de 8,3 MB | 19–22 ms pelo `contextBridge`; 13–15 ms a partir do mundo do preload |
| Recomeçar no quadro-chave numa emenda | 23 ms no próprio quadro-chave; 121–136 ms 29 quadros depois; 215–244 ms 59 quadros depois |
| `<video>` × `VideoFrame`, BT.709 marcado | bytes idênticos |

Rodada 2, identidade (`scratchpad/e1b-spike2/a` e `/b`). Cada arquivo foi comparado em 75 a 579 instantes (grade de 30 fps, inícios de pedaço em milissegundos fora da grade, bordas e além do fim), em dois tamanhos de canvas, com leitura aleatória e em sequência. "Idêntico" = mesmos bytes RGBA.

| Arquivo | Resultado |
|---|---|
| H.264 MP4 comum (edit list do atraso dos quadros B; `moov` no fim ou no começo), BT.709 marcado, 1080p | idêntico (319/319) |
| Fixture do e2e (sem informação de cor, 1280×720) | mesmo quadro em 407/407, cor diferente (24–25 dB); com a cor do D4, idêntico em 407/407 |
| VFR moderado (26–40 ms por quadro, buracos de 67 ms) | idêntico (542/542) |
| VFR extremo (8–92 ms por quadro) | 578/579: num trecho de 16 ms antes de um quadro-chave, o `<video>` mostra o quadro-chave cedo; o caminho novo segue o tempo do arquivo |
| 24, 60 e 29,97 fps numa grade de 30 | idêntico (408/408, 377/377, 409/409) |
| Pixels não quadrados (480×360, 4:3) | idêntico (347/347); o Mediabunny passa `displayAspectWidth/Height` e o tamanho de exibição bate |
| Rotação 90, 180, 270 e 90 + espelho (MP4); MOV girado ±90 com faixa de timecode e `moov` no fim | idêntico com rotação e espelho no `VideoDecoderConfig`; sem isso, sai deitado (0,9–3,8 dB) |
| BT.601 faixa completa (Android) marcado no fluxo e no contêiner, só no contêiner ou só a faixa; BT.709 faixa completa | idêntico |
| Sem informação de cor: H.264 e VP8 com 720 linhas ou mais | cor diferente (24–31 dB, conforme a imagem): o `<video>` supõe BT.709 e o `VideoFrame` sem cor é desenhado em BT.601; com a cor do D4, idêntico |
| Sem informação de cor: abaixo de 720 linhas (360 a 718 testadas), VP9 e AV1 | idêntico |
| WebM VP9, VP8 e AV1 | idêntico |
| HEVC (hvc1 e hev1) | nenhum dos dois caminhos decodifica sem placa de vídeo (`<video>`: MediaError 4; `isConfigSupported`: falso) |
| Trecho vazio de 2 s no começo (edit list vazia + mídia) | igual até o `el.duration` do carregamento (343/355); depois disso o próprio `<video>` muda de duração enquanto carrega |
| Corte sem recodificar que começa no meio de um quadro | o Mediabunny dá tempos negativos aos quadros de antes do corte e põe o primeiro quadro em +21,7 ms; o Chromium o põe em 0. O caminho novo fica um quadro adiantado (294/406 nos instantes da rodada 2; numa grade com o fps do próprio arquivo, em todos os quadros, segundo o revisor). Vai pelo caminho de hoje (D5) |
| GOP aberto (x264 `open-gop`) | o `<video>` dispara `error` (`PIPELINE_ERROR_DECODE`) depois da primeira busca, e o exportador de hoje para com "Um vídeo parou de abrir durante a exportação"; o caminho novo, com `verifyKeyPackets`, decodifica todos |
| Leitura aleatória × em sequência andando para a frente × em sequência com reset no quadro-chave | sempre os mesmos bytes (33.696 comparações diretas) |
| Caminho de hoje logo depois do `seeked` | às vezes desenha o quadro do alvo anterior, mais com o PC ocupado (números do revisor abaixo); desenhar de novo um pouco depois deu o quadro certo (23/23). O caminho novo nunca |
| `UrlSource` do Mediabunny no `media://` | funciona; só pedidos `bytes=N-` abertos, cancelados quando basta |

Rodada 2, velocidade (`scratchpad/e1b-spike2/perf`). O pipe real do app: `contextBridge` → `ipcRenderer.invoke('export:frame')` → `write`/`drain` no main → ffmpeg-static 7.0.2 com os argumentos do app, canvas 1920×1080. O mesmo arquivo da rodada 1 (1080p30 H.264, GOP de 2 s, quadros B, BT.709). Mediana de 3 sessões, com a ordem das execuções trocada a cada sessão. A projeção de 1 h é 108.000 quadros ÷ fps (inferência: execuções de até 1.800 quadros).

| Execução | fps, mediana (mín.–máx.) | 1 h de 1080p30 | CPU por quadro: renderer / main / ffmpeg |
|---|---|---|---|
| Caminho de hoje, 1 a caminho (P0, 300 quadros) | 3,92 (3,84–4,21) | 7 h 39 min | 568 / 21 / 64 ms |
| Novo, 1 a caminho (P1) | 20,08 (19,01–20,23) | 1 h 30 min | 46 / 18 / 62 ms |
| Novo, 2 a caminho | 25,03 (23,20–25,55) | 1 h 12 min | 45 / 18 / 64 ms |
| **Novo, 3 a caminho (P2)** | **25,24 (24,07–25,39)** | **1 h 11 min** | 45 / 18 / 63 ms |
| Novo, 4 a caminho | 23,64 (23,39–24,32) | 1 h 16 min | 47 / 19 / 67 ms |
| **Novo, 3 a caminho, respirações cortadas, emendas J2 (P3)** | **24,28 (24,04–24,36)** | **1 h 14 min** | 47 / 19 / 65 ms |
| Idem, emendas J1 | 23,94 (23,04–24,03) | 1 h 15 min | 48 / 19 / 64 ms |
| Novo, 3 a caminho, buffer transferido ao preload (P4) | 23,65 (22,43–23,76) | 1 h 16 min | 36 / 18 / 66 ms |
| Diagnóstico, 1 sessão: P4 + espera de uma mensagem de `MessageChannel` após o `postMessage` (P4c) | 28,51 e 27,55 (P2 na mesma sessão: 23,23 e 24,29) | ~1 h 4 min | 36–37 ms no renderer |
| Diagnóstico: novo, 3 a caminho, main descarta os quadros (sem ffmpeg) | 31,77 | — | 46 / 16 / — ms |

- **Onde está o tempo:** com 3 a caminho, a thread principal do renderer fica ocupada o quadro inteiro (39,6 ms: pegar o quadro 2,9; desenhar 10,8; `getImageData` 8,7; enviar 17,3, que é a cópia do `contextBridge` mais a serialização do IPC; esperar 0,2). Decodificar não é o gargalo. Ficaram ocupadas ~3,2 das 4 CPUs.
- **Emendas** (P3: 11 pedaços de 3,3–7,8 s, buracos de 0,31–0,58 s, 10 emendas): o quadro da emenda levou em média 99–104 ms com J2 e 220–227 ms com J1, contra 2,7 ms de um quadro comum; o de J1 cresce com a distância até o quadro-chave (7 a 54 quadros). J2 levou menos tempo total que J1 nas 3 sessões. O custo por emenda estimado pelo tempo total é ruidoso (J1, mediana 332 ms; J2, 261 ms, com uma sessão negativa), porque P2 variou 2,15 ms por quadro entre sessões.
- **Memória do renderer:** 618–780 MB no início de cada execução e picos de 794–1.253 MB; não cresceu ao longo de 13 execuções seguidas; todo `VideoFrame` foi fechado (criados = fechados). Com o limite de 4 quadros decodificados esperando uso, no máximo 7 ficaram guardados (limite 4 × 8: mesma velocidade).
- **Identidade:** hash de cada quadro RGBA no main, antes do ffmpeg: 0 de 1.800 diferentes (novo × hoje), 0 de 1.663 (respirações, J1 × hoje), 0 de 1.663 (J2 × J1), 0 de 1.800 (P4 × `contextBridge`). O `VideoFrame.timestamp` de cada quadro da saída era o quadro da regra do D2, calculado à parte (1.800/1.800 e 1.663/1.663). Os 46 MP4 tinham o número de quadros enviado (`ffprobe -count_frames`), e todo MP4 do caminho novo era md5-idêntico ao do caminho de hoje na mesma linha do tempo.
- **P4** (transferir o buffer ao mundo do preload e chamar o `invoke` de lá): como especificado, ficou 2,7–3,1 ms por quadro mais lento com 3 a caminho, porque o preload só começava a tratar os quadros depois de a página já ter postado 3, e eles chegavam em rajadas ao main. Com 1 a caminho, economizou 6–8 ms por quadro. A variante P4c acabou com a rajada (nenhum atraso em 3.600 quadros) e economizou 5–8 ms por quadro, mas foi medida numa sessão só. Os quadros chegaram intactos em todas as variantes.

Rodada 2, conferência independente (`scratchpad/e1b-spike2/verify`), com protótipo próprio (a CSP do app, `contextIsolation`, sandbox, preload, cópias do `media://` e do IPC do app):

- **Confirmado:** mesmo quadro e bytes idênticos com a receita (rotação e espelho no config, a cor, `verifyKeyPackets`) na fixture exata do e2e (10/10), em 90° e 90° + espelho (20/20), BT.709 marcado, BT.601 de faixa completa, sem cor em 712 e 1.080 linhas, e em 1.500 desenhos de referência em 1080p; o GOP aberto; o `UrlSource` no `media://` (17/17 pedidos `bytes=N-` respondidos com 206, inclusive o pulo até o `moov` no fim); a velocidade (hoje 4,12 fps; novo com 1 a caminho 19,09 e 18,68; com 3, 23,47 e 23,24: dentro de 5–8% da rodada 2, com o envio de fato sobreposto ao trabalho do renderer); o número de quadros dos MP4; todo `VideoFrame` fechado.
- **Confirmado, com números:** o caminho de hoje desenha o quadro do alvo anterior logo depois do `seeked` em 0 de 1.200 alvos sem carga, 3 de 1.200 com 4 laços ocupados, e 16 e 6 de 1.800 com 8 (em 640×360; nenhum em 1080p). Era sempre o quadro do alvo anterior, e nem o `currentTime` nem o `readyState` denunciam. Desenhar de novo na mesma tarefa corrigiu 12 de 13; depois de 30 ms, 13 de 13. Um `new VideoFrame(el)` feito depois de um desenho velho também saiu velho em 7 de 13.
- **Corrigido:** (1) no GOP aberto, o app de hoje não grava quadro preto: o `<video>` dispara `error` e o exportador para com mensagem. (2) No corte sem recodificar, numa grade com o fps do próprio arquivo, todos os quadros saem um adiantados (8/8), não só 294/406. (3) As faixas de PSNR da rodada 2 dependem da imagem: diferença só de cor deu 24,2 dB na fixture do e2e; rotação faltando, 3,7–3,8 dB.
- **Fatos novos:** `new VideoFrame(el).colorSpace` traz a cor que o Chromium usou, inclusive o palpite para arquivo sem cor (4 tamanhos sem cor e os arquivos marcados); `new VideoFrame(el).timestamp` arredonda (66667) onde o Mediabunny trunca (66666); o `codedHeight` do Mediabunny é a altura visível (712, não 720).
- **Não refeito pelo revisor:** VP8, VP9, AV1, MOV, HEVC, trecho vazio no começo, VFR, pixels não quadrados, vídeo girado sem cor, P4/P4c, emendas, 2 e 4 a caminho, CPU e memória.
- **Ressalva principal:** tudo, nas duas rodadas e no revisor, foi medido com `--disable-gpu`. O app não usa essa opção. No PC do usuário, a placa de vídeo pode decodificar e converter as cores nos dois caminhos, e nem a identidade de bytes, nem o palpite de cor, nem os tempos foram medidos assim.

### Decisões técnicas

#### D1. Onde entra

- `exporter.ts` continua dono do laço de quadros, das fases e dos erros. A busca de cada clipe passa por uma **fonte de quadros** por mídia: `SeekSource` (o `VideoPool` + `seekExact` de hoje, sem mudança de comportamento) ou `DecodeSource` (novo, `src/renderer/decodeSource.ts`). As duas entregam `{ image, width, height }` ao mesmo `renderFrame` por `getVideoFrame`.
- A parte pura vai para `src/core/exportPlan.ts`, testada no vitest: o tempo-alvo e a escolha do quadro (D2), as condições do D5 e a regra dos vizinhos, a cor do D4, os leitores por mídia e a regra das emendas (D3).
- `SEEK_EPSILON` e o recorte pela duração saem de `video.ts` para uma função de `src/core` (`seekTarget(src, D)`), usada pelos dois caminhos: o contrato fica num lugar só.

#### D2. Qual quadro aparece (o contrato)

- Alvo: `T2 = seekTarget(sourceTime(c, t), D) = min(max(0, src + 1e-4), max(0, D − 0,001))`, com `D` = `el.duration` do `<video>` daquela mídia, lido na conferência (D5) depois das buscas de referência. É a mesma conta do `seekExact`.
- Quadro: o decodificado de maior tempo de apresentação `≤ T2`; se nenhum (antes do primeiro), o primeiro quadro depois de `T2`. Os quadros saem do decodificador em ordem de apresentação, então a escolha é final quando sai um quadro posterior a `T2`. Medido igual ao quadro assentado do `<video>` em todos os arquivos comuns da rodada 2, inclusive bordas, além do fim e inícios fora da grade.
- Tempos: `VideoFrame.timestamp` (do decodificador) é igual a `EncodedPacket.microsecondTimestamp` (`Math.trunc(s × 1e6 × (1 + Number.EPSILON))`). A comparação é nesses microssegundos inteiros (`T2` convertido do mesmo jeito); a margem de 100 µs do `1e-4` cobre o arredondamento. Um `VideoFrame` feito do `<video>` arredonda em vez de truncar: qualquer comparação com ele usa ±2 µs.
- Os casos em que o Mediabunny e o FFmpeg do Chromium leem o tempo de forma diferente ficam fora pelas condições do D5 (tempo negativo; duração que não cobre o último quadro). O caso do VFR extremo (o `<video>` mostra um quadro-chave até 16 ms cedo) fica aceito: é um desvio do caminho de hoje, raro, e o caminho novo segue o arquivo.

#### D3. Leitores e emendas

- Um **leitor** = um cursor de pacotes do Mediabunny (`EncodedPacketSink`) + um `VideoDecoder`. Os clipes de vídeo de cada mídia se repartem em faixas sem sobreposição na linha do tempo (como `audioLanes`): cada faixa tem um leitor. Uma mídia usada duas vezes ao mesmo tempo (uma cópia por cima) tem dois leitores.
- Dentro de um pedaço, o leitor só anda para a frente. Alimenta pacotes em ordem de decodificação enquanto `decodeQueueSize < 3` (evento `dequeue`) **e** houver menos de 4 quadros decodificados esperando uso. Sem o segundo limite, o decodificador encheria a memória com o arquivo inteiro, porque o envio é bem mais lento que decodificar (medido: 4 e 8 dão a mesma velocidade; com 4, no máximo 7 quadros guardados). Sem `flush` no meio (com quadros B, o decodificador só solta um quadro depois de receber os seguintes); `flush()` só no fim do arquivo. Começar num pacote-chave é sempre `getKeyPacket(t, { verifyKeyPackets: true })` (sem isso, o GOP aberto quebra o decodificador), ou `getFirstKeyPacket()` quando não há.
- **Emendas (regra J2):** no primeiro alvo de um pedaço novo, se o alvo não está antes do quadro mostrado e o pacote-chave do alvo já foi entregue ao decodificador, o leitor continua para a frente (os quadros do buraco são decodificados e fechados sem uso). Senão, `reset()` + `configure()` e recomeça no pacote-chave `≤` alvo. Medido: ~100 ms no quadro da emenda, contra ~220 ms de recomeçar sempre (J1), com os mesmos bytes. A regra fica em `exportPlan.ts` (pura).
- Todo `VideoFrame` é fechado assim que deixa de ser o quadro atual, num `reset` e no fim. O leitor de uma faixa que não volta mais a aparecer fecha seu decodificador.
- Pré-leitura do próximo pedaço antes da emenda (como `nextToPrefetch`): opcional, a quem constrói, só se a medição mostrar ganho.

#### D4. Orientação, proporção e cor

- **Orientação:** `getDecoderConfig()` não traz rotação nem espelho. O `DecodeSource` acrescenta `rotation: await track.getRotation()` (sentido horário) e `flip: await track.getFlip()` ao `VideoDecoderConfig`; o Chromium 156 os aceita, os `VideoFrame` saem com `displayWidth × displayHeight` já girados e o `drawImage` aplica a rotação (medido idêntico em MP4 e MOV, 90/180/270 e 90 + espelho; confirmado pelo revisor).
- **Proporção:** o `getDecoderConfig()` traz `displayAspectWidth/Height` quando os pixels não são quadrados, e o `displayWidth × displayHeight` do quadro bate com o `<video>` (medido).
- `width`/`height` entregues ao `renderFrame` são `displayWidth`/`displayHeight` do quadro, e precisam ser iguais a `el.videoWidth`/`el.videoHeight` (condição do D5).
- **Cor:** quando o arquivo traz cor (no fluxo, no contêiner, ou só a faixa completa), os dois caminhos já dão os mesmos bytes. Quando o `colorSpace` do `getDecoderConfig()` não tem `matrix`, `primaries` nem `transfer`, o `DecodeSource` copia para o `VideoDecoderConfig` o `colorSpace` de um `new VideoFrame(el)` do `<video>` daquela mídia (feito na conferência e fechado logo depois). Esse `colorSpace` é a cor que o Chromium usou, inclusive o palpite para arquivo sem cor (confirmado pelo revisor). Neste computador o palpite é BT.709 para H.264 e VP8 com 720 linhas ou mais, BT.601 abaixo disso, e nenhum para VP9 e AV1. Copiar em vez de deduzir evita depender dessa regra, que não foi medida em vídeo girado sem cor nem com a placa de vídeo. Se o `new VideoFrame(el)` falhar, a mídia vai pelo caminho de hoje.
- Aceleração do decodificador: `no-preference`, como o `<video>` daquele PC escolhe. No CI só há software; a conferência (D5) cobre a diferença no PC do usuário.

#### D5. Quem usa o caminho novo: condições e conferência

Por mídia, logo depois de escolhido o arquivo de saída (o `exportStart` já respondeu), como primeira fase da janela de exportar ("Preparando a exportação rápida…"). O `preflight` de hoje (os vídeos abrem?) continua antes da janela de salvar, sem mudança. Cancelar durante a conferência segue o caminho de cancelar dos quadros (`exportCancel`: nada gravado, temporários apagados). Por que depois da janela de salvar: ela continua aparecendo tão rápido quanto hoje, e o custo da conferência (1–3 s por mídia em 1080p no computador de teste) aparece junto com o progresso. Ela compensa mesmo em mídia curta: cada segundo de saída pelo caminho novo economiza ~6 s no computador de teste, então ela se paga a partir de ~0,3 s de uso da mídia.

1. O Mediabunny abre o arquivo e acha a faixa de vídeo principal; `VideoDecoder.isConfigSupported(config)` (com rotação, espelho e cor do D4) diz que sim.
2. O primeiro tempo de apresentação da faixa não é negativo (sem corte no meio de um quadro; ver "Medições").
3. O último quadro começa antes de `D` (o `el.duration` cobre todos os quadros). Isso deixa de fora o trecho vazio longo, em que o próprio `<video>` muda de duração enquanto carrega. Se `D` crescer depois, a escolha do quadro não muda (todos os quadros já começam antes do `D` lido), a não ser no último milissegundo.
4. O tamanho de exibição do caminho novo é igual a `el.videoWidth` × `el.videoHeight`.
5. **Conferência de imagem.** Em 3 instantes da mídia (o começo do primeiro pedaço usado, o meio e perto do fim do uso), o quadro do caminho novo e o do `seekExact` **assentado** são desenhados no tamanho de exibição e comparados.
   - Assentado: depois do `seeked`, o `<video>` é desenhado de novo após pelo menos 30 ms (50 ms sugeridos), até duas leituras seguidas darem iguais, no máximo 5 leituras. Se não assentar, a mídia vai pelo caminho de hoje.
   - Passa se forem idênticos.
   - Se não forem, passa só se o PSNR for ≥ 40 dB **e** o quadro novo estiver mais perto do de hoje em `T` do que dos de hoje em `T − 1 quadro` e `T + 1 quadro`. Um vizinho que não existe, ou que é idêntico ao de `T`, não conta. Assim um erro de tempo não passa por "parecido". O limite de 40 dB fica bem acima das diferenças erradas medidas (cor: 24–31 dB; rotação: 0,9–3,8 dB).
   - Se o `seekExact` não conseguir mostrar o quadro num instante (por exemplo, o `<video>` dispara `error`, como no GOP aberto), a mídia vai pelo caminho de hoje, que se comporta como hoje.
6. Qualquer falha manda **só aquela mídia** para o caminho de hoje. Não é erro. O resultado da exportação registra o caminho de cada mídia, o motivo da queda e o PSNR de cada instante (para o e2e e para diagnóstico). A janela de exportar mostra uma linha curta com o nome de cada mídia que foi pelo caminho de hoje (texto exato a quem constrói, em pt-BR simples).

#### D6. Falhas no meio da exportação

- Erro do decodificador ou da leitura: aquela mídia passa para o caminho de hoje a partir do quadro atual (a imagem é a mesma) e a exportação continua. Se o caminho de hoje também falhar (arquivo sumiu), vale o comportamento de hoje (para e mostra a mensagem).
- Vigia: se um leitor não entrega o quadro pedido em 10 s (o mesmo limite do `seekExact`), conta como erro e cai para o caminho de hoje.

#### D7. Envio dos quadros

- Até **3 quadros a caminho** (medido: 1 → 20,1 fps; 2 → 25,0; 3 → 25,2; 4 → 23,6). Enquanto o `export:frame` do quadro N espera o ffmpeg, os quadros N+1 e N+2 são montados. O cancelamento continua parando em até 2 quadros depois (o e2e exige ≤ 12 com o cancelamento no 10).
- O main não muda: os `invoke` chegam em ordem e as escritas no stdin do ffmpeg seguem essa ordem, com a mesma espera pelo `drain` (medido: quadros em ordem, MP4 idênticos).
- O quadro continua indo pelo `contextBridge`, como hoje. A transferência do buffer ao mundo do preload (P4) não entra: como especificada, ficou mais lenta com 3 a caminho; a variante que resolve isso (P4c, 5–8 ms por quadro a menos) foi medida numa sessão só e muda o contrato do IPC. Fica para depois, com medição própria.

#### D8. Tempo restante

`onProgress` continua `{frame, total}`, mais uma fase de conferência (por exemplo, `{checking: {done, of}}`) para a janela mostrar "Preparando a exportação rápida…". A janela mostra "Faltam cerca de N minutos" (ou "menos de 1 minuto") a partir de 5 s de quadros, pela média dos últimos ~10 s, arredondada para não pular. O ritmo medido fica guardado para a estimativa antes de exportar que a E5 traz.

#### D9. Dependência

- `mediabunny` na versão exata `1.65.2` (sem `^`): a versão medida em todas as rodadas, publicada em 04/11/2026, mais de duas semanas antes da instalação. A 1.66.x é mais nova e não foi medida. Fica em `devDependencies`, empacotado pelo Vite em `dist/renderer` (o Diretor já empacota tudo assim). Só o que é usado é importado (`Input`, a fonte, os formatos MP4/MOV e WebM, `EncodedPacketSink`). O pacote não usa `eval`, Worker nem WebAssembly (conferido no protótipo e pelo revisor, com a CSP do app).
- MPL-2.0: os arquivos do Mediabunny não são modificados. O texto da licença e o endereço do código-fonte vão em `dist` junto com o Diretor, até a tela "Sobre > Licenças" (D12 do bloco 1) existir.

#### D10. Testes e aceite

- **Unitários (vitest):** `seekTarget` igual ao de hoje (o teste de `f/fps + 1e-4` em 24000/1001 continua); escolha do quadro (bordas, antes do primeiro, além do fim, microssegundos); condições do D5 (tempo negativo, último quadro depois de `D`, tamanho diferente); a regra dos vizinhos da conferência (vizinho idêntico ou inexistente não conta); a cor do D4 (cópia só quando o arquivo não traz cor); faixas de leitores (sobreposição da mesma mídia, pedaços contíguos); a regra J2 das emendas (para a frente quando o alvo não está antes do mostrado e o pacote-chave dele já foi entregue; senão, reset; para trás, sempre reset); texto do tempo restante.
- **E2E (Linux com xvfb e CI do Windows, `--disable-gpu`):**
  - Os 73 checks passam com o caminho novo, e o e2e confirma que a mídia principal usou o caminho novo. (A fixture do e2e é H.264 sem informação de cor em 1280×720: sem a cor do D4, os checks de "prévia = exportação" já pegariam o erro.)
  - Arquivos novos, cada um exportado pelo caminho novo, com quadros conferidos contra o original como os checks de hoje ("quadro N do original") e o resultado dizendo que usaram o caminho novo: vídeo em pé (rotação 90 e 90 + espelho), BT.601 de faixa completa marcado, VFR moderado, 24 e 60 fps num projeto de 30, WebM VP9, MOV girado, e um projeto com a mesma mídia sobreposta.
  - Um arquivo com trecho vazio no começo (edit list vazia): o resultado diz qual caminho usou (o D5 decide pelo `el.duration`), e os quadros conferem com o original em qualquer um dos dois.
  - Queda: um corte sem recodificar que começa no meio de um quadro vai pelo caminho de hoje (motivo no resultado, linha na janela); uma falha forçada do decodificador no quadro N (opção só de teste) termina a exportação pelo caminho de hoje, com os quadros conferidos.
  - Velocidade: um 1080p30 de 10 s pelos dois caminhos na mesma execução (o de hoje forçado por opção só de teste), razão de quadros por segundo ≥ 3 (os dois números vão para o log).
  - Cancelar (inclusive durante a conferência nova), queda do renderer e temporários: sem mudança.
- **Manual, no computador de teste:** uma exportação de 1 h em 1080p e uma de respirações cortadas, medidas; os tempos vão para o usuário com a entrega.

### Riscos

- **Placa de vídeo no PC do usuário** (o maior). Tudo foi medido com `--disable-gpu`, e o CI também roda assim. Com a placa, o `<video>` e o `VideoDecoder` podem decodificar ou converter cor por caminhos diferentes; nem a identidade de bytes, nem a cor copiada, nem a velocidade foram medidas assim. Mitigação: a cor vem do `<video>` do próprio PC (D4); a conferência roda no PC do usuário a cada exportação (D5) e, se não bater, aquela mídia vai pelo caminho de hoje (certo, mas lento); a janela mostra isso, e o resultado registra caminho, motivo e PSNR. Se acontecer em todo arquivo no PC do usuário, o próximo passo é medir lá (por exemplo, `prefer-software` no decodificador).
- **HDR do iPhone** (HEVC 10 bits HLG/Dolby Vision): o Chromium pode converter diferente nos dois caminhos. Mitigação: a conferência derruba para o caminho de hoje. HEVC só decodifica com hardware; sem ele, nem a prévia toca.
- **Arquivo esquisito** (edit list incomum, pacotes fora de ordem, faixas extras): condições, conferência e queda.
- **Velocidade no PC do usuário** desconhecida: medida só num computador de 4 núcleos, e a hora projetada de execuções de até 90 s (a memória ficou estável em 13 execuções seguidas). O tempo restante aparece e o usuário mede.
- **Gargalo que fica:** a thread principal do renderer (desenhar, `getImageData` e a cópia de 8,3 MB pelo `contextBridge`) e, com 4 núcleos, a própria CPU (3,2 de 4 ocupadas). O P4c e a abordagem 2 atacam isso, se precisar.
- **O caminho de hoje às vezes desenha o quadro anterior** logo depois do `seeked` (medido nos protótipos, até 16 em 1.800 alvos com o PC ocupado; não no app). Continua assim nos arquivos que caem para ele; a conferência do D5 usa o quadro assentado para não se enganar.

### Deixado para quem constrói

Pré-leitura do próximo pedaço; a escolha exata dos 3 instantes e das esperas do "assentado"; `UrlSource` ou uma fonte própria com Range fechado (as duas medidas iguais nos tempos; a própria lê do disco só o que pede, e o `UrlSource` leu ~2× o tamanho do arquivo por `Input`); ler o contêiner no renderer ou no main; o texto exato da fase de conferência e da linha das mídias que foram pelo caminho de hoje.
