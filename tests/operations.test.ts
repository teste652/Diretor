import { describe, expect, it } from 'vitest';
import { type Clip, type Project, createProject, findClip, parseProject } from '../src/core/model';
import { type Op, OpValidationError, applyOps, clampTrimDelta } from '../src/core/operations';
import { isContiguous } from '../src/core/pieces';
import { evalClipProp, keyframeAt, keyframeGroups, propAtPlayhead } from '../src/core/properties';

function base(): Project {
  return applyOps(createProject(), [
    { op: 'addMedia', media: { id: 'm1', path: 'C:/v/a.mp4', name: 'a.mp4', duration: 10, width: 1280, height: 720, hasAudio: true } },
    { op: 'addClip', clip: { kind: 'video', id: 'v1', mediaId: 'm1', start: 0, duration: 6 } },
    { op: 'addClip', clip: { kind: 'video', id: 'v2', mediaId: 'm1', start: 6, in: 6, duration: 3 } },
    { op: 'addClip', clip: { kind: 'title', id: 't1', text: 'OLÁ', start: 0, duration: 3 } },
    { op: 'addClip', clip: { kind: 'caption', id: 'c1', text: 'curta', start: 0, duration: 1.2 } },
  ]).project;
}

const run = (p: Project, ops: Op[]) => applyOps(p, ops).project;
const fails = (p: Project, ops: Op[]) => {
  try {
    applyOps(p, ops);
  } catch (e) {
    expect(e).toBeInstanceOf(OpValidationError);
    return (e as OpValidationError).message;
  }
  throw new Error('deveria ter sido recusado');
};
const clip = (p: Project, id: string) => findClip(p, id)!;
const at = (p: Project, id: string, prop: string, t: number) => evalClipProp(clip(p, id), prop, t);
const kfs = (c: Clip, prop: string) => c.props[prop].keyframes.map((k) => [k.t, Math.round(k.v * 1000) / 1000, k.group ?? null]);

describe('animações prontas combinadas', () => {
  it('popIn sobre slowZoom não apaga o zoom, e trocar a entrada devolve o zoom intacto', () => {
    let p = run(base(), [{ op: 'animate', clipId: 't1', preset: 'slowZoom' }]);
    p = run(p, [{ op: 'animate', clipId: 't1', preset: 'popIn', duration: 0.6 }]);
    const c = clip(p, 't1');
    expect(c.props.scale.keyframes).toHaveLength(4);
    expect(at(p, 't1', 'scale', 0)).toBeCloseTo(0.618, 3); // vale o popIn no começo
    expect(at(p, 't1', 'scale', 0.6)).toBeCloseTo(1.03, 3); // termina na curva do zoom
    expect(at(p, 't1', 'scale', 1.8)).toBeCloseTo(1.09, 3); // segue o zoom
    p = run(p, [{ op: 'animate', clipId: 't1', preset: 'fadeIn', group: 'entrada' }]);
    expect(kfs(clip(p, 't1'), 'scale')).toEqual([
      [0, 1, 'slowZoom'],
      [3, 1.15, 'slowZoom'],
    ]);
  });

  it('popOut e depois slowZoom: os dois ficam, nada começa encolhido', () => {
    let p = run(base(), [{ op: 'animate', clipId: 't1', preset: 'popOut', duration: 0.6 }]);
    p = run(p, [{ op: 'animate', clipId: 't1', preset: 'slowZoom' }]);
    expect(at(p, 't1', 'scale', 0)).toBeCloseTo(1, 5);
    expect(at(p, 't1', 'scale', 2.99)).toBeLessThan(0.62);
    expect(keyframeGroups(clip(p, 't1')).map((g) => g.group).sort()).toEqual(['saida', 'slowZoom']);
  });

  it('pontos feitos à mão sobrevivem a uma entrada no mesmo instante', () => {
    let p = run(base(), [
      { op: 'setKeyframe', clipId: 't1', prop: 'y', t: 0, v: -200 },
      { op: 'setKeyframe', clipId: 't1', prop: 'y', t: 2, v: 200 },
    ]);
    p = run(p, [{ op: 'animate', clipId: 't1', preset: 'slideUpIn' }]);
    p = run(p, [{ op: 'clearKeyframes', clipId: 't1', group: 'entrada' }]);
    expect(kfs(clip(p, 't1'), 'y')).toEqual([
      [0, -200, null],
      [2, 200, null],
    ]);
  });

  it('legenda curta com entrada e saída: refazer a saída não apaga a entrada', () => {
    let p = run(base(), [
      { op: 'animate', clipId: 'c1', preset: 'fadeIn' },
      { op: 'animate', clipId: 'c1', preset: 'fadeOut' },
    ]);
    p = run(p, [{ op: 'animate', clipId: 'c1', preset: 'fadeOut', duration: 0.4 }]);
    expect(at(p, 'c1', 'opacity', 0.3)).toBeGreaterThan(0.5);
    expect(at(p, 'c1', 'opacity', 0.7)).toBeCloseTo(1, 5);
    expect(at(p, 'c1', 'opacity', 1.18)).toBeLessThan(0.3); // saída de 0.4 s (0.8 → 1.2)
  });

  it('limpar todas as animações não deixa o clipe invisível nem com zoom', () => {
    let p = run(base(), [
      { op: 'animate', clipId: 't1', preset: 'fadeIn' },
      { op: 'animate', clipId: 't1', preset: 'popOut' },
      { op: 'animate', clipId: 't1', preset: 'slowZoom' },
    ]);
    p = run(p, [{ op: 'clearKeyframes', clipId: 't1' }]);
    expect(at(p, 't1', 'opacity', 1)).toBe(1);
    expect(at(p, 't1', 'scale', 1)).toBe(1);
  });

  it('reaplicar é idempotente (zoom e saída com nome acentuado)', () => {
    let p = base();
    for (let i = 0; i < 3; i++) p = run(p, [{ op: 'animate', clipId: 't1', preset: 'slowZoom' }]);
    expect(kfs(clip(p, 't1'), 'scale')).toEqual([
      [0, 1, 'slowZoom'],
      [3, 1.15, 'slowZoom'],
    ]);
    for (let i = 0; i < 3; i++) p = run(p, [{ op: 'animate', clipId: 't1', preset: 'fadeOut', group: 'saída' }]);
    expect(at(p, 't1', 'opacity', 0)).toBe(1);
    expect(at(p, 't1', 'opacity', 1.5)).toBe(1);
  });

  it('o último ponto nunca passa do fim do clipe por arredondamento', () => {
    let p = run(base(), [{ op: 'updateClip', clipId: 't1', set: { duration: 2.0336 } }]);
    p = run(p, [
      { op: 'animate', clipId: 't1', preset: 'fadeOut' },
      { op: 'animate', clipId: 't1', preset: 'slowZoom' },
    ]);
    for (const k of clip(p, 't1').props.opacity.keyframes) expect(k.t).toBeLessThanOrEqual(2.0336);
  });

  it('padrões iguais na validação e na expansão', () => {
    const p = run(base(), [{ op: 'animate', clipId: 't1', preset: 'slowZoom', start: 1 }]);
    expect(kfs(clip(p, 't1'), 'scale').map((k) => k[0])).toEqual([1, 3]);
    const short = run(base(), [{ op: 'updateClip', clipId: 'c1', set: { duration: 0.4 } }]);
    expect(() => run(short, [{ op: 'animate', clipId: 'c1', preset: 'fadeIn' }])).not.toThrow();
  });
});

describe('validação estrita', () => {
  it('updateClip: null, campo desconhecido, set ausente e tipos errados', () => {
    const p = base();
    expect(fails(p, [{ op: 'updateClip', clipId: 't1', set: { start: null } } as unknown as Op])).toMatch(/null/);
    expect(fails(p, [{ op: 'updateClip', clipId: 't1', set: { cor: 'x' } } as unknown as Op])).toMatch(/desconhecido/);
    expect(fails(p, [{ op: 'updateClip', clipId: 't1' } as unknown as Op])).toMatch(/set/);
    expect(fails(p, [{ op: 'updateClip', clipId: 'v1', set: { muted: 'false' } } as unknown as Op])).toMatch(/muted/);
    expect(fails(p, [{ op: 'updateClip', clipId: 'v1', set: { text: 'x' } }])).toMatch(/vídeo/);
    expect(fails(p, [{ op: 'updateClip', clipId: 'c1', set: { preset: 'neon' } } as unknown as Op])).toMatch(/preset/);
    expect(fails(p, [{ op: 'updateClip', clipId: 'v1', set: { volume: 1.5 } }])).toMatch(/volume/);
  });

  it('campo com nome errado é recusado em qualquer operação, não ignorado', () => {
    const p = base();
    expect(fails(p, [{ op: 'addClip', clip: { kind: 'caption', text: 'Olá', start: 1, end: 4.5 } as never }])).toMatch(/Campo desconhecido em clip: end/);
    expect(fails(p, [{ op: 'addClip', clip: { kind: 'title', text: 'x', fontSize: 120 } as never }])).toMatch(/fontSize/);
    expect(fails(p, [{ op: 'setKeyframe', clipId: 't1', prop: 'x', t: 0, v: 1, easing: 'linear' } as never])).toMatch(/Campo desconhecido em setKeyframe: easing/);
    expect(fails(p, [{ op: 'animate', clipId: 't1', preset: 'fadeIn', length: 2 } as never])).toMatch(/length/);
    expect(fails(p, [{ op: 'updateClip', clipId: 't1', set: { start: 1 }, duraton: 3 } as never])).toMatch(/duraton/);
    expect(fails(p, [{ op: 'trimClip', clipId: 'v1', edge: 'end', delta: -1, ripple: 'no' } as never])).toMatch(/ripple/);
    // o que a interface manda continua valendo (inclusive campos opcionais ausentes)
    expect(() => run(p, [{ op: 'setKeyframe', clipId: 't1', prop: 'x', t: 0, v: 1, keyframeId: undefined }])).not.toThrow();
  });

  it('valores e propriedades obrigatórios', () => {
    const p = base();
    expect(fails(p, [{ op: 'setKeyframe', clipId: 't1', prop: 'x', t: 0 } as unknown as Op])).toMatch(/v deve/);
    expect(fails(p, [{ op: 'setProperty', clipId: 't1', prop: 'x' } as unknown as Op])).toMatch(/value/);
    expect(fails(p, [{ op: 'setKeyframe', clipId: 't1', t: 0, v: 1 } as unknown as Op])).toMatch(/prop/);
    expect(fails(p, [{ op: 'setKeyframe', clipId: 't1', prop: 'x', t: 0, v: 1, ease: '' } as unknown as Op])).toMatch(/ease/);
    expect(fails(p, [{ op: 'setKeyframe', clipId: 't1', prop: 'x', t: 0, v: 1, group: '' }])).toMatch(/group/);
    expect(fails(p, [{ op: 'clearKeyframes', clipId: 't1', group: '' }])).toMatch(/group/);
  });

  it('addClip: texto, estilo e vídeo além do arquivo', () => {
    const p = base();
    expect(fails(p, [{ op: 'addClip', clip: { kind: 'title', text: 42 } } as unknown as Op])).toMatch(/text/);
    expect(fails(p, [{ op: 'addClip', clip: { kind: 'title', style: { fontSize: -5 } } }])).toMatch(/fontSize/);
    expect(fails(p, [{ op: 'addClip', clip: { kind: 'title', style: { color: 'url(x)' } } }])).toMatch(/color/);
    expect(fails(p, [{ op: 'addClip', clip: { kind: 'video', mediaId: 'm1', in: 12 } }])).toMatch(/in deve/);
    expect(fails(p, [{ op: 'addClip', clip: { kind: 'video', mediaId: 'm1', text: 'x' } }])).toMatch(/vídeo/);
    expect(() => run(p, [{ op: 'addClip', clip: { kind: 'title', style: { color: '#fff', background: '' } } }])).not.toThrow();
  });

  it('retimeGroup não aceita duração zero; setProperty em propriedade animada explica o que fazer', () => {
    const p = run(base(), [{ op: 'animate', clipId: 't1', preset: 'fadeIn' }]);
    expect(fails(p, [{ op: 'retimeGroup', clipId: 't1', group: 'entrada', start: 0, duration: 0 }])).toMatch(/pelo menos/);
    expect(fails(p, [{ op: 'setProperty', clipId: 't1', prop: 'opacity', value: 0.5 }])).toMatch(/setKeyframe/);
  });
});

describe('pontos de animação', () => {
  it('arrastar um ponto para cima de outro do mesmo grupo junta os dois; de outro grupo, convivem', () => {
    let p = run(base(), [
      { op: 'setKeyframe', clipId: 't1', prop: 'x', t: 0, v: 0, keyframeId: 'a' },
      { op: 'setKeyframe', clipId: 't1', prop: 'x', t: 1, v: 100, keyframeId: 'b' },
    ]);
    p = run(p, [{ op: 'setKeyframe', clipId: 't1', prop: 'x', t: 1, v: 50, keyframeId: 'a' }]);
    expect(clip(p, 't1').props.x.keyframes.map((k) => k.id)).toEqual(['a']);
    p = run(p, [{ op: 'setKeyframe', clipId: 't1', prop: 'x', t: 2, v: 10, group: 'g', keyframeId: 'c' }]);
    p = run(p, [{ op: 'setKeyframe', clipId: 't1', prop: 'x', t: 2, v: 10, keyframeId: 'a' }]);
    expect(clip(p, 't1').props.x.keyframes.map((k) => k.id).sort()).toEqual(['a', 'c']);
  });

  it('com dois grupos no mesmo instante, o painel edita o ponto que a prévia mostra', () => {
    const p = run(base(), [
      { op: 'animate', clipId: 'c1', preset: 'fadeIn' },
      { op: 'animate', clipId: 'c1', preset: 'fadeOut' },
    ]);
    const ap = clip(p, 'c1').props.opacity;
    const shared = ap.keyframes.find((k) => ap.keyframes.some((o) => o !== k && Math.abs(o.t - k.t) < 1e-3))!;
    const same = ap.keyframes.filter((k) => Math.abs(k.t - shared.t) < 1e-3);
    expect(same).toHaveLength(2);
    const shown = keyframeAt(ap, shared.t)!;
    const edit = (id: string) => run(p, [{ op: 'setKeyframe', clipId: 'c1', prop: 'opacity', t: shared.t, v: 0.3, keyframeId: id }]);
    expect(at(edit(shown.id), 'c1', 'opacity', shared.t)).toBeCloseTo(0.3, 5);
    // O primeiro ponto do instante (o que o painel pegava antes) não muda o valor mostrado.
    const hidden = same.find((k) => k.id !== shown.id)!;
    expect(at(edit(hidden.id), 'c1', 'opacity', shared.t)).toBeCloseTo(1, 5);

    const q = run(base(), [
      { op: 'animate', clipId: 't1', preset: 'slowZoom' },
      { op: 'animate', clipId: 't1', preset: 'popIn' },
    ]);
    expect(keyframeAt(clip(q, 't1').props.scale, 0)!.v).toBeCloseTo(at(q, 't1', 'scale', 0), 5);
  });

  it('o painel mostra o valor e o ponto do mesmo instante, mesmo com o playhead fora do clipe', () => {
    // Título começando em 2 s com zoom lento e depois "surgir crescendo": dois pontos de escala em 0.
    const p = run(base(), [
      { op: 'updateClip', clipId: 't1', set: { start: 2 } },
      { op: 'animate', clipId: 't1', preset: 'slowZoom' },
      { op: 'animate', clipId: 't1', preset: 'popIn' },
    ]);
    const t1 = clip(p, 't1');
    // Playhead antes do clipe: o painel edita o começo do clipe, e o número é o do ponto que ele vai editar.
    const before = propAtPlayhead(t1, 'scale', 1);
    expect(before.local).toBe(0);
    expect(before.keyframe?.group).toBe('entrada');
    expect(before.value).toBeCloseTo(before.keyframe!.v, 5);
    expect(before.value).toBeCloseTo(at(p, 't1', 'scale', 2), 5); // o que a prévia mostra no começo do clipe
    expect(before.value).toBeLessThan(0.7);
    // Playhead depois do clipe: o fim do zoom.
    const after = propAtPlayhead(t1, 'scale', 9);
    expect(after.local).toBe(3);
    expect(after.keyframe?.group).toBe('slowZoom');
    expect(after.value).toBeCloseTo(after.keyframe!.v, 5);
    // Dentro do clipe, entre pontos: o valor da prévia e nenhum ponto.
    const mid = propAtPlayhead(t1, 'scale', 3.5);
    expect(mid.keyframe).toBeUndefined();
    expect(mid.value).toBeCloseTo(at(p, 't1', 'scale', 3.5), 5);
  });

  it('remover o último ponto feito à mão mantém o valor que ele mostrava', () => {
    let p = run(base(), [{ op: 'setKeyframe', clipId: 't1', prop: 'opacity', t: 1, v: 0.4, keyframeId: 'k' }]);
    p = run(p, [{ op: 'removeKeyframe', clipId: 't1', prop: 'opacity', keyframeId: 'k' }]);
    expect(at(p, 't1', 'opacity', 2)).toBeCloseTo(0.4, 5);
  });
});

describe('aparar', () => {
  const animated = () =>
    run(base(), [
      { op: 'animate', clipId: 'v1', preset: 'fadeIn' },
      { op: 'animate', clipId: 'v1', preset: 'fadeOut' },
      { op: 'setKeyframe', clipId: 'v1', prop: 'x', t: 3, v: 0, keyframeId: 'x1' },
      { op: 'setKeyframe', clipId: 'v1', prop: 'x', t: 4, v: 100, keyframeId: 'x2' },
      { op: 'animate', clipId: 't1', preset: 'fadeIn' },
      { op: 'animate', clipId: 't1', preset: 'fadeOut' },
    ]);

  it('início do vídeo: fica no lugar, o conteúdo anda, entrada e saída ficam nas bordas e o vídeo seguinte encosta', () => {
    const p = run(animated(), [{ op: 'trimClip', clipId: 'v1', edge: 'start', delta: 1 }]);
    const v = clip(p, 'v1');
    expect(v.start).toBe(0);
    expect(v.kind === 'video' && v.in).toBe(1);
    expect(v.duration).toBe(5);
    const g = Object.fromEntries(keyframeGroups(v).map((x) => [x.group, [x.start, x.end]]));
    expect(g.entrada).toEqual([0, 0.6]);
    expect(g.saida).toEqual([4.4, 5]);
    expect(kfs(v, 'x').map((k) => k[0])).toEqual([2, 3]); // acompanha o conteúdo
    expect(clip(p, 'v2').start).toBe(5); // sem buraco entre os vídeos
  });

  it('início do título: o fim fica no lugar e a saída continua tocando', () => {
    const p = run(animated(), [{ op: 'trimClip', clipId: 't1', edge: 'start', delta: 1 }]);
    const t = clip(p, 't1');
    expect([t.start, t.duration]).toEqual([1, 2]);
    expect(at(p, 't1', 'opacity', 2.7)).toBeLessThan(0.9); // saída tocando perto do fim
    expect(at(p, 't1', 'opacity', 1)).toBe(0); // entrada no novo começo
  });

  it('fim (inclusive pelo updateClip do Claude): a saída acompanha o fim, nada fica fora do clipe', () => {
    for (const ops of [[{ op: 'trimClip', clipId: 't1', edge: 'end', delta: -0.5 }], [{ op: 'updateClip', clipId: 't1', set: { duration: 2.5 } }]] as Op[][]) {
      const p = run(animated(), ops);
      const t = clip(p, 't1');
      expect(t.duration).toBe(2.5);
      for (const ap of Object.values(t.props)) for (const k of ap.keyframes) expect(k.t).toBeLessThanOrEqual(2.5);
      expect(at(p, 't1', 'opacity', 2.45)).toBeLessThan(0.3);
    }
  });

  it('pontos que saem do clipe viram um ponto na borda com o valor de lá', () => {
    const p = run(animated(), [{ op: 'trimClip', clipId: 'v1', edge: 'end', delta: -2.5 }]);
    const v = clip(p, 'v1');
    expect(v.duration).toBe(3.5);
    expect(kfs(v, 'x')).toEqual([
      [3, 0, null],
      [3.5, 50, null],
    ]);
  });

  it('aparar muito não deixa o título invisível nem perde as animações (entrada + saída)', () => {
    let p = run(base(), [
      { op: 'animate', clipId: 't1', preset: 'fadeIn' },
      { op: 'animate', clipId: 't1', preset: 'fadeOut' },
    ]);
    p = run(p, [{ op: 'trimClip', clipId: 't1', edge: 'end', delta: -2.5 }]);
    expect(clip(p, 't1').duration).toBe(0.5);
    expect(at(p, 't1', 'opacity', 0.25)).toBeGreaterThan(0.5);
    p = run(p, [{ op: 'trimClip', clipId: 't1', edge: 'end', delta: 2.5 }]);
    expect(at(p, 't1', 'opacity', 1.5)).toBeGreaterThan(0.5);
  });

  it('o ponto feito à mão que sai pela borda guarda o valor da própria curva, não o da entrada', () => {
    const hand: Op[] = [
      { op: 'setKeyframe', clipId: 'v1', prop: 'x', t: 0.5, v: -100, keyframeId: 'h1' },
      { op: 'setKeyframe', clipId: 'v1', prop: 'x', t: 4, v: 100, keyframeId: 'h2' },
    ];
    const expected = at(run(base(), hand), 'v1', 'x', 1); // conteúdo que vira o novo começo
    let p = run(base(), [...hand, { op: 'animate', clipId: 'v1', preset: 'slideRightIn' }]);
    p = run(p, [{ op: 'trimClip', clipId: 'v1', edge: 'start', delta: 1 }]);
    const edge = clip(p, 'v1').props.x.keyframes.find((k) => k.group === undefined && k.t === 0);
    expect(edge?.v).toBeCloseTo(expected, 2);
    p = run(p, [{ op: 'clearKeyframes', clipId: 'v1', group: 'entrada' }]);
    expect(at(p, 'v1', 'x', 0)).toBeCloseTo(expected, 2);
  });

  it('cortar o fim não passa o zero da saída para a curva feita à mão', () => {
    const hand: Op[] = [
      { op: 'setKeyframe', clipId: 't1', prop: 'opacity', t: 1, v: 1, keyframeId: 'o1' },
      { op: 'setKeyframe', clipId: 't1', prop: 'opacity', t: 2.8, v: 0.5, keyframeId: 'o2' },
    ];
    const ref = run(base(), hand);
    let p = run(base(), [...hand, { op: 'animate', clipId: 't1', preset: 'fadeOut' }]);
    p = run(p, [{ op: 'trimClip', clipId: 't1', edge: 'end', delta: -0.5 }]);
    p = run(p, [{ op: 'clearKeyframes', clipId: 't1', group: 'saida' }]);
    // na borda, o valor exato da curva feita à mão; antes, a curva inteira era puxada para o zero da saída
    expect(at(p, 't1', 'opacity', 2.5)).toBeCloseTo(at(ref, 't1', 'opacity', 2.5), 3);
    expect(at(p, 't1', 'opacity', 2)).toBeGreaterThan(0.5);
  });

  it('o arraste é limitado ao arquivo e à duração mínima', () => {
    const p = base();
    expect(clampTrimDelta(p, clip(p, 'v1'), 'start', -3)).toBe(0);
    expect(clampTrimDelta(p, clip(p, 'v1'), 'end', 9)).toBe(4);
    expect(clampTrimDelta(p, clip(p, 't1'), 'start', 5)).toBeCloseTo(2.96, 5);
    expect(fails(p, [{ op: 'trimClip', clipId: 'v1', edge: 'end', delta: 9 }])).toMatch(/delta/);
  });

  it('reaplicar as operações preparadas não empurra os vídeos seguintes duas vezes', () => {
    const p0 = base();
    const { applied } = applyOps(p0, [{ op: 'trimClip', clipId: 'v1', edge: 'start', delta: 1 }]);
    const again = run(p0, applied);
    expect(clip(again, 'v2').start).toBe(5);
  });
});

describe('dividir, mover e encurtar texto', () => {
  it('splitClip: dois pedaços contíguos, o novo logo depois do original', () => {
    const p = run(base(), [{ op: 'splitClip', clipId: 'v1', at: 2.5, newId: 'v1b' }]);
    const a = clip(p, 'v1');
    const b = clip(p, 'v1b');
    expect([a.start, a.duration, a.kind === 'video' && a.in]).toEqual([0, 2.5, 0]);
    expect([b.start, b.duration, b.kind === 'video' && b.in]).toEqual([2.5, 3.5, 2.5]);
    expect(b).toMatchObject({ kind: 'video', trackId: a.trackId, volume: 1, muted: false, name: a.kind === 'video' ? a.name : '' });
    expect(isContiguous(a, b)).toBe(true);
    expect(p.clips.findIndex((c) => c.id === 'v1b')).toBe(p.clips.findIndex((c) => c.id === 'v1') + 1);
  });

  it('splitClip: tempo em ms, bordas e id repetido', () => {
    expect(clip(run(base(), [{ op: 'splitClip', clipId: 't1', at: 1.23456, newId: 'x' }]), 'x').start).toBe(1.235);
    expect(fails(base(), [{ op: 'splitClip', clipId: 'v1', at: 0.03 }])).toMatch(/entre 0\.040 e 5\.960/);
    expect(fails(base(), [{ op: 'splitClip', clipId: 'v1', at: 7 }])).toMatch(/entre 0\.040 e 5\.960/);
    expect(fails(base(), [{ op: 'splitClip', clipId: 'v1', at: 3, newId: 'v2' }])).toMatch(/Já existe/);
  });

  it('splitClip sem newId: a expansão cria o id e reaplicar dá o mesmo projeto', () => {
    const p0 = base();
    const { project, applied } = applyOps(p0, [{ op: 'splitClip', clipId: 'v1', at: 3 }]);
    expect((applied[0] as { newId: string }).newId).toMatch(/^vid_/);
    expect(run(p0, applied)).toEqual(project);
  });

  it('shiftClips move vários clipes de uma vez, nunca para antes do zero', () => {
    const p = run(base(), [{ op: 'shiftClips', clipIds: ['v2', 'c1'], delta: 0.5 }]);
    expect([clip(p, 'v2').start, clip(p, 'c1').start]).toEqual([6.5, 0.5]);
    expect(fails(base(), [{ op: 'shiftClips', clipIds: ['v2', 'c1'], delta: -1 }])).toMatch(/antes do zero/);
    expect(fails(base(), [{ op: 'shiftClips', clipIds: ['v2', 'v2'], delta: 1 }])).toMatch(/repetidos/);
  });

  it('cutTextTime encurta o texto e leva a saída junto', () => {
    let p = run(base(), [{ op: 'animate', clipId: 't1', preset: 'fadeOut', duration: 0.6 }]);
    p = run(p, [{ op: 'cutTextTime', clipId: 't1', t0: 1, t1: 2 }]);
    expect([clip(p, 't1').start, clip(p, 't1').duration]).toEqual([0, 2]);
    expect(keyframeGroups(clip(p, 't1')).find((g) => g.group === 'saida')).toMatchObject({ start: 1.4, end: 2 });
    expect(fails(base(), [{ op: 'cutTextTime', clipId: 'v1', t0: 1, t1: 2 }])).toMatch(/só para título e legenda/);
    expect(fails(base(), [{ op: 'cutTextTime', clipId: 'c1', t0: 0, t1: 1.19 }])).toMatch(/menos de 0\.04s/);
  });
});

describe('arquivo de projeto', () => {
  it('recusa vídeo apontando para mídia inexistente e corrige detalhes', () => {
    const p = base();
    const json = JSON.parse(JSON.stringify(p));
    json.clips[0].mediaId = 'sumiu';
    expect(() => parseProject(json)).toThrow(/mídia/);
    const ok = JSON.parse(JSON.stringify(p));
    ok.clips[2].props.opacity.keyframes = [
      { id: 'b', t: 2, v: 0, ease: 'zigzag' },
      { id: 'a', t: 1, v: 1, ease: 'linear' },
    ];
    ok.tracks = ok.tracks.filter((t: { kind: string }) => t.kind !== 'captions');
    const fixed = parseProject(ok);
    expect(fixed.clips[2].props.opacity.keyframes.map((k) => [k.id, k.ease])).toEqual([
      ['a', 'linear'],
      ['b', 'linear'],
    ]);
    expect(fixed.tracks.some((t) => t.kind === 'captions')).toBe(true);
    expect(() => parseProject({ ...ok, settings: { width: 0, height: 0, fps: 30 } })).toThrow(/formato/);
  });

  it('editar valor de um ponto antigo fora do clipe é permitido sem mexer no tempo', () => {
    const p = base();
    const json = JSON.parse(JSON.stringify(p));
    json.clips[2].props.opacity.keyframes = [{ id: 'old', t: 5, v: 1, ease: 'linear' }];
    const loaded = parseProject(json);
    expect(() => run(loaded, [{ op: 'setKeyframe', clipId: 't1', prop: 'opacity', t: 5, v: 0.5, keyframeId: 'old' }])).not.toThrow();
  });
});
