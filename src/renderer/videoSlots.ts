// Elementos <video> por mídia: qual elemento cada pedaço usa e qual pedaço
// buscar antes da próxima emenda. Puro (sem DOM): o VideoPool só executa.

import type { Clip, Project, VideoClip } from '../core/model';
import { isContiguous } from '../core/pieces';

/** Elementos por mídia antes de tomar o de outro pedaço. */
export const MAX_SLOTS_PER_MEDIA = 3;
/** Com quanta antecedência o próximo pedaço é buscado (s). */
export const PREFETCH_SECONDS = 0.5;

/** Um elemento da mídia: o clipe que ele mostra e o carimbo do último uso. */
export interface SlotState {
  clipId: string | null;
  used: number;
}

export type SlotPick = { kind: 'keep' | 'reuse' | 'free' | 'steal'; index: number } | { kind: 'new' };

/**
 * Elemento para `clip` entre os da mídia dele, nesta ordem:
 * 1. keep: o que já é dele;
 * 2. reuse: o de um pedaço que ele continua sem emenda e que não está protegido
 *    (o elemento segue tocando de onde o anterior parou, sem buscar);
 * 3. free: um sem clipe ou cujo clipe não existe mais;
 * 4. new: um novo, abaixo do teto;
 * 5. steal: o usado há mais tempo entre os não protegidos;
 * 6. new: um novo mesmo acima do teto, quando todos estão protegidos (mais de
 *    MAX_SLOTS_PER_MEDIA pedaços da mesma mídia na tela ao mesmo tempo).
 */
export function pickSlot(
  slots: readonly SlotState[],
  clip: VideoClip,
  clipOf: (id: string) => Clip | undefined,
  protect: ReadonlySet<string>,
): SlotPick {
  const keep = slots.findIndex((s) => s.clipId === clip.id);
  if (keep >= 0) return { kind: 'keep', index: keep };
  const reuse = slots.findIndex((s) => {
    if (s.clipId === null || protect.has(s.clipId)) return false;
    const prev = clipOf(s.clipId);
    return !!prev && isContiguous(prev, clip);
  });
  if (reuse >= 0) return { kind: 'reuse', index: reuse };
  const free = slots.findIndex((s) => s.clipId === null || !clipOf(s.clipId));
  if (free >= 0) return { kind: 'free', index: free };
  if (slots.length < MAX_SLOTS_PER_MEDIA) return { kind: 'new' };
  let steal = -1;
  slots.forEach((s, i) => {
    if (s.clipId !== null && protect.has(s.clipId)) return;
    if (steal < 0 || s.used < slots[steal].used) steal = i;
  });
  return steal >= 0 ? { kind: 'steal', index: steal } : { kind: 'new' };
}

/**
 * Elementos a soltar quando `clip` ganha um: os de pedaços que continuam `clip`
 * sem emenda e não estão protegidos. Na emenda esses pedaços seguem no elemento
 * de `clip` (reuse); o que tinham estaria parado noutro ponto e teria de buscar,
 * porque keep vem antes de reuse.
 */
export function slotsToRelease(
  slots: readonly SlotState[],
  clip: VideoClip,
  clipOf: (id: string) => Clip | undefined,
  protect: ReadonlySet<string>,
): number[] {
  const out: number[] = [];
  slots.forEach((s, i) => {
    if (s.clipId === null || s.clipId === clip.id || protect.has(s.clipId)) return;
    const next = clipOf(s.clipId);
    if (next && isContiguous(clip, next)) out.push(i);
  });
  return out;
}

/**
 * Pedaço a buscar antes da emenda: o primeiro vídeo que começa em
 * (t, t + PREFETCH_SECONDS], que não está ativo e que não continua um pedaço
 * ativo (esse segue no elemento do anterior). Nenhum: null.
 */
export function nextToPrefetch(p: Project, t: number, active: readonly VideoClip[]): VideoClip | null {
  let next: VideoClip | null = null;
  for (const c of p.clips) {
    if (c.kind !== 'video' || c.start <= t || c.start > t + PREFETCH_SECONDS) continue;
    if (next && c.start >= next.start) continue;
    if (active.some((a) => a.id === c.id || isContiguous(a, c))) continue;
    next = c;
  }
  return next;
}
