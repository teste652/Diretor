import { expect } from 'vitest';
import { type Project, createProject, findClip } from '../src/core/model';
import { type Op, OpValidationError, applyOps } from '../src/core/operations';

/** Vídeos [id, start, duration, in, mídia?]; a mídia é m1 quando omitida (m1 e m2 têm 20 s e som). */
export function videos(list: [string, number, number, number, ('m1' | 'm2')?][]): Project {
  const ops: Op[] = [
    { op: 'addMedia', media: { id: 'm1', path: '/v/a.mp4', name: 'a.mp4', duration: 20, width: 64, height: 64, hasAudio: true } },
    { op: 'addMedia', media: { id: 'm2', path: '/v/b.mp4', name: 'b.mp4', duration: 20, width: 64, height: 64, hasAudio: true } },
  ];
  for (const [id, start, duration, inn, m] of list) ops.push({ op: 'addClip', clip: { kind: 'video', id, mediaId: m ?? 'm1', start, duration, in: inn } });
  return applyOps(createProject(), ops).project;
}

/** Vídeos v1 [0, 6) e v2 [6, 9) (in 6) da mídia m1 de 10 s, título t1 [0, 3) e legenda c1 [0; 1,2). */
export function base(): Project {
  return applyOps(createProject(), [
    { op: 'addMedia', media: { id: 'm1', path: 'C:/v/a.mp4', name: 'a.mp4', duration: 10, width: 1280, height: 720, hasAudio: true } },
    { op: 'addClip', clip: { kind: 'video', id: 'v1', mediaId: 'm1', start: 0, duration: 6 } },
    { op: 'addClip', clip: { kind: 'video', id: 'v2', mediaId: 'm1', start: 6, in: 6, duration: 3 } },
    { op: 'addClip', clip: { kind: 'title', id: 't1', text: 'OLÁ', start: 0, duration: 3 } },
    { op: 'addClip', clip: { kind: 'caption', id: 'c1', text: 'curta', start: 0, duration: 1.2 } },
  ]).project;
}

export const run = (p: Project, ops: Op[]) => applyOps(p, ops).project;
export const fails = (p: Project, ops: Op[]) => {
  try {
    applyOps(p, ops);
  } catch (e) {
    expect(e).toBeInstanceOf(OpValidationError);
    return (e as OpValidationError).message;
  }
  throw new Error('deveria ter sido recusado');
};
export const clip = (p: Project, id: string) => findClip(p, id)!;
