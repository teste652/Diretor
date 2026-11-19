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

export function clampKeyframes(kfs: Keyframe[], dur: number, value: number, edge?: { start?: number; end?: number }): Keyframe[] {
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
      const forced = t === 0 ? edge?.start : edge?.end;
      inside.push({ ...src, t, v: forced ?? evalProp(curve, t, value) });
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
 * [0, at] e a direita com [at, duração] (tempos recomeçando em 0). O ponto de
 * borda de cada camada leva o valor da curva inteira da propriedade (o que a
 * prévia desenha), então a emenda não muda a imagem. Não altera `c`.
 */
export function partitionKeyframes(c: Clip, at: number): { left: Record<string, AnimProp>; right: Record<string, AnimProp> } {
  const left = cloneProps(c.props);
  const right = cloneProps(c.props);
  for (const [name, ap] of Object.entries(c.props)) {
    if (!ap.keyframes.length) continue;
    const arriving = evalProp(ap, at - 1e-9, ap.value);
    const leaving = evalProp(ap, at, ap.value);
    left[name].keyframes = clampKeyframes(ap.keyframes, at, ap.value, { end: arriving });
    const shifted = ap.keyframes.map((k) => ({ ...k, t: round(k.t - at) }));
    right[name].keyframes = clampKeyframes(shifted, round(c.duration - at), ap.value, { start: leaving });
  }
  return { left, right };
}

/**
 * Tira o trecho [t0, t1] (s, relativo ao clipe). Nas pontas, o mesmo resultado de
 * aparar essa ponta. No meio, as animações presas às bordas (entrada, saída) se
 * comportam como no aparar e as demais camadas ganham, em `t0`, um ponto com o
 * valor que chegava e outro com o valor que volta (um degrau quando diferem).
 * Não altera `c`.
 */
export function cutKeyframes(c: Clip, t0: number, t1: number): Record<string, AnimProp> {
  const D = c.duration;
  const d = round(t1 - t0);
  const nd = round(D - d);
  if (t0 <= EPS || t1 >= D - EPS) {
    const copia = structuredClone(c);
    remapKeyframes(copia, nd, t0 <= EPS ? -d : 0);
    return copia.props;
  }
  const groups = new Map(keyframeGroups(c).map((g) => [g.group, g]));
  const out = cloneProps(c.props);
  for (const [name, ap] of Object.entries(c.props)) {
    if (!ap.keyframes.length) continue;
    const orig = sortedKeyframes(ap.keyframes);
    const kept: Keyframe[] = [];
    // Camadas de conteúdo: pontos sem grupo ou de grupos que não tocam nenhuma borda.
    const layers = new Map<string, { dropped: Keyframe[]; before: boolean; after: boolean; own0: boolean; own1: boolean; at?: number }>();
    for (const k of orig) {
      const g = k.group ? groups.get(k.group) : undefined;
      const atStart = !!g && g.start <= SAME_T;
      const atEnd = !!g && g.end >= D - SAME_T;
      if (atStart || atEnd) {
        const t = atStart && atEnd ? (D > SAME_T ? (k.t * nd) / D : k.t) : atEnd ? k.t - d : k.t;
        kept.push({ ...k, t: round(t) });
        continue;
      }
      const key = k.group ?? '';
      const L = layers.get(key) ?? { dropped: [], before: false, after: false, own0: false, own1: false };
      layers.set(key, L);
      if (k.t <= t0 + EPS) L.before = true;
      if (k.t >= t1 - EPS) {
        L.after = true;
        L.at ??= kept.length;
      }
      if (Math.abs(k.t - t1) < SAME_T) L.own1 = true;
      if (k.t > t0 + EPS && k.t < t1 - EPS) {
        L.dropped.push(k);
        continue;
      }
      if (Math.abs(k.t - t0) < SAME_T && k.t < t1 - EPS) L.own0 = true;
      kept.push(k.t >= t1 - EPS ? { ...k, t: round(k.t - d) } : { ...k });
    }
    // Emenda de cada camada de conteúdo afetada, antes do primeiro ponto que voltou.
    const taken = new Set<string>(orig.map((k) => k.id));
    const uniqueId = (base: string) => {
      let id = base;
      for (let n = 1; taken.has(id); n++) id = `${base}${n}`;
      taken.add(id);
      return id;
    };
    const arriving = evalProp(ap, t0 - 1e-9, ap.value);
    const leaving = evalProp(ap, t1, ap.value);
    const junctions: { index: number; pts: Keyframe[] }[] = [];
    for (const [key, L] of layers) {
      if (!L.dropped.length && !(L.before && L.after)) continue;
      const group = key || undefined;
      const mine = orig.filter((k) => (k.group ?? '') === key);
      const easeOf = (limit: number) => mine.filter((k) => k.t < limit).at(-1)?.ease;
      const pts: Keyframe[] = [];
      const first = L.dropped[0];
      const last = L.dropped.at(-1);
      if (!L.own0) {
        pts.push({ id: first ? first.id : uniqueId(`${name}@${Math.round(t0 * 1000)}<`), t: t0, v: arriving, ease: easeOf(t0 - EPS) ?? 'linear', ...(group ? { group } : {}) });
      }
      if (!L.own1 && !(pts.length && Math.abs(arriving - leaving) <= EPS)) {
        const reuse = last && last !== first ? last.id : undefined;
        pts.push({ id: reuse ?? uniqueId(`${name}@${Math.round(t0 * 1000)}>`), t: t0, v: leaving, ease: easeOf(t1 - EPS) ?? 'linear', ...(group ? { group } : {}) });
      }
      junctions.push({ index: L.at ?? kept.length, pts });
    }
    const result = [...kept];
    for (const j of junctions.sort((a, b) => b.index - a.index)) result.splice(j.index, 0, ...j.pts);
    out[name].keyframes = clampKeyframes(result, nd, ap.value);
  }
  return out;
}
