import { describe, expect, it } from 'vitest';
import { type Project, findClip } from '../src/core/model';
import { draftSeams, isContiguous, mapPlayhead } from '../src/core/pieces';
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
