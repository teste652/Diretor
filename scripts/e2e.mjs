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
// Sem CLAUDE_USER_DATA_DIR: ele mandaria o Conectar gravar na pasta de um Claude Desktop de verdade.
const appEnv = Object.fromEntries(Object.entries({ ...process.env, ...profileEnv }).filter(([k]) => k.toUpperCase() !== 'CLAUDE_USER_DATA_DIR'));
// O chat do painel usa um Claude Code e um Codex de mentira (scripts/ia-simulada.mjs), sem conta nem internet.
const iaLog = join(out, 'ia-simulada.jsonl');
const iaFake = resolve('scripts', 'ia-simulada.mjs');
Object.assign(appEnv, { DIRETOR_BRIDGE_FILE: bridgeFile, DIRETOR_USER_DATA: join(out, 'perfil-electron'), DIRETOR_CLAUDE_CLI: iaFake, DIRETOR_CODEX_CLI: iaFake, DIRETOR_IA_LOG: iaLog });
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
  // O Claude Desktop agora é a alternativa: o cartão abre pelo botão no fim do painel.
  await page.click('[data-testid=desktop-toggle]');
  await page.waitForSelector('[data-testid=claude-connect]');
  const steps = (await page.textContent('[data-testid=claude-setup]')) ?? '';
  await shot('0-claude-passos');
  await page.click('[data-testid=claude-connect]');
  // O clique também confere se o Claude Desktop está aberto (no Windows, pelo PowerShell).
  await page.waitForFunction(() => /Pronto/.test(document.querySelector('[data-testid=claude-setup-msg]')?.textContent ?? ''), null, { timeout: 20_000 });
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
  await page.click('[data-testid=desktop-toggle]');
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
const srcPng = (n) => {
  const png = join(out, `original-q${n}.png`);
  if (!existsSync(png)) frameOf(src, n, png);
  return png;
};
// PSNR do contador contra os quadros n-1, n e n+1 do original: o do meio ganha com folga.
const best = (v) => v[1] > v[0] + 3 && v[1] > v[2] + 3;
for (const f of [2, 3, 5, 8, 18, 36, 44, 60, 101, 117]) {
  await ev((tt) => window.__diretor.playback.seek(tt), f / 30);
  await settled();
  const dataUrl = await ev(() => document.querySelector('[data-testid=preview-canvas]').toDataURL('image/png'));
  const prevPng = join(out, `cmp-previa-q${f}.png`);
  writeFileSync(prevPng, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const expPng = join(out, `cmp-export-q${f}.png`);
  frameOf(mp4, f, expPng);
  const full = psnr(prevPng, expPng);
  const n = 30 + f;
  const ex = [n - 1, n, n + 1].map((k) => psnr(expPng, srcPng(k), COUNTER));
  const pv = [n - 1, n, n + 1].map((k) => psnr(prevPng, srcPng(k), COUNTER));
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

// 4. Interface: campo numérico, arrasto da borda do vídeo, lixeira e botão do modo econômico.
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

// Modo econômico: um clique desliga e outro liga de novo, sem painel e sem números em KB no chat.
const ecoState = () => ev(() => ({ on: window.__diretor.session.settings.economy, pressed: document.querySelector('[data-testid=eco-toggle]').getAttribute('aria-pressed') }));
const eco0 = await ecoState();
await page.click('[data-testid=eco-toggle]');
const eco1 = await ecoState();
await shot('5-modo-economico');
await page.click('[data-testid=eco-toggle]');
const eco2 = await ecoState();
const kbNoChat = await ev(() => /\d\s*KB\b/i.test(document.querySelector('[data-testid=chat-panel]').innerText));
check(
  'modo econômico liga e desliga com um clique, sem números em KB no chat',
  eco0.on === true && eco0.pressed === 'true' && eco1.on === false && eco1.pressed === 'false' && eco2.on === true && !kbNoChat,
  JSON.stringify({ eco0, eco1, eco2, kbNoChat }),
);

// Chat dentro do Diretor: a mensagem vai para o Claude Code (aqui, o simulado), que usa o
// servidor do Diretor e deixa a edição como rascunho. Com imagem, e retomando a mesma conversa.
const iaCalls = () => (existsSync(iaLog) ? readFileSync(iaLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const discardOpen = async () => {
  if (await ev(() => !!window.__diretor.session.openProposal)) {
    await page.click('[data-testid=discard]');
    await page.waitForFunction(() => !window.__diretor.session.openProposal, null, { timeout: 10_000 });
  }
};
await discardOpen();
await ev(() => window.__diretor.session.setSelection({ clipIds: ['ttl_e2e'] }));
await page.waitForFunction(() => /pronto/.test(document.querySelector('[data-testid=ai-status]')?.textContent ?? ''), null, { timeout: 15_000 });
const png = join(out, 'referencia.png');
frameOf(src, 10, png);
await page.setInputFiles('.chat-composer input[type=file]', png);
await page.waitForSelector('[data-testid=ai-attachments] img');
await page.fill('[data-testid=ai-input]', 'anima o título entrando suave, igual à imagem');
await page.press('[data-testid=ai-input]', 'Enter');
await page.waitForSelector('[data-testid=ai-msg-assistant]', { timeout: 60_000 });
await page.waitForFunction(() => !document.querySelector('[data-testid=ai-thinking]'), null, { timeout: 30_000 });
await shot('6-chat-claude');
const c1 = iaCalls()[0];
const prop1 = await ev(() => window.__diretor.session.openProposal?.title ?? null);
const reply1 = await page.textContent('[data-testid=ai-msg-assistant]');
check(
  'chat: a mensagem (com imagem) vai ao Claude Code, que deixa a edição como rascunho e responde no painel',
  c1 && !c1.codex && c1.images === 1 && /entrando suave/.test(c1.text) && !c1.resume && prop1 === 'Claude: entrada suave' && /entrada suave/.test(reply1 ?? '') &&
    c1.args.includes('--strict-mcp-config') && c1.args[c1.args.indexOf('--tools') + 1] === '' && samePath(c1.server.command, info.mcp.command),
  JSON.stringify({ texto: c1?.text, imagens: c1?.images, proposta: prop1, resposta: reply1 }),
);
await discardOpen();

await page.fill('[data-testid=ai-input]', 'agora mais devagar');
await page.press('[data-testid=ai-input]', 'Enter');
await page.waitForFunction(() => document.querySelectorAll('[data-testid=ai-msg-assistant]').length === 2, null, { timeout: 60_000 });
const c2 = iaCalls()[1];
check('chat: a segunda mensagem continua a mesma conversa', c2 && /^sim-/.test(c2.resume ?? '') && c2.args.includes('--resume'), String(c2?.resume));
await discardOpen();

// Parar no meio: o programa fecha e o painel volta a aceitar mensagens.
await page.fill('[data-testid=ai-input]', 'pode demorar');
await page.press('[data-testid=ai-input]', 'Enter');
await page.waitForSelector('[data-testid=ai-stop]', { timeout: 10_000 });
await page.waitForFunction(() => /Trabalhando nisso/.test(document.querySelector('[data-testid=chat-panel]')?.textContent ?? ''), null, { timeout: 30_000 });
await page.click('[data-testid=ai-stop]');
const stopped = await page
  .waitForSelector('[data-testid=ai-send]', { timeout: 15_000 })
  .then(() => true)
  .catch(() => false);
check('chat: o botão Parar encerra a resposta', stopped);

// Sem login: o erro aparece com o botão para entrar na conta.
await page.fill('[data-testid=ai-input]', 'erro-login');
await page.press('[data-testid=ai-input]', 'Enter');
await page.waitForSelector('[data-testid=ai-msg-error] button', { timeout: 30_000 });
const loginBubbles = await ev(() => ({
  errors: document.querySelectorAll('[data-testid=ai-msg-error]').length,
  asReply: [...document.querySelectorAll('[data-testid=ai-msg-assistant]')].some((el) => /Not logged in/.test(el.textContent ?? '')),
}));
check(
  'chat: sem login, um aviso só, com "Entrar na conta" (não aparece como resposta)',
  /Entrar na conta/.test((await page.textContent('[data-testid=ai-msg-error]')) ?? '') && loginBubbles.errors === 1 && !loginBubbles.asReply,
  JSON.stringify(loginBubbles),
);

// Aba do Codex: a mesma coisa pelo `codex exec`, com o conector aprovado e sem mexer em arquivos.
await page.click('[data-testid=ai-tab-codex]');
await page.waitForFunction(() => /pronto/.test(document.querySelector('[data-testid=ai-status]')?.textContent ?? ''), null, { timeout: 15_000 });
await page.fill('[data-testid=ai-input]', 'faz uma entrada suave no título');
await page.press('[data-testid=ai-input]', 'Enter');
await page.waitForSelector('[data-testid=ai-msg-assistant]', { timeout: 60_000 });
await page.waitForFunction(() => !document.querySelector('[data-testid=ai-thinking]'), null, { timeout: 30_000 });
await shot('7-chat-codex');
const cx = iaCalls().find((c) => c.codex);
const propCx = await ev(() => window.__diretor.session.openProposal?.title ?? null);
const cfgOf = (key) => cx?.args.find((a, i) => cx.args[i - 1] === '-c' && a.startsWith(`${key}=`));
const disabled = cx?.args.filter((_, i) => cx.args[i - 1] === '--disable') ?? [];
const codexLog = await ev(() => window.__diretor.session.activity.map((a) => a.text).filter((t) => /^Codex /.test(t)));
check(
  'chat: o Codex recebe o conector do Diretor aprovado, sem terminal, e deixa a edição como rascunho',
  cx &&
    propCx === 'Codex: entrada suave' &&
    cx.args[cx.args.indexOf('--sandbox') + 1] === 'read-only' &&
    disabled.includes('shell_tool') &&
    cfgOf('approval_policy') === 'approval_policy="never"' &&
    samePath(cx.server.command, info.mcp.command) &&
    codexLog.includes('Codex enviou uma proposta'),
  JSON.stringify({ proposta: propCx, sandbox: cx?.args[cx.args.indexOf('--sandbox') + 1], desligado: disabled, atividade: codexLog }),
);
await discardOpen();
await page.click('[data-testid=ai-tab-claude]');

// ---------- Entrega 1: dividir e apagar trecho ----------
const freshProject = (name) =>
  ev((n) => {
    const s = window.__diretor.session;
    s.dirty = false;
    const p = structuredClone(s.project);
    p.clips = [];
    p.media = [];
    p.name = n;
    p.tracks = p.tracks.map((t) => ({ ...t, hidden: false, locked: false }));
    s.load(p, null);
  }, name);
const e1State = () =>
  ev(() => {
    const p = window.__diretor.session.project;
    const r = (n) => Math.round(n * 1000) / 1000;
    const of = (k) => p.clips.filter((c) => c.kind === k).sort((a, b) => a.start - b.start);
    return {
      dur: r(Math.max(...p.clips.map((c) => c.start + c.duration))),
      vids: of('video').map((c) => [r(c.start), r(c.start + c.duration), r(c.in)]),
      caps: of('caption').map((c) => [r(c.start), r(c.start + c.duration)]),
    };
  });
await freshProject('Cortes');
await ev((f) => window.__diretor.importPaths([f]), src);
await page.waitForFunction(() => window.__diretor.session.project.clips.length === 1);
// Ctrl+B com a agulha colada na borda não divide, só explica; em 2 s, divide o vídeo.
await ev(() => document.activeElement?.blur());
await ev(() => window.__diretor.playback.seek(0.01));
await page.keyboard.press('Control+B');
const nearEdge = await ev(() => ({ clips: window.__diretor.session.project.clips.length, hint: document.body.innerText.includes('coloque a agulha') }));
check('Ctrl+B perto da borda não divide e mostra a dica', nearEdge.clips === 1 && nearEdge.hint, JSON.stringify(nearEdge));
await ev(() => window.__diretor.playback.seek(2));
await page.keyboard.press('Control+B');
await ev(() => window.__diretor.session.dispatch([
  { op: 'addClip', clip: { kind: 'caption', text: 'depois do corte', start: 3.6, duration: 1 } },
  { op: 'addClip', clip: { kind: 'caption', text: 'atravessa o corte', start: 2.8, duration: 0.5 } },
]));
// Marcas I em 3 s e O em 3,5 s ligam "Apagar trecho"; Shift+Delete tira o trecho de todas as faixas.
await ev(() => window.__diretor.playback.seek(3));
await page.keyboard.press('i');
await ev(() => window.__diretor.playback.seek(3.5));
await page.keyboard.press('o');
const rangeOn = await ev(() => !document.querySelector('[data-testid=delete-range]').disabled);
check('marcas I e O ligam "Apagar trecho"', rangeOn);
await page.keyboard.press('Shift+Delete');
const e1 = await e1State();
check(
  'dividir e apagar trecho: pedaços certos e legendas sincronizadas',
  JSON.stringify(e1) === JSON.stringify({ dur: 5.5, vids: [[0, 2, 0], [2, 3, 2], [3, 5.5, 3.5]], caps: [[2.8, 3], [3.1, 4.1]] }),
  JSON.stringify(e1),
);

// Prévia x exportação nas emendas: os pedaços [0,2) in 0, [2,3) in 2 e [3;5,5) in 3,5 mostram, no
// quadro f da linha do tempo, o quadro n do original.
const cortes = join(out, 'cortes.mp4');
const tE1 = Date.now();
const expE1 = await ev((p) => window.__diretor.exportProject(window.__diretor.session.project, { outPath: p }), cortes);
check('exporta o projeto com cortes', expE1.ok, expE1.error ?? `${((Date.now() - tE1) / 1000).toFixed(1)}s`);
for (const [f, n] of [[89, 89], [90, 105], [95, 110]]) {
  await ev((tt) => window.__diretor.playback.seek(tt), f / 30);
  await settled();
  const dataUrl = await ev(() => document.querySelector('[data-testid=preview-canvas]').toDataURL('image/png'));
  const prevPng = join(out, `cortes-previa-q${f}.png`);
  writeFileSync(prevPng, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const expPng = join(out, `cortes-export-q${f}.png`);
  frameOf(cortes, f, expPng);
  const full = psnr(prevPng, expPng);
  const ex = [n - 1, n, n + 1].map((k) => psnr(expPng, srcPng(k), COUNTER));
  const pv = [n - 1, n, n + 1].map((k) => psnr(prevPng, srcPng(k), COUNTER));
  check(`com cortes, quadro ${f}: prévia = exportação = quadro ${n} do original`, full > 30 && best(ex) && best(pv), `PSNR ${full.toFixed(1)} dB; contador exp ${ex.map((v) => v.toFixed(0)).join('/')} prévia ${pv.map((v) => v.toFixed(0)).join('/')}`);
}

await ev(() => window.__diretor.playback.seek(1.7));
await settled();
await ev(() => {
  window.__lum = [];
  const cv = document.querySelector('[data-testid=preview-canvas]');
  const small = Object.assign(document.createElement('canvas'), { width: 32, height: 18 });
  const g = small.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (!window.__diretor.playback.get().playing) return;
    g.drawImage(cv, 0, 0, 32, 18);
    const d = g.getImageData(0, 0, 32, 18).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    window.__lum.push([window.__diretor.playback.get().time, s / (d.length / 4)]);
    requestAnimationFrame(tick);
  };
  window.__diretor.playback.set({ playing: true });
  requestAnimationFrame(tick);
});
// Até passar das duas emendas, por no máximo 3,2 s (o dobro de 1,6 s): o CI do Windows é mais lento.
await page.waitForFunction(() => window.__diretor.playback.get().time > 3.1, null, { timeout: 3200 }).catch(() => undefined);
await ev(() => window.__diretor.playback.set({ playing: false }));
const lum = await ev(() => window.__lum);
check(
  'a reprodução passa pelas emendas (2 s e 3 s) sem quadro preto',
  lum.length > 10 && lum.some(([t]) => t > 3.05) && lum.every(([, l]) => l > 10),
  `${lum.length} quadros, luz mínima ${Math.min(...lum.map(([, l]) => l)).toFixed(0)}`,
);

// Caixa de seleção ao pular para um pedaço sem elemento: em 2,5 s, B (que continua A) fica com o
// elemento que era de A; o pulo para 1 s desenha a caixa de A antes de A ganhar um elemento.
await ev(() => window.__diretor.playback.seek(2.5));
await settled();
await ev(() => {
  const s = window.__diretor.session;
  s.setSelection({ clipIds: [s.project.clips.find((c) => c.kind === 'video' && c.start === 0).id] });
});
const selRect = () =>
  ev(() => {
    const r = document.querySelector('.sel-box')?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  });
await ev(() => window.__diretor.playback.seek(1));
await settled();
const rect1 = await selRect();
await ev(() => window.__diretor.playback.seek(1.1));
await settled();
const rect2 = await selRect(); // agora A tem o próprio elemento: a caixa vem do quadro dele
const fmtRect = (r) => (r ? `${r.x.toFixed(1)}, ${r.y.toFixed(1)}, ${r.width.toFixed(1)} × ${r.height.toFixed(1)}` : 'nenhuma');
check(
  'caixa de seleção aparece ao pular para um pedaço',
  !!rect1 && rect1.width > 0 && rect1.height > 0 && !!rect2 && ['x', 'y', 'width', 'height'].every((k) => Math.abs(rect1[k] - rect2[k]) <= 1),
  `ao pular: ${fmtRect(rect1)}; depois: ${fmtRect(rect2)}`,
);
await ev(() => window.__diretor.session.setSelection({ clipIds: [] }));

// Rascunho da IA com um corte: o chip da emenda e o Antes/Depois na prévia.
const ctxE1 = await tool('get_context');
const pE1 = await tool('propose_edit', { requestId: 'e2e-corte', baseRevision: ctxE1.revision, title: 'Tirar um trecho', steps: [{ label: 'Corte', ops: [{ op: 'removeRanges', ranges: [[1, 1.5]] }] }] });
await page.waitForSelector('.seam-chip');
const chips = await ev(() => [...document.querySelectorAll('.seam-chip')].map((e) => e.textContent.trim()));
check('rascunho com corte mostra a emenda "−0,5 s"', pE1.status === 'active' && chips.length === 1 && chips[0] === '\u22120,5 s', JSON.stringify(chips));
await page.click('[data-testid=ab-before]');
const tcBefore = await page.textContent('[data-testid=timecode]');
await page.click('[data-testid=ab-after]');
const tcAfter = await page.textContent('[data-testid=timecode]');
check('Antes/Depois troca a prévia entre o projeto e o rascunho', /\/ 0:05\.50/.test(tcBefore) && /\/ 0:05\.00/.test(tcAfter), `${tcBefore} | ${tcAfter}`);
// Ctrl+B no "Antes": volta para o "Depois" no mesmo ponto do vídeo e divide ali. Em 2,5 s do "Antes" (B, arquivo em
// 2,5 s) a agulha vai para 2 s do rascunho, onde B começa em 1,5 s com in 2.
await page.click('[data-testid=ab-before]');
await ev(() => window.__diretor.playback.seek(2.5));
await page.keyboard.press('Control+B');
const tcSplit = await page.textContent('[data-testid=timecode]');
const splitAt2 = await ev(() => window.__diretor.session.view.clips.some((c) => c.kind === 'video' && Math.abs(c.start - 2) <= 0.001 && Math.abs(c.in - 2.5) <= 0.001));
check('Ctrl+B no "Antes" volta para "Depois" e divide no mesmo ponto do vídeo', /\/ 0:05\.00/.test(tcSplit) && splitAt2, `${tcSplit}; pedaço em 2 s com in 2,5: ${splitAt2}`);
await discardOpen();

// Aceitar no "Antes": a prévia volta para o "Depois" com a agulha no mesmo ponto do vídeo (2,5 s do "Antes" → 2 s).
const ctxE1b = await tool('get_context');
await tool('propose_edit', { requestId: 'e2e-corte-aceitar', baseRevision: ctxE1b.revision, title: 'Tirar um trecho', steps: [{ label: 'Corte', ops: [{ op: 'removeRanges', ranges: [[1, 1.5]] }] }] });
await page.waitForSelector('.seam-chip');
await page.click('[data-testid=ab-before]');
await ev(() => window.__diretor.playback.seek(2.5));
await page.click('[data-testid=accept]');
await page.waitForFunction(() => !window.__diretor.session.openProposal, null, { timeout: 10_000 });
const afterAccept = await ev(() => ({
  t: window.__diretor.playback.get().time,
  tc: document.querySelector('[data-testid=timecode]').textContent,
  antes: !!document.querySelector('[data-testid=ab-before]'),
}));
check('aceitar no "Antes" leva a agulha ao mesmo ponto do vídeo', Math.abs(afterAccept.t - 2) <= 0.001 && /\/ 0:05\.00/.test(afterAccept.tc) && !afterAccept.antes, JSON.stringify(afterAccept));

// Marcas I e O são tempos deste projeto: abrir outro as apaga.
await ev(() => window.__diretor.playback.seek(3));
await page.keyboard.press('i');
await ev(() => window.__diretor.playback.seek(3.5));
await page.keyboard.press('o');
const marksOn = await ev(() => !document.querySelector('[data-testid=delete-range]').disabled);
const cortesProject = await ev(() => window.__diretor.session.project);
await freshProject('Marcas');
const marksGone = await ev(() => ({
  disabled: document.querySelector('[data-testid=delete-range]').disabled,
  shown: document.querySelectorAll('.range-band, .mark-in, .mark-out').length,
}));
check('abrir outro projeto apaga as marcas I e O', marksOn && marksGone.disabled && marksGone.shown === 0, JSON.stringify({ ligado: marksOn, ...marksGone }));

// 300 pedaços: 299 cortes de 20 ms num vídeo de 30 s aplicam rápido, e no zoom máximo a linha do tempo desenha só os visíveis.
const pedacos = join(out, 'pedacos.mp4');
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=30', '-c:v', 'libx264', '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', pedacos]);
await freshProject('Pedaços');
await ev((f) => window.__diretor.importPaths([f]), pedacos);
await page.waitForFunction(() => window.__diretor.session.project.clips.length === 1);
const applyE1 = await ev(() => {
  const s = window.__diretor.session;
  const r = (n) => Math.round(n * 1000) / 1000;
  const ranges = Array.from({ length: 299 }, (_, i) => [r(0.1 * (i + 1) - 0.02), r(0.1 * (i + 1))]);
  const t0 = performance.now();
  const res = s.dispatch([{ op: 'removeRanges', ranges }]);
  return { ok: res.ok, ms: performance.now() - t0, n: s.project.clips.length };
});
const tSettle = Date.now();
await settled();
const settleMs = Date.now() - tSettle;
await ev(() => {
  const z = document.querySelector('[data-testid=zoom]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(z, z.max);
  z.dispatchEvent(new Event('input', { bubbles: true }));
});
const inDom = await ev(() => document.querySelectorAll('[data-clip]').length);
check('300 pedaços: aplica e a linha do tempo desenha só os visíveis', applyE1.ok && applyE1.n === 300 && inDom < 120, `aplicar ${applyE1.ms.toFixed(0)} ms, prévia pronta em ${settleMs} ms, ${inDom} blocos desenhados`);

// Exportar os 300 pedaços no app: 30 s menos 299 cortes de 20 ms dão 24,02 s.
const pedOut = join(out, 'pedacos-exportado.mp4');
const tExp = Date.now();
const pedExp = await ev((p) => window.__diretor.exportProject(window.__diretor.session.project, { outPath: p }), pedOut);
const pedProbe = spawnSync(FFMPEG, ['-hide_banner', '-i', pedOut], { encoding: 'utf8' }).stderr;
const pd = /Duration: (\d+):(\d+):([\d.]+)/.exec(pedProbe);
const pedSecs = pd ? Number(pd[1]) * 3600 + Number(pd[2]) * 60 + Number(pd[3]) : 0;
const pedSil = String(spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', pedOut, '-af', 'silencedetect=n=-40dB:d=0.05', '-f', 'null', '-']).stderr);
check(
  'exporta 300 pedaços: duração certa, som contínuo e nenhum temporário sobrando',
  pedExp.ok && Math.abs(pedSecs - 24.02) < 0.1 && /Audio:/.test(pedProbe) && !/silence_start/.test(pedSil) && leftovers().length === 0,
  `${((Date.now() - tExp) / 1000).toFixed(1)} s; ${pedSecs} s; ${pedExp.error ?? ''}`,
);

// A exportação interrompida do fim precisa de vídeo: volta ao projeto dos cortes.
await ev((p) => window.__diretor.session.load(p, null), cortesProject);

writeFileSync(join(out, 'resultado.json'), JSON.stringify(results, null, 2));
await client.close();
// O projeto da Entrega 1 não foi salvo: marca como sem mudanças para o aviso de "mudanças não salvas" não segurar o fechamento.
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
check('a interface cai no meio da exportação: o ffmpeg para e não sobra arquivo', tmpDuring === 2 && cleaned && !existsSync(crashOut), `temporário durante a exportação: ${tmpDuring}`);
writeFileSync(join(out, 'resultado.json'), JSON.stringify(results, null, 2));

await app.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram.${skipped.length ? ` ${skipped.length} pulada(s) neste sistema: ${skipped.join('; ')}.` : ''}`);
process.exit(failed.length ? 1 : 0);
