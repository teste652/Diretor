// Servidor MCP local (stdio) que o Claude Desktop inicia. Ele não edita nada
// sozinho: repassa cada chamada para o editor aberto, que valida e mostra
// a proposta como rascunho. Sem chave de API, sem chamadas à internet.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { bridgeFilePath } from '../shared/paths';

/** Espera máxima de get_proposal (o editor também limita). */
const MAX_WAIT_SECONDS = 45;

/** Tempo limite de cada chamada ao editor: sempre abaixo dos ~60 s que o Claude Desktop espera por uma ferramenta. */
export function callTimeoutMs(method: string, params: unknown): number {
  if (method !== 'get_proposal') return 20_000;
  const wait = Math.min(Math.max(Number((params as { waitSeconds?: unknown })?.waitSeconds) || 0, 0), MAX_WAIT_SECONDS);
  return Math.min(57_000, (wait + 10) * 1000);
}

/**
 * Repassa a chamada ao editor. `signal` é o cancelamento do Claude Desktop (botão
 * parar, ou o cliente desistiu): a espera do outro lado termina na hora e não
 * consome as notas do usuário que a próxima chamada deve receber.
 */
export async function callEditor(method: string, params: unknown = {}, signal?: AbortSignal): Promise<unknown> {
  let info: { port: number; token: string };
  try {
    info = JSON.parse(readFileSync(bridgeFilePath(), 'utf8'));
  } catch {
    return { error: 'editor_closed', message: 'Abra o editor Diretor e tente de novo.' };
  }
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${info.token}` },
      // Quem usa este servidor: o chat do painel marca (DIRETOR_CLIENT); o Claude Desktop não.
      body: JSON.stringify({ method, params, client: process.env.DIRETOR_CLIENT || undefined }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(callTimeoutMs(method, params))]) : AbortSignal.timeout(callTimeoutMs(method, params)),
    });
    const body = (await res.json()) as { result?: unknown; error?: string };
    return body.error ? { error: 'editor_error', message: body.error } : body.result;
  } catch (e) {
    if (signal?.aborted) return { error: 'cancelled', message: 'Chamada cancelada.' };
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'))
      return { error: 'timeout', message: 'O editor demorou para responder. Tente de novo; se continuar, confira se ele não está ocupado exportando.' };
    return { error: 'editor_closed', message: 'O editor Diretor não está respondendo. Ele está aberto?' };
  }
}

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] });

const OPS_HELP = `Cada op é um objeto JSON. Tempos em segundos. "t" de keyframe é relativo ao início do clipe: para o frame N da linha do tempo, t = N/fps − start do clipe. Só os campos listados são aceitos; qualquer outro é recusado (ex.: não existe "end": o fim é start + duration).
- {"op":"animate","clipId","preset","start"?,"duration"?,"ease"?,"group"?} presets: fadeIn fadeOut slideUpIn slideDownIn slideLeftIn slideRightIn slideUpOut slideDownOut popIn popOut slowZoom. Vira keyframes editáveis.
- {"op":"setKeyframe","clipId","prop","t","v","ease"?,"group"?,"keyframeId"?} props: x,y (px a partir do centro), scale, opacity(0-1). ease: linear easeIn easeOut easeInOut hold.
- {"op":"removeKeyframe","clipId","prop","keyframeId"} | {"op":"clearKeyframes","clipId","prop"?,"group"?}
- {"op":"retimeGroup","clipId","group","start","duration"} (muda início/duração de um grupo, ex.: "entrada")
- {"op":"trimClip","clipId","edge":"start"|"end","delta","ripple"?} apara uma borda (delta>0 = para a direita). Entrada fica no começo, saída no fim. Em vídeo, os vídeos seguintes da faixa acompanham a mudança (ripple:false para não mexer neles).
- {"op":"setProperty","clipId","prop","value"} (só para propriedade sem pontos; com pontos use setKeyframe)
- {"op":"addClip","clip":{"kind":"title"|"caption","text","start","duration","id"?,"style"?,"preset"?}} (caption preset: padrao caixa destaque)
- {"op":"updateClip","clipId","set":{"start"?,"duration"?,"in"?,"text"?,"style"?,"preset"?,"volume"?(0-1),"muted"?}}
style: {"fontFamily"?,"fontSize"?(6-400),"fontWeight"?(100-1000),"color"?,"background"?("" = sem caixa),"align"?,"shadow"?}. Importar mídia e travar/esconder faixas são só do usuário.
- {"op":"removeClip","clipId"}`;

export function createServer(call: typeof callEditor = callEditor): McpServer {
  const server = new McpServer({ name: 'diretor', version: '0.1.0' });

  server.tool(
    'get_context',
    'Lê o estado do editor Diretor: revisão, seleção atual (clipes compactos com keyframes) e playhead. Modo econômico: por padrão só a seleção. Passe knownRevision para reaproveitar o que já tem (responde {unchanged}). include:["timeline"] traz todos os clipes (use range para limitar). Se vier "truncated", reduza o pedido ou use allowLarger:true (o usuário autoriza no editor).',
    {
      knownRevision: z.number().int().optional(),
      include: z.array(z.enum(['timeline', 'media'])).optional(),
      range: z.object({ start: z.number(), end: z.number() }).optional(),
      allowLarger: z.boolean().optional(),
    },
    async (args, extra) => text(await call('get_context', args, extra.signal)),
  );

  server.tool(
    'propose_edit',
    `Propõe uma edição como RASCUNHO no editor. O usuário vê cada etapa na prévia e na linha do tempo, pode ajustar à mão, aceitar ou descartar; só então ela é gravada. Divida em etapas pequenas e com nome (ex.: "Entrada", "Saída"); uma etapa é mostrada por vez, na ordem. Para o usuário ver o trabalho assim que cada parte fica pronta, envie a primeira etapa logo e acrescente as seguintes com appendTo=<id da proposta>. Use baseRevision do get_context e um requestId novo para cada pedido (reenviar exatamente a mesma chamada com o mesmo requestId devolve o estado existente, sem duplicar; o mesmo requestId com outro conteúdo é recusado com request_id_conflict). Para pedidos vagos, escolha presets e valores sensatos; para pedidos precisos, use setKeyframe.\n${OPS_HELP}`,
    {
      requestId: z.string().min(1),
      baseRevision: z.number().int(),
      title: z.string().min(1),
      summary: z.string().optional(),
      steps: z
        .array(z.object({ label: z.string(), summary: z.string().optional(), ops: z.array(z.record(z.any())).min(1) }))
        .min(1),
      replaces: z.string().optional(),
      appendTo: z.string().optional(),
    },
    async (args, extra) => text(await call('propose_edit', args, extra.signal)),
  );

  server.tool(
    'get_proposal',
    'Estado de uma proposta: etapas aceitas/descartadas/ajustadas pelo usuário, e notas que ele escreveu no editor (userNotes). waitSeconds (até 45) espera uma mudança a partir de sinceVersion. Se status="stale", só refaça quando redoRequested=true (o contexto atual vem junto) ou quando o usuário pedir no chat; nesse caso use replaces e um requestId novo. Siga o campo "next".',
    {
      proposalId: z.string(),
      waitSeconds: z.number().min(0).max(MAX_WAIT_SECONDS).optional(),
      sinceVersion: z.number().int().optional(),
    },
    async (args, extra) => text(await call('get_proposal', args, extra.signal)),
  );

  server.tool('cancel_proposal', 'Cancela uma proposta pendente (nada é gravado).', { proposalId: z.string() }, async (args, extra) =>
    text(await call('cancel_proposal', args, extra.signal)),
  );

  server.tool('editor_status', 'Confere se o editor está aberto; mostra revisão, presets e propriedades animáveis.', {}, async (_args, extra) =>
    text(await call('status', {}, extra.signal)),
  );

  return server;
}

if (typeof require !== 'undefined' && require.main === module) {
  const server = createServer();
  void server.connect(new StdioServerTransport());
}
