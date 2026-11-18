// Conversa com a IA no painel: uma por assistente (Claude e Codex). O texto vai para
// o Claude Code ou o Codex instalados no computador; as edições chegam pelo conector
// do Diretor como rascunho, igual quando a conversa é no Claude Desktop.

import { useSyncExternalStore } from 'react';
import type { AiEvent, AiImage, AiKind } from '../main/assistant';

export type { AiKind };

export interface ChatImage extends AiImage {
  /** data: URL para mostrar a miniatura. */
  url: string;
}

export interface ChatEntry {
  id: number;
  time: number;
  role: 'user' | 'assistant' | 'error' | 'info';
  text: string;
  images?: string[];
  /** O erro parece de conta não conectada: o painel oferece "Entrar na conta". */
  login?: boolean;
}

interface Convo {
  entries: ChatEntry[];
  sessionId?: string;
  /** Mensagem sendo respondida agora. */
  runId?: string;
  /** Para tentar de novo numa conversa nova se a antiga sumiu do computador. */
  last?: { text: string; images: ChatImage[]; resumed: boolean };
}

export const AI_LABEL: Record<AiKind, string> = { claude: 'Claude', codex: 'Codex' };
export const AI_APP: Record<AiKind, string> = { claude: 'Claude Code', codex: 'Codex' };

const STORE_KEY = 'diretor.chat';
const MAX_SAVED = 120;

const state: {
  convos: Record<AiKind, Convo>;
  cli: Record<AiKind, string | null | undefined>;
  platform: string;
  /** O último assistente que recebeu uma mensagem (o "Refazer" do rascunho pede a ele). */
  lastKind?: AiKind;
  version: number;
} = { convos: { claude: { entries: [] }, codex: { entries: [] } }, cli: { claude: undefined, codex: undefined }, platform: '', version: 0 };

let seq = 0;
const listeners = new Set<() => void>();
function changed(): void {
  state.version++;
  save();
  for (const fn of listeners) fn();
}

// A conversa continua quando o Diretor abre de novo (sem as imagens, que ficam pesadas).
function save(): void {
  try {
    const out: Record<string, unknown> = {};
    for (const k of ['claude', 'codex'] as AiKind[]) {
      const c = state.convos[k];
      out[k] = { sessionId: c.sessionId, entries: c.entries.slice(-MAX_SAVED).map(({ images, ...e }) => ({ ...e, ...(images?.length ? { imageCount: images.length } : {}) })) };
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(out));
  } catch {
    /* sem armazenamento */
  }
}
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
  for (const k of ['claude', 'codex'] as AiKind[]) {
    const c = saved?.[k];
    if (!c || !Array.isArray(c.entries)) continue;
    state.convos[k] = {
      sessionId: typeof c.sessionId === 'string' ? c.sessionId : undefined,
      entries: c.entries
        .filter((e: ChatEntry) => e && typeof e.text === 'string')
        .map((e: ChatEntry & { imageCount?: number }) => ({
          ...e,
          id: ++seq,
          text: e.imageCount ? `${e.text}${e.text ? ' ' : ''}(${e.imageCount} imagem${e.imageCount > 1 ? 'ns' : ''})` : e.text,
        })),
    };
  }
} catch {
  /* começa vazio */
}

function push(kind: AiKind, e: Omit<ChatEntry, 'id' | 'time'>): void {
  state.convos[kind].entries.push({ ...e, id: ++seq, time: Date.now() });
  const list = state.convos[kind].entries;
  if (list.length > 400) list.splice(0, list.length - 400);
}

/** A conversa antiga não existe mais (outro computador, apagada): começa outra, sem a pessoa perceber. */
const LOST_SESSION = /no conversation found|no rollout found|session.*not found|não encontr/i;

function onEvent(id: string, ev: AiEvent): void {
  const kind = (['claude', 'codex'] as AiKind[]).find((k) => state.convos[k].runId === id);
  if (!kind) return;
  const c = state.convos[kind];
  switch (ev.type) {
    case 'session':
      c.sessionId = ev.id;
      break;
    case 'text':
      push(kind, { role: 'assistant', text: ev.text.trim() });
      break;
    case 'tool':
      return;
    case 'error':
      if (c.last?.resumed && LOST_SESSION.test(ev.message)) {
        c.sessionId = undefined;
        c.last.resumed = false;
        c.runId = undefined;
        const { text, images } = c.last;
        void start(kind, text, images, false);
        return;
      }
      push(kind, { role: 'error', text: ev.message, login: ev.login });
      break;
    case 'done':
      c.runId = undefined;
      break;
  }
  changed();
}

let wired = false;
function wire(): void {
  if (wired || !window.diretor) return;
  wired = true;
  window.diretor.onAiEvent(({ id, ev }) => onEvent(id, ev));
}

export const chat = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  running: (kind: AiKind) => !!state.convos[kind].runId,
  /** Quem está trabalhando agora (para as linhas de atividade do conector). */
  activeName(): string {
    if (state.convos.codex.runId && !state.convos.claude.runId) return 'Codex';
    return 'Claude';
  },
  async refresh(): Promise<void> {
    wire();
    if (!window.diretor) return;
    try {
      const st = await window.diretor.aiStatus();
      state.cli = { claude: st.claude, codex: st.codex };
      state.platform = st.platform;
    } catch {
      state.cli = { claude: null, codex: null };
    }
    changed();
  },
  async send(kind: AiKind, text: string, images: ChatImage[] = []): Promise<boolean> {
    const t = text.trim();
    if ((!t && !images.length) || state.convos[kind].runId) return false;
    push(kind, { role: 'user', text: t, images: images.map((i) => i.url) });
    state.lastKind = kind;
    return start(kind, t, images, true);
  },
  stop(kind: AiKind): void {
    const id = state.convos[kind].runId;
    if (id) void window.diretor?.aiStop(id);
  },
  /** Nova conversa: a IA esquece o que foi dito (o projeto continua o mesmo). */
  reset(kind: AiKind): void {
    chat.stop(kind);
    state.convos[kind] = { entries: [] };
    changed();
  },
  info(kind: AiKind, text: string): void {
    push(kind, { role: 'info', text });
    changed();
  },
};

async function start(kind: AiKind, text: string, images: ChatImage[], firstTry: boolean): Promise<boolean> {
  wire();
  const api = window.diretor;
  const c = state.convos[kind];
  if (!api) {
    push(kind, { role: 'error', text: 'O chat só funciona no aplicativo Diretor.' });
    changed();
    return false;
  }
  const id = `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  c.runId = id;
  c.last = { text, images, resumed: firstTry && !!c.sessionId };
  changed();
  try {
    const r = await api.aiSend({ id, kind, text, sessionId: c.sessionId, images: images.map(({ mime, data }) => ({ mime, data })) });
    if (r.error) {
      if (c.runId === id) c.runId = undefined;
      if (r.error === 'not_found') {
        state.cli[kind] = null;
        push(kind, { role: 'error', text: `Não encontrei o ${AI_APP[kind]} neste computador. Use o botão Instalar acima.` });
      } else push(kind, { role: 'error', text: r.error });
      changed();
      return false;
    }
    if (r.path && state.cli[kind] !== r.path) {
      state.cli[kind] = r.path;
      changed();
    }
    return true;
  } catch (e) {
    if (c.runId === id) c.runId = undefined;
    push(kind, { role: 'error', text: `Não consegui enviar: ${(e as Error).message}` });
    changed();
    return false;
  }
}

export function useChat() {
  useSyncExternalStore(chat.subscribe, () => state.version);
  return state;
}

/** Imagem colada, arrastada ou escolhida: fica com no máximo 1600 px no lado maior (a IA não precisa de mais). */
export async function readImage(file: Blob): Promise<ChatImage | null> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return null;
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('imagem inválida'));
    img.src = url;
  }).catch(() => undefined);
  const MAX = 1600;
  const big = Math.max(img.naturalWidth, img.naturalHeight) > MAX || file.size > 3_500_000;
  if (!big || !img.naturalWidth) return { mime: file.type, data: url.slice(url.indexOf(',') + 1), url };
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL('image/jpeg', 0.88);
  return { mime: 'image/jpeg', data: out.slice(out.indexOf(',') + 1), url: out };
}
