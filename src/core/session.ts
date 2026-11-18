// Sessão do editor: projeto gravado, histórico (desfazer/refazer), seleção e as
// propostas do Claude em rascunho. É a única porta de entrada para mudar o
// projeto, tanto pela interface quanto pelo MCP.

import { type Op, OpValidationError, USER_ONLY_OPS, applyOps, describeOp, touchedClipIds } from './operations';
import { type Project, createProject, findClip } from './model';

export type Source = 'user' | 'ai';

export interface HistoryEntry {
  id: string;
  label: string;
  source: Source;
  before: Project;
  after: Project;
  proposalId?: string;
  stepId?: string;
}

export interface Selection {
  clipIds: string[];
  keyframe?: { clipId: string; prop: string; keyframeId: string };
}

export type StepStatus = 'waiting' | 'draft' | 'accepted' | 'discarded' | 'invalid';

export interface ProposalStep {
  id: string;
  label: string;
  summary: string;
  /** Operações como o Claude pediu (podem ter macros). */
  requested: Op[];
  /** Operações preparadas quando a etapa vira rascunho (macros expandidas, ids fixos). */
  ops: Op[];
  /** Ajustes feitos à mão sobre o rascunho, antes de aceitar. */
  manualOps: Op[];
  /** Onde começa cada ajuste em manualOps (Ctrl+Z desfaz um ajuste por vez). */
  manualMarks: number[];
  /** Ajustes desfeitos que Ctrl+Y pode refazer. */
  manualRedo: Op[][];
  status: StepStatus;
  error?: string;
}

export type ProposalStatus = 'active' | 'stale' | 'done' | 'cancelled' | 'superseded';

export interface Proposal {
  id: string;
  requestId: string;
  title: string;
  summary: string;
  createdAt: number;
  baseRevision: number;
  /** Revisão em que o rascunho atual foi montado. Se o projeto mudar fora da proposta, fica desatualizada. */
  expectedRevision: number;
  /** Seleção no momento da proposta. */
  selection: string[];
  /** Clipes que a proposta mexe (alvos + criados). */
  targets: string[];
  steps: ProposalStep[];
  current: number;
  status: ProposalStatus;
  staleReason?: string;
  /** O usuário pediu "refazer com o contexto atual". */
  redoRequested: boolean;
  replaces?: string;
  /** requestIds das chamadas que acrescentaram etapas (idempotência). */
  appendedRequestIds: string[];
  /** Impressão digital do pedido original (mesmo requestId com outro conteúdo é conflito). */
  fingerprint: string;
  /** Aumenta a cada mudança visível (para o Claude esperar decisões). */
  version: number;
}

export interface ActivityEntry {
  id: number;
  time: number;
  kind: 'tool' | 'proposal' | 'decision' | 'note' | 'info';
  text: string;
  /** Tamanho do contexto enviado ao assistente (métrica do editor, bytes). */
  bytesOut?: number;
  bytesIn?: number;
}

export interface UserNote {
  id: number;
  text: string;
  time: number;
  delivered: boolean;
}

export interface Settings {
  /** Modo econômico: respostas curtas e contexto mínimo. Ligado por padrão. */
  economy: boolean;
  /** Teto (bytes) do contexto que o editor envia por ação. */
  contextCeilingBytes: number;
}

export type WaitResult = 'changed' | 'timeout' | 'cancelled' | 'superseded';

export interface ProposeInput {
  requestId?: string;
  baseRevision: number;
  title: string;
  summary?: string;
  steps: { label: string; summary?: string; ops: Op[] }[];
  replaces?: string;
  /** Acrescenta as etapas a uma proposta existente (mostrar cada etapa assim que fica pronta). */
  appendTo?: string;
}

export type ProposeResult =
  | { ok: true; proposal: Proposal; reused: boolean }
  | {
      ok: false;
      code: 'stale_revision' | 'invalid_ops' | 'proposal_pending' | 'proposal_closed' | 'bad_request' | 'request_id_conflict';
      message: string;
      details?: unknown;
    };

let seq = 0;
const sid = (p: string) => `${p}${Date.now().toString(36)}${(++seq).toString(36)}`;

function newStep(s: ProposeInput['steps'][number]): ProposalStep {
  return {
    id: sid('step_'),
    label: typeof s.label === 'string' && s.label.trim() ? s.label.trim().slice(0, 80) : 'Etapa',
    summary: typeof s.summary === 'string' ? s.summary : '',
    requested: s.ops,
    ops: [],
    manualOps: [],
    manualMarks: [],
    manualRedo: [],
    status: 'waiting',
  };
}

function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export class EditorSession {
  project: Project;
  past: HistoryEntry[] = [];
  future: HistoryEntry[] = [];
  selection: Selection = { clipIds: [] };
  playhead = 0;
  proposals: Proposal[] = [];
  adjustMode = false;
  filePath: string | null = null;
  dirty = false;
  activity: ActivityEntry[] = [];
  notes: UserNote[] = [];
  settings: Settings = { economy: true, contextCeilingBytes: 6000 };
  /**
   * Pedido do assistente para enviar um contexto maior que o teto. `scope` é o
   * que ele pediu (include/range): a resposta do usuário vale para esse pedido.
   */
  contextRequest: { bytes: number; revision: number; scope: string; ceiling: number; status: 'pending' | 'granted' | 'denied' } | null = null;
  /** Aviso curto para a interface (ex.: por que Ctrl+Z não mexeu no projeto). */
  hint: { text: string; at: number } | null = null;
  /** Aumenta a cada mudança de estado (para a interface re-renderizar). */
  version = 0;

  private listeners = new Set<() => void>();
  private waiters: { id: string; since: number; resolve: (why?: WaitResult) => void }[] = [];
  private viewCache: { key: string; project: Project } | null = null;
  private activitySeq = 0;
  private noteSeq = 0;
  /** requestId → proposta e conteúdo do pedido (idempotência sem engolir pedidos novos). */
  private requestLog = new Map<string, { proposalId: string; fingerprint: string }>();

  constructor(project?: Project) {
    this.project = project ?? createProject();
  }

  // ---------- eventos ----------
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
    const ready = this.waiters.filter((w) => {
      const p = this.proposals.find((x) => x.id === w.id);
      return !p || p.version > w.since;
    });
    this.waiters = this.waiters.filter((w) => !ready.includes(w));
    // A espera mais nova responde primeiro: é a que o Claude ainda está lendo e a que leva as notas.
    for (const w of ready.reverse()) w.resolve();
  }

  /** Acorda todas as esperas (nota nova do usuário, projeto trocado), a mais nova primeiro. */
  private wakeAll(): void {
    const all = this.waiters;
    this.waiters = [];
    for (const w of all.reverse()) w.resolve();
  }

  log(kind: ActivityEntry['kind'], text: string, extra: Partial<ActivityEntry> = {}): void {
    this.activity.push({ id: ++this.activitySeq, time: Date.now(), kind, text, ...extra });
    if (this.activity.length > 200) this.activity.splice(0, this.activity.length - 200);
    this.emit();
  }

  // ---------- leitura ----------
  /** Proposta exibida no editor (ativa ou desatualizada), se houver. */
  get openProposal(): Proposal | undefined {
    return this.proposals.find((p) => p.status === 'active' || p.status === 'stale');
  }

  get activeStep(): ProposalStep | undefined {
    const p = this.openProposal;
    if (!p || p.status !== 'active') return undefined;
    const s = p.steps[p.current];
    return s?.status === 'draft' ? s : undefined;
  }

  /** Projeto visto na prévia e na linha do tempo: gravado + rascunho atual. */
  get view(): Project {
    const p = this.openProposal;
    const step = p?.status === 'active' ? this.activeStep : undefined;
    if (!p || !step) return this.project;
    const key = `${this.project.revision}:${p.id}:${p.version}`;
    if (this.viewCache?.key === key) return this.viewCache.project;
    try {
      const project = applyOps(this.project, [...step.ops, ...step.manualOps]).project;
      this.viewCache = { key, project };
      return project;
    } catch {
      return this.project;
    }
  }

  /** Ids de clipes e pontos que só existem / mudaram no rascunho. */
  get draftInfo(): {
    clipIds: Set<string>;
    createdClipIds: Set<string>;
    /** Clipes que o rascunho remove (aparecem tracejados na linha do tempo). */
    removedClipIds: Set<string>;
    keyframeIds: Set<string>;
    range: { clipId: string; start: number; end: number }[];
  } {
    const step = this.activeStep;
    const out = {
      clipIds: new Set<string>(),
      createdClipIds: new Set<string>(),
      removedClipIds: new Set<string>(),
      keyframeIds: new Set<string>(),
      range: [] as { clipId: string; start: number; end: number }[],
    };
    if (!step) return out;
    const all = [...step.ops, ...step.manualOps];
    for (const id of touchedClipIds(all)) out.clipIds.add(id);
    for (const o of all) {
      if (o.op === 'addClip' && o.clip.id) out.createdClipIds.add(o.clip.id);
      if (o.op === 'setKeyframe' && o.keyframeId) out.keyframeIds.add(o.keyframeId);
      if (o.op === 'removeClip' && !findClip(this.view, o.clipId) && findClip(this.project, o.clipId)) out.removedClipIds.add(o.clipId);
    }
    const view = this.view;
    const ranges = new Map<string, { start: number; end: number }>();
    // Faixa do rascunho: onde estão os pontos/mudanças, não o clipe inteiro.
    const keyframeOnly = all.every((o) => ['setKeyframe', 'clearKeyframes', 'retimeGroup', 'removeKeyframe'].includes(o.op));
    for (const o of all) {
      if (!('clipId' in o) && o.op !== 'addClip') continue;
      if (keyframeOnly && (o.op === 'clearKeyframes' || o.op === 'removeKeyframe')) continue;
      const id = o.op === 'addClip' ? o.clip.id! : (o as { clipId: string }).clipId;
      const c = findClip(view, id);
      if (!c) continue;
      let s = c.start;
      let e = c.start + c.duration;
      if (o.op === 'setKeyframe') s = e = c.start + o.t;
      if (o.op === 'retimeGroup') (s = c.start + o.start), (e = c.start + o.start + o.duration);
      const r = ranges.get(id);
      ranges.set(id, r ? { start: Math.min(r.start, s), end: Math.max(r.end, e) } : { start: s, end: e });
    }
    for (const [clipId, r] of ranges) out.range.push({ clipId, ...r });
    return out;
  }

  // ---------- edição ----------
  /**
   * Ponto de entrada das edições manuais. Enquanto há uma etapa em rascunho,
   * editar um clipe que o rascunho mexe (ou qualquer coisa, com o modo
   * "ajustar" ligado) vira ajuste do rascunho: você está editando o que vê na
   * prévia. O resto é gravado no projeto (e desatualiza o rascunho).
   */
  dispatch(ops: Op[], label?: string): { ok: true; target: 'draft' | 'project' } | { ok: false; message: string } {
    // Nada a fazer (ex.: botão de áudio sem vídeos): sem histórico vazio e sem desatualizar o rascunho.
    if (Array.isArray(ops) && ops.length === 0) return { ok: true, target: this.activeStep ? 'draft' : 'project' };
    try {
      if (this.shouldRouteToDraft(ops)) {
        const p = this.openProposal!;
        const step = this.activeStep!;
        const base = this.view;
        const { applied } = applyOps(base, ops);
        step.manualMarks.push(step.manualOps.length);
        step.manualOps.push(...applied);
        step.manualRedo = [];
        p.version++;
        this.viewCache = null;
        this.emit();
        return { ok: true, target: 'draft' };
      }
      this.commit(ops, label ?? (ops.length === 1 ? describeOp(ops[0]) : 'Edição'), 'user');
      return { ok: true, target: 'project' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  private shouldRouteToDraft(ops: Op[]): boolean {
    const step = this.activeStep;
    if (!step) return false;
    // Importar mídia, faixas, nome e formato do projeto são do usuário: nunca entram na etapa do Claude.
    if (ops.some((o) => USER_ONLY_OPS.includes(o.op) || o.op === 'renameProject' || o.op === 'setCanvas')) return false;
    if (this.adjustMode) return true;
    const d = this.draftInfo;
    return ops.some((o) => 'clipId' in o && d.clipIds.has(o.clipId));
  }

  private commit(ops: Op[], label: string, source: Source, meta: { proposalId?: string; stepId?: string } = {}): void {
    const before = this.project;
    const { project } = applyOps(before, ops);
    project.revision = before.revision + 1;
    this.project = project;
    this.past.push({ id: sid('h'), label, source, before, after: project, ...meta });
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.dirty = true;
    this.viewCache = null;
    this.selection = this.cleanSelection(this.selection);
    this.checkStale(meta.proposalId);
    this.emit();
  }

  /** Com um rascunho aberto, desfazer/refazer mexe só nos ajustes do rascunho. */
  get canUndo(): boolean {
    const step = this.activeStep;
    return step ? step.manualMarks.length > 0 : this.past.length > 0;
  }

  get canRedo(): boolean {
    const step = this.activeStep;
    return step ? step.manualRedo.length > 0 : this.future.length > 0;
  }

  private draftHistoryMove(dir: 'undo' | 'redo'): boolean {
    const p = this.openProposal!;
    const step = this.activeStep!;
    if (dir === 'undo') {
      const from = step.manualMarks.pop();
      if (from === undefined) {
        this.setHint('O rascunho do Claude está aberto: Ctrl+Z desfaz só os seus ajustes nele. Aceite ou descarte o rascunho para desfazer o projeto.');
        return false;
      }
      step.manualRedo.push(step.manualOps.splice(from));
    } else {
      const batch = step.manualRedo.pop();
      if (!batch) {
        this.setHint('Nada para refazer no rascunho.');
        return false;
      }
      step.manualMarks.push(step.manualOps.length);
      step.manualOps.push(...batch);
    }
    p.version++;
    this.viewCache = null;
    this.selection = this.cleanSelection(this.selection);
    this.log('info', dir === 'undo' ? 'Ajuste do rascunho desfeito' : 'Ajuste do rascunho refeito');
    return true;
  }

  setHint(text: string): void {
    this.hint = { text, at: Date.now() };
    this.emit();
  }

  undo(): boolean {
    if (this.activeStep) return this.draftHistoryMove('undo');
    const e = this.past.pop();
    if (!e) return false;
    const rev = this.project.revision + 1;
    this.project = { ...e.before, revision: rev };
    this.future.push(e);
    this.afterHistoryMove(`Desfeito: ${e.label}`);
    return true;
  }

  redo(): boolean {
    if (this.activeStep) return this.draftHistoryMove('redo');
    const e = this.future.pop();
    if (!e) return false;
    const rev = this.project.revision + 1;
    this.project = { ...e.after, revision: rev };
    this.past.push(e);
    this.afterHistoryMove(`Refeito: ${e.label}`);
    return true;
  }

  private afterHistoryMove(msg: string): void {
    this.dirty = true;
    this.viewCache = null;
    this.selection = this.cleanSelection(this.selection);
    this.checkStale();
    this.log('info', msg);
  }

  private cleanSelection(s: Selection): Selection {
    const exists = (id: string) => !!findClip(this.view, id) || !!findClip(this.project, id);
    const clipIds = s.clipIds.filter(exists);
    const kf = s.keyframe;
    const kfExists = (p: Project) => !!findClip(p, kf!.clipId)?.props[kf!.prop]?.keyframes.some((k) => k.id === kf!.keyframeId);
    const keyframe = kf && (kfExists(this.view) || kfExists(this.project)) ? kf : undefined;
    return { clipIds, keyframe };
  }

  /** Marca como desatualizada a proposta cujo rascunho foi feito sobre outra revisão. */
  private checkStale(exceptProposalId?: string): void {
    const p = this.openProposal;
    if (!p || p.status !== 'active' || p.id === exceptProposalId) return;
    if (p.expectedRevision !== this.project.revision) {
      this.markStale(p, `O projeto mudou (revisão ${p.expectedRevision} → ${this.project.revision}).`);
    }
  }

  private markStale(p: Proposal, reason: string): void {
    p.status = 'stale';
    p.staleReason = reason;
    p.version++;
    this.adjustMode = false;
    this.viewCache = null;
    this.log('proposal', `Rascunho desatualizado: ${reason}`);
  }

  setSelection(sel: Selection): void {
    const next = this.cleanSelection(sel);
    const p = this.openProposal;
    if (p && p.status === 'active') {
      const allowed = new Set([...p.targets, ...p.selection, ...this.draftInfo.createdClipIds]);
      const changed = next.clipIds.some((id) => !allowed.has(id));
      if (changed) this.markStale(p, 'A seleção mudou.');
    }
    this.selection = next;
    this.emit();
  }

  setPlayhead(t: number): void {
    this.playhead = Math.max(0, t);
    this.emit();
  }

  setAdjustMode(on: boolean): void {
    this.adjustMode = on && !!this.activeStep;
    this.emit();
  }

  updateSettings(s: Partial<Settings>): void {
    const ceiling = this.settings.contextCeilingBytes;
    this.settings = { ...this.settings, ...s };
    // Teto novo: uma recusa anterior deixa de valer.
    if (this.settings.contextCeilingBytes !== ceiling) this.contextRequest = null;
    this.emit();
  }

  requestLargerContext(bytes: number, scope = '[]'): void {
    this.contextRequest = { bytes, revision: this.project.revision, scope, ceiling: this.settings.contextCeilingBytes, status: 'pending' };
    this.log('info', `O Claude pediu um contexto de ${(bytes / 1024).toFixed(1)} KB (teto ${(this.settings.contextCeilingBytes / 1024).toFixed(1)} KB).`);
  }

  answerContextRequest(grant: boolean): void {
    if (!this.contextRequest) return;
    this.contextRequest = { ...this.contextRequest, status: grant ? 'granted' : 'denied' };
    this.log('decision', grant ? 'Contexto maior autorizado (uma vez).' : 'Contexto maior recusado.');
  }

  addNote(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.notes.push({ id: ++this.noteSeq, text: t, time: Date.now(), delivered: false });
    this.log('note', t);
    // Se o Claude está esperando uma decisão, a nota chega nessa resposta.
    this.wakeAll();
  }

  takeNotes(): string[] {
    const pending = this.notes.filter((n) => !n.delivered);
    for (const n of pending) n.delivered = true;
    return pending.map((n) => n.text);
  }

  // ---------- arquivo ----------
  load(project: Project, filePath: string | null): void {
    // A revisão só cresce na sessão: um knownRevision antigo nunca bate com outro conteúdo.
    this.project = { ...project, revision: Math.max(project.revision, this.project.revision + 1) };
    this.past = [];
    this.future = [];
    this.selection = { clipIds: [] };
    this.playhead = 0;
    for (const p of this.proposals) {
      if (p.status !== 'active' && p.status !== 'stale') continue;
      p.status = 'cancelled';
      for (const s of p.steps) if (s.status === 'draft' || s.status === 'waiting') s.status = 'discarded';
      p.version++;
    }
    this.adjustMode = false;
    this.filePath = filePath;
    this.dirty = false;
    this.viewCache = null;
    this.contextRequest = null;
    this.notes = this.notes.filter((n) => n.delivered);
    this.emit();
    this.wakeAll();
  }

  markSaved(filePath: string): void {
    this.filePath = filePath;
    this.dirty = false;
    this.emit();
  }

  // ---------- propostas ----------
  propose(input: ProposeInput): ProposeResult {
    if (!input || !Array.isArray(input.steps) || input.steps.length === 0 || !input.title) {
      return { ok: false, code: 'bad_request', message: 'Informe title e pelo menos uma etapa (steps) com ops.' };
    }
    const fingerprint = hashString(JSON.stringify([input.baseRevision, input.title, input.steps, input.replaces ?? null, input.appendTo ?? null]));
    const requestId = (typeof input.requestId === 'string' && input.requestId.trim()) || `h_${fingerprint}`;
    const seen = this.requestLog.get(requestId);
    if (seen) {
      const existing = this.proposals.find((p) => p.id === seen.proposalId);
      if (existing && seen.fingerprint === fingerprint) return { ok: true, proposal: existing, reused: true };
      return {
        ok: false,
        code: 'request_id_conflict',
        message: `O requestId "${requestId}" já foi usado num pedido diferente. Use um requestId novo para cada pedido (repita o mesmo só para reenviar exatamente a mesma chamada).`,
        details: { proposalId: seen.proposalId },
      };
    }
    for (let i = 0; i < input.steps.length; i++) {
      const st = input.steps[i];
      if (!st || !Array.isArray(st.ops) || st.ops.length === 0) return { ok: false, code: 'bad_request', message: `Etapa ${i + 1} sem ops.` };
      const blocked = st.ops.find((o) => USER_ONLY_OPS.includes((o as { op?: Op['op'] })?.op as Op['op']));
      if (blocked)
        return {
          ok: false,
          code: 'invalid_ops',
          message: `Etapa ${i + 1}: "${blocked.op}" é só da interface (importar mídia, travar ou esconder faixas). Peça ao usuário para fazer isso no editor.`,
          details: { step: i + 1 },
        };
    }
    if (input.appendTo) {
      const r = this.appendSteps(input, requestId);
      if (r.ok) this.requestLog.set(requestId, { proposalId: r.proposal.id, fingerprint });
      return r;
    }

    if (input.baseRevision !== this.project.revision) {
      return {
        ok: false,
        code: 'stale_revision',
        message: `A revisão do projeto agora é ${this.project.revision} (você usou ${input.baseRevision}). Leia o contexto de novo.`,
        details: { revision: this.project.revision },
      };
    }
    const open = this.openProposal;
    if (open && open.status === 'active' && open.id !== input.replaces) {
      return {
        ok: false,
        code: 'proposal_pending',
        message: `Há uma proposta aguardando decisão (${open.id}). Espere a decisão ou use replaces.`,
        details: { proposalId: open.id },
      };
    }
    // Simulação: todas as etapas, em ordem, precisam ser válidas.
    const targets = new Set<string>();
    const simulated = this.simulateSteps(this.project, input.steps, 0);
    if (!simulated.ok) return simulated;
    simulated.targets.forEach((id) => targets.add(id));
    for (const p of this.proposals) {
      if ((p.status === 'active' || p.status === 'stale') && (p.id === input.replaces || p.status === 'stale')) {
        p.status = 'superseded';
        for (const st of p.steps) if (st.status === 'draft' || st.status === 'waiting') st.status = 'discarded';
        p.version++;
      }
    }
    const proposal: Proposal = {
      id: sid('prop_'),
      requestId,
      title: input.title,
      summary: input.summary ?? '',
      createdAt: Date.now(),
      baseRevision: this.project.revision,
      expectedRevision: this.project.revision,
      selection: [...this.selection.clipIds],
      targets: [...targets],
      steps: input.steps.map(newStep),
      current: -1,
      status: 'active',
      redoRequested: false,
      replaces: input.replaces,
      appendedRequestIds: [],
      fingerprint,
      version: 1,
    };
    this.proposals.push(proposal);
    this.requestLog.set(requestId, { proposalId: proposal.id, fingerprint });
    this.log('proposal', `Proposta: ${proposal.title} (${proposal.steps.length} etapa${proposal.steps.length > 1 ? 's' : ''})`);
    this.advance(proposal);
    return { ok: true, proposal, reused: false };
  }

  /** Valida etapas em sequência sobre `base`. */
  private simulateSteps(
    base: Project,
    steps: ProposeInput['steps'],
    offset: number,
  ): { ok: true; targets: string[] } | { ok: false; code: 'invalid_ops'; message: string; details: unknown } {
    let sim = base;
    const targets = new Set<string>();
    for (let i = 0; i < steps.length; i++) {
      try {
        const r = applyOps(sim, steps[i].ops);
        sim = r.project;
        touchedClipIds(r.applied).forEach((id) => targets.add(id));
      } catch (e) {
        if (e instanceof OpValidationError)
          return { ok: false, code: 'invalid_ops', message: `Etapa ${offset + i + 1}: ${e.message}`, details: { step: offset + i + 1, errors: e.errors } };
        // Qualquer outro erro também é culpa das ops recebidas: responde em vez de quebrar.
        return { ok: false, code: 'invalid_ops', message: `Etapa ${offset + i + 1}: operação malformada (${e instanceof Error ? e.message : String(e)}).`, details: { step: offset + i + 1 } };
      }
    }
    return { ok: true, targets: [...targets] };
  }

  /**
   * Acrescenta etapas a uma proposta: o Claude pode mandar a primeira etapa
   * assim que ela fica pronta e as seguintes depois.
   */
  private appendSteps(input: ProposeInput, requestId: string): ProposeResult {
    const p = this.proposals.find((x) => x.id === input.appendTo);
    if (!p) return { ok: false, code: 'bad_request', message: `Proposta "${input.appendTo}" não encontrada.` };
    if (p.status !== 'active' && p.status !== 'done') {
      // Mesma orientação do get_proposal: nunca refazer por conta própria.
      const message =
        p.status === 'stale'
          ? p.redoRequested
            ? `O usuário pediu para refazer: leia get_context e chame propose_edit com replaces="${p.id}" e um requestId novo.`
            : 'O usuário mexeu no projeto e esta proposta ficou desatualizada. Não refaça por conta própria: espere com get_proposal (waitSeconds) até o usuário pedir "refazer".'
          : p.status === 'cancelled'
            ? 'Esta proposta foi descartada ou cancelada. Não a proponha de novo a menos que o usuário peça.'
            : 'Esta proposta foi substituída por uma mais nova; continue por ela.';
      return { ok: false, code: 'proposal_closed', message, details: { status: p.status, redoRequested: p.redoRequested } };
    }
    // Só as decisões desta proposta podem ter mudado a revisão desde então.
    if (input.baseRevision !== this.project.revision && p.expectedRevision !== this.project.revision) {
      return {
        ok: false,
        code: 'stale_revision',
        message: `A revisão do projeto agora é ${this.project.revision} (você usou ${input.baseRevision}). Leia o contexto de novo.`,
        details: { revision: this.project.revision },
      };
    }
    const open = this.openProposal;
    // Uma proposta aberta por vez: não reabre uma concluída enquanto outra (ativa ou desatualizada) espera o usuário.
    if (p.status === 'done' && open && open.id !== p.id) {
      return {
        ok: false,
        code: 'proposal_pending',
        message:
          open.status === 'active'
            ? `Há outra proposta aguardando decisão (${open.id}).`
            : `Há uma proposta desatualizada aberta (${open.id}). Espere o usuário decidir (get_proposal com waitSeconds).`,
        details: { proposalId: open.id, status: open.status },
      };
    }
    // Base da simulação: projeto + rascunho atual + etapas ainda na fila.
    let base = this.view;
    for (const s of p.steps) {
      if (s.status !== 'waiting') continue;
      try {
        base = applyOps(base, s.requested).project;
      } catch {
        /* a etapa da fila será marcada inválida quando chegar a vez dela */
      }
    }
    const simulated = this.simulateSteps(base, input.steps, p.steps.length);
    if (!simulated.ok) return simulated;
    for (const id of simulated.targets) if (!p.targets.includes(id)) p.targets.push(id);
    const firstNew = p.steps.length;
    p.steps.push(...input.steps.map(newStep));
    p.appendedRequestIds.push(requestId);
    p.version++;
    this.log('proposal', `Mais ${input.steps.length} etapa${input.steps.length > 1 ? 's' : ''} em: ${p.title}`);
    if (p.status === 'done') {
      p.status = 'active';
      p.current = firstNew - 1;
      this.advance(p);
    } else this.emit();
    return { ok: true, proposal: p, reused: false };
  }

  /** Prepara a próxima etapa pendente como rascunho. */
  private advance(p: Proposal): void {
    this.adjustMode = false;
    for (let i = p.current + 1; i < p.steps.length; i++) {
      const s = p.steps[i];
      if (s.status !== 'waiting') continue;
      p.current = i;
      try {
        s.ops = applyOps(this.project, s.requested).applied;
        s.status = 'draft';
        // Ids definitivos (clipes criados nesta etapa) passam a contar como alvos da proposta.
        for (const id of touchedClipIds(s.ops)) if (!p.targets.includes(id)) p.targets.push(id);
        p.expectedRevision = this.project.revision;
        p.version++;
        this.viewCache = null;
        const firstTarget = touchedClipIds(s.ops)[0];
        if (firstTarget && !this.selection.clipIds.length) this.selection = { clipIds: [firstTarget] };
        this.emit();
        return;
      } catch (e) {
        s.status = 'invalid';
        s.error = e instanceof Error ? e.message : String(e);
        this.log('proposal', `Etapa "${s.label}" não pode ser aplicada: ${s.error}`);
      }
    }
    p.current = p.steps.length;
    p.status = 'done';
    p.version++;
    this.viewCache = null;
    this.log('proposal', `Proposta concluída: ${p.title}`);
  }

  acceptStep(proposalId?: string): boolean {
    const p = proposalId ? this.proposals.find((x) => x.id === proposalId) : this.openProposal;
    if (!p || p.status !== 'active') return false;
    const s = p.steps[p.current];
    if (!s || s.status !== 'draft') return false;
    try {
      this.commit([...s.ops, ...s.manualOps], `Claude: ${s.label}`, 'ai', { proposalId: p.id, stepId: s.id });
    } catch (e) {
      this.markStale(p, `O rascunho não se aplica mais: ${e instanceof Error ? e.message : e}`);
      return false;
    }
    s.status = 'accepted';
    p.expectedRevision = this.project.revision;
    p.version++;
    this.log('decision', `Aceito: ${s.label}${s.manualOps.length ? ' (com ajustes manuais)' : ''}`);
    this.advance(p);
    return true;
  }

  discardStep(proposalId?: string): boolean {
    const p = proposalId ? this.proposals.find((x) => x.id === proposalId) : this.openProposal;
    if (!p || (p.status !== 'active' && p.status !== 'stale')) return false;
    if (p.status === 'stale') {
      p.status = 'cancelled';
      for (const s of p.steps) if (s.status === 'draft' || s.status === 'waiting') s.status = 'discarded';
      p.version++;
      this.log('decision', `Proposta descartada: ${p.title}`);
      return true;
    }
    const s = p.steps[p.current];
    if (!s || s.status !== 'draft') return false;
    s.status = 'discarded';
    p.version++;
    this.log('decision', `Descartado: ${s.label}`);
    this.advance(p);
    return true;
  }

  requestRedo(proposalId?: string): boolean {
    const p = proposalId ? this.proposals.find((x) => x.id === proposalId) : this.openProposal;
    if (!p || p.status !== 'stale') return false;
    p.redoRequested = true;
    p.version++;
    this.log('decision', 'Pedido ao Claude: refazer a proposta com o contexto atual.');
    return true;
  }

  cancelProposal(proposalId: string): boolean {
    const p = this.proposals.find((x) => x.id === proposalId);
    if (!p || (p.status !== 'active' && p.status !== 'stale')) return false;
    p.status = 'cancelled';
    for (const s of p.steps) if (s.status === 'draft' || s.status === 'waiting') s.status = 'discarded';
    p.version++;
    this.adjustMode = false;
    this.viewCache = null;
    this.log('proposal', `Proposta cancelada: ${p.title}`);
    return true;
  }

  /**
   * Resolve quando a proposta mudar (decisão, ajuste, desatualização, nota), no
   * tempo limite, se quem espera desistir (`signal`) ou se uma espera mais nova
   * pela mesma proposta assumir: quem desistiu não leva as notas do usuário.
   */
  waitForProposal(id: string, sinceVersion: number, timeoutMs: number, signal?: AbortSignal): Promise<WaitResult> {
    const p = this.proposals.find((x) => x.id === id);
    if (signal?.aborted) return Promise.resolve('cancelled');
    if (!p || p.version > sinceVersion) return Promise.resolve('changed');
    for (const old of this.waiters.filter((x) => x.id === id)) old.resolve('superseded');
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (why: WaitResult = 'changed') => {
        this.waiters = this.waiters.filter((x) => x !== w);
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(why);
      };
      const onAbort = () => done('cancelled');
      const w = { id, since: sinceVersion, resolve: done };
      this.waiters.push(w);
      timer = setTimeout(() => done('timeout'), timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
