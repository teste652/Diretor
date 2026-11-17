import { frameCount } from '../core/export';
import type { Project, VideoClip } from '../core/model';
import { isActiveAt, renderFrame, sourceTime } from '../core/render';
import { VideoPool, seekExact } from './video';

export interface ExportProgress {
  frame: number;
  total: number;
}

/**
 * Exporta usando o mesmo renderFrame da prévia. Cada quadro: posiciona os
 * vídeos no tempo exato, compõe no canvas e envia o RGBA para o ffmpeg.
 */
export async function exportProject(
  project: Project,
  opts: { outPath?: string; onProgress?: (p: ExportProgress) => void; signal?: { cancelled: boolean } } = {},
): Promise<{ ok: boolean; outPath?: string; error?: string; cancelled?: boolean }> {
  const api = window.diretor;
  if (!api) return { ok: false, error: 'Exportação disponível apenas no aplicativo.' };
  if (project.clips.length === 0) return { ok: false, error: 'O projeto está vazio.' };
  const started = await api.exportStart(project, opts.outPath);
  if (!started) return { ok: false, cancelled: true };
  if (started.error) return { ok: false, error: started.error };
  const { jobId, outPath } = started as { jobId: number; outPath: string };
  const { width: W, height: H, fps } = project.settings;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const pool = new VideoPool(() => undefined, false);
  const total = frameCount(project);
  try {
    for (let f = 0; f < total; f++) {
      if (opts.signal?.cancelled) {
        await api.exportCancel(jobId);
        return { ok: false, cancelled: true };
      }
      const t = f / fps;
      const active = project.clips.filter((c): c is VideoClip => c.kind === 'video' && isActiveAt(c, t));
      for (const c of active) {
        const el = pool.element(c, project);
        if (el) await seekExact(el, sourceTime(c, t));
      }
      renderFrame(ctx, project, t, { getVideoFrame: (c) => pool.frame(c) });
      const data = ctx.getImageData(0, 0, W, H).data;
      await api.exportFrame(jobId, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      opts.onProgress?.({ frame: f + 1, total });
    }
    const res = await api.exportFinish(jobId);
    return res.ok ? { ok: true, outPath } : { ok: false, error: res.error };
  } catch (e) {
    await api.exportCancel(jobId);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    pool.dispose();
  }
}
