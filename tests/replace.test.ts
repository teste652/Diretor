// Troca do destino pelo MP4 pronto: no Windows, um arquivo aberto num player (ou
// sendo lido pelo antivírus) recusa a troca. O vídeo pronto nunca pode se perder.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { moveIntoPlace } from '../src/main/replace';

const busy = (code = 'EPERM') => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });

/** Sistema de arquivos de mentira: `locked` recusa ser substituído (como um MP4 aberto num player). */
function fakeFs(files: string[], opts: { locked?: Set<string>; lockedTimes?: number; error?: (to: string) => Error | undefined } = {}) {
  const fs = new Set(files);
  const calls: string[] = [];
  let lockedLeft = opts.lockedTimes ?? Infinity;
  return {
    calls,
    has: (p: string) => fs.has(p),
    exists: (p: string) => fs.has(p),
    rename: async (from: string, to: string) => {
      calls.push(to);
      const custom = opts.error?.(to);
      if (custom) throw custom;
      if (opts.locked?.has(to) && lockedLeft-- > 0) throw busy();
      if (!fs.has(from)) throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
      fs.delete(from);
      fs.add(to);
    },
  };
}

const W = [1, 1, 1];
// Caminhos no formato do sistema (no Windows, com \\), como os que o editor monta.
const at = (name: string) => join('/v', name);
const TMP = at('.diretor-1-1-abc.part');
const DEST = at('video.mp4');

describe('gravar o MP4 pronto no destino', () => {
  it('destino preso por instantes (antivírus): tenta de novo e substitui', async () => {
    const f = fakeFs([TMP, DEST], { locked: new Set([DEST]), lockedTimes: 2 });
    expect(await moveIntoPlace(TMP, DEST, { ...f, waitsMs: W })).toEqual({ path: DEST, fallback: false });
    expect(f.calls).toEqual([DEST, DEST, DEST]);
    expect(f.has(TMP)).toBe(false);
  });

  it('destino aberto num player: salva ao lado com outro nome, sem apagar nada', async () => {
    const alt1 = at('video (1).mp4');
    const f = fakeFs([TMP, DEST, alt1], { locked: new Set([DEST]) });
    const r = await moveIntoPlace(TMP, DEST, { ...f, waitsMs: W });
    expect(r).toEqual({ path: at('video (2).mp4'), fallback: true });
    expect(f.calls.filter((c) => c === DEST)).toHaveLength(W.length + 1);
    expect([f.has(DEST), f.has(alt1), f.has(at('video (2).mp4')), f.has(TMP)]).toEqual([true, true, true, false]);
  });

  it('outro erro (não é arquivo preso) não fica tentando de novo', async () => {
    const f = fakeFs([TMP], { error: () => Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' }) });
    const r = await moveIntoPlace(TMP, DEST, { ...f, waitsMs: [5000, 5000] });
    expect(f.calls).toEqual([DEST]);
    // O destino não existe: outro nome não ajudaria. O vídeo pronto fica no temporário, e a mensagem diz onde.
    expect(r).toEqual({ error: 'EXDEV: cross-device link not permitted', kept: TMP });
    expect(f.has(TMP)).toBe(true);
  });

  it('temporário preso (antivírus lendo) e nem outro nome dá: o vídeo fica no temporário', async () => {
    const f = fakeFs([TMP, DEST], { error: () => busy('EBUSY') });
    const r = await moveIntoPlace(TMP, DEST, { ...f, waitsMs: W });
    expect(r).toMatchObject({ kept: TMP });
    expect('error' in r && r.error).toMatch(/EBUSY/);
    expect(f.has(TMP)).toBe(true);
    expect(f.has(DEST)).toBe(true);
  });

  it('temporário sumiu: o erro não aponta para um arquivo que não existe', async () => {
    const f = fakeFs([DEST]);
    const r = await moveIntoPlace(TMP, DEST, { ...f, waitsMs: W });
    expect(r).toEqual({ error: 'ENOENT: no such file or directory' });
  });

  it('cancelar enquanto espera o destino soltar para na hora e não grava com outro nome', async () => {
    const f = fakeFs([TMP, DEST], { locked: new Set([DEST]) });
    const stop = new AbortController();
    const moving = moveIntoPlace(TMP, DEST, { ...f, waitsMs: [5000, 5000], signal: stop.signal });
    await new Promise((r) => setTimeout(r, 20));
    const t0 = Date.now();
    stop.abort();
    expect(await moving).toEqual({ cancelled: true });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(f.calls).toEqual([DEST]); // nenhuma nova tentativa e nada de "video (1).mp4"
    expect([f.has(TMP), f.has(DEST)]).toEqual([true, true]); // quem cancelou apaga o temporário
  });

  it('já cancelado: não toca em nada', async () => {
    const f = fakeFs([TMP, DEST]);
    expect(await moveIntoPlace(TMP, DEST, { ...f, waitsMs: W, signal: AbortSignal.abort() })).toEqual({ cancelled: true });
    expect(f.calls).toEqual([]);
  });

  it('no disco de verdade: substitui o arquivo existente', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'diretor-move-'));
    const tmp = join(dir, '.diretor-1-1-abc.part');
    const dest = join(dir, 'video.mp4');
    writeFileSync(tmp, 'novo');
    writeFileSync(dest, 'antigo');
    expect(await moveIntoPlace(tmp, dest)).toEqual({ path: dest, fallback: false });
    expect(readFileSync(dest, 'utf8')).toBe('novo');
    expect(existsSync(tmp)).toBe(false);
  });
});
