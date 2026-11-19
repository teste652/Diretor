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
 *   `from` não tem), ou V não existe em `to` e o clipe de Q em `from` não é
 *   cópia do trecho de V (tem no máximo 1 amostra em comum com ele). Assim uma
 *   cópia do mesmo trecho que já estava em `from` não puxa a agulha.
 * - Se algum que vale para o vídeo sob a agulha mostra aquele ponto, a agulha
 *   vai para a imagem dele: a do de mesmo id ou, senão, a mais perto de `t`
 *   (empate: a do que começa antes). O de mesmo id mostra o ponto com
 *   tolerância de 1 amostra nas duas pontas; o de outro id, só no intervalo
 *   meio-aberto [in, fim) do arquivo, com a folga de `isActiveAt` (1e-9 s) e
 *   não a de 1 amostra: encostar nele pela ponta do arquivo não basta.
 * - Senão o instante foi cortado. Na sequência de vídeos de `from` sem buraco em
 *   volta da agulha, o último instante até `t` que ainda aparece em `to` (o fim
 *   do pedaço que ficou conta) dá a borda do corte; se não há, o primeiro depois
 *   de `t`. Aqui um de outro id só conta se tem mais de 1 amostra em comum com o
 *   trecho procurado. No mesmo instante, vale o de mesmo id e depois a imagem
 *   mais perto.
 * - A agulha segue o vídeo, não só o conteúdo: se o que está sob ela não existe
 *   na outra versão (o rascunho tirou ou inseriu), ela vai para a borda onde ele
 *   saiu ou entrou. Assim Depois→Antes numa cópia que o rascunho inseriu vai para
 *   a borda da inserção.
 * - Limite aceito: quando o mesmo trecho do arquivo aparece duas vezes e as duas
 *   cópias são divididas, um pedaço novo da outra cópia ainda pode ganhar (nada
 *   diz de que clipe cada pedaço novo veio).
 * - Sem vídeo sob a agulha, ou sem nada disso, `t` só fica dentro de `to`.
 */
export function mapPlayhead(from: Project, to: Project, t: number): number {
  const limited = () => Math.min(Math.max(t, 0), projectDuration(to));
  const p = from.clips.find((c): c is VideoClip => isVideo(c) && isActiveAt(c, t));
  if (!p) return limited();
  const fromById = new Map(from.clips.map((c) => [c.id, c]));
  const toIds = new Set(to.clips.map((c) => c.id));
  const touching = fileIndex(to.clips);
  /** Quanto os trechos [a0, a1] e [b0, b1] do arquivo têm em comum (≤ 0 se nada). */
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);
  /** Q vale para o conteúdo de V: mesmo id, pedaço novo, ou V saiu de `to` e o clipe de Q em `from` não é cópia do trecho de V. */
  const admitted = (q: VideoClip, v: VideoClip) => {
    if (q.id === v.id) return true;
    const f = fromById.get(q.id);
    if (!f) return true;
    if (toIds.has(v.id)) return false;
    return !(isVideo(f) && f.mediaId === v.mediaId && overlap(f.in, f.in + f.duration, v.in, v.in + v.duration) > SAMPLE);
  };
  type Hit = { u: number; image: number; same: boolean; start: number };
  // No mesmo instante u: mesmo id primeiro, depois a imagem mais perto de u, depois o que começa antes.
  const beats = (a: Hit, b: Hit, latest: boolean) => {
    if (Math.abs(a.u - b.u) > EPS) return latest ? a.u > b.u : a.u < b.u;
    if (a.same !== b.same) return a.same;
    const da = Math.abs(a.image - a.u);
    const db = Math.abs(b.image - b.u);
    return Math.abs(da - db) > EPS ? da < db : a.start < b.start;
  };
  /**
   * O instante u de [uLo, uHi] mais tarde ('latest') ou mais cedo ('earliest') em que o conteúdo de `v`
   * aparece em `to`; 'exact' procura só o ponto uLo = uHi. Um de outro id não vale por encostar numa ponta
   * do arquivo: no ponto, precisa mostrá-lo no meio-aberto com a folga de isActiveAt (1e-9 s, não 1 amostra,
   * para o último instante de um pedaço não ir para o vizinho do arquivo); num trecho, ter mais de 1 amostra dele.
   */
  const search = (v: VideoClip, uLo: number, uHi: number, mode: 'exact' | 'latest' | 'earliest', best?: Hit): Hit | undefined => {
    const latest = mode !== 'earliest';
    const lo = v.in + (uLo - v.start);
    const hi = v.in + (uHi - v.start);
    for (const { c: q } of touching(v.mediaId, lo, hi)) {
      if (!admitted(q, v)) continue;
      const qEnd = q.in + q.duration;
      if (q.id !== v.id && (mode === 'exact' ? !(q.in - 1e-9 <= lo && lo < qEnd - 1e-9) : overlap(q.in, qEnd, lo, hi) <= SAMPLE)) continue;
      const src = latest ? Math.max(lo, Math.min(qEnd, hi)) : Math.min(hi, Math.max(q.in, lo));
      const hit = { u: v.start + (src - v.in), image: q.start + (src - q.in), same: q.id === v.id, start: q.start };
      if (!best || beats(hit, best, latest)) best = hit;
    }
    return best;
  };
  const exact = search(p, t, t, 'exact');
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
  for (let i = at; i >= i0 && !(best && maxEnd[i] < best.u - EPS); i--) best = search(vids[i], vids[i].start, Math.min(end(vids[i]), t), 'latest', best);
  if (best) return best.image;
  // Para a frente: os vídeos começam em ordem, então um que começa depois do achado não melhora.
  for (let i = at; i <= i1 && !(best && vids[i].start > best.u + EPS); i++) {
    if (end(vids[i]) >= t) best = search(vids[i], Math.max(vids[i].start, t), end(vids[i]), 'earliest', best);
  }
  return best ? best.image : limited();
}
