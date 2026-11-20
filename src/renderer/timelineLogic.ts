// Lógica pura da linha do tempo: marcas I e O, o que o Ctrl+B divide, o texto
// dos chips de emenda, o que está na janela, o passo da régua e os limites do
// zoom. Sem DOM e sem o store, para os testes.

import type { Clip, Project } from '../core/model';
import { EPS, MIN_DURATION, round } from '../core/time';

/** Marcas I e O da régua (s): o trecho que "Apagar trecho" tira. */
export interface Marks {
  in: number | null;
  out: number | null;
}

export const withIn = (m: Marks, t: number): Marks => ({ ...m, in: round(t) });

export const withOut = (m: Marks, t: number): Marks => ({ ...m, out: round(t) });

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
