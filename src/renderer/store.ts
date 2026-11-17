import { useSyncExternalStore } from 'react';
import { EditorSession } from '../core/session';

export const session = new EditorSession();

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

export const playback = {
  get: () => clock,
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
    const time = Math.max(0, t);
    playback.set({ time });
    if (!clock.playing) session.setPlayhead(time);
  },
};

export function usePlayback(): ClockState {
  return useSyncExternalStore(playback.subscribe, playback.get);
}

export function fmtTime(t: number, fps?: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const base = `${m}:${sec.toString().padStart(2, '0')}`;
  if (!fps) return base;
  // Centésimos de segundo, alinhados ao quadro.
  const snapped = Math.round(s * fps) / fps;
  const cs = Math.floor((snapped - Math.floor(snapped)) * 100 + 1e-6);
  return `${base}.${cs.toString().padStart(2, '0')}`;
}
