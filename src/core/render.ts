// Composição de um quadro. É o MESMO código na prévia e na exportação: o que
// você vê é o que vai para o MP4 (enquadramento, tempo, legendas e animação).

import type { CaptionClip, Clip, Project, TextStyle, TitleClip, VideoClip } from './model';
import { evalClipProp } from './properties';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface VideoFrame {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export interface RenderOptions {
  /** Devolve o quadro atual do vídeo do clipe (já posicionado no tempo certo). */
  getVideoFrame: (clip: VideoClip) => VideoFrame | null;
  /** Ajuste temporário de posição durante um arraste (só prévia). */
  dragOffset?: { clipId: string; dx: number; dy: number } | null;
}

export function isActiveAt(c: Clip, t: number): boolean {
  return t >= c.start - 1e-9 && t < c.start + c.duration - 1e-9;
}

/** Tempo no arquivo original para o tempo `t` da linha do tempo. */
export function sourceTime(c: VideoClip, t: number): number {
  return c.in + (t - c.start);
}

export function visibleClipsAt(p: Project, t: number): Clip[] {
  const out: Clip[] = [];
  for (const tr of p.tracks) {
    if (tr.hidden) continue;
    for (const c of p.clips) if (c.trackId === tr.id && isActiveAt(c, t)) out.push(c);
  }
  return out;
}

export function fontFor(style: TextStyle): string {
  return `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
}

export interface TextLayout {
  lines: string[];
  lineHeight: number;
  width: number;
  height: number;
  /** Centro do bloco, em pixels do projeto (antes da escala). */
  cx: number;
  cy: number;
  scale: number;
  opacity: number;
}

function wrap(ctx: Ctx2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = `${line} ${words[i]}`;
      if (ctx.measureText(test).width > maxWidth) {
        out.push(line);
        line = words[i];
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

export function layoutText(ctx: Ctx2D, p: Project, c: TitleClip | CaptionClip, t: number, drag?: RenderOptions['dragOffset']): TextLayout {
  const { width: W, height: H } = p.settings;
  ctx.font = fontFor(c.style);
  const maxW = W * (c.kind === 'caption' ? 0.8 : 0.9);
  const lines = wrap(ctx, c.text, maxW);
  const lineHeight = c.style.fontSize * 1.2;
  const width = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  const height = lineHeight * lines.length;
  const opacity = evalClipProp(c, 'opacity', t);
  if (c.kind === 'caption') {
    return { lines, lineHeight, width, height, cx: W / 2, cy: H * 0.9 - height / 2, scale: 1, opacity };
  }
  let cx = W / 2 + evalClipProp(c, 'x', t);
  let cy = H / 2 + evalClipProp(c, 'y', t);
  if (drag && drag.clipId === c.id) (cx += drag.dx), (cy += drag.dy);
  return { lines, lineHeight, width, height, cx, cy, scale: evalClipProp(c, 'scale', t), opacity };
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawText(ctx: Ctx2D, c: TitleClip | CaptionClip, L: TextLayout): void {
  if (L.opacity <= 0 || L.scale <= 0) return;
  const s = c.style;
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, L.opacity));
  ctx.translate(L.cx, L.cy);
  ctx.scale(L.scale, L.scale);
  ctx.font = fontFor(s);
  ctx.textBaseline = 'middle';
  ctx.textAlign = s.align;
  const padX = s.fontSize * 0.45;
  const padY = s.fontSize * 0.2;
  if (s.background) {
    ctx.fillStyle = s.background;
    roundRect(ctx, -L.width / 2 - padX, -L.height / 2 - padY, L.width + padX * 2, L.height + padY * 2, s.fontSize * 0.3);
    ctx.fill();
  }
  if (s.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = s.fontSize * 0.12;
    ctx.shadowOffsetY = s.fontSize * 0.04;
  }
  ctx.fillStyle = s.color;
  const x = s.align === 'left' ? -L.width / 2 : s.align === 'right' ? L.width / 2 : 0;
  L.lines.forEach((line, i) => {
    const y = -L.height / 2 + L.lineHeight * (i + 0.5);
    ctx.fillText(line, x, y);
  });
  ctx.restore();
}

/** Retângulo (em pixels do projeto) do vídeo encaixado no quadro, com transformações. */
export function videoRect(p: Project, c: VideoClip, f: { width: number; height: number }, t: number, drag?: RenderOptions['dragOffset']) {
  const { width: W, height: H } = p.settings;
  const fit = Math.min(W / f.width, H / f.height);
  const sc = evalClipProp(c, 'scale', t);
  const w = f.width * fit * sc;
  const h = f.height * fit * sc;
  let cx = W / 2 + evalClipProp(c, 'x', t);
  let cy = H / 2 + evalClipProp(c, 'y', t);
  if (drag && drag.clipId === c.id) (cx += drag.dx), (cy += drag.dy);
  return { x: cx - w / 2, y: cy - h / 2, w, h, opacity: evalClipProp(c, 'opacity', t) };
}

/**
 * Desenha o quadro do tempo `t` em `ctx`, cujo tamanho em pixels deve ser o do
 * projeto (a prévia usa CSS para encolher o canvas).
 */
export function renderFrame(ctx: Ctx2D, p: Project, t: number, opts: RenderOptions): void {
  const { width: W, height: H } = p.settings;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  for (const c of visibleClipsAt(p, t)) {
    if (c.kind === 'video') {
      const f = opts.getVideoFrame(c);
      if (!f || !f.width || !f.height) continue;
      const r = videoRect(p, c, f, t, opts.dragOffset);
      if (r.opacity <= 0) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, r.opacity);
      ctx.drawImage(f.image, r.x, r.y, r.w, r.h);
      ctx.restore();
    } else {
      drawText(ctx, c, layoutText(ctx, p, c, t, opts.dragOffset));
    }
  }
  ctx.restore();
}

/** Clipe visual sob o ponto (pixels do projeto), do topo para o fundo. */
export function hitTest(ctx: Ctx2D, p: Project, t: number, x: number, y: number, frames: (c: VideoClip) => VideoFrame | null): Clip | null {
  const clips = visibleClipsAt(p, t).reverse();
  for (const c of clips) {
    if (c.kind === 'video') {
      const f = frames(c);
      if (!f) continue;
      const r = videoRect(p, c, f, t);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return c;
    } else {
      const L = layoutText(ctx, p, c, t);
      const hw = (L.width / 2 + c.style.fontSize * 0.45) * L.scale;
      const hh = (L.height / 2 + c.style.fontSize * 0.2) * L.scale;
      if (Math.abs(x - L.cx) <= hw && Math.abs(y - L.cy) <= hh) return c;
    }
  }
  return null;
}
