// Servidor MCP local (stdio) que o Claude Desktop inicia. Ele não edita nada
// sozinho: repassa cada chamada para o editor aberto, que valida e mostra
// a proposta como rascunho. Sem chave de API, sem chamadas à internet.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { bridgeFilePath } from '../shared/paths';

export async function callEditor(method: string, params: unknown = {}): Promise<unknown> {
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
      body: JSON.stringify({ method, params }),
    });
    const body = (await res.json()) as { result?: unknown; error?: string };
    return body.error ? { error: 'editor_error', message: body.error } : body.result;
  } catch {
    return { error: 'editor_closed', message: 'O editor Diretor não está respondendo. Ele está aberto?' };
  }
}

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] });

const OPS_HELP = `Cada op é um objeto JSON. Tempos em segundos. "t" de keyframe é relativo ao início do clipe (frame N = N/fps).
- {"op":"animate","clipId","preset","start"?,"duration"?,"ease"?,"group"?} presets: fadeIn fadeOut slideUpIn slideDownIn slideLeftIn slideRightIn slideUpOut slideDownOut popIn popOut slowZoom. Vira keyframes editáveis.
- {"op":"setKeyframe","clipId","prop","t","v","ease"?,"group"?,"keyframeId"?} props: x,y (px a partir do centro), scale, opacity(0-1). ease: linear easeIn easeOut easeInOut hold.
- {"op":"removeKeyframe","clipId","prop","keyframeId"} | {"op":"clearKeyframes","clipId","prop"?,"group"?}
- {"op":"retimeGroup","clipId","group","start","duration"}
- {"op":"setProperty","clipId","prop","value"}
- {"op":"addClip","clip":{"kind":"title"|"caption","text","start","duration","id"?,"style"?,"preset"?}} (caption preset: padrao caixa destaque)
- {"op":"updateClip","clipId","set":{"start"?,"duration"?,"in"?,"text"?,"style"?,"preset"?,"volume"?,"muted"?}}
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
    async (args) => text(await call('get_context', args)),
  );

  server.tool(
    'propose_edit',
    `Propõe uma edição como RASCUNHO no editor. O usuário vê cada etapa na prévia e na linha do tempo, pode ajustar à mão, aceitar ou descartar; só então ela é gravada. Divida em etapas pequenas e com nome (ex.: "Entrada", "Saída"); uma etapa é mostrada por vez. Use baseRevision do get_context e um requestId único por pedido (repetir o mesmo requestId devolve a proposta existente, sem duplicar). Para pedidos vagos, escolha presets e valores sensatos; para pedidos precisos, use setKeyframe.\n${OPS_HELP}`,
    {
      requestId: z.string().min(1),
      baseRevision: z.number().int(),
      title: z.string().min(1),
      summary: z.string().optional(),
      steps: z
        .array(z.object({ label: z.string(), summary: z.string().optional(), ops: z.array(z.record(z.any())).min(1) }))
        .min(1),
      replaces: z.string().optional(),
    },
    async (args) => text(await call('propose_edit', args)),
  );

  server.tool(
    'get_proposal',
    'Estado de uma proposta: etapas aceitas/descartadas/ajustadas pelo usuário. waitSeconds (até 50) espera uma mudança a partir de sinceVersion. Se status="stale", leia o contexto (vem junto quando o usuário pede refazer) e proponha de novo com replaces.',
    {
      proposalId: z.string(),
      waitSeconds: z.number().min(0).max(50).optional(),
      sinceVersion: z.number().int().optional(),
    },
    async (args) => text(await call('get_proposal', args)),
  );

  server.tool('cancel_proposal', 'Cancela uma proposta pendente (nada é gravado).', { proposalId: z.string() }, async (args) =>
    text(await call('cancel_proposal', args)),
  );

  server.tool('editor_status', 'Confere se o editor está aberto; mostra revisão, presets e propriedades animáveis.', {}, async () =>
    text(await call('status', {})),
  );

  return server;
}

if (typeof require !== 'undefined' && require.main === module) {
  const server = createServer();
  void server.connect(new StdioServerTransport());
}
