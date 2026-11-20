import { describe, expect, it } from 'vitest';
import { createProject } from '../src/core/model';
import { applyOps } from '../src/core/operations';
import { draftTime, playback, session, setCompare } from '../src/renderer/store';

describe('Antes/Depois e o inspetor', () => {
  it('no Antes, o tempo da agulha volta para o rascunho', () => {
    session.load(
      applyOps(createProject(), [
        { op: 'addMedia', media: { id: 'm1', path: 'C:/v/a.mp4', name: 'a.mp4', duration: 60, width: 1280, height: 720, hasAudio: true } },
        { op: 'addClip', clip: { kind: 'video', id: 'v1', mediaId: 'm1' } },
      ]).project,
      null,
    );
    const r = session.propose({ baseRevision: session.project.revision, title: 'Corte', steps: [{ label: 'Corte', ops: [{ op: 'removeRanges', ranges: [[1, 2]] }] }] });
    expect(r.ok).toBe(true);
    // 3 s do rascunho é 4 s do projeto gravado (o rascunho tira [1, 2]).
    playback.seek(3);
    setCompare(true);
    expect(playback.get().time).toBeCloseTo(4, 6);
    expect(draftTime(4)).toBeCloseTo(3, 6);
    setCompare(false);
    expect(draftTime(3)).toBe(3);
  });
});
