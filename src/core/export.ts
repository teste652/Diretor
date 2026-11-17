// Montagem dos argumentos do ffmpeg. O vídeo chega como quadros RGBA já
// compostos (pelo mesmo renderFrame da prévia); o áudio vem direto dos
// arquivos originais, aparado e posicionado igual à linha do tempo.

import { type Project, type VideoClip, projectDuration } from './model';

export function exportDuration(p: Project): number {
  return projectDuration(p);
}

export function frameCount(p: Project): number {
  return Math.max(1, Math.round(exportDuration(p) * p.settings.fps));
}

export function buildFfmpegArgs(p: Project, outPath: string): string[] {
  const { width: W, height: H, fps } = p.settings;
  const total = frameCount(p) / fps;
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', 'pipe:0'];
  const videoTrack = p.tracks.find((t) => t.kind === 'video');
  const audible = p.clips.filter(
    (c): c is VideoClip =>
      c.kind === 'video' && !c.muted && c.volume > 0 && !videoTrack?.hidden && !!p.media.find((m) => m.id === c.mediaId)?.hasAudio,
  );
  const filters: string[] = [];
  audible.forEach((c, i) => {
    const m = p.media.find((x) => x.id === c.mediaId)!;
    args.push('-ss', c.in.toFixed(3), '-t', c.duration.toFixed(3), '-i', m.path);
    const delay = Math.round(c.start * 1000);
    filters.push(`[${i + 1}:a]asetpts=PTS-STARTPTS,volume=${c.volume},adelay=${delay}:all=1[a${i}]`);
  });
  if (audible.length) {
    const ins = audible.map((_, i) => `[a${i}]`).join('');
    filters.push(`${ins}amix=inputs=${audible.length}:normalize=0:duration=longest,apad[aout]`);
    args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
  } else {
    args.push('-map', '0:v');
  }
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', total.toFixed(3), outPath);
  return args;
}

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

/** Lê a saída de `ffmpeg -i arquivo` (stderr). */
export function parseFfmpegProbe(stderr: string): ProbeResult | null {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const v = /Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(stderr);
  if (!d || !v) return null;
  return {
    duration: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]),
    width: Number(v[1]),
    height: Number(v[2]),
    hasAudio: /Stream #[^\n]*Audio:/.test(stderr),
  };
}
