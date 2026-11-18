// Claude Code e Codex de mentira para o teste de ponta a ponta (sem conta, sem internet).
// O Diretor inicia este arquivo do mesmo jeito que inicia os programas de verdade
// (DIRETOR_CLAUDE_CLI / DIRETOR_CODEX_CLI). Ele lê a mensagem pela entrada, abre o
// servidor MCP do Diretor exatamente como a configuração recebida manda, lê o
// contexto, propõe uma edição e responde no formato de saída de cada programa.
// Tudo o que recebeu vai para DIRETOR_IA_LOG (uma linha JSON por mensagem).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { appendFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const argv = process.argv.slice(2);
const codex = argv[0] === 'exec';
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

// Configuração do servidor do Diretor, como cada programa a recebe.
let server;
let resume;
let text;
let images;
if (codex) {
  const cfg = Object.fromEntries(
    argv
      .filter((_, i) => argv[i - 1] === '-c')
      .map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)]),
  );
  const env = Object.fromEntries([...(cfg['mcp_servers.diretor.env'] ?? '').matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  server = { command: JSON.parse(cfg['mcp_servers.diretor.command']), args: JSON.parse(cfg['mcp_servers.diretor.args']), env };
  const r = argv.indexOf('resume');
  resume = r >= 0 ? argv[r + 1] : undefined;
  text = input.trim();
  images = argv.filter((_, i) => argv[i - 1] === '-i').length;
} else {
  server = JSON.parse(readFileSync(valueOf('--mcp-config'), 'utf8')).mcpServers.diretor;
  resume = valueOf('--resume');
  const msg = JSON.parse(input.trim().split('\n')[0]);
  text = msg.message.content.find((c) => c.type === 'text')?.text ?? '';
  images = msg.message.content.filter((c) => c.type === 'image').length;
}
const session = resume ?? `sim-${randomUUID()}`;
if (process.env.DIRETOR_IA_LOG) appendFileSync(process.env.DIRETOR_IA_LOG, JSON.stringify({ codex, text, images, resume, args: argv, server }) + '\n');

const say = (t) => (codex ? out({ type: 'item.completed', item: { id: randomUUID(), type: 'agent_message', text: t } }) : out({ type: 'assistant', message: { content: [{ type: 'text', text: t }] }, session_id: session }));
const finish = (ok, error) => {
  if (codex) out(ok ? { type: 'turn.completed', usage: {} } : { type: 'turn.failed', error: { message: error } });
  else out({ type: 'result', subtype: 'success', is_error: !ok, result: ok ? '' : error, session_id: session });
};

if (codex) out({ type: 'thread.started', thread_id: session });
else out({ type: 'system', subtype: 'init', session_id: session, tools: [], mcp_servers: [{ name: 'diretor', status: 'connected' }] });

if (/erro-login/.test(text)) {
  // Como os programas de verdade: o Claude Code manda o erro também como uma "resposta" sintética,
  // e o Codex manda o mesmo erro duas vezes ("error" e "turn.failed"). O painel tem de mostrar um só.
  const msg = codex ? '401 Unauthorized: please run codex login' : 'Not logged in · Please run /login';
  if (codex) out({ type: 'error', message: msg });
  else out({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: msg }] }, error: 'authentication_failed', is_api_error_message: true, session_id: session });
  finish(false, msg);
  process.exit(1);
}
if (/demorar/.test(text)) {
  say('Trabalhando nisso…');
  await new Promise((r) => setTimeout(r, 120_000));
}

const client = new Client({ name: codex ? 'codex-simulado' : 'claude-simulado', version: '1' });
await client.connect(new StdioClientTransport({ command: server.command, args: server.args, env: { ...process.env, ...server.env } }));
const tool = async (name, args = {}) => {
  if (!codex) out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: randomUUID(), name: `mcp__diretor__${name}`, input: args }] }, session_id: session });
  else out({ type: 'item.started', item: { id: randomUUID(), type: 'mcp_tool_call', server: 'diretor', tool: name, status: 'in_progress' } });
  return JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
};
const ctx = await tool('get_context');
const clipId = ctx.selection?.[0]?.id;
if (!clipId) {
  say('Selecione um clipe para eu animar.');
  finish(true);
} else {
  const who = codex ? 'Codex' : 'Claude';
  const p = await tool('propose_edit', {
    requestId: randomUUID(),
    baseRevision: ctx.revision,
    title: `${who}: entrada suave`,
    summary: `Pedido: ${text}`,
    steps: [{ label: 'Entrada', ops: [{ op: 'animate', clipId, preset: 'fadeIn', duration: 0.5 }] }],
  });
  say(p.id ? `Pronto: deixei uma **entrada suave** como rascunho${images ? ` (vi ${images} imagem${images > 1 ? 'ns' : ''})` : ''}.` : `Não consegui: ${JSON.stringify(p)}`);
  finish(!!p.id, p.id ? undefined : 'proposta recusada');
}
await client.close();
process.exit(0);
