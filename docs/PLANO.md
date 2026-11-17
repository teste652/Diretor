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
- Modo econômico ligado por padrão, teto de contexto configurável com autorização para pedidos maiores, métricas do editor identificadas como tal.

Decisões:

- Keyframes ficam em segundos relativos ao início do clipe: mover o clipe leva a animação junto.
- Presets (`animate`) viram keyframes comuns ao entrar no rascunho, então tudo o que o Claude faz é editável à mão.
- Seleção: selecionar o próprio alvo do rascunho (ou nada) não o desatualiza; selecionar outro clipe, sim. Assim dá para ajustar o rascunho sem perdê-lo.
- Uma proposta ativa por vez. Uma nova só entra se a anterior foi decidida ou com `replaces`.

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

- Fase 1 implementada e testada automaticamente no Linux (unitários, MCP real, exportação, e2e no Electron com xvfb).
- Falta verificar no Windows e no Claude Desktop real (ver `docs/ROTEIRO-DE-TESTE.md`).
- Próximo passo: rodar o roteiro no Windows, corrigir o que aparecer, empacotar um instalador (electron-builder) e começar as máscaras/imagens.
