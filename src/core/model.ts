// Modelo de dados do projeto. Tudo aqui é JSON puro: é o que vai para o arquivo
// .diretor.json, para o histórico de desfazer e (resumido) para o Claude.

import { sortedKeyframes } from './properties';

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';
export const EASINGS: Easing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'];

/** Ponto de animação. `t` é em segundos, relativo ao início do clipe. */
export interface Keyframe {
  id: string;
  t: number;
  v: number;
  /** Suavização do trecho que vai deste ponto até o próximo. */
  ease: Easing;
  /** Agrupa pontos de uma mesma animação (ex.: "entrada", "saida"). */
  group?: string;
}

/** Propriedade animável: valor fixo ou pontos de animação. */
export interface AnimProp {
  value: number;
  keyframes: Keyframe[];
}

export type ClipKind = 'video' | 'title' | 'caption';
export type TrackKind = 'video' | 'text' | 'captions';

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  /** Cor da caixa atrás do texto; vazio = sem caixa. */
  background: string;
  align: 'left' | 'center' | 'right';
  shadow: boolean;
}

export type CaptionPreset = 'padrao' | 'caixa' | 'destaque';

interface ClipBase {
  id: string;
  kind: ClipKind;
  trackId: string;
  name: string;
  /** Início na linha do tempo (s). */
  start: number;
  /** Duração na linha do tempo (s). */
  duration: number;
  /** Propriedades animáveis, por nome (ver properties.ts). */
  props: Record<string, AnimProp>;
}

export interface VideoClip extends ClipBase {
  kind: 'video';
  mediaId: string;
  /** Ponto de entrada no arquivo original (s): o "aparar início". */
  in: number;
  volume: number;
  muted: boolean;
}

export interface TitleClip extends ClipBase {
  kind: 'title';
  text: string;
  style: TextStyle;
}

export interface CaptionClip extends ClipBase {
  kind: 'caption';
  text: string;
  preset: CaptionPreset;
  style: TextStyle;
}

export type Clip = VideoClip | TitleClip | CaptionClip;

export interface MediaItem {
  id: string;
  /** Caminho absoluto do arquivo original. O original nunca é alterado. */
  path: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  hidden: boolean;
  locked: boolean;
}

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
}

export interface Project {
  schema: 'diretor.project';
  version: 1;
  id: string;
  name: string;
  /** Aumenta a cada mudança gravada (manual ou aprovada). */
  revision: number;
  settings: ProjectSettings;
  media: MediaItem[];
  /** Ordem de desenho: do fundo (índice 0) para a frente. */
  tracks: Track[];
  clips: Clip[];
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

export function createProject(name = 'Sem título'): Project {
  return {
    schema: 'diretor.project',
    version: 1,
    id: newId('prj'),
    name,
    revision: 0,
    settings: { width: 1280, height: 720, fps: 30 },
    media: [],
    tracks: [
      { id: 'trk_video', kind: 'video', name: 'Vídeo', hidden: false, locked: false },
      { id: 'trk_text', kind: 'text', name: 'Texto', hidden: false, locked: false },
      { id: 'trk_captions', kind: 'captions', name: 'Legendas', hidden: false, locked: false },
    ],
    clips: [],
  };
}

export function projectDuration(p: Project): number {
  let end = 0;
  for (const c of p.clips) end = Math.max(end, c.start + c.duration);
  return end;
}

export function findClip(p: Project, id: string): Clip | undefined {
  return p.clips.find((c) => c.id === id);
}

export function findTrack(p: Project, id: string): Track | undefined {
  return p.tracks.find((t) => t.id === id);
}

export function trackForKind(p: Project, kind: ClipKind): Track | undefined {
  const tk: TrackKind = kind === 'video' ? 'video' : kind === 'title' ? 'text' : 'captions';
  return p.tracks.find((t) => t.kind === tk);
}

export function defaultTitleStyle(): TextStyle {
  return {
    fontFamily: 'Segoe UI, Inter, Arial, sans-serif',
    fontSize: 72,
    fontWeight: 800,
    color: '#ffffff',
    background: '',
    align: 'center',
    shadow: true,
  };
}

export function captionStyleForPreset(preset: CaptionPreset): TextStyle {
  const base: TextStyle = {
    fontFamily: 'Segoe UI, Inter, Arial, sans-serif',
    fontSize: 34,
    fontWeight: 600,
    color: '#ffffff',
    background: 'rgba(0,0,0,0.55)',
    align: 'center',
    shadow: false,
  };
  if (preset === 'padrao') return { ...base, background: '', shadow: true };
  if (preset === 'destaque') return { ...base, color: '#0b1d2b', background: '#bfe3ff', fontWeight: 700 };
  return base;
}

const PROP_NAMES: Record<ClipKind, string[]> = {
  video: ['x', 'y', 'scale', 'opacity'],
  title: ['x', 'y', 'scale', 'opacity'],
  caption: ['opacity'],
};
const PROP_DEFAULT: Record<string, number> = { x: 0, y: 0, scale: 1, opacity: 1 };

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);

function normalizeStyle(raw: unknown, base: TextStyle): TextStyle {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof TextStyle, unknown>>;
  const align = s.align === 'left' || s.align === 'right' || s.align === 'center' ? s.align : base.align;
  return {
    fontFamily: str(s.fontFamily, base.fontFamily) || base.fontFamily,
    fontSize: Math.min(400, Math.max(6, num(s.fontSize, base.fontSize))),
    fontWeight: Math.min(1000, Math.max(100, num(s.fontWeight, base.fontWeight))),
    color: str(s.color, base.color) || base.color,
    background: str(s.background, base.background),
    align,
    shadow: typeof s.shadow === 'boolean' ? s.shadow : base.shadow,
  };
}

/**
 * Valida e normaliza um projeto lido do disco: estrutura quebrada vira um erro
 * claro (em vez de travar a prévia depois); detalhes faltando recebem o padrão.
 */
export function parseProject(json: unknown): Project {
  const p = json as Record<string, any>;
  if (!p || typeof p !== 'object' || p.schema !== 'diretor.project' || p.version !== 1) {
    throw new Error('Arquivo não é um projeto do Diretor (versão 1).');
  }
  if (!Array.isArray(p.clips) || !Array.isArray(p.tracks) || !Array.isArray(p.media)) {
    throw new Error('Projeto corrompido: faltam faixas, clipes ou mídias.');
  }
  const bad = (m: string): never => {
    throw new Error(`Projeto corrompido: ${m}`);
  };
  const st = p.settings ?? {};
  const settings: ProjectSettings = { width: num(st.width, 0), height: num(st.height, 0), fps: num(st.fps, 0) };
  if (settings.width < 16 || settings.height < 16 || settings.width > 3840 || settings.height > 3840 || settings.fps < 1 || settings.fps > 120)
    bad('formato do vídeo (largura, altura ou fps) inválido.');

  const media: MediaItem[] = p.media.map((m: any, i: number) => {
    if (!m || typeof m.id !== 'string' || typeof m.path !== 'string' || !(num(m.duration, 0) > 0)) bad(`mídia ${i + 1} sem id, caminho ou duração.`);
    return {
      id: m.id,
      path: m.path,
      name: str(m.name, m.path.split(/[\\/]/).pop() ?? m.path),
      duration: m.duration,
      width: num(m.width, 0),
      height: num(m.height, 0),
      hasAudio: m.hasAudio === true,
    };
  });

  const tracks: Track[] = p.tracks
    .filter((t: any) => t && typeof t.id === 'string' && ['video', 'text', 'captions'].includes(t.kind))
    .map((t: any) => ({ id: t.id, kind: t.kind, name: str(t.name, t.kind), hidden: t.hidden === true, locked: t.locked === true }));
  for (const def of createProject().tracks) if (!tracks.some((t) => t.kind === def.kind)) tracks.push(def);

  const ids = new Set<string>();
  const clips: Clip[] = p.clips.map((c: any, i: number) => {
    if (!c || typeof c.id !== 'string' || !['video', 'title', 'caption'].includes(c.kind)) bad(`clipe ${i + 1} sem id ou tipo.`);
    if (ids.has(c.id)) bad(`clipe "${c.id}" repetido.`);
    ids.add(c.id);
    const kind = c.kind as ClipKind;
    const start = num(c.start, -1);
    const duration = num(c.duration, 0);
    if (start < 0 || duration <= 0) bad(`clipe "${c.id}" com início ou duração inválidos.`);
    const tk: TrackKind = kind === 'video' ? 'video' : kind === 'title' ? 'text' : 'captions';
    const track = tracks.find((t) => t.id === c.trackId && t.kind === tk) ?? tracks.find((t) => t.kind === tk)!;
    const props: Record<string, AnimProp> = {};
    for (const name of PROP_NAMES[kind]) {
      const ap = c.props?.[name];
      const keyframes: Keyframe[] = Array.isArray(ap?.keyframes)
        ? ap.keyframes
            .filter((k: any) => k && typeof k.id === 'string' && Number.isFinite(k.t) && Number.isFinite(k.v))
            .map((k: any) => ({
              id: k.id,
              t: k.t,
              v: k.v,
              ease: EASINGS.includes(k.ease) ? k.ease : 'linear',
              ...(typeof k.group === 'string' && k.group ? { group: k.group } : {}),
            }))
        : [];
      props[name] = { value: num(ap?.value, PROP_DEFAULT[name]), keyframes: sortedKeyframes(keyframes) };
    }
    const base = { id: c.id, trackId: track.id, name: str(c.name, ''), start, duration, props };
    if (kind === 'video') {
      if (!media.some((m) => m.id === c.mediaId)) bad(`o vídeo "${c.id}" aponta para uma mídia que não está no projeto.`);
      return { ...base, kind, mediaId: c.mediaId, in: Math.max(0, num(c.in, 0)), volume: Math.min(1, Math.max(0, num(c.volume, 1))), muted: c.muted === true } satisfies VideoClip;
    }
    const text = str(c.text, '');
    if (kind === 'title') return { ...base, kind, text, style: normalizeStyle(c.style, defaultTitleStyle()) } satisfies TitleClip;
    const preset: CaptionPreset = ['padrao', 'caixa', 'destaque'].includes(c.preset) ? c.preset : 'caixa';
    return { ...base, kind, text, preset, style: normalizeStyle(c.style, captionStyleForPreset(preset)) } satisfies CaptionClip;
  });

  return {
    schema: 'diretor.project',
    version: 1,
    id: str(p.id, newId('prj')) || newId('prj'),
    name: str(p.name, 'Sem título') || 'Sem título',
    revision: Math.max(0, Math.floor(num(p.revision, 0))),
    settings,
    media,
    tracks,
    clips,
  };
}
