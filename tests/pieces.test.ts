import { describe, expect, it } from 'vitest';
import { type Project, type VideoClip, findClip } from '../src/core/model';
import { draftSeams, isContiguous, mapPlayhead } from '../src/core/pieces';
import { isActiveAt } from '../src/core/render';
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

  it('propriedade, com conteúdo único: Antes→Depois bate com mapTime e Depois→Antes com o pedaço que mostra o instante', () => {
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
      for (let k = 0, t = 0.0137; t < end; t = 0.0137 + ++k * 0.0731) {
        const want = mapTime(R, t);
        const got = mapPlayhead(antes, depois, t);
        instants++;
        if (!(Math.abs(got - want) <= 0.002)) bad.push(`Antes→Depois t=${t.toFixed(4)}: ${got} em vez de ${want} | ${where}`);
      }
      const shown = depois.clips.reduce((e, c) => Math.max(e, c.start + c.duration), 0);
      for (let k = 0, t = 0.0137; t < shown; t = 0.0137 + ++k * 0.0731) {
        const p = depois.clips.find((c): c is VideoClip => c.kind === 'video' && isActiveAt(c, t));
        if (!p) continue;
        // Instante do arquivo sem o ruído da soma (para a borda exata entre dois pedaços cair no da direita).
        const src = Math.round((p.in + (t - p.start)) * 1e9) / 1e9;
        const q = antes.clips.find((c): c is VideoClip => c.kind === 'video' && c.mediaId === p.mediaId && c.in <= src && src < c.in + c.duration);
        const got = mapPlayhead(depois, antes, t);
        instants++;
        if (!q) bad.push(`Depois→Antes t=${t.toFixed(4)}: nenhum pedaço de Antes mostra ${src} | ${where}`);
        else if (!(Math.abs(got - (q.start + (src - q.in))) <= 0.002)) bad.push(`Depois→Antes t=${t.toFixed(4)}: ${got} em vez de ${q.start + (src - q.in)} | ${where}`);
      }
    }
    expect(bad.slice(0, 5), `${bad.length} de ${instants} instantes errados`).toEqual([]);
    expect(drafts).toBe(300);
    expect(instants).toBeGreaterThan(20000);
  });
});
