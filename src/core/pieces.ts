// Pedaços de vídeo: trechos da mesma mídia que se continuam na linha do tempo,
// as emendas que um rascunho cria e a agulha entre o Antes e o Depois.

import { type Clip, type Project, type VideoClip, projectDuration } from './model';
import { isActiveAt } from './render';
import { EPS, SAME_T, SAMPLE, round } from './time';

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

type FileEntry = { c: VideoClip; order: number; reach: number };

/**
 * Vídeos por mídia, ordenados por `in`, para achar quem mostra um trecho do
 * arquivo sem varrer todos: a consulta devolve os vídeos da mídia cujo trecho do
 * arquivo encosta em [lo, hi], com tolerância de 1 amostra (com lo = hi, os que
 * mostram aquele instante). `order` é a posição do vídeo na lista de clipes.
 */
function fileIndex(clips: Clip[]): (mediaId: string, lo: number, hi: number) => FileEntry[] {
  const byMedia = new Map<string, FileEntry[]>();
  clips.forEach((c, order) => {
    if (!isVideo(c)) return;
    const list = byMedia.get(c.mediaId);
    if (list) list.push({ c, order, reach: 0 });
    else byMedia.set(c.mediaId, [{ c, order, reach: 0 }]);
  });
  for (const list of byMedia.values()) {
    list.sort((x, y) => x.c.in - y.c.in);
    // reach: o maior fim no arquivo até ali. Quando fica abaixo de lo, nenhum vídeo daí para trás encosta.
    let reach = -Infinity;
    for (const e of list) e.reach = reach = Math.max(reach, e.c.in + e.c.duration);
  }
  return (mediaId, lo, hi) => {
    const list = byMedia.get(mediaId) ?? [];
    // Só os que começam até hi podem encostar: acha o último deles e volta enquanto algum fim alcança lo.
    let a = 0;
    let b = list.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (list[mid].c.in - SAMPLE <= hi) a = mid + 1;
      else b = mid;
    }
    const out: FileEntry[] = [];
    for (let i = a - 1; i >= 0 && list[i].reach + SAMPLE >= lo; i--) if (list[i].c.in + list[i].c.duration + SAMPLE >= lo) out.push(list[i]);
    return out;
  };
}

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
 * vídeo do projeto (na ordem dele) da mesma mídia que mostra `src`.
 */
function projectPosition(p: Project): (c: VideoClip, src: number) => number | null {
  const byId = new Map(p.clips.filter(isVideo).map((c) => [c.id, c]));
  const showing = fileIndex(p.clips);
  return (c, src) => {
    let q = byId.get(c.id);
    if (!q) {
      let first: FileEntry | undefined;
      for (const e of showing(c.mediaId, src, src)) if (!first || e.order < first.order) first = e;
      q = first?.c;
    }
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
 * Agulha do Antes/Depois: leva o instante `t` de `from` para o instante de `to`
 * que mostra o mesmo ponto do arquivo, ou para a borda do corte se esse ponto
 * foi cortado.
 * - Um vídeo Q de `to` vale para o conteúdo de um vídeo V de `from` quando é da
 *   mesma mídia e, além disso, tem o mesmo id, ou é um pedaço novo (id que
 *   `from` não tem), ou V não existe em `to`. Assim outra cópia do mesmo trecho
 *   não puxa a agulha.
 * - Se algum que vale para o vídeo sob a agulha mostra aquele ponto (tolerância
 *   de 1 amostra), a agulha vai para a imagem dele: a do de mesmo id ou, senão,
 *   a mais perto de `t` (empate: a do que começa antes).
 * - Senão o instante foi cortado. Na sequência de vídeos de `from` sem buraco em
 *   volta da agulha, o último instante até `t` que ainda aparece em `to` (o fim
 *   do pedaço que ficou conta) dá a borda do corte; se não há, o primeiro depois
 *   de `t`. No mesmo instante, vale o de mesmo id e depois a imagem mais perto.
 * - Sem vídeo sob a agulha, ou sem nada disso, `t` só fica dentro de `to`.
 */
export function mapPlayhead(from: Project, to: Project, t: number): number {
  const limited = () => Math.min(Math.max(t, 0), projectDuration(to));
  const p = from.clips.find((c): c is VideoClip => isVideo(c) && isActiveAt(c, t));
  if (!p) return limited();
  const fromIds = new Set(from.clips.map((c) => c.id));
  const toIds = new Set(to.clips.map((c) => c.id));
  const touching = fileIndex(to.clips);
  type Hit = { u: number; image: number; same: boolean; start: number };
  // No mesmo instante u: mesmo id primeiro, depois a imagem mais perto de u, depois o que começa antes.
  const beats = (a: Hit, b: Hit, latest: boolean) => {
    if (Math.abs(a.u - b.u) > EPS) return latest ? a.u > b.u : a.u < b.u;
    if (a.same !== b.same) return a.same;
    const da = Math.abs(a.image - a.u);
    const db = Math.abs(b.image - b.u);
    return Math.abs(da - db) > EPS ? da < db : a.start < b.start;
  };
  /** O instante u de [uLo, uHi] mais tarde (ou mais cedo) em que o conteúdo de `v` aparece em `to`. */
  const search = (v: VideoClip, uLo: number, uHi: number, latest: boolean, best?: Hit): Hit | undefined => {
    const lo = v.in + (uLo - v.start);
    const hi = v.in + (uHi - v.start);
    for (const { c: q } of touching(v.mediaId, lo, hi)) {
      if (q.id !== v.id && fromIds.has(q.id) && toIds.has(v.id)) continue;
      const src = latest ? Math.max(lo, Math.min(q.in + q.duration, hi)) : Math.min(hi, Math.max(q.in, lo));
      const hit = { u: v.start + (src - v.in), image: q.start + (src - q.in), same: q.id === v.id, start: q.start };
      if (!best || beats(hit, best, latest)) best = hit;
    }
    return best;
  };
  const exact = search(p, t, t, true);
  if (exact) return exact.image;
  // Instante cortado: a sequência sem buraco de vídeos de `from` em volta da agulha (i0 a i1).
  const vids = from.clips.filter(isVideo).sort((x, y) => x.start - y.start);
  const end = (c: VideoClip) => c.start + c.duration;
  const at = vids.indexOf(p);
  let i0 = at;
  let i1 = at;
  for (let edge = end(p); i1 + 1 < vids.length && vids[i1 + 1].start <= edge + SAME_T; ) edge = Math.max(edge, end(vids[++i1]));
  for (let edge = p.start; i0 > 0 && end(vids[i0 - 1]) >= edge - SAME_T; ) edge = Math.min(edge, vids[--i0].start);
  // Para trás: maxEnd[i] é o maior fim até i; quando fica antes do achado, nenhum vídeo daí para trás chega lá.
  const maxEnd: number[] = [];
  vids.forEach((v, i) => (maxEnd[i] = Math.max(i ? maxEnd[i - 1] : -Infinity, end(v))));
  let best: Hit | undefined;
  for (let i = at; i >= i0 && !(best && maxEnd[i] < best.u - EPS); i--) best = search(vids[i], vids[i].start, Math.min(end(vids[i]), t), true, best);
  if (best) return best.image;
  // Para a frente: os vídeos começam em ordem, então um que começa depois do achado não melhora.
  for (let i = at; i <= i1 && !(best && vids[i].start > best.u + EPS); i++) {
    if (end(vids[i]) >= t) best = search(vids[i], Math.max(vids[i].start, t), end(vids[i]), false, best);
  }
  return best ? best.image : limited();
}
