// API que o servidor MCP chama (via ponte local). Respostas curtas, contexto
// mínimo e teto de tamanho: o "modo econômico".

import { type Clip, type Project, findClip, projectDuration } from './model';
import { ANIMATION_PRESETS } from './operations';
import { propDef, propsForKind } from './properties';
import type { EditorSession, Proposal, ProposeInput } from './session';

export type BridgeMethod = 'status' | 'get_context' | 'propose_edit' | 'get_proposal' | 'cancel_proposal';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function byteSize(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v)).length;
}

/** Representação compacta de um clipe: só o que difere do padrão. */
export function compactClip(c: Clip, economy: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { id: c.id, kind: c.kind, start: r3(c.start), dur: r3(c.duration) };
  if (c.kind === 'video') {
    out.media = c.mediaId;
    out.in = r3(c.in);
    if (c.muted) out.muted = true;
    if (c.volume !== 1) out.volume = c.volume;
  } else {
    out.text = c.text;
    if (!economy) out.style = c.style;
    else out.fontSize = c.style.fontSize;
    if (c.kind === 'caption') out.preset = c.preset;
  }
  const props: Record<string, unknown> = {};
  for (const d of propsForKind(c.kind)) {
    const ap = c.props[d.name];
    if (!ap) continue;
    if (ap.keyframes.length) props[d.name] = { kf: ap.keyframes.map((k) => [k.id, r3(k.t), r3(k.v), k.ease, k.group ?? null]) };
    else if (!economy || ap.value !== d.default) props[d.name] = r3(ap.value);
  }
  if (Object.keys(props).length) out.props = props;
  return out;
}

export interface ContextParams {
  knownRevision?: number;
  include?: ('timeline' | 'media')[];
  range?: { start: number; end: number };
  allowLarger?: boolean;
}

let lastContextKey = '';

export function buildContext(s: EditorSession, params: ContextParams = {}): Record<string, unknown> {
  const p: Project = s.project;
  const economy = s.settings.economy;
  const selKey = `${p.revision}|${s.selection.clipIds.join(',')}|${JSON.stringify(params.include ?? [])}|${JSON.stringify(params.range ?? null)}`;
  const notes = s.notes.some((n) => !n.delivered) ? s.takeNotes() : undefined;
  if (params.knownRevision === p.revision && lastContextKey === selKey && !notes) {
    return { unchanged: true, revision: p.revision };
  }
  const selected = s.selection.clipIds.map((id) => findClip(p, id)).filter(Boolean) as Clip[];
  const ctx: Record<string, unknown> = {
    revision: p.revision,
    fps: p.settings.fps,
    size: [p.settings.width, p.settings.height],
    duration: r3(projectDuration(p)),
    playhead: r3(s.playhead),
    selection: selected.map((c) => compactClip(c, economy)),
  };
  if (s.selection.keyframe) ctx.selectedKeyframe = s.selection.keyframe;
  if (notes) ctx.userNotes = notes;
  const inc = new Set(params.include ?? []);
  if (inc.has('timeline')) {
    const rg = params.range;
    ctx.timeline = p.clips
      .filter((c) => !rg || (c.start < rg.end && c.start + c.duration > rg.start))
      .map((c) => compactClip(c, economy));
  } else {
    ctx.counts = {
      video: p.clips.filter((c) => c.kind === 'video').length,
      title: p.clips.filter((c) => c.kind === 'title').length,
      caption: p.clips.filter((c) => c.kind === 'caption').length,
    };
  }
  if (inc.has('media')) ctx.media = p.media.map((m) => ({ id: m.id, name: m.name, dur: r3(m.duration), audio: m.hasAudio }));
  const open = s.openProposal;
  if (open) ctx.pendingProposal = { id: open.id, status: open.status };

  const size = byteSize(ctx);
  const ceiling = s.settings.contextCeilingBytes;
  if (size > ceiling) {
    const req = s.contextRequest;
    const granted = req && req.status === 'granted' && req.revision === p.revision && req.bytes >= size;
    if (!granted) {
      if (params.allowLarger && (!req || req.status !== 'pending' || req.revision !== p.revision)) s.requestLargerContext(size);
      const reduced: Record<string, unknown> = {
        revision: p.revision,
        fps: p.settings.fps,
        duration: ctx.duration,
        playhead: ctx.playhead,
        selection: (ctx.selection as unknown[]).slice(0, 3),
        truncated: {
          neededBytes: size,
          ceilingBytes: ceiling,
          hint: params.allowLarger
            ? 'Aguardando o usuário autorizar no editor. Chame de novo depois.'
            : 'Reduza com range/include, ou chame com allowLarger:true para pedir autorização ao usuário.',
        },
      };
      lastContextKey = '';
      return reduced;
    }
    s.contextRequest = null;
  }
  lastContextKey = selKey;
  return ctx;
}

export function compactProposal(p: Proposal, revision: number): Record<string, unknown> {
  const cur = p.steps[p.current];
  const out: Record<string, unknown> = {
    id: p.id,
    status: p.status,
    version: p.version,
    revision,
    steps: p.steps.map((s) => {
      const o: Record<string, unknown> = { label: s.label, status: s.status };
      if (s.manualOps.length) o.adjustedByUser = true;
      if (s.error) o.error = s.error;
      return o;
    }),
  };
  if (cur && p.status === 'active') out.current = { index: p.current + 1, label: cur.label, status: cur.status };
  if (p.status === 'stale') {
    out.staleReason = p.staleReason;
    out.redoRequested = p.redoRequested;
  }
  out.next =
    p.status === 'active'
      ? 'O usuário está vendo o rascunho. Use get_proposal com waitSeconds para esperar a decisão.'
      : p.status === 'stale'
        ? 'Rascunho desatualizado. Leia get_context e proponha de novo com replaces=' + p.id + '.'
        : 'Nada pendente.';
  return out;
}

export interface BridgeContext {
  session: EditorSession;
}

/** Ponto único de despacho das chamadas vindas do MCP. */
export async function handleBridge(s: EditorSession, method: string, params: any = {}): Promise<unknown> {
  switch (method as BridgeMethod) {
    case 'status':
      return {
        editor: 'aberto',
        project: s.project.name,
        revision: s.project.revision,
        economy: s.settings.economy,
        contextCeilingBytes: s.settings.contextCeilingBytes,
        presets: ANIMATION_PRESETS.map((p) => p.name),
        props: ['x', 'y', 'scale', 'opacity'].map((n) => `${n}(${propDef(n)!.min}..${propDef(n)!.max})`),
      };
    case 'get_context':
      return buildContext(s, params);
    case 'propose_edit': {
      const r = s.propose(params as ProposeInput);
      if (!r.ok) return { error: r.code, message: r.message, details: r.details };
      return { reused: r.reused || undefined, ...compactProposal(r.proposal, s.project.revision) };
    }
    case 'get_proposal': {
      const id = String(params.proposalId ?? s.openProposal?.id ?? '');
      let p = s.proposals.find((x) => x.id === id);
      if (!p) return { error: 'not_found', message: 'Proposta não encontrada.' };
      const wait = Math.min(Math.max(Number(params.waitSeconds ?? 0), 0), 50);
      if (wait > 0) {
        const since = Number(params.sinceVersion ?? p.version);
        await s.waitForProposal(id, since, wait * 1000);
        p = s.proposals.find((x) => x.id === id)!;
      }
      const out = compactProposal(p, s.project.revision);
      if (p.status === 'stale' && p.redoRequested) out.context = buildContext(s, {});
      return out;
    }
    case 'cancel_proposal': {
      const ok = s.cancelProposal(String(params.proposalId ?? ''));
      return ok ? { ok: true } : { error: 'not_found', message: 'Nada para cancelar.' };
    }
    default:
      return { error: 'unknown_method', message: `Método desconhecido: ${method}` };
  }
}
