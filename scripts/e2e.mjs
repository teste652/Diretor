// Teste de ponta a ponta no aplicativo Electron real (roteiro da especificação).
// Em Linux sem tela: xvfb-run -a node scripts/e2e.mjs
// Gera capturas e o MP4 exportado em .test-output/.
// Com DIRETOR_APP=<caminho do Diretor.exe instalado>, testa o app instalado pelo
// instalador (ffmpeg e servidor do Claude que vêm dentro dele) em vez da cópia de desenvolvimento.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';

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
// Uma execução interrompida pode ter deixado um arquivo imutável (veja holdFile): solta antes de limpar.
if (process.platform === 'linux' && existsSync(out)) spawnSync('chattr', ['-R', '-i', out], { stdio: 'ignore' });
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const bridgeFile = join(out, 'bridge.json');
// Nome com espaço e acentos, como os arquivos de verdade.
const src = join(out, 'vídeo de teste ação.mp4');
const results = [];
const skipped = [];
const skip = (name, why) => {
  skipped.push(name);
  console.log(`– ${name} — pulada: ${why}`);
};
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

// O app instalado (teste do instalador) ou a cópia de desenvolvimento.
const installed = process.env.DIRETOR_APP ? resolve(process.env.DIRETOR_APP) : null;
if (installed && !existsSync(installed)) {
  console.error(`✗ DIRETOR_APP aponta para um arquivo que não existe: ${installed}`);
  process.exit(2);
}

// Um perfil de usuário de mentira, com um Claude Desktop já usado: o botão "Conectar" grava nele.
// A configuração tem outro servidor e preferências (com BOM e CRLF, como o Bloco de Notas grava).
// No Windows, como o Claude Desktop 4 deixa: os dados em %LOCALAPPDATA%\Claude-Data\claude_<editor>,
// e as pastas antigas (pacote MSIX e %APPDATA%\Claude) só com a marca de mudança e uma
// configuração velha, que o Claude não lê mais e que têm de ficar intactas.
const profile = join(out, 'perfil');
const profileEnv =
  process.platform === 'win32'
    ? { APPDATA: join(profile, 'Roaming'), LOCALAPPDATA: join(profile, 'Local') }
    : process.platform === 'darwin'
      ? {}
      : { XDG_CONFIG_HOME: join(profile, 'config') };
const claudeDirs =
  process.platform === 'win32'
    ? [join(profile, 'Local', 'Claude-Data', 'claude_pzs8sxrjxfjjc')]
    : process.platform === 'darwin'
      ? []
      : [join(profile, 'config', 'Claude')];
const claudeLeft =
  process.platform === 'win32' ? [join(profile, 'Local', 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude'), join(profile, 'Roaming', 'Claude')] : [];
const claudeBefore = '\uFEFF{\r\n  "preferences": { "e2e": true },\r\n  "mcpServers": { "outro": { "command": "outro.exe", "args": [] } }\r\n}\r\n';
const claudeStale = '{"mcpServers":{}}';
for (const d of claudeDirs) mkdirSync(d, { recursive: true });
if (claudeDirs[0]) writeFileSync(join(claudeDirs[0], 'claude_desktop_config.json'), claudeBefore);
for (const d of claudeLeft) {
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '.user-data-left.claude_pzs8sxrjxfjjc'), '');
  writeFileSync(join(d, 'claude_desktop_config.json'), claudeStale);
}

// Perfil próprio do Electron: não esbarra num Diretor de verdade aberto na mesma máquina.
const appEnv = { ...process.env, ...profileEnv, DIRETOR_BRIDGE_FILE: bridgeFile, DIRETOR_USER_DATA: join(out, 'perfil-electron') };
if (installed) delete appEnv.DIRETOR_FFMPEG; // o app instalado tem de usar o ffmpeg que vem com ele
const app = await _electron.launch({
  executablePath: installed ?? electronPath,
  // --no-sandbox só no Linux do contêiner (roda como root); no Windows o sandbox fica ligado.
  args: [...(installed ? [] : ['dist/main/main.cjs']), ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--disable-gpu'],
  env: appEnv,
});
const page = await app.firstWindow();
await page.setViewportSize({ width: 1480, height: 920 }).catch(() => undefined);
await page.waitForFunction(() => !!window.__diretor);
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
const settled = () => page.evaluate(() => window.__diretor.previewSettled());
check('ponte segura com o processo principal (preload em sandbox)', await ev(() => typeof window.diretor?.probeMedia === 'function' && typeof window.require === 'undefined'));

const info = await ev(() => window.diretor.appInfo());
// No Windows, maiúsculas e minúsculas no caminho não importam.
const samePath = (a, b) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));
if (installed) {
  const unpacked = (p) => /[\\/]app\.asar\.unpacked[\\/]/.test(p) && existsSync(p);
  check(
    'app instalado: ffmpeg e servidor do Claude vêm dentro dele (fora do app.asar)',
    info.packaged && unpacked(info.ffmpeg) && unpacked(info.mcp.args[0]) && samePath(info.mcp.command, installed),
    JSON.stringify({ ffmpeg: info.ffmpeg, mcp: info.mcp }),
  );
  const shown = await page.textContent('[data-testid=app-version]').catch(() => null);
  check('app instalado: mostra a versão ao lado do nome', shown === info.version && /^\d+\.\d+\.\d+/.test(shown), String(shown));
}

// Conectar ao Claude Desktop pelo botão do painel do Claude.
let claudeEntry = { command: process.execPath, args: ['dist/mcp/server.cjs'] };
if (claudeDirs.length) {
  await page.waitForSelector('[data-testid=claude-connect]');
  const steps = (await page.textContent('[data-testid=claude-setup]')) ?? '';
  await shot('0-claude-passos');
  await page.click('[data-testid=claude-connect]');
  await page.waitForFunction(() => /Pronto/.test(document.querySelector('[data-testid=claude-setup-msg]')?.textContent ?? ''), null, { timeout: 10_000 });
  await shot('0-claude-conectado');
  const cfgs = claudeDirs.map((d) => JSON.parse(readFileSync(join(d, 'claude_desktop_config.json'), 'utf8')));
  const entry = cfgs[0].mcpServers?.diretor;
  const backup = readFileSync(join(claudeDirs[0], 'claude_desktop_config.antes-do-diretor.json'), 'utf8');
  check(
    'botão Conectar grava o Diretor na configuração do Claude Desktop sem estragar o resto',
    entry?.command === info.mcp.command &&
      entry?.env?.ELECTRON_RUN_AS_NODE === '1' &&
      existsSync(entry?.args?.[0] ?? '') &&
      cfgs.every((c) => JSON.stringify(c.mcpServers.diretor) === JSON.stringify(entry)) &&
      cfgs[0].preferences?.e2e === true &&
      cfgs[0].mcpServers.outro?.command === 'outro.exe' &&
      backup === claudeBefore &&
      claudeLeft.every((d) => readFileSync(join(d, 'claude_desktop_config.json'), 'utf8') === claudeStale && readdirSync(d).length === 2) &&
      /Feche o Claude Desktop por completo/.test(steps),
    `${claudeDirs.length} pasta(s) do Claude Desktop, ${claudeLeft.length} abandonada(s) intacta(s): ${JSON.stringify(entry)}`,
  );
  claudeEntry = entry;
} else skip('botão Conectar grava a configuração do Claude Desktop', 'sem pasta do Claude Desktop simulada neste sistema');

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

// 2. Claude Desktop (simulado por um cliente MCP real) propõe a animação. Ele inicia o servidor
// exatamente como o botão Conectar gravou (o executável do Diretor rodando como Node).
const client = new Client({ name: 'e2e', version: '1' });
await client.connect(new StdioClientTransport({ command: claudeEntry.command, args: claudeEntry.args, env: { ...process.env, ...claudeEntry.env, DIRETOR_BRIDGE_FILE: bridgeFile } }));
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

// O Claude desiste de esperar (botão parar no Claude Desktop): o editor para na hora e a nota do usuário fica para a próxima chamada.
const ctx3 = await tool('get_context');
const p3 = await tool('propose_edit', { requestId: 'e2e-3', baseRevision: ctx3.revision, title: 'Esperar decisão', steps: [{ label: 'Entrada', ops: [{ op: 'animate', clipId: 'ttl_e2e', preset: 'fadeIn' }] }] });
const waiters = () => ev(() => window.__diretor.session.waiters.length);
const until = async (cond) => {
  for (let i = 0; i < 100; i++) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};
const stopper = new AbortController();
const waiting = client.callTool({ name: 'get_proposal', arguments: { proposalId: p3.id, waitSeconds: 30, sinceVersion: p3.version } }, undefined, { signal: stopper.signal }).catch(() => 'cancelado');
const started = await until(async () => (await waiters()) === 1);
stopper.abort();
const stoppedInEditor = await until(async () => (await waiters()) === 0);
await ev(() => window.__diretor.session.addNote('mais devagar, por favor'));
const p3s = await tool('get_proposal', { proposalId: p3.id });
check(
  'Claude para de esperar: o editor desiste na hora e a nota chega na próxima chamada',
  started && stoppedInEditor && (await waiting) === 'cancelado' && JSON.stringify(p3s.userNotes) === '["mais devagar, por favor"]',
  JSON.stringify({ started, stoppedInEditor, notes: p3s.userNotes }),
);
await tool('cancel_proposal', { proposalId: p3.id });

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
check(
  'vídeo ausente: exportação falha rápido e diz que o arquivo sumiu',
  !bad.ok && /Não consegui abrir/.test(bad.error ?? '') && /não encontrado/.test(bad.error ?? '') && !existsSync(missingOut),
  `${((Date.now() - t1) / 1000).toFixed(1)}s`,
);

// Temporários da exportação (o destino só é trocado quando o MP4 fica pronto).
const leftovers = () => readdirSync(out).filter((f) => f.includes('.diretor-'));
const contents = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null);
// ffmpeg ainda rodando (preso esperando quadros depois de cancelar, por exemplo).
const ffmpegRunning = () => {
  if (process.platform === 'win32') {
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq ffmpeg.exe', '/NH', '/FO', 'CSV'], { encoding: 'utf8' });
    return (r.stdout || '').split('\n').filter((l) => /ffmpeg\.exe/i.test(l)).length;
  }
  const r = spawnSync('pgrep', ['-x', 'ffmpeg'], { encoding: 'utf8' });
  return (r.stdout || '').split('\n').filter(Boolean).length;
};

// Cancelar no meio: para logo, não deixa MP4 pela metade e não mexe no arquivo que já existia no destino.
const cancelOut = join(out, 'cancelado.mp4');
writeFileSync(cancelOut, 'exportação anterior');
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
check(
  'cancelar a exportação para na hora e mantém o arquivo que já existia',
  cancelled.cancelled === true && cancelled.frames <= 12 && contents(cancelOut) === 'exportação anterior' && leftovers().length === 0,
  JSON.stringify(cancelled),
);

// Cancelar enquanto os vídeos são conferidos: não abre a janela de salvar nem grava nada.
const preOut = join(out, 'cancelado-antes.mp4');
writeFileSync(preOut, 'não mexer');
const pre = await ev((p) => {
  const d = window.__diretor;
  const r = d.exportProject(d.session.project, { outPath: p });
  void d.cancelExport();
  return r;
}, preOut);
check('cancelar durante a conferência dos vídeos não grava nada', pre.cancelled === true && contents(preOut) === 'não mexer' && leftovers().length === 0, JSON.stringify(pre));

// Cancelar no último quadro, com o ffmpeg ainda finalizando: é cancelamento, não "falha".
const lastOut = join(out, 'cancelado-no-fim.mp4');
const last = await ev(
  (p) =>
    new Promise((done) => {
      const d = window.__diretor;
      d.exportProject(d.session.project, {
        outPath: p,
        onProgress: (x) => {
          if (x.frame === x.total) void d.cancelExport();
        },
      }).then(done);
    }),
  lastOut,
);
check('cancelar no último quadro não vira "falha na exportação"', last.cancelled === true && !last.error && !existsSync(lastOut) && leftovers().length === 0, JSON.stringify(last));
const stillRunning = ffmpegRunning();
check('depois de cancelar, nenhum ffmpeg fica rodando', stillRunning === 0, `${stillRunning} processo(s)`);

// Nome longo com acentos: o temporário não pode repetir o nome escolhido. O limite é de 255
// bytes por nome no Linux e de 255 unidades UTF-16 no Windows; o nome fica perto do limite
// do sistema, de modo que um temporário que o repetisse passaria dele.
const nameSize = (n) => (process.platform === 'win32' ? n.length : Buffer.byteLength(n));
let longName = '';
while (nameSize(`${longName}ação.mp4`) <= 241) longName += 'ação ';
longName = `${longName.trim()}.mp4`;
const longOut = join(out, longName);
const longExp = await ev((p) => window.__diretor.exportProject(window.__diretor.session.project, { outPath: p }), longOut);
check(
  'exporta com nome longo e acentuado',
  longExp.ok && existsSync(longOut) && leftovers().length === 0,
  `${longName.length} caracteres, ${Buffer.byteLength(longName)} bytes${longExp.error ? `; ${longExp.error.slice(0, 200)}` : ''}`,
);
rmSync(longOut, { force: true }); // caminho longo demais para guardar no artefato do CI

/**
 * Prende um arquivo como um player faz no Windows: trocá-lo é recusado (EPERM) até soltar.
 * No Windows, outro processo o abre sem permitir apagar; no Linux como root, o arquivo fica
 * imutável (chattr +i), que recusa a troca com o mesmo erro. Devolve a função que solta,
 * ou null se este sistema não tem como prender um arquivo.
 */
async function holdFile(path) {
  if (process.platform === 'win32') {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', "$f = [System.IO.File]::Open($env:LOCK_PATH, 'Open', 'Read', 'Read'); [Console]::Out.WriteLine('preso'); [Console]::Out.Flush(); Start-Sleep -Seconds 300"],
      { env: { ...process.env, LOCK_PATH: path }, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    await new Promise((res, rej) => {
      ps.stdout.on('data', (d) => /preso/.test(String(d)) && res());
      ps.once('exit', (c) => rej(new Error(`o PowerShell que prende o arquivo saiu (${c})`)));
      setTimeout(() => rej(new Error('o PowerShell não abriu o arquivo a tempo')), 60_000);
    });
    return async () => {
      if (ps.exitCode !== null) return;
      const gone = new Promise((r) => ps.once('exit', r));
      ps.kill();
      await gone;
    };
  }
  if (process.platform === 'linux' && spawnSync('chattr', ['+i', path], { stdio: 'ignore' }).status === 0) {
    return async () => void spawnSync('chattr', ['-i', path], { stdio: 'ignore' });
  }
  return null;
}
const waitFor = async (cond, ms) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (await cond()) return true;
  return false;
};

// Destino aberto em outro programa: o editor tenta de novo por alguns segundos e depois salva
// o vídeo pronto ao lado como "nome (1).mp4", com aviso; nada se perde.
const lockedOut = join(out, 'aberto no player.mp4');
writeFileSync(lockedOut, 'vídeo aberto no player');
let release = await holdFile(lockedOut);
const asDir = !release;
if (asDir) {
  // Sem como prender um arquivo aqui: o destino vira uma pasta, que também não pode ser substituída.
  rmSync(lockedOut);
  mkdirSync(lockedOut);
  writeFileSync(join(lockedOut, 'dentro.txt'), 'vídeo aberto no player');
  release = async () => undefined;
}
const t2 = Date.now();
const locked = await ev((p) => window.__diretor.exportProject(window.__diretor.session.project, { outPath: p }), lockedOut);
const lockedSecs = ((Date.now() - t2) / 1000).toFixed(1);
await release();
const altOut = join(out, 'aberto no player (1).mp4');
const altDur = /Duration: (\d+):(\d+):([\d.]+)/.exec(spawnSync(FFMPEG, ['-hide_banner', '-i', altOut], { encoding: 'utf8' }).stderr);
const altSeconds = altDur ? Number(altDur[1]) * 3600 + Number(altDur[2]) * 60 + Number(altDur[3]) : 0;
const untouched = contents(asDir ? join(lockedOut, 'dentro.txt') : lockedOut) === 'vídeo aberto no player';
check(
  'destino aberto em outro programa: o vídeo pronto é salvo ao lado, com aviso, e nada se perde',
  locked.ok && basename(locked.outPath ?? '') === basename(altOut) && /aberto em outro programa/.test(locked.warning ?? '') && Math.abs(altSeconds - seconds) < 0.1 && untouched && leftovers().length === 0,
  `${lockedSecs}s${asDir ? ' (destino como pasta)' : ''}; ${JSON.stringify({ outPath: locked.outPath && basename(locked.outPath), warning: locked.warning, error: locked.error, altSeconds })}`,
);

// Cancelar enquanto o editor espera o destino preso soltar (o ffmpeg já terminou): o arquivo
// antigo fica intacto, nada é gravado ao lado e não sobra temporário.
const heldOut = join(out, 'preso ao cancelar.mp4');
writeFileSync(heldOut, 'não mexer');
const releaseHeld = await holdFile(heldOut);
if (!releaseHeld) {
  skip('cancelar enquanto o destino está preso', 'sem como prender um arquivo neste sistema');
} else {
  await ev((p) => {
    const d = window.__diretor;
    window.__held = { frame: 0, total: 1, result: null };
    void d.exportProject(d.session.project, { outPath: p, onProgress: (x) => Object.assign(window.__held, x) }).then((r) => (window.__held.result = r));
  }, heldOut);
  const allFrames = await waitFor(() => ev(() => window.__held.frame === window.__held.total), 180_000);
  const ffmpegDone = allFrames && (await waitFor(() => ffmpegRunning() === 0, 30_000));
  const t3 = Date.now();
  await ev(() => window.__diretor.cancelExport());
  await waitFor(() => ev(() => !!window.__held.result), 15_000);
  const cancelSecs = (Date.now() - t3) / 1000;
  const held = await ev(() => window.__held.result);
  await releaseHeld();
  check(
    'cancelar enquanto o destino está preso não mexe no arquivo nem grava nada ao lado',
    allFrames && ffmpegDone && held?.cancelled === true && contents(heldOut) === 'não mexer' && !existsSync(join(out, 'preso ao cancelar (1).mp4')) && leftovers().length === 0 && cancelSecs < 2.5,
    `${cancelSecs.toFixed(1)}s depois de cancelar; ${JSON.stringify(held)}`,
  );
}

// 4. Interface: campo numérico, arrasto da borda do vídeo, lixeira e painel do modo econômico.
// Digitar o fim de uma legenda e clicar em outra antes do Enter: o número vai para a legenda certa, sem os limites da outra.
const capA = await ev(() => window.__diretor.session.project.clips.find((c) => c.kind === 'caption').id);
await ev((id) => {
  const s = window.__diretor.session;
  s.dispatch([{ op: 'addClip', clip: { kind: 'caption', id: 'cap_b', text: 'Segunda legenda', start: 3.6, duration: 2 } }]);
  s.setSelection({ clipIds: [id] });
}, capA);
const endField = page.locator('.field', { hasText: 'Fim (s)' }).locator('input');
await endField.click();
await endField.fill('2');
await page.click('[data-clip="cap_b"]');
await page.waitForTimeout(100);
const capEnd = await ev((id) => {
  const c = window.__diretor.session.project.clips.find((x) => x.id === id);
  return Math.round((c.start + c.duration) * 1000) / 1000;
}, capA);
check('campo numérico: clicar em outro clipe grava o valor digitado no clipe certo', capEnd === 2, `fim da legenda: ${capEnd}`);

// Arrastar a borda esquerda do vídeo: durante o arrasto ele já aparece como vai ficar (no lugar, mais curto).
const block = page.locator(`[data-clip="${vid}"]`);
const b0 = await block.boundingBox();
const vidDur = await ev((id) => window.__diretor.session.project.clips.find((x) => x.id === id).duration, vid);
const pxPerSec = b0.width / vidDur;
const hb = await page.locator(`[data-clip="${vid}"] .handle.l`).boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await page.mouse.down();
await page.mouse.move(hb.x + hb.width / 2 + pxPerSec, hb.y + hb.height / 2, { steps: 6 });
const bDrag = await block.boundingBox();
await page.mouse.up();
await page.waitForTimeout(100);
const trimmed = await ev((id) => {
  const c = window.__diretor.session.project.clips.find((x) => x.id === id);
  return { start: c.start, in: c.in, duration: c.duration };
}, vid);
check(
  'arrastar a borda esquerda do vídeo mostra o resultado certo durante o arrasto',
  Math.abs(bDrag.x - b0.x) < 3 && Math.abs(bDrag.width - (b0.width - pxPerSec)) < 4 && trimmed.start === 0 && trimmed.in === 2 && trimmed.duration === vidDur - 1,
  JSON.stringify({ antes: Math.round(b0.x), durante: Math.round(bDrag.x), ...trimmed }),
);
await ev(() => window.__diretor.session.undo());

// Lixeira com um ponto de animação selecionado: remove o ponto, não o clipe.
const kfBefore = await ev(() => {
  const s = window.__diretor.session;
  const c = s.project.clips.find((x) => x.id === 'ttl_e2e');
  const [prop, ap] = Object.entries(c.props).find(([, p]) => p.keyframes.length);
  const k = ap.keyframes[ap.keyframes.length - 1];
  s.setSelection({ clipIds: [c.id], keyframe: { clipId: c.id, prop, keyframeId: k.id } });
  return Object.values(c.props).reduce((n, p) => n + p.keyframes.length, 0);
});
await page.click('[data-testid=trash]');
const kfAfter = await ev(() => {
  const c = window.__diretor.session.project.clips.find((x) => x.id === 'ttl_e2e');
  return c ? Object.values(c.props).reduce((n, p) => n + p.keyframes.length, 0) : -1;
});
check('lixeira com ponto selecionado remove só o ponto', kfAfter >= 0 && kfAfter < kfBefore, `pontos: ${kfBefore} → ${kfAfter}`);
await ev(() => window.__diretor.session.undo());

// Painel do modo econômico: abre à vista, fora da área que rola.
await page.click('[data-testid=eco-toggle]');
const eco = await ev(() => {
  const el = document.querySelector('.eco-pop');
  if (!el) return { exists: false };
  const r = el.getBoundingClientRect();
  return { exists: true, inScroll: !!el.closest('.assist-scroll'), visible: r.top >= 0 && r.bottom <= window.innerHeight && r.height > 40 };
});
await shot('5-modo-economico');
check('painel do modo econômico abre à vista', eco.exists && !eco.inScroll && eco.visible, JSON.stringify(eco));
await page.click('[data-testid=eco-toggle]');

writeFileSync(join(out, 'resultado.json'), JSON.stringify(results, null, 2));
await client.close();
// O projeto está salvo; garante que o aviso de "mudanças não salvas" não segure o fechamento.
await ev(() => {
  window.__diretor.session.dirty = false;
});

// Por último: a interface cai no meio de uma exportação. O ffmpeg para e não sobra arquivo.
const crashOut = join(out, 'interrompido.mp4');
await ev((p) => {
  const d = window.__diretor;
  window.__expFrames = 0;
  void d.exportProject(d.session.project, { outPath: p, onProgress: (x) => (window.__expFrames = x.frame) });
}, crashOut);
await page.waitForFunction(() => window.__expFrames >= 5);
const tmpDuring = leftovers().length;
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
const cleaned = await until(async () => leftovers().length === 0 && ffmpegRunning() === 0);
check('a interface cai no meio da exportação: o ffmpeg para e não sobra arquivo', tmpDuring === 1 && cleaned && !existsSync(crashOut), `temporário durante a exportação: ${tmpDuring}`);
writeFileSync(join(out, 'resultado.json'), JSON.stringify(results, null, 2));

await app.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram.${skipped.length ? ` ${skipped.length} pulada(s) neste sistema: ${skipped.join('; ')}.` : ''}`);
process.exit(failed.length ? 1 : 0);
