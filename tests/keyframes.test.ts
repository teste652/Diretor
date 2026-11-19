import { describe, expect, it } from 'vitest';
import { cutKeyframes, partitionKeyframes } from '../src/core/keyframes';
import { type AnimProp, type Clip, createProject, findClip } from '../src/core/model';
import { applyOps } from '../src/core/operations';
import { evalProp } from '../src/core/properties';
import { round, snapToFrame } from '../src/core/time';

// Título [0,4): x feito à mão a(1→0) e b(3→400); entrada fadeIn 0,5; saída fadeOut 0,5.
function titulo(): Clip {
  const p = applyOps(createProject(), [
    { op: 'addClip', clip: { kind: 'title', id: 't', text: 'A', start: 0, duration: 4 } },
    { op: 'setKeyframe', clipId: 't', prop: 'x', t: 1, v: 0, ease: 'linear', keyframeId: 'a' },
    { op: 'setKeyframe', clipId: 't', prop: 'x', t: 3, v: 400, ease: 'linear', keyframeId: 'b' },
    { op: 'animate', clipId: 't', preset: 'fadeIn', duration: 0.5 },
    { op: 'animate', clipId: 't', preset: 'fadeOut', duration: 0.5 },
  ]).project;
  return findClip(p, 't')!;
}
function tituloComFades(): Clip {
  const p = applyOps(createProject(), [
    { op: 'addClip', clip: { kind: 'title', id: 't', text: 'A', start: 0, duration: 4 } },
    { op: 'animate', clipId: 't', preset: 'fadeIn', duration: 0.6 },
    { op: 'animate', clipId: 't', preset: 'fadeOut', duration: 0.6 },
  ]).project;
  return findClip(p, 't')!;
}
// Entrada linear de 0,6 s e uma saída feita à mão: 1 em 0,6 até 0 em 4 (camadas diferentes na emenda).
function fadeComSaidaManual(): Clip {
  const p = applyOps(createProject(), [
    { op: 'addClip', clip: { kind: 'title', id: 't', text: 'A', start: 0, duration: 4 } },
    { op: 'animate', clipId: 't', preset: 'fadeIn', duration: 0.6, ease: 'linear' },
    { op: 'setKeyframe', clipId: 't', prop: 'opacity', t: 4, v: 0, ease: 'linear' },
  ]).project;
  return findClip(p, 't')!;
}
function projetoCom(c: Clip) {
  const p = applyOps(createProject(), [{ op: 'addClip', clip: { kind: 'title', id: 't', text: 'A', start: 0, duration: 4 } }]).project;
  findClip(p, 't')!.props = structuredClone(c.props);
  return p;
}
const valor = (props: Record<string, AnimProp>, nome: string, t: number) => evalProp(props[nome], t, 0);
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
    const c = titulo();
    const props = cutKeyframes(c, 1.5, 2.5);
    for (const t of [0, 0.5, 1, 1.25, 1.49]) expect(valor(props, 'x', t)).toBeCloseTo(valor(c.props, 'x', t), 6);
    for (const t of [1.5, 1.75, 2, 2.5, 2.99]) expect(valor(props, 'x', t)).toBeCloseTo(valor(c.props, 'x', t + 1), 6);
    expect(pts(props.opacity).filter((k) => k[2] === 'entrada')).toEqual([[0, 0, 'entrada'], [0.5, 1, 'entrada']]);
    expect(pts(props.opacity).filter((k) => k[2] === 'saida')).toEqual([[2.5, 1, 'saida'], [3, 0, 'saida']]);
  });

  it('apagar [1, 3]: o que vinha antes e o que vem depois ficam com os seus valores (degrau)', () => {
    const props = cutKeyframes(titulo(), 1, 3);
    expect(pts(props.x)).toEqual([[1, 0, null], [1, 400, null]]);
    expect(valor(props, 'x', 0.5)).toBe(0);
    expect(valor(props, 'x', 1.5)).toBe(400);
  });

  it('dividir com camadas diferentes na emenda: cada lado desenha como o original', () => {
    const c = fadeComSaidaManual();
    const { left, right } = partitionKeyframes(c, 2);
    for (const t of [0, 0.3, 0.6, 1.3, 1.99, 2]) expect(valor(left, 'opacity', t)).toBeCloseTo(valor(c.props, 'opacity', t), 6);
    for (const u of [0, 0.5, 1, 2]) expect(valor(right, 'opacity', u)).toBeCloseTo(valor(c.props, 'opacity', 2 + u), 6);
  });

  it('apagar do começo equivale a aparar o começo', () => {
    const c = tituloComFades();
    const aparado = findClip(applyOps(projetoCom(c), [{ op: 'trimClip', clipId: 't', edge: 'start', delta: 1, ripple: false }]).project, 't')!;
    const props = cutKeyframes(c, 0, 1);
    expect(props).toEqual(aparado.props);
    expect(valor(props, 'opacity', 1)).toBe(1);
    expect(valor(props, 'opacity', 2)).toBe(1);
    expect(valor(props, 'opacity', 0)).toBe(0);
  });

  it('apagar do fim equivale a aparar o fim', () => {
    const c = tituloComFades();
    const aparado = findClip(applyOps(projetoCom(c), [{ op: 'trimClip', clipId: 't', edge: 'end', delta: -1, ripple: false }]).project, 't')!;
    const props = cutKeyframes(c, 3, 4);
    expect(props).toEqual(aparado.props);
    expect(valor(props, 'opacity', 1)).toBe(1);
    expect(valor(props, 'opacity', 2)).toBe(1);
  });

  it('apagar atravessando as duas animações: o título não some', () => {
    const props = cutKeyframes(tituloComFades(), 0.3, 3.7);
    expect(valor(props, 'opacity', 0.3)).toBeGreaterThan(0.5);
  });

  it('nenhuma das duas altera o clipe e propriedades sem pontos saem iguais', () => {
    const c = titulo();
    const antes = structuredClone(c);
    const { left, right } = partitionKeyframes(c, 2);
    const cortado = cutKeyframes(c, 1.5, 2.5);
    expect(c).toEqual(antes);
    expect(left.scale).toEqual(c.props.scale);
    expect(right.scale).toEqual(c.props.scale);
    expect(cortado.scale).toEqual(c.props.scale);
  });

  it('tempo em ms e quadro mais próximo', () => {
    expect(round(1.23456)).toBe(1.235);
    expect(snapToFrame(2.01, 30)).toBeCloseTo(2, 9);
  });
});
