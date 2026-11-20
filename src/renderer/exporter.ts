import { frameCount } from '../core/export';
import type { Project, VideoClip } from '../core/model';
import { isActiveAt, renderFrame, sourceTime } from '../core/render';
import { VideoPool, preflight, seekExact } from './video';

export interface ExportProgress {
  frame: number;
  total: number;
}

type ExportResult = { ok: boolean; outPath?: string; error?: string; warning?: string; cancelled?: boolean };

/**
 * Exportação em andamento. O botão Cancelar age em qualquer fase: conferência dos
 * vídeos, quadros e finalização. `jobId` só existe depois de escolhido o arquivo.
 */
let current: { jobId: number | null; signal: { cancelled: boolean }; abort: AbortController } | null = null;

/** Há um ffmpeg gravando (fechar a janela agora cancelaria a exportação). */
export function isExporting(): boolean {
  return current?.jobId != null;
}

export async function cancelExport(): Promise<void> {
  const job = current;
  if (!job) return;
  job.signal.cancelled = true;
  job.abort.abort();
  if (job.jobId != null) await window.diretor?.exportCancel(job.jobId);
}

/**
 * Exporta usando o mesmo renderFrame da prévia. Cada quadro: posiciona os
 * vídeos no tempo exato, compõe no canvas e envia o RGBA para o ffmpeg.
 */
export async function exportProject(
  project: Project,
  opts: { outPath?: string; onProgress?: (p: ExportProgress) => void; signal?: { cancelled: boolean } } = {},
): Promise<ExportResult> {
  const api = window.diretor;
  if (!api) return { ok: false, error: 'Exportação disponível apenas no aplicativo.' };
  if (project.clips.length === 0) return { ok: false, error: 'O projeto está vazio.' };
  if (current) return { ok: false, error: 'Já há uma exportação em andamento.' };
  const signal = opts.signal ?? { cancelled: false };
  const me = { jobId: null as number | null, signal, abort: new AbortController() };
  current = me;
  const cancelled: ExportResult = { ok: false, cancelled: true };
  const pool = new VideoPool(() => undefined, false);
  try {
    // Antes de pedir o arquivo de saída: todos os vídeos abrem? (Cancelar aqui não abre a janela de salvar.)
    const bad = await preflight(pool, project, me.abort.signal);
    if (signal.cancelled) return cancelled;
    if (bad.length) return { ok: false, error: `Não consegui abrir estes vídeos:\n${bad.join('\n')}` };
    const started = await api.exportStart(project, opts.outPath);
    if (!started) return cancelled;
    if (started.error) return { ok: false, error: started.error };
    const { jobId, outPath } = started as { jobId: number; outPath: string };
    me.jobId = jobId;
    if (signal.cancelled) {
      await api.exportCancel(jobId);
      return cancelled;
    }
    const { width: W, height: H, fps } = project.settings;
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const total = frameCount(project);
    const stop = async (error: string): Promise<ExportResult> => {
      if (signal.cancelled) {
        await api.exportCancel(jobId);
        return cancelled;
      }
      // Falhou no meio: para o ffmpeg sem gravar nada no destino.
      const res = await api.exportFinish(jobId, true);
      return { ok: false, error: res?.error ? `${error}\n${res.error}` : error };
    };
    try {
      for (let f = 0; f < total; f++) {
        if (signal.cancelled) return await stop('Cancelado.');
        const t = f / fps;
        const active = project.clips.filter((c): c is VideoClip => c.kind === 'video' && isActiveAt(c, t));
        // Os pedaços do quadro não tomam o elemento um do outro.
        const protect = new Set(active.map((c) => c.id));
        for (const c of active) {
          const el = pool.element(c, project, protect);
          if (el) await seekExact(el, sourceTime(c, t));
        }
        if (pool.failed.size) return await stop(`Um vídeo parou de abrir durante a exportação: ${[...pool.failed.keys()].join(', ')}`);
        renderFrame(ctx, project, t, { getVideoFrame: (c) => pool.frame(c) });
        const data = ctx.getImageData(0, 0, W, H).data;
        const accepted = await api.exportFrame(jobId, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        // false = o ffmpeg parou (erro, falta de espaço...) ou o usuário cancelou.
        if (!accepted) return await stop('O ffmpeg parou antes do fim da exportação.');
        opts.onProgress?.({ frame: f + 1, total });
      }
      if (signal.cancelled) return await stop('Cancelado.');
      const res = await api.exportFinish(jobId);
      if (res.ok) return { ok: true, outPath: res.outPath ?? outPath, warning: res.warning };
      // Cancelar enquanto o ffmpeg finaliza é cancelamento, não "Falha na exportação".
      if (res.cancelled || signal.cancelled) return cancelled;
      return { ok: false, error: res.error };
    } catch (e) {
      await api.exportCancel(jobId);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  } finally {
    if (current === me) current = null;
    pool.dispose();
  }
}
