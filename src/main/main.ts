import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, shell } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { buildFfmpegArgs, parseFfmpegProbe } from '../core/export';
import type { Project } from '../core/model';
import { bridgeFilePath } from '../shared/paths';
import { type AiImage, type AiKind, claudeArgs, claudeInput, codexArgs, findCli, runAssistant, terminalScript } from './assistant';
import { startBridge } from './bridge';
import { claudeConfigDirs, claudeDesktopRunning, connectClaude, type McpEntry, readClaudeConfigs, unpackedPath } from './claudeDesktop';
import { type MoveResult, moveIntoPlace } from './replace';
import { iniciarAtualizacao } from './updater';

app.setName('Diretor');

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } },
]);

let win: BrowserWindow | null = null;

function ffmpegPath(): string {
  if (process.env.DIRETOR_FFMPEG) return process.env.DIRETOR_FFMPEG;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p: string | null = require('ffmpeg-static');
    if (p && existsSync(p.replace('app.asar', 'app.asar.unpacked'))) return p.replace('app.asar', 'app.asar.unpacked');
  } catch {
    /* sem ffmpeg-static */
  }
  return 'ffmpeg';
}

const FFMPEG_MISSING = app.isPackaged
  ? 'Não encontrei o ffmpeg que vem com o Diretor. Instale o Diretor de novo (às vezes o antivírus apaga o ffmpeg.exe).'
  : 'Não encontrei o ffmpeg. Rode "npm install" de novo ou instale o ffmpeg e coloque no PATH (ou aponte a variável DIRETOR_FFMPEG para o ffmpeg.exe).';

function probe(path: string): Promise<ReturnType<typeof parseFfmpegProbe> | { error: string }> {
  return new Promise((resolve) => {
    let p: ChildProcessWithoutNullStreams;
    try {
      p = spawn(ffmpegPath(), ['-hide_banner', '-i', path]);
    } catch {
      resolve({ error: FFMPEG_MISSING });
      return;
    }
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    // 'error' (ffmpeg ausente) chega antes de 'close'; a primeira resposta vale.
    p.on('error', (e: NodeJS.ErrnoException) => resolve(e.code === 'ENOENT' || e.code === 'EACCES' ? { error: FFMPEG_MISSING } : null));
    p.on('close', () => resolve(parseFfmpegProbe(err)));
  });
}

/** Caminho real (resolve atalhos, junções e 8.3 do Windows); para arquivo novo, resolve a pasta. */
function canonical(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync.native(abs);
  } catch {
    /* ainda não existe */
  }
  try {
    return join(realpathSync.native(dirname(abs)), basename(abs));
  } catch {
    return abs;
  }
}

/** Mesmo arquivo? Compara o caminho real (sem diferenciar maiúsculas fora do Linux) e, se ambos existem, o próprio arquivo no disco. */
function samePath(a: string, b: string): boolean {
  const na = canonical(a);
  const nb = canonical(b);
  if (process.platform === 'linux' ? na === nb : na.toLowerCase() === nb.toLowerCase()) return true;
  try {
    const sa = statSync(a, { bigint: true });
    const sb = statSync(b, { bigint: true });
    return sa.ino !== 0n && sa.ino === sb.ino && sa.dev === sb.dev;
  } catch {
    return false;
  }
}

const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

/** Caminho local a partir de media://local/<caminho codificado>. */
function mediaPathFromUrl(raw: string): string {
  const url = new URL(raw);
  return decodeURIComponent(url.pathname.slice(1));
}

function serveMedia(req: Request): Response {
  let path: string;
  try {
    path = mediaPathFromUrl(req.url);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  // Só arquivos de mídia: o protocolo não serve outros arquivos do disco.
  const type = MIME[extname(path).toLowerCase()];
  if (!type) return new Response('forbidden', { status: 403 });
  if (!existsSync(path)) return new Response('not found', { status: 404 });
  const size = statSync(path).size;
  const cors = { 'access-control-allow-origin': '*' };
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '');
  if (range) {
    // "bytes=-N" pede os últimos N bytes.
    const suffix = !range[1] && !!range[2];
    const start = suffix ? Math.max(0, size - Number(range[2])) : range[1] ? Number(range[1]) : 0;
    const end = suffix ? size - 1 : range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response('range not satisfiable', { status: 416, headers: { ...cors, 'content-range': `bytes */${size}` } });
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...cors, 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) },
    });
  }
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new Response(body, { status: 200, headers: { ...cors, 'content-type': type, 'accept-ranges': 'bytes', 'content-length': String(size) } });
}

// ---------- ponte MCP ----------
let reqSeq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; timer: NodeJS.Timeout }>();

/** Tempo para o editor responder: sempre abaixo dos ~60 s que o Claude Desktop espera. */
function bridgeTimeoutMs(method: string, params: unknown): number {
  if (method !== 'get_proposal') return 15_000;
  const wait = Math.min(Math.max(Number((params as { waitSeconds?: unknown })?.waitSeconds) || 0, 0), 45);
  return Math.min(55_000, (wait + 8) * 1000);
}

function askRenderer(method: string, params: unknown, signal?: AbortSignal, client?: string): Promise<unknown> {
  if (!win || win.isDestroyed()) return Promise.resolve({ error: 'editor_closed', message: 'O editor não está aberto.' });
  if (signal?.aborted) return Promise.resolve({ error: 'cancelled' });
  const id = ++reqSeq;
  return new Promise((resolve) => {
    // Quem chamou desistiu (ou o tempo acabou): a interface para de esperar e guarda as notas para a próxima chamada.
    const giveUp = (result: unknown) => {
      if (!pending.has(id)) return;
      clearTimeout(pending.get(id)!.timer);
      pending.delete(id);
      signal?.removeEventListener('abort', onAbort);
      if (win && !win.isDestroyed()) win.webContents.send('bridge:cancel', { id });
      resolve(result);
    };
    const onAbort = () => giveUp({ error: 'cancelled' });
    const timer = setTimeout(() => giveUp({ error: 'timeout', message: 'O editor não respondeu a tempo.' }), bridgeTimeoutMs(method, params));
    pending.set(id, {
      resolve: (v) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(v);
      },
      timer,
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    win!.webContents.send('bridge:request', { id, method, params, client });
  });
}

/** A interface recarregou ou caiu: quem esperava resposta recebe um erro na hora. */
function failPending(reason: string): void {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    pending.delete(id);
    p.resolve({ error: 'editor_reloaded', message: reason });
  }
}

ipcMain.on('bridge:response', (_e, { id, result }: { id: number; result: unknown }) => {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(result);
});

// ---------- arquivos ----------
ipcMain.handle('media:openDialog', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Adicionar mídia',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Vídeo MP4', extensions: ['mp4', 'm4v', 'mov', 'webm'] }],
  });
  return r.canceled ? [] : r.filePaths;
});

/** O arquivo ainda está lá? (para dizer "foi movido ou apagado" em vez de "formato não suportado"). */
ipcMain.handle('media:exists', (_e, path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
});

ipcMain.handle('media:probe', async (_e, path: string) => {
  const info = await probe(path);
  if (info && 'error' in info) return info;
  return info ? { ...info, name: basename(path), path } : null;
});

ipcMain.handle('project:open', async (_e, path?: string) => {
  let file = path;
  if (!file) {
    const r = await dialog.showOpenDialog(win!, { title: 'Abrir projeto', filters: [{ name: 'Projeto Diretor', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    file = r.filePaths[0];
  }
  try {
    return { path: file, json: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (e) {
    return { error: `Não consegui abrir ${basename(file)}: ${e instanceof Error ? e.message : String(e)}` };
  }
});

ipcMain.handle('project:save', async (_e, { path, project }: { path?: string; project: Project }) => {
  let file = path;
  if (!file) {
    const r = await dialog.showSaveDialog(win!, {
      title: 'Salvar projeto',
      defaultPath: `${project.name || 'projeto'}.diretor.json`,
      filters: [{ name: 'Projeto Diretor', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return null;
    file = r.filePath;
  }
  // Grava num arquivo temporário e troca: uma falha no meio nunca estraga o projeto anterior.
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(project, null, 2), 'utf8');
    renameSync(tmp, file);
    return { path: file };
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* nada a limpar */
    }
    return { error: `Não consegui salvar em ${file}: ${e instanceof Error ? e.message : String(e)}` };
  }
});

// ---------- exportação ----------
// O ffmpeg grava num temporário na mesma pasta; o arquivo escolhido só é trocado
// quando o MP4 fica pronto. Cancelar, fechar ou recarregar nunca estraga nem apaga
// um arquivo que já existia no destino.
type ExportJob = {
  proc: ChildProcessWithoutNullStreams;
  outPath: string;
  tmpPath: string;
  /** O grafo de filtros do ffmpeg, ao lado do temporário. Sai junto com ele, ou assim que o ffmpeg termina bem. */
  scriptPath: string;
  stderr: string;
  exited: boolean;
  done: Promise<number>;
  cancelling?: Promise<void>;
  /** O MP4 está pronto e indo para o destino (com novas tentativas se ele estiver preso). */
  moving?: Promise<MoveResult>;
  /** Cancelar durante essas tentativas: o destino não muda e o temporário é apagado. */
  stopMove?: AbortController;
};
const jobs = new Map<number, ExportJob>();
let jobSeq = 0;

function removeQuietly(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    /* pode estar em uso; fica para o usuário apagar */
  }
}

/** Apaga o temporário e o script de filtros. Pode ser chamada mais de uma vez e nunca lança erro. */
function removeTemps(job: ExportJob): void {
  removeQuietly(job.tmpPath);
  removeQuietly(job.scriptPath);
}

const within = (p: Promise<unknown>, ms: number) => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);

/**
 * Para o ffmpeg de verdade. Só o SIGTERM não basta no Linux/macOS: ele fica
 * preso esperando o próximo quadro. Fechar a entrada solta essa espera; se ainda
 * assim não sair, SIGKILL. (No Windows, kill() já encerra na hora.)
 */
async function stopFfmpeg(job: ExportJob): Promise<void> {
  if (job.exited) return;
  job.proc.stdin.destroy();
  job.proc.kill();
  if (await within(job.done, 2000)) return;
  job.proc.kill('SIGKILL');
  await within(job.done, 2000);
}

/**
 * Para o ffmpeg (ou as tentativas de gravar no destino) e apaga os temporários. O
 * destino nunca muda por causa de um cancelamento; se a troca já tinha acontecido
 * (ela é atômica), fica feita. Chamar duas vezes espera o mesmo encerramento.
 */
function abortExport(id: number, job: ExportJob): Promise<void> {
  job.cancelling ??= (async () => {
    if (job.moving) {
      job.stopMove?.abort();
      if ('cancelled' in (await job.moving)) removeTemps(job);
    } else {
      await stopFfmpeg(job);
      removeTemps(job);
    }
    jobs.delete(id);
  })();
  return job.cancelling;
}

/** Janela fechada, recarregada ou que caiu: nenhuma exportação fica órfã. */
function abortAllExports(): Promise<void> {
  return Promise.all([...jobs].map(([id, job]) => abortExport(id, job))).then(() => undefined);
}

ipcMain.handle('export:start', async (_e, { project, outPath }: { project: Project; outPath?: string }) => {
  let file = outPath;
  if (!file) {
    const r = await dialog.showSaveDialog(win!, { title: 'Exportar MP4', defaultPath: `${project.name || 'video'}.mp4`, filters: [{ name: 'MP4', extensions: ['mp4'] }] });
    if (r.canceled || !r.filePath) return null;
    file = r.filePath;
  }
  if (project.media.some((m) => samePath(m.path, file!))) return { error: 'O arquivo de saída não pode substituir um original.' };
  const id = ++jobSeq;
  // Nome curto (não repete o nome escolhido, que pode ser longo) e sem ".mp4", para o
  // Explorer não gerar miniatura nem prender o arquivo. O formato vai explícito ao ffmpeg.
  // O sufixo aleatório evita colidir com um temporário deixado por um travamento antigo.
  const tmpPath = join(dirname(file), `.diretor-${process.pid}-${id}-${randomBytes(3).toString('hex')}.part`);
  try {
    closeSync(openSync(tmpPath, 'wx'));
  } catch (e) {
    return { error: `Não consigo criar arquivos na pasta ${dirname(file)} (${e instanceof Error ? e.message : String(e)}). Escolha outra pasta.` };
  }
  // O grafo de filtros vai num arquivo ao lado do temporário, com o mesmo nome.
  const scriptPath = tmpPath.replace(/\.part$/, '.filtro');
  // Falhou antes de o ffmpeg começar: não sobra nenhum dos dois.
  const fail = (error: string) => {
    removeQuietly(tmpPath);
    removeQuietly(scriptPath);
    return { error };
  };
  let args: string[];
  let script: string;
  try {
    // Projeto que abre arquivos demais para a linha de comando: o erro já vem em pt-BR.
    ({ args, script } = buildFfmpegArgs(project, tmpPath, scriptPath));
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  try {
    writeFileSync(scriptPath, script);
  } catch (e) {
    return fail(`Não consigo criar arquivos na pasta ${dirname(file)} (${e instanceof Error ? e.message : String(e)}). Escolha outra pasta.`);
  }
  let proc: ChildProcessWithoutNullStreams;
  try {
    proc = spawn(ffmpegPath(), args);
  } catch (e) {
    return fail(`Não consegui iniciar o ffmpeg: ${e instanceof Error ? e.message : String(e)}`);
  }
  const job: ExportJob = { proc, outPath: file, tmpPath, scriptPath, stderr: '', exited: false, done: Promise.resolve(-1) };
  job.done = new Promise<number>((res) => {
    proc.on('close', (code) => {
      job.exited = true;
      res(code ?? -1);
    });
    proc.on('error', (e: NodeJS.ErrnoException) => {
      // ffmpeg ausente ou sem permissão: vira erro na tela, não travamento.
      job.exited = true;
      job.stderr += `\n${e.code === 'ENOENT' || e.code === 'EACCES' ? FFMPEG_MISSING : e.message}`;
      res(-1);
    });
  });
  proc.stderr.on('data', (d) => {
    job.stderr = (job.stderr + d).slice(-20_000);
  });
  proc.stdin.on('error', () => undefined);
  jobs.set(id, job);
  return { jobId: id, outPath: file };
});

ipcMain.handle('export:frame', async (_e, jobId: number, frame: Uint8Array) => {
  const job = jobs.get(jobId);
  const stdin = job?.proc.stdin;
  if (!job || !stdin || job.exited || stdin.destroyed || !stdin.writable) return false;
  const ok = stdin.write(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
  if (!ok) {
    // Espera o ffmpeg consumir, mas desiste se ele fechar ou der erro (sem travar a exportação).
    await new Promise<void>((resolve) => {
      const done = () => {
        stdin.off('drain', done);
        stdin.off('error', done);
        stdin.off('close', done);
        resolve();
      };
      stdin.on('drain', done);
      stdin.on('error', done);
      stdin.on('close', done);
      void job.done.then(done);
    });
  }
  return !job.exited && !stdin.destroyed && stdin.writable;
});

/** Fim da exportação. `abandon`: a exportação falhou no meio; para o ffmpeg e não grava nada. */
ipcMain.handle('export:finish', async (_e, jobId: number, abandon?: boolean) => {
  const job = jobs.get(jobId);
  if (!job) return { ok: false, error: 'Exportação não encontrada.' };
  if (abandon) await stopFfmpeg(job);
  else {
    try {
      job.proc.stdin.end();
    } catch {
      /* já fechado */
    }
  }
  const code = await job.done;
  // Cancelado enquanto o ffmpeg finalizava o arquivo: é cancelamento, não falha.
  if (job.cancelling) {
    await job.cancelling;
    return { ok: false, cancelled: true };
  }
  const stderr = job.stderr.trim().slice(-2000);
  if (abandon || code !== 0) {
    jobs.delete(jobId);
    removeTemps(job);
    return { ok: false, error: abandon ? stderr : stderr || `ffmpeg saiu com código ${code}` };
  }
  // O ffmpeg terminou bem: o script de filtros não serve mais.
  removeQuietly(job.scriptPath);
  // Destino preso (player, antivírus): tenta de novo e, se continuar, grava como
  // "nome (1).mp4" em vez de perder o vídeo. Cancelar ou fechar nessa hora cancela.
  job.stopMove = new AbortController();
  const moving = moveIntoPlace(job.tmpPath, job.outPath, { signal: job.stopMove.signal });
  job.moving = moving;
  const moved = await moving;
  if ('cancelled' in moved) {
    await job.cancelling;
    return { ok: false, cancelled: true };
  }
  jobs.delete(jobId);
  const name = basename(job.outPath);
  if ('error' in moved) {
    const where = moved.kept ? ` O vídeo pronto ficou em ${moved.kept} (renomeie para .mp4).` : '';
    return { ok: false, error: `Não consegui gravar ${name}: ${moved.error}.${where}` };
  }
  if (moved.fallback) {
    return {
      ok: true,
      outPath: moved.path,
      warning: `${name} está aberto em outro programa (ou protegido) e não pôde ser substituído. O vídeo foi salvo como ${basename(moved.path)}.`,
    };
  }
  return { ok: true, outPath: moved.path };
});

ipcMain.handle('export:cancel', async (_e, jobId: number) => {
  const job = jobs.get(jobId);
  if (job) await abortExport(jobId, job);
  return true;
});

// ---------- Claude Desktop ----------
/**
 * Como o Claude Desktop inicia o servidor MCP: o próprio executável do Diretor
 * rodando como Node (ELECTRON_RUN_AS_NODE), então não precisa instalar o Node.
 * No instalador, o servidor fica fora do app.asar para poder ser executado.
 */
function mcpEntry(): McpEntry {
  return { command: process.execPath, args: [unpackedPath(join(__dirname, '..', 'mcp', 'server.cjs'))], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

/** O mesmo servidor, marcado com quem o usa no chat do painel (o editor mostra o nome certo e sabe quem fez cada proposta). */
function chatMcpEntry(kind: AiKind): McpEntry {
  const e = mcpEntry();
  return { ...e, env: { ...e.env, DIRETOR_CLIENT: kind } };
}

/**
 * O Claude Desktop está aberto? No Windows, a resposta vem do PowerShell, que custa caro
 * para rodar a cada 5 s com o cartão na tela: uma consulta por vez (quem chega durante uma
 * espera por ela), e a resposta vale por `maxAgeMs` depois de chegar (curto quando a pessoa
 * acabou de voltar para a janela ou clicou em Conectar). O tempo é o do performance.now(),
 * que não volta quando alguém acerta o relógio do computador.
 */
let runningCheck: { at: number; pending: boolean; result: Promise<boolean | null> } | null = null;
function claudeRunning(maxAgeMs: number): Promise<boolean | null> {
  if (runningCheck && (runningCheck.pending || performance.now() - runningCheck.at <= maxAgeMs)) return runningCheck.result;
  const check = { at: performance.now(), pending: true, result: claudeDesktopRunning() };
  void check.result.then(() => {
    check.pending = false;
    check.at = performance.now();
  });
  runningCheck = check;
  return check.result;
}

ipcMain.handle('claude:status', async (_e, fresh?: unknown) => {
  const entry = mcpEntry();
  const configs = readClaudeConfigs(claudeConfigDirs(), entry);
  // Só o cartão com os passos usa (sem o Claude, já conectado ou com o arquivo com erro, não precisa).
  const steps = configs.length > 0 && !configs.every((c) => c.state === 'connected') && !configs.every((c) => c.state === 'invalid');
  return { configs, serverFound: existsSync(entry.args[0]), claudeRunning: steps ? await claudeRunning(fresh === true ? 1000 : 15_000) : null };
});

ipcMain.handle('claude:connect', async () => {
  const entry = mcpEntry();
  if (!existsSync(entry.args[0])) return { error: `Não encontrei o servidor do Claude em ${entry.args[0]}. Instale o Diretor de novo.` };
  // Aberto ou não na hora do clique: muda o que o cartão diz para fazer depois.
  const [results, running] = await Promise.all([connectClaude(claudeConfigDirs(), entry), claudeRunning(1000)]);
  return { results, claudeRunning: running };
});

/** O trecho para colar à mão no claude_desktop_config.json. */
ipcMain.handle('claude:copyConfig', () => {
  clipboard.writeText(JSON.stringify({ mcpServers: { diretor: mcpEntry() } }, null, 2));
  return true;
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  packaged: app.isPackaged,
  ffmpeg: ffmpegPath(),
  mcp: mcpEntry(),
  bridgeFile: bridgeFilePath(),
  platform: process.platform,
}));

ipcMain.handle('shell:showItem', (_e, p: string) => shell.showItemInFolder(p));

// ---------- chat com a IA (Claude Code e Codex instalados no computador) ----------
/** Pasta de trabalho da IA: vazia de propósito (nenhum projeto ou CLAUDE.md de outro lugar entra na conversa). */
function aiDir(): string {
  const d = join(app.getPath('userData'), 'ia');
  mkdirSync(d, { recursive: true });
  return d;
}

const aiRuns = new Map<string, { stop: () => void }>();
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

ipcMain.handle('ai:status', () => ({ claude: findCli('claude')?.path ?? null, codex: findCli('codex')?.path ?? null, platform: process.platform }));

ipcMain.handle(
  'ai:send',
  (e, { id, kind, text, sessionId, images = [] }: { id: string; kind: AiKind; text: string; sessionId?: string; images?: AiImage[] }) => {
    if (kind !== 'claude' && kind !== 'codex') return { error: 'Assistente desconhecido.' };
    if (aiRuns.has(id)) return { error: 'Esta mensagem já está sendo respondida.' };
    const launch = findCli(kind);
    if (!launch) return { error: 'not_found' };
    const dir = aiDir();
    const imgs = images.filter((i) => IMAGE_EXT[i.mime] && typeof i.data === 'string').slice(0, 8);
    const temp: string[] = [];
    let args: string[];
    let input: string;
    if (kind === 'claude') {
      const cfg = join(dir, 'mcp.json');
      writeFileSync(cfg, JSON.stringify({ mcpServers: { diretor: chatMcpEntry('claude') } }, null, 2));
      args = claudeArgs({ mcpConfigFile: cfg, sessionId });
      input = claudeInput(text, imgs);
    } else {
      // O Codex recebe imagens como arquivos: ficam numa pasta temporária até a resposta terminar.
      const imgDir = join(dir, 'imagens');
      if (imgs.length) mkdirSync(imgDir, { recursive: true });
      imgs.forEach((img, n) => {
        const f = join(imgDir, `${randomBytes(6).toString('hex')}-${n}.${IMAGE_EXT[img.mime]}`);
        writeFileSync(f, Buffer.from(img.data, 'base64'));
        temp.push(f);
      });
      args = codexArgs({ mcp: chatMcpEntry('codex'), cwd: dir, sessionId, imageFiles: temp });
      input = text || 'Veja a imagem.';
    }
    const sender = e.sender;
    const run = runAssistant({
      kind,
      launch,
      args,
      input,
      cwd: dir,
      onEvent: (ev) => {
        if (!sender.isDestroyed()) sender.send('ai:event', { id, ev });
        if (ev.type !== 'done') return;
        aiRuns.delete(id);
        for (const f of temp) removeQuietly(f);
      },
    });
    aiRuns.set(id, run);
    return { ok: true, path: launch.path };
  },
);

ipcMain.handle('ai:stop', (_e, id: string) => {
  aiRuns.get(id)?.stop();
});

function stopAllAi(): void {
  for (const r of aiRuns.values()) r.stop();
}

/** Imagens que foram para o Codex: não ficam no disco depois (nem se o Diretor fechou no meio de uma resposta). */
function clearAiImages(): void {
  try {
    rmSync(join(app.getPath('userData'), 'ia', 'imagens'), { recursive: true, force: true });
  } catch {
    /* em uso: fica para a próxima vez */
  }
}

/** Abre uma janela do PowerShell (que a pessoa vê) para instalar ou entrar na conta. */
ipcMain.handle('ai:terminal', (_e, { kind, action }: { kind: AiKind; action: 'install' | 'login' }) => {
  if (process.platform !== 'win32') return { error: 'Abra um terminal e rode o programa para entrar na conta.' };
  if ((kind !== 'claude' && kind !== 'codex') || (action !== 'install' && action !== 'login')) return { error: 'Pedido inválido.' };
  const cli = findCli(kind);
  // O script vai codificado (sem problema de aspas) e o caminho do programa vai por variável, nunca no texto.
  const encoded = Buffer.from(terminalScript(kind, action), 'utf16le').toString('base64');
  // "start" do cmd abre uma janela de console de verdade, com teclado, que fica aberta (-NoExit)
  // até a pessoa fechar, mesmo se o Diretor fechar antes. (Com detached, o PowerShell não ganha janela.)
  const p = spawn('cmd.exe', ['/d', '/c', `start "Diretor" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -EncodedCommand ${encoded}`], {
    windowsVerbatimArguments: true,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, DIRETOR_CLI: cli?.path ?? '' },
  });
  p.on('error', () => undefined);
  return { ok: true };
});

/**
 * Ditado por voz: aperta Windows+H, que abre a digitação por voz do próprio Windows no campo
 * com o cursor (a caixa do chat). Gratuito e em português; nada passa pelo Diretor.
 * Um PowerShell fica aberto em segundo plano depois do primeiro uso, para a tecla sair na hora.
 */
let voiceShell: ChildProcessWithoutNullStreams | null = null;
let lastDictate = 0;
ipcMain.handle('voice:dictate', () => {
  if (process.platform !== 'win32') return { error: 'O ditado por voz usa o Windows+H do Windows.' };
  // Dois pedidos seguidos abririam e fechariam o painel do ditado.
  if (performance.now() - lastDictate < 800) return { ok: true };
  lastDictate = performance.now();
  if (!voiceShell || voiceShell.exitCode !== null) {
    voiceShell = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { windowsHide: true });
    voiceShell.on('error', () => (voiceShell = null));
    voiceShell.stdout.resume();
    voiceShell.stderr.resume();
    voiceShell.stdin.on('error', () => undefined);
    voiceShell.stdin.write(
      "Add-Type -Namespace DiretorVoz -Name Teclas -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b, byte s, uint f, System.UIntPtr e);'\n",
    );
  }
  voiceShell.stdin.write(
    // Solta o Ctrl antes (Ctrl+Windows+H não abre o ditado), depois Windows+H.
    '$z=[System.UIntPtr]::Zero; foreach ($k in 0x11,0xA2,0xA3) { [DiretorVoz.Teclas]::keybd_event($k,0,2,$z) }; [DiretorVoz.Teclas]::keybd_event(0x5B,0,0,$z); [DiretorVoz.Teclas]::keybd_event(0x48,0,0,$z); [DiretorVoz.Teclas]::keybd_event(0x48,0,2,$z); [DiretorVoz.Teclas]::keybd_event(0x5B,0,2,$z)\n',
  );
  return { ok: true };
});

// ---------- janela ----------
function createWindow(): void {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#16181c',
    title: 'Diretor',
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: '#16181c', symbolColor: '#dfe7f0', height: 52 },
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  const dev = process.env.DIRETOR_DEV_URL;
  if (dev) void win.loadURL(dev);
  else void win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  // Fechar ou recarregar com mudanças não salvas: a interface segura (beforeunload) e aqui perguntamos.
  win.webContents.on('will-prevent-unload', (event) => {
    const exporting = jobs.size > 0;
    const choice = dialog.showMessageBoxSync(
      win!,
      exporting
        ? {
            type: 'question',
            buttons: ['Sair e cancelar a exportação', 'Continuar'],
            defaultId: 1,
            cancelId: 1,
            title: 'Exportação em andamento',
            message: 'Uma exportação está em andamento.',
            detail: 'Se sair agora, ela será cancelada e o arquivo de destino não será alterado. Mudanças não salvas no projeto, se houver, também serão perdidas.',
          }
        : {
            type: 'question',
            buttons: ['Sair sem salvar', 'Cancelar'],
            defaultId: 1,
            cancelId: 1,
            title: 'Mudanças não salvas',
            message: 'O projeto tem mudanças que ainda não foram salvas.',
            detail: 'Se sair agora, elas serão perdidas. Para guardar, cancele e use Salvar (Ctrl+S).',
          },
    );
    if (choice === 0) event.preventDefault();
  });
  win.webContents.on('did-start-loading', () => {
    failPending('O editor recarregou. Chame a ferramenta de novo.');
    stopAllAi();
    void abortAllExports();
  });
  win.webContents.on('render-process-gone', () => {
    failPending('A interface do editor fechou inesperadamente. Abra o editor e tente de novo.');
    stopAllAi();
    void abortAllExports();
  });
  win.on('closed', () => {
    win = null;
    failPending('O editor foi fechado.');
    stopAllAi();
    void abortAllExports();
  });
}

let closeBridge: (() => void) | null = null;

// Testes: um perfil próprio, para não esbarrar num Diretor de verdade aberto na mesma máquina.
if (process.env.DIRETOR_USER_DATA) app.setPath('userData', process.env.DIRETOR_USER_DATA);

// Uma instância só: duas brigariam pelo arquivo da ponte e o Claude falaria com a errada.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
  protocol.handle('media', serveMedia);
  createWindow();
  clearAiImages();
  iniciarAtualizacao(() => win);
  try {
    const b = await startBridge(bridgeFilePath(), askRenderer);
    closeBridge = b.close;
  } catch (e) {
    console.error('Ponte MCP não iniciou:', e);
  }
});

app.on('window-all-closed', () => {
  closeBridge?.();
  stopAllAi();
  voiceShell?.kill();
  app.quit();
});

// Sair no meio de uma exportação: espera o ffmpeg parar e o temporário sumir.
app.on('will-quit', (event) => {
  clearAiImages();
  if (!jobs.size) return;
  event.preventDefault();
  void abortAllExports().finally(() => app.quit());
});
