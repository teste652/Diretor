// Teste de ponta a ponta no aplicativo Electron real (roteiro da especificação).
// Em Linux sem tela: xvfb-run -a node scripts/e2e.mjs
// Gera capturas e o MP4 exportado em .test-output/.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const electronPath = require('electron');
const FFMPEG = process.env.DIRETOR_FFMPEG ?? require('ffmpeg-static');

const out = resolve('.test-output');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const bridgeFile = join(out, 'bridge.json');
const src = join(out, 'entrada teste.mp4');
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

// MP4 curto de teste: 6 s, 1280x720, com áudio.
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]);

const app = await _electron.launch({
  executablePath: electronPath,
  args: ['dist/main/main.cjs', '--no-sandbox', '--disable-gpu'],
  env: { ...process.env, DIRETOR_BRIDGE_FILE: bridgeFile },
});
const page = await app.firstWindow();
await page.setViewportSize({ width: 1480, height: 920 }).catch(() => undefined);
await page.waitForFunction(() => !!window.__diretor);
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });

// 1. Importar e aparar
await ev((p) => window.__diretor.importPaths([p]), src);
await page.waitForFunction(() => window.__diretor.session.project.clips.length === 1);
const vid = await ev(() => window.__diretor.session.project.clips[0].id);
await ev((id) => window.__diretor.session.dispatch([{ op: 'updateClip', clipId: id, set: { in: 1, duration: 4 } }]), vid);
check('importa e apara o MP4', await ev(() => { const c = window.__diretor.session.project.clips[0]; return c.in === 1 && c.duration === 4; }));

// Legenda manual e título
await ev(() => window.__diretor.playback.seek(0.5));
await page.click('[data-testid=add-caption]');
await ev(() => {
  const s = window.__diretor.session;
  const cap = s.project.clips.find((c) => c.kind === 'caption');
  s.dispatch([{ op: 'updateClip', clipId: cap.id, set: { text: 'A cidade ganha vida à noite.', start: 0.5, duration: 3 } }]);
  s.dispatch([{ op: 'addClip', clip: { kind: 'title', id: 'ttl_e2e', text: 'EM MOVIMENTO', start: 0, duration: 4 } }]);
  s.setSelection({ clipIds: ['ttl_e2e'] });
});
check('legenda manual e título', await ev(() => window.__diretor.session.project.clips.length === 3));

// 2. Claude Desktop (simulado por um cliente MCP real) propõe a animação
const client = new Client({ name: 'e2e', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/mcp/server.cjs'], env: { ...process.env, DIRETOR_BRIDGE_FILE: bridgeFile } }));
const tool = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
const ctx = await tool('get_context');
check('Claude lê a seleção (modo econômico)', ctx.selection?.[0]?.id === 'ttl_e2e', `${JSON.stringify(ctx).length} bytes`);
const proposal = {
  requestId: 'e2e-1',
  baseRevision: ctx.revision,
  title: 'Título sobe suavemente e desaparece no fim',
  summary: 'Entrada subindo com suavização e saída em fade.',
  steps: [
    { label: 'Entrada', ops: [{ op: 'animate', clipId: 'ttl_e2e', preset: 'slideUpIn', duration: 0.8 }] },
    { label: 'Saída', ops: [{ op: 'animate', clipId: 'ttl_e2e', preset: 'fadeOut', duration: 0.6 }] },
  ],
};
const p1 = await tool('propose_edit', proposal);
await ev(() => window.__diretor.playback.seek(0.3));
await page.waitForTimeout(400);
await shot('1-rascunho-entrada');
check('entrada aparece em rascunho sem gravar', p1.status === 'active' && (await ev((r) => window.__diretor.session.project.revision === r, ctx.revision)));

// Ajuste manual da duração no rascunho (como no campo "Duração" do grupo Entrada)
const routed = await ev(() => window.__diretor.session.dispatch([{ op: 'retimeGroup', clipId: 'ttl_e2e', group: 'entrada', start: 0, duration: 1.2 }]));
check('ajuste manual vai para o rascunho', routed.target === 'draft');
await page.click('[data-testid=accept]');
check('aceitar grava a entrada', await ev(() => window.__diretor.session.past.at(-1).label === 'Claude: Entrada'));
await ev(() => window.__diretor.playback.seek(3.6));
await page.waitForTimeout(400);
await shot('2-rascunho-saida');
await page.click('[data-testid=discard]');
const groups = await ev(() => {
  const c = window.__diretor.session.project.clips.find((x) => x.id === 'ttl_e2e');
  return [...new Set(Object.values(c.props).flatMap((p) => p.keyframes.map((k) => k.group)))];
});
check('descartar a saída mantém a entrada aprovada', JSON.stringify(groups) === '["entrada"]', JSON.stringify(groups));
const st = await tool('get_proposal', { proposalId: p1.id });
check('Claude vê a decisão (aceita, ajustada, descartada)', st.steps[0].status === 'accepted' && st.steps[0].adjustedByUser && st.steps[1].status === 'discarded');

// Chamada repetida e proposta desatualizada
const again = await tool('propose_edit', proposal);
check('chamada repetida devolve o estado existente', again.id === p1.id && again.reused === true);
const ctx2 = await tool('get_context');
const p2 = await tool('propose_edit', { requestId: 'e2e-2', baseRevision: ctx2.revision, title: 'Zoom lento', steps: [{ label: 'Zoom', ops: [{ op: 'animate', clipId: vid, preset: 'slowZoom' }] }] });
await ev(() => {
  const s = window.__diretor.session;
  const cap = s.project.clips.find((c) => c.kind === 'caption');
  s.dispatch([{ op: 'updateClip', clipId: cap.id, set: { preset: 'destaque' } }]);
});
await page.waitForTimeout(200);
await shot('3-desatualizado');
const p2s = await tool('get_proposal', { proposalId: p2.id });
check('edição manual deixa a proposta desatualizada', p2s.status === 'stale');
await ev(() => window.__diretor.session.requestRedo());
const p2r = await tool('get_proposal', { proposalId: p2.id });
check('"Refazer" devolve contexto atual ao Claude', p2r.redoRequested === true && p2r.context?.revision > ctx2.revision);
await ev(() => window.__diretor.session.discardStep());

// 3. Desfazer/refazer a etapa aprovada
const undoOk = await ev(() => {
  const s = window.__diretor.session;
  s.undo(); // estilo da legenda
  s.undo(); // entrada aprovada
  const c = s.project.clips.find((x) => x.id === 'ttl_e2e');
  const none = Object.values(c.props).every((p) => p.keyframes.length === 0);
  s.redo();
  s.redo();
  const c2 = s.project.clips.find((x) => x.id === 'ttl_e2e');
  return none && Object.values(c2.props).some((p) => p.keyframes.length > 0);
});
check('desfaz e refaz a entrada separadamente', undoOk);

// Salvar e reabrir
const projFile = join(out, 'projeto.diretor.json');
await ev((p) => window.__diretor.saveProject(false, p), projFile);
const before = await ev(() => JSON.stringify(window.__diretor.session.project));
await ev((p) => window.__diretor.openProject(p), projFile);
const after = await ev(() => JSON.stringify(window.__diretor.session.project));
check('salva e reabre igual', before === after);

// Exportar
const mp4 = join(out, 'exportado.mp4');
const t0 = Date.now();
const exp = await ev((p) => window.__diretor.exportProject(window.__diretor.session.project, { outPath: p }), mp4);
check('exporta MP4', exp.ok, exp.error ?? `${((Date.now() - t0) / 1000).toFixed(1)}s`);
const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', mp4], { encoding: 'utf8' }).stderr;
const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(probe);
const seconds = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
check('duração do MP4 = linha do tempo (4 s)', Math.abs(seconds - 4) < 0.1, `${seconds}s`);
check('MP4 tem áudio', /Audio:/.test(probe));

// Prévia x exportação: início, meio e fim da animação de entrada + saída
for (const t of [0.1, 0.6, 1.2, 2.0, 3.9]) {
  const f = Math.round(t * 30);
  await ev((tt) => window.__diretor.playback.seek(tt), f / 30);
  await page.waitForTimeout(500);
  const dataUrl = await ev(() => document.querySelector('[data-testid=preview-canvas]').toDataURL('image/png'));
  const prevPng = join(out, `cmp-previa-${t}.png`);
  writeFileSync(prevPng, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const expPng = join(out, `cmp-export-${t}.png`);
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', mp4, '-vf', `select=eq(n\\,${f})`, '-frames:v', '1', expPng]);
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', prevPng, '-i', expPng, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const psnr = /average:([\d.]+|inf)/.exec(r)?.[1];
  const val = psnr === 'inf' ? 99 : Number(psnr);
  check(`prévia = exportação em ${t}s (quadro ${f})`, val > 30, `PSNR ${psnr} dB`);
}

await shot('4-final');
writeFileSync(join(out, 'resultado.json'), JSON.stringify(results, null, 2));
await client.close();
await app.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram.`);
process.exit(failed.length ? 1 : 0);
