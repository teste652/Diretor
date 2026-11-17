// Exportação: ffmpeg recebe quadros RGBA + áudio aparado do original.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs, frameCount, parseFfmpegProbe } from '../src/core/export';
import { EditorSession } from '../src/core/session';

const FFMPEG = process.env.DIRETOR_FFMPEG ?? require('ffmpeg-static');
const dir = mkdtempSync(join(tmpdir(), 'diretor-exp-'));

function probe(path: string) {
  try {
    execFileSync(FFMPEG, ['-hide_banner', '-i', path], { stdio: 'pipe' });
  } catch (e: any) {
    return parseFfmpegProbe(String(e.stderr));
  }
  return null;
}

describe('exportação', () => {
  it('lê duração, tamanho e áudio do MP4', () => {
    const src = join(dir, 'src.mp4');
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]);
    const info = probe(src)!;
    expect(info.width).toBe(640);
    expect(info.height).toBe(360);
    expect(info.hasAudio).toBe(true);
    expect(info.duration).toBeCloseTo(4, 1);
  });

  it('gera MP4 com a duração aparada e áudio', async () => {
    const src = join(dir, 'src.mp4');
    const s = new EditorSession();
    s.project.settings = { width: 320, height: 180, fps: 30 };
    s.dispatch([
      { op: 'addMedia', media: { id: 'm1', path: src, name: 'src.mp4', duration: 4, width: 640, height: 360, hasAudio: true } },
      { op: 'addClip', clip: { kind: 'video', id: 'v1', mediaId: 'm1', in: 1, duration: 2 } },
    ]);
    const out = join(dir, 'out.mp4');
    const args = buildFfmpegArgs(s.project, out);
    const n = frameCount(s.project);
    expect(n).toBe(60);
    const proc = spawn(FFMPEG, args);
    let err = '';
    proc.stderr.on('data', (d) => (err += d));
    const frame = Buffer.alloc(320 * 180 * 4, 128);
    for (let i = 0; i < n; i++) {
      if (!proc.stdin.write(frame)) await new Promise((r) => proc.stdin.once('drain', r));
    }
    proc.stdin.end();
    const code = await new Promise((r) => proc.on('close', r));
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(statSync(out).size).toBeGreaterThan(1000);
    const info = probe(out)!;
    expect(info.width).toBe(320);
    expect(info.hasAudio).toBe(true);
    expect(info.duration).toBeCloseTo(2, 1);
  }, 30_000);
});
