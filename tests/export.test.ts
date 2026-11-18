// Exportação: ffmpeg recebe quadros RGBA + áudio aparado do original.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs, exactFps, fpsArg, frameCount, parseFfmpegProbe } from '../src/core/export';
import { EditorSession } from '../src/core/session';

const FFMPEG: string =
  process.env.DIRETOR_FFMPEG ??
  (() => {
    try {
      return require('ffmpeg-static') ?? 'ffmpeg'; // opcional: sem ele, usa o ffmpeg do PATH
    } catch {
      return 'ffmpeg';
    }
  })();
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

  it('vídeo de celular em pé e pixel não quadrado têm o tamanho de tela certo', () => {
    const land = join(dir, 'land.mp4');
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', land]);
    const rot = join(dir, 'rot.mp4');
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-display_rotation', '90', '-i', land, '-c', 'copy', rot]);
    expect(probe(rot)).toMatchObject({ width: 360, height: 640, fps: 25 });
    const sar = join(dir, 'sar.mp4');
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=1', '-vf', 'setsar=4/3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sar]);
    expect(probe(sar)).toMatchObject({ width: 853, height: 360 });
  });

  it('ffmpeg 8.1+ ("Display Matrix") e fps NTSC/celular viram tamanho e fps exatos', () => {
    const text = (rotLine: string, fps: string) =>
      [
        "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'cel.mp4':",
        '  Duration: 00:00:05.00, start: 0.000000, bitrate: 900 kb/s',
        `  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080, 800 kb/s, ${fps}, 90k tbn (default)`,
        '      Metadata:',
        '        handler_name    : VideoHandler',
        '      Side data:',
        `        ${rotLine}`,
        '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)',
      ].join('\n');
    expect(parseFfmpegProbe(text('Display Matrix: rotation of -90.00 degrees', '23.98 fps, 23.98 tbr'))).toMatchObject({ width: 1080, height: 1920, fps: 24000 / 1001 });
    expect(parseFfmpegProbe(text('displaymatrix: rotation of 90.00 degrees', '29.97 fps, 29.97 tbr'))).toMatchObject({ width: 1080, height: 1920, fps: 30000 / 1001 });
    expect(parseFfmpegProbe(text('nada', '30.02 fps, 30 tbr'))).toMatchObject({ width: 1920, height: 1080, fps: 30 });
    // rotação de outro stream não vira a do vídeo
    expect(parseFfmpegProbe(text('nada', '25 fps, 25 tbr') + '\n      Side data:\n        Display Matrix: rotation of -90.00 degrees')).toMatchObject({ width: 1920, height: 1080, fps: 25 });
    expect([exactFps(59.94), exactFps(24), exactFps(12.5), exactFps(29.98)]).toEqual([60000 / 1001, 24, 12.5, 30]);
    expect([fpsArg(24000 / 1001), fpsArg(30), fpsArg(12.5)]).toEqual(['24000/1001', '30', '12.5']);
  });

  it('projeto em 23,976 fps: cada quadro da linha do tempo cai no quadro certo do arquivo', () => {
    const fps = exactFps(23.98); // o que o ffmpeg mostra para 24000/1001
    for (let f = 0; f < 20000; f += 7) {
      const t = f / fps + 1e-4; // como a prévia e a exportação buscam (seekExact)
      expect(Math.floor((t * 24000) / 1001)).toBe(f);
    }
  });

  async function exportFrames(project: EditorSession['project'], out: string, frame: Buffer) {
    const proc = spawn(FFMPEG, buildFfmpegArgs(project, out));
    let err = '';
    proc.stderr.on('data', (d) => (err += d));
    for (let i = 0; i < frameCount(project); i++) if (!proc.stdin.write(frame)) await new Promise((r) => proc.stdin.once('drain', r));
    proc.stdin.end();
    const code = await new Promise((r) => proc.on('close', r));
    expect(err).toBe('');
    expect(code).toBe(0);
  }

  it('cores saem em BT.709 e marcadas no arquivo (iguais à prévia)', async () => {
    const s = new EditorSession();
    s.project.settings = { width: 64, height: 64, fps: 30 };
    s.dispatch([{ op: 'addClip', clip: { kind: 'title', id: 't', text: ' ', duration: 0.5 } }]);
    const out = join(dir, 'cor.mp4');
    const px = Buffer.from([0, 200, 0, 255, 220, 30, 30, 255]);
    await exportFrames(s.project, out, Buffer.concat(Array.from({ length: (64 * 64) / 2 }, () => px)));
    let header = '';
    try {
      execFileSync(FFMPEG, ['-hide_banner', '-i', out], { stdio: 'pipe' });
    } catch (e: any) {
      header = String(e.stderr);
    }
    expect(header).toMatch(/yuv420p\(tv, bt709/);
    const rgb = execFileSync(FFMPEG, ['-v', 'error', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    // Média de uma área (o 4:2:0 mistura vizinhos): verde e vermelho alternados dão a média dos dois.
    let g = 0;
    for (let i = 0; i < rgb.length; i += 3) g += rgb[i + 1];
    expect(g / (rgb.length / 3)).toBeGreaterThan(108);
    expect(g / (rgb.length / 3)).toBeLessThan(122);
  }, 30_000);

  it('áudio que começa depois do vídeo no arquivo continua no lugar', async () => {
    const late = join(dir, 'late.mp4');
    execFileSync(FFMPEG, [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=3',
      '-itsoffset', '0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.5',
      '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', late,
    ]);
    const s = new EditorSession();
    s.project.settings = { width: 320, height: 180, fps: 30 };
    s.dispatch([
      { op: 'addMedia', media: { id: 'm1', path: late, name: 'late.mp4', duration: 3, width: 320, height: 180, hasAudio: true } },
      { op: 'addClip', clip: { kind: 'video', id: 'v1', mediaId: 'm1', in: 0, duration: 2 } },
    ]);
    const out = join(dir, 'late-out.mp4');
    await exportFrames(s.project, out, Buffer.alloc(320 * 180 * 4, 90));
    const log = String(spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', out, '-af', 'silencedetect=n=-40dB:d=0.1', '-f', 'null', '-']).stderr);
    const end = /silence_end: ([\d.]+)/.exec(log);
    expect(end).not.toBeNull();
    expect(Number(end![1])).toBeGreaterThan(0.4);
    expect(Number(end![1])).toBeLessThan(0.6);
  }, 30_000);
});
