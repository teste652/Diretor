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
import { cutKeyframes, partitionKeyframes, remapKeyframes, sameGroup } from './keyframes';
import { defaultProps, evalProp, propDef, sortedKeyframes } from './properties';
import { EPS, MIN_DURATION, SAME_T, round } from './time';

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

/** Presets que valem para legendas (a legenda tem posição fixa). */
export const CAPTION_PRESETS: AnimationPreset[] = ['fadeIn', 'fadeOut'];

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

export type TrimEdge = 'start' | 'end';

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
  /**
   * Apara uma borda do clipe. `delta` é quanto a borda anda na linha do tempo
   * (positivo = para a direita). No vídeo, aparar o início mantém o clipe no
   * lugar e puxa os vídeos seguintes (sem buraco); a animação de entrada fica
   * no começo, a de saída no fim, e o resto acompanha o conteúdo.
   */
  | { op: 'trimClip'; clipId: string; edge: TrimEdge; delta: number; ripple?: boolean }
  /** Divide o clipe em `at` (segundos da linha do tempo): a parte da direita vira o clipe `newId`. */
  | { op: 'splitClip'; clipId: string; at: number; newId?: string }
  /** Move vários clipes de uma vez (`delta` em segundos); nenhum começa antes do zero. */
  | { op: 'shiftClips'; clipIds: string[]; delta: number }
  /** Tira o trecho [t0, t1] (segundos relativos ao início do clipe) de um título ou legenda. */
  | { op: 'cutTextTime'; clipId: string; t0: number; t1: number }
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

/** Operações que só a interface usa (o Claude não importa arquivos nem trava/esconde faixas). */
export const USER_ONLY_OPS: Op['op'][] = ['addMedia', 'updateTrack'];

export interface OpError {
  index: number;
  op: string;
  code: 'target_not_found' | 'invalid_param' | 'out_of_range' | 'locked' | 'unknown_op' | 'not_allowed';
  message: string;
}

export class OpValidationError extends Error {
  constructor(public errors: OpError[]) {
    super(errors.map((e) => `#${e.index} ${e.op}: ${e.message}`).join('; '));
  }
}

export { MIN_DURATION } from './time';
const MIN_GROUP_DURATION = 0.01;
const MAX_TEXT = 2000;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const CAPTION_PRESET_NAMES: CaptionPreset[] = ['padrao', 'caixa', 'destaque'];
const COLOR_RE = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(rgb|rgba|hsl|hsla)\([\d\s.,%+-]+\)|[a-z]{3,24})$/i;
const STYLE_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'color', 'background', 'align', 'shadow'];
const CHANGE_KEYS = ['name', 'start', 'duration', 'in', 'text', 'style', 'preset', 'volume', 'muted'];
const CLIP_SPEC_KEYS = ['kind', 'id', 'name', 'start', 'duration', 'text', 'mediaId', 'in', 'style', 'preset'];
/** Campos aceitos em cada operação (além de "op"): um campo com nome errado é recusado, não ignorado. */
const OP_KEYS: Record<Op['op'], string[]> = {
  addMedia: ['media'],
  addClip: ['clip'],
  updateClip: ['clipId', 'set'],
  removeClip: ['clipId'],
  setProperty: ['clipId', 'prop', 'value'],
  setKeyframe: ['clipId', 'prop', 't', 'v', 'ease', 'group', 'keyframeId'],
  removeKeyframe: ['clipId', 'prop', 'keyframeId'],
  clearKeyframes: ['clipId', 'prop', 'group'],
  retimeGroup: ['clipId', 'group', 'start', 'duration'],
  trimClip: ['clipId', 'edge', 'delta', 'ripple'],
  splitClip: ['clipId', 'at', 'newId'],
  shiftClips: ['clipIds', 'delta'],
  cutTextTime: ['clipId', 't0', 't1'],
  updateTrack: ['trackId', 'set'],
  renameProject: ['name'],
  setCanvas: ['width', 'height', 'fps'],
  animate: ['clipId', 'preset', 'start', 'duration', 'ease', 'group'],
};

function err(index: number, op: string, code: OpError['code'], message: string): OpError {
  return { index, op, code, message };
}

function trackLocked(p: Project, clip: Clip): boolean {
  return !!findTrack(p, clip.trackId)?.locked;
}

/** Intervalo de uma animação pronta, com os mesmos padrões na validação e na expansão. */
export function animateRange(
  c: Clip,
  o: { preset: AnimationPreset; start?: number; duration?: number },
): { start: number; duration: number; end: number; kind: 'in' | 'out' | 'span' } {
  const kind = ANIMATION_PRESETS.find((x) => x.name === o.preset)?.kind ?? 'in';
  const from = o.start ?? 0;
  const room = kind === 'out' && o.start === undefined ? c.duration : c.duration - from;
  const duration = o.duration ?? (kind === 'span' ? room : Math.min(0.6, room));
  const start = o.start ?? (kind === 'out' ? c.duration - duration : 0);
  return { start, duration, end: start + duration, kind };
}

function validateStyle(style: unknown, push: (code: OpError['code'], m: string) => void): void {
  if (style === undefined) return;
  if (!isObj(style)) return push('invalid_param', 'style deve ser um objeto.');
  for (const k of Object.keys(style)) if (!STYLE_KEYS.includes(k)) push('invalid_param', `style.${k} não existe (use ${STYLE_KEYS.join(', ')}).`);
  const s = style as Partial<Record<keyof TextStyle, unknown>>;
  if (s.fontFamily !== undefined && (!isStr(s.fontFamily) || !s.fontFamily.trim() || s.fontFamily.length > 200)) push('invalid_param', 'style.fontFamily deve ser um nome de fonte.');
  if (s.fontSize !== undefined && (!isNum(s.fontSize) || s.fontSize < 6 || s.fontSize > 400)) push('out_of_range', 'style.fontSize vai de 6 a 400.');
  if (s.fontWeight !== undefined && (!isNum(s.fontWeight) || s.fontWeight < 100 || s.fontWeight > 1000)) push('out_of_range', 'style.fontWeight vai de 100 a 1000.');
  if (s.color !== undefined && (!isStr(s.color) || !COLOR_RE.test(s.color.trim()))) push('invalid_param', 'style.color deve ser uma cor CSS (ex.: #ffffff).');
  if (s.background !== undefined && (!isStr(s.background) || (s.background !== '' && !COLOR_RE.test(s.background.trim()))))
    push('invalid_param', 'style.background deve ser uma cor CSS ou "" (sem caixa).');
  if (s.align !== undefined && !['left', 'center', 'right'].includes(s.align as string)) push('invalid_param', 'style.align: left, center ou right.');
  if (s.shadow !== undefined && typeof s.shadow !== 'boolean') push('invalid_param', 'style.shadow deve ser true ou false.');
}

/** Valida uma operação contra o estado atual. Lista vazia = ok. */
export function validateOp(p: Project, o: Op, index = 0): OpError[] {
  const e: OpError[] = [];
  const name = isObj(o) && isStr((o as { op?: unknown }).op) ? (o as { op: string }).op : '?';
  const push = (code: OpError['code'], message: string) => e.push(err(index, name, code, message));
  if (!isObj(o)) {
    push('invalid_param', 'Cada operação deve ser um objeto com "op".');
    return e;
  }
  const allowed = Object.prototype.hasOwnProperty.call(OP_KEYS, name) ? OP_KEYS[name as Op['op']] : undefined;
  const extra = allowed ? Object.keys(o).filter((k) => k !== 'op' && !allowed.includes(k)) : [];
  if (extra.length) {
    push('invalid_param', `Campo desconhecido em ${name}: ${extra.join(', ')} (aceitos: ${allowed!.join(', ')}).`);
    return e;
  }
  const need = (clipId: unknown): Clip | undefined => {
    if (!isStr(clipId) || !clipId) {
      push('invalid_param', 'clipId é obrigatório.');
      return undefined;
    }
    const c = findClip(p, clipId);
    if (!c) push('target_not_found', `Clipe "${clipId}" não existe nesta revisão.`);
    else if (trackLocked(p, c)) push('locked', `A faixa do clipe "${clipId}" está travada.`);
    return c;
  };
  const checkGroup = (g: unknown, required: boolean) => {
    if (g === undefined && !required) return;
    if (!isStr(g) || !g.trim() || g.length > 40) push('invalid_param', 'group deve ser um nome (texto não vazio, até 40 caracteres).');
  };
  const checkEase = (ez: unknown) => {
    if (ez !== undefined && !EASINGS.includes(ez as Easing)) push('invalid_param', `ease: ${EASINGS.join(', ')}.`);
  };
  switch (o.op) {
    case 'addMedia': {
      const m = o.media;
      if (!isObj(m) || !isStr(m.id) || !m.id || !isStr(m.path) || !m.path || !isNum(m.duration) || m.duration <= 0 || !isNum(m.width) || !isNum(m.height))
        push('invalid_param', 'Mídia precisa de id, caminho, duração e tamanho.');
      else if (p.media.some((x) => x.id === m.id)) push('invalid_param', `Mídia "${m.id}" já existe.`);
      break;
    }
    case 'addClip': {
      const c = o.clip as NewClipSpec | undefined;
      if (!isObj(c) || !['video', 'title', 'caption'].includes(c.kind as string)) {
        push('invalid_param', 'clip.kind deve ser video, title ou caption.');
        break;
      }
      const extraC = Object.keys(c).filter((k) => !CLIP_SPEC_KEYS.includes(k));
      if (extraC.length) {
        push('invalid_param', `Campo desconhecido em clip: ${extraC.join(', ')} (aceitos: ${CLIP_SPEC_KEYS.join(', ')}; o fim é start + duration).`);
        break;
      }
      if (c.id !== undefined && (!isStr(c.id) || !c.id.trim())) push('invalid_param', 'clip.id deve ser um texto.');
      else if (c.id && findClip(p, c.id)) push('invalid_param', `Já existe um clipe "${c.id}".`);
      if (c.name !== undefined && (!isStr(c.name) || c.name.length > 200)) push('invalid_param', 'name deve ser um texto.');
      if (c.start !== undefined && (!isNum(c.start) || c.start < 0)) push('out_of_range', 'start deve ser um número ≥ 0.');
      if (c.duration !== undefined && (!isNum(c.duration) || c.duration < MIN_DURATION)) push('out_of_range', `duration deve ser ≥ ${MIN_DURATION}s.`);
      const tr = trackForKind(p, c.kind);
      if (!tr) push('target_not_found', 'Não há faixa para esse tipo de clipe.');
      else if (tr.locked) push('locked', `A faixa "${tr.name}" está travada.`);
      if (c.kind === 'video') {
        if (c.text !== undefined || c.style !== undefined || c.preset !== undefined) push('invalid_param', 'text, style e preset não valem para vídeo.');
        const m = p.media.find((x) => x.id === c.mediaId);
        if (!m) push('target_not_found', `Mídia "${String(c.mediaId)}" não existe.`);
        else {
          const inn = c.in ?? 0;
          if (!isNum(inn) || inn < 0 || inn > m.duration - MIN_DURATION) push('out_of_range', `in deve ficar entre 0 e ${(m.duration - MIN_DURATION).toFixed(2)}s.`);
          else {
            const dur = c.duration ?? m.duration - inn;
            if (inn + dur > m.duration + 0.05) push('out_of_range', `Trecho além do arquivo (duração ${m.duration.toFixed(2)}s).`);
          }
        }
      } else {
        if (c.in !== undefined || c.mediaId !== undefined) push('invalid_param', 'in e mediaId só valem para vídeo.');
        if (c.text !== undefined && (!isStr(c.text) || c.text.length > MAX_TEXT)) push('invalid_param', `text deve ser um texto (até ${MAX_TEXT} caracteres).`);
        validateStyle(c.style, push);
        if (c.preset !== undefined && (c.kind !== 'caption' || !CAPTION_PRESET_NAMES.includes(c.preset)))
          push('invalid_param', 'preset só vale para legenda: padrao, caixa ou destaque.');
      }
      break;
    }
    case 'updateClip': {
      const c = need(o.clipId);
      if (!c) break;
      if (!isObj(o.set)) {
        push('invalid_param', 'set deve ser um objeto com os campos a mudar.');
        break;
      }
      const s = o.set as Record<string, unknown>;
      for (const k of Object.keys(s)) {
        if (!CHANGE_KEYS.includes(k)) push('invalid_param', `Campo desconhecido: ${k}.`);
        else if (s[k] === null) push('invalid_param', `${k} não pode ser null (omita o campo para não mudar).`);
      }
      if (e.length) break;
      const ch = o.set;
      if (ch.name !== undefined && (!isStr(ch.name) || ch.name.length > 200)) push('invalid_param', 'name deve ser um texto.');
      const start = ch.start ?? c.start;
      const dur = ch.duration ?? c.duration;
      if (!isNum(start) || start < 0) push('out_of_range', 'start deve ser um número ≥ 0.');
      if (!isNum(dur) || dur < MIN_DURATION) push('out_of_range', `duration deve ser ≥ ${MIN_DURATION}s.`);
      if (c.kind === 'video') {
        if (ch.text !== undefined || ch.style !== undefined || ch.preset !== undefined) push('invalid_param', 'text, style e preset não valem para vídeo.');
        const m = p.media.find((x) => x.id === c.mediaId);
        const inn = ch.in ?? c.in;
        if (!isNum(inn) || inn < 0) push('out_of_range', 'in deve ser um número ≥ 0.');
        else if (m && isNum(dur) && inn + dur > m.duration + 0.05) push('out_of_range', `Trecho além do arquivo (duração ${m.duration.toFixed(2)}s).`);
        if (ch.volume !== undefined && (!isNum(ch.volume) || ch.volume < 0 || ch.volume > 1)) push('out_of_range', 'volume vai de 0 a 1.');
        if (ch.muted !== undefined && typeof ch.muted !== 'boolean') push('invalid_param', 'muted deve ser true ou false.');
      } else {
        if (ch.in !== undefined || ch.volume !== undefined || ch.muted !== undefined) push('invalid_param', 'in, volume e muted só valem para vídeo.');
        if (ch.text !== undefined && (!isStr(ch.text) || ch.text.length > MAX_TEXT)) push('invalid_param', `text deve ser um texto (até ${MAX_TEXT} caracteres).`);
        validateStyle(ch.style, push);
        if (ch.preset !== undefined && (c.kind !== 'caption' || !CAPTION_PRESET_NAMES.includes(ch.preset)))
          push('invalid_param', 'preset só vale para legenda: padrao, caixa ou destaque.');
      }
      break;
    }
    case 'removeClip':
      need(o.clipId);
      break;
    case 'trimClip': {
      const c = need(o.clipId);
      if (!c) break;
      if (o.edge !== 'start' && o.edge !== 'end') {
        push('invalid_param', 'edge: start ou end.');
        break;
      }
      if (!isNum(o.delta)) {
        push('invalid_param', 'delta deve ser um número (segundos).');
        break;
      }
      if (o.ripple !== undefined && typeof o.ripple !== 'boolean') push('invalid_param', 'ripple deve ser true ou false.');
      const lim = trimLimits(p, c, o.edge);
      if (o.delta < lim.min - EPS || o.delta > lim.max + EPS)
        push('out_of_range', `Para aparar ${o.edge === 'start' ? 'o início' : 'o fim'}, delta vai de ${lim.min.toFixed(3)} a ${lim.max.toFixed(3)}s.`);
      break;
    }
    case 'splitClip': {
      const c = need(o.clipId);
      if (!c) break;
      if (!isNum(o.at)) push('invalid_param', 'at deve ser um número (segundos da linha do tempo).');
      else {
        const lo = c.start + MIN_DURATION;
        const hi = c.start + c.duration - MIN_DURATION;
        const at = round(o.at);
        if (at < lo - EPS || at > hi + EPS)
          push('out_of_range', `Para dividir, at fica entre ${lo.toFixed(3)} e ${hi.toFixed(3)}s (pelo menos ${MIN_DURATION}s de cada lado).`);
      }
      if (o.newId !== undefined && (!isStr(o.newId) || !o.newId.trim())) push('invalid_param', 'newId deve ser um texto.');
      else if (o.newId && findClip(p, o.newId)) push('invalid_param', `Já existe um clipe "${o.newId}".`);
      break;
    }
    case 'shiftClips': {
      const ids = o.clipIds;
      if (!Array.isArray(ids) || !ids.length || ids.some((id) => !isStr(id) || !id)) {
        push('invalid_param', 'clipIds deve ser uma lista de ids.');
        break;
      }
      if (new Set(ids).size < ids.length) {
        push('invalid_param', 'clipIds tem ids repetidos.');
        break;
      }
      if (!isNum(o.delta)) {
        push('invalid_param', 'delta deve ser um número (segundos).');
        break;
      }
      for (const id of ids) {
        const c = need(id);
        if (c && c.start + o.delta < -EPS) push('out_of_range', `O clipe "${id}" começaria antes do zero.`);
      }
      break;
    }
    case 'cutTextTime': {
      const c = need(o.clipId);
      if (!c) break;
      if (c.kind === 'video') {
        push('invalid_param', 'cutTextTime vale só para título e legenda.');
        break;
      }
      if (!isNum(o.t0) || !isNum(o.t1) || o.t0 < -EPS || o.t1 > c.duration + EPS || o.t1 - o.t0 <= EPS) {
        push('out_of_range', `t0 e t1 (relativos ao clipe) ficam entre 0 e ${c.duration.toFixed(3)}s, com t0 < t1.`);
        break;
      }
      if (c.duration - round(o.t1 - o.t0) < MIN_DURATION - EPS) push('out_of_range', `O texto ficaria com menos de ${MIN_DURATION}s; remova o clipe.`);
      break;
    }
    case 'setProperty':
    case 'setKeyframe':
    case 'removeKeyframe':
    case 'clearKeyframes':
    case 'retimeGroup':
    case 'animate': {
      const c = need(o.clipId);
      if (!c) break;
      const needsProp = o.op === 'setProperty' || o.op === 'setKeyframe' || o.op === 'removeKeyframe';
      const prop = 'prop' in o ? o.prop : undefined;
      if (prop === undefined && needsProp) {
        push('invalid_param', 'prop é obrigatório (x, y, scale ou opacity).');
        break;
      }
      if (prop !== undefined) {
        const d = isStr(prop) ? propDef(prop) : undefined;
        if (!d || !d.kinds.includes(c.kind)) {
          push('invalid_param', `Propriedade "${String(prop)}" não existe para ${c.kind}.`);
          break;
        }
        if (o.op === 'setProperty' || o.op === 'setKeyframe') {
          const val = o.op === 'setProperty' ? o.value : o.v;
          const field = o.op === 'setProperty' ? 'value' : 'v';
          if (!isNum(val)) push('invalid_param', `${field} deve ser um número.`);
          else if (val < d.min - EPS || val > d.max + EPS) push('out_of_range', `${d.label} vai de ${d.min} a ${d.max}.`);
        }
        if (o.op === 'setProperty' && c.props[d.name]?.keyframes.length)
          push('invalid_param', `${d.label} tem pontos de animação: use setKeyframe para mudar um ponto, ou clearKeyframes antes de fixar um valor.`);
      }
      if (o.op === 'setKeyframe') {
        const existing = isStr(o.keyframeId) ? c.props[o.prop]?.keyframes.find((k) => k.id === o.keyframeId) : undefined;
        // Um ponto que já existe pode ter valor/suavização editados sem mexer no tempo.
        const unchangedT = !!existing && isNum(o.t) && Math.abs(existing.t - o.t) < EPS;
        if (!isNum(o.t) || (!unchangedT && (o.t < -EPS || o.t > c.duration + EPS)))
          push('out_of_range', `t (relativo ao clipe) deve ficar entre 0 e ${c.duration.toFixed(3)}s.`);
        if (o.keyframeId !== undefined && (!isStr(o.keyframeId) || !o.keyframeId)) push('invalid_param', 'keyframeId deve ser um texto.');
        checkEase(o.ease);
        checkGroup(o.group, false);
      }
      if (o.op === 'removeKeyframe' && !c.props[o.prop]?.keyframes.some((k) => k.id === o.keyframeId))
        push('target_not_found', `Ponto "${String(o.keyframeId)}" não existe.`);
      if (o.op === 'clearKeyframes') checkGroup(o.group, false);
      if (o.op === 'retimeGroup') {
        checkGroup(o.group, true);
        const has = Object.values(c.props).some((pp) => pp.keyframes.some((k) => k.group === o.group));
        if (isStr(o.group) && o.group && !has) push('target_not_found', `Grupo de animação "${o.group}" não existe.`);
        if (!isNum(o.start) || !isNum(o.duration) || o.start < -EPS || o.duration < MIN_GROUP_DURATION || o.start + o.duration > c.duration + EPS)
          push('out_of_range', `Intervalo deve caber no clipe (0 a ${c.duration.toFixed(3)}s) e durar pelo menos ${MIN_GROUP_DURATION}s.`);
      }
      if (o.op === 'animate') {
        const pr = ANIMATION_PRESETS.find((x) => x.name === o.preset);
        if (!pr) {
          push('invalid_param', `preset: ${ANIMATION_PRESETS.map((x) => x.name).join(', ')}.`);
          break;
        }
        if (c.kind === 'caption' && !CAPTION_PRESETS.includes(o.preset)) push('invalid_param', 'Legendas só aceitam fadeIn/fadeOut.');
        if (o.start !== undefined && (!isNum(o.start) || o.start < -EPS)) push('out_of_range', 'start deve ser um número ≥ 0.');
        if (o.duration !== undefined && (!isNum(o.duration) || o.duration <= 0)) push('out_of_range', 'duration deve ser > 0.');
        if (!e.length) {
          const r = animateRange(c, o);
          if (r.duration <= 0 || r.start < -EPS || r.end > c.duration + EPS)
            push('out_of_range', `A animação precisa caber no clipe (0 a ${c.duration.toFixed(3)}s).`);
        }
        checkEase(o.ease);
        checkGroup(o.group, false);
      }
      break;
    }
    case 'updateTrack':
      if (!findTrack(p, o.trackId)) push('target_not_found', `Faixa "${String(o.trackId)}" não existe.`);
      else if (!isObj(o.set)) push('invalid_param', 'set deve ser um objeto.');
      else if (Object.keys(o.set).some((k) => k !== 'hidden' && k !== 'locked')) push('invalid_param', 'set da faixa aceita só hidden e locked.');
      else if ((o.set.hidden !== undefined && typeof o.set.hidden !== 'boolean') || (o.set.locked !== undefined && typeof o.set.locked !== 'boolean'))
        push('invalid_param', 'hidden e locked devem ser true ou false.');
      break;
    case 'renameProject':
      if (!isStr(o.name) || !o.name.trim() || o.name.length > 200) push('invalid_param', 'Nome vazio.');
      break;
    case 'setCanvas':
      if (!isNum(o.width) || !isNum(o.height) || o.width < 16 || o.height < 16 || o.width > 3840 || o.height > 3840 || o.width % 2 || o.height % 2)
        push('out_of_range', 'Largura e altura pares, entre 16 e 3840.');
      if (o.fps !== undefined && (!isNum(o.fps) || o.fps < 1 || o.fps > 120)) push('out_of_range', 'fps entre 1 e 120.');
      break;
    default:
      push('unknown_op', `Operação desconhecida "${name}".`);
  }
  return e;
}

/** Quanto cada borda pode andar (segundos), respeitando o arquivo e a duração mínima. */
export function trimLimits(p: Project, c: Clip, edge: TrimEdge): { min: number; max: number } {
  const room = c.duration - MIN_DURATION;
  if (c.kind === 'video') {
    const m = p.media.find((x) => x.id === c.mediaId);
    const mediaDur = m?.duration ?? c.in + c.duration;
    if (edge === 'start') return { min: -c.in, max: room };
    return { min: -room, max: Math.max(0, mediaDur - (c.in + c.duration)) };
  }
  if (edge === 'start') return { min: -c.start, max: room };
  return { min: -room, max: 3600 };
}

/** Limita o deslocamento de uma borda ao permitido (arrastes na linha do tempo). */
export function clampTrimDelta(p: Project, c: Clip, edge: TrimEdge, delta: number): number {
  const lim = trimLimits(p, c, edge);
  const d = Math.min(lim.max, Math.max(lim.min, delta));
  // Arredonda para dentro do limite (nunca para fora).
  const r = round(d);
  const out = r > lim.max ? Math.floor(d * 1000) / 1000 : r < lim.min ? Math.ceil(d * 1000) / 1000 : r;
  return out + 0; // sem -0
}

/** Transforma macros (animate) em operações primitivas e preenche ids. */
export function expandOp(p: Project, o: Op): Op[] {
  if (o.op === 'addClip' && !o.clip.id) {
    return [{ ...o, clip: { ...o.clip, id: newId(o.clip.kind === 'video' ? 'vid' : o.clip.kind === 'title' ? 'ttl' : 'cap') } }];
  }
  if (o.op === 'splitClip' && !o.newId) {
    const kind = findClip(p, o.clipId)!.kind;
    return [{ ...o, newId: newId(kind === 'video' ? 'vid' : kind === 'title' ? 'ttl' : 'cap') }];
  }
  if (o.op === 'setKeyframe' && !o.keyframeId) {
    // Edita o ponto que já está nesse instante (do mesmo grupo, se o grupo foi informado).
    const c = findClip(p, o.clipId);
    const near = (c?.props[o.prop]?.keyframes ?? []).filter((k) => Math.abs(k.t - o.t) < SAME_T && (o.group === undefined || sameGroup(k.group, o.group)));
    const existing = near[near.length - 1];
    return [{ ...o, keyframeId: existing?.id ?? newId('kf') }];
  }
  if (o.op === 'trimClip') {
    const c = findClip(p, o.clipId)!;
    if (o.ripple === false || c.kind !== 'video') return [{ ...o, ripple: false }];
    // Vídeo: a borda que mexe no fim do clipe empurra/puxa os vídeos seguintes da faixa.
    const endShift = o.edge === 'start' ? -o.delta : o.delta;
    const oldEnd = c.start + c.duration;
    const ripple: Op[] = p.clips
      .filter((x) => x.id !== c.id && x.trackId === c.trackId && x.start >= oldEnd - 1e-3 && Math.abs(endShift) > EPS)
      .map((x) => ({ op: 'updateClip', clipId: x.id, set: { start: round(Math.max(0, x.start + endShift)) } }));
    return [{ ...o, ripple: false }, ...ripple];
  }
  if (o.op !== 'animate') return [o];
  const c = findClip(p, o.clipId)!;
  const pr = ANIMATION_PRESETS.find((x) => x.name === o.preset)!;
  const { start, end, kind } = animateRange(c, o);
  const group = o.group ?? (kind === 'in' ? 'entrada' : kind === 'out' ? 'saida' : o.preset);
  const easeIn: Easing = o.ease ?? 'easeOut';
  const easeOut: Easing = o.ease ?? 'easeIn';
  /**
   * Valor-base de cada propriedade, sem o próprio grupo (reaplicar é idempotente).
   * Entrada: o valor onde ela termina; saída: onde ela começa; zoom do clipe
   * inteiro: o valor de repouso (sem entrada/saída).
   */
  const base = (prop: string) => {
    const ap = c.props[prop];
    const d = propDef(prop)!;
    if (!ap) return d.default;
    const others = ap.keyframes.filter((k) => (kind === 'span' ? k.group === undefined : k.group !== group));
    const at = kind === 'in' ? end : start;
    return others.length ? evalProp({ value: ap.value, keyframes: others }, at, d.default) : ap.value;
  };
  const off = 60;
  const ops: Op[] = [{ op: 'clearKeyframes', clipId: c.id, group }];
  const clampT = (t: number) => Math.min(c.duration, Math.max(0, round(t)));
  const kf = (prop: string, t: number, v: number, ez: Easing) => {
    const d = propDef(prop)!;
    ops.push({ op: 'setKeyframe', clipId: c.id, prop, t: clampT(t), v: Math.min(d.max, Math.max(d.min, round(v))), ease: ez, group, keyframeId: newId('kf') });
  };
  const inOut = (prop: string, from: number, to: number) => {
    const ez = pr.kind === 'out' ? easeOut : easeIn;
    kf(prop, start, from, ez);
    kf(prop, end, to, 'linear');
  };
  const by = base('y');
  const bx = base('x');
  const bs = base('scale');
  const bo = base('opacity');
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
      const newDur = s.duration ?? c.duration;
      const shift = c.kind === 'video' && s.in !== undefined ? -(s.in - c.in) : 0;
      remapKeyframes(c, newDur, shift);
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
    case 'trimClip': {
      const c = findClip(p, o.clipId)!;
      const d = o.delta;
      if (o.edge === 'end') {
        const nd = round(c.duration + d);
        remapKeyframes(c, nd, 0);
        c.duration = nd;
        return;
      }
      // Início: o conteúdo anda -d dentro do clipe. O vídeo fica no lugar (sem
      // buraco no começo); o texto mantém o fim no lugar.
      const nd = round(c.duration - d);
      remapKeyframes(c, nd, -d);
      c.duration = nd;
      if (c.kind === 'video') c.in = round(c.in + d);
      else c.start = round(c.start + d);
      return;
    }
    case 'splitClip': {
      const i = p.clips.findIndex((x) => x.id === o.clipId);
      const c = p.clips[i];
      const L = round(round(o.at) - c.start);
      const R = round(c.duration - L);
      const { left, right } = partitionKeyframes(c, L);
      // Clone inteiro: todos os campos do clipe (inclusive os que vierem depois) passam às duas partes.
      const piece = structuredClone(c);
      piece.id = o.newId!;
      piece.start = round(c.start + L);
      piece.duration = R;
      piece.props = right;
      // in = c.in + L, sem arredondar: o arquivo continua exatamente onde o original para.
      if (piece.kind === 'video') piece.in += L;
      c.duration = L;
      c.props = left;
      p.clips.splice(i + 1, 0, piece);
      return;
    }
    case 'shiftClips': {
      const ids = new Set(o.clipIds);
      for (const c of p.clips) if (ids.has(c.id)) c.start = Math.max(0, round(c.start + o.delta));
      return;
    }
    case 'cutTextTime': {
      const c = findClip(p, o.clipId)!;
      c.props = cutKeyframes(c, o.t0, o.t1);
      c.duration = round(c.duration - round(o.t1 - o.t0));
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
        if (o.group !== undefined) existing.group = o.group;
        // Arrastar um ponto para cima de outro do mesmo grupo junta os dois.
        ap.keyframes = ap.keyframes.filter((k) => k === existing || !(Math.abs(k.t - o.t) < SAME_T && sameGroup(k.group, existing.group)));
      } else {
        // Um ponto por instante em cada grupo: substitui o do mesmo grupo nesse tempo.
        ap.keyframes = ap.keyframes.filter((k) => !(Math.abs(k.t - o.t) < SAME_T && sameGroup(k.group, o.group)));
        ap.keyframes.push({ id: o.keyframeId!, t: o.t, v: o.v, ease: o.ease ?? 'easeInOut', ...(o.group ? { group: o.group } : {}) });
      }
      ap.keyframes = sortedKeyframes(ap.keyframes);
      return;
    }
    case 'removeKeyframe': {
      const ap = findClip(p, o.clipId)!.props[o.prop];
      const removed = ap.keyframes.find((k) => k.id === o.keyframeId);
      ap.keyframes = sortedKeyframes(ap.keyframes.filter((k) => k.id !== o.keyframeId));
      // Ponto feito à mão: o valor que ele tinha passa a ser o valor fixo. Pontos
      // de animação pronta (com grupo) não mexem no valor de repouso.
      if (ap.keyframes.length === 0 && removed && !removed.group) ap.value = removed.v;
      return;
    }
    case 'clearKeyframes': {
      // O valor fixo (repouso) não muda: é a base que as animações prontas usam.
      const c = findClip(p, o.clipId)!;
      for (const [name, ap] of Object.entries(c.props)) {
        if (o.prop && name !== o.prop) continue;
        ap.keyframes = sortedKeyframes(ap.keyframes.filter((k) => (o.group ? k.group !== o.group : false)));
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
          k.t = Math.min(c.duration, round(span > 0 ? o.start + ((k.t - s0) / span) * o.duration : o.start));
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
  if (!Array.isArray(ops)) throw new OpValidationError([err(0, '?', 'invalid_param', 'ops deve ser uma lista de operações.')]);
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
    if (o.op === 'splitClip' && o.newId) ids.add(o.newId);
    if (o.op === 'shiftClips') for (const id of o.clipIds) ids.add(id);
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
    case 'trimClip':
      return o.edge === 'start' ? 'Aparar início' : 'Aparar fim';
    case 'splitClip':
      return 'Dividir clipe';
    case 'shiftClips':
      return 'Mover clipes';
    case 'cutTextTime':
      return 'Encurtar texto';
    case 'removeClip':
      return 'Remover clipe';
    case 'setProperty':
      return `Definir ${propDef(o.prop)?.label ?? o.prop}`;
    case 'setKeyframe':
      return `Ponto de ${propDef(o.prop)?.label ?? o.prop} em ${Number(o.t).toFixed(2)}s`;
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
    default:
      return 'Edição';
  }
}
