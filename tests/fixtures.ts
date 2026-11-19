import { type Project, createProject } from '../src/core/model';
import { type Op, applyOps } from '../src/core/operations';

/** Vídeos [id, start, duration, in, mídia?]; a mídia é m1 quando omitida (m1 e m2 têm 20 s e som). */
export function videos(list: [string, number, number, number, ('m1' | 'm2')?][]): Project {
  const ops: Op[] = [
    { op: 'addMedia', media: { id: 'm1', path: '/v/a.mp4', name: 'a.mp4', duration: 20, width: 64, height: 64, hasAudio: true } },
    { op: 'addMedia', media: { id: 'm2', path: '/v/b.mp4', name: 'b.mp4', duration: 20, width: 64, height: 64, hasAudio: true } },
  ];
  for (const [id, start, duration, inn, m] of list) ops.push({ op: 'addClip', clip: { kind: 'video', id, mediaId: m ?? 'm1', start, duration, in: inn } });
  return applyOps(createProject(), ops).project;
}
