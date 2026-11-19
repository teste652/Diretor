// Pedaços de vídeo: trechos da mesma mídia que se continuam na linha do tempo.

import type { Clip } from './model';
import { SAMPLE } from './time';

/**
 * `b` continua `a` sem emenda: os dois são vídeo da mesma mídia e encostam na
 * linha do tempo e no arquivo, com tolerância de 1 amostra de áudio.
 */
export function isContiguous(a: Clip, b: Clip): boolean {
  return (
    a.kind === 'video' &&
    b.kind === 'video' &&
    a.mediaId === b.mediaId &&
    Math.abs(a.start + a.duration - b.start) <= SAMPLE &&
    Math.abs(a.in + a.duration - b.in) <= SAMPLE
  );
}
