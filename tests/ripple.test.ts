import { describe, expect, it } from 'vitest';
import { type Project, type VideoClip, createProject, findClip, projectDuration } from '../src/core/model';
import { type Op, applyOps } from '../src/core/operations';
import { evalClipProp } from '../src/core/properties';
import { type TimeRange, mapTime, normalizeRanges } from '../src/core/ripple';
import { round } from '../src/core/time';
import { base, clip, fails, run } from './fixtures';

const vids = (p: Project) =>
  p.clips.filter((c): c is VideoClip => c.kind === 'video').sort((a, b) => a.start - b.start).map((c) => [c.start, round(c.start + c.duration), round(c.in)]);
const span = (p: Project, id: string) => [clip(p, id).start, round(clip(p, id).start + clip(p, id).duration)];
const cut = (p: Project, ranges: TimeRange[]) => run(p, [{ op: 'removeRanges', ranges }]);
const shape = (p: Project) =>
  p.clips.map((c) => [c.trackId, c.kind, c.start, c.duration, c.kind === 'video' ? round(c.in) : c.text]).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[2]) - Number(b[2]));
/** base() + legenda c2 [5,5; 6,5) e título t2 [6,5; 7,5). */
const withTail = () =>
  run(base(), [
    { op: 'addClip', clip: { kind: 'caption', id: 'c2', text: 'depois', start: 5.5, duration: 1 } },
    { op: 'addClip', clip: { kind: 'title', id: 't2', text: 'fim', start: 6.5, duration: 1 } },
  ]);

describe('apagar trechos', () => {
  it('apagar [2,3]: o vídeo perde o trecho, tudo depois anda 1 s e o texto em cima é cortado', () => {
    const p0 = run(base(), [
      { op: 'addClip', clip: { kind: 'caption', id: 'c3', text: 'depois', start: 4, duration: 1 } },
      { op: 'addClip', clip: { kind: 'title', id: 't3', text: 'meio', start: 2.5, duration: 2 } },
    ]);
    const p = cut(p0, [[2, 3]]);
    expect(vids(p)).toEqual([[0, 2, 0], [2, 5, 3], [5, 8, 6]]);
    expect([span(p, 't1'), span(p, 'c1'), span(p, 'c3'), span(p, 't3')]).toEqual([[0, 2], [0, 1.2], [3, 4], [2, 3.5]]);
    expect(projectDuration(p)).toBe(8);
  });

  it('ordena, junta trechos quase encostados e leva a borda até o clipe quando sobraria um pedaço curto', () => {
    expect(normalizeRanges(base(), [[4, 5], [1, 2], [1.5, 2.5]])).toEqual([[1, 2.5], [4, 5]]);
    expect(normalizeRanges(base(), [[1, 2], [2.03, 3]])).toEqual([[1, 3]]);
    expect(normalizeRanges(base(), [[0.02, 1]])).toEqual([[0, 1]]);
    expect(normalizeRanges(base(), [[3, 5.98]])).toEqual([[3, 6]]);
    expect(vids(cut(base(), [[3, 5.98]]))).toEqual([[0, 3, 0], [3, 6, 6]]);
  });

  it('legenda que ficaria curta demais sai; título cortado no começo encosta no zero', () => {
    const p = cut(base(), [[0, 1.18]]);
    expect(findClip(p, 'c1')).toBeUndefined();
    expect(span(p, 't1')).toEqual([0, 1.82]);
  });

  it('apagar um vão sem clipe só puxa o que vem depois', () => {
    const p = cut(run(base(), [{ op: 'updateClip', clipId: 'v2', set: { start: 7 } }]), [[6, 7]]);
    expect(vids(p)).toEqual([[0, 6, 0], [6, 9, 6]]);
  });

  it('faixa travada que mudaria recusa o corte com o nome dela; faixa oculta anda junto', () => {
    const locked = run(base(), [{ op: 'updateTrack', trackId: 'trk_captions', set: { locked: true } }]);
    expect(fails(locked, [{ op: 'removeRanges', ranges: [[0.5, 1]] }])).toMatch(/faixa "Legendas" está travada/);
    expect(vids(cut(locked, [[8, 9]]))).toEqual([[0, 6, 0], [6, 8, 6]]);
    const hidden = run(base(), [{ op: 'updateTrack', trackId: 'trk_text', set: { hidden: true } }]);
    expect(span(cut(hidden, [[2, 3]]), 't1')).toEqual([0, 2]);
  });

  it('limites e mensagens', () => {
    const many: TimeRange[] = Array.from({ length: 501 }, (_, i) => [i * 0.01, i * 0.01 + 0.005]);
    expect(fails(base(), [{ op: 'removeRanges', ranges: many }])).toMatch(/Até 500 trechos/);
    expect(fails(base(), [{ op: 'removeRanges', ranges: [[20, 30]] }])).toMatch(/Nada para apagar/);
    expect(fails(base(), [{ op: 'removeRanges', ranges: [[3, 2]] }])).toMatch(/início < fim/);
  });

  it('mapTime: antes, dentro e depois dos trechos', () => {
    expect([0.5, 1.5, 2, 3, 4.5, 6].map((t) => mapTime([[1, 2], [4, 5]], t))).toEqual([0.5, 1, 1, 2, 3, 4]);
  });

  it('várias removeRanges na mesma etapa, do fim para o começo, dão o mesmo que uma só', () => {
    const a = run(base(), [{ op: 'removeRanges', ranges: [[5, 5.5]] }, { op: 'removeRanges', ranges: [[1, 1.5]] }]);
    expect(shape(a)).toEqual(shape(cut(base(), [[1, 1.5], [5, 5.5]])));
  });

  it('vídeo de 1 hora: 500 trechos aplicam em menos de 1 s e cada clipe anda uma vez só', () => {
    const ops: Op[] = [
      { op: 'addMedia', media: { id: 'mL', path: 'C:/v/longo.mp4', name: 'longo.mp4', duration: 3600, width: 1280, height: 720, hasAudio: true } },
      { op: 'addClip', clip: { kind: 'video', id: 'vL', mediaId: 'mL', start: 0, duration: 3600 } },
    ];
    for (let i = 0; i < 600; i++) ops.push({ op: 'addClip', clip: { kind: 'caption', id: `k${i}`, text: `fala ${i}`, start: 6 * i, duration: 2 } });
    const p0 = run(createProject(), ops);
    const ranges: TimeRange[] = Array.from({ length: 500 }, (_, i) => [7 * i + 3, round(7 * i + 3.4)]);
    const t0 = performance.now();
    const { project, applied } = applyOps(p0, [{ op: 'removeRanges', ranges }]);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(project.clips.filter((c) => c.kind === 'video')).toHaveLength(501);
    expect(projectDuration(project)).toBeCloseTo(3400, 6);
    expect(span(project, 'k1')).toEqual([5.6, 7.6]);
    const moved = applied.flatMap((o) => (o.op === 'shiftClips' ? o.clipIds : []));
    expect(new Set(moved).size).toBe(moved.length);
    expect(run(p0, applied)).toEqual(project);
  });

  it('título de 1 hora com movimento e fades: 500 trechos em menos de 1 s e o x continua igual fora dos cortes', () => {
    const ops: Op[] = [
      { op: 'addMedia', media: { id: 'mL', path: 'C:/v/longo.mp4', name: 'longo.mp4', duration: 3600, width: 1280, height: 720, hasAudio: true } },
      { op: 'addClip', clip: { kind: 'video', id: 'vL', mediaId: 'mL', start: 0, duration: 3600 } },
      { op: 'addClip', clip: { kind: 'title', id: 'tL', text: 'uma hora', start: 0, duration: 3600 } },
      { op: 'setKeyframe', clipId: 'tL', prop: 'x', t: 0, v: 0, ease: 'linear', keyframeId: 'x0' },
      { op: 'setKeyframe', clipId: 'tL', prop: 'x', t: 3600, v: 3600, ease: 'linear', keyframeId: 'x1' },
      { op: 'animate', clipId: 'tL', preset: 'fadeIn' },
      { op: 'animate', clipId: 'tL', preset: 'fadeOut' },
    ];
    for (let i = 0; i < 600; i++) ops.push({ op: 'addClip', clip: { kind: 'caption', id: `k${i}`, text: `fala ${i}`, start: 6 * i, duration: 2 } });
    const p0 = run(createProject(), ops);
    const ranges: TimeRange[] = Array.from({ length: 500 }, (_, i) => [7 * i + 3, round(7 * i + 3.4)]);
    const t0 = performance.now();
    const { project, applied } = applyOps(p0, [{ op: 'removeRanges', ranges }]);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(findClip(project, 'tL')).toBeDefined();
    // O x feito à mão é linear (x = tempo): fora dos cortes, o instante de depois mostra o x do instante de antes.
    for (const before of [1, 5.4, 1061.3, 2000.7, 3500]) {
      const after = round(before - 0.4 * ranges.filter(([, b]) => b <= before).length);
      expect(evalClipProp(clip(project, 'tL'), 'x', after)).toBeCloseTo(evalClipProp(clip(p0, 'tL'), 'x', before), 6);
    }
    expect(run(p0, applied)).toEqual(project);
  });
});

describe('aparar vídeo com ripple vale para todas as faixas', () => {
  it('fim −1: legenda e título depois andam junto', () => {
    const p = run(withTail(), [{ op: 'trimClip', clipId: 'v1', edge: 'end', delta: -1 }]);
    expect(vids(p)).toEqual([[0, 5, 0], [5, 8, 6]]);
    expect([span(p, 'c2'), span(p, 't2')]).toEqual([[5, 5.5], [5.5, 6.5]]);
  });

  it('início +1: o vídeo fica no lugar e o texto em cima do pedaço aparado é cortado', () => {
    const p = run(withTail(), [{ op: 'trimClip', clipId: 'v1', edge: 'start', delta: 1 }]);
    expect(vids(p)).toEqual([[0, 5, 1], [5, 8, 6]]);
    expect([span(p, 't1'), span(p, 'c1')]).toEqual([[0, 2], [0, 0.2]]);
  });

  it('alongar o fim empurra o que começa a partir do fim antigo', () => {
    const p0 = run(base(), [
      { op: 'updateClip', clipId: 'v1', set: { duration: 5 } },
      { op: 'addClip', clip: { kind: 'caption', id: 'c2', text: 'x', start: 5, duration: 1 } },
      { op: 'addClip', clip: { kind: 'title', id: 't2', text: 'y', start: 6, duration: 1 } },
    ]);
    const p = run(p0, [{ op: 'trimClip', clipId: 'v1', edge: 'end', delta: 0.5 }]);
    expect(vids(p)).toEqual([[0, 5.5, 0], [6.5, 9.5, 6]]);
    expect([span(p, 'c2'), span(p, 't2'), span(p, 'c1')]).toEqual([[5.5, 6.5], [6.5, 7.5], [0, 1.2]]);
  });

  it('revelar o começo empurra tudo o que começa a partir do início do vídeo', () => {
    const p0 = run(base(), [{ op: 'trimClip', clipId: 'v1', edge: 'start', delta: 1, ripple: false }]);
    const p = run(p0, [{ op: 'trimClip', clipId: 'v1', edge: 'start', delta: -0.5 }]);
    expect(vids(p)).toEqual([[0, 5.5, 0.5], [6.5, 9.5, 6]]);
    expect(span(p, 't1')).toEqual([0.5, 3.5]);
  });

  it('ripple:false não mexe em mais nada; faixa de texto travada recusa', () => {
    expect(span(run(withTail(), [{ op: 'trimClip', clipId: 'v1', edge: 'end', delta: -1, ripple: false }]), 'c2')).toEqual([5.5, 6.5]);
    const locked = run(withTail(), [{ op: 'updateTrack', trackId: 'trk_text', set: { locked: true } }]);
    expect(fails(locked, [{ op: 'trimClip', clipId: 'v1', edge: 'end', delta: -1 }])).toMatch(/faixa "Texto" está travada/);
  });
});
