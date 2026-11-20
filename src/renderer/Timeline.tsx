import { useEffect, useRef, useState } from 'react';
import { type Clip, type Track, newId, projectDuration } from '../core/model';
import { type Op, clampTrimDelta } from '../core/operations';
import { keyframeAt } from '../core/properties';
import { snapToFrame } from '../core/time';
import { fmtTime, marks, playback, session, useMarks, usePlayback, useSession } from './store';
import { fmtRemoved, markedRange, splitTargets, withIn, withOut } from './timelineLogic';
import { Icon, run, showToast } from './ui';

type DragState =
  | { kind: 'move' | 'trimL' | 'trimR'; clipId: string; x0: number; dt: number }
  | { kind: 'kf'; clipId: string; t: number; x0: number; dt: number }
  | { kind: 'scrub' }
  /** Shift+arrastar na régua: marca o trecho entre o ponto de partida (t0) e o ponteiro. */
  | { kind: 'mark'; t0: number };

const LANES: { label: string; kind: Track['kind'] | 'audio' }[] = [
  { label: 'Legendas', kind: 'captions' },
  { label: 'Texto', kind: 'text' },
  { label: 'Vídeo', kind: 'video' },
  { label: 'Áudio', kind: 'audio' },
];

/** Cria no playhead e seleciona o clipe criado (só se a criação deu certo). */
function addAtPlayhead(kind: 'caption' | 'title') {
  const t = playback.get().time;
  const id = newId(kind === 'caption' ? 'cap' : 'ttl');
  const clip = kind === 'caption' ? { kind, id, start: round(t), duration: 2, text: 'Nova legenda' } : { kind, id, start: round(t), duration: 3, text: 'EM MOVIMENTO' };
  if (run([{ op: 'addClip', clip }], kind === 'caption' ? 'Adicionar legenda' : 'Adicionar título')) session.setSelection({ clipIds: [id] });
}

export function addCaptionAtPlayhead() {
  addAtPlayhead('caption');
}

export function addTitleAtPlayhead() {
  addAtPlayhead('title');
}

export function deleteSelection() {
  const ops: Op[] = session.selection.clipIds.map((id) => ({ op: 'removeClip', clipId: id }));
  if (ops.length) run(ops, 'Remover clipe');
}

/** Delete e o botão da lixeira: com um ponto selecionado, remove só o ponto (todas as propriedades naquele instante). */
export function deleteSelectedKeyframeOrClip() {
  const sel = session.selection.keyframe;
  if (sel) {
    const c = session.view.clips.find((x) => x.id === sel.clipId);
    const k = c?.props[sel.prop]?.keyframes.find((x) => x.id === sel.keyframeId);
    if (c && k) {
      const ops: Op[] = [];
      for (const [prop, ap] of Object.entries(c.props))
        for (const x of ap.keyframes) if (Math.abs(x.t - k.t) < 1e-3) ops.push({ op: 'removeKeyframe', clipId: c.id, prop, keyframeId: x.id });
      if (run(ops, 'Remover ponto')) session.setSelection({ clipIds: [c.id] });
      return;
    }
  }
  deleteSelection();
}

/** Ctrl+B e o botão Dividir: divide na agulha, no quadro mais próximo, o que `splitTargets` escolhe. */
export function splitAtPlayhead(): void {
  const view = session.view;
  const t = snapToFrame(playback.get().time, view.settings.fps);
  const ids = splitTargets(view, session.selection.clipIds, t);
  if (!ids.length) return showToast('Para dividir, coloque a agulha no meio de um clipe (longe das bordas).');
  run(ids.map((clipId): Op => ({ op: 'splitClip', clipId, at: t })), 'Dividir');
}

/** Shift+Delete e o botão Apagar trecho: tira o trecho marcado de todas as faixas e leva a agulha ao começo dele. */
export function deleteMarkedRange(): void {
  const r = markedRange(marks.get());
  if (!r) return showToast('Marque o trecho na régua (Shift+arrastar, ou I e O) para apagar.');
  if (!run([{ op: 'removeRanges', ranges: [r] }], 'Apagar trecho')) return;
  marks.set({ in: null, out: null });
  playback.seek(r[0]);
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function Timeline() {
  const s = useSession();
  const pb = usePlayback();
  const mk = useMarks();
  const range = markedRange(mk);
  const view = s.view;
  const fps = view.settings.fps;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(80); // pixels por segundo
  const [drag, setDrag] = useState<DragState | null>(null);
  const total = Math.max(projectDuration(view), 5);
  const width = total * pps + 200;
  const draft = s.draftInfo;

  // Ajusta o zoom ao conteúdo quando a duração muda bastante.
  const lastFit = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || Math.abs(lastFit.current - total) < 0.5) return;
    lastFit.current = total;
    setPps(Math.max(20, Math.min(300, (el.clientWidth - 40) / total)));
  }, [total]);

  const snap = (t: number) => Math.round(t * fps) / fps;
  const timeAt = (clientX: number) => {
    const r = scrollRef.current!.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + scrollRef.current!.scrollLeft) / pps);
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (drag.kind === 'scrub') return playback.seek(snap(timeAt(e.clientX)));
      if (drag.kind === 'mark') {
        // Para qualquer lado: a entrada é a menor das duas pontas.
        const t = snap(timeAt(e.clientX));
        return marks.set(withOut(withIn(marks.get(), Math.min(drag.t0, t)), Math.max(drag.t0, t)));
      }
      setDrag({ ...drag, dt: snap((e.clientX - drag.x0) / pps) });
    };
    const up = () => {
      setDrag(null);
      if (drag.kind === 'scrub' || drag.kind === 'mark' || !drag.dt) return;
      const c = view.clips.find((x) => x.id === drag.clipId);
      if (!c) return;
      if (drag.kind === 'move') run([{ op: 'updateClip', clipId: c.id, set: { start: round(Math.max(0, c.start + drag.dt)) } }], 'Mover clipe');
      if (drag.kind === 'trimL' || drag.kind === 'trimR') {
        // Limitado ao arquivo e à duração mínima. Entrada fica no começo, saída no
        // fim, e o resto da animação acompanha o conteúdo (ver trimClip).
        const edge = drag.kind === 'trimL' ? 'start' : 'end';
        const d = clampTrimDelta(view, c, edge, drag.dt);
        if (Math.abs(d) > 1e-6) run([{ op: 'trimClip', clipId: c.id, edge, delta: d }], edge === 'start' ? 'Aparar início' : 'Aparar fim');
      }
      if (drag.kind === 'kf') moveKeyframesAt(c, drag.t, drag.dt);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, pps, view]);

  const ticks: number[] = [];
  const stepSec = pps > 150 ? 0.5 : pps > 60 ? 1 : pps > 25 ? 3 : 5;
  for (let t = 0; t <= total + 2; t += stepSec) ticks.push(t);

  // Prévia do arrasto igual ao resultado do trimClip: o vídeo aparado no início fica
  // no lugar (o fim acompanha) e os vídeos seguintes da faixa andam junto.
  const dragged = drag && drag.kind !== 'scrub' && drag.kind !== 'mark' && drag.kind !== 'kf' ? view.clips.find((x) => x.id === drag.clipId) : undefined;
  const geom = (c: Clip) => {
    let start = c.start;
    let dur = c.duration;
    if (dragged && drag && drag.kind !== 'scrub' && drag.kind !== 'mark' && drag.kind !== 'kf') {
      const edge = drag.kind === 'trimL' ? 'start' : 'end';
      const d = drag.kind === 'move' ? 0 : clampTrimDelta(view, dragged, edge, drag.dt);
      if (dragged.id === c.id) {
        if (drag.kind === 'move') start = Math.max(0, start + drag.dt);
        if (drag.kind === 'trimR') dur += d;
        if (drag.kind === 'trimL') {
          if (c.kind !== 'video') start += d;
          dur -= d;
        }
      } else if (drag.kind !== 'move' && dragged.kind === 'video' && c.trackId === dragged.trackId && c.start >= dragged.start + dragged.duration - 1e-3) {
        start = Math.max(0, start + (edge === 'start' ? -d : d));
      }
    }
    return { left: start * pps, width: Math.max(4, dur * pps) };
  };

  const trackOf = (kind: string) => view.tracks.find((t) => t.kind === kind);
  const selKf = s.selection.keyframe;
  const selectedKfExists = !!selKf && !!view.clips.find((c) => c.id === selKf.clipId)?.props[selKf.prop]?.keyframes.some((k) => k.id === selKf.keyframeId);

  return (
    <div className="panel timeline">
      <div className="tl-toolbar">
        <button
          className="btn ghost icon"
          title={s.activeStep ? 'Desfazer ajuste do rascunho (Ctrl+Z). Para desfazer o projeto, aceite ou descarte o rascunho.' : 'Desfazer (Ctrl+Z)'}
          disabled={!s.canUndo}
          onClick={() => s.undo()}
        >
          {Icon.undo}
        </button>
        <button className="btn ghost icon" title={s.activeStep ? 'Refazer ajuste do rascunho (Ctrl+Y)' : 'Refazer (Ctrl+Y)'} disabled={!s.canRedo} onClick={() => s.redo()}>
          {Icon.redo}
        </button>
        <button
          className="btn ghost icon"
          title={selectedKfExists ? 'Remover ponto selecionado (Delete)' : 'Remover clipe selecionado (Delete)'}
          disabled={!s.selection.clipIds.length}
          onClick={deleteSelectedKeyframeOrClip}
          data-testid="trash"
        >
          {Icon.trash}
        </button>
        <button className="btn" title="Dividir na agulha (Ctrl+B)" onClick={splitAtPlayhead} data-testid="split">
          {Icon.scissors} Dividir
        </button>
        <button className="btn" title="Apagar o trecho marcado em todas as faixas (Shift+Delete)" disabled={!range} onClick={deleteMarkedRange} data-testid="delete-range">
          {Icon.cutRange} Apagar trecho
        </button>
        <button className="btn" onClick={addCaptionAtPlayhead} data-testid="add-caption">
          {Icon.plus} Adicionar legenda
        </button>
        <button className="btn" onClick={addTitleAtPlayhead}>
          {Icon.text} Título
        </button>
        <span style={{ flex: 1 }} />
        {s.activeStep ? (
          <span className="hint">Rascunho aberto: Ctrl+Z desfaz só os seus ajustes nele</span>
        ) : (
          s.past.length > 0 && <span className="hint">Último: {s.past[s.past.length - 1].label}</span>
        )}
        <span className="hint">Zoom</span>
        <input type="range" min={20} max={400} value={pps} onChange={(e) => setPps(Number(e.target.value))} style={{ accentColor: 'var(--accent)', width: 120 }} />
      </div>
      <div className="tl-body">
        <div className="tl-heads">
          {LANES.map((l) => {
            const tr = l.kind === 'audio' ? trackOf('video') : trackOf(l.kind);
            const videoClips = view.clips.filter((c) => c.kind === 'video');
            const allMuted = videoClips.length > 0 && videoClips.every((c) => c.kind === 'video' && c.muted);
            return (
              <div className="tl-head" key={l.label}>
                {l.kind === 'audio' ? (
                  <button
                    className={`mini ${allMuted ? 'off' : ''}`}
                    title={videoClips.length ? (allMuted ? 'Ativar áudio' : 'Silenciar áudio') : 'Sem vídeos com áudio'}
                    disabled={!videoClips.length}
                    onClick={() => run(videoClips.map((c) => ({ op: 'updateClip', clipId: c.id, set: { muted: !allMuted } }) as Op), 'Áudio')}
                  >
                    {allMuted ? Icon.mute : Icon.volume}
                  </button>
                ) : (
                  <button className={`mini ${tr?.hidden ? 'off' : ''}`} title="Mostrar/ocultar" onClick={() => tr && run([{ op: 'updateTrack', trackId: tr.id, set: { hidden: !tr.hidden } }])}>
                    {tr?.hidden ? Icon.eyeOff : Icon.eye}
                  </button>
                )}
                {l.kind !== 'audio' && (
                  <button className={`mini ${tr?.locked ? 'off' : ''}`} title="Travar/destravar" onClick={() => tr && run([{ op: 'updateTrack', trackId: tr.id, set: { locked: !tr.locked } }])}>
                    {tr?.locked ? Icon.lock : Icon.unlock}
                  </button>
                )}
                <span className="name">{l.label}</span>
              </div>
            );
          })}
        </div>
        <div className="tl-scroll" ref={scrollRef}>
          <div className="tl-inner" style={{ width }}>
            <div
              className="ruler"
              onPointerDown={(e) => {
                const t = snap(timeAt(e.clientX));
                // Shift+arrastar marca o trecho (as duas marcas no quadro); sem Shift, arrasta a agulha.
                if (e.shiftKey) {
                  marks.set(withOut(withIn(marks.get(), t), t));
                  return setDrag({ kind: 'mark', t0: t });
                }
                playback.seek(t);
                setDrag({ kind: 'scrub' });
              }}
            >
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: t * pps }}>
                  {t % 1 ? '' : fmtTime(t)}
                </div>
              ))}
            </div>
            {LANES.map((l) => {
              const tr = l.kind === 'audio' ? trackOf('video') : trackOf(l.kind);
              const clips = view.clips.filter((c) => c.trackId === tr?.id);
              return (
                <div className="lane" key={l.label} onPointerDown={(e) => e.target === e.currentTarget && session.setSelection({ clipIds: [] })}>
                  {clips.map((c) => {
                    const g = geom(c);
                    if (l.kind === 'audio') {
                      if (c.kind !== 'video' || !view.media.find((m) => m.id === c.mediaId)?.hasAudio) return null;
                      return <div key={c.id} className="clip audio" style={{ left: g.left, width: g.width, opacity: c.muted ? 0.35 : 1 }} />;
                    }
                    return (
                      <ClipBlock
                        key={c.id}
                        clip={c}
                        left={g.left}
                        width={g.width}
                        pps={pps}
                        selected={s.selection.clipIds.includes(c.id)}
                        isNewDraft={draft.addedClipIds.has(c.id)}
                        draftKfs={draft.keyframeIds}
                        selectedKf={s.selection.keyframe}
                        kfDrag={drag?.kind === 'kf' && drag.clipId === c.id ? drag : null}
                        onDown={(kind, e) => {
                          e.stopPropagation();
                          session.setSelection({ clipIds: [c.id] });
                          if (!tr?.locked) setDrag({ kind, clipId: c.id, x0: e.clientX, dt: 0 });
                        }}
                        onKfDown={(t, prop, keyframeId, e) => {
                          e.stopPropagation();
                          session.setSelection({ clipIds: [c.id], keyframe: { clipId: c.id, prop, keyframeId } });
                          playback.seek(c.start + t);
                          if (!tr?.locked) setDrag({ kind: 'kf', clipId: c.id, t, x0: e.clientX, dt: 0 });
                        }}
                      />
                    );
                  })}
                  {l.kind !== 'audio' &&
                    draft.range
                      .filter((r) => clips.some((c) => c.id === r.clipId) && !draft.addedClipIds.has(r.clipId))
                      .map((r) => {
                        const c = clips.find((x) => x.id === r.clipId)!;
                        const g = geom(c);
                        const left = Math.max(g.left, r.start * pps - 8);
                        const right = Math.min(g.left + g.width, Math.max(r.end * pps + 8, left + 60));
                        return (
                          <div key={`dz-${r.clipId}`} className="draft-zone" style={{ left, width: Math.max(40, right - left) }} title="Trecho que o rascunho do Claude muda">
                            <span className="tag">Rascunho da IA</span>
                          </div>
                        );
                      })}
                  {/* Com corte ou empurrão no rascunho, as posições do projeto não valem mais na view. */}
                  {l.kind !== 'audio' &&
                    !draft.ripple &&
                    s.project.clips
                      .filter((c) => draft.removedClipIds.has(c.id) && c.trackId === tr?.id)
                      .map((c) => (
                        <div key={`rm-${c.id}`} className="clip removed" style={{ left: c.start * pps, width: Math.max(4, c.duration * pps) }} title="O rascunho do Claude remove este clipe">
                          <span className="label">Remoção proposta · {c.kind === 'video' ? c.name : c.text}</span>
                        </div>
                      ))}
                  {l.kind === 'video' &&
                    draft.seams.map((seam, i) => (
                      <div key={`seam-${i}`} className="seam-chip" style={{ left: seam.at * pps }} title={`Corte do rascunho: ${fmtRemoved(seam.removed)}`}>
                        {fmtRemoved(seam.removed)}
                      </div>
                    ))}
                </div>
              );
            })}
            {range ? (
              <div className="range-band" style={{ left: range[0] * pps, width: (range[1] - range[0]) * pps }} />
            ) : (
              <>
                {mk.in !== null && <div className="mark-in" style={{ left: mk.in * pps }} />}
                {mk.out !== null && <div className="mark-out" style={{ left: mk.out * pps }} />}
              </>
            )}
            <div className="playhead" style={{ left: pb.time * pps }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function moveKeyframesAt(c: Clip, t: number, dt: number) {
  const ops: Op[] = [];
  const nt = round(Math.min(Math.max(0, t + dt), c.duration));
  for (const [prop, ap] of Object.entries(c.props)) {
    for (const k of ap.keyframes) {
      if (Math.abs(k.t - t) < 1e-3) ops.push({ op: 'setKeyframe', clipId: c.id, prop, t: nt, v: k.v, keyframeId: k.id });
    }
  }
  if (ops.length) run(ops, 'Mover ponto de animação');
}

function ClipBlock(props: {
  clip: Clip;
  left: number;
  width: number;
  pps: number;
  selected: boolean;
  isNewDraft: boolean;
  draftKfs: Set<string>;
  selectedKf?: { clipId: string; prop: string; keyframeId: string };
  kfDrag: { t: number; dt: number } | null;
  onDown: (kind: 'move' | 'trimL' | 'trimR', e: React.PointerEvent) => void;
  onKfDown: (t: number, prop: string, keyframeId: string, e: React.PointerEvent) => void;
}) {
  const { clip: c } = props;
  // Um losango por instante (agrupa propriedades no mesmo tempo).
  const diamonds = new Map<string, { t: number; prop: string; id: string; draft: boolean; sel: boolean }>();
  for (const [prop, ap] of Object.entries(c.props)) {
    for (const k of ap.keyframes) {
      const key = k.t.toFixed(3);
      const m = diamonds.get(key);
      const draft = props.draftKfs.has(k.id);
      const sel = props.selectedKf?.keyframeId === k.id;
      // O losango seleciona o ponto que a prévia mostra nesse instante.
      if (!m) diamonds.set(key, { t: k.t, prop, id: keyframeAt(ap, k.t)?.id ?? k.id, draft, sel });
      else {
        m.draft ||= draft;
        m.sel ||= sel;
      }
    }
  }
  const label = c.kind === 'video' ? c.name : c.text;
  return (
    <>
      <div
        className={`clip ${c.kind} ${props.selected ? 'selected' : ''} ${props.isNewDraft ? 'draft-new' : ''}`}
        style={{ left: props.left, width: props.width }}
        onPointerDown={(e) => props.onDown('move', e)}
        data-clip={c.id}
      >
        <div className="handle l" onPointerDown={(e) => props.onDown('trimL', e)} />
        <span className="label">
          {props.isNewDraft ? 'Rascunho da IA · ' : ''}
          {label}
        </span>
        <div className="handle r" onPointerDown={(e) => props.onDown('trimR', e)} />
      </div>
      {[...diamonds.values()].map((m) => {
        const t = props.kfDrag && Math.abs(props.kfDrag.t - m.t) < 1e-3 ? m.t + props.kfDrag.dt : m.t;
        return (
          <div
            key={m.id}
            className={`kf ${m.draft ? 'draft' : ''} ${m.sel ? 'sel' : ''}`}
            style={{ left: props.left + t * props.pps }}
            title={`${t.toFixed(2)}s`}
            onPointerDown={(e) => props.onKfDown(m.t, m.prop, m.id, e)}
          />
        );
      })}
    </>
  );
}
