// Teste de ponta a ponta do MCP: cliente MCP real (como o Claude Desktop) →
// servidor stdio compilado → ponte local com token → sessão do editor.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleBridge } from '../src/core/api';
import { findClip } from '../src/core/model';
import { keyframeGroups } from '../src/core/properties';
import { EditorSession } from '../src/core/session';
import { startBridge } from '../src/main/bridge';

const dir = mkdtempSync(join(tmpdir(), 'diretor-mcp-'));
const bridgeFile = join(dir, 'bridge.json');
const session = new EditorSession();
let close: () => void;
let client: Client;

const waitersOf = (s: EditorSession) => (s as unknown as { waiters: unknown[] }).waiters.length;
async function until(cond: () => boolean, ms = 3000) {
  for (const t0 = Date.now(); !cond(); ) {
    if (Date.now() - t0 > ms) throw new Error('condição não aconteceu a tempo');
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function tool(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
  return JSON.parse(r.content[0].text);
}

beforeAll(async () => {
  execSync('node scripts/build-main.mjs', { stdio: 'ignore' });
  session.dispatch([{ op: 'addClip', clip: { kind: 'title', id: 't1', text: 'EM MOVIMENTO', duration: 5 } }]);
  session.setSelection({ clipIds: ['t1'] });
  const b = await startBridge(bridgeFile, (m, p, signal) => handleBridge(session, m, p, signal));
  close = b.close;
  client = new Client({ name: 'teste', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: ['dist/mcp/server.cjs'], env: { ...process.env, DIRETOR_BRIDGE_FILE: bridgeFile } as Record<string, string> }),
  );
}, 30_000);

afterAll(async () => {
  await client?.close();
  close?.();
});

describe('servidor MCP', () => {
  it('lista as ferramentas', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['cancel_proposal', 'editor_status', 'get_context', 'get_proposal', 'propose_edit']);
  });

  it('a ajuda das operações ensina a dividir e a apagar trechos', async () => {
    const { tools } = await client.listTools();
    const d = tools.find((t) => t.name === 'propose_edit')!.description!;
    expect(d).toContain('"op":"splitClip"');
    expect(d).toContain('"op":"removeRanges"');
    expect(d).toMatch(/até 500/);
  });

  it('fluxo: contexto → proposta em rascunho → decisão do usuário → estado', async () => {
    const ctx = await tool('get_context');
    expect(ctx.selection[0]).toMatchObject({ id: 't1', kind: 'title' });
    const args = {
      requestId: 'abc',
      baseRevision: ctx.revision,
      title: 'Subir suavemente e desaparecer',
      steps: [
        { label: 'Entrada', ops: [{ op: 'animate', clipId: 't1', preset: 'slideUpIn', duration: 0.8 }] },
        { label: 'Saída', ops: [{ op: 'animate', clipId: 't1', preset: 'fadeOut' }] },
      ],
    };
    const p = await tool('propose_edit', args);
    expect(p.status).toBe('active');
    expect(p.current.label).toBe('Entrada');
    // Nada gravado ainda
    expect(session.project.revision).toBe(ctx.revision);

    // Repetir a chamada não duplica
    const again = await tool('propose_edit', args);
    expect(again.id).toBe(p.id);
    expect(again.reused).toBe(true);

    // O usuário aceita a entrada no editor enquanto o Claude espera
    setTimeout(() => session.acceptStep(), 50);
    const st = await tool('get_proposal', { proposalId: p.id, waitSeconds: 5, sinceVersion: p.version });
    expect(st.steps[0].status).toBe('accepted');
    expect(st.current.label).toBe('Saída');

    session.discardStep();
    const end = await tool('get_proposal', { proposalId: p.id });
    expect(end.status).toBe('done');
    expect(keyframeGroups(findClip(session.project, 't1')!).map((g) => g.group)).toEqual(['entrada']);

    // Contexto da mesma revisão é reaproveitado
    const c2 = await tool('get_context', {});
    const c3 = await tool('get_context', { knownRevision: c2.revision });
    expect(c3.unchanged).toBe(true);
  });

  it('acrescenta etapas com appendTo pelo MCP (o usuário vê cada etapa assim que fica pronta)', async () => {
    const ctx = await tool('get_context');
    const first = await tool('propose_edit', {
      requestId: 'inc-1',
      baseRevision: ctx.revision,
      title: 'Animação em partes',
      steps: [{ label: 'Pop', ops: [{ op: 'animate', clipId: 't1', preset: 'popIn', duration: 0.5 }] }],
    });
    expect(first.status).toBe('active');
    const more = await tool('propose_edit', {
      requestId: 'inc-2',
      baseRevision: ctx.revision,
      title: 'Animação em partes',
      appendTo: first.id,
      steps: [{ label: 'Some', ops: [{ op: 'animate', clipId: 't1', preset: 'popOut', duration: 0.5 }] }],
    });
    expect(more.id).toBe(first.id);
    expect(more.steps.map((s: { label: string }) => s.label)).toEqual(['Pop', 'Some']);
    session.discardStep();
    session.discardStep();
    const end = await tool('get_proposal', { proposalId: first.id });
    expect(end.status).toBe('done');
  });

  it('o Claude para de esperar (botão parar): o editor desiste na hora e a nota fica para a próxima chamada', async () => {
    const ctx = await tool('get_context');
    const p = await tool('propose_edit', {
      requestId: 'parar-1',
      baseRevision: ctx.revision,
      title: 'Esperar decisão',
      steps: [{ label: 'Entrada', ops: [{ op: 'animate', clipId: 't1', preset: 'fadeIn' }] }],
    });
    const ctrl = new AbortController();
    const waiting = client.callTool({ name: 'get_proposal', arguments: { proposalId: p.id, waitSeconds: 30, sinceVersion: p.version } }, undefined, { signal: ctrl.signal });
    await until(() => waitersOf(session) === 1);
    ctrl.abort();
    await expect(waiting).rejects.toThrow();
    // O cancelamento atravessa servidor MCP → ponte → editor.
    await until(() => waitersOf(session) === 0);
    session.addNote('mais devagar, por favor');
    const st = await tool('get_proposal', { proposalId: p.id });
    expect(st.userNotes).toEqual(['mais devagar, por favor']);
    session.discardStep();
  });

  it('erros de validação voltam curtos para o Claude', async () => {
    const ctx = await tool('get_context');
    const bad = await tool('propose_edit', {
      requestId: 'bad1',
      baseRevision: ctx.revision ?? session.project.revision,
      title: 'x',
      steps: [{ label: 'x', ops: [{ op: 'setKeyframe', clipId: 'nao-existe', prop: 'x', t: 0, v: 1 }] }],
    });
    expect(bad.error).toBe('invalid_ops');
  });
});
