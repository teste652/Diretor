// API que o servidor MCP chama (via ponte local). Respostas curtas, contexto
// mínimo e teto de tamanho: o "modo econômico".

import { type Clip, type Project, findClip, projectDuration } from './model';
import { ANIMATION_PRESETS } from './operations';
import { propDef, propsForKind } from './properties';
import type { EditorSession, Proposal, ProposeInput } from './session';

export type BridgeMethod = 'status' | 'get_context' | 'propose_edit' | 'get_proposal' | 'cancel_proposal';

/** Espera máxima de get_proposal: abaixo do tempo limite de uma ferramenta no Claude Desktop (~60 s). */
export const MAX_WAIT_SECONDS = 45;

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

/** Última resposta completa por sessão, para responder {unchanged} sem reenviar. */
const lastContextKey = new WeakMap<EditorSession, string>();

export function buildContext(s: EditorSession, params: ContextParams = {}): Record<string, unknown> {
  const p: Project = s.project;
  const economy = s.settings.economy;
  const open = s.openProposal;
  /** Rascunho aberto que corta: o contexto avisa que os tempos são os do projeto gravado (timeBase). */
  const cutDraft = !!open && open.status === 'active' && s.draftInfo.ripple;
  const key = JSON.stringify([
    p.revision,
    s.selection.clipIds,
    s.selection.keyframe?.keyframeId ?? null,
    Math.round(s.playhead * p.settings.fps),
    economy,
    open ? [open.id, open.status, open.redoRequested, cutDraft] : null,
    params.include ?? [],
    params.range ?? null,
  ]);
  const hasNotes = s.notes.some((n) => !n.delivered);
  if (params.knownRevision === p.revision && lastContextKey.get(s) === key && !hasNotes) {
    return { unchanged: true, revision: p.revision };
  }
  const notes = hasNotes ? s.takeNotes() : undefined;
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
  if (open) ctx.pendingProposal = open.status === 'stale' ? { id: open.id, status: open.status, redoRequested: open.redoRequested } : { id: open.id, status: open.status };
  // Rascunho que corta: os tempos acima são do projeto gravado, e a agulha é o ponto na tela (no rascunho).
  if (cutDraft)
    (ctx.pendingProposal as Record<string, unknown>).timeBase =
      'Tempos sem os cortes do rascunho aberto (a agulha é o ponto na tela); numa etapa acrescentada com appendTo, desconte os cortes das etapas anteriores.';

  // As notas do usuário são palavras dele para o Claude: sempre seguem e não contam para o teto.
  const size = byteSize(ctx) - (notes ? byteSize({ userNotes: notes }) : 0);
  const ceiling = s.settings.contextCeilingBytes;
  // O teto é do modo econômico: desligado, a IA vê o que pedir, sem pedir licença ao usuário.
  if (economy && size > ceiling) {
    const scope = JSON.stringify([params.include ?? [], params.range ?? null]);
    const req = s.contextRequest;
    const sameScope = !!req && req.scope === scope;
    // A autorização vale uma vez para esse pedido, com folga para pequenas mudanças (playhead, nota...).
    const granted = sameScope && req!.status === 'granted' && size <= req!.bytes * 1.25 + 1024;
    if (!granted) {
      const denied = sameScope && req!.status === 'denied' && req!.ceiling === ceiling;
      const pending = sameScope && req!.status === 'pending';
      if (params.allowLarger && !denied && !pending) s.requestLargerContext(size, scope);
      const asked = params.allowLarger || pending;
      const reduced = reducedContext(ctx, selected, size, ceiling, denied ? 'denied' : asked ? 'waiting' : 'reduce');
      if (notes) reduced.userNotes = notes;
      lastContextKey.delete(s);
      return reduced;
    }
    s.contextRequest = null;
  }
  lastContextKey.set(s, key);
  return ctx;
}

const TRUNCATED_HINT = {
  denied: 'O usuário recusou o contexto maior. Não peça de novo: reduza com range/include ou trabalhe com a seleção.',
  waiting: 'Aguardando o usuário autorizar no editor. Chame de novo com os mesmos parâmetros depois.',
  reduce: 'Reduza com range/include, ou chame com allowLarger:true para pedir autorização ao usuário.',
};

/** Versão reduzida que cabe no teto: encolhe até sobrar só ids, tipos e tempos. */
function reducedContext(ctx: Record<string, unknown>, selected: Clip[], neededBytes: number, ceiling: number, why: keyof typeof TRUNCATED_HINT): Record<string, unknown> {
  // Proposta pendente/desatualizada (e o pedido de refazer) sempre seguem: são poucos bytes e mudam o que o Claude deve fazer.
  const out: Record<string, unknown> = {
    revision: ctx.revision,
    fps: ctx.fps,
    size: ctx.size,
    duration: ctx.duration,
    playhead: ctx.playhead,
    ...(ctx.pendingProposal ? { pendingProposal: ctx.pendingProposal } : {}),
    ...(ctx.selectedKeyframe ? { selectedKeyframe: ctx.selectedKeyframe } : {}),
    selection: (ctx.selection as unknown[]).slice(0, 3),
    truncated: { neededBytes, ceilingBytes: ceiling, why, hint: TRUNCATED_HINT[why] },
  };
  const fits = () => byteSize(out) <= ceiling;
  if (!fits()) out.selection = selected.slice(0, 3).map((c) => ({ id: c.id, kind: c.kind, start: r3(c.start), dur: r3(c.duration) }));
  if (!fits()) {
    delete out.selection;
    out.selectionIds = selected.slice(0, 5).map((c) => c.id);
  }
  if (!fits()) delete out.selectionIds;
  if (!fits()) out.truncated = { neededBytes, ceilingBytes: ceiling, why };
  if (!fits()) delete out.selectedKeyframe;
  if (!fits()) delete out.size;
  return out;
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
        ? p.redoRequested
          ? `O usuário pediu para refazer: leia get_context e chame propose_edit com replaces="${p.id}" e um requestId novo.`
          : 'O usuário mexeu no projeto e o rascunho ficou desatualizado. Não refaça por conta própria: espere com get_proposal (waitSeconds) até o usuário pedir "refazer" no editor ou no chat.'
        : 'Nada pendente.';
  // A revisão daqui não vem com o contexto: depois de ajustes à mão que o Claude não viu, ele precisa ler de novo.
  if (p.manualRevision !== undefined && p.status !== 'stale')
    out.next += ` O usuário aceitou uma etapa com ajustes feitos à mão (revisão ${p.manualRevision}), que você não vê: antes de propor ou acrescentar etapas, leia get_context de novo se o seu é de antes dessa revisão.`;
  return out;
}

export interface BridgeContext {
  session: EditorSession;
}

/** Ponto único de despacho das chamadas vindas do MCP. */
export async function handleBridge(s: EditorSession, method: string, params: any = {}, signal?: AbortSignal): Promise<unknown> {
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
      const wait = Math.min(Math.max(Number(params.waitSeconds) || 0, 0), MAX_WAIT_SECONDS);
      if (wait > 0 && !s.notes.some((n) => !n.delivered)) {
        const since = Number.isFinite(Number(params.sinceVersion)) ? Number(params.sinceVersion) : p.version;
        const why = await s.waitForProposal(id, since, wait * 1000, signal);
        // Ninguém vai ler esta resposta (o Claude cancelou ou chamou de novo): as notas ficam para a próxima.
        if (why === 'cancelled') return { error: 'cancelled', message: 'A chamada foi cancelada.' };
        if (why === 'superseded') return { error: 'superseded', message: 'Uma chamada mais nova de get_proposal assumiu a espera; use a resposta dela.' };
        p = s.proposals.find((x) => x.id === id)!;
      }
      if (signal?.aborted) return { error: 'cancelled' };
      const out = compactProposal(p, s.project.revision);
      if (p.status === 'stale' && p.redoRequested) out.context = buildContext(s, {});
      else if (s.notes.some((n) => !n.delivered)) out.userNotes = s.takeNotes();
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
