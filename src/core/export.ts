// Montagem dos argumentos do ffmpeg. O vídeo chega como quadros RGBA já
// compostos (pelo mesmo renderFrame da prévia); o áudio vem direto dos
// arquivos originais, aparado e posicionado igual à linha do tempo
// (exportAudio.ts). O grafo de filtros vai num arquivo de script, ao lado da saída.

import { audioGraph, audioSegments } from './exportAudio';
import { type Project, projectDuration } from './model';
import { SAMPLE_RATE } from './time';

/** Teto dos argumentos: a linha de comando do Windows tem no máximo 32.767 caracteres. */
export const MAX_ARGS_CHARS = 30_000;

export function exportDuration(p: Project): number {
  return projectDuration(p);
}

export function frameCount(p: Project): number {
  return Math.max(1, Math.round(exportDuration(p) * p.settings.fps));
}

/**
 * Argumentos do ffmpeg e o texto do script de filtros, que quem chama grava em
 * `scriptPath` antes de rodar. Lança Error (em pt-BR) quando a linha de comando
 * passaria de MAX_ARGS_CHARS.
 */
export function buildFfmpegArgs(p: Project, outPath: string, scriptPath: string): { args: string[]; script: string } {
  const { width: W, height: H, fps } = p.settings;
  const total = frameCount(p) / fps;
  const audio = audioGraph(audioSegments(p), Math.round(total * SAMPLE_RATE), 1);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', fpsArg(fps), '-i', 'pipe:0'];
  for (const path of audio.inputs) args.push('-i', path);
  args.push('-filter_complex_script', scriptPath, '-map', '[vout]');
  if (audio.out) args.push('-map', audio.out, '-c:a', 'aac', '-b:a', '192k');
  args.push(
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart', '-t', total.toFixed(3), '-f', 'mp4', outPath,
  );
  if (args.reduce((sum, a) => sum + a.length + 3, 0) > MAX_ARGS_CHARS)
    throw new Error(
      `Este projeto abre arquivos demais de uma vez para exportar (${audio.inputs.length} aberturas). Use menos vídeos diferentes ou menos trechos fora da ordem do arquivo.`,
    );
  // RGB do canvas → YUV com a matriz BT.709 (a que o Chromium e os players usam
  // para HD) e marcado no arquivo: as cores do MP4 ficam iguais às da prévia.
  const script = ['[0:v]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[vout]', ...audio.filters].join(';\n');
  return { args, script };
}

export interface ProbeResult {
  duration: number;
  /** Tamanho como o vídeo aparece na tela (já com rotação e proporção de pixel). */
  width: number;
  height: number;
  hasAudio: boolean;
  /** Quadros por segundo do arquivo, quando o ffmpeg informa. */
  fps?: number;
}

/**
 * O ffmpeg mostra o fps com 2 casas ("23.98" para 24000/1001). Usar o valor
 * arredondado atrasaria a busca de quadro e repetiria um quadro a cada poucos
 * segundos; então volta ao valor exato (NTSC) ou ao inteiro (média de celular).
 */
export function exactFps(shown: number): number {
  const n = Math.round(shown * 1.001);
  const ntsc = (n * 1000) / 1001;
  if (Math.abs(shown - Math.round(shown)) > 0.006 && Math.abs(shown - ntsc) < 0.006) return ntsc;
  if (Math.abs(shown - Math.round(shown)) < 0.05) return Math.round(shown);
  return shown;
}

/** fps para a linha de comando do ffmpeg: fração exata quando é NTSC (24000/1001). */
export function fpsArg(fps: number): string {
  const n = Math.round(fps * 1.001);
  if (Math.abs(fps - Math.round(fps)) > 1e-9 && Math.abs(fps - (n * 1000) / 1001) < 1e-9) return `${n * 1000}/1001`;
  return String(fps);
}

/** Lê a saída de `ffmpeg -i arquivo` (stderr). */
export function parseFfmpegProbe(stderr: string): ProbeResult | null {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const line = /Stream #[^\n]*Video:[^\n]*/.exec(stderr)?.[0];
  const v = line && /(\d{2,5})x(\d{2,5})/.exec(line);
  if (!d || !line || !v) return null;
  let width = Number(v[1]);
  let height = Number(v[2]);
  // Pixel não quadrado: "[SAR 4:3 DAR 16:9]".
  const sar = /\[SAR (\d+):(\d+)/.exec(line);
  if (sar && Number(sar[1]) > 0 && Number(sar[2]) > 0 && sar[1] !== sar[2]) width = Math.round((width * Number(sar[1])) / Number(sar[2]));
  // Celular em pé: "displaymatrix: rotation of -90.00 degrees" (ffmpeg 6/7), "Display Matrix: rotation
  // of -90.00 degrees" (8.1+) ou "rotate : 90" (antigas). Só no bloco deste vídeo, até o próximo stream.
  const after = stderr.slice(stderr.indexOf(line) + line.length);
  const next = after.search(/\n\s*Stream #/);
  const block = next >= 0 ? after.slice(0, next) : after;
  const rot = /rotation of (-?\d+(?:\.\d+)?) degrees/i.exec(block) ?? /rotate\s*:\s*(-?\d+)/.exec(block);
  if (rot && Math.abs(Math.round(Number(rot[1]))) % 180 === 90) [width, height] = [height, width];
  const f = /(\d+(?:\.\d+)?) fps/.exec(line);
  const fps = f ? exactFps(Number(f[1])) : undefined;
  return {
    duration: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]),
    width,
    height,
    hasAudio: /Stream #[^\n]*Audio:/.test(stderr),
    ...(fps && fps >= 1 && fps <= 120 ? { fps } : {}),
  };
}
