import { useSyncExternalStore } from 'react';
import { EditorSession } from '../core/session';

export const session = new EditorSession();

// Modo econômico e teto ficam salvos neste computador (valem na próxima vez que abrir).
const SETTINGS_KEY = 'diretor.settings';
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
  if (saved && typeof saved.economy === 'boolean' && Number.isFinite(saved.contextCeilingBytes) && saved.contextCeilingBytes >= 1024)
    session.updateSettings({ economy: saved.economy, contextCeilingBytes: Math.min(256 * 1024, saved.contextCeilingBytes) });
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
