import { describe, expect, it } from 'vitest';
import { type VideoClip, findClip } from '../src/core/model';
import { nextToPrefetch, pickSlot, slotsToRelease } from '../src/renderer/videoSlots';
import { videos } from './fixtures';

describe('elementos de vídeo por mídia', () => {
  // A [0,2) in 0, B [2,4) in 2 (continua A), C [4,6) in 8, D [6,8) in 10
  const p = videos([['A', 0, 2, 0], ['B', 2, 2, 2], ['C', 4, 2, 8], ['D', 6, 2, 10]]);
  const c = (id: string) => findClip(p, id) as VideoClip;
  const clipOf = (id: string) => findClip(p, id);
  it('escolhe o elemento certo', () => {
    expect(pickSlot([{ clipId: 'A', used: 1 }], c('B'), clipOf, new Set(['B']))).toEqual({ kind: 'reuse', index: 0 });
    expect(pickSlot([{ clipId: 'C', used: 5 }], c('C'), clipOf, new Set())).toEqual({ kind: 'keep', index: 0 });
    expect(pickSlot([{ clipId: 'sumiu', used: 1 }], c('C'), clipOf, new Set())).toEqual({ kind: 'free', index: 0 });
    expect(pickSlot([{ clipId: 'A', used: 1 }], c('C'), clipOf, new Set(['A']))).toEqual({ kind: 'new' });
    const three = [{ clipId: 'A', used: 1 }, { clipId: 'B', used: 2 }, { clipId: 'D', used: 3 }];
    expect(pickSlot(three, c('C'), clipOf, new Set(['A']))).toEqual({ kind: 'steal', index: 1 });
    expect(pickSlot(three, c('C'), clipOf, new Set(['A', 'B', 'D']))).toEqual({ kind: 'new' });
  });
  it('o pedaço que continua outro solta o elemento que tinha: na emenda ele segue no do anterior', () => {
    // B continua A e D continua C (D começa no fim de C, com in 10 = 8 + 2).
    const slots = [{ clipId: 'B', used: 1 }, { clipId: 'D', used: 2 }, { clipId: 'A', used: 3 }];
    expect(slotsToRelease(slots, c('A'), clipOf, new Set(['A']))).toEqual([0]);
    expect(slotsToRelease(slots, c('A'), clipOf, new Set(['A', 'B']))).toEqual([]);
    expect(slotsToRelease(slots, c('C'), clipOf, new Set(['C']))).toEqual([1]);
    expect(slotsToRelease(slots, c('B'), clipOf, new Set(['B']))).toEqual([]);
  });
  it('pré-busca só o próximo pedaço que não continua o atual, até 0,5 s antes', () => {
    expect(nextToPrefetch(p, 1.8, [c('A')])).toBeNull();
    expect(nextToPrefetch(p, 3.6, [c('B')])?.id).toBe('C');
    expect(nextToPrefetch(p, 3.4, [c('B')])).toBeNull();
  });
});
