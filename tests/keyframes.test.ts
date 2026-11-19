import { describe, expect, it } from 'vitest';
import { cutKeyframes, partitionKeyframes } from '../src/core/keyframes';
import { type AnimProp, type Clip, createProject, findClip } from '../src/core/model';
import { applyOps } from '../src/core/operations';
import { round, snapToFrame } from '../src/core/time';

// Título [0,4): x feito à mão a(1→0) e b(3→400); entrada fadeIn 0,5; saída fadeOut 0,5.
function titulo(): Clip {
  const p = applyOps(createProject(), [
    { op: 'addClip', clip: { kind: 'title', id: 't', text: 'A', start: 0, duration: 4 } },
    { op: 'setKeyframe', clipId: 't', prop: 'x', t: 1, v: 0, keyframeId: 'a' },
    { op: 'setKeyframe', clipId: 't', prop: 'x', t: 3, v: 400, keyframeId: 'b' },
    { op: 'animate', clipId: 't', preset: 'fadeIn', duration: 0.5 },
    { op: 'animate', clipId: 't', preset: 'fadeOut', duration: 0.5 },
  ]).project;
  return findClip(p, 't')!;
}
const pts = (ap: AnimProp) => ap.keyframes.map((k) => [k.t, Math.round(k.v * 1000) / 1000, k.group ?? null]);

describe('keyframes ao dividir e cortar', () => {
  it('dividir em 2: cada lado fica com a sua parte e um ponto na borda com o valor de lá', () => {
    const { left, right } = partitionKeyframes(titulo(), 2);
    expect(pts(left.x)).toEqual([[1, 0, null], [2, 200, null]]);
    expect(pts(right.x)).toEqual([[0, 200, null], [1, 400, null]]);
    expect(pts(left.opacity)).toEqual([[0, 0, 'entrada'], [0.5, 1, 'entrada'], [2, 1, 'saida']]);
    expect(pts(right.opacity)).toEqual([[0, 1, 'entrada'], [1.5, 1, 'saida'], [2, 0, 'saida']]);
  });

  it('apagar [1,5; 2,5]: some o que está dentro e o resto anda junto', () => {
    const props = cutKeyframes(titulo(), 1.5, 2.5);
    expect(pts(props.x)).toEqual([[1, 0, null], [2, 400, null]]);
    expect(pts(props.opacity).filter((k) => k[2] === 'saida')).toEqual([[2.5, 1, 'saida'], [3, 0, 'saida']]);
  });

  it('dois pontos do mesmo grupo no mesmo instante depois do corte: fica o de antes', () => {
    expect(pts(cutKeyframes(titulo(), 1, 3).x)).toEqual([[1, 0, null]]);
  });

  it('tempo em ms e quadro mais próximo', () => {
    expect(round(1.23456)).toBe(1.235);
    expect(snapToFrame(2.01, 30)).toBeCloseTo(2, 9);
  });
});
