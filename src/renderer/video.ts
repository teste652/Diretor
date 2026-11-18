import type { Project, VideoClip } from '../core/model';
import type { VideoFrame } from '../core/render';

export const mediaUrl = (path: string) => `media://local/${encodeURIComponent(path)}`;

/** Um <video> por clipe de vídeo. Usado pela prévia e (outra instância) pela exportação. */
export class VideoPool {
  private els = new Map<string, { el: HTMLVideoElement; path: string }>();
  /** Arquivos que o Chromium não conseguiu abrir (caminho → motivo). */
  readonly failed = new Map<string, string>();

  constructor(
    private onFrame: () => void,
    private withAudio: boolean,
    private onError?: (path: string, message: string) => void,
  ) {}

  element(clip: VideoClip, project: Project): HTMLVideoElement | null {
    const media = project.media.find((m) => m.id === clip.mediaId);
    if (!media) return null;
    let entry = this.els.get(clip.id);
    if (!entry || entry.path !== media.path) {
      entry?.el.removeAttribute('src');
      const el = document.createElement('video');
      el.preload = 'auto';
      el.playsInline = true;
      el.muted = !this.withAudio;
      el.crossOrigin = 'anonymous';
      el.src = mediaUrl(media.path);
      el.addEventListener('seeked', this.onFrame);
      el.addEventListener('loadeddata', this.onFrame);
      const path = media.path;
      el.addEventListener('error', () => {
        const msg = mediaErrorText(el.error);
        if (this.failed.get(path) === msg) return;
        this.failed.set(path, msg);
        this.onError?.(path, msg);
      });
      el.addEventListener('loadedmetadata', () => this.failed.delete(path));
      entry = { el, path: media.path };
      this.els.set(clip.id, entry);
    }
    return entry.el;
  }

  /** Remove elementos de clipes que não existem mais. */
  prune(project: Project): void {
    for (const [id, e] of this.els) {
      if (!project.clips.some((c) => c.id === id)) {
        e.el.pause();
        e.el.removeAttribute('src');
        e.el.load();
        this.els.delete(id);
      }
    }
  }

  all(): [string, HTMLVideoElement][] {
    return [...this.els].map(([id, e]) => [id, e.el]);
  }

  frame(clip: VideoClip): VideoFrame | null {
    const el = this.els.get(clip.id)?.el;
    if (!el || el.readyState < 2) return null;
    return { image: el, width: el.videoWidth, height: el.videoHeight };
  }

  dispose(): void {
    for (const e of this.els.values()) {
      e.el.pause();
      e.el.removeAttribute('src');
      e.el.load();
    }
    this.els.clear();
  }
}

export function mediaErrorText(e: MediaError | null): string {
  if (!e) return 'erro desconhecido';
  if (e.code === 4) return 'formato ou codec não suportado';
  if (e.code === 3) return 'arquivo corrompido ou incompleto';
  if (e.code === 2) return 'arquivo não encontrado ou sem acesso';
  return e.message || 'erro ao abrir';
}

/** Espera um dos eventos (ou o erro do vídeo, ou o tempo limite). */
function once(el: HTMLVideoElement, evs: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const all = [...evs, 'error'];
    const done = () => {
      clearTimeout(timer);
      for (const ev of all) el.removeEventListener(ev, done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    for (const ev of all) el.addEventListener(ev, done);
  });
}

/**
 * Margem para cair DENTRO do quadro pedido. O Chromium trunca o tempo em
 * microssegundos e, exatamente na borda (ex.: 2/30 s), mostraria o quadro
 * anterior em 1 de cada 3 quadros.
 */
export const SEEK_EPSILON = 1e-4;

/** Posiciona o vídeo no quadro do tempo `time` e espera o quadro estar pronto. */
export async function seekExact(el: HTMLVideoElement, time: number): Promise<void> {
  if (el.error) return;
  if (el.readyState < 1) await once(el, ['loadedmetadata'], 10_000);
  if (el.error || el.readyState < 1) return;
  const target = Math.min(Math.max(0, time + SEEK_EPSILON), Math.max(0, (el.duration || time) - 0.001));
  if (Math.abs(el.currentTime - target) < 1e-5 && el.readyState >= 2 && !el.seeking) return;
  const p = once(el, ['seeked'], 10_000);
  el.currentTime = target;
  await p;
  if (!el.error && el.readyState < 2) await once(el, ['canplay', 'loadeddata'], 5_000);
}

/** Abre os arquivos do projeto antes de exportar; devolve os que falharam. */
export async function preflight(pool: VideoPool, project: Project): Promise<string[]> {
  const bad: string[] = [];
  for (const c of project.clips) {
    if (c.kind !== 'video') continue;
    const el = pool.element(c, project);
    const media = project.media.find((m) => m.id === c.mediaId);
    if (!el || !media) continue;
    if (el.readyState < 1 && !el.error) await once(el, ['loadedmetadata'], 15_000);
    if (el.error || el.readyState < 1) bad.push(`${media.name} (${el.error ? mediaErrorText(el.error) : 'não abriu a tempo'}): ${media.path}`);
  }
  return [...new Set(bad)];
}
