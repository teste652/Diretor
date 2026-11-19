// Tempo da linha do tempo: constantes e arredondamentos compartilhados.

export const EPS = 1e-6;
/** Tolerância para "mesmo instante" entre pontos de animação (s). */
export const SAME_T = 1e-3;
/** Menor duração de um clipe (s). */
export const MIN_DURATION = 0.04;
export const SAMPLE_RATE = 48000;
/** Uma amostra de áudio a 48 kHz (s). */
export const SAMPLE = 1 / SAMPLE_RATE;

/** Arredonda a 1 ms. */
export const round = (n: number): number => Math.round(n * 1000) / 1000;

/** Quadro mais próximo de `t` para o fps dado. */
export const snapToFrame = (t: number, fps: number): number => Math.round(t * fps) / fps;
