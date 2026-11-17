import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type Clip, type VideoClip, findClip, projectDuration } from '../core/model';
import type { Op } from '../core/operations';
import { evalClipProp } from '../core/properties';
import { hitTest, isActiveAt, layoutText, renderFrame, sourceTime, videoRect } from '../core/render';
import { fmtTime, playback, session, usePlayback, useSession } from './store';
import { Icon, run } from './ui';
import { VideoPool, seekExact } from './video';

export const previewPool: { current: VideoPool | null } = { current: null };

export function Preview() {
  const s = useSession();
  const pb = usePlayback();
  const view = s.view;
  const { width: W, height: H, fps } = view.settings;
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [css, setCss] = useState({ w: 640, h: 360 });
  const [volume, setVolume] = useState(0.9);
  const drag = useRef<{ clipId: string; sx: number; sy: number; dx: number; dy: number } | null>(null);
  const raf = useRef(0);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    const pool = previewPool.current;
    if (!cv || !pool) return;
    const ctx = cv.getContext('2d')!;
    const p = session.view;
    renderFrame(ctx, p, playback.get().time, {
      getVideoFrame: (c) => pool.frame(c),
      dragOffset: drag.current ? { clipId: drag.current.clipId, dx: drag.current.dx, dy: drag.current.dy } : null,
    });
  }, []);

  if (!previewPool.current) previewPool.current = new VideoPool(() => requestAnimationFrame(draw), true);

  // Encaixa o canvas (tamanho real do projeto) no palco.
  useLayoutEffect(() => {
    const el = stageRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const k = Math.min((r.width - 16) / W, (r.height - 16) / H);
      setCss({ w: Math.max(1, W * k), h: Math.max(1, H * k) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  // Parado: posiciona cada vídeo ativo no quadro exato e redesenha.
  useEffect(() => {
    const pool = previewPool.current!;
    pool.prune(view);
    for (const c of view.clips) if (c.kind === 'video') pool.element(c, view);
    if (pb.playing) return;
    for (const [, el] of pool.all()) if (!el.paused) el.pause();
    const t = pb.time;
    const active = view.clips.filter((c): c is VideoClip => c.kind === 'video' && isActiveAt(c, t));
    Promise.all(active.map((c) => seekExact(pool.element(c, view)!, sourceTime(c, t)))).then(draw);
    draw();
  }, [view, pb.time, pb.playing, draw]);

  // Reprodução: relógio próprio; vídeos seguem o relógio.
  useEffect(() => {
    if (!pb.playing) return;
    const pool = previewPool.current!;
    const t0 = playback.get().time;
    const start = performance.now();
    const tick = () => {
      const p = session.view;
      const end = projectDuration(p);
      const t = t0 + (performance.now() - start) / 1000;
      if (t >= end) {
        playback.set({ playing: false });
        playback.seek(end);
        return;
      }
      playback.set({ time: t });
      const videoTrack = p.tracks.find((tr) => tr.kind === 'video');
      for (const c of p.clips) {
        if (c.kind !== 'video') continue;
        const el = pool.element(c, p);
        if (!el) continue;
        if (isActiveAt(c, t)) {
          el.volume = Math.min(1, volume * Math.min(c.volume, 1));
          el.muted = c.muted || !!videoTrack?.hidden;
          const want = sourceTime(c, t);
          if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want;
          if (el.paused) void el.play().catch(() => undefined);
        } else if (!el.paused) el.pause();
      }
      draw();
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf.current);
      for (const [, el] of pool.all()) el.pause();
      session.setPlayhead(playback.get().time);
    };
  }, [pb.playing, draw, volume]);

  const toProject = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = toProject(e);
    const hit = hitTest(ctx, session.view, playback.get().time, x, y, (c) => previewPool.current!.frame(c));
    if (!hit) {
      session.setSelection({ clipIds: [] });
      return;
    }
    session.setSelection({ clipIds: [hit.id] });
    if (hit.kind === 'caption' || session.view.tracks.find((t) => t.id === hit.trackId)?.locked) return;
    drag.current = { clipId: hit.id, sx: x, sy: y, dx: 0, dy: 0 };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const { x, y } = toProject(e);
    drag.current.dx = Math.round(x - drag.current.sx);
    drag.current.dy = Math.round(y - drag.current.sy);
    draw();
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || (d.dx === 0 && d.dy === 0)) return draw();
    const c = findClip(session.view, d.clipId);
    if (!c) return;
    const t = playback.get().time - c.start;
    const ops: Op[] = [];
    for (const [prop, delta] of [['x', d.dx], ['y', d.dy]] as const) {
      if (!delta) continue;
      const v = Math.round(evalClipProp(c, prop, playback.get().time) + delta);
      if (c.props[prop]?.keyframes.length) ops.push({ op: 'setKeyframe', clipId: c.id, prop, t: Math.min(Math.max(t, 0), c.duration), v });
      else ops.push({ op: 'setProperty', clipId: c.id, prop, value: v });
    }
    run(ops, 'Mover na prévia');
  };

  const total = projectDuration(view);
  const draft = s.draftInfo;
  const selected = s.selection.clipIds[0] ? findClip(view, s.selection.clipIds[0]) : undefined;
  const box = selected && canvasRef.current ? selectionBox(selected, pb.time, canvasRef.current, css.w / W) : null;

  return (
    <div className="panel preview">
      <div className="stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          style={{ width: css.w, height: css.h }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          data-testid="preview-canvas"
        />
        {box && (
          <div
            className={`sel-box ${draft.clipIds.has(selected!.id) ? 'draft' : ''}`}
            style={{ left: box.left, top: box.top, width: box.w, height: box.h }}
          />
        )}
        {s.activeStep && (
          <div className="draft-flag">
            <span className="badge">Rascunho: {s.activeStep.label}</span>
          </div>
        )}
        {view.clips.length === 0 && <div className="empty" style={{ position: 'absolute' }}>Adicione um MP4 em “Mídia” para começar.</div>}
      </div>
      <div className="transport">
        <button className="btn ghost icon" title="Reproduzir (Espaço)" onClick={() => togglePlay()}>
          {pb.playing ? Icon.pause : Icon.play}
        </button>
        <button className="btn ghost icon" title="Início" onClick={() => playback.seek(0)}>
          {Icon.start}
        </button>
        <button className="btn ghost icon" title="Fim" onClick={() => playback.seek(Math.max(0, total - 1 / fps))}>
          {Icon.end}
        </button>
        <span className="time">
          {fmtTime(pb.time, fps)} / {fmtTime(total, fps)}
        </span>
        <span style={{ flex: 1 }} />
        <span className="hint">
          {W}×{H} · {fps} fps
        </span>
        <span style={{ color: 'var(--muted)' }}>{volume > 0 ? Icon.volume : Icon.mute}</span>
        <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
      </div>
    </div>
  );
}

export function togglePlay() {
  const { playing, time } = playback.get();
  const end = projectDuration(session.view);
  if (!playing && time >= end - 0.01) playback.seek(0);
  playback.set({ playing: !playing && end > 0 });
}

function selectionBox(c: Clip, time: number, canvas: HTMLCanvasElement, k: number) {
  if (!isActiveAt(c, time)) return null;
  const ctx = canvas.getContext('2d')!;
  const p = session.view;
  const offX = canvas.offsetLeft;
  const offY = canvas.offsetTop;
  if (c.kind === 'video') {
    const f = previewPool.current?.frame(c);
    if (!f) return null;
    const r = videoRect(p, c, f, time);
    return { left: offX + r.x * k, top: offY + r.y * k, w: r.w * k, h: r.h * k };
  }
  const L = layoutText(ctx, p, c, time);
  const w = (L.width + c.style.fontSize * 0.9) * L.scale;
  const h = (L.height + c.style.fontSize * 0.4) * L.scale;
  return { left: offX + (L.cx - w / 2) * k, top: offY + (L.cy - h / 2) * k, w: w * k, h: h * k };
}
