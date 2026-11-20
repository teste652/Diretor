import { describe, expect, it } from 'vitest';
import { createProject } from '../src/core/model';
import { applyOps } from '../src/core/operations';
import { fmtRemoved, markedRange, splitTargets, withIn, withOut } from '../src/renderer/timelineLogic';

describe('marcas, alvos do Ctrl+B e chips', () => {
  it('marcas I e O', () => {
    const m = withOut(withIn({ in: null, out: null }, 3), 3.5);
    expect(markedRange(m)).toEqual([3, 3.5]);
    expect(markedRange(withIn(m, 4))).toBeNull(); // invertidas
    expect(markedRange({ in: 3, out: 3.0005 })).toBeNull(); // tamanho zero
    expect(markedRange({ in: null, out: 2 })).toBeNull();
  });
  it('Ctrl+B divide o selecionado sob a agulha; sem seleção útil, o vídeo; perto da borda, nada', () => {
    // v1 [0,6), t1 título [0,6), c1 legenda [3,4)
    const p = applyOps(createProject(), [
      { op: 'addMedia', media: { id: 'm1', path: '/v/a.mp4', name: 'a.mp4', duration: 10, width: 64, height: 64, hasAudio: true } },
      { op: 'addClip', clip: { kind: 'video', id: 'v1', mediaId: 'm1', start: 0, duration: 6 } },
      { op: 'addClip', clip: { kind: 'title', id: 't1', text: 'A', start: 0, duration: 6 } },
      { op: 'addClip', clip: { kind: 'caption', id: 'c1', text: 'b', start: 3, duration: 1 } },
    ]).project;
    expect(splitTargets(p, ['t1', 'c1'], 2)).toEqual(['t1']);
    expect(splitTargets(p, [], 2)).toEqual(['v1']);
    expect(splitTargets(p, [], 6.02)).toEqual([]);
    expect(splitTargets(p, [], 0.02)).toEqual([]);
    expect(splitTargets(p, ['c1'], 5)).toEqual(['v1']);
    const locked = applyOps(p, [{ op: 'updateTrack', trackId: 'trk_video', set: { locked: true } }]).project;
    expect(splitTargets(locked, [], 2)).toEqual([]);
  });
  it('chip da emenda', () => {
    expect([0.4, 4, 12, 75].map(fmtRemoved)).toEqual(['\u22120,4 s', '\u22124,0 s', '\u22120:12', '\u22121:15']);
    expect([0.033, 0.004].map(fmtRemoved)).toEqual(['\u22120,03 s', '\u22120,01 s']);
  });
});
