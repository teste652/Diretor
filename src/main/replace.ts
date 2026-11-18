// Troca o arquivo de destino pelo MP4 pronto sem nunca perder o vídeo renderizado.

import { existsSync } from 'node:fs';
import { rename as fsRename } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

/** Erros de arquivo preso (antivírus, indexador, miniatura do Explorer, player aberto). */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Esperas entre tentativas: ~4 s no total, o bastante para antivírus e indexador soltarem o arquivo. */
export const RENAME_WAITS_MS = [50, 100, 200, 400, 800, 1200, 1600];

/**
 * `fallback`: o destino continuou preso e o vídeo foi salvo ao lado, em `path`.
 * `kept`: onde o vídeo pronto ficou quando nem isso deu (ausente se ele sumiu).
 */
export type MoveResult = { path: string; fallback: boolean } | { error: string; kept?: string };

export interface MoveOptions {
  rename?: (from: string, to: string) => Promise<void>;
  exists?: (path: string) => boolean;
  waitsMs?: number[];
}

/**
 * Move `tmp` para `dest`, substituindo o destino. No Windows, um arquivo recém
 * fechado ou aberto em outro programa recusa a troca por instantes: tenta de novo.
 * Se o destino continuar preso (ex.: aberto num player), grava ao lado como
 * "nome (1).mp4" em vez de apagar o vídeo pronto. Se nem isso der, deixa o
 * temporário onde está e devolve o caminho dele.
 */
export async function moveIntoPlace(tmp: string, dest: string, opts: MoveOptions = {}): Promise<MoveResult> {
  const rename = opts.rename ?? fsRename;
  const exists = opts.exists ?? existsSync;
  const waits = opts.waitsMs ?? RENAME_WAITS_MS;
  let last: unknown;
  for (let i = 0; ; i++) {
    try {
      await rename(tmp, dest);
      return { path: dest, fallback: false };
    } catch (e) {
      last = e;
      if (!BUSY.has((e as NodeJS.ErrnoException)?.code ?? '') || i >= waits.length) break;
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
  // Outro nome só ajuda se o problema é o destino (aberto, protegido, é uma pasta...).
  if (exists(dest) && exists(tmp)) {
    const ext = extname(dest) || '.mp4';
    const stem = basename(dest, extname(dest));
    for (let n = 1; n < 100; n++) {
      const alt = join(dirname(dest), `${stem} (${n})${ext}`);
      if (exists(alt)) continue;
      try {
        await rename(tmp, alt);
        return { path: alt, fallback: true };
      } catch {
        break;
      }
    }
  }
  return { error: last instanceof Error ? last.message : String(last), ...(exists(tmp) ? { kept: tmp } : {}) };
}
