import { describe, expect, it } from 'vitest';
import { findClip } from '../src/core/model';
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
