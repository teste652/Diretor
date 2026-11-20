import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type Clip, type Project, type VideoClip, findClip, projectDuration } from '../core/model';
import type { Op } from '../core/operations';
import { evalClipProp } from '../core/properties';
import { hitTest, isActiveAt, layoutText, renderFrame, sourceTime, videoRect, visibleClipsAt } from '../core/render';
import { fmtTime, frameAt, playback, session, usePlayback, useSession } from './store';
import { Icon, run, showToast } from './ui';
import { SEEK_EPSILON, VideoPool, seekExact } from './video';
import { nextToPrefetch } from './videoSlots';

export const previewPool: { current: VideoPool | null } = { current: null };

const activeVideos = (p: Project, t: number) => p.clips.filter((c): c is VideoClip => c.kind === 'video' && isActiveAt(c, t));

// Última sincronização da prévia parada (vídeos posicionados + quadro desenhado).
let lastSync: Promise<void> = Promise.resolve();
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Resolve quando a prévia mostra o quadro do playhead atual (usado pelo teste de ponta a ponta). */
export async function previewSettled(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await lastSync;
  await nextFrame();
}

export function Preview() {
  const s = useSession();
  const pb = usePlayback();
  const view = s.view;
  const { width: W, height: H, fps } = view.settings;
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [css, setCss] = useState({ w: 640, h: 360 });
  const [volume, setVolumeState] = useState(0.9);
  // O volume fica num ref: mexer no controle não reinicia a reprodução.
  const volumeRef = useRef(0.9);
  const setVolume = (v: number) => {
    volumeRef.current = v;
    setVolumeState(v);
  };
  const drag = useRef<{ clipId: string; sx: number; sy: number; dx: number; dy: number } | null>(null);
  const raf = useRef(0);
  // Na reprodução, o mesmo teste do tick (cada vídeo ativo tem quadro): um elemento que termina de
  // buscar ou carregar não faz desenhar enquanto outro vídeo ativo ainda está trocando. Parado: null.
  const framesGate = useRef<(() => boolean) | null>(null);

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

  if (!previewPool.current)
    previewPool.current = new VideoPool(
      () =>
        requestAnimationFrame(() => {
          if (!framesGate.current || framesGate.current()) draw();
        }),
      true,
      (path, msg) => showToast(`Não consegui abrir ${path.split(/[\\/]/).pop()}: ${msg}`, true),
    );

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
    pool.warm(view);
    if (pb.playing) return;
    for (const el of pool.all()) if (!el.paused) el.pause();
    const t = pb.time;
    const active = activeVideos(view, t);
    const protect = new Set(active.map((c) => c.id));
    const els = active.map((c) => ({ c, el: pool.element(c, view, protect) })).filter((x): x is { c: VideoClip; el: HTMLVideoElement } => !!x.el);
    const settled = els.every(({ c, el }) => !!el.error || (el.readyState >= 2 && !el.seeking && Math.abs(el.currentTime - (sourceTime(c, t) + SEEK_EPSILON)) < 1e-3));
    lastSync = Promise.all(els.map(({ c, el }) => seekExact(el, sourceTime(c, t)))).then(() => {
      if (!playback.get().playing) draw();
    });
    // Só desenha já se nenhum vídeo precisa buscar quadro: durante a busca o
    // canvas continua mostrando o quadro anterior (sem piscar preto).
    if (settled) draw();
  }, [view, pb.time, pb.playing, draw]);

  // Reprodução: o vídeo que está tocando é o relógio (títulos e animação
  // acompanham a imagem e o som); sem vídeo ativo, o relógio do sistema.
  useEffect(() => {
    if (!pb.playing) return;
    const pool = previewPool.current!;
    let anchor = { wall: performance.now(), t: playback.get().time };
    let epoch = playback.epoch();
    let stopped = false;
    // Toca os vídeos ativos, prepara o pedaço da próxima emenda e pausa o resto.
    const sync = (p: typeof view, t: number, hard: boolean) => {
      const videoTrack = p.tracks.find((tr) => tr.kind === 'video');
      const active = activeVideos(p, t);
      const protect = new Set(active.map((c) => c.id));
      const playing = new Set<HTMLVideoElement>();
      for (const c of active) {
        const el = pool.element(c, p, protect);
        if (!el) continue;
        playing.add(el);
        if (el.error) continue;
        el.volume = Math.max(0, Math.min(1, volumeRef.current * c.volume));
        el.muted = c.muted || !!videoTrack?.hidden;
        const want = sourceTime(c, t);
        const off = Math.abs(el.currentTime - want);
        if ((hard && off > 1e-3) || off > 0.3) el.currentTime = want;
        if (el.paused) void el.play().catch(() => undefined);
      }
      const next = nextToPrefetch(p, t, active);
      if (next) pool.prefetch(next, p, protect);
      for (const el of pool.all()) if (!playing.has(el) && !el.paused) el.pause();
    };
    const masterTime = (p: typeof view, t: number): number | null => {
      for (const c of activeVideos(p, t)) {
        const el = pool.peek(c);
        // Um pedaço que continua o anterior no mesmo elemento pode estar uns milissegundos antes da
        // emenda: o relógio não volta para o pedaço anterior, que já entregou o elemento.
        if (el && !el.paused && !el.seeking && el.readyState >= 3) return Math.max(c.start, c.start + (el.currentTime - c.in));
      }
      return null;
    };
    // Cada vídeo que aparece (fora de faixa oculta, como no renderFrame) tem quadro (ou erro). Enquanto um
    // elemento busca ou carrega, o canvas fica com o último quadro bom em vez de piscar preto; um vídeo
    // escondido não segura os textos. Sem elemento (mídia fora do projeto), não há o que esperar.
    const framesReady = (p: typeof view, t: number) =>
      visibleClipsAt(p, t)
        .filter((c): c is VideoClip => c.kind === 'video')
        .every((c) => {
          const el = pool.peek(c);
          return !el || !!el.error || (el.readyState >= 2 && !el.seeking);
        });
    const tick = () => {
      if (stopped) return;
      const p = session.view;
      const now = performance.now();
      if (playback.epoch() !== epoch) {
        // O usuário clicou em outro ponto durante a reprodução.
        epoch = playback.epoch();
        anchor = { wall: now, t: playback.get().time };
        sync(p, anchor.t, true);
      }
      let t = anchor.t + (now - anchor.wall) / 1000;
      const vt = masterTime(p, t);
      if (vt !== null && Math.abs(vt - t) < 0.5) {
        t = vt;
        anchor = { wall: now, t };
      }
      const last = Math.max(0, projectDuration(p) - 1 / p.settings.fps);
      if (t >= last) {
        playback.set({ playing: false });
        playback.seek(last); // para no último quadro (não num quadro preto depois do fim)
        return;
      }
      playback.set({ time: t });
      sync(p, t, false);
      if (framesReady(p, t)) draw();
      raf.current = requestAnimationFrame(tick);
    };
    framesGate.current = () => framesReady(session.view, playback.get().time);
    sync(session.view, anchor.t, true);
    raf.current = requestAnimationFrame(tick);
    // Janela minimizada: o rAF para, então pausa tudo (o som não passa do ponto de corte).
    const onVisibility = () => {
      if (document.hidden) playback.set({ playing: false });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      framesGate.current = null;
      cancelAnimationFrame(raf.current);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const el of pool.all()) el.pause();
      session.setPlayhead(playback.get().time);
    };
  }, [pb.playing, draw]);

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
        <span className="time" data-testid="timecode">
          {fmtTime(pb.time, fps)} / {fmtTime(total, fps)}
        </span>
        <span className="hint" title="Número do quadro (a partir de 0), útil para pedir “do quadro 15 ao 45”">
          quadro {frameAt(pb.time, fps)}
        </span>
        <span style={{ flex: 1 }} />
        <span className="hint">
          {W}×{H} · {Math.round(fps * 1000) / 1000} fps
        </span>
        <span style={{ color: 'var(--muted)' }}>{volume > 0 ? Icon.volume : Icon.mute}</span>
        <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
      </div>
    </div>
  );
}

export function togglePlay() {
  const { playing, time } = playback.get();
  const p = session.view;
  const end = projectDuration(p);
  if (!playing && time >= end - 1.5 / p.settings.fps) playback.seek(0);
  playback.set({ playing: !playing && end > 0 });
}

function selectionBox(c: Clip, time: number, canvas: HTMLCanvasElement, k: number) {
  if (!isActiveAt(c, time)) return null;
  const ctx = canvas.getContext('2d')!;
  const p = session.view;
  const offX = canvas.offsetLeft;
  const offY = canvas.offsetTop;
  if (c.kind === 'video') {
    const f = previewPool.current?.frame(c) ?? previewPool.current?.videoSize(c);
    if (!f) return null;
    const r = videoRect(p, c, f, time);
    return { left: offX + r.x * k, top: offY + r.y * k, w: r.w * k, h: r.h * k };
  }
  const L = layoutText(ctx, p, c, time);
  const w = (L.width + c.style.fontSize * 0.9) * L.scale;
  const h = (L.height + c.style.fontSize * 0.4) * L.scale;
  return { left: offX + (L.cx - w / 2) * k, top: offY + (L.cy - h / 2) * k, w: w * k, h: h * k };
}
