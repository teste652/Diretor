// Exportação: ffmpeg recebe quadros RGBA + áudio aparado do original.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFfmpegArgs, exactFps, fpsArg, frameCount, parseFfmpegProbe } from '../src/core/export';
import { audioGraph, audioLanes, audioSegments } from '../src/core/exportAudio';
import { type Project, createProject } from '../src/core/model';
import { type Op, applyOps } from '../src/core/operations';
import type { TimeRange } from '../src/core/ripple';
import { EditorSession } from '../src/core/session';
import { round } from '../src/core/time';

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

async function exportFrames(project: EditorSession['project'], out: string, frame: Buffer) {
  const { args, script } = buildFfmpegArgs(project, out, `${out}.filtro`);
  writeFileSync(`${out}.filtro`, script);
  const proc = spawn(FFMPEG, args);
  let err = '';
  proc.stderr.on('data', (d) => (err += d));
  for (let i = 0; i < frameCount(project); i++) if (!proc.stdin.write(frame)) await new Promise((r) => proc.stdin.once('drain', r));
  proc.stdin.end();
  const code = await new Promise((r) => proc.on('close', r));
  expect(err).toBe('');
  expect(code).toBe(0);
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
    const { args, script } = buildFfmpegArgs(s.project, out, `${out}.filtro`);
    writeFileSync(`${out}.filtro`, script);
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

  it('grava MP4 mesmo num temporário sem extensão .mp4 (o formato vai explícito)', async () => {
    const s = new EditorSession();
    s.project.settings = { width: 64, height: 64, fps: 30 };
    s.dispatch([{ op: 'addClip', clip: { kind: 'title', id: 't', text: ' ', duration: 0.3 } }]);
    const part = join(dir, '.diretor-1-1-abc.part');
    const { args } = buildFfmpegArgs(s.project, part, `${part}.filtro`);
    expect(args.slice(-3)).toEqual(['-f', 'mp4', part]);
    await exportFrames(s.project, part, Buffer.alloc(64 * 64 * 4, 200));
    let header = '';
    try {
      execFileSync(FFMPEG, ['-hide_banner', '-i', part], { stdio: 'pipe' });
    } catch (e: any) {
      header = String(e.stderr);
    }
    expect(header).toMatch(/Input #0, mov,mp4/);
    expect(probe(part)).toMatchObject({ width: 64, height: 64 });
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

/** Mídias m1 e m2 com som e m3 sem som (10 s); clipes de vídeo com mudo e volume opcionais. */
function audioProject(list: { id: string; media?: 'm1' | 'm2' | 'm3'; start: number; duration: number; in: number; muted?: boolean; volume?: number }[]): Project {
  const media = (id: string, path: string, hasAudio: boolean): Op => ({ op: 'addMedia', media: { id, path, name: path, duration: 10, width: 64, height: 64, hasAudio } });
  const ops: Op[] = [media('m1', '/v/a.mp4', true), media('m2', '/v/b.mp4', true), media('m3', '/v/mudo.mp4', false)];
  for (const c of list) {
    ops.push({ op: 'addClip', clip: { kind: 'video', id: c.id, mediaId: c.media ?? 'm1', start: c.start, duration: c.duration, in: c.in } });
    if (c.muted !== undefined || c.volume !== undefined) ops.push({ op: 'updateClip', clipId: c.id, set: { ...(c.muted !== undefined ? { muted: c.muted } : {}), ...(c.volume !== undefined ? { volume: c.volume } : {}) } });
  }
  const p = applyOps(createProject(), ops).project;
  p.settings = { width: 64, height: 64, fps: 30 };
  return p;
}
const cmd = (p: Project) => buildFfmpegArgs(p, '/o/x.part', '/o/x.filtro');

describe('som com cortes (montagem)', () => {
  const one = () => audioProject([{ id: 'v1', start: 0, duration: 4, in: 0 }]);
  it('dividir sem cortar: um segmento só e os mesmos argumentos', () => {
    const split = applyOps(one(), [{ op: 'splitClip', clipId: 'v1', at: 1.5 }]).project;
    expect(audioSegments(split)).toEqual([{ mediaId: 'm1', path: '/v/a.mp4', tl0: 0, src0: 0, n: 192000, volume: 1 }]);
    expect(cmd(split)).toEqual(cmd(one()));
  });
  it('cortar [1; 1,5]: uma entrada, dois trechos e concat', () => {
    const { args, script } = cmd(applyOps(one(), [{ op: 'removeRanges', ranges: [[1, 1.5]] }]).project);
    expect(args.filter((a) => a === '-i')).toHaveLength(2);
    expect(args).toContain('-filter_complex_script');
    for (const s of ['asplit=2', 'atrim=start_sample=0:end_sample=48000', 'atrim=start_sample=72000:end_sample=192000', 'concat=n=2:v=0:a=1']) expect(script).toContain(s);
    expect(script).not.toContain('amix');
  });
  it('sobreposição vira duas faixas misturadas', () => {
    const p = audioProject([{ id: 'a', start: 0, duration: 3, in: 0 }, { id: 'b', media: 'm2', start: 2, duration: 2, in: 0 }]);
    expect(audioLanes(audioSegments(p)).map((l) => l.map((s) => s.mediaId))).toEqual([['m1'], ['m2']]);
    expect(cmd(p).script).toContain('amix=inputs=2:normalize=0:duration=longest');
  });
  it('pedaço que volta no arquivo abre o arquivo de novo', () => {
    const p = audioProject([{ id: 'a', start: 0, duration: 2, in: 5 }, { id: 'b', start: 2, duration: 2, in: 0 }]);
    expect(audioGraph(audioSegments(p), 4 * 48000, 1).inputs).toEqual(['/v/a.mp4', '/v/a.mp4']);
  });
  it('mídia sem som, pedaço mudo e começo vazio: o som fica no lugar', () => {
    const p = audioProject([
      { id: 'semSom', media: 'm3', start: 0, duration: 1, in: 0 },
      { id: 'fala', start: 1, duration: 2, in: 0 },
      { id: 'mudo', start: 3, duration: 1, in: 2, muted: true },
    ]);
    expect(audioSegments(p).map((s) => s.mediaId)).toEqual(['m1']);
    expect(cmd(p).script).toContain('anullsrc=r=48000:cl=stereo,atrim=end_sample=48000');
    const hidden = applyOps(p, [{ op: 'updateTrack', trackId: 'trk_video', set: { hidden: true } }]).project;
    expect(audioSegments(hidden)).toEqual([]);
    expect(cmd(hidden).script).not.toContain('[aout]');
  });
  it('arquivos demais para a linha de comando do Windows', () => {
    const ops: Op[] = [];
    for (let i = 0; i < 300; i++) {
      ops.push({ op: 'addMedia', media: { id: `m${i}`, path: `C:/videos/${'x'.repeat(110)}${i}.mp4`, name: `${i}.mp4`, duration: 1, width: 64, height: 64, hasAudio: true } });
      ops.push({ op: 'addClip', clip: { kind: 'video', id: `v${i}`, mediaId: `m${i}`, start: round(i * 0.1), duration: 0.1 } });
    }
    expect(() => cmd(applyOps(createProject(), ops).project)).toThrow(/arquivos demais/);
  });
  it('cada trecho é recarimbado depois do apad', () => {
    const p = applyOps(audioProject([{ id: 'v1', start: 0, duration: 4, in: 0, volume: 0.5 }]), [{ op: 'removeRanges', ranges: [[1, 1.5]] }]).project;
    const { script } = cmd(p);
    expect(script).toContain('apad=whole_len=48000,asetpts=round(N/SR/TB),volume=0.5[s0]');
    expect(script).toContain('apad=whole_len=120000,asetpts=round(N/SR/TB),volume=0.5[s1]');
  });
});

/** Projeto 64×64 a 30 fps com clipes de vídeo de `path` (com som); cada id de `media` vira uma mídia desse arquivo. */
function fileProject(path: string, duration: number, list: { id: string; media?: string; start: number; duration?: number; in: number }[]): Project {
  const ids = [...new Set(list.map((c) => c.media ?? 'm'))];
  const ops: Op[] = ids.map((id): Op => ({ op: 'addMedia', media: { id, path, name: id, duration, width: 64, height: 64, hasAudio: true } }));
  for (const c of list) ops.push({ op: 'addClip', clip: { kind: 'video', id: c.id, mediaId: c.media ?? 'm', start: c.start, duration: c.duration, in: c.in } });
  const p = applyOps(createProject(), ops).project;
  p.settings = { width: 64, height: 64, fps: 30 };
  return p;
}

/** Saída do silencedetect: `silence_start` aparece se houver 50 ms ou mais abaixo de -40 dB. */
const silence = (path: string) => String(spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', path, '-af', 'silencedetect=n=-40dB:d=0.05', '-f', 'null', '-']).stderr);

/** Silêncios do silencedetect, em s; `end` é null quando o silêncio vai até o fim e o ffmpeg não informa o fim. */
function silences(path: string): { start: number; end: number | null }[] {
  const log = silence(path);
  // O ffmpeg escreve os tempos com %.6g (perto do zero, "2.08333e-05").
  const ends = [...log.matchAll(/silence_end: (\S+)/g)].map((m) => Number(m[1]));
  return [...log.matchAll(/silence_start: (\S+)/g)].map((m, i) => ({ start: Number(m[1]), end: ends[i] ?? null }));
}

/** Som do arquivo em mono, amostras float. */
function pcm(path: string): Float32Array {
  const b = execFileSync(FFMPEG, ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-'], { maxBuffer: 1 << 26 });
  return Float32Array.from({ length: b.length / 4 }, (_, i) => b.readFloatLE(i * 4));
}

/** Energia Σx². */
const energy = (x: Float32Array) => x.reduce((sum, v) => sum + v * v, 0);
const rms = (x: Float32Array) => Math.sqrt(energy(x) / x.length);

/** SNR = 10·log10(Σx² / Σ(x − y)²) em dB, para sons do mesmo tamanho; som idêntico dá Infinity. */
function snr(x: Float32Array, y: Float32Array): number {
  let noise = 0;
  for (let i = 0; i < x.length; i++) noise += (x[i] - y[i]) ** 2;
  return noise === 0 ? Infinity : 10 * Math.log10(energy(x) / noise);
}

describe('som com cortes (ffmpeg)', () => {
  const src = join(dir, 'fonte30.mp4');
  /** Imagem de 4 s e som de 2 s: o arquivo dura 4 s e tem som. */
  const short = join(dir, 'som-curto.mp4');
  const frame = Buffer.alloc(64 * 64 * 4, 128);
  beforeAll(() => {
    execFileSync(FFMPEG, [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=30:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=30',
      '-c:v', 'libx264', '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src,
    ]);
    execFileSync(FFMPEG, [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2',
      '-c:v', 'libx264', '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', short,
    ]);
  }, 60_000);

  it('o asetpts arredonda: nenhum quadro de som sai uma amostra adiantado', () => {
    // O ffmpeg calcula N/SR/TB em double: 3003/48000/(1/48000) dá 3002,9999…, que truncado vira 3002.
    const g = audioGraph([{ mediaId: 'm', path: 'x.mp4', tl0: 0, src0: 2003, n: 897997, volume: 1 }], 897997, 0);
    const seg = g.filters.find((f) => f.endsWith('[s0]'))!;
    const chain = `${seg.replace(/^\[i0_0\]/, '').replace(/\[s0\]$/, '')},ashowinfo`;
    const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=20', '-af', chain, '-f', 'null', '-'], { encoding: 'utf8' });
    const pts = [...r.stderr.matchAll(/pts:(\d+)/g)].map((m) => Number(m[1]));
    const sizes = [...r.stderr.matchAll(/nb_samples:(\d+)/g)].map((m) => Number(m[1]));
    expect(pts.length).toBeGreaterThan(800);
    expect(sizes).toHaveLength(pts.length);
    // Cada quadro começa onde o anterior acaba: pts = soma das amostras de antes.
    const off: string[] = [];
    let sum = 0;
    pts.forEach((p, i) => {
      if (p !== sum) off.push(`quadro ${i}: pts ${p}, esperado ${sum}`);
      sum += sizes[i];
    });
    expect(off).toEqual([]);
  });

  it('300 pedaços: duração certa e som sem buraco', async () => {
    const ranges = Array.from({ length: 299 }, (_, i): TimeRange => [round(0.1 * (i + 1) - 0.02), round(0.1 * (i + 1))]);
    const p = applyOps(fileProject(src, 30, [{ id: 'v', start: 0, in: 0 }]), [{ op: 'removeRanges', ranges }]).project;
    expect(p.clips).toHaveLength(300);
    const out = join(dir, 'pedacos.mp4');
    await exportFrames(p, out, frame);
    expect(probe(out)!.duration).toBeCloseTo(24.02, 1);
    expect(silence(out)).not.toContain('silence_start');
  }, 60_000);

  it('dividir sem cortar sai perfeito (duas mídias do mesmo arquivo, com concat)', async () => {
    const whole = fileProject(src, 30, [{ id: 'a', start: 0, duration: 3, in: 0 }]);
    const split = fileProject(src, 30, [
      { id: 'a', media: 'm1', start: 0, duration: 1.5, in: 0 },
      { id: 'b', media: 'm2', start: 1.5, duration: 1.5, in: 1.5 },
    ]);
    expect(audioSegments(split)).toHaveLength(2);
    const x = join(dir, 'inteiro.mp4');
    const y = join(dir, 'dividido.mp4');
    await exportFrames(whole, x, frame);
    await exportFrames(split, y, frame);
    const [a, b] = [pcm(x), pcm(y)];
    expect(b.length).toBe(a.length);
    expect(a.length).toBeGreaterThanOrEqual(2.9 * 48000);
    expect(energy(a)).toBeGreaterThan(0);
    expect(snr(a, b)).toBeGreaterThanOrEqual(90);
  }, 60_000);

  it('pedaços fora da ordem do arquivo: duração certa e som sem buraco', async () => {
    const p = fileProject(src, 30, [
      { id: 'a', start: 0, duration: 1, in: 2 },
      { id: 'b', start: 1, duration: 1, in: 0 },
    ]);
    const out = join(dir, 'fora-da-ordem.mp4');
    await exportFrames(p, out, frame);
    expect(probe(out)!.duration).toBeCloseTo(2, 1);
    expect(silence(out)).not.toContain('silence_start');
  }, 60_000);

  it('pedaços fora da ordem tocam o trecho certo do arquivo', async () => {
    // Seno de 1 kHz com amplitude 0,03·t: a altura do som diz de que instante do arquivo ele veio.
    const ramp = join(dir, 'rampa.m4a');
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.03*t*sin(2*PI*1000*t):s=48000:d=30', '-c:a', 'aac', '-b:a', '192k', ramp]);
    const p = fileProject(ramp, 30, [
      { id: 'a', start: 0, duration: 1, in: 20 },
      { id: 'b', start: 1, duration: 1, in: 5 },
    ]);
    const out = join(dir, 'rampa-fora-da-ordem.mp4');
    await exportFrames(p, out, frame);
    const x = pcm(out);
    const w = 0.5 * 48000;
    expect(x.length).toBeGreaterThanOrEqual(4 * w);
    // Cada janela de 0,5 s da saída e o meio do trecho do arquivo que ela toca.
    [20.25, 20.75, 5.25, 5.75].forEach((m, i) => {
      const want = (0.03 * m) / Math.SQRT2;
      const got = rms(x.subarray(i * w, (i + 1) * w));
      expect(Math.abs(got - want) / want, `janela ${i + 1}: ${got.toFixed(3)}, esperado ${want.toFixed(3)}`).toBeLessThanOrEqual(0.05);
    });
  }, 60_000);

  it('som mais curto que a imagem: apagar um trecho deixa o silêncio no lugar', async () => {
    // Fica [0, 1) in 0 e [1; 2,5) in 2,5 do arquivo curto (depois do fim do som dele) e [2,5; 4,5) do outro.
    const p = applyOps(fileProject(short, 4, [{ id: 'v1', media: 'curto', start: 0, duration: 4, in: 0 }]), [
      { op: 'addMedia', media: { id: 'longo', path: src, name: 'longo', duration: 30, width: 64, height: 64, hasAudio: true } },
      { op: 'addClip', clip: { kind: 'video', id: 'v2', mediaId: 'longo', start: 4, duration: 2, in: 0 } },
      { op: 'removeRanges', ranges: [[1, 2.5]] },
    ]).project;
    const out = join(dir, 'som-curto-corte.mp4');
    await exportFrames(p, out, frame);
    const s = silences(out);
    expect(s).toHaveLength(1);
    expect(Math.abs(s[0].start - 1)).toBeLessThanOrEqual(0.02);
    expect(Math.abs((s[0].end ?? NaN) - 2.5)).toBeLessThanOrEqual(0.02);
  }, 60_000);

  it('som mais curto que a imagem: pedaço depois do fim do som no fim da faixa', async () => {
    const p = fileProject(short, 4, [
      { id: 'a', start: 0, duration: 1, in: 0 },
      { id: 'b', start: 1, duration: 1, in: 3 },
    ]);
    const out = join(dir, 'som-curto-fim.mp4');
    await exportFrames(p, out, frame);
    const [first] = silences(out);
    expect(first).toBeDefined();
    expect(Math.abs(first.start - 1)).toBeLessThanOrEqual(0.02);
    expect(first.end ?? probe(out)!.duration).toBeGreaterThanOrEqual(1.95);
  }, 60_000);

  it.runIf(!!(process.env.CI || process.env.DIRETOR_TESTE_LONGO))('1 hora com 300 pedaços espalhados', async () => {
    const hour = join(dir, 'hora.m4a');
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3600', '-c:a', 'aac', '-b:a', '96k', hour]);
    const ranges = Array.from({ length: 300 }, (_, i): TimeRange => [round(12 * i + 0.1), i === 299 ? 3600 : 12 * (i + 1)]);
    const p = applyOps(fileProject(hour, 3600, [{ id: 'v', start: 0, duration: 3600, in: 0 }]), [{ op: 'removeRanges', ranges }]).project;
    expect(p.clips).toHaveLength(300);
    const out = join(dir, 'hora.mp4');
    const t0 = Date.now();
    await exportFrames(p, out, frame);
    console.log(`exportação de 300 pedaços de uma mídia de 1 hora: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const info = probe(out)!;
    expect(info.duration).toBeCloseTo(30, 1);
    expect(info.hasAudio).toBe(true);
    expect(silence(out)).not.toContain('silence_start');
  }, 20 * 60_000);
});
