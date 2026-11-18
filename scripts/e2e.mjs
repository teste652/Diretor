// Teste de ponta a ponta no aplicativo Electron real (roteiro da especificação).
// Em Linux sem tela: xvfb-run -a node scripts/e2e.mjs
// Gera capturas e o MP4 exportado em .test-output/.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright-core');
const electronPath = require('electron');

function findFfmpeg() {
  if (process.env.DIRETOR_FFMPEG) return process.env.DIRETOR_FFMPEG;
  try {
    const p = require('ffmpeg-static');
    if (p && existsSync(p)) return p;
  } catch {
    /* ffmpeg-static é opcional */
  }
  return 'ffmpeg';
}
const FFMPEG = findFfmpeg();

// Nunca fica preso: se algo travar (no CI, por exemplo), falha com mensagem.
setTimeout(() => {
  console.error('✗ Tempo esgotado: o roteiro ficou preso por mais de 10 minutos.');
  process.exit(2);
}, 10 * 60_000).unref();

const out = resolve('.test-output');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const bridgeFile = join(out, 'bridge.json');
// Nome com espaço e acentos, como os arquivos de verdade.
const src = join(out, 'vídeo de teste ação.mp4');
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok: !!ok, extra });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const frameOf = (file, n, png) => execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', file, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', png]);
const psnr = (a, b, crop) => {
  const lavfi = crop ? `[0]crop=${crop}[a];[1]crop=${crop}[b];[a][b]psnr` : 'psnr';
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', a, '-i', b, '-lavfi', lavfi, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const v = /average:([\d.]+|inf)/.exec(r)?.[1];
  return v === 'inf' ? 99 : Number(v);
};

// MP4 curto de teste: 6 s, 1280x720, 30 fps, com áudio. O testsrc2 escreve o número do quadro no canto superior esquerdo.
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]);

const app = await _electron.launch({
  executablePath: electronPath,
  // --no-sandbox só no Linux do contêiner (roda como root); no Windows o sandbox fica ligado.
  args: ['dist/main/main.cjs', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--disable-gpu'],
  env: { ...process.env, DIRETOR_BRIDGE_FILE: bridgeFile },
});
const page = await app.firstWindow();
await page.setViewportSize({ width: 1480, height: 920 }).catch(() => undefined);
await page.waitForFunction(() => !!window.__diretor);
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
const settled = () => page.evaluate(() => window.__diretor.previewSettled());
check('ponte segura com o processo principal (preload em sandbox)', await ev(() => typeof window.diretor?.probeMedia === 'function' && typeof window.require === 'undefined'));

// 1. Importar e aparar (as mesmas operações de arrastar as bordas do clipe)
await ev((p) => window.__diretor.importPaths([p]), src);
await page.waitForFunction(() => window.__diretor.session.project.clips.length === 1);
const vid = await ev(() => window.__diretor.session.project.clips[0].id);
await ev((id) => {
  const s = window.__diretor.session;
  s.dispatch([{ op: 'trimClip', clipId: id, edge: 'start', delta: 1 }], 'Aparar início');
  const c = s.project.clips.find((x) => x.id === id);
  s.dispatch([{ op: 'trimClip', clipId: id, edge: 'end', delta: 4 - c.duration }], 'Aparar fim');
}, vid);
const imported = await ev(() => {
  const s = window.__diretor.session;
  const c = s.project.clips[0];
  return { start: c.start, in: c.in, duration: c.duration, ...s.project.settings };
});
check(
  'importa (nome com acento) e apara o MP4',
  imported.start === 0 && imported.in === 1 && imported.duration === 4 && imported.width === 1280 && imported.height === 720 && imported.fps === 30,
  JSON.stringify(imported),
);

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
await settled();
await shot('1-rascunho-entrada');
check('entrada aparece em rascunho sem gravar', p1.status === 'active' && (await ev((r) => window.__diretor.session.project.revision === r, ctx.revision)));

// Ajuste manual da duração no rascunho (como no campo "Duração" do grupo Entrada)
const routed = await ev(() => window.__diretor.session.dispatch([{ op: 'retimeGroup', clipId: 'ttl_e2e', group: 'entrada', start: 0, duration: 1.2 }]));
check('ajuste manual vai para o rascunho', routed.target === 'draft');
// Ctrl+Z com o rascunho aberto desfaz só o ajuste manual dele, sem mexer no projeto.
const draftUndo = await ev(() => {
  const s = window.__diretor.session;
  const span = () => {
    const c = s.view.clips.find((x) => x.id === 'ttl_e2e');
    const ts = Object.values(c.props).flatMap((p) => p.keyframes.filter((k) => k.group === 'entrada').map((k) => k.t));
    return Math.round((Math.max(...ts) - Math.min(...ts)) * 1000) / 1000;
  };
  const rev = s.project.revision;
  const pastLen = s.past.length;
  const a = span();
  s.undo();
  const b = span();
  const intact = !!s.activeStep && s.project.revision === rev && s.past.length === pastLen;
  s.redo();
  return { a, b, c: span(), intact };
});
check('Ctrl+Z no rascunho desfaz só o ajuste manual', draftUndo.a === 1.2 && draftUndo.b === 0.8 && draftUndo.c === 1.2 && draftUndo.intact, JSON.stringify(draftUndo));
await page.click('[data-testid=accept]');
check('aceitar grava a entrada', await ev(() => window.__diretor.session.past.at(-1).label === 'Claude: Entrada'));
await ev(() => window.__diretor.playback.seek(3.6));
await settled();
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
const conflict = await tool('propose_edit', { ...proposal, title: 'Outra coisa com o mesmo requestId' });
check('mesmo requestId com outro conteúdo é recusado', conflict.error === 'request_id_conflict', conflict.error);
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

// Salvar e reabrir (a revisão só cresce, para o Claude nunca confundir projetos)
const projFile = join(out, 'projeto.diretor.json');
const savedPath = await ev((p) => window.__diretor.saveProject(false, p), projFile);
const snap = () =>
  ev(() => {
    const s = window.__diretor.session;
    // Mesmos valores; a ordem das chaves no arquivo não importa.
    const sorted = (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v);
    return { rev: s.project.revision, json: JSON.stringify({ ...s.project, revision: 0 }, sorted), dirty: s.dirty };
  });
const before = await snap();
const reopened = await ev((p) => window.__diretor.openProject(p), projFile);
const after = await snap();
check('salva e reabre igual', !!savedPath && reopened && !before.dirty && before.json === after.json && after.rev > before.rev && !after.dirty, `revisão ${before.rev} → ${after.rev}`);

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
check('MP4 marcado como BT.709', /bt709/.test(probe), /Video: .*/.exec(probe)?.[0]);

// Prévia x exportação, e as duas x quadro exato do original. O clipe começa em 1 s do
// original, então o quadro f da linha do tempo deve mostrar o quadro 30 + f do arquivo.
// Inclui quadros que não são múltiplos de 3 (onde 1/30 não é exato em ponto flutuante).
const COUNTER = '100:34:2:2'; // número do quadro escrito pelo testsrc2
for (const f of [2, 3, 5, 8, 18, 36, 44, 60, 101, 117]) {
  await ev((tt) => window.__diretor.playback.seek(tt), f / 30);
  await settled();
  const dataUrl = await ev(() => document.querySelector('[data-testid=preview-canvas]').toDataURL('image/png'));
  const prevPng = join(out, `cmp-previa-q${f}.png`);
  writeFileSync(prevPng, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const expPng = join(out, `cmp-export-q${f}.png`);
  frameOf(mp4, f, expPng);
  const full = psnr(prevPng, expPng);
  const srcPng = (n) => {
    const png = join(out, `original-q${n}.png`);
    if (!existsSync(png)) frameOf(src, n, png);
    return png;
  };
  const n = 30 + f;
  const ex = [n - 1, n, n + 1].map((k) => psnr(expPng, srcPng(k), COUNTER));
  const pv = [n - 1, n, n + 1].map((k) => psnr(prevPng, srcPng(k), COUNTER));
  const best = (v) => v[1] > v[0] + 3 && v[1] > v[2] + 3;
  check(`quadro ${f}: prévia = exportação = quadro ${n} do original`, full > 30 && best(ex) && best(pv), `PSNR ${full.toFixed(1)} dB; contador exp ${ex.map((v) => v.toFixed(0)).join('/')} prévia ${pv.map((v) => v.toFixed(0)).join('/')}`);
}

await shot('4-final');

// Vídeo que sumiu do disco: a exportação recusa na hora, com o nome do arquivo, sem criar MP4.
const missingOut = join(out, 'nao-deve-existir.mp4');
const t1 = Date.now();
const bad = await ev((p) => {
  const d = window.__diretor;
  const pr = structuredClone(d.session.project);
  pr.media[0].path += '.sumiu.mp4';
  return d.exportProject(pr, { outPath: p });
}, missingOut);
check('vídeo ausente: exportação falha rápido e explica', !bad.ok && /Não consegui abrir/.test(bad.error ?? '') && !existsSync(missingOut), `${((Date.now() - t1) / 1000).toFixed(1)}s`);

// Cancelar no meio: para logo e apaga o MP4 pela metade.
const cancelOut = join(out, 'cancelado.mp4');
const cancelled = await ev(
  (p) =>
    new Promise((done) => {
      const d = window.__diretor;
      let frames = 0;
      d.exportProject(d.session.project, {
        outPath: p,
        onProgress: (x) => {
          frames = x.frame;
          if (x.frame === 10) void d.cancelExport();
        },
      }).then((r) => done({ ...r, frames }));
    }),
  cancelOut,
);
check('cancelar a exportação para e apaga o arquivo pela metade', cancelled.cancelled === true && cancelled.frames <= 12 && !existsSync(cancelOut), JSON.stringify(cancelled));

writeFileSync(join(out, 'resultado.json'), JSON.stringify(results, null, 2));
await client.close();
// O projeto está salvo; garante que o aviso de "mudanças não salvas" não segure o fechamento.
await ev(() => {
  window.__diretor.session.dirty = false;
});
await app.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram.`);
process.exit(failed.length ? 1 : 0);
