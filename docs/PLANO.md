# Plano

## Fase 1 — Editor funcional com Claude Desktop (este PR)

Pronto:

- Importar MP4 local, aparar início e fim, título, faixa de legendas manuais (texto, início, fim, estilo).
- Posição, escala e opacidade com keyframes editáveis, grupos de animação com duração, suavização básica (linear, acelerar, desacelerar, suave, segurar).
- Desfazer/refazer, salvar/abrir (`.diretor.json`), exportar MP4 com áudio.
- Prévia e exportação pelo mesmo compositor (verificado por comparação de quadros).
- Camada única de operações para interface e MCP; validação de alvo, parâmetros, intervalo e revisão.
- Propostas em etapas, mostradas como rascunho uma por vez; ajuste manual vai para o rascunho; gravação só após aceitar; cada etapa aceita é desfeita separadamente.
- Rascunho desatualizado (projeto ou seleção mudaram) com “Refazer com contexto atual”; chamadas repetidas idempotentes (`requestId`).
- Modo econômico ligado por padrão, com teto de contexto e autorização para pedidos maiores. Depois da Fase 1, a pedido do usuário: o botão liga e desliga com um clique, os números em KB saíram da tela, o teto (6 KB) só vale com o modo ligado (desligado, a IA vê o projeto todo sem pedir licença) e trocar o modo desfaz um pedido ou uma recusa pendente. Um teto salvo por uma versão antiga é ignorado.

Decisões:

- Keyframes ficam em segundos relativos ao início do clipe: mover o clipe leva a animação junto.
- Presets (`animate`) viram keyframes comuns ao entrar no rascunho, então tudo o que o Claude faz é editável à mão.
- Seleção: selecionar o próprio alvo do rascunho (ou nada) não o desatualiza; selecionar outro clipe, sim. Assim dá para ajustar o rascunho sem perdê-lo.
- Uma proposta aberta por vez (ativa ou desatualizada). Uma nova só entra se a anterior foi decidida ou com `replaces`, e `appendTo` não reabre uma proposta concluída enquanto outra espera o usuário.
- O Claude nunca é orientado a refazer por conta própria: `get_proposal` e uma tentativa de `appendTo` numa proposta desatualizada dizem para esperar o pedido de “refazer”; numa descartada, para não propor de novo sem o usuário pedir.
- Notas do usuário vão para a chamada que o Claude ainda está lendo: se ele cancela a espera (botão parar), o cancelamento atravessa servidor MCP → ponte → editor, e uma espera abandonada é substituída pela mais nova.
- Mesmo `requestId` com o mesmo conteúdo devolve a proposta existente; com conteúdo diferente, é recusado (`request_id_conflict`), para nunca misturar dois pedidos.
- Com rascunho aberto, Ctrl+Z/Ctrl+Y valem só para os ajustes manuais do rascunho; o histórico do projeto fica intacto até aceitar ou descartar.
- Aparar: animações que tocam as duas bordas são reescaladas; as presas ao fim acompanham o fim; as demais acompanham o conteúdo. Pontos que saem do clipe viram um ponto na borda com o valor que a própria animação tinha naquele instante (uma animação nunca herda o valor de outra). Aparar o início de um vídeo mantém o clipe no lugar e puxa os vídeos seguintes da faixa.
- Presets nunca sobrescrevem o valor de repouso de uma propriedade, e cada um só substitui pontos do próprio grupo.
- Ao abrir um projeto, a revisão só cresce, para uma proposta antiga nunca valer no projeto novo.
- Importar mídia, faixas, nome e formato do projeto são sempre do usuário: mesmo com “Ajustar na linha do tempo” ligado, vão para o projeto, nunca para a etapa do Claude.
- Exportação grava num temporário na mesma pasta (`.diretor-….part`, com o formato passado explícito ao ffmpeg) e troca pelo destino só no fim; cancelar, fechar ou cair nunca apagam um arquivo que já existia. O ffmpeg é encerrado de verdade (entrada fechada e, se preciso, SIGKILL). No Windows, um destino aberto num player ou lido pelo antivírus recusa a troca: o editor tenta de novo por ~4 s e depois salva como “nome (1).mp4”, com aviso, em vez de perder o vídeo pronto. Cancelar, fechar ou cair durante essas tentativas cancela como em qualquer outro momento (o destino não muda; uma troca já feita é atômica e fica feita).
- fps NTSC (23,976, 29,97, 59,94) é guardado exato (24000/1001…) e passado ao ffmpeg como fração, para a exportação não escorregar um quadro a cada ~42 s.

Limitação conhecida: dois presets na mesma propriedade (ex.: `popOut` e depois `slowZoom`, ambos na escala) dividem a mesma lista de pontos; nada se perde e tudo é editável, mas o resultado pode precisar de ajuste à mão.

## Pensado para o que vem depois

- **Máscaras (ex.: quadrado de cantos arredondados que se move do frame X ao Y):** o modelo de propriedades é um registro (`src/core/properties.ts`). Uma máscara entra como novas propriedades animáveis (`mask.x`, `mask.y`, `mask.w`, `mask.h`, `mask.radius`) e um passo de recorte no compositor. Operações, validação, painel, rascunho e MCP já são genéricos.
- **Imagens como camada** (fundos): novo `kind` de clipe com o mesmo transform.

## Fase 2 — Perspectiva e Codex como reserva

- Camada de imagem; rotação X/Y e perspectiva no registro de propriedades; compositor com transformação 3D (WebGL ou matriz projetiva no canvas), usado igual na prévia e na exportação.
- Seletor Claude/Codex (um ativo por vez), mesmo servidor MCP. Resumo curto para retomada: seleção, última etapa aceita e rascunhos pendentes (a sessão já guarda esses dados por proposta).

## Fase 3 — Painel dentro do chat

- MCP Apps num cliente compatível: prévia do trecho, estado da proposta e controles de revisão sincronizados com o editor. Confirmar na documentação oficial o suporte a ferramentas locais, interface interativa e acesso à prévia antes de começar.
- Depois: legendas automáticas e biblioteca de transições.

## Estado e como retomar

- Fase 1 implementada, revisada a fundo e testada automaticamente no Linux (unitários, MCP real, exportação, e2e no Electron com xvfb) e no Windows pelo GitHub Actions.
- Falta verificar à mão no Windows e com o Claude Desktop real (ver `docs/ROTEIRO-DE-TESTE.md`).
- Instalador: `npm run dist` (electron-builder, NSIS por usuário). O CI gera, instala e testa a cada mudança e publica na `main` em https://github.com/teste652/Diretor/releases/download/teste/Diretor-Setup.exe. O botão “Conectar” no painel do Claude grava a configuração do Claude Desktop na pasta que cada versão dele lê (Claude-Data no Claude Desktop 4, MSIX mais antigo e instalação clássica). Instalar por cima nunca fecha o editor à força nem um Diretor de outra pasta, e desinstalar tira o Diretor da configuração do Claude Desktop (pedindo antes para fechar o Claude).
- Próximo passo: rodar o roteiro no Windows com o instalador, corrigir o que aparecer e começar as máscaras/imagens.
