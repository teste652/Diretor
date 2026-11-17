// Camada única de operações de edição. A interface (mão) e o Claude (MCP) usam
// exatamente estas operações: o editor valida alvo, parâmetros e intervalo antes
// de aplicar qualquer uma delas.

import {
  type CaptionClip,
  type CaptionPreset,
  type Clip,
  type ClipKind,
  type Easing,
  EASINGS,
  type MediaItem,
  type Project,
  type TextStyle,
  type TitleClip,
  type VideoClip,
  captionStyleForPreset,
  defaultTitleStyle,
  findClip,
  findTrack,
  newId,
  trackForKind,
} from './model';
import { defaultProps, evalProp, propDef, sortedKeyframes } from './properties';

export type ClipChanges = {
  name?: string;
  start?: number;
  duration?: number;
  in?: number;
  text?: string;
  style?: Partial<TextStyle>;
  preset?: CaptionPreset;
  volume?: number;
  muted?: boolean;
};

export type AnimationPreset =
  | 'fadeIn'
  | 'fadeOut'
  | 'slideUpIn'
  | 'slideDownIn'
  | 'slideLeftIn'
  | 'slideRightIn'
  | 'slideUpOut'
  | 'slideDownOut'
  | 'popIn'
  | 'popOut'
  | 'slowZoom';

export const ANIMATION_PRESETS: { name: AnimationPreset; label: string; kind: 'in' | 'out' | 'span' }[] = [
  { name: 'fadeIn', label: 'Aparecer', kind: 'in' },
  { name: 'fadeOut', label: 'Desaparecer', kind: 'out' },
  { name: 'slideUpIn', label: 'Subir e aparecer', kind: 'in' },
  { name: 'slideDownIn', label: 'Descer e aparecer', kind: 'in' },
  { name: 'slideLeftIn', label: 'Entrar pela direita', kind: 'in' },
  { name: 'slideRightIn', label: 'Entrar pela esquerda', kind: 'in' },
  { name: 'slideUpOut', label: 'Subir e sumir', kind: 'out' },
  { name: 'slideDownOut', label: 'Descer e sumir', kind: 'out' },
  { name: 'popIn', label: 'Surgir crescendo', kind: 'in' },
  { name: 'popOut', label: 'Sumir encolhendo', kind: 'out' },
  { name: 'slowZoom', label: 'Zoom lento', kind: 'span' },
];

export type NewClipSpec = {
  kind: ClipKind;
  id?: string;
  name?: string;
  start?: number;
  duration?: number;
  text?: string;
  mediaId?: string;
  in?: number;
  style?: Partial<TextStyle>;
  preset?: CaptionPreset;
};

export type Op =
  | { op: 'addMedia'; media: MediaItem }
  | { op: 'addClip'; clip: NewClipSpec }
  | { op: 'updateClip'; clipId: string; set: ClipChanges }
  | { op: 'removeClip'; clipId: string }
  | { op: 'setProperty'; clipId: string; prop: string; value: number }
  | {
      op: 'setKeyframe';
      clipId: string;
      prop: string;
      /** Segundos relativos ao início do clipe. */
      t: number;
      v: number;
      ease?: Easing;
      group?: string;
      /** Se existir, edita esse ponto; senão cria um ponto com esse id. */
      keyframeId?: string;
    }
  | { op: 'removeKeyframe'; clipId: string; prop: string; keyframeId: string }
  | { op: 'clearKeyframes'; clipId: string; prop?: string; group?: string }
  | { op: 'retimeGroup'; clipId: string; group: string; start: number; duration: number }
  | { op: 'updateTrack'; trackId: string; set: { hidden?: boolean; locked?: boolean } }
  | { op: 'renameProject'; name: string }
  | { op: 'setCanvas'; width: number; height: number; fps?: number }
  /** Macro: vira pontos de animação editáveis (setKeyframe) ao ser preparada. */
  | {
      op: 'animate';
      clipId: string;
      preset: AnimationPreset;
      start?: number;
      duration?: number;
      ease?: Easing;
      group?: string;
    };

export interface OpError {
  index: number;
  op: string;
  code: 'target_not_found' | 'invalid_param' | 'out_of_range' | 'locked' | 'unknown_op';
  message: string;
}

export class OpValidationError extends Error {
  constructor(public errors: OpError[]) {
    super(errors.map((e) => `#${e.index} ${e.op}: ${e.message}`).join('; '));
  }
}

const EPS = 1e-6;
const MIN_DURATION = 0.04;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function err(index: number, op: string, code: OpError['code'], message: string): OpError {
  return { index, op, code, message };
}

function trackLocked(p: Project, clip: Clip): boolean {
  return !!findTrack(p, clip.trackId)?.locked;
}

/** Valida uma operação contra o estado atual. Lista vazia = ok. */
export function validateOp(p: Project, o: Op, index = 0): OpError[] {
  const e: OpError[] = [];
  const name = (o as { op?: string })?.op ?? '?';
  const need = (clipId: string): Clip | undefined => {
    const c = findClip(p, clipId);
    if (!c) e.push(err(index, name, 'target_not_found', `Clipe "${clipId}" não existe nesta revisão.`));
    else if (trackLocked(p, c)) e.push(err(index, name, 'locked', `A faixa do clipe "${clipId}" está travada.`));
    return c;
  };
  switch (o?.op) {
    case 'addMedia': {
      const m = o.media;
      if (!m || !m.id || !m.path || !isNum(m.duration) || m.duration <= 0)
        e.push(err(index, name, 'invalid_param', 'Mídia precisa de id, caminho e duração.'));
      else if (p.media.some((x) => x.id === m.id))
        e.push(err(index, name, 'invalid_param', `Mídia "${m.id}" já existe.`));
      break;
    }
    case 'addClip': {
      const c = o.clip;
      if (!c || !['video', 'title', 'caption'].includes(c.kind)) {
        e.push(err(index, name, 'invalid_param', 'kind deve ser video, title ou caption.'));
        break;
      }
      if (c.id && findClip(p, c.id)) e.push(err(index, name, 'invalid_param', `Já existe um clipe "${c.id}".`));
      if (c.start !== undefined && (!isNum(c.start) || c.start < 0))
        e.push(err(index, name, 'out_of_range', 'start deve ser ≥ 0.'));
      if (c.duration !== undefined && (!isNum(c.duration) || c.duration < MIN_DURATION))
        e.push(err(index, name, 'out_of_range', `duration deve ser ≥ ${MIN_DURATION}s.`));
      const tr = trackForKind(p, c.kind);
      if (!tr) e.push(err(index, name, 'target_not_found', 'Não há faixa para esse tipo de clipe.'));
      else if (tr.locked) e.push(err(index, name, 'locked', `A faixa "${tr.name}" está travada.`));
      if (c.kind === 'video') {
        const m = p.media.find((x) => x.id === c.mediaId);
        if (!m) e.push(err(index, name, 'target_not_found', `Mídia "${c.mediaId}" não existe.`));
        else {
          const inn = c.in ?? 0;
          const dur = c.duration ?? m.duration - inn;
          if (inn < 0 || inn + dur > m.duration + 0.05)
            e.push(err(index, name, 'out_of_range', `Trecho além do arquivo (duração ${m.duration.toFixed(2)}s).`));
        }
      }
      break;
    }
    case 'updateClip': {
      const c = need(o.clipId);
      if (!c) break;
      const s = o.set ?? {};
      const start = s.start ?? c.start;
      const dur = s.duration ?? c.duration;
      if (!isNum(start) || start < 0) e.push(err(index, name, 'out_of_range', 'start deve ser ≥ 0.'));
      if (!isNum(dur) || dur < MIN_DURATION) e.push(err(index, name, 'out_of_range', `duration deve ser ≥ ${MIN_DURATION}s.`));
      if (c.kind === 'video') {
        const m = p.media.find((x) => x.id === c.mediaId);
        const inn = s.in ?? c.in;
        if (!isNum(inn) || inn < 0) e.push(err(index, name, 'out_of_range', 'in deve ser ≥ 0.'));
        else if (m && inn + dur > m.duration + 0.05)
          e.push(err(index, name, 'out_of_range', `Trecho além do arquivo (duração ${m.duration.toFixed(2)}s).`));
        if (s.volume !== undefined && (!isNum(s.volume) || s.volume < 0 || s.volume > 2))
          e.push(err(index, name, 'out_of_range', 'volume vai de 0 a 2.'));
      } else {
        if (s.in !== undefined) e.push(err(index, name, 'invalid_param', 'in só vale para vídeo.'));
        if (s.text !== undefined && typeof s.text !== 'string') e.push(err(index, name, 'invalid_param', 'text deve ser texto.'));
        if (s.style?.fontSize !== undefined && (!isNum(s.style.fontSize) || s.style.fontSize < 6 || s.style.fontSize > 400))
          e.push(err(index, name, 'out_of_range', 'fontSize vai de 6 a 400.'));
      }
      if (s.preset !== undefined && !['padrao', 'caixa', 'destaque'].includes(s.preset))
        e.push(err(index, name, 'invalid_param', 'preset de legenda: padrao, caixa ou destaque.'));
      break;
    }
    case 'removeClip':
      need(o.clipId);
      break;
    case 'setProperty':
    case 'setKeyframe':
    case 'removeKeyframe':
    case 'clearKeyframes':
    case 'retimeGroup':
    case 'animate': {
      const c = need(o.clipId);
      if (!c) break;
      const prop = 'prop' in o ? o.prop : undefined;
      if (prop !== undefined) {
        const d = propDef(prop);
        if (!d || !d.kinds.includes(c.kind)) {
          e.push(err(index, name, 'invalid_param', `Propriedade "${prop}" não existe para ${c.kind}.`));
          break;
        }
        const val = o.op === 'setProperty' ? o.value : o.op === 'setKeyframe' ? o.v : undefined;
        if (val !== undefined && (!isNum(val) || val < d.min - EPS || val > d.max + EPS))
          e.push(err(index, name, 'out_of_range', `${d.label} vai de ${d.min} a ${d.max}.`));
      }
      if (o.op === 'setKeyframe') {
        if (!isNum(o.t) || o.t < -EPS || o.t > c.duration + EPS)
          e.push(err(index, name, 'out_of_range', `t (relativo ao clipe) deve ficar entre 0 e ${c.duration.toFixed(3)}s.`));
        if (o.ease && !EASINGS.includes(o.ease)) e.push(err(index, name, 'invalid_param', `ease: ${EASINGS.join(', ')}.`));
      }
      if (o.op === 'removeKeyframe' && !c.props[o.prop]?.keyframes.some((k) => k.id === o.keyframeId))
        e.push(err(index, name, 'target_not_found', `Ponto "${o.keyframeId}" não existe.`));
      if (o.op === 'retimeGroup') {
        const has = Object.values(c.props).some((pp) => pp.keyframes.some((k) => k.group === o.group));
        if (!has) e.push(err(index, name, 'target_not_found', `Grupo de animação "${o.group}" não existe.`));
        if (!isNum(o.start) || !isNum(o.duration) || o.start < -EPS || o.duration < 0 || o.start + o.duration > c.duration + EPS)
          e.push(err(index, name, 'out_of_range', `Intervalo deve caber no clipe (0 a ${c.duration.toFixed(3)}s).`));
      }
      if (o.op === 'animate') {
        const pr = ANIMATION_PRESETS.find((x) => x.name === o.preset);
        if (!pr) e.push(err(index, name, 'invalid_param', `preset: ${ANIMATION_PRESETS.map((x) => x.name).join(', ')}.`));
        if (pr && o.preset !== 'fadeIn' && o.preset !== 'fadeOut' && c.kind === 'caption')
          e.push(err(index, name, 'invalid_param', 'Legendas só aceitam fadeIn/fadeOut.'));
        const dur = o.duration ?? 0.6;
        const start = o.start ?? 0;
        if (!isNum(dur) || dur <= 0 || dur > c.duration + EPS)
          e.push(err(index, name, 'out_of_range', `duration deve ficar entre 0 e ${c.duration.toFixed(3)}s.`));
        if (o.start !== undefined && (!isNum(start) || start < -EPS || start + dur > c.duration + EPS))
          e.push(err(index, name, 'out_of_range', `Intervalo deve caber no clipe (0 a ${c.duration.toFixed(3)}s).`));
        if (o.ease && !EASINGS.includes(o.ease)) e.push(err(index, name, 'invalid_param', `ease: ${EASINGS.join(', ')}.`));
      }
      break;
    }
    case 'updateTrack':
      if (!findTrack(p, o.trackId)) e.push(err(index, name, 'target_not_found', `Faixa "${o.trackId}" não existe.`));
      break;
    case 'renameProject':
      if (typeof o.name !== 'string' || !o.name.trim()) e.push(err(index, name, 'invalid_param', 'Nome vazio.'));
      break;
    case 'setCanvas':
      if (!isNum(o.width) || !isNum(o.height) || o.width < 16 || o.height < 16 || o.width > 3840 || o.height > 3840 || o.width % 2 || o.height % 2)
        e.push(err(index, name, 'out_of_range', 'Largura e altura pares, entre 16 e 3840.'));
      if (o.fps !== undefined && (!isNum(o.fps) || o.fps < 1 || o.fps > 120)) e.push(err(index, name, 'out_of_range', 'fps entre 1 e 120.'));
      break;
    default:
      e.push(err(index, name, 'unknown_op', `Operação desconhecida "${name}".`));
  }
  return e;
}

/** Transforma macros (animate) em operações primitivas e preenche ids. */
export function expandOp(p: Project, o: Op): Op[] {
  if (o.op === 'addClip' && !o.clip.id) {
    return [{ ...o, clip: { ...o.clip, id: newId(o.clip.kind === 'video' ? 'vid' : o.clip.kind === 'title' ? 'ttl' : 'cap') } }];
  }
  if (o.op === 'setKeyframe' && !o.keyframeId) {
    const c = findClip(p, o.clipId);
    const existing = c?.props[o.prop]?.keyframes.find((k) => Math.abs(k.t - o.t) < 1e-3);
    return [{ ...o, keyframeId: existing?.id ?? newId('kf') }];
  }
  if (o.op !== 'animate') return [o];
  const c = findClip(p, o.clipId)!;
  const pr = ANIMATION_PRESETS.find((x) => x.name === o.preset)!;
  const dur = Math.min(o.duration ?? (pr.kind === 'span' ? c.duration : 0.6), c.duration);
  const start = o.start ?? (pr.kind === 'out' ? c.duration - dur : 0);
  const end = start + dur;
  const group = o.group ?? (pr.kind === 'in' ? 'entrada' : pr.kind === 'out' ? 'saida' : o.preset);
  const easeIn: Easing = o.ease ?? 'easeOut';
  const easeOut: Easing = o.ease ?? 'easeIn';
  // Valor-base de cada propriedade, ignorando o próprio grupo (reaplicar é idempotente).
  const base = (prop: string, t: number) => {
    const ap = c.props[prop];
    const d = propDef(prop)!;
    if (!ap) return d.default;
    const others = ap.keyframes.filter((k) => k.group !== group);
    return others.length ? evalProp({ value: ap.value, keyframes: others }, t, d.default) : ap.value;
  };
  const off = 60;
  const ops: Op[] = [{ op: 'clearKeyframes', clipId: c.id, group }];
  const kf = (prop: string, t: number, v: number, ez: Easing) =>
    ops.push({ op: 'setKeyframe', clipId: c.id, prop, t: round(t), v: round(v), ease: ez, group, keyframeId: newId('kf') });
  const inOut = (prop: string, from: number, to: number) => {
    const ez = pr.kind === 'out' ? easeOut : easeIn;
    kf(prop, start, from, ez);
    kf(prop, end, to, 'linear');
  };
  const by = base('y', pr.kind === 'out' ? start : end);
  const bx = base('x', pr.kind === 'out' ? start : end);
  const bs = base('scale', pr.kind === 'out' ? start : end);
  const bo = base('opacity', pr.kind === 'out' ? start : end);
  switch (o.preset) {
    case 'fadeIn':
      inOut('opacity', 0, bo);
      break;
    case 'fadeOut':
      inOut('opacity', bo, 0);
      break;
    case 'slideUpIn':
      inOut('y', by + off, by);
      inOut('opacity', 0, bo);
      break;
    case 'slideDownIn':
      inOut('y', by - off, by);
      inOut('opacity', 0, bo);
      break;
    case 'slideLeftIn':
      inOut('x', bx + off * 2, bx);
      inOut('opacity', 0, bo);
      break;
    case 'slideRightIn':
      inOut('x', bx - off * 2, bx);
      inOut('opacity', 0, bo);
      break;
    case 'slideUpOut':
      inOut('y', by, by - off);
      inOut('opacity', bo, 0);
      break;
    case 'slideDownOut':
      inOut('y', by, by + off);
      inOut('opacity', bo, 0);
      break;
    case 'popIn':
      inOut('scale', bs * 0.6, bs);
      inOut('opacity', 0, bo);
      break;
    case 'popOut':
      inOut('scale', bs, bs * 0.6);
      inOut('opacity', bo, 0);
      break;
    case 'slowZoom':
      kf('scale', start, bs, 'linear');
      kf('scale', end, bs * 1.15, 'linear');
      break;
  }
  return ops;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function applyPrimitive(p: Project, o: Op): void {
  switch (o.op) {
    case 'addMedia':
      p.media.push({ ...o.media });
      return;
    case 'addClip': {
      const s = o.clip;
      const track = trackForKind(p, s.kind)!;
      const base = {
        id: s.id!,
        trackId: track.id,
        start: s.start ?? 0,
        props: defaultProps(s.kind),
      };
      let clip: Clip;
      if (s.kind === 'video') {
        const m = p.media.find((x) => x.id === s.mediaId)!;
        const inn = s.in ?? 0;
        clip = {
          ...base,
          kind: 'video',
          name: s.name ?? m.name,
          mediaId: m.id,
          in: inn,
          duration: s.duration ?? m.duration - inn,
          volume: 1,
          muted: false,
        } satisfies VideoClip;
      } else if (s.kind === 'title') {
        clip = {
          ...base,
          kind: 'title',
          name: s.name ?? 'Título',
          duration: s.duration ?? 3,
          text: s.text ?? 'Título',
          style: { ...defaultTitleStyle(), ...(s.style ?? {}) },
        } satisfies TitleClip;
      } else {
        const preset = s.preset ?? 'caixa';
        clip = {
          ...base,
          kind: 'caption',
          name: s.name ?? 'Legenda',
          duration: s.duration ?? 2,
          text: s.text ?? 'Nova legenda',
          preset,
          style: { ...captionStyleForPreset(preset), ...(s.style ?? {}) },
        } satisfies CaptionClip;
      }
      p.clips.push(clip);
      return;
    }
    case 'updateClip': {
      const c = findClip(p, o.clipId)!;
      const s = o.set;
      if (s.name !== undefined) c.name = s.name;
      if (s.start !== undefined) c.start = s.start;
      if (s.duration !== undefined) c.duration = s.duration;
      if (c.kind === 'video') {
        if (s.in !== undefined) c.in = s.in;
        if (s.volume !== undefined) c.volume = s.volume;
        if (s.muted !== undefined) c.muted = s.muted;
      } else {
        if (s.text !== undefined) c.text = s.text;
        if (c.kind === 'caption' && s.preset !== undefined) {
          c.preset = s.preset;
          c.style = captionStyleForPreset(s.preset);
        }
        if (s.style) c.style = { ...c.style, ...s.style };
      }
      return;
    }
    case 'removeClip':
      p.clips = p.clips.filter((c) => c.id !== o.clipId);
      return;
    case 'setProperty': {
      const c = findClip(p, o.clipId)!;
      const ap = (c.props[o.prop] ??= { value: propDef(o.prop)!.default, keyframes: [] });
      ap.value = o.value;
      return;
    }
    case 'setKeyframe': {
      const c = findClip(p, o.clipId)!;
      const ap = (c.props[o.prop] ??= { value: propDef(o.prop)!.default, keyframes: [] });
      const existing = ap.keyframes.find((k) => k.id === o.keyframeId);
      if (existing) {
        existing.t = o.t;
        existing.v = o.v;
        if (o.ease) existing.ease = o.ease;
        if (o.group !== undefined) existing.group = o.group || undefined;
      } else {
        // Um ponto por instante: substitui o que estiver no mesmo tempo.
        ap.keyframes = ap.keyframes.filter((k) => Math.abs(k.t - o.t) >= 1e-3);
        ap.keyframes.push({ id: o.keyframeId!, t: o.t, v: o.v, ease: o.ease ?? 'easeInOut', ...(o.group ? { group: o.group } : {}) });
      }
      ap.keyframes = sortedKeyframes(ap.keyframes);
      return;
    }
    case 'removeKeyframe': {
      const ap = findClip(p, o.clipId)!.props[o.prop];
      const removed = ap.keyframes.find((k) => k.id === o.keyframeId);
      ap.keyframes = ap.keyframes.filter((k) => k.id !== o.keyframeId);
      if (ap.keyframes.length === 0 && removed) ap.value = removed.v;
      return;
    }
    case 'clearKeyframes': {
      const c = findClip(p, o.clipId)!;
      for (const [name, ap] of Object.entries(c.props)) {
        if (o.prop && name !== o.prop) continue;
        const before = ap.keyframes;
        ap.keyframes = before.filter((k) => (o.group ? k.group !== o.group : false));
        if (ap.keyframes.length === 0 && before.length > 0) {
          // Mantém o valor "de repouso" que a animação removida tinha no fim.
          const last = sortedKeyframes(before);
          ap.value = o.group && /saida|out/i.test(o.group) ? last[0].v : last[last.length - 1].v;
        }
      }
      return;
    }
    case 'retimeGroup': {
      const c = findClip(p, o.clipId)!;
      let s0 = Infinity;
      let s1 = -Infinity;
      for (const ap of Object.values(c.props))
        for (const k of ap.keyframes) if (k.group === o.group) (s0 = Math.min(s0, k.t)), (s1 = Math.max(s1, k.t));
      const span = s1 - s0;
      for (const ap of Object.values(c.props)) {
        for (const k of ap.keyframes) {
          if (k.group !== o.group) continue;
          k.t = round(span > 0 ? o.start + ((k.t - s0) / span) * o.duration : o.start);
        }
        ap.keyframes = sortedKeyframes(ap.keyframes);
      }
      return;
    }
    case 'updateTrack': {
      const t = findTrack(p, o.trackId)!;
      if (o.set.hidden !== undefined) t.hidden = o.set.hidden;
      if (o.set.locked !== undefined) t.locked = o.set.locked;
      return;
    }
    case 'renameProject':
      p.name = o.name.trim();
      return;
    case 'setCanvas':
      p.settings = { width: o.width, height: o.height, fps: o.fps ?? p.settings.fps };
      return;
    case 'animate':
      throw new Error('animate deve ser expandida antes de aplicar');
  }
}

export interface ApplyResult {
  project: Project;
  /** Operações efetivamente aplicadas (macros expandidas, ids preenchidos). */
  applied: Op[];
}

/**
 * Valida e aplica uma lista de operações, em sequência, sobre uma cópia do
 * projeto. Não altera `project` nem a revisão. Lança OpValidationError.
 */
export function applyOps(project: Project, ops: Op[]): ApplyResult {
  const p: Project = structuredClone(project);
  const applied: Op[] = [];
  const errors: OpError[] = [];
  ops.forEach((o, i) => {
    if (errors.length) return;
    const v = validateOp(p, o, i);
    if (v.length) {
      errors.push(...v);
      return;
    }
    for (const prim of expandOp(p, o)) {
      const v2 = validateOp(p, prim, i);
      if (v2.length) {
        errors.push(...v2);
        return;
      }
      applyPrimitive(p, prim);
      applied.push(prim);
    }
  });
  if (errors.length) throw new OpValidationError(errors);
  return { project: p, applied };
}

/** Ids de clipes tocados por uma lista de operações. */
export function touchedClipIds(ops: Op[]): string[] {
  const ids = new Set<string>();
  for (const o of ops) {
    if ('clipId' in o) ids.add(o.clipId);
    if (o.op === 'addClip' && o.clip.id) ids.add(o.clip.id);
  }
  return [...ids];
}

/** Uma descrição curta, em português, de cada operação (para cartões e histórico). */
export function describeOp(o: Op): string {
  switch (o.op) {
    case 'addMedia':
      return `Importar ${o.media.name}`;
    case 'addClip':
      return o.clip.kind === 'video' ? 'Adicionar vídeo' : o.clip.kind === 'title' ? `Adicionar título "${o.clip.text ?? ''}"` : `Adicionar legenda "${o.clip.text ?? ''}"`;
    case 'updateClip':
      return 'Editar clipe';
    case 'removeClip':
      return 'Remover clipe';
    case 'setProperty':
      return `Definir ${propDef(o.prop)?.label ?? o.prop}`;
    case 'setKeyframe':
      return `Ponto de ${propDef(o.prop)?.label ?? o.prop} em ${o.t.toFixed(2)}s`;
    case 'removeKeyframe':
      return 'Remover ponto de animação';
    case 'clearKeyframes':
      return 'Limpar animação';
    case 'retimeGroup':
      return `Ajustar duração de "${o.group}"`;
    case 'updateTrack':
      return 'Editar faixa';
    case 'renameProject':
      return 'Renomear projeto';
    case 'setCanvas':
      return `Formato ${o.width}×${o.height}`;
    case 'animate':
      return `Animação ${ANIMATION_PRESETS.find((p) => p.name === o.preset)?.label ?? o.preset}`;
  }
}
