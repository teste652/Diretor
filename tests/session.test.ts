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

describe('ajustes e etapas incrementais', () => {
  it('editar o clipe do rascunho ajusta o rascunho (inclusive arrastar na prévia)', () => {
    const s = setup();
    const rev = s.project.revision;
    s.propose(entradaSaida(rev));
    // arrastar o título na prévia: setProperty/setKeyframe sem id no clipe do rascunho
    const r = s.dispatch([{ op: 'setKeyframe', clipId: 't1', prop: 'y', t: 0.8, v: -40 }]);
    expect(r).toEqual({ ok: true, target: 'draft' });
    expect(s.project.revision).toBe(rev);
    expect(s.openProposal?.status).toBe('active');
    // o ponto do rascunho no mesmo tempo foi atualizado, não duplicado
    const y = findClip(s.view, 't1')!.props.y.keyframes;
    expect(y.filter((k) => Math.abs(k.t - 0.8) < 1e-3)).toHaveLength(1);
    expect(evalClipProp(findClip(s.view, 't1')!, 'y', 0.8)).toBe(-40);
    // editar outro clipe grava no projeto e desatualiza o rascunho
    expect(s.dispatch([{ op: 'updateClip', clipId: 'c1', set: { text: 'x' } }])).toEqual({ ok: true, target: 'project' });
    expect(s.openProposal?.status).toBe('stale');
  });

  it('acrescenta etapas assim que ficam prontas, sem duplicar', () => {
    const s = setup();
    const rev = s.project.revision;
    const first = s.propose({ requestId: 'a1', baseRevision: rev, title: 'Animar título', steps: [{ label: 'Entrada', ops: [{ op: 'animate', clipId: 't1', preset: 'slideUpIn' }] }] });
    if (!first.ok) throw new Error(first.message);
    const id = first.proposal.id;
    const add = { requestId: 'a2', baseRevision: rev, title: 'Animar título', appendTo: id, steps: [{ label: 'Saída', ops: [{ op: 'animate' as const, clipId: 't1', preset: 'fadeOut' as const }] }] };
    const second = s.propose(add);
    expect(second.ok && second.proposal.steps.map((x) => x.label)).toEqual(['Entrada', 'Saída']);
    const again = s.propose(add);
    expect(again.ok && again.reused).toBe(true);
    expect(first.proposal.steps).toHaveLength(2);
    expect(s.activeStep?.label).toBe('Entrada');
    s.acceptStep();
    expect(s.activeStep?.label).toBe('Saída');
    s.acceptStep();
    expect(first.proposal.status).toBe('done');
    // depois de concluída, uma nova etapa reabre a mesma proposta (a revisão só mudou pelas decisões dela)
    const third = s.propose({ requestId: 'a3', baseRevision: rev, title: 'Animar título', appendTo: id, steps: [{ label: 'Zoom', ops: [{ op: 'animate', clipId: 't1', preset: 'slowZoom' }] }] });
    expect(third.ok).toBe(true);
    expect(first.proposal.status).toBe('active');
    expect(s.activeStep?.label).toBe('Zoom');
  });

  it('recusa acrescentar a uma proposta desatualizada ou com revisão de fora', () => {
    const s = setup();
    const rev = s.project.revision;
    const first = s.propose({ requestId: 'b1', baseRevision: rev, title: 'x', steps: [{ label: 'E', ops: [{ op: 'animate', clipId: 't1', preset: 'fadeIn' }] }] });
    if (!first.ok) throw new Error();
    s.dispatch([{ op: 'updateClip', clipId: 'c1', set: { text: 'y' } }]);
    const r = s.propose({ requestId: 'b2', baseRevision: rev, title: 'x', appendTo: first.proposal.id, steps: [{ label: 'S', ops: [{ op: 'animate', clipId: 't1', preset: 'fadeOut' }] }] });
    expect(r.ok === false && r.code).toBe('proposal_closed');
  });

  it('abrir outro projeto encerra a proposta e acorda quem espera', async () => {
    const s = setup();
    const r = s.propose(entradaSaida(s.project.revision));
    if (!r.ok) throw new Error();
    const v = r.proposal.version;
    const wait = s.waitForProposal(r.proposal.id, v, 5000);
    const t0 = Date.now();
    s.load(parseProject(JSON.parse(JSON.stringify(s.project))), null);
    await wait;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.proposal.status).toBe('cancelled');
  });
});

describe('contexto', () => {
  it('notas do usuário chegam mesmo com contexto reduzido pelo teto', async () => {
    const s = setup();
    s.updateSettings({ contextCeilingBytes: 100 });
    s.addNote('use azul claro');
    const c: any = await handleBridge(s, 'get_context', { include: ['timeline'] });
    expect(c.truncated).toBeDefined();
    expect(c.userNotes).toEqual(['use azul claro']);
  });

  it('não responde "unchanged" se o playhead mudou', async () => {
    const s = setup();
    const a: any = await handleBridge(s, 'get_context', {});
    s.setPlayhead(2);
    const b: any = await handleBridge(s, 'get_context', { knownRevision: a.revision });
    expect(b.unchanged).toBeUndefined();
    expect(b.playhead).toBe(2);
  });

  it('recusa do usuário não vira novo pedido automático na mesma revisão', async () => {
    const s = setup();
    s.updateSettings({ contextCeilingBytes: 120 });
    await handleBridge(s, 'get_context', { include: ['timeline'], allowLarger: true });
    s.answerContextRequest(false);
    const again: any = await handleBridge(s, 'get_context', { include: ['timeline'], allowLarger: true });
    expect(s.contextRequest?.status).toBe('denied');
    expect(again.truncated.why).toBe('denied');
  });
});

describe('rascunho: desfazer, pedidos repetidos e desatualização', () => {
  it('Ctrl+Z com rascunho aberto desfaz só os ajustes do rascunho, sem mexer no projeto', () => {
    const s = setup();
    const rev = s.project.revision;
    const pastLen = s.past.length;
    s.propose(entradaSaida(rev));
    s.dispatch([{ op: 'retimeGroup', clipId: 't1', group: 'entrada', start: 0, duration: 1.5 }]);
    expect(keyframeGroups(findClip(s.view, 't1')!).find((g) => g.group === 'entrada')?.end).toBe(1.5);
    expect(s.canUndo).toBe(true);
    expect(s.undo()).toBe(true);
    expect(keyframeGroups(findClip(s.view, 't1')!).find((g) => g.group === 'entrada')?.end).toBe(0.8);
    expect(s.openProposal?.status).toBe('active');
    expect(s.project.revision).toBe(rev);
    expect(s.past).toHaveLength(pastLen);
    expect(s.redo()).toBe(true);
    expect(keyframeGroups(findClip(s.view, 't1')!).find((g) => g.group === 'entrada')?.end).toBe(1.5);
    // Sem ajustes para desfazer: avisa e não toca no histórico do projeto.
    s.undo();
    expect(s.undo()).toBe(false);
    expect(s.hint?.text).toMatch(/rascunho/);
    expect(findClip(s.project, 'c1')).toBeDefined();
    expect(s.openProposal?.status).toBe('active');
  });

  it('mesmo requestId com outro conteúdo é conflito; o mesmo conteúdo é reaproveitado', () => {
    const s = setup();
    const rev = s.project.revision;
    const a = s.propose(entradaSaida(rev, 'pedido'));
    expect(a.ok).toBe(true);
    s.acceptStep();
    s.discardStep();
    const other = s.propose({ requestId: 'pedido', baseRevision: s.project.revision, title: 'Outra coisa', steps: [{ label: 'x', ops: [{ op: 'animate', clipId: 'c1', preset: 'fadeIn' }] }] });
    expect(other.ok === false && other.code).toBe('request_id_conflict');
    const same = s.propose(entradaSaida(rev, 'pedido'));
    expect(same.ok && same.reused).toBe(true);
  });

  it('desatualizado sem pedido de refazer: o Claude é orientado a esperar, não a refazer', async () => {
    const s = setup();
    const r = s.propose(entradaSaida(s.project.revision));
    if (!r.ok) throw new Error();
    s.setSelection({ clipIds: ['c1'] });
    const st: any = await handleBridge(s, 'get_proposal', { proposalId: r.proposal.id });
    expect(st.status).toBe('stale');
    expect(st.next).toMatch(/Não refaça/);
    expect(st.context).toBeUndefined();
    const ctx: any = await handleBridge(s, 'get_context', {});
    expect(ctx.pendingProposal).toMatchObject({ status: 'stale', redoRequested: false });
    s.requestRedo();
    const st2: any = await handleBridge(s, 'get_proposal', { proposalId: r.proposal.id });
    expect(st2.next).toMatch(/requestId novo/);
  });

  it('nota do usuário acorda o Claude que está esperando e chega no get_proposal', async () => {
    const s = setup();
    const r = s.propose(entradaSaida(s.project.revision));
    if (!r.ok) throw new Error();
    const t0 = Date.now();
    setTimeout(() => s.addNote('mais devagar'), 20);
    const st: any = await handleBridge(s, 'get_proposal', { proposalId: r.proposal.id, waitSeconds: 5, sinceVersion: r.proposal.version });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(st.userNotes).toEqual(['mais devagar']);
  });

  it('clipe criado numa etapa aceita pode ser selecionado sem desatualizar a etapa seguinte', () => {
    const s = setup();
    const r = s.propose({
      requestId: 'novo-titulo',
      baseRevision: s.project.revision,
      title: 'Título novo animado',
      steps: [
        { label: 'Criar', ops: [{ op: 'addClip', clip: { kind: 'title', text: 'NOVO', start: 1, duration: 2 } }] },
        { label: 'Animar', ops: [{ op: 'animate', clipId: 't1', preset: 'fadeIn' }] },
      ],
    });
    if (!r.ok) throw new Error(r.message);
    s.acceptStep();
    const created = s.project.clips.find((c) => c.kind === 'title' && c.text === 'NOVO')!;
    s.setSelection({ clipIds: [created.id] });
    expect(r.proposal.status).toBe('active');
  });

  it('importar mídia e travar faixas não são operações do Claude', () => {
    const s = setup();
    const r = s.propose({ baseRevision: s.project.revision, title: 'x', steps: [{ label: 'x', ops: [{ op: 'updateTrack', trackId: 'trk_text', set: { locked: false } }] }] });
    expect(r.ok === false && r.code).toBe('invalid_ops');
    expect(r.ok === false && r.message).toMatch(/só da interface/);
  });

  it('remoção proposta aparece no rascunho e a substituída marca as etapas como descartadas', () => {
    const s = setup();
    const r = s.propose({ requestId: 'rm', baseRevision: s.project.revision, title: 'Tirar legenda', steps: [{ label: 'Remover', ops: [{ op: 'removeClip', clipId: 'c1' }] }, { label: 'Depois', ops: [{ op: 'animate', clipId: 't1', preset: 'fadeIn' }] }] });
    if (!r.ok) throw new Error();
    expect([...s.draftInfo.removedClipIds]).toEqual(['c1']);
    const r2 = s.propose({ requestId: 'rm2', baseRevision: s.project.revision, title: 'Outra', replaces: r.proposal.id, steps: [{ label: 'E', ops: [{ op: 'animate', clipId: 't1', preset: 'fadeIn' }] }] });
    expect(r2.ok).toBe(true);
    expect(r.proposal.steps.map((x) => x.status)).toEqual(['discarded', 'discarded']);
  });

  it('abrir um projeto nunca repete revisão e zera pedidos de contexto', async () => {
    const s = setup();
    const before = s.project.revision;
    s.updateSettings({ contextCeilingBytes: 120 });
    await handleBridge(s, 'get_context', { include: ['timeline'], allowLarger: true });
    expect(s.contextRequest?.status).toBe('pending');
    const file = JSON.parse(JSON.stringify(s.project));
    file.revision = 1;
    s.load(parseProject(file), null);
    expect(s.project.revision).toBeGreaterThan(before);
    expect(s.contextRequest).toBeNull();
  });
});

describe('teto de contexto', () => {
  it('a resposta reduzida cabe no teto', async () => {
    const s = setup();
    for (let i = 0; i < 4; i++) s.dispatch([{ op: 'animate', clipId: 't1', preset: (['fadeIn', 'popOut', 'slowZoom', 'slideUpIn'] as const)[i] }]);
    for (const ceiling of [1024, 400, 200]) {
      s.updateSettings({ contextCeilingBytes: ceiling });
      const c: any = await handleBridge(s, 'get_context', { include: ['timeline', 'media'] });
      expect(c.truncated).toBeDefined();
      expect(new TextEncoder().encode(JSON.stringify(c)).length).toBeLessThanOrEqual(ceiling);
    }
  });

  it('autorização vale para o mesmo pedido mesmo se o playhead mudar um pouco', async () => {
    const s = setup();
    s.updateSettings({ contextCeilingBytes: 300 });
    await handleBridge(s, 'get_context', { include: ['timeline'], allowLarger: true });
    s.answerContextRequest(true);
    s.setPlayhead(1.234);
    const c: any = await handleBridge(s, 'get_context', { include: ['timeline'], allowLarger: true });
    expect(c.timeline).toHaveLength(3);
    expect(s.contextRequest).toBeNull();
  });

  it('recusa vale até o usuário mudar o teto', async () => {
    const s = setup();
    s.updateSettings({ contextCeilingBytes: 300 });
    await handleBridge(s, 'get_context', { include: ['timeline'], allowLarger: true });
    s.answerContextRequest(false);
    s.dispatch([{ op: 'updateClip', clipId: 'c1', set: { text: 'muda a revisão' } }]);
    const again: any = await handleBridge(s, 'get_context', { include: ['timeline'], allowLarger: true });
    expect(again.truncated.why).toBe('denied');
    expect(s.contextRequest?.status).toBe('denied');
    s.updateSettings({ contextCeilingBytes: 400 });
    await handleBridge(s, 'get_context', { include: ['timeline'], allowLarger: true });
    expect(s.contextRequest?.status).toBe('pending');
  });
});
