// Lógica pura da linha do tempo: marcas I e O, o que o Ctrl+B divide e o texto
// dos chips de emenda. Sem DOM e sem o store, para os testes.

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
