// Modelo de dados do projeto. Tudo aqui é JSON puro: é o que vai para o arquivo
// .diretor.json, para o histórico de desfazer e (resumido) para o Claude.

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

/** Valida e normaliza um projeto lido do disco. */
export function parseProject(json: unknown): Project {
  const p = json as Project;
  if (!p || p.schema !== 'diretor.project' || p.version !== 1) {
    throw new Error('Arquivo não é um projeto do Diretor (versão 1).');
  }
  if (!Array.isArray(p.clips) || !Array.isArray(p.tracks) || !Array.isArray(p.media)) {
    throw new Error('Projeto corrompido: faltam faixas, clipes ou mídias.');
  }
  return p;
}
