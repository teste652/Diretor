import type { Project, VideoClip } from '../core/model';
import type { VideoFrame } from '../core/render';

export const mediaUrl = (path: string) => `media://local/${encodeURIComponent(path)}`;

/** Um <video> por clipe de vídeo. Usado pela prévia e (outra instância) pela exportação. */
export class VideoPool {
  private els = new Map<string, { el: HTMLVideoElement; path: string }>();

  constructor(
    private onFrame: () => void,
    private withAudio: boolean,
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

function once(el: HTMLVideoElement, ev: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      el.removeEventListener(ev, done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    el.addEventListener(ev, done);
  });
}

/** Posiciona o vídeo exatamente em `time` e espera o quadro estar pronto. */
export async function seekExact(el: HTMLVideoElement, time: number): Promise<void> {
  if (el.readyState < 1) await once(el, 'loadedmetadata', 10_000);
  const target = Math.min(Math.max(0, time), Math.max(0, (el.duration || time) - 0.001));
  if (Math.abs(el.currentTime - target) < 1e-4 && el.readyState >= 2) return;
  const p = once(el, 'seeked', 10_000);
  el.currentTime = target;
  await p;
  if (el.readyState < 2) await once(el, 'canplay', 5_000);
}
