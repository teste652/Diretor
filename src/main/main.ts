import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, createReadStream, existsSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { buildFfmpegArgs, parseFfmpegProbe } from '../core/export';
import type { Project } from '../core/model';
import { bridgeFilePath } from '../shared/paths';
import { startBridge } from './bridge';
import { moveIntoPlace } from './replace';

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

const FFMPEG_MISSING =
  'Não encontrei o ffmpeg. Rode "npm install" de novo ou instale o ffmpeg e coloque no PATH (ou aponte a variável DIRETOR_FFMPEG para o ffmpeg.exe).';

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

function askRenderer(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
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
    win!.webContents.send('bridge:request', { id, method, params });
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
  stderr: string;
  exited: boolean;
  done: Promise<number>;
  cancelling?: Promise<void>;
  /** O MP4 já está pronto e está indo para o destino: não se cancela mais, só se espera. */
  moving?: Promise<unknown>;
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
 * Para o ffmpeg e apaga o temporário. Chamar duas vezes espera o mesmo encerramento.
 * Se o vídeo já está pronto e indo para o destino, só espera ele chegar (nunca o apaga).
 */
function abortExport(id: number, job: ExportJob): Promise<void> {
  job.cancelling ??= (async () => {
    if (job.moving) await job.moving;
    else {
      await stopFfmpeg(job);
      removeQuietly(job.tmpPath);
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
  let proc: ChildProcessWithoutNullStreams;
  try {
    proc = spawn(ffmpegPath(), buildFfmpegArgs(project, tmpPath));
  } catch (e) {
    removeQuietly(tmpPath);
    return { error: `Não consegui iniciar o ffmpeg: ${e instanceof Error ? e.message : String(e)}` };
  }
  const job: ExportJob = { proc, outPath: file, tmpPath, stderr: '', exited: false, done: Promise.resolve(-1) };
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
    removeQuietly(job.tmpPath);
    return { ok: false, error: abandon ? stderr : stderr || `ffmpeg saiu com código ${code}` };
  }
  // Nunca apaga o vídeo pronto: destino preso vira "nome (1).mp4" ao lado. Fechar o
  // editor agora espera essa troca terminar em vez de cancelar.
  const moving = moveIntoPlace(job.tmpPath, job.outPath);
  job.moving = moving;
  const moved = await moving;
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

ipcMain.handle('app:info', () => ({
  bridgeFile: bridgeFilePath(),
  mcpServer: join(app.getAppPath(), 'dist', 'mcp', 'server.cjs'),
  platform: process.platform,
}));

ipcMain.handle('shell:showItem', (_e, p: string) => shell.showItemInFolder(p));

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
    const exporting = [...jobs.values()].some((j) => !j.moving);
    const finishing = !exporting && jobs.size > 0;
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
        : finishing
          ? {
              type: 'question',
              buttons: ['Sair', 'Continuar'],
              defaultId: 1,
              cancelId: 1,
              title: 'Exportação terminando',
              message: 'O vídeo está pronto e sendo gravado no destino.',
              detail: 'Se sair agora, o editor termina de gravar o vídeo antes de fechar. Mudanças não salvas no projeto, se houver, serão perdidas.',
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
    void abortAllExports();
  });
  win.webContents.on('render-process-gone', () => {
    failPending('A interface do editor fechou inesperadamente. Abra o editor e tente de novo.');
    void abortAllExports();
  });
  win.on('closed', () => {
    win = null;
    failPending('O editor foi fechado.');
    void abortAllExports();
  });
}

let closeBridge: (() => void) | null = null;

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
  try {
    const b = await startBridge(bridgeFilePath(), askRenderer);
    closeBridge = b.close;
  } catch (e) {
    console.error('Ponte MCP não iniciou:', e);
  }
});

app.on('window-all-closed', () => {
  closeBridge?.();
  app.quit();
});

// Sair no meio de uma exportação: espera o ffmpeg parar e o temporário sumir.
app.on('will-quit', (event) => {
  if (!jobs.size) return;
  event.preventDefault();
  void abortAllExports().finally(() => app.quit());
});
