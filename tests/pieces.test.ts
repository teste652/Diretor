import { describe, expect, it } from 'vitest';
import { type Clip, type Project, type VideoClip, findClip } from '../src/core/model';
import { type Op, OpValidationError } from '../src/core/operations';
import { draftSeams, isContiguous, mapPlayhead } from '../src/core/pieces';
import { ACTIVE_EPS, isActiveAt } from '../src/core/render';
import { mapTime, normalizeRanges } from '../src/core/ripple';
import { round } from '../src/core/time';
import { base, run, videos } from './fixtures';

describe('pedaços', () => {
  it('contíguos: mesma mídia, encostados na linha do tempo e no arquivo, com tolerância de 1 amostra', () => {
    const p = videos([['A', 0, 2, 0], ['B', 2, 2, 2.00001], ['C', 4, 2, 4.002], ['D', 6, 2, 6, 'm2']]);
    const c = (id: string) => findClip(p, id)!;
    expect(isContiguous(c('A'), c('B'))).toBe(true);
    expect(isContiguous(c('B'), c('C'))).toBe(false);
    expect(isContiguous(c('C'), c('D'))).toBe(false);
  });
});

describe('emendas do rascunho', () => {
  // A [0,2) in 0, B [2,4) in 5, C [4,6) in 8: já tem emendas no projeto, que não contam.
  const abc = () => videos([['A', 0, 2, 0], ['B', 2, 2, 5], ['C', 4, 2, 8]]);
  it('sem mudança, sem emenda nova', () => expect(draftSeams(abc(), abc())).toEqual([]));
  it('apagar [2,4] deixa uma emenda em 2 com 2 s tirados', () =>
    expect(draftSeams(abc(), run(abc(), [{ op: 'removeRanges', ranges: [[2, 4]] }]))).toEqual([{ at: 2, removed: 2 }]));
  it('aparar 0,5 do começo de B conta 0,5', () =>
    expect(draftSeams(abc(), run(abc(), [{ op: 'trimClip', clipId: 'B', edge: 'start', delta: 0.5 }]))).toEqual([{ at: 2, removed: 0.5 }]));
  it('dividir sem cortar não cria emenda', () => expect(draftSeams(abc(), run(abc(), [{ op: 'splitClip', clipId: 'A', at: 1 }]))).toEqual([]));
  it('base(): apagar [2,3] dá uma emenda de 1 s em 2', () =>
    expect(draftSeams(base(), run(base(), [{ op: 'removeRanges', ranges: [[2, 3]] }]))).toEqual([{ at: 2, removed: 1 }]));
});

describe('agulha no Antes/Depois', () => {
  const antes = base();
  const depois = run(antes, [{ op: 'removeRanges', ranges: [[2, 3]] }]);
  it('o mesmo instante do conteúdo nas duas versões', () => {
    expect(mapPlayhead(depois, antes, 2.5)).toBeCloseTo(3.5, 6);
    expect(mapPlayhead(antes, depois, 3.5)).toBeCloseTo(2.5, 6);
    expect(mapPlayhead(antes, depois, 7)).toBeCloseTo(6, 6);
  });
  it('instante cortado vai para a borda do corte; depois do fim, para o fim', () => {
    expect(mapPlayhead(antes, depois, 2.5)).toBeCloseTo(2, 6);
    expect(mapPlayhead(antes, depois, 9.5)).toBeCloseTo(8, 6);
  });
});

describe('agulha na borda do corte: várias mídias, pedaços fora de ordem e conteúdo repetido', () => {
  const cut = (antes: Project, ranges: [number, number][]) => run(antes, [{ op: 'removeRanges', ranges }]);
  const needle = (antes: Project, ranges: [number, number][], t: number) => mapPlayhead(antes, cut(antes, ranges), t);
  it('outra mídia logo depois do corte: para na borda, não no próximo pedaço da mesma mídia', () =>
    expect(needle(videos([['A', 0, 2, 0], ['X', 2, 2, 0, 'm2'], ['B', 4, 2, 3]]), [[1, 2]], 1.5)).toBeCloseTo(1, 6));
  it('duas tomadas com o corte na junção', () => {
    const antes = videos([['A', 0, 10, 0], ['B', 10, 10, 0, 'm2']]);
    const depois = cut(antes, [[8, 12]]);
    expect(mapPlayhead(antes, depois, 9)).toBeCloseTo(8, 6);
    expect(mapPlayhead(antes, depois, 11)).toBeCloseTo(8, 6);
    expect(mapPlayhead(antes, depois, 13)).toBeCloseTo(9, 6);
    expect(mapPlayhead(depois, antes, 9)).toBeCloseTo(13, 6);
  });
  it('pedaços fora da ordem do arquivo', () => expect(needle(videos([['A', 0, 2, 5], ['B', 2, 2, 0]]), [[1, 2]], 1.5)).toBeCloseTo(1, 6));
  it('conteúdo repetido: a agulha fica no pedaço que foi cortado', () => {
    const antes = videos([['A', 0, 4, 0], ['B', 4, 2, 1]]);
    const depois = cut(antes, [[1.5, 2.5]]);
    expect(mapPlayhead(antes, depois, 1.6)).toBeCloseTo(1.5, 6);
    expect(mapPlayhead(depois, antes, 2)).toBeCloseTo(3, 6);
  });
  it('a tomada do meio inteira cortada', () =>
    expect(needle(videos([['A', 0, 2, 0], ['B', 2, 2, 0, 'm2'], ['C', 4, 2, 2]]), [[2, 4]], 3)).toBeCloseTo(2, 6));
  it('corte no começo e no fim da linha do tempo', () => {
    expect(needle(base(), [[0, 1]], 0.5)).toBeCloseTo(0, 6);
    expect(needle(base(), [[8, 9]], 8.5)).toBeCloseTo(8, 6);
  });
  it('corte que entra num buraco volta para a borda de antes dele', () =>
    expect(needle(videos([['A', 0, 4, 0], ['B', 5, 3, 4]]), [[3, 4.5]], 3.5)).toBeCloseTo(3, 6));
});

describe('agulha: sem prender na ponta de outro pedaço nem em cópias', () => {
  const cut = (antes: Project, ranges: [number, number][]) => run(antes, [{ op: 'removeRanges', ranges }]);
  it('plano de corte de outra mídia no meio da tomada: o fim do vizinho no arquivo não puxa a agulha', () => {
    const antes = videos([['I1', 0, 10, 0], ['X', 10, 5, 0, 'm2'], ['I2', 15, 5, 10]]);
    const depois = cut(antes, [[12, 17]]);
    for (const t of [15, 15.5, 16, 16.9]) expect(mapPlayhead(antes, depois, t)).toBeCloseTo(12, 6);
    expect(mapPlayhead(antes, depois, 17.5)).toBeCloseTo(12.5, 6);
    expect(mapPlayhead(depois, antes, 12.5)).toBeCloseTo(17.5, 6);
    expect(mapPlayhead(depois, antes, 11)).toBeCloseTo(11, 6);
  });
  it('pedaços fora da ordem do arquivo com o começo cortado', () => {
    const antes = videos([['B', 0, 5, 5], ['A', 5, 5, 0]]);
    const depois = cut(antes, [[0, 2]]);
    for (const t of [0.5, 1, 1.9]) expect(mapPlayhead(antes, depois, t)).toBeCloseTo(0, 6);
    expect(mapPlayhead(antes, depois, 2.5)).toBeCloseTo(0.5, 6);
    expect(mapPlayhead(depois, antes, 0.5)).toBeCloseTo(2.5, 6);
    expect(mapPlayhead(depois, antes, 4)).toBeCloseTo(6, 6);
  });
  it('uma cópia tirada inteira: a outra cópia não puxa a agulha', () => {
    const antes = videos([['A', 0, 2, 0], ['B', 2, 2, 0]]);
    const depois = cut(antes, [[2, 4]]);
    expect(mapPlayhead(antes, depois, 2.5)).toBeCloseTo(2, 6);
    expect(mapPlayhead(antes, depois, 3)).toBeCloseTo(2, 6);
    expect(mapPlayhead(antes, depois, 1)).toBeCloseTo(1, 6);
  });
  it('abertura que repete um trecho do meio, tirada inteira: a agulha não vai para o meio do vídeo', () => {
    const antes = videos([['T', 0, 2, 10], ['M', 2, 18, 0]]);
    const depois = cut(antes, [[0, 2]]);
    expect(mapPlayhead(antes, depois, 1)).toBeCloseTo(0, 6);
    expect(mapPlayhead(antes, depois, 13)).toBeCloseTo(11, 6);
    expect(mapPlayhead(depois, antes, 11)).toBeCloseTo(13, 6);
  });
  it('abertura que repete um trecho do meio, com o começo cortado', () => {
    const antes = videos([['T', 0, 2, 10], ['M', 2, 18, 0]]);
    const depois = cut(antes, [[0, 1]]);
    expect(mapPlayhead(antes, depois, 0.5)).toBeCloseTo(0, 6);
    expect(mapPlayhead(antes, depois, 1.5)).toBeCloseTo(0.5, 6);
    expect(mapPlayhead(depois, antes, 0.5)).toBeCloseTo(1.5, 6);
    expect(mapPlayhead(depois, antes, 5)).toBeCloseTo(6, 6);
  });

  it('propriedade, com conteúdo único: na grade e nas pontas dos pedaços, Antes→Depois bate com mapTime e Depois→Antes com o pedaço que mostra o instante', () => {
    // Sorteio fixo (LCG), feito exato em 32 bits: em double, seed * 1103515245 passa de 2^53, perde os bits
    // baixos e a sequência entra em ciclo depois de uns 16 mil sorteios.
    let seed = 12345;
    const rnd = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed / 2147483648;
    };
    const bad: string[] = [];
    let drafts = 0;
    let instants = 0;
    let probes = 0;
    for (let n = 0; n < 300; n++) {
      // m1 e m2 (20 s cada) em pedaços seguidos de 0,3 a 3,3 s no grid de 1 ms: nenhum instante do arquivo se repete.
      const chunks: { m: 'm1' | 'm2'; in: number; d: number }[] = [];
      for (const m of ['m1', 'm2'] as const)
        for (let at = 0; round(20 - at) >= 0.3; at = round(at + chunks[chunks.length - 1].d)) chunks.push({ m, in: at, d: Math.min(round(0.3 + rnd() * 3), round(20 - at)) });
      for (let i = chunks.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [chunks[i], chunks[j]] = [chunks[j], chunks[i]];
      }
      // Os primeiros 2 a 6 pedaços, encostados a partir do zero: uma faixa sem buraco, muitas vezes fora da ordem do arquivo.
      const list: [string, number, number, number, 'm1' | 'm2'][] = [];
      let end = 0;
      for (const c of chunks.slice(0, 2 + Math.floor(rnd() * 5))) {
        list.push([`p${list.length}`, end, c.d, c.in, c.m]);
        end = round(end + c.d);
      }
      const ranges = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (): [number, number] => {
        const a = round(rnd() * (end - 0.01));
        return [a, round(a + 0.05 + rnd() * 2.5)];
      });
      const where = `pedaços ${JSON.stringify(list)} cortes ${JSON.stringify(ranges)}`;
      const antes = videos(list);
      let depois: Project;
      try {
        depois = cut(antes, ranges);
      } catch (e) {
        bad.push(`removeRanges recusou (${e instanceof Error ? e.message : e}) | ${where}`);
        continue;
      }
      drafts++;
      const R = normalizeRanges(antes, ranges);
      const shown = depois.clips.reduce((e, c) => Math.max(e, c.start + c.duration), 0);
      /** Antes→Depois em t contra mapTime. */
      const toDepois = (t: number) => {
        const want = mapTime(R, t);
        const got = mapPlayhead(antes, depois, t);
        if (!(Math.abs(got - want) <= 0.002)) bad.push(`Antes→Depois t=${t}: ${got} em vez de ${want} | ${where}`);
      };
      /** Depois→Antes em t contra o vídeo de Antes que mostra o mesmo instante do arquivo; falso se não há vídeo em t. */
      const toAntes = (t: number) => {
        const p = depois.clips.find((c): c is VideoClip => c.kind === 'video' && isActiveAt(c, t));
        if (!p) return false;
        const src = p.in + (t - p.start);
        // Meio-aberto com a folga de isActiveAt: na borda exata entre dois pedaços do arquivo vale o da direita, mesmo com o ruído da soma.
        const q = antes.clips.find((c): c is VideoClip => c.kind === 'video' && c.mediaId === p.mediaId && c.in - ACTIVE_EPS <= src && src < c.in + c.duration - ACTIVE_EPS);
        const got = mapPlayhead(depois, antes, t);
        if (!q) bad.push(`Depois→Antes t=${t}: nenhum pedaço de Antes mostra ${src} | ${where}`);
        else if (!(Math.abs(got - (q.start + (src - q.in))) <= 0.002)) bad.push(`Depois→Antes t=${t}: ${got} em vez de ${q.start + (src - q.in)} | ${where}`);
        return true;
      };
      for (let k = 0, t = 0.0137; t < end; t = 0.0137 + ++k * 0.0731) {
        toDepois(t);
        instants++;
      }
      for (let k = 0, t = 0.0137; t < shown; t = 0.0137 + ++k * 0.0731) if (toAntes(t)) instants++;
      // Sondas onde a grade não chega: o último instante de cada pedaço (que encosta no vizinho do arquivo) e logo depois do começo.
      const probesOf = (version: Project) => version.clips.filter((c) => c.kind === 'video').flatMap((c) => [c.start + c.duration - 1e-5, c.start + 1e-5, c.start + c.duration - 3e-6]);
      for (const t of probesOf(antes)) {
        if (t < 0 || t >= end) continue;
        toDepois(t);
        probes++;
      }
      for (const t of probesOf(depois)) if (t >= 0 && t < shown && toAntes(t)) probes++;
    }
    expect(bad.slice(0, 5), `${bad.length} errados em ${instants} instantes da grade e ${probes} sondas`).toEqual([]);
    expect(drafts).toBe(300);
    expect(instants).toBeGreaterThan(20000);
    expect(probes).toBeGreaterThan(5000);
  });
});

describe('agulha no último instante de um pedaço: não pula para o vizinho no arquivo', () => {
  const cut = (antes: Project, ranges: [number, number][]) => run(antes, [{ op: 'removeRanges', ranges }]);
  it('pedaços fora da ordem do arquivo: o último instante não vai para o começo do vizinho', () => {
    const antes = videos([['W', 0, 5, 5], ['V', 5, 5, 0]]);
    const depois = cut(antes, [[5, 6]]);
    expect(mapPlayhead(antes, depois, 9.99999)).toBeCloseTo(8.99999, 6);
    expect(mapPlayhead(depois, antes, 8.99999)).toBeCloseTo(9.99999, 6);
  });
  it('pedaço tirado inteiro: o último instante dele vai para a borda do corte', () => {
    const antes = videos([['W', 0, 5, 5], ['V', 5, 5, 0], ['X', 10, 5, 10]]);
    expect(mapPlayhead(antes, cut(antes, [[5, 10]]), 9.99999)).toBeCloseTo(5, 6);
  });
  it('plano de corte de outra mídia, corte no meio da tomada: Depois→Antes não vai para o fim do plano de corte', () => {
    const antes = videos([['I1', 0, 10, 0], ['X', 10, 5, 0, 'm2'], ['I2', 15, 5, 10]]);
    expect(mapPlayhead(cut(antes, [[3, 4]]), antes, 8.99999)).toBeCloseTo(9.99999, 6);
  });
  it('plano de corte de outra mídia, começo da tomada cortado: Antes→Depois não vai para o fim do plano de corte', () => {
    const antes = videos([['I1', 0, 10, 0], ['X', 10, 5, 0, 'm2'], ['I2', 15, 5, 10]]);
    expect(mapPlayhead(antes, cut(antes, [[0, 1]]), 9.99999)).toBeCloseTo(8.99999, 6);
  });
  it('instante de um quadro a 59,94 qps no último instante do pedaço', () => {
    const antes = videos([['W', 0, 5, 5], ['V', 5, 0.322, 4.678]]);
    const t = (319 * 1001) / 60000;
    expect(mapPlayhead(antes, cut(antes, [[5, 5.1]]), t)).toBeCloseTo(t - 0.1, 6);
  });
});

describe('agulha no ponto da divisão: vai para o pedaço que o mostra', () => {
  const antes = videos([['A', 0, 10, 0]]);
  it('dividir e trocar os pedaços de lugar: o ponto da divisão vai para o começo do pedaço da direita, não para o fim do vídeo', () => {
    // R [0,5) mostra o arquivo de 5 a 10 e A [5,10) o de 0 a 5. Da agulha no zero, Depois→Antes→Depois tem de voltar ao zero.
    const depois = run(antes, [
      { op: 'splitClip', clipId: 'A', at: 5, newId: 'R' },
      { op: 'updateClip', clipId: 'R', set: { start: 0 } },
      { op: 'updateClip', clipId: 'A', set: { start: 5 } },
    ]);
    expect(mapPlayhead(antes, depois, 5)).toBeCloseTo(0, 6);
    expect(mapPlayhead(antes, depois, 5.00001)).toBeCloseTo(0.00001, 6);
    expect(mapPlayhead(antes, depois, 4.99999)).toBeCloseTo(9.99999, 6);
    expect(mapPlayhead(depois, antes, 0)).toBeCloseTo(5, 6);
    expect(mapPlayhead(depois, antes, 5)).toBeCloseTo(0, 6);
  });
  it('dividir e levar o pedaço da direita para longe: o ponto da divisão vai até ele, não para o buraco', () => {
    const depois = run(antes, [
      { op: 'splitClip', clipId: 'A', at: 5, newId: 'R' },
      { op: 'updateClip', clipId: 'R', set: { start: 20 } },
    ]);
    expect(mapPlayhead(antes, depois, 5)).toBeCloseTo(20, 6);
    expect(mapPlayhead(depois, antes, 20)).toBeCloseTo(5, 6);
  });
  it('Ctrl+B num quadro a 59,94 qps e o pedaço da direita movido: o instante do quadro vai para o pedaço da direita', () => {
    // O quadro 221 cai em 3,6870167 s e a divisão fica em 3,687 (1 ms): o quadro já é do pedaço da direita.
    const F = (221 * 1001) / 60000;
    const depois = run(antes, [
      { op: 'splitClip', clipId: 'A', at: 3.687, newId: 'R' },
      { op: 'updateClip', clipId: 'R', set: { start: 12 } },
    ]);
    expect(mapPlayhead(antes, depois, F)).toBeCloseTo(12 + (F - 3.687), 6);
  });

  it('propriedade, com conteúdo único: dividir e mudar os pedaços de lugar; nas duas direções a agulha vai para o pedaço que mostra o mesmo instante do arquivo', () => {
    // O mesmo sorteio exato em 32 bits da outra propriedade, com outra semente.
    let seed = 2718;
    const rnd = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed / 2147483648;
    };
    const isVideo = (c: Clip): c is VideoClip => c.kind === 'video';
    const bad: string[] = [];
    let drafts = 0;
    let skipped = 0;
    let splitTotal = 0;
    let checks = 0;
    for (let n = 0; n < 300; n++) {
      // m1 e m2 (20 s cada) em pedaços seguidos de 0,3 a 3,3 s no grid de 1 ms: nenhum instante do arquivo se repete.
      const chunks: { m: 'm1' | 'm2'; in: number; d: number }[] = [];
      for (const m of ['m1', 'm2'] as const)
        for (let at = 0; round(20 - at) >= 0.3; at = round(at + chunks[chunks.length - 1].d)) chunks.push({ m, in: at, d: Math.min(round(0.3 + rnd() * 3), round(20 - at)) });
      for (let i = chunks.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [chunks[i], chunks[j]] = [chunks[j], chunks[i]];
      }
      // De 1 a 4 pedaços, encostados a partir do zero.
      const list: [string, number, number, number, 'm1' | 'm2'][] = [];
      let end = 0;
      for (const c of chunks.slice(0, 1 + Math.floor(rnd() * 4))) {
        list.push([`p${list.length}`, end, c.d, c.in, c.m]);
        end = round(end + c.d);
      }
      const antes = videos(list);
      const splits: [string, number, string][] = [];
      const order: string[] = [];
      let depois: Project;
      try {
        // De 1 a 3 divisões, uma de cada vez: num vídeo de mais de 0,1 s, no grid de 1 ms, a pelo menos 0,04 s das pontas.
        let cur = antes;
        for (let k = 1 + Math.floor(rnd() * 3); k > 0; k--) {
          const long = cur.clips.filter((c): c is VideoClip => isVideo(c) && c.duration > 0.1);
          if (!long.length) break;
          const v = long[Math.floor(rnd() * long.length)];
          const at = round(v.start + 0.04 + Math.floor(rnd() * (Math.round((v.duration - 0.08) * 1000) + 1)) / 1000);
          const newId = `d${splits.length}`;
          splits.push([v.id, at, newId]);
          cur = run(cur, [{ op: 'splitClip', clipId: v.id, at, newId }]);
        }
        // Todos os vídeos em outra ordem, encostados de novo a partir do zero.
        const vids = cur.clips.filter(isVideo);
        for (let i = vids.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1));
          [vids[i], vids[j]] = [vids[j], vids[i]];
        }
        const moves: Op[] = [];
        let pos = 0;
        for (const c of vids) {
          moves.push({ op: 'updateClip', clipId: c.id, set: { start: pos } });
          order.push(c.id);
          pos = round(pos + c.duration);
        }
        depois = run(cur, moves);
      } catch (e) {
        // Só pula o rascunho que applyOps recusou; qualquer outro erro é do teste e tem de aparecer.
        if (!(e instanceof OpValidationError)) throw e;
        skipped++;
        continue;
      }
      drafts++;
      splitTotal += splits.length;
      const where = `pedaços ${JSON.stringify(list)} divisões ${JSON.stringify(splits)} ordem ${JSON.stringify(order)}`;
      /** A agulha de `from` para `to` em t contra o único pedaço de `to` que mostra o mesmo instante do arquivo (meio-aberto com a folga de isActiveAt). */
      const check = (dir: string, from: Project, to: Project, t: number) => {
        const p = from.clips.find((c): c is VideoClip => isVideo(c) && isActiveAt(c, t));
        if (!p) return;
        checks++;
        const src = p.in + (t - p.start);
        const q = to.clips.filter((c): c is VideoClip => isVideo(c) && c.mediaId === p.mediaId && c.in - ACTIVE_EPS <= src && src < c.in + c.duration - ACTIVE_EPS);
        if (q.length !== 1) {
          bad.push(`${dir} t=${t}: ${q.length} pedaços mostram ${src} | ${where}`);
          return;
        }
        const want = q[0].start + (src - q[0].in);
        const got = mapPlayhead(from, to, t);
        if (!(Math.abs(got - want) <= 0.002)) bad.push(`${dir} t=${t}: ${got} em vez de ${want} | ${where}`);
      };
      for (let k = 0, t = 0.0137; t < end; t = 0.0137 + ++k * 0.0731) {
        check('Antes→Depois', antes, depois, t);
        check('Depois→Antes', depois, antes, t);
      }
      // Sondas: as pontas de cada vídeo das duas versões e, em Antes, a volta de cada ponto de divisão.
      const edges = (version: Project) =>
        version.clips.filter(isVideo).flatMap((c) => [c.start, c.start + 2e-9, c.start + 1e-5, c.start + c.duration - 1e-5, c.start + c.duration - 3e-6]);
      for (const t of edges(antes)) check('Antes→Depois', antes, depois, t);
      for (const t of edges(depois)) check('Depois→Antes', depois, antes, t);
      for (const [, at] of splits) for (const t of [at, at + 2e-9, at + 1e-5, at - 1e-5, at - 3e-6]) check('Antes→Depois', antes, depois, t);
    }
    expect(bad.slice(0, 5), `${bad.length} errados em ${checks} conferências (${drafts} rascunhos, ${skipped} pulados, ${splitTotal} divisões)`).toEqual([]);
    expect(checks).toBeGreaterThan(40000);
    expect(splitTotal).toBeGreaterThan(400);
  });
});
