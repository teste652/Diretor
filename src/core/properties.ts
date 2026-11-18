// Registro de propriedades animáveis. Para adicionar recursos novos (rotação 3D,
// perspectiva, máscaras com cantos arredondados...) basta registrar aqui: as
// operações, a validação, o painel de propriedades e as ferramentas MCP são
// genéricos e passam a aceitar a nova propriedade.

import type { AnimProp, Clip, ClipKind, Easing, Keyframe } from './model';

export interface PropDef {
  name: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  default: number;
  step: number;
  kinds: ClipKind[];
}

export const PROPS: PropDef[] = [
  { name: 'x', label: 'Posição X', unit: 'px', min: -4000, max: 4000, default: 0, step: 1, kinds: ['video', 'title'] },
  { name: 'y', label: 'Posição Y', unit: 'px', min: -4000, max: 4000, default: 0, step: 1, kinds: ['video', 'title'] },
  { name: 'scale', label: 'Escala', unit: '×', min: 0, max: 10, default: 1, step: 0.01, kinds: ['video', 'title'] },
  { name: 'opacity', label: 'Opacidade', unit: '', min: 0, max: 1, default: 1, step: 0.01, kinds: ['video', 'title', 'caption'] },
];

export function propDef(name: string): PropDef | undefined {
  return PROPS.find((p) => p.name === name);
}

export function propsForKind(kind: ClipKind): PropDef[] {
  return PROPS.filter((p) => p.kinds.includes(kind));
}

export function defaultProps(kind: ClipKind): Record<string, AnimProp> {
  const out: Record<string, AnimProp> = {};
  for (const d of propsForKind(kind)) out[d.name] = { value: d.default, keyframes: [] };
  return out;
}

export function ease(kind: Easing, u: number): number {
  const x = Math.min(1, Math.max(0, u));
  switch (kind) {
    case 'linear':
      return x;
    case 'easeIn':
      return x * x * x;
    case 'easeOut':
      return 1 - Math.pow(1 - x, 3);
    case 'easeInOut':
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case 'hold':
      return 0;
    default:
      return x;
  }
}

/** Tempo quantizado (µs) para decidir empates sem depender de arredondamento de ponto flutuante. */
const tick = (t: number) => Math.round(t * 1e6);

/**
 * Ordem canônica dos pontos de uma propriedade: por tempo. Pontos de grupos
 * diferentes podem coincidir no mesmo instante (ex.: o fim da "entrada" e o
 * começo da "saida", ou o começo de um "popIn" sobre um "slowZoom"). No empate,
 * vêm primeiro os pontos que FECHAM um grupo (o grupo mais curto antes: é ele
 * que vale chegando nesse instante) e por último os que ABREM um grupo (o mais
 * curto por último: é ele que vale a partir desse instante).
 */
export function sortedKeyframes(kfs: Keyframe[]): Keyframe[] {
  if (kfs.length < 2) return [...kfs];
  const ext = new Map<string, { s: number; e: number }>();
  for (const k of kfs) {
    const g = k.group ?? '';
    const x = ext.get(g);
    if (!x) ext.set(g, { s: k.t, e: k.t });
    else {
      x.s = Math.min(x.s, k.t);
      x.e = Math.max(x.e, k.t);
    }
  }
  const rank = (k: Keyframe): [number, number] => {
    const x = ext.get(k.group ?? '')!;
    const w = x.e - x.s;
    const opens = k.t === x.s;
    const closes = k.t === x.e;
    if (closes && !opens) return [0, w];
    if (opens && !closes) return [2, -w];
    return [1, 0];
  };
  return kfs
    .map((k, i) => ({ k, i, q: tick(k.t), r: rank(k) }))
    .sort((a, b) => a.q - b.q || a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.i - b.i)
    .map((x) => x.k);
}

function isTimeSorted(kfs: Keyframe[]): boolean {
  for (let i = 1; i < kfs.length; i++) if (kfs[i].t < kfs[i - 1].t) return false;
  return true;
}

/**
 * Valor da propriedade no tempo `t` (segundos relativos ao início do clipe).
 * Num instante com mais de um ponto, vale o último da ordem canônica a partir
 * desse instante; antes dele, a curva vai até o primeiro.
 */
export function evalProp(p: AnimProp | undefined, t: number, fallback: number): number {
  if (!p) return fallback;
  const kfs = p.keyframes;
  if (!kfs || kfs.length === 0) return p.value;
  const s = isTimeSorted(kfs) ? kfs : sortedKeyframes(kfs);
  let j = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i].t <= t) j = i;
    else break;
  }
  if (j < 0) return s[0].v;
  if (j === s.length - 1) return s[j].v;
  const a = s[j];
  const b = s[j + 1];
  const span = b.t - a.t;
  const u = span <= 0 ? 1 : (t - a.t) / span;
  return a.v + (b.v - a.v) * ease(a.ease, u);
}

/**
 * Ponto que a prévia mostra neste instante. Com pontos de grupos diferentes no
 * mesmo tempo (fim da entrada e começo da saída), vale o último na ordem usada
 * por evalProp: é esse que o painel deve editar ou remover.
 */
export function keyframeAt(p: AnimProp | undefined, t: number, tol = 1e-3): Keyframe | undefined {
  const kfs = p?.keyframes;
  if (!kfs?.length) return undefined;
  const s = isTimeSorted(kfs) ? kfs : sortedKeyframes(kfs);
  let found: Keyframe | undefined;
  for (const k of s) if (Math.abs(k.t - t) < tol) found = k;
  return found;
}

/** Instante do clipe que o painel edita com o playhead em `timelineT` (limitado ao clipe). */
export function clipLocalTime(clip: Clip, timelineT: number): number {
  return Math.min(Math.max(timelineT - clip.start, 0), clip.duration);
}

/**
 * O que o painel mostra para uma propriedade com o playhead em `timelineT`: o
 * instante é limitado ao clipe, e o valor e o ponto vêm desse mesmo instante
 * (com o playhead antes do clipe, o painel edita o começo do clipe).
 */
export function propAtPlayhead(clip: Clip, name: string, timelineT: number): { local: number; value: number; keyframe?: Keyframe } {
  const local = clipLocalTime(clip, timelineT);
  const ap = clip.props[name];
  return { local, value: evalProp(ap, local, propDef(name)?.default ?? 0), keyframe: keyframeAt(ap, local) };
}

export function evalClipProp(clip: Clip, name: string, timelineT: number): number {
  const def = propDef(name);
  return evalProp(clip.props[name], timelineT - clip.start, def?.default ?? 0);
}

/** Lista de grupos de animação (entrada, saída...) de um clipe, com seu intervalo. */
export function keyframeGroups(clip: Clip): { group: string; start: number; end: number; props: string[] }[] {
  const map = new Map<string, { group: string; start: number; end: number; props: Set<string> }>();
  for (const [name, p] of Object.entries(clip.props)) {
    for (const k of p.keyframes) {
      if (!k.group) continue;
      const g = map.get(k.group) ?? { group: k.group, start: Infinity, end: -Infinity, props: new Set<string>() };
      g.start = Math.min(g.start, k.t);
      g.end = Math.max(g.end, k.t);
      g.props.add(name);
      map.set(k.group, g);
    }
  }
  return [...map.values()]
    .map((g) => ({ group: g.group, start: g.start, end: g.end, props: [...g.props] }))
    .sort((a, b) => a.start - b.start);
}
