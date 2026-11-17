import { describe, expect, it } from 'vitest';
import { EditorSession } from '../src/core/session';
import { findClip, parseProject, type TitleClip } from '../src/core/model';
import { handleBridge } from '../src/core/api';
import { evalClipProp, keyframeGroups } from '../src/core/properties';

function setup() {
  const s = new EditorSession();
  s.dispatch([
    { op: 'addMedia', media: { id: 'm1', path: 'C:/v/clip.mp4', name: 'clip.mp4', duration: 10, width: 1280, height: 720, hasAudio: true } },
    { op: 'addClip', clip: { kind: 'video', id: 'v1', mediaId: 'm1' } },
  ]);
  // aparar início e fim: 2s..8s do original
  s.dispatch([{ op: 'updateClip', clipId: 'v1', set: { in: 2, duration: 6 } }]);
  s.dispatch([{ op: 'addClip', clip: { kind: 'title', id: 't1', text: 'EM MOVIMENTO', start: 0, duration: 6 } }]);
  s.dispatch([{ op: 'addClip', clip: { kind: 'caption', id: 'c1', text: 'A cidade ganha vida à noite.', start: 1, duration: 3 } }]);
  s.setSelection({ clipIds: ['t1'] });
  return s;
}

const entradaSaida = (rev: number, requestId = 'req-1') => ({
  requestId,
  baseRevision: rev,
  title: 'Título sobe suavemente e desaparece',
  steps: [
    { label: 'Entrada', ops: [{ op: 'animate' as const, clipId: 't1', preset: 'slideUpIn' as const, duration: 0.8 }] },
    { label: 'Saída', ops: [{ op: 'animate' as const, clipId: 't1', preset: 'fadeOut' as const, duration: 0.6 }] },
  ],
});

describe('operações e histórico', () => {
  it('importa, apara e cria título/legenda com revisões', () => {
    const s = setup();
    const v = findClip(s.project, 'v1')!;
    expect(v.kind === 'video' && v.in).toBe(2);
    expect(v.duration).toBe(6);
    expect(s.project.revision).toBe(4);
    expect(s.project.clips).toHaveLength(3);
  });

  it('rejeita alvo inexistente, parâmetro fora do intervalo e trecho além do arquivo', () => {
    const s = setup();
    expect(s.dispatch([{ op: 'setKeyframe', clipId: 'nada', prop: 'x', t: 0, v: 0 }]).ok).toBe(false);
    expect(s.dispatch([{ op: 'setKeyframe', clipId: 't1', prop: 'opacity', t: 0, v: 3 }]).ok).toBe(false);
    expect(s.dispatch([{ op: 'setKeyframe', clipId: 't1', prop: 'x', t: 99, v: 0 }]).ok).toBe(false);
    expect(s.dispatch([{ op: 'updateClip', clipId: 'v1', set: { duration: 9 } }]).ok).toBe(false);
    expect(s.project.revision).toBe(4);
  });

  it('desfaz e refaz', () => {
    const s = setup();
    s.undo();
    expect(findClip(s.project, 'c1')).toBeUndefined();
    s.redo();
    expect(findClip(s.project, 'c1')).toBeDefined();
  });

  it('salva e reabre (JSON)', () => {
    const s = setup();
    const again = parseProject(JSON.parse(JSON.stringify(s.project)));
    expect(again).toEqual(s.project);
  });
});

describe('propostas em rascunho', () => {
  it('mostra uma etapa por vez, ajuste manual vai para o rascunho e só grava ao aceitar', () => {
    const s = setup();
    const rev = s.project.revision;
    const r = s.propose(entradaSaida(rev));
    expect(r.ok).toBe(true);
    // Rascunho visível na prévia, projeto gravado intacto
    expect(s.project.revision).toBe(rev);
    expect(evalClipProp(findClip(s.view, 't1')!, 'opacity', 0)).toBe(0);
    expect(evalClipProp(findClip(s.project, 't1')!, 'opacity', 0)).toBe(1);
    expect(s.activeStep?.label).toBe('Entrada');

    // Ajuste à mão: duração da entrada 0.8 → 1.5 (vira ajuste do rascunho)
    const res = s.dispatch([{ op: 'retimeGroup', clipId: 't1', group: 'entrada', start: 0, duration: 1.5 }]);
    expect(res).toEqual({ ok: true, target: 'draft' });
    expect(s.project.revision).toBe(rev);

    expect(s.acceptStep()).toBe(true);
    expect(s.project.revision).toBe(rev + 1);
    const g = keyframeGroups(findClip(s.project, 't1')!);
    expect(g.find((x) => x.group === 'entrada')).toMatchObject({ start: 0, end: 1.5 });

    // Próxima etapa (saída) vira rascunho; descartar não grava nada
    expect(s.activeStep?.label).toBe('Saída');
    expect(s.discardStep()).toBe(true);
    expect(s.project.revision).toBe(rev + 1);
    const t = findClip(s.project, 't1') as TitleClip;
    expect(keyframeGroups(t).map((x) => x.group)).toEqual(['entrada']);
    expect(s.openProposal).toBeUndefined();

    // Desfazer a etapa aprovada separadamente
    s.undo();
    expect(keyframeGroups(findClip(s.project, 't1')!)).toEqual([]);
    s.redo();
    expect(keyframeGroups(findClip(s.project, 't1')!)).toHaveLength(1);
  });

  it('chamada repetida devolve a mesma proposta sem duplicar', () => {
    const s = setup();
    const rev = s.project.revision;
    const a = s.propose(entradaSaida(rev));
    const b = s.propose(entradaSaida(rev));
    expect(a.ok && b.ok && a.proposal.id === b.proposal.id).toBe(true);
    expect(b.ok && b.reused).toBe(true);
    expect(s.proposals).toHaveLength(1);
    s.acceptStep();
    // Mesmo depois de aceita, repetir não reaplica
    const c = s.propose(entradaSaida(rev));
    expect(c.ok && c.reused).toBe(true);
    expect(s.project.revision).toBe(rev + 1);
  });

  it('marca como desatualizada quando o projeto ou a seleção mudam e permite refazer', async () => {
    const s = setup();
    const r = s.propose(entradaSaida(s.project.revision));
    if (!r.ok) throw new Error('falhou');
    // edição manual fora do rascunho
    s.dispatch([{ op: 'updateClip', clipId: 'c1', set: { text: 'Outra legenda' } }]);
    expect(r.proposal.status).toBe('stale');
    expect(s.view).toBe(s.project);
    s.requestRedo();
    const st: any = await handleBridge(s, 'get_proposal', { proposalId: r.proposal.id });
    expect(st.status).toBe('stale');
    expect(st.redoRequested).toBe(true);
    expect(st.context.revision).toBe(s.project.revision);
    // nova proposta com a revisão atual substitui a antiga
    const r2 = s.propose({ ...entradaSaida(s.project.revision, 'req-2'), replaces: r.proposal.id });
    expect(r2.ok).toBe(true);
    expect(r.proposal.status).toBe('superseded');

    s.setSelection({ clipIds: ['c1'] });
    expect(r2.ok && r2.proposal.status).toBe('stale');
  });

  it('recusa revisão antiga e operações inválidas', () => {
    const s = setup();
    const a = s.propose(entradaSaida(0));
    expect(a.ok === false && a.code).toBe('stale_revision');
    const b = s.propose({ baseRevision: s.project.revision, title: 'x', steps: [{ label: 'x', ops: [{ op: 'setProperty', clipId: 't1', prop: 'opacity', value: 7 }] }] });
    expect(b.ok === false && b.code).toBe('invalid_ops');
  });

  it('suporta pedido preciso por keyframes (frame X a Y)', () => {
    const s = setup();
    const fps = s.project.settings.fps;
    const r = s.propose({
      baseRevision: s.project.revision,
      title: 'Mover título do frame 15 ao 45',
      steps: [
        {
          label: 'Movimento',
          ops: [
            { op: 'setKeyframe', clipId: 't1', prop: 'x', t: 15 / fps, v: -300, ease: 'easeInOut', group: 'mov' },
            { op: 'setKeyframe', clipId: 't1', prop: 'x', t: 45 / fps, v: 300, ease: 'linear', group: 'mov' },
          ],
        },
      ],
    });
    expect(r.ok).toBe(true);
    const c = findClip(s.view, 't1')!;
    expect(evalClipProp(c, 'x', 1)).toBeCloseTo(0, 5);
    expect(evalClipProp(c, 'x', 0)).toBe(-300);
  });
});

describe('modo econômico', () => {
  it('contexto mínimo, cache por revisão e teto configurável', async () => {
    const s = setup();
    const a: any = await handleBridge(s, 'get_context', {});
    expect(a.selection[0].id).toBe('t1');
    expect(a.timeline).toBeUndefined();
    const b: any = await handleBridge(s, 'get_context', { knownRevision: a.revision });
    expect(b).toEqual({ unchanged: true, revision: a.revision });

    s.updateSettings({ contextCeilingBytes: 120 });
    const c: any = await handleBridge(s, 'get_context', { include: ['timeline'] });
    expect(c.truncated.neededBytes).toBeGreaterThan(120);
    const d: any = await handleBridge(s, 'get_context', { include: ['timeline'], allowLarger: true });
    expect(d.truncated).toBeDefined();
    expect(s.contextRequest?.status).toBe('pending');
    s.answerContextRequest(true);
    const e: any = await handleBridge(s, 'get_context', { include: ['timeline'], allowLarger: true });
    expect(e.timeline).toHaveLength(3);
  });

  it('get_proposal espera a decisão do usuário', async () => {
    const s = setup();
    const r = s.propose(entradaSaida(s.project.revision));
    if (!r.ok) throw new Error();
    const v = r.proposal.version;
    setTimeout(() => s.acceptStep(), 20);
    const st: any = await handleBridge(s, 'get_proposal', { proposalId: r.proposal.id, waitSeconds: 2, sinceVersion: v });
    expect(st.steps[0].status).toBe('accepted');
    expect(st.current.label).toBe('Saída');
  });
});
