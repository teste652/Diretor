import { type MediaItem, type Project, type VideoClip, findClip } from '../core/model';
import type { VideoFrame } from '../core/render';
import { type SlotState, pickSlot, slotsToRelease } from './videoSlots';

export const mediaUrl = (path: string) => `media://local/${encodeURIComponent(path)}`;

type Slot = { el: HTMLVideoElement; path: string; state: SlotState };

const NOTHING_PROTECTED: ReadonlySet<string> = new Set();

/** Fecha o elemento e solta o arquivo. */
function close(el: HTMLVideoElement): void {
  el.pause();
  el.removeAttribute('src');
  el.load();
}

/**
 * Até 3 <video> por mídia (MAX_SLOTS_PER_MEDIA), repartidos entre os pedaços
 * dela por `pickSlot`: o pedaço que continua o anterior sem emenda segue no
 * mesmo elemento. Usado pela prévia e (outra instância) pela exportação.
 */
export class VideoPool {
  private byMedia = new Map<string, Slot[]>();
  /** Carimbo de uso: cresce a cada elemento entregue. */
  private uses = 0;
  /** Arquivos que o Chromium não conseguiu abrir (caminho → motivo). */
  readonly failed = new Map<string, string>();

  constructor(
    private onFrame: () => void,
    private withAudio: boolean,
    private onError?: (path: string, message: string) => void,
  ) {}

  /** Elemento do clipe, escolhido entre os da mídia; `protect` são os clipes cujo elemento não pode ser tomado. */
  element(clip: VideoClip, project: Project, protect: ReadonlySet<string> = NOTHING_PROTECTED): HTMLVideoElement | null {
    const media = project.media.find((m) => m.id === clip.mediaId);
    if (!media) return null;
    const slots = this.slotsOf(media);
    const states = slots.map((s) => s.state);
    const clipOf = (id: string) => findClip(project, id);
    const pick = pickSlot(states, clip, clipOf, protect);
    let slot: Slot;
    if (pick.kind === 'new') slots.push((slot = this.open(media.path)));
    else slot = slots[pick.index];
    slot.state.clipId = clip.id;
    slot.state.used = ++this.uses;
    // O pedaço que continua este vai seguir neste elemento: solta o que ele tinha.
    for (const i of slotsToRelease(states, clip, clipOf, protect)) states[i].clipId = null;
    return slot.el;
  }

  /** O elemento deste clipe, sem atribuir nada. */
  peek(clip: VideoClip): HTMLVideoElement | null {
    return this.byMedia.get(clip.mediaId)?.find((s) => s.state.clipId === clip.id)?.el ?? null;
  }

  /** Prepara o pedaço que vem depois da emenda: atribui e, se o elemento está parado longe do começo do pedaço, posiciona ali (sem tocar). */
  prefetch(clip: VideoClip, project: Project, protect: ReadonlySet<string>): void {
    const el = this.element(clip, project, protect);
    if (!el || el.error || !el.paused) return;
    const at = clip.in + SEEK_EPSILON;
    if (Math.abs(el.currentTime - at) > 1e-3) el.currentTime = at;
  }

  /** Um elemento para cada mídia usada, para os metadados chegarem cedo. */
  warm(project: Project): void {
    const used = new Set<string>();
    for (const c of project.clips) if (c.kind === 'video') used.add(c.mediaId);
    for (const media of project.media) {
      if (!used.has(media.id)) continue;
      const slots = this.slotsOf(media);
      if (!slots.length) slots.push(this.open(media.path));
    }
  }

  /** Fecha os elementos das mídias que saíram e solta os dos clipes que sumiram. */
  prune(project: Project): void {
    const ids = new Set<string>();
    const used = new Set<string>();
    for (const c of project.clips) {
      ids.add(c.id);
      if (c.kind === 'video') used.add(c.mediaId);
    }
    for (const [mediaId, slots] of this.byMedia) {
      if (!used.has(mediaId)) {
        for (const s of slots) close(s.el);
        this.byMedia.delete(mediaId);
        continue;
      }
      for (const s of slots) if (s.state.clipId !== null && !ids.has(s.state.clipId)) s.state.clipId = null;
    }
  }

  all(): HTMLVideoElement[] {
    return [...this.byMedia.values()].flatMap((slots) => slots.map((s) => s.el));
  }

  frame(clip: VideoClip): VideoFrame | null {
    const el = this.peek(clip);
    if (!el || el.readyState < 2) return null;
    return { image: el, width: el.videoWidth, height: el.videoHeight };
  }

  /** Largura e altura do vídeo da mídia do clipe, de qualquer elemento dela que já leu o arquivo (o pedaço pode ainda não ter elemento). */
  videoSize(clip: VideoClip): { width: number; height: number } | null {
    const el = this.byMedia.get(clip.mediaId)?.find((s) => s.el.readyState >= 1 && s.el.videoWidth > 0 && s.el.videoHeight > 0)?.el;
    return el ? { width: el.videoWidth, height: el.videoHeight } : null;
  }

  dispose(): void {
    for (const slots of this.byMedia.values()) for (const s of slots) close(s.el);
    this.byMedia.clear();
  }

  /** Elementos da mídia; se o arquivo dela mudou, os antigos fecham e a lista recomeça. */
  private slotsOf(media: MediaItem): Slot[] {
    let slots = this.byMedia.get(media.id);
    if (slots?.some((s) => s.path !== media.path)) {
      for (const s of slots) close(s.el);
      slots = undefined;
    }
    if (!slots) this.byMedia.set(media.id, (slots = []));
    return slots;
  }

  /** Um <video> novo do arquivo, ainda sem clipe. */
  private open(path: string): Slot {
    const el = document.createElement('video');
    el.preload = 'auto';
    el.playsInline = true;
    el.muted = !this.withAudio;
    el.crossOrigin = 'anonymous';
    el.src = mediaUrl(path);
    el.addEventListener('seeked', this.onFrame);
    el.addEventListener('loadeddata', this.onFrame);
    el.addEventListener('error', () => {
      if (this.failed.has(path)) return;
      const generic = mediaErrorText(el.error);
      this.failed.set(path, generic);
      // O Chromium diz "formato não suportado" até para arquivo que sumiu: confere antes de avisar.
      void explainMediaError(path, el.error).then((msg) => {
        if (!this.failed.has(path)) return;
        this.failed.set(path, msg);
        this.onError?.(path, msg);
      });
    });
    el.addEventListener('loadedmetadata', () => this.failed.delete(path));
    return { el, path, state: { clipId: null, used: 0 } };
  }
}

export function mediaErrorText(e: MediaError | null): string {
  if (!e) return 'erro desconhecido';
  if (e.code === 4) return 'formato ou codec não suportado';
  if (e.code === 3) return 'arquivo corrompido ou incompleto';
  if (e.code === 2) return 'arquivo não encontrado ou sem acesso';
  return e.message || 'erro ao abrir';
}

export const MISSING_FILE_TEXT = 'arquivo não encontrado, foi movido ou apagado?';

/** Motivo do erro para o usuário: arquivo que sumiu do disco não é problema de codec. */
export async function explainMediaError(path: string, e: MediaError | null): Promise<string> {
  try {
    if ((await window.diretor?.mediaExists(path)) === false) return MISSING_FILE_TEXT;
  } catch {
    /* sem a ponte (navegador): fica o motivo do Chromium */
  }
  return mediaErrorText(e);
}

/** Espera um dos eventos (ou o erro do vídeo, o tempo limite ou o cancelamento). */
function once(el: HTMLVideoElement, evs: string[], timeoutMs: number, abort?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const all = [...evs, 'error'];
    const done = () => {
      clearTimeout(timer);
      for (const ev of all) el.removeEventListener(ev, done);
      abort?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    for (const ev of all) el.addEventListener(ev, done);
    if (abort?.aborted) done();
    else abort?.addEventListener('abort', done, { once: true });
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

/** Abre os arquivos do projeto antes de exportar (uma vez por mídia); devolve os que falharam. Para na hora se `abort` disparar. */
export async function preflight(pool: VideoPool, project: Project, abort?: AbortSignal): Promise<string[]> {
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const c of project.clips) {
    if (abort?.aborted) break;
    if (c.kind !== 'video' || seen.has(c.mediaId)) continue;
    seen.add(c.mediaId);
    const el = pool.element(c, project);
    const media = project.media.find((m) => m.id === c.mediaId);
    if (!el || !media) continue;
    if (el.readyState < 1 && !el.error) await once(el, ['loadedmetadata'], 15_000, abort);
    if (abort?.aborted) break;
    if (el.error || el.readyState < 1) bad.push(`${media.name} (${el.error ? await explainMediaError(media.path, el.error) : 'não abriu a tempo'}): ${media.path}`);
  }
  return [...new Set(bad)];
}
