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
  }
}

export function sortedKeyframes(kfs: Keyframe[]): Keyframe[] {
  return [...kfs].sort((a, b) => a.t - b.t);
}

/** Valor da propriedade no tempo `t` (segundos relativos ao início do clipe). */
export function evalProp(p: AnimProp | undefined, t: number, fallback: number): number {
  if (!p) return fallback;
  const kfs = p.keyframes;
  if (kfs.length === 0) return p.value;
  const s = kfs.length > 1 ? sortedKeyframes(kfs) : kfs;
  if (t <= s[0].t) return s[0].v;
  const last = s[s.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i];
    const b = s[i + 1];
    if (t >= a.t && t < b.t) {
      const span = b.t - a.t;
      const u = span <= 0 ? 1 : (t - a.t) / span;
      return a.v + (b.v - a.v) * ease(a.ease, u);
    }
  }
  return last.v;
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
