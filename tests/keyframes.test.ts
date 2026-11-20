import { describe, expect, it } from 'vitest';
import { cutKeyframes, partitionKeyframes } from '../src/core/keyframes';
import { type AnimProp, type Clip, createProject, findClip } from '../src/core/model';
import { applyOps } from '../src/core/operations';
import { evalProp, sortedKeyframes } from '../src/core/properties';
import { round, snapToFrame } from '../src/core/time';

type O = Parameters<typeof applyOps>[1][number];
function clip(...ops: O[]): Clip {
  const p = applyOps(createProject(), [{ op: 'addClip', clip: { kind: 'title', id: 't', text: 'A', start: 0, duration: 4 } }, ...ops]).project;
  return findClip(p, 't')!;
}
const kf = (prop: string, t: number, v: number, ease: 'linear' | 'hold', extra: { group?: string; keyframeId?: string } = {}): O => ({
  op: 'setKeyframe', clipId: 't', prop, t, v, ease, keyframeId: `h-${prop}-${t}`, ...extra,
});
const anima = (preset: string, duration: number, ease?: 'linear'): O => ({ op: 'animate', clipId: 't', preset: preset as never, duration, ...(ease ? { ease } : {}) });

// Título [0,4): x feito à mão a(1→0) e b(3→400); entrada fadeIn 0,5; saída fadeOut 0,5.
const titulo = () => clip(kf('x', 1, 0, 'linear', { keyframeId: 'a' }), kf('x', 3, 400, 'linear', { keyframeId: 'b' }), anima('fadeIn', 0.5), anima('fadeOut', 0.5));
const tituloComFades = () => clip(anima('fadeIn', 0.6), anima('fadeOut', 0.6));
// Entrada linear de 0,6 s e uma saída feita à mão: 1 em 0,6 até 0 em 4 (camadas diferentes na emenda).
const fadeComSaidaManual = () => clip(anima('fadeIn', 0.6, 'linear'), kf('opacity', 4, 0, 'linear'));
function projetoCom(c: Clip) {
  const p = applyOps(createProject(), [{ op: 'addClip', clip: { kind: 'title', id: 't', text: 'A', start: 0, duration: 4 } }]).project;
  findClip(p, 't')!.props = structuredClone(c.props);
  return p;
}
const valor = (props: Record<string, AnimProp>, nome: string, t: number) => evalProp(props[nome], t, 0);
const pts = (ap: AnimProp) => ap.keyframes.map((k) => [k.t, Math.round(k.v * 1000) / 1000, k.group ?? null]);
const ordenado = (...ps: Record<string, AnimProp>[]) => {
  for (const props of ps) for (const ap of Object.values(props)) expect(sortedKeyframes(ap.keyframes)).toEqual(ap.keyframes);
};
/** Divide em `at` e confere que cada lado desenha como o original. */
function confereDivisao(c: Clip, prop: string, at: number, esq: number[], dir: number[]) {
  const { left, right } = partitionKeyframes(c, at);
  ordenado(left, right);
  for (const t of esq) expect(valor(left, prop, t)).toBeCloseTo(valor(c.props, prop, t), 6);
  for (const u of dir) expect(valor(right, prop, u)).toBeCloseTo(valor(c.props, prop, at + u), 6);
  return { left, right };
}
/** Corta [t0,t1] e confere que o que fica desenha como o original. */
function confereCorte(c: Clip, prop: string, t0: number, t1: number, antes: number[], depois: number[]) {
  const props = cutKeyframes(c, t0, t1);
  ordenado(props);
  for (const t of antes) expect(valor(props, prop, t)).toBeCloseTo(valor(c.props, prop, t), 6);
  for (const t of depois) expect(valor(props, prop, t)).toBeCloseTo(valor(c.props, prop, t + (t1 - t0)), 6);
  return props;
}

describe('keyframes ao dividir', () => {
  it('dividir em 2: o que cruza a emenda ganha ponto de borda; o que é plano não', () => {
    const { left, right } = partitionKeyframes(titulo(), 2);
    ordenado(left, right);
    expect(pts(left.x)).toEqual([[1, 0, null], [2, 200, null]]);
    expect(pts(right.x)).toEqual([[0, 200, null], [1, 400, null]]);
    expect(pts(left.opacity)).toEqual([[0, 0, 'entrada'], [0.5, 1, 'entrada']]);
    expect(pts(right.opacity)).toEqual([[1.5, 1, 'saida'], [2, 0, 'saida']]);
  });

  it('cada lado desenha como o original, mesmo com camadas diferentes na emenda', () => {
    confereDivisao(fadeComSaidaManual(), 'opacity', 2, [0, 0.3, 0.6, 1.3, 1.99, 2], [0, 0.5, 1, 2]);
    const { right } = partitionKeyframes(fadeComSaidaManual(), 2);
    expect(right.opacity.keyframes[0].group).toBeUndefined();
  });

  it('trecho parado (hold) continua parado depois da divisão', () => {
    const c = clip(kf('x', 0.5, 0, 'hold'), kf('x', 3, 400, 'linear'));
    const { right } = confereDivisao(c, 'x', 2, [0.4, 1, 1.99], [0, 0.5, 0.99, 1]);
    expect([0, 0.5, 0.99].map((u) => valor(right, 'x', u))).toEqual([0, 0, 0]);
    expect(valor(right, 'x', 1)).toBe(400);
  });

  it('salto exatamente na emenda', () => {
    const c = clip(anima('fadeIn', 2, 'linear'), kf('opacity', 1.5, 0.75, 'linear'), kf('opacity', 2, 0.2, 'linear'), kf('opacity', 3, 0.2, 'linear'));
    expect(valor(c.props, 'opacity', 2 - 1e-9)).toBeCloseTo(1, 6);
    expect(valor(c.props, 'opacity', 2)).toBeCloseTo(0.2, 6);
    confereDivisao(c, 'opacity', 2, [1.6, 1.8, 1.99], [0, 0.5, 1]);
  });

  it('ponto manual de parada junto de um slowZoom', () => {
    const c = clip(anima('slowZoom', 4), kf('scale', 1, 1.3, 'hold'));
    confereDivisao(c, 'scale', 2, [0.5, 1.5], [0.5, 1, 1.9]);
  });

  it('sem pontos soltos: entrada só e saída só não deixam ponto do outro lado', () => {
    const e = partitionKeyframes(clip(anima('fadeIn', 0.6)), 2);
    expect(e.right.opacity.keyframes).toEqual([]);
    expect(valor(e.right, 'opacity', 0)).toBe(1);
    const s = partitionKeyframes(clip(anima('fadeOut', 0.6)), 2);
    expect(s.left.opacity.keyframes).toEqual([]);
  });

  it('slowZoom sozinho: os dois lados mantêm o grupo e desenham como o original', () => {
    const c = clip(anima('slowZoom', 4));
    const { left, right } = confereDivisao(c, 'scale', 2, [0, 1, 2], [0, 1, 2]);
    for (const k of [...left.scale.keyframes, ...right.scale.keyframes]) expect(k.group).toBe('slowZoom');
  });
});

describe('keyframes ao cortar', () => {
  it('apagar [1,5; 2,5]: some o que está dentro e o resto anda junto', () => {
    const c = titulo();
    const props = confereCorte(c, 'x', 1.5, 2.5, [0, 0.5, 1, 1.25, 1.49], [1.5, 1.75, 2, 2.5, 2.99]);
    expect(pts(props.opacity).filter((k) => k[2] === 'entrada')).toEqual([[0, 0, 'entrada'], [0.5, 1, 'entrada']]);
    expect(pts(props.opacity).filter((k) => k[2] === 'saida')).toEqual([[2.5, 1, 'saida'], [3, 0, 'saida']]);
  });

  it('apagar [1, 3]: o que vinha antes e o que vem depois ficam com os seus valores (degrau)', () => {
    const props = cutKeyframes(titulo(), 1, 3);
    expect(pts(props.x)).toEqual([[1, 0, null], [1, 400, null]]);
    expect(valor(props, 'x', 0.5)).toBe(0);
    expect(valor(props, 'x', 1.5)).toBe(400);
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
    expect(valor(cutKeyframes(tituloComFades(), 0.3, 3.7), 'opacity', 0.3)).toBeGreaterThan(0.5);
  });

  it('camada solta e entrada linear: o que fica desenha como o original', () => {
    confereCorte(fadeComSaidaManual(), 'opacity', 1, 2, [0, 0.5, 0.9, 0.999], [1, 1.5, 2, 2.9]);
  });

  it('slideLeftIn e um ponto arrastado', () => {
    const c = clip(anima('slideLeftIn', 0.6, 'linear'), kf('x', 3, 500, 'linear'));
    confereCorte(c, 'x', 1, 2, [0, 0.3, 0.9, 0.99], [1, 1.5, 2, 2.9]);
  });

  it('platô parado (hold) continua parado', () => {
    const c = clip(kf('x', 1, 100, 'linear'), kf('x', 2, 100, 'hold'), kf('x', 3, 0, 'linear'));
    const props = confereCorte(c, 'x', 1.5, 2.5, [1, 1.4], [1.5, 1.75, 1.99, 2, 2.4]);
    for (const t of [1.5, 1.75, 1.99]) expect(valor(props, 'x', t)).toBe(100);
    expect(valor(props, 'x', 2)).toBe(0);
  });

  it('ponto meio milissegundo antes do fim do corte não se perde', () => {
    const T = 32 / 29.97;
    const c = clip(kf('x', 0.2, 0, 'linear'), kf('x', T, 400, 'linear'), kf('x', 2.5, 0, 'linear'));
    confereCorte(c, 'x', 0.5, round(T), [0.2, 0.4, 0.499], [0.515, 0.686, 0.858, 1.5]);
    const c2 = clip(kf('x', 0.2, 0, 'linear'), kf('x', 1, 400, 'linear'), kf('x', 2.5, 0, 'linear'));
    confereCorte(c2, 'x', 0.5, 1.001, [0.2, 0.4], [0.6, 0.9, 1.5]);
  });

  it('empate em t0 entre camadas: vale o valor de depois do corte', () => {
    const c = clip(kf('opacity', 0.3, 1, 'linear'), kf('opacity', 1, 0.3, 'linear'), anima('fadeIn', 0.5, 'linear'));
    const props = cutKeyframes(c, 0.5, 1.5);
    ordenado(props);
    expect(valor(props, 'opacity', 0.5)).toBeCloseTo(0.3, 6);
  });

  it('segmento entre camadas que atravessa o corte', () => {
    const c = clip(kf('x', 1, 0, 'linear'), kf('x', 2.5, 400, 'linear', { group: 'g' }), kf('x', 3, 200, 'linear', { group: 'g' }));
    confereCorte(c, 'x', 1.5, 2.5, [0, 1, 1.25, 1.49], [1.5, 1.75, 2, 2.5]);
  });

  it('cortes repetidos no mesmo ponto não acumulam pontos', () => {
    const c0 = clip(kf('x', 1, 0, 'linear'), kf('x', 3, 400, 'linear'));
    let props = c0.props;
    let dur = 4;
    for (let i = 0; i < 4; i++) {
      props = cutKeyframes({ ...c0, props, duration: dur }, 1.5, 1.8);
      dur = round(dur - 0.3);
    }
    expect(props.x.keyframes).toHaveLength(4);
    const unico = cutKeyframes(c0, 1.5, 2.7);
    for (const t of [0, 1, 1.4, 1.5, 1.6, 2]) expect(valor(props, 'x', t)).toBeCloseTo(valor(unico, 'x', t), 6);
  });

  it('ids das emendas continuam únicos depois de editar o ponto e cortar de novo', () => {
    const c0 = clip(kf('x', 1, 0, 'linear'), kf('x', 3, 400, 'linear'));
    const c1 = { ...c0, props: cutKeyframes(c0, 1.5, 1.8), duration: 3.7 };
    // O Inspetor edita o ponto que a prévia mostra em 1,5 (o "R"), o que descarta o "L".
    const p = projetoCom(c1);
    const editado = findClip(applyOps(p, [{ op: 'setKeyframe', clipId: 't', prop: 'x', t: 1.5, v: 300, keyframeId: 'x@1500>' }]).project, 't')!;
    const props = cutKeyframes(editado, 1.5, 1.8);
    ordenado(props);
    const ids = props.x.keyframes.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('x@1500>~2');
    for (const x of [0, 1, 1.4, 1.49]) expect(valor(props, 'x', x)).toBeCloseTo(valor(editado.props, 'x', x), 4);
    for (const x of [1.5, 1.6, 2]) expect(valor(props, 'x', x)).toBeCloseTo(valor(editado.props, 'x', x + 0.3), 4);
  });

  it('o mesmo corte duas vezes dá o mesmo resultado; nada é alterado', () => {
    const c = titulo();
    const antes = structuredClone(c);
    expect(cutKeyframes(c, 1, 3)).toEqual(cutKeyframes(c, 1, 3));
    const { left, right } = partitionKeyframes(c, 2);
    const cortado = cutKeyframes(c, 1.5, 2.5);
    expect(c).toEqual(antes);
    expect(left.scale).toEqual(c.props.scale);
    expect(right.scale).toEqual(c.props.scale);
    expect(cortado.scale).toEqual(c.props.scale);
  });
});

describe('tempo', () => {
  it('em ms e quadro mais próximo', () => {
    expect(round(1.23456)).toBe(1.235);
    expect(snapToFrame(2.01, 30)).toBeCloseTo(2, 9);
  });
});
