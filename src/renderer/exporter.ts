import { frameCount } from '../core/export';
import type { Project, VideoClip } from '../core/model';
import { isActiveAt, renderFrame, sourceTime } from '../core/render';
import { VideoPool, preflight, seekExact } from './video';

export interface ExportProgress {
  frame: number;
  total: number;
}

type ExportResult = { ok: boolean; outPath?: string; error?: string; cancelled?: boolean };

/** Exportação em andamento (para o botão Cancelar agir na hora, mesmo no meio de um quadro). */
let current: { jobId: number; signal: { cancelled: boolean } } | null = null;

export async function cancelExport(): Promise<void> {
  const job = current;
  if (!job) return;
  job.signal.cancelled = true;
  await window.diretor?.exportCancel(job.jobId);
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
  const signal = opts.signal ?? { cancelled: false };
  const pool = new VideoPool(() => undefined, false);
  try {
    // Antes de pedir o arquivo de saída: todos os vídeos abrem?
    const bad = await preflight(pool, project);
    if (bad.length) return { ok: false, error: `Não consegui abrir estes vídeos:\n${bad.join('\n')}` };
    const started = await api.exportStart(project, opts.outPath);
    if (!started) return { ok: false, cancelled: true };
    if (started.error) return { ok: false, error: started.error };
    const { jobId, outPath } = started as { jobId: number; outPath: string };
    current = { jobId, signal };
    const { width: W, height: H, fps } = project.settings;
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const total = frameCount(project);
    const stop = async (error: string): Promise<ExportResult> => {
      if (signal.cancelled) {
        await api.exportCancel(jobId);
        return { ok: false, cancelled: true };
      }
      const res = await api.exportFinish(jobId);
      return { ok: false, error: res?.error ? `${error}\n${res.error}` : error };
    };
    try {
      for (let f = 0; f < total; f++) {
        if (signal.cancelled) return await stop('Cancelado.');
        const t = f / fps;
        const active = project.clips.filter((c): c is VideoClip => c.kind === 'video' && isActiveAt(c, t));
        for (const c of active) {
          const el = pool.element(c, project);
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
      const res = await api.exportFinish(jobId);
      return res.ok ? { ok: true, outPath } : { ok: false, error: res.error };
    } catch (e) {
      await api.exportCancel(jobId);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  } finally {
    current = null;
    pool.dispose();
  }
}
