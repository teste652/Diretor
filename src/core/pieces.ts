// Pedaços de vídeo: trechos da mesma mídia que se continuam na linha do tempo,
// as emendas que um rascunho cria e a agulha entre o Antes e o Depois.

import { type Clip, type Project, type VideoClip, projectDuration } from './model';
import { isActiveAt } from './render';
import { SAME_T, SAMPLE, round } from './time';

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

/** Emenda que o rascunho criou: onde ela fica na view e quanto do projeto saiu ali (s). */
export interface Seam {
  at: number;
  removed: number;
}

const isVideo = (c: Clip): c is VideoClip => c.kind === 'video';

/** O trecho do arquivo que o vídeo mostra contém `src`, com tolerância de 1 amostra. */
const shows = (c: VideoClip, src: number) => c.in - SAMPLE <= src && src <= c.in + c.duration + SAMPLE;

/**
 * Emendas de uma versão: vídeos seguidos que encostam na linha do tempo sem
 * continuar o arquivo. A chave só depende do que os dois lados mostram, então
 * uma emenda que o ripple só empurrou continua com a mesma chave.
 */
function seamPairs(p: Project): { a: VideoClip; b: VideoClip; key: string }[] {
  const vids = p.clips.filter(isVideo).sort((x, y) => x.start - y.start);
  const out: { a: VideoClip; b: VideoClip; key: string }[] = [];
  for (let i = 1; i < vids.length; i++) {
    const a = vids[i - 1];
    const b = vids[i];
    if (Math.abs(a.start + a.duration - b.start) > SAME_T || isContiguous(a, b)) continue;
    out.push({ a, b, key: `${a.mediaId}|${(a.in + a.duration).toFixed(4)}|${b.mediaId}|${b.in.toFixed(4)}` });
  }
  return out;
}

/**
 * Onde um instante `src` do arquivo do vídeo `c` fica na linha do tempo do
 * projeto: pelo clipe do projeto com o mesmo id ou, se não houver, pelo primeiro
 * vídeo do projeto (na ordem dele) da mesma mídia que mostra `src`. Cada mídia
 * fica ordenada por `in`, para não varrer o projeto inteiro a cada emenda.
 */
function projectPosition(p: Project): (c: VideoClip, src: number) => number | null {
  type Entry = { c: VideoClip; order: number; reach: number };
  const byId = new Map<string, VideoClip>();
  const byMedia = new Map<string, Entry[]>();
  p.clips.forEach((c, order) => {
    if (!isVideo(c)) return;
    byId.set(c.id, c);
    const list = byMedia.get(c.mediaId);
    if (list) list.push({ c, order, reach: 0 });
    else byMedia.set(c.mediaId, [{ c, order, reach: 0 }]);
  });
  for (const list of byMedia.values()) {
    list.sort((x, y) => x.c.in - y.c.in);
    // reach: o maior fim no arquivo até ali. Quando fica abaixo de src, nenhum vídeo daí para trás mostra src.
    let reach = -Infinity;
    for (const e of list) e.reach = reach = Math.max(reach, e.c.in + e.c.duration);
  }
  const firstShowing = (mediaId: string, src: number): VideoClip | undefined => {
    const list = byMedia.get(mediaId) ?? [];
    // Só os que começam até src podem mostrá-lo: acha o último deles e volta enquanto algum fim alcança src.
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].c.in - SAMPLE <= src) lo = mid + 1;
      else hi = mid;
    }
    let best: Entry | undefined;
    for (let i = lo - 1; i >= 0 && list[i].reach + SAMPLE >= src; i--) {
      if (shows(list[i].c, src) && (!best || list[i].order < best.order)) best = list[i];
    }
    return best?.c;
  };
  return (c, src) => {
    const q = byId.get(c.id) ?? firstShowing(c.mediaId, src);
    return q ? q.start + (src - q.in) : null;
  };
}

/**
 * Emendas que o rascunho (`view`) criou em relação ao projeto gravado: pares de
 * vídeos seguidos cuja chave o projeto não tem. `removed` é quanto da linha do
 * tempo do projeto havia entre o fim de A e o começo de B. Sem posição de um
 * dos lados, ou sem nada tirado, não é emenda de corte. Ordenadas por `at`.
 */
export function draftSeams(project: Project, view: Project): Seam[] {
  const known = new Set(seamPairs(project).map((x) => x.key));
  const position = projectPosition(project);
  const out: Seam[] = [];
  for (const { a, b, key } of seamPairs(view)) {
    if (known.has(key)) continue;
    const end = position(a, a.in + a.duration);
    const start = position(b, b.in);
    if (end === null || start === null) continue;
    const removed = round(start - end);
    if (removed > SAME_T) out.push({ at: b.start, removed });
  }
  return out.sort((x, y) => x.at - y.at);
}

/**
 * Agulha do Antes/Depois: o instante de `to` que mostra o mesmo ponto do
 * arquivo que `t` mostra em `from` (pelo pedaço de mesmo id ou por qualquer
 * vídeo da mesma mídia). Um instante cortado vai para o começo do que vem
 * depois dele no arquivo; sem vídeo sob a agulha, `t` só fica dentro de `to`.
 */
export function mapPlayhead(from: Project, to: Project, t: number): number {
  const limited = () => Math.min(Math.max(t, 0), projectDuration(to));
  const p = from.clips.find((c): c is VideoClip => isVideo(c) && isActiveAt(c, t));
  if (!p) return limited();
  const src = p.in + (t - p.start);
  const same = to.clips.filter((c): c is VideoClip => isVideo(c) && c.mediaId === p.mediaId);
  const q = same.find((c) => c.id === p.id && shows(c, src)) ?? same.find((c) => shows(c, src));
  if (q) return q.start + (src - q.in);
  let next: VideoClip | undefined;
  for (const c of same) if (c.in >= src && (!next || c.in < next.in)) next = c;
  return next ? next.start : limited();
}
