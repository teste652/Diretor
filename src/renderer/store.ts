import { useSyncExternalStore } from 'react';
import type { Project } from '../core/model';
import { EditorSession } from '../core/session';
import type { Marks } from './timelineLogic';

export const session = new EditorSession();

// O modo econômico fica salvo neste computador (vale na próxima vez que abrir). O teto não é mais
// ajustável na tela: um teto salvo por uma versão antiga (ex.: 1 KB) é ignorado e vale o padrão.
const SETTINGS_KEY = 'diretor.settings';
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
  if (saved && typeof saved.economy === 'boolean') session.updateSettings({ economy: saved.economy });
} catch {
  /* sem armazenamento: usa o padrão (econômico ligado) */
}
let lastSettings = JSON.stringify(session.settings);
session.subscribe(() => {
  const now = JSON.stringify(session.settings);
  if (now === lastSettings) return;
  lastSettings = now;
  try {
    localStorage.setItem(SETTINGS_KEY, now);
  } catch {
    /* ignora */
  }
});

export function useSession(): EditorSession {
  useSyncExternalStore(
    (fn) => session.subscribe(fn),
    () => session.version,
  );
  return session;
}

// Relógio de reprodução separado da sessão: muda a cada quadro sem
// re-renderizar a interface inteira.
type ClockState = { time: number; playing: boolean };
let clock: ClockState = { time: 0, playing: false };
const clockListeners = new Set<() => void>();
/** Aumenta a cada salto do usuário (a reprodução usa para reposicionar o relógio). */
let seekEpoch = 0;

export const playback = {
  get: () => clock,
  epoch: () => seekEpoch,
  set(next: Partial<ClockState>) {
    clock = { ...clock, ...next };
    for (const fn of clockListeners) fn();
  },
  subscribe(fn: () => void) {
    clockListeners.add(fn);
    return () => clockListeners.delete(fn);
  },
  /** Posiciona o playhead (e informa a sessão, para o contexto do Claude). */
  seek(t: number) {
    const time = Math.max(0, Number.isFinite(t) ? t : 0);
    seekEpoch++;
    playback.set({ time });
    if (!clock.playing) session.setPlayhead(time);
  },
};

export function usePlayback(): ClockState {
  return useSyncExternalStore(playback.subscribe, playback.get);
}

// Marcas I e O da régua: o trecho que "Apagar trecho" (Shift+Delete) tira de todas as faixas.
let markState: Marks = { in: null, out: null };
const markListeners = new Set<() => void>();

export const marks = {
  get: () => markState,
  set(next: Marks) {
    markState = next;
    for (const fn of markListeners) fn();
  },
  subscribe(fn: () => void) {
    markListeners.add(fn);
    return () => markListeners.delete(fn);
  },
};

export function useMarks(): Marks {
  return useSyncExternalStore(marks.subscribe, marks.get);
}

// Antes/Depois: com um rascunho que corta ou empurra clipes, a prévia pode mostrar o projeto gravado.
let comparing = false;
const compareListeners = new Set<() => void>();

export const compare = {
  get: () => comparing,
  set(v: boolean) {
    if (v === comparing) return;
    comparing = v;
    for (const fn of compareListeners) fn();
  },
  subscribe(fn: () => void) {
    compareListeners.add(fn);
    return () => compareListeners.delete(fn);
  },
};

export function useCompare(): boolean {
  return useSyncExternalStore(compare.subscribe, compare.get);
}

/** O que a prévia mostra: no "Antes", o projeto gravado (só com rascunho que corta ou empurra); senão, a view. */
export function shownProject(): Project {
  return compare.get() && session.draftInfo.ripple ? session.project : session.view;
}

// Rascunho aceito ou descartado, outra etapa ou sem corte: a prévia volta ao "Depois". Entre uma etapa e a
// seguinte a sessão sempre avisa uma vez sem etapa em rascunho, então a próxima nunca abre no "Antes".
session.subscribe(() => {
  if (comparing && !session.draftInfo.ripple) compare.set(false);
});

export function fmtTime(t: number, fps?: number): string {
  // Com fps, tudo sai do tempo alinhado ao quadro (senão 1,0 s apareceria como 0:00.99).
  const s = fps ? Math.round(Math.max(0, t) * fps) / fps : Math.max(0, t);
  const whole = Math.floor(s + 1e-6);
  const m = Math.floor(whole / 60);
  const sec = whole % 60;
  const base = `${m}:${sec.toString().padStart(2, '0')}`;
  if (!fps) return base;
  const cs = Math.min(99, Math.floor((s - whole) * 100 + 1e-6));
  return `${base}.${Math.max(0, cs).toString().padStart(2, '0')}`;
}

/** Número do quadro (a partir de 0) no tempo `t`. */
export const frameAt = (t: number, fps: number) => Math.round(Math.max(0, t) * fps);
