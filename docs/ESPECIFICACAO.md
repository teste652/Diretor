# Editor de vídeo desktop com edição compartilhada por IA

Construa um editor para Windows com a facilidade de uso que gosto no CapCut, identidade própria e foco em motion graphics. Quero editar à mão e colaborar com o Claude Desktop na mesma linha do tempo. Use a imagem anexa **Referencia-Visual-Editor.png** como referência. Ela mostra a interface desejada, incluindo recursos de fases posteriores.

**Nesta sessão, implemente a Fase 1 e execute os testes que o ambiente permitir.** Inspecione o repositório e o ambiente, preserve o trabalho existente e justifique a tecnologia em poucas linhas. Se o repositório estiver vazio, monte a estrutura inicial. Use GitHub para versionar se já estiver conectado.

## Interface e comportamento

Mídias à esquerda, prévia no centro, chat lateral à direita e linha do tempo embaixo. Use fundo grafite, cantos arredondados e azul bem claro no lugar do lilás, nos botões, seleções e destaques de rascunho. Ao pressionar um botão, reduza levemente sua escala. Ao soltar, faça um pequeno retorno elástico até o tamanho normal. Dê destaque a **Aceitar**, **Descartar** e **Ajustar na linha do tempo**.

## Fase 1 — Editor funcional com Claude Desktop

- Importe um MP4 local, apare o início e o fim e adicione uma camada de título. Inclua uma faixa própria de legendas manuais com botão **Adicionar legenda** e edição de texto, início, fim e estilo.
- Anime posição, escala e opacidade com pontos editáveis (keyframes), duração e suavização básica. Inclua desfazer e refazer. Salve e reabra o projeto e exporte um MP4 curto. Preserve os originais e mantenha prévia e exportação coerentes em enquadramento, tempo, legendas, animação e áudio.
- Use as mesmas operações de edição para a interface e para a integração MCP local. O Claude consulta a seleção e propõe mudanças. Valide no editor o alvo, os parâmetros, o intervalo e a revisão do projeto.
- Mostre cada etapa em rascunho na prévia e na linha do tempo assim que estiver pronta. Eu posso assistir, ajustar à mão, aceitar ou descartar. Avance para a próxima etapa depois da minha decisão. Grave a mudança no projeto só após a aprovação. Mantenha camadas, propriedades e keyframes editáveis e permita desfazer cada etapa aprovada separadamente.
- Se a seleção ou a revisão mudar, marque o rascunho como desatualizado e ofereça refazer a proposta com o contexto atual. Uma chamada repetida deve devolver o rascunho ou o estado existente, sem duplicar mudanças.
- Use minha conta já autenticada no Claude Desktop e respeite os limites desse cliente. O editor deve funcionar manualmente com a IA desconectada. A edição assistida deve operar sem créditos próprios, chave de API paga ou cobrança automática por comando.

### Modo econômico

Ative por padrão. Envie apenas o identificador e os dados relevantes do objeto, o intervalo, os parâmetros necessários e a revisão do projeto. Dê respostas curtas nas ferramentas e reaproveite dados válidos para a mesma revisão. Faça prévia, renderização e ajustes manuais localmente, sem chamadas de IA em segundo plano ou durante o arraste. Mantenha a mídia local. Qualquer envio de imagens ou trechos ao chat depende da minha autorização.

Inclua um teto configurável para o tamanho do contexto que o editor envia por ação. Se a ação precisar de mais dados, deixe reduzir o trecho ou autorizar uma consulta maior. Identifique o tamanho do contexto e qualquer estimativa como métricas do editor. A cota e o consumo total de tokens são definidos pelo assistente. Mostre dados de uso do provedor apenas quando estiverem disponíveis e identificados como tais.

## Fase 2 — Perspectiva e Codex como reserva

Permita importar uma imagem e girar a camada nos eixos X e Y com perspectiva, como um cartão virando de lado. Exponha rotação, perspectiva e keyframes no painel de propriedades. A proposta da IA continua editável e usa a mesma transformação na prévia e na exportação.

Inclua um seletor manual com Claude como principal e Codex local como reserva, com um assistente ativo por vez. Use as mesmas ferramentas MCP e regras de aprovação. Ao trocar, o Codex retoma o mesmo projeto por um resumo curto da seleção, da última etapa aceita e dos rascunhos pendentes. Use esse resumo para evitar reenviar a conversa inteira ou repetir alterações.

## Fase 3 — Painel dentro do chat

Use MCP Apps em um cliente compatível para mostrar a prévia do trecho, o estado da proposta e os controles de revisão dentro da conversa. Sincronize esse painel com o projeto aberto no editor desktop. Confirme na documentação oficial se o cliente suporta ferramentas locais, interface interativa e acesso à prévia. Registre qualquer limitação que afete o fluxo. Planeje legendas automáticas e biblioteca de transições para depois dessas fases.

- [MCP local no Claude Desktop](https://support.claude.com/pt/articles/10949351-comecando-com-servidores-mcp-locais-no-claude-desktop)
- [Conectores interativos no Claude](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude)
- [MCP no Codex](https://developers.openai.com/codex/mcp)

## Testes e entrega

1. Importe e apare um MP4 curto. Adicione uma legenda manual, selecione o título e peça no Claude Desktop “Faz esse título subir suavemente no começo e desaparecer no fim”.
2. Confira a entrada em rascunho. Ajuste a duração à mão e aceite. Descarte a saída e verifique que a entrada aprovada ficou no projeto. Teste uma proposta desatualizada e uma chamada repetida.
3. Desfaça e refaça a entrada. Salve, reabra e exporte. Compare prévia e MP4 no início, no meio e no fim da animação. Verifique a duração, a legenda e o áudio se houver.
4. Na Fase 2, edite um keyframe de perspectiva proposto pela IA. Troque para o Codex e confirme que ele retoma o mesmo trecho sem duplicar mudanças. Verifique o teto de contexto com um comando simples.

Entregue um plano curto, o código da Fase 1 e um README com instalação, conexão do Claude Desktop e roteiro de teste. Separe o que foi verificado automaticamente do que precisa ser testado no meu computador. Se a sessão parar, registre o que ficou pronto e o próximo passo para retomar.
