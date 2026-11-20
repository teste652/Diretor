import { describe, expect, it } from 'vitest';
import { type Project, createProject, findClip, projectDuration } from '../src/core/model';
import { applyOps } from '../src/core/operations';
import {
  anchoredScroll,
  deleteOps,
  fmtRemoved,
  followScroll,
  isTextEntry,
  lockedSplitTrack,
  markedRange,
  shouldFit,
  splitTargets,
  tickStep,
  visibleClips,
  withIn,
  withOut,
  zoomBounds,
} from '../src/renderer/timelineLogic';
import { videos } from './fixtures';

/** v1 [0,6), t1 título [0,6), c1 legenda [3,4); e o mesmo projeto com a faixa de vídeo travada. */
function ctrlB(): { p: Project; locked: Project } {
  const p = applyOps(createProject(), [
    { op: 'addMedia', media: { id: 'm1', path: '/v/a.mp4', name: 'a.mp4', duration: 10, width: 64, height: 64, hasAudio: true } },
    { op: 'addClip', clip: { kind: 'video', id: 'v1', mediaId: 'm1', start: 0, duration: 6 } },
    { op: 'addClip', clip: { kind: 'title', id: 't1', text: 'A', start: 0, duration: 6 } },
    { op: 'addClip', clip: { kind: 'caption', id: 'c1', text: 'b', start: 3, duration: 1 } },
  ]).project;
  return { p, locked: applyOps(p, [{ op: 'updateTrack', trackId: 'trk_video', set: { locked: true } }]).project };
}

describe('marcas, alvos do Ctrl+B e chips', () => {
  it('marcas I e O', () => {
    const m = withOut(withIn({ in: null, out: null }, 3), 3.5);
    expect(markedRange(m)).toEqual([3, 3.5]);
    expect(markedRange(withIn(m, 4))).toBeNull(); // invertidas
    expect(markedRange({ in: 3, out: 3.0005 })).toBeNull(); // tamanho zero
    expect(markedRange({ in: null, out: 2 })).toBeNull();
  });
  it('Ctrl+B divide o selecionado sob a agulha; sem seleção útil, o vídeo; perto da borda, nada', () => {
    const { p, locked } = ctrlB();
    expect(splitTargets(p, ['t1', 'c1'], 2)).toEqual(['t1']);
    expect(splitTargets(p, [], 2)).toEqual(['v1']);
    expect(splitTargets(p, [], 6.02)).toEqual([]);
    expect(splitTargets(p, [], 0.02)).toEqual([]);
    expect(splitTargets(p, ['c1'], 5)).toEqual(['v1']);
    expect(splitTargets(locked, [], 2)).toEqual([]);
  });
  it('Ctrl+B numa faixa travada diz qual faixa está travada', () => {
    const { p, locked } = ctrlB();
    expect(lockedSplitTrack(locked, [], 2)).toBe('Vídeo');
    expect(lockedSplitTrack(p, [], 2)).toBeNull();
    expect(lockedSplitTrack(locked, [], 6.02)).toBeNull();
  });
  it('marca nova do lado errado tira a outra', () => {
    expect(withIn({ in: null, out: 5 }, 10)).toEqual({ in: 10, out: null });
    expect(withOut({ in: 10, out: null }, 3)).toEqual({ in: null, out: 3 });
    expect(withOut(withIn({ in: null, out: null }, 3), 3)).toEqual({ in: 3, out: 3 });
  });
  it('teclas de edição valem com o controle deslizante em foco', () => {
    expect(isTextEntry({ tagName: 'INPUT', type: 'range' })).toBe(false);
    expect(isTextEntry({ tagName: 'INPUT', type: 'number' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntry({ tagName: 'SELECT' })).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTextEntry({ tagName: 'BODY' })).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
  it('chip da emenda', () => {
    expect([0.4, 4, 12, 75].map(fmtRemoved)).toEqual(['\u22120,4 s', '\u22124,0 s', '\u22120:12', '\u22121:15']);
    expect([0.033, 0.004].map(fmtRemoved)).toEqual(['\u22120,03 s', '\u22120,01 s']);
  });
});

describe('linha do tempo longa', () => {
  it('só os pedaços na janela', () => {
    const clips = Array.from({ length: 3000 }, (_, i) => ({ id: `p${i}`, start: 1.2 * i, duration: 1 }));
    expect(visibleClips(clips, 600, 612).map((c) => c.id)).toEqual(Array.from({ length: 10 }, (_, i) => `p${500 + i}`));
  });
  it('passo da régua acompanha o zoom', () => {
    expect([80, 300, 1].map(tickStep)).toEqual([1, 0.5, 120]);
  });
  it('o zoom mínimo cabe uma hora na janela', () => {
    const h = zoomBounds(3600, 1240);
    expect(h.fit).toBeCloseTo(1200 / 3600, 6);
    expect(h.min).toBeLessThanOrEqual(h.fit);
    expect(zoomBounds(10, 1240)).toMatchObject({ fit: 120, max: 400 });
  });
  it('o zoom só se ajusta ao abrir um projeto ou ao ganhar o primeiro clipe', () => {
    expect(shouldFit(null, { loads: 0, empty: true })).toBe(true);
    expect(shouldFit({ loads: 0, empty: false }, { loads: 1, empty: false })).toBe(true);
    expect(shouldFit({ loads: 1, empty: true }, { loads: 1, empty: false })).toBe(true);
    expect(shouldFit({ loads: 1, empty: false }, { loads: 1, empty: false })).toBe(false);
    expect(shouldFit({ loads: 1, empty: false }, { loads: 1, empty: true })).toBe(false);
  });
  it('zoom ancorado na agulha e rolagem que acompanha', () => {
    expect(anchoredScroll(0, 1288, 0.347, 202, 1800)).toBeCloseTo(362975.4, 6);
    expect(anchoredScroll(10000, 1000, 100, 50, 0)).toBe(4750);
    expect(followScroll(0, 1288, 8000, 16)).toBeCloseTo(7871.2, 6);
    expect(followScroll(7871.2, 1288, 8100, 16)).toBe(7871.2);
    expect(followScroll(0, 1000, 990, 0)).toBe(0);
    expect(followScroll(0, 1000, 990, 16)).toBe(890);
  });
});

describe('deleteOps', () => {
  /** Mídia de 60 s; v1 [0,60) dividido em 25 ("right") e em 20 ("mid"); legendas cIn [21,23) e cAfter [30,32). */
  const pieces = (): Project =>
    applyOps(createProject(), [
      { op: 'addMedia', media: { id: 'm1', path: '/v/a.mp4', name: 'a.mp4', duration: 60, width: 64, height: 64, hasAudio: true } },
      { op: 'addClip', clip: { kind: 'video', id: 'v1', mediaId: 'm1', start: 0, duration: 60 } },
      { op: 'addClip', clip: { kind: 'caption', id: 'cIn', text: 'dentro', start: 21, duration: 2 } },
      { op: 'addClip', clip: { kind: 'caption', id: 'cAfter', text: 'depois', start: 30, duration: 2 } },
      { op: 'splitClip', clipId: 'v1', at: 25, newId: 'right' },
      { op: 'splitClip', clipId: 'v1', at: 20, newId: 'mid' },
    ]).project;
  /** Vídeos como [id, início, duração, in], em ordem. */
  const vids = (p: Project) =>
    p.clips
      .filter((c) => c.kind === 'video')
      .sort((a, b) => a.start - b.start)
      .map((c) => [c.id, c.start, c.duration, c.kind === 'video' ? c.in : null]);

  it('apagar um pedaço de vídeo fecha o buraco e leva as legendas junto', () => {
    const view = pieces();
    const after = applyOps(view, deleteOps(view, ['mid'])).project;
    expect(vids(after)).toEqual([['v1', 0, 20, 0], ['right', 20, 35, 25]]);
    expect(findClip(after, 'cIn')).toBeUndefined();
    expect(findClip(after, 'cAfter')!.start).toBe(25);
    expect(projectDuration(after)).toBe(55);
    expect(deleteOps(view, ['cAfter'])).toEqual([{ op: 'removeClip', clipId: 'cAfter' }]);
  });
  it('um pedaço sozinho na linha vira um removeRanges com as bordas dele', () => {
    expect(deleteOps(pieces(), ['mid'])).toEqual([{ op: 'removeRanges', ranges: [[20, 25]] }]);
  });
  it('vídeo com outro vídeo por cima ou por baixo sai sem fechar buraco', () => {
    // B [5,8) por cima de A [0,20), como imagem dentro de imagem: cortar o tempo levaria A e as legendas junto.
    const p = videos([['A', 0, 20, 0], ['B', 5, 3, 0]]);
    expect(deleteOps(p, ['B'])).toEqual([{ op: 'removeClip', clipId: 'B' }]);
    expect(deleteOps(p, ['A'])).toEqual([{ op: 'removeClip', clipId: 'A' }]);
  });
  it('legenda e pedaço selecionados: a legenda sai primeiro, depois o corte', () => {
    expect(deleteOps(pieces(), ['mid', 'cAfter'])).toEqual([
      { op: 'removeClip', clipId: 'cAfter' },
      { op: 'removeRanges', ranges: [[20, 25]] },
    ]);
  });
  it('o corte do pedaço leva a legenda de depois para trás pelo tamanho do pedaço', () => {
    const view = pieces();
    const after = applyOps(view, deleteOps(view, ['mid'])).project;
    const mid = findClip(view, 'mid')!;
    expect(findClip(after, 'cAfter')!.start).toBe(findClip(view, 'cAfter')!.start - mid.duration);
  });
});
