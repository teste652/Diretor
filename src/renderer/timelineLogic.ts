// Lógica pura da linha do tempo: marcas I e O, o que o Ctrl+B divide e o que o
// Delete apaga, o texto dos chips de emenda, o que está na janela, o passo da
// régua, os limites e a âncora do zoom e as teclas. Sem DOM e sem o store, para
// os testes.

import type { Clip, Project } from '../core/model';
import type { Op } from '../core/operations';
import { EPS, MIN_DURATION, round } from '../core/time';

/** Marcas I e O da régua (s): o trecho que "Apagar trecho" tira. */
export interface Marks {
  in: number | null;
  out: number | null;
}

/** Marca a entrada; uma saída que ficou antes dela sai (sem duas linhas soltas que não marcam nada). */
export const withIn = (m: Marks, t: number): Marks => {
  const v = round(t);
  return { in: v, out: m.out !== null && m.out < v ? null : m.out };
};

/** Marca a saída; uma entrada que ficou depois dela sai. */
export const withOut = (m: Marks, t: number): Marks => {
  const v = round(t);
  return { out: v, in: m.in !== null && m.in > v ? null : m.in };
};

/** O trecho marcado: só com as duas marcas e a saída pelo menos 1 ms depois da entrada (invertidas ou de tamanho zero, nada). */
export function markedRange(m: Marks): [number, number] | null {
  if (m.in === null || m.out === null || m.out - m.in < 0.001 - EPS) return null;
  return [m.in, m.out];
}

/**
 * O que o Ctrl+B divide no instante `t`: os clipes selecionados em faixa destravada que contêm `t`
 * com pelo menos MIN_DURATION de cada lado (a folga da validação do splitClip); se nenhum, os
 * vídeos em faixa destravada nas mesmas condições.
 */
export function splitTargets(view: Project, selection: string[], t: number): string[] {
  const at = round(t);
  const unlocked = new Set(view.tracks.filter((tr) => !tr.locked).map((tr) => tr.id));
  const fits = (c: Clip) => unlocked.has(c.trackId) && at >= c.start + MIN_DURATION - EPS && at <= c.start + c.duration - MIN_DURATION + EPS;
  const selected = new Set(selection);
  const chosen = view.clips.filter((c) => selected.has(c.id) && fits(c));
  return (chosen.length ? chosen : view.clips.filter((c) => c.kind === 'video' && fits(c))).map((c) => c.id);
}

/** Quando o Ctrl+B não acha o que dividir: o nome da faixa travada que tem o clipe sob a agulha, se houver. */
export function lockedSplitTrack(view: Project, selection: string[], t: number): string | null {
  const open: Project = { ...view, tracks: view.tracks.map((tr) => ({ ...tr, locked: false })) };
  for (const id of splitTargets(open, selection, t)) {
    const tr = view.tracks.find((x) => x.id === view.clips.find((c) => c.id === id)?.trackId);
    if (tr?.locked) return tr.name;
  }
  return null;
}

/**
 * O que o Delete faz com os clipes selecionados. Legendas e títulos saem com removeClip, primeiro. Um vídeo sai
 * com o trecho dele (uma removeRanges só para todos), e o buraco fecha levando as legendas junto; mas um vídeo que
 * outro vídeo não selecionado cobre, por cima ou por baixo, sai com removeClip: o corte valeria para o outro também.
 */
export function deleteOps(view: Project, selection: string[]): Op[] {
  const sel = view.clips.filter((c) => selection.includes(c.id));
  const ops: Op[] = sel.filter((c) => c.kind !== 'video').map((c): Op => ({ op: 'removeClip', clipId: c.id }));
  const ranges: [number, number][] = [];
  for (const c of sel) {
    if (c.kind !== 'video') continue;
    const end = round(c.start + c.duration);
    const covered = view.clips.some(
      (o) => o.kind === 'video' && o.id !== c.id && !selection.includes(o.id) && o.start < end - EPS && round(o.start + o.duration) > c.start + EPS,
    );
    if (covered) ops.push({ op: 'removeClip', clipId: c.id });
    else ranges.push([c.start, end]);
  }
  if (ranges.length) ops.push({ op: 'removeRanges', ranges });
  return ops;
}

/**
 * Chip de uma emenda do rascunho: quanto o corte tirou. Abaixo de 0,05 s com duas casas e no mínimo 0,01
 * ("−0,03 s"); abaixo de 10 s com uma casa ("−0,4 s"); daí para cima, "−m:ss". Nenhum corte aparece como zero,
 * para os cortes curtos (de respiração, de um quadro) não sumirem. O que arredonda para 10,0 s sai como "−0:10".
 */
export function fmtRemoved(sec: number): string {
  if (sec < 0.05) return `\u22120,${String(Math.max(1, Math.round(sec * 100))).padStart(2, '0')} s`;
  const tenths = Math.round(sec * 10);
  if (tenths < 100) return `\u2212${Math.floor(tenths / 10)},${tenths % 10} s`;
  const whole = Math.round(sec);
  return `\u2212${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Só o que aparece na janela [t0, t1] (s): um vídeo longo tem milhares de pedaços, e a linha do tempo desenha só estes. */
export function visibleClips<T extends { start: number; duration: number }>(clips: T[], t0: number, t1: number): T[] {
  return clips.filter((c) => c.start < t1 && c.start + c.duration > t0);
}

/** Passos da régua (s), do mais curto ao mais longo. */
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/** Passo da régua: o menor com pelo menos 70 px entre dois traços, para os rótulos não se encostarem. */
export function tickStep(pps: number): number {
  return TICK_STEPS.find((s) => s * pps >= 70) ?? TICK_STEPS[TICK_STEPS.length - 1];
}

/**
 * Limites do zoom (px por segundo) para um projeto de `total` s numa área de `viewportPx` px. `fit` cabe o
 * projeto inteiro na área (entre `min` e 300). `min` deixa afastar até caber o projeto (uma hora em 1.240 px dá
 * 0,33 px/s), entre 0,05 e 20. `max` é 400.
 */
export function zoomBounds(total: number, viewportPx: number): { min: number; fit: number; max: number } {
  const raw = (viewportPx - 40) / Math.max(total, 5);
  const min = Math.min(20, Math.max(0.05, raw));
  return { min, fit: Math.min(300, Math.max(min, raw)), max: 400 };
}

/** O que decide o zoom de caber o projeto: quantos projetos já abriram e se a linha do tempo está vazia. */
export interface FitKey {
  loads: number;
  empty: boolean;
}

/** O zoom só se ajusta ao projeto inteiro ao abrir um projeto ou quando a linha do tempo ganha o primeiro clipe: cortes, desfazer e rascunhos não tiram a pessoa de onde está. */
export function shouldFit(prev: FitKey | null, next: FitKey): boolean {
  return !prev || prev.loads !== next.loads || (prev.empty && !next.empty);
}

/**
 * Rolagem (px) depois de mudar o zoom de `oldPps` para `newPps`: a agulha fica no mesmo ponto da tela; se ela
 * estava fora da área, o meio da área fica parado.
 */
export function anchoredScroll(scrollLeft: number, viewportPx: number, oldPps: number, newPps: number, playhead: number): number {
  const x = playhead * oldPps - scrollLeft;
  const onScreen = x >= 0 && x <= viewportPx;
  const ax = onScreen ? x : viewportPx / 2;
  const t = onScreen ? playhead : (scrollLeft + ax) / oldPps;
  return Math.max(0, t * newPps - ax);
}

/**
 * Rolagem (px) que mantém a agulha (em `x` px) à vista: parada enquanto ela está na área (a `margin` px da borda
 * direita, ao tocar); se saiu, a agulha passa a ficar a 10% da área.
 */
export function followScroll(scrollLeft: number, viewportPx: number, x: number, margin = 0): number {
  if (x >= scrollLeft && x <= scrollLeft + viewportPx - margin) return scrollLeft;
  return Math.max(0, x - viewportPx * 0.1);
}

/** Campo onde se digita: lá as teclas são do texto. Um controle deslizante em foco (zoom, volume) não conta. */
export function isTextEntry(el: { tagName: string; type?: string; isContentEditable?: boolean } | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && el.type !== 'range';
}
