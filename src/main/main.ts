import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { buildFfmpegArgs, parseFfmpegProbe } from '../core/export';
import type { Project } from '../core/model';
import { bridgeFilePath } from '../shared/paths';
import { startBridge } from './bridge';

app.setName('Diretor');

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } },
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

function probe(path: string): Promise<ReturnType<typeof parseFfmpegProbe>> {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-i', path]);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', () => resolve(parseFfmpegProbe(err)));
    p.on('error', () => resolve(null));
  });
}

const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

function serveMedia(req: Request): Response {
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname.slice(1));
  if (!existsSync(path)) return new Response('not found', { status: 404 });
  const size = statSync(path).size;
  const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) },
    });
  }
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new Response(body, { status: 200, headers: { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': String(size) } });
}

// ---------- ponte MCP ----------
let reqSeq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; timer: NodeJS.Timeout }>();

function askRenderer(method: string, params: unknown): Promise<unknown> {
  if (!win || win.isDestroyed()) return Promise.resolve({ error: 'editor_closed', message: 'O editor não está aberto.' });
  const id = ++reqSeq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ error: 'timeout', message: 'O editor não respondeu a tempo.' });
    }, 70_000);
    pending.set(id, { resolve, timer });
    win!.webContents.send('bridge:request', { id, method, params });
  });
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

ipcMain.handle('media:probe', async (_e, path: string) => {
  const info = await probe(path);
  return info ? { ...info, name: basename(path), path } : null;
});

ipcMain.handle('project:open', async (_e, path?: string) => {
  let file = path;
  if (!file) {
    const r = await dialog.showOpenDialog(win!, { title: 'Abrir projeto', filters: [{ name: 'Projeto Diretor', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    file = r.filePaths[0];
  }
  return { path: file, json: JSON.parse(readFileSync(file, 'utf8')) };
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
  writeFileSync(file, JSON.stringify(project, null, 2), 'utf8');
  return file;
});

// ---------- exportação ----------
const jobs = new Map<number, { proc: ChildProcessWithoutNullStreams; outPath: string; stderr: string; done: Promise<number> }>();
let jobSeq = 0;

ipcMain.handle('export:start', async (_e, { project, outPath }: { project: Project; outPath?: string }) => {
  let file = outPath;
  if (!file) {
    const r = await dialog.showSaveDialog(win!, { title: 'Exportar MP4', defaultPath: `${project.name || 'video'}.mp4`, filters: [{ name: 'MP4', extensions: ['mp4'] }] });
    if (r.canceled || !r.filePath) return null;
    file = r.filePath;
  }
  if (project.media.some((m) => m.path === file)) return { error: 'O arquivo de saída não pode substituir um original.' };
  const proc = spawn(ffmpegPath(), buildFfmpegArgs(project, file));
  const job = { proc, outPath: file, stderr: '', done: new Promise<number>((res) => proc.on('close', (code) => res(code ?? -1))) };
  proc.stderr.on('data', (d) => (job.stderr += d));
  proc.stdin.on('error', () => undefined);
  const id = ++jobSeq;
  jobs.set(id, job);
  return { jobId: id, outPath: file };
});

ipcMain.handle('export:frame', async (_e, jobId: number, frame: Uint8Array) => {
  const job = jobs.get(jobId);
  if (!job) return false;
  const ok = job.proc.stdin.write(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
  if (!ok) await new Promise((r) => job.proc.stdin.once('drain', r));
  return true;
});

ipcMain.handle('export:finish', async (_e, jobId: number) => {
  const job = jobs.get(jobId);
  if (!job) return { ok: false, error: 'Exportação não encontrada.' };
  job.proc.stdin.end();
  const code = await job.done;
  jobs.delete(jobId);
  return code === 0 ? { ok: true, outPath: job.outPath } : { ok: false, error: job.stderr.slice(-2000) || `ffmpeg saiu com código ${code}` };
});

ipcMain.handle('export:cancel', async (_e, jobId: number) => {
  const job = jobs.get(jobId);
  if (job) job.proc.kill();
  jobs.delete(jobId);
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
      sandbox: false,
    },
  });
  const dev = process.env.DIRETOR_DEV_URL;
  if (dev) void win.loadURL(dev);
  else void win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => (win = null));
}

let closeBridge: (() => void) | null = null;

app.whenReady().then(async () => {
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
