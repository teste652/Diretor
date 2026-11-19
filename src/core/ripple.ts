// Planejador puro dos cortes: apagar trechos da linha do tempo em todas as faixas
// e o ripple de aparar um vídeo. Só devolve operações primitivas, na ordem em que
// devem ser aplicadas, e nunca altera o projeto. De operations.ts vêm só tipos:
// é operations.ts que usa este módulo na expansão.

import { type Clip, type Project, type VideoClip, newId } from './model';
import type { Op, TrimEdge } from './operations';
import { EPS, MIN_DURATION, SAME_T, round } from './time';

/** Trecho [início, fim] em segundos da linha do tempo. */
export type TimeRange = [number, number];

/** Máximo de trechos numa removeRanges. */
export const MAX_RANGES = 500;

export interface RippleOptions {
  /** Clipe que fica de fora: não é cortado nem anda (o vídeo que está sendo aparado). */
  exclude?: string;
  /** Leva a borda do trecho até a borda do vídeo quando sobraria um pedaço curto demais (padrão: true). */
  extend?: boolean;
}

/** Menor que o pedaço mínimo (com folga para o arredondamento). */
const short = (d: number) => d < MIN_DURATION - EPS;

/** Início e fim do clipe; o fim no grid de 1 ms, sem o resíduo da soma. */
const bounds = (c: Clip): TimeRange => [c.start, round(c.start + c.duration)];

/** O trecho toca o clipe que vai de `s` a `e`. */
const touches = ([a, b]: TimeRange, s: number, e: number) => a < e - EPS && b > s + EPS;

/** Ordena e junta os trechos que se sobrepõem ou deixariam entre si um vão menor que o pedaço mínimo. */
function merged(ranges: TimeRange[]): TimeRange[] {
  const out: TimeRange[] = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last && short(a - last[1])) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * Trechos prontos para cortar: no grid de 1 ms, ordenados e unidos. Com `extend`,
 * a borda que deixaria um pedaço de vídeo menor que o mínimo vai até a borda do
 * vídeo (até 10 passadas, porque uma borda nova pode encostar em outro vídeo).
 */
export function normalizeRanges(p: Project, ranges: TimeRange[], opts: RippleOptions = {}): TimeRange[] {
  let out = merged(ranges.map(([a, b]): TimeRange => [round(Math.max(0, a)), round(b)]).filter(([a, b]) => b - a > EPS));
  if (opts.extend === false) return out;
  const vids = p.clips.filter((c) => c.kind === 'video' && c.id !== opts.exclude).map(bounds);
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (const r of out) {
      for (const [s, e] of vids) {
        if (!touches(r, s, e)) continue;
        if (s < r[0] && short(r[0] - s)) {
          r[0] = s;
          changed = true;
        }
        if (r[1] < e && short(e - r[1])) {
          r[1] = e;
          changed = true;
        }
      }
    }
    if (!changed) break;
    out = merged(out);
  }
  return out;
}

/** Primeiro índice de `R` em que `pred` vale (`pred` é falso e depois verdadeiro ao longo de `R`). */
function firstIndex(R: TimeRange[], pred: (r: TimeRange) => boolean): number {
  let lo = 0;
  let hi = R.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pred(R[mid])) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** `mapTime` com as somas acumuladas prontas: cada consulta é uma busca binária. */
function timeMap(R: TimeRange[]): (t: number) => number {
  const cum = [0];
  for (const [a, b] of R) cum.push(cum[cum.length - 1] + (b - a));
  return (t) => {
    const k = firstIndex(R, ([, b]) => b > t + EPS);
    const inside = k < R.length && R[k][0] < t ? t - R[k][0] : 0;
    return round(t - cum[k] - inside);
  };
}

/**
 * Onde o instante `t` vai parar depois de apagar os trechos (já normalizados):
 * perde o tamanho de cada trecho que acaba até ele e, se cai dentro de um trecho,
 * vai para o começo desse trecho.
 */
export function mapTime(ranges: TimeRange[], t: number): number {
  return timeMap(ranges)(t);
}

/** Corte efetivo de um trecho num clipe que hoje vai de `s` a `fim`: nunca deixa sobra menor que o pedaço mínimo. */
function effectiveCut([a, b]: TimeRange, s: number, fim: number): TimeRange {
  return [Math.max(s, short(a - s) ? s : a), Math.min(fim, short(fim - b) ? fim : b)];
}

/**
 * Apaga os trechos em todas as faixas (menos `exclude`), só com primitivas.
 * Fase 1: o vídeo que um trecho toca é dividido e perde o pedaço; título e
 * legenda são encurtados (ou saem, se sobraria pouco). Fase 2: cada clipe que
 * fica anda uma vez só, para onde vai parar o primeiro instante que ele ainda
 * mostra; os que andam o mesmo tanto vão juntos num shiftClips.
 */
export function planRemoveRanges(p: Project, ranges: TimeRange[], opts: RippleOptions = {}): Op[] {
  const R = normalizeRanges(p, ranges, opts);
  if (!R.length) return [];
  const ops: Op[] = [];
  /** Clipes que ficam: o início de hoje e o primeiro instante (da linha do tempo de hoje) que eles ainda mostram. */
  const kept: { id: string; start: number; first: number }[] = [];
  for (const c of p.clips) {
    if (c.id === opts.exclude) continue;
    const [s, e] = bounds(c);
    // Os trechos que tocam o clipe são os de i0 até i1 - 1 (ordenados e sem sobreposição).
    const i0 = firstIndex(R, ([, b]) => b > s + EPS);
    const i1 = firstIndex(R, ([a]) => a >= e - EPS);
    if (i0 >= i1) {
      kept.push({ id: c.id, start: s, first: s });
      continue;
    }
    if (c.kind === 'video') {
      // Da direita para a esquerda: o id original continua sendo o pedaço mais à esquerda.
      let fim = e;
      let alive = true;
      for (let i = i1 - 1; i >= i0 && alive; i--) {
        const [a, b] = effectiveCut(R[i], s, fim);
        if (a <= s && b >= fim) {
          ops.push({ op: 'removeClip', clipId: c.id });
          alive = false;
        } else if (a <= s) {
          const y = newId('vid');
          ops.push({ op: 'splitClip', clipId: c.id, at: b, newId: y }, { op: 'removeClip', clipId: c.id });
          kept.push({ id: y, start: b, first: b });
          alive = false;
        } else if (b >= fim) {
          const x = newId('vid');
          ops.push({ op: 'splitClip', clipId: c.id, at: a, newId: x }, { op: 'removeClip', clipId: x });
          fim = a;
        } else {
          const y = newId('vid');
          const x = newId('vid');
          ops.push({ op: 'splitClip', clipId: c.id, at: b, newId: y }, { op: 'splitClip', clipId: c.id, at: a, newId: x }, { op: 'removeClip', clipId: x });
          kept.push({ id: y, start: b, first: b });
          fim = a;
        }
      }
      if (alive) kept.push({ id: c.id, start: s, first: s });
      continue;
    }
    // Título e legenda: os cortes valem no clipe inteiro; um cutTextTime por trecho, da direita para a esquerda.
    const cuts = R.slice(i0, i1).map((r) => effectiveCut(r, s, e));
    if (short(c.duration - cuts.reduce((sum, [a, b]) => sum + (b - a), 0))) {
      ops.push({ op: 'removeClip', clipId: c.id });
      continue;
    }
    for (let k = cuts.length - 1; k >= 0; k--) ops.push({ op: 'cutTextTime', clipId: c.id, t0: round(cuts[k][0] - s), t1: round(cuts[k][1] - s) });
    kept.push({ id: c.id, start: s, first: cuts[0][0] <= s ? cuts[0][1] : s });
  }
  const map = timeMap(R);
  const shifts = new Map<string, Extract<Op, { op: 'shiftClips' }>>();
  for (const k of kept.sort((x, y) => x.start - y.start)) {
    const delta = round(map(k.first) - k.start);
    if (Math.abs(delta) <= EPS) continue;
    const key = delta.toFixed(3);
    const group = shifts.get(key);
    if (group) group.clipIds.push(k.id);
    else shifts.set(key, { op: 'shiftClips', clipIds: [k.id], delta });
  }
  return [...ops, ...shifts.values()];
}

/**
 * Ripple de aparar um vídeo, em todas as faixas (o próprio clipe fica com o
 * trimClip). Encurtar vale como apagar o pedaço aparado; alongar empurra tudo o
 * que começa a partir da borda: o fim antigo, ou o início do vídeo, que fica no
 * lugar quando o começo é revelado.
 */
export function trimRipple(p: Project, c: VideoClip, edge: TrimEdge, delta: number): Op[] {
  if (Math.abs(delta) <= EPS) return [];
  const fim = c.start + c.duration;
  const only: RippleOptions = { exclude: c.id, extend: false };
  if (edge === 'end' && delta < 0) return planRemoveRanges(p, [[round(fim + delta), fim]], only);
  if (edge === 'start' && delta > 0) return planRemoveRanges(p, [[c.start, round(c.start + delta)]], only);
  const at = edge === 'end' ? fim : c.start;
  const clipIds = p.clips.filter((x) => x.id !== c.id && x.start >= at - SAME_T).map((x) => x.id);
  return clipIds.length ? [{ op: 'shiftClips', clipIds, delta: round(Math.abs(delta)) }] : [];
}
