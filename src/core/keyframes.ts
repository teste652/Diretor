// Keyframes de um clipe: remapear, limitar, repartir (dividir) e cortar (apagar trecho).

import type { AnimProp, Clip, Keyframe } from './model';
import { evalProp, keyframeGroups, sortedKeyframes } from './properties';
import { EPS, SAME_T, round } from './time';

export const sameGroup = (a: string | undefined, b: string | undefined) => (a ?? '') === (b ?? '');

/**
 * Reposiciona os pontos quando a duração do clipe muda (aparar). Grupos que
 * ocupam o clipe inteiro esticam; grupos presos ao fim (saída) acompanham o fim;
 * grupos presos ao começo (entrada) ficam; o resto acompanha o conteúdo
 * (`contentShift`). Pontos que saem do clipe viram um ponto na borda com o
 * valor que a animação tinha ali.
 */
export function remapKeyframes(c: Clip, newDur: number, contentShift: number): void {
  const D = c.duration;
  if (Math.abs(newDur - D) < EPS && Math.abs(contentShift) < EPS) return;
  const groups = new Map(keyframeGroups(c).map((g) => [g.group, g]));
  const snap = (t: number) => (Math.abs(t) < SAME_T ? 0 : Math.abs(t - newDur) < SAME_T ? newDur : round(t));
  for (const ap of Object.values(c.props)) {
    if (!ap.keyframes.length) continue;
    const mapped = ap.keyframes.map((k) => {
      const g = k.group ? groups.get(k.group) : undefined;
      const atStart = !!g && g.start <= SAME_T;
      const atEnd = !!g && g.end >= D - SAME_T;
      let t: number;
      if (atStart && atEnd) t = D > SAME_T ? (k.t / D) * newDur : k.t;
      else if (atEnd) t = k.t + (newDur - D);
      else if (atStart) t = k.t;
      else t = k.t + contentShift;
      return { ...k, t: snap(t) };
    });
    ap.keyframes = clampKeyframes(mapped, newDur, ap.value);
  }
}

export function clampKeyframes(kfs: Keyframe[], dur: number, value: number): Keyframe[] {
  const sorted = sortedKeyframes(kfs);
  const inside: Keyframe[] = [];
  for (const k of sorted) if (k.t >= -EPS && k.t <= dur + EPS) inside.push({ ...k, t: Math.min(Math.max(k.t, 0), dur) });
  if (inside.length === sorted.length) return sortedKeyframes(inside);
  // Cada animação (cada grupo, e os pontos feitos à mão) ganha o próprio ponto na
  // borda, com o valor da PRÓPRIA curva ali: o valor de uma não vaza para a outra.
  for (const layer of new Set(sorted.map((k) => k.group ?? ''))) {
    const own = sorted.filter((k) => (k.group ?? '') === layer);
    const curve = { value, keyframes: own };
    const addEdge = (src: Keyframe | undefined, t: number) => {
      if (!src || inside.some((k) => Math.abs(k.t - t) < SAME_T && sameGroup(k.group, src.group))) return;
      inside.push({ ...src, t, v: evalProp(curve, t, value) });
    };
    addEdge(own.filter((k) => k.t < -EPS).at(-1), 0);
    addEdge(own.find((k) => k.t > dur + EPS), dur);
  }
  return sortedKeyframes(inside);
}

const cloneProps = (props: Record<string, AnimProp>): Record<string, AnimProp> =>
  Object.fromEntries(Object.entries(props).map(([k, ap]) => [k, { ...ap, keyframes: ap.keyframes.map((x) => ({ ...x })) }]));

/**
 * Reparte os pontos do clipe em `at` (s, relativo ao clipe): a esquerda fica com
 * [0, at] e a direita com [at, duração] (tempos recomeçando em 0). Cada lado ganha
 * um ponto na borda com o valor que a animação tinha ali. Não altera `c`.
 */
export function partitionKeyframes(c: Clip, at: number): { left: Record<string, AnimProp>; right: Record<string, AnimProp> } {
  const left = cloneProps(c.props);
  const right = cloneProps(c.props);
  for (const [name, ap] of Object.entries(c.props)) {
    if (!ap.keyframes.length) continue;
    left[name].keyframes = clampKeyframes(ap.keyframes, at, ap.value);
    const shifted = ap.keyframes.map((k) => ({ ...k, t: round(k.t - at) }));
    right[name].keyframes = clampKeyframes(shifted, round(c.duration - at), ap.value);
  }
  return { left, right };
}

/**
 * Tira o trecho [t0, t1] (s, relativo ao clipe): some o que está dentro, o que vem
 * depois anda para trás. Se dois pontos do mesmo grupo caem no mesmo instante, fica
 * o que estava antes do corte. Não altera `c`.
 */
export function cutKeyframes(c: Clip, t0: number, t1: number): Record<string, AnimProp> {
  const d = round(t1 - t0);
  const out = cloneProps(c.props);
  for (const [name, ap] of Object.entries(c.props)) {
    if (!ap.keyframes.length) continue;
    const kept: Keyframe[] = [];
    for (const k of sortedKeyframes(ap.keyframes)) {
      if (k.t > t0 + EPS && k.t < t1 - EPS) continue;
      const moved = k.t >= t1 - EPS ? { ...k, t: round(k.t - d) } : { ...k };
      if (kept.some((x) => Math.abs(x.t - moved.t) < SAME_T && sameGroup(x.group, moved.group))) continue;
      kept.push(moved);
    }
    out[name].keyframes = clampKeyframes(kept, round(c.duration - d), ap.value);
  }
  return out;
}
