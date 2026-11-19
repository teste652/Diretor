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
 * valor que a animação tinha ali. Com `only`, só essas propriedades mudam (os
 * grupos continuam medidos no clipe inteiro).
 */
export function remapKeyframes(c: Clip, newDur: number, contentShift: number, only?: ReadonlySet<string>): void {
  const D = c.duration;
  if (Math.abs(newDur - D) < EPS && Math.abs(contentShift) < EPS) return;
  const groups = new Map(keyframeGroups(c).map((g) => [g.group, g]));
  const snap = (t: number) => (Math.abs(t) < SAME_T ? 0 : Math.abs(t - newDur) < SAME_T ? newDur : round(t));
  for (const [name, ap] of Object.entries(c.props)) {
    if (!ap.keyframes.length || (only && !only.has(name))) continue;
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
 * [0, at] e a direita com [at, duração] (tempos recomeçando em 0). Decide pela
 * curva inteira da propriedade (a que a prévia desenha, todas as camadas juntas):
 * só ganha ponto de borda onde o pedaço desenharia outra coisa, e o ponto leva o
 * valor e a suavização da curva ali. Não altera `c`.
 */
export function partitionKeyframes(c: Clip, at: number): { left: Record<string, AnimProp>; right: Record<string, AnimProp> } {
  const left = cloneProps(c.props);
  const right = cloneProps(c.props);
  for (const [name, ap] of Object.entries(c.props)) {
    if (!ap.keyframes.length) continue;
    const s = sortedKeyframes(ap.keyframes);
    const lefts: Keyframe[] = [];
    const rights: Keyframe[] = [];
    const border: Keyframe[] = [];
    for (const k of s) {
      if (k.t < at - EPS) lefts.push(k);
      else if (k.t > at + EPS && round(k.t - at) > EPS) rights.push(k);
      else border.push(k);
    }
    const lp = lefts.at(-1);
    const rq = rights[0];
    const L = lefts.map((k) => ({ ...k }));
    const R: Keyframe[] = [];
    if (border.length) {
      const tA = Math.min(at, ...border.map((k) => k.t));
      const tB = Math.max(at, ...border.map((k) => k.t));
      const vL = evalProp(ap, tA - 1e-9, ap.value);
      const vR = evalProp(ap, tB, ap.value);
      const E = s.filter((k) => k.t <= tB + EPS).at(-1)?.ease ?? 'linear';
      for (const k of border) {
        L.push({ ...k, t: at, v: vL });
        R.push({ ...k, t: 0, v: vR, ease: E });
      }
    } else {
      // Um ponto só existe quando a emenda cairia numa curva diferente da original.
      const same = !!lp && !!rq && sameGroup(lp.group, rq.group);
      const group = same && lp.group ? { group: lp.group } : {};
      const vL = evalProp(ap, at - 1e-9, ap.value);
      const vR = evalProp(ap, at, ap.value);
      if (rq && ((!lp && Math.abs(rq.v - ap.value) > EPS) || (lp && Math.abs(lp.v - rq.v) > EPS && lp.ease !== 'hold')))
        L.push({ id: rq.id, t: at, v: vL, ease: rq.ease, ...group });
      if (lp && ((!rq && Math.abs(lp.v - ap.value) > EPS) || (rq && Math.abs(lp.v - rq.v) > EPS)))
        R.push({ id: lp.id, t: 0, v: vR, ease: lp.ease, ...group });
    }
    for (const k of rights) R.push({ ...k, t: round(k.t - at) });
    left[name].keyframes = sortedKeyframes(L);
    right[name].keyframes = sortedKeyframes(R);
  }
  return { left, right };
}

/**
 * Tira o trecho [t0, t1] (s, relativo ao clipe). Nas pontas, o mesmo resultado de
 * aparar essa ponta. No meio: propriedades só de animações presas às bordas
 * (entrada, saída) se comportam como aparar o fim; nas demais, a curva inteira
 * decide, e quando o que fica antes e depois do corte não se encontra sozinho
 * entram um ou dois pontos em `t0` (um degrau quando os valores diferem), com os
 * valores da curva original. Não altera `c`.
 */
export function cutKeyframes(c: Clip, t0: number, t1: number): Record<string, AnimProp> {
  const D = c.duration;
  const d = round(t1 - t0);
  const nd = round(D - d);
  // Cópia rasa com as propriedades clonadas: remapKeyframes só lê a duração e as propriedades.
  const out = cloneProps(c.props);
  if (t0 <= EPS || t1 >= D - EPS) {
    remapKeyframes({ ...c, props: out }, nd, t0 <= EPS ? -d : 0);
    return out;
  }
  const groups = new Map(keyframeGroups(c).map((g) => [g.group, g]));
  const isAnchored = (ap: AnimProp) =>
    ap.keyframes.length > 0 &&
    ap.keyframes.every((k) => {
      const g = k.group ? groups.get(k.group) : undefined;
      return !!g && (g.start <= SAME_T || g.end >= D - SAME_T);
    });
  // Propriedades só de animações presas às bordas: seguem o aparar do fim (só elas são remapeadas).
  const anchored = new Set(Object.keys(c.props).filter((name) => isAnchored(c.props[name])));
  if (anchored.size) remapKeyframes({ ...c, props: out }, nd, 0, anchored);
  for (const [name, ap] of Object.entries(c.props)) {
    if (!ap.keyframes.length || anchored.has(name)) continue;
    const s = sortedKeyframes(ap.keyframes);
    const kept: Keyframe[] = [];
    const moved: Keyframe[] = [];
    const W: Keyframe[] = [];
    for (const k of s) {
      if (k.t <= t0 - EPS) kept.push({ ...k });
      else if (k.t > t1 + EPS && round(k.t - d) > t0 + EPS) moved.push({ ...k, t: round(k.t - d) });
      else W.push(k);
    }
    const f = (t: number) => evalProp(ap, t, ap.value);
    const p = kept.at(-1);
    const q = moved[0];
    const tA = Math.min(t0, ...W.map((k) => k.t));
    const tR = Math.max(t1, ...W.map((k) => k.t));
    const vL = f(tA - 1e-9);
    const vR = f(tR);
    const E = s.filter((k) => k.t <= tR + EPS).at(-1)?.ease ?? 'linear';
    const vals = [...(p ? [p.v] : []), ...W.map((k) => k.v), ...(q ? [q.v] : [])];
    const flat = vals.length > 0 && Math.max(...vals) - Math.min(...vals) <= EPS;
    const taken = new Set<string>(s.map((k) => k.id));
    const novoId = (base: string) => {
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}~${n}`;
      taken.add(id);
      return id;
    };
    const ms = Math.round(t0 * 1000);
    const idL = () => (W.length ? W[0].id : novoId(`${name}@${ms}<`));
    const idR = () => (W.length >= 2 ? W.at(-1)!.id : novoId(`${name}@${ms}>`));
    const junction: Keyframe[] = [];
    if (flat) {
      if (!p && !q && Math.abs(vL - ap.value) > EPS) junction.push({ id: idL(), t: t0, v: vL, ease: E });
    } else if (Math.abs(vL - vR) <= EPS) {
      junction.push({ id: idL(), t: t0, v: vL, ease: E });
    } else {
      junction.push({ id: idL(), t: t0, v: vL, ease: 'linear' });
      junction.push({ id: idR(), t: t0, v: vR, ease: E });
    }
    out[name].keyframes = sortedKeyframes([...kept, ...junction, ...moved]);
  }
  return out;
}
