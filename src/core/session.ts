// Sessão do editor: projeto gravado, histórico (desfazer/refazer), seleção e as
// propostas do Claude em rascunho. É a única porta de entrada para mudar o
// projeto, tanto pela interface quanto pelo MCP.

import { type Op, OpValidationError, applyOps, describeOp, touchedClipIds } from './operations';
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

export interface ProposeInput {
  requestId?: string;
  baseRevision: number;
  title: string;
  summary?: string;
  steps: { label: string; summary?: string; ops: Op[] }[];
  replaces?: string;
}

export type ProposeResult =
  | { ok: true; proposal: Proposal; reused: boolean }
  | { ok: false; code: 'stale_revision' | 'invalid_ops' | 'proposal_pending' | 'bad_request'; message: string; details?: unknown };

let seq = 0;
const sid = (p: string) => `${p}${Date.now().toString(36)}${(++seq).toString(36)}`;

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
  /** Pedido do assistente para enviar um contexto maior que o teto. */
  contextRequest: { bytes: number; revision: number; status: 'pending' | 'granted' | 'denied' } | null = null;
  /** Aumenta a cada mudança de estado (para a interface re-renderizar). */
  version = 0;

  private listeners = new Set<() => void>();
  private waiters: { id: string; since: number; resolve: () => void }[] = [];
  private viewCache: { key: string; project: Project } | null = null;
  private activitySeq = 0;
  private noteSeq = 0;

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
    for (const w of ready) w.resolve();
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
  get draftInfo(): { clipIds: Set<string>; createdClipIds: Set<string>; keyframeIds: Set<string>; range: { clipId: string; start: number; end: number }[] } {
    const step = this.activeStep;
    const out = { clipIds: new Set<string>(), createdClipIds: new Set<string>(), keyframeIds: new Set<string>(), range: [] as { clipId: string; start: number; end: number }[] };
    if (!step) return out;
    const all = [...step.ops, ...step.manualOps];
    for (const id of touchedClipIds(all)) out.clipIds.add(id);
    for (const o of all) {
      if (o.op === 'addClip' && o.clip.id) out.createdClipIds.add(o.clip.id);
      if (o.op === 'setKeyframe' && o.keyframeId) out.keyframeIds.add(o.keyframeId);
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
   * Ponto de entrada das edições manuais. Se a edição mexe em algo que só
   * existe no rascunho (ou o modo "ajustar" está ligado), ela vira ajuste do
   * rascunho; senão é gravada no projeto.
   */
  dispatch(ops: Op[], label?: string): { ok: true; target: 'draft' | 'project' } | { ok: false; message: string } {
    try {
      if (this.shouldRouteToDraft(ops)) {
        const p = this.openProposal!;
        const step = this.activeStep!;
        const base = this.view;
        const { applied } = applyOps(base, ops);
        step.manualOps.push(...applied);
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
    if (this.adjustMode) return true;
    const d = this.draftInfo;
    return ops.some(
      (o) =>
        ('clipId' in o && d.createdClipIds.has(o.clipId)) ||
        ('keyframeId' in o && !!o.keyframeId && d.keyframeIds.has(o.keyframeId)) ||
        (o.op === 'retimeGroup' && d.clipIds.has(o.clipId) && this.groupIsDraft(o.clipId, o.group)),
    );
  }

  private groupIsDraft(clipId: string, group: string): boolean {
    const step = this.activeStep!;
    return [...step.ops, ...step.manualOps].some((o) => o.op === 'setKeyframe' && o.clipId === clipId && o.group === group);
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

  undo(): boolean {
    const e = this.past.pop();
    if (!e) return false;
    const rev = this.project.revision + 1;
    this.project = { ...e.before, revision: rev };
    this.future.push(e);
    this.afterHistoryMove(`Desfeito: ${e.label}`);
    return true;
  }

  redo(): boolean {
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
    const keyframe = s.keyframe && exists(s.keyframe.clipId) ? s.keyframe : undefined;
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
    this.settings = { ...this.settings, ...s };
    this.emit();
  }

  requestLargerContext(bytes: number): void {
    this.contextRequest = { bytes, revision: this.project.revision, status: 'pending' };
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
  }

  takeNotes(): string[] {
    const pending = this.notes.filter((n) => !n.delivered);
    for (const n of pending) n.delivered = true;
    return pending.map((n) => n.text);
  }

  // ---------- arquivo ----------
  load(project: Project, filePath: string | null): void {
    this.project = project;
    this.past = [];
    this.future = [];
    this.selection = { clipIds: [] };
    this.playhead = 0;
    for (const p of this.proposals) if (p.status === 'active' || p.status === 'stale') p.status = 'cancelled';
    this.adjustMode = false;
    this.filePath = filePath;
    this.dirty = false;
    this.viewCache = null;
    this.emit();
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
    const requestId =
      input.requestId?.trim() || `h_${hashString(JSON.stringify([input.baseRevision, input.title, input.steps]))}`;
    const existing = this.proposals.find((p) => p.requestId === requestId);
    if (existing) return { ok: true, proposal: existing, reused: true };

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
    let sim = this.project;
    const targets = new Set<string>();
    for (let i = 0; i < input.steps.length; i++) {
      const st = input.steps[i];
      if (!st || !Array.isArray(st.ops) || st.ops.length === 0)
        return { ok: false, code: 'bad_request', message: `Etapa ${i + 1} sem ops.` };
      try {
        const r = applyOps(sim, st.ops);
        sim = r.project;
        touchedClipIds(r.applied).forEach((id) => targets.add(id));
      } catch (e) {
        if (e instanceof OpValidationError)
          return { ok: false, code: 'invalid_ops', message: `Etapa ${i + 1}: ${e.message}`, details: { step: i + 1, errors: e.errors } };
        throw e;
      }
    }
    for (const p of this.proposals) {
      if ((p.status === 'active' || p.status === 'stale') && (p.id === input.replaces || p.status === 'stale')) {
        p.status = 'superseded';
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
      steps: input.steps.map((s) => ({
        id: sid('step_'),
        label: s.label || 'Etapa',
        summary: s.summary ?? '',
        requested: s.ops,
        ops: [],
        manualOps: [],
        status: 'waiting',
      })),
      current: -1,
      status: 'active',
      redoRequested: false,
      replaces: input.replaces,
      version: 1,
    };
    this.proposals.push(proposal);
    this.log('proposal', `Proposta: ${proposal.title} (${proposal.steps.length} etapa${proposal.steps.length > 1 ? 's' : ''})`);
    this.advance(proposal);
    return { ok: true, proposal, reused: false };
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

  /** Resolve quando a proposta mudar (decisão, ajuste, desatualização) ou no tempo limite. */
  waitForProposal(id: string, sinceVersion: number, timeoutMs: number): Promise<void> {
    const p = this.proposals.find((x) => x.id === id);
    if (!p || p.version > sinceVersion) return Promise.resolve();
    return new Promise((resolve) => {
      const w = { id, since: sinceVersion, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        resolve();
      }, timeoutMs);
    });
  }
}
