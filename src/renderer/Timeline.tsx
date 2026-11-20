import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type Clip, type Track, newId, projectDuration } from '../core/model';
import { type Op, type TrimEdge, applyOps, clampTrimDelta } from '../core/operations';
import { keyframeAt } from '../core/properties';
import { snapToFrame } from '../core/time';
import { fmtTime, marks, playback, session, setCompare, useMarks, usePlayback, useSession } from './store';
import {
  type FitKey,
  anchoredScroll,
  deleteOps,
  fmtRemoved,
  followScroll,
  lockedSplitTrack,
  markedRange,
  shouldFit,
  splitTargets,
  tickStep,
  visibleClips,
  withIn,
  withOut,
  zoomBounds,
} from './timelineLogic';
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

/** Delete: um pedaço de vídeo sai sem deixar buraco (e as legendas vêm junto); ver deleteOps. */
export function deleteSelection() {
  const ops = deleteOps(session.view, session.selection.clipIds);
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
  // Com um trecho marcado, o Delete não tira o clipe inteiro: quem apaga o trecho é o Shift+Delete.
  if (markedRange(marks.get())) return showToast('Há um trecho marcado: Shift+Delete apaga o trecho, e Esc tira a marca.');
  deleteSelection();
}

/**
 * Ctrl+B e o botão Dividir: divide na agulha, no quadro mais próximo, o que `splitTargets` escolhe. No "Antes",
 * volta primeiro para o "Depois" no mesmo ponto do vídeo: divide o rascunho onde a pessoa está olhando.
 */
export function splitAtPlayhead(): void {
  setCompare(false);
  const view = session.view;
  const t = snapToFrame(playback.get().time, view.settings.fps);
  const ids = splitTargets(view, session.selection.clipIds, t);
  if (!ids.length) {
    const locked = lockedSplitTrack(view, session.selection.clipIds, t);
    return showToast(locked ? `A faixa "${locked}" está travada. Destrave a faixa para dividir.` : 'Para dividir, coloque a agulha no meio de um clipe (longe das bordas).');
  }
  run(ids.map((clipId): Op => ({ op: 'splitClip', clipId, at: t })), 'Dividir');
}

/**
 * Shift+Delete e o botão Apagar trecho: tira o trecho marcado de todas as faixas e leva a agulha ao começo dele.
 * No "Antes", volta primeiro para o "Depois" (as marcas e a agulha passam a valer no rascunho).
 */
export function deleteMarkedRange(): void {
  setCompare(false);
  const r = markedRange(marks.get());
  if (!r) return showToast('Marque o trecho na régua (Shift+arrastar, ou I e O) para apagar.');
  if (!run([{ op: 'removeRanges', ranges: [r] }], 'Apagar trecho')) return;
  marks.set({ in: null, out: null });
  playback.seek(r[0]);
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function Timeline() {
  const s = useSession();
  const mk = useMarks();
  const range = markedRange(mk);
  const view = s.view;
  const fps = view.settings.fps;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(80); // pixels por segundo
  const [drag, setDrag] = useState<DragState | null>(null);
  /** Rolagem e largura da área da linha do tempo (px): só o que está perto dela é desenhado. */
  const [area, setArea] = useState({ left: 0, width: 0 });
  const total = Math.max(projectDuration(view), 5);
  const width = total * pps + 200;
  const zb = zoomBounds(total, area.width);
  const draft = s.draftInfo;

  // A rolagem é lida uma vez por quadro; a largura, quando a área muda de tamanho.
  const readArea = useCallback(() => {
    const el = scrollRef.current;
    if (el) setArea((a) => (a.left === el.scrollLeft && a.width === el.clientWidth ? a : { left: el.scrollLeft, width: el.clientWidth }));
  }, []);
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        readArea();
      });
    };
    const ro = new ResizeObserver(readArea);
    ro.observe(el);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, [readArea]);
  // Zoom pelo controle: a agulha fica no mesmo ponto da tela (fora da área, o meio da área). A rolagem nova é
  // calculada antes de mudar o zoom: depois, o navegador já teria limitado a rolagem à largura nova.
  const pendingScroll = useRef<number | null>(null);
  const zoomTo = (next: number) => {
    const el = scrollRef.current;
    if (!el || next === pps) return;
    pendingScroll.current = anchoredScroll(el.scrollLeft, el.clientWidth, pps, next, playback.get().time);
    setPps(next);
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || pendingScroll.current === null) return;
    el.scrollLeft = pendingScroll.current;
    pendingScroll.current = null;
    readArea();
  }, [pps, readArea]);
  // Outro zoom ou outra duração mudam a largura do conteúdo, e o navegador pode ter limitado a rolagem: relê antes de pintar.
  useLayoutEffect(readArea, [width, readArea]);

  // O zoom cabe o projeto inteiro só ao abrir um projeto ou quando a linha do tempo ganha o primeiro clipe:
  // cortes, desfazer e rascunhos não tiram a pessoa do ponto onde está.
  const fitFor = useRef<FitKey | null>(null);
  const empty = view.clips.length === 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next = { loads: s.loads, empty };
    if (shouldFit(fitFor.current, next)) {
      el.scrollLeft = 0;
      setPps(zoomBounds(total, el.clientWidth).fit);
    }
    fitFor.current = next;
  }, [s.loads, empty, total]);

  // Limites novos (outra duração ou outra largura): o zoom que ficou fora deles volta para dentro.
  useEffect(() => {
    setPps((p) => Math.min(zb.max, Math.max(zb.min, p)));
  }, [zb.min, zb.max]);

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

  // A janela desenhada (s): a área visível e mais 300 px de cada lado, para a rolagem não mostrar buraco.
  const t0 = (area.left - 300) / pps;
  const t1 = (area.left + area.width + 300) / pps;
  const step = tickStep(pps);
  const ticks: number[] = [];
  for (let k = Math.max(0, Math.ceil(t0 / step)); k * step <= Math.min(t1, total + 2); k++) ticks.push(k * step);

  // Arrastar uma borda: a prévia é o resultado do próprio trimClip, refeito só quando o quanto a borda anda muda.
  // No vídeo o ripple vale em todas as faixas, então as legendas e os títulos também aparecem onde vão parar.
  // Se o trimClip falharia (por exemplo, numa faixa travada), nada muda até soltar.
  const trim = drag && (drag.kind === 'trimL' || drag.kind === 'trimR') ? drag : null;
  const trimEdge: TrimEdge = trim?.kind === 'trimL' ? 'start' : 'end';
  const trimmed = trim ? view.clips.find((c) => c.id === trim.clipId) : undefined;
  const trimDelta = trim && trimmed ? clampTrimDelta(view, trimmed, trimEdge, trim.dt) : 0;
  const trimId = trim?.clipId;
  /** O que as faixas desenham: a view ou, durante o arrasto de uma borda, a prévia dele. */
  const drawn = useMemo(() => {
    if (!trimId || Math.abs(trimDelta) <= 1e-6) return view;
    try {
      return applyOps(view, [{ op: 'trimClip', clipId: trimId, edge: trimEdge, delta: trimDelta }]).project;
    } catch {
      return view;
    }
  }, [view, trimId, trimEdge, trimDelta]);
  // Mover um clipe: só ele anda.
  const moved = drag?.kind === 'move' ? drag : null;
  const geom = (c: Clip) => {
    const start = moved?.clipId === c.id ? Math.max(0, c.start + moved.dt) : c.start;
    return { left: start * pps, width: Math.max(4, c.duration * pps) };
  };

  // Callbacks estáveis para os blocos (React.memo): leem a view atual pela ref.
  const viewRef = useRef(view);
  viewRef.current = view;
  const onDown = useCallback((clipId: string, kind: 'move' | 'trimL' | 'trimR', e: React.PointerEvent) => {
    e.stopPropagation();
    session.setSelection({ clipIds: [clipId] });
    const v = viewRef.current;
    const c = v.clips.find((x) => x.id === clipId);
    if (c && !v.tracks.find((tr) => tr.id === c.trackId)?.locked) setDrag({ kind, clipId, x0: e.clientX, dt: 0 });
  }, []);
  const onKfDown = useCallback((clipId: string, t: number, prop: string, keyframeId: string, e: React.PointerEvent) => {
    e.stopPropagation();
    session.setSelection({ clipIds: [clipId], keyframe: { clipId, prop, keyframeId } });
    const v = viewRef.current;
    const c = v.clips.find((x) => x.id === clipId);
    if (!c) return;
    playback.seek(c.start + t);
    if (!v.tracks.find((tr) => tr.id === c.trackId)?.locked) setDrag({ kind: 'kf', clipId, t, x0: e.clientX, dt: 0 });
  }, []);

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
          title={
            selectedKfExists
              ? 'Remover ponto selecionado (Delete)'
              : deleteOps(view, s.selection.clipIds).some((o) => o.op === 'removeRanges')
                ? 'Apagar o pedaço selecionado sem deixar buraco (Delete)'
                : 'Remover clipe selecionado (Delete)'
          }
          disabled={!s.selection.clipIds.length}
          onClick={deleteSelectedKeyframeOrClip}
          data-testid="trash"
        >
          {Icon.trash}
        </button>
        <button className="btn" title="Dividir na agulha (Ctrl+B)" onClick={splitAtPlayhead} data-testid="split">
          {Icon.scissors} Dividir
        </button>
        <button
          className="btn"
          title={range ? 'Apagar o trecho marcado em todas as faixas (Shift+Delete)' : 'Marque o trecho na régua (Shift+arrastar, ou I e O) para apagar'}
          disabled={!range}
          onClick={deleteMarkedRange}
          data-testid="delete-range"
        >
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
        {/* Logarítmico: cada passo multiplica o zoom pelo mesmo tanto, de caber o projeto inteiro até 400 px/s. */}
        <input
          type="range"
          data-testid="zoom"
          min={Math.log2(zb.min)}
          max={Math.log2(zb.max)}
          step={0.01}
          value={Math.min(Math.log2(zb.max), Math.max(Math.log2(zb.min), Math.log2(pps)))}
          onChange={(e) => zoomTo(2 ** Number(e.target.value))}
          style={{ accentColor: 'var(--accent)', width: 120 }}
        />
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
              title="Clique para mover a agulha. Shift+arrastar marca um trecho para apagar (ou use I e O)."
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
              const clips = visibleClips(drawn.clips.filter((c) => c.trackId === tr?.id), t0, t1);
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
                        selectedKf={selKf?.clipId === c.id ? selKf : undefined}
                        kfDrag={drag?.kind === 'kf' && drag.clipId === c.id ? drag : null}
                        onDown={onDown}
                        onKfDown={onKfDown}
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
                    visibleClips(s.project.clips.filter((c) => draft.removedClipIds.has(c.id) && c.trackId === tr?.id), t0, t1).map((c) => (
                      <div key={`rm-${c.id}`} className="clip removed" style={{ left: c.start * pps, width: Math.max(4, c.duration * pps) }} title="O rascunho do Claude remove este clipe">
                        <span className="label">Remoção proposta · {c.kind === 'video' ? c.name : c.text}</span>
                      </div>
                    ))}
                  {l.kind === 'video' &&
                    visibleClips(draft.seams.map((seam, i) => ({ ...seam, i, start: seam.at, duration: 0 })), t0, t1).map((seam) => (
                      <div
                        key={`seam-${seam.i}`}
                        className="seam-chip"
                        style={{ left: seam.at * pps }}
                        title={`Corte do rascunho: ${fmtRemoved(seam.removed)}. Clique para ver o corte.`}
                        // A agulha vai 1 s antes da emenda, para tocar passando pelo corte. A emenda é um tempo do
                        // rascunho: no "Antes", a prévia volta primeiro para o "Depois".
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setCompare(false);
                          playback.seek(Math.max(0, seam.at - 1));
                        }}
                      >
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
            <Playhead pps={pps} scrollRef={scrollRef} follow={!drag} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A agulha assina o relógio sozinha: tocar o vídeo redesenha só ela, não a linha do tempo inteira. Quando ela sai
 * da área (tocando, Fim, Início, setas), a linha do tempo rola atrás dela; só quando o tempo muda, então um zoom
 * ou o fim de um arrasto não fazem a rolagem pular.
 */
function Playhead({ pps, scrollRef, follow }: { pps: number; scrollRef: React.RefObject<HTMLDivElement>; follow: boolean }) {
  const pb = usePlayback();
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && follow) el.scrollLeft = followScroll(el.scrollLeft, el.clientWidth, pb.time * pps, pb.playing ? 16 : 0);
  }, [pb.time]);
  return <div className="playhead" style={{ left: pb.time * pps }} />;
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

/** Um bloco por clipe. Só redesenha quando as próprias props mudam: rolar e tocar não redesenham os que já estão na tela. */
const ClipBlock = memo(function ClipBlock(props: {
  clip: Clip;
  left: number;
  width: number;
  pps: number;
  selected: boolean;
  isNewDraft: boolean;
  draftKfs: ReadonlySet<string>;
  /** O ponto selecionado, só quando é deste clipe. */
  selectedKf?: { clipId: string; prop: string; keyframeId: string };
  kfDrag: { t: number; dt: number } | null;
  onDown: (clipId: string, kind: 'move' | 'trimL' | 'trimR', e: React.PointerEvent) => void;
  onKfDown: (clipId: string, t: number, prop: string, keyframeId: string, e: React.PointerEvent) => void;
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
        onPointerDown={(e) => props.onDown(c.id, 'move', e)}
        data-clip={c.id}
      >
        <div className="handle l" onPointerDown={(e) => props.onDown(c.id, 'trimL', e)} />
        <span className="label">
          {props.isNewDraft ? 'Rascunho da IA · ' : ''}
          {label}
        </span>
        <div className="handle r" onPointerDown={(e) => props.onDown(c.id, 'trimR', e)} />
      </div>
      {[...diamonds.values()].map((m) => {
        const t = props.kfDrag && Math.abs(props.kfDrag.t - m.t) < 1e-3 ? m.t + props.kfDrag.dt : m.t;
        return (
          <div
            key={m.id}
            className={`kf ${m.draft ? 'draft' : ''} ${m.sel ? 'sel' : ''}`}
            style={{ left: props.left + t * props.pps }}
            title={`${t.toFixed(2)}s`}
            onPointerDown={(e) => props.onKfDown(c.id, m.t, m.prop, m.id, e)}
          />
        );
      })}
    </>
  );
});
