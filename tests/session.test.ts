import { describe, expect, it } from 'vitest';
import { type NewClipSpec, type Op, applyOps } from '../src/core/operations';
import { type DraftInfo, EditorSession } from '../src/core/session';
import { type CaptionClip, type Project, type TitleClip, type VideoClip, createProject, findClip, parseProject, projectDuration } from '../src/core/model';
import { handleBridge } from '../src/core/api';
import { evalClipProp, keyframeGroups } from '../src/core/properties';
import type { TimeRange } from '../src/core/ripple';
import { videos } from './fixtures';

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
  it('contexto mínimo, cache por revisão e teto', async () => {
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

  it('desligado: a IA vê tudo, sem teto e sem pedir licença; ligado de novo, o teto volta', async () => {
    const s = setup();
    s.updateSettings({ contextCeilingBytes: 120 });
    await handleBridge(s, 'get_context', { include: ['timeline'], allowLarger: true });
    expect(s.contextRequest?.status).toBe('pending');
    // Desligar tira o cartão que esperava a licença.
    s.updateSettings({ economy: false });
    expect(s.contextRequest).toBeNull();
    const c: any = await handleBridge(s, 'get_context', { include: ['timeline'], allowLarger: true });
    expect(c.truncated).toBeUndefined();
    expect(c.timeline).toHaveLength(3);
    expect(s.contextRequest).toBeNull();
    // Sem economia, os textos vão com o estilo completo.
    expect(c.timeline.find((x: any) => x.id === 't1').style).toMatchObject({ color: expect.any(String) });
    // Uma recusa antiga também não vale depois de trocar o modo.
    s.updateSettings({ economy: true });
    await handleBridge(s, 'get_context', { include: ['timeline'], allowLarger: true });
    s.answerContextRequest(false);
    expect(s.contextRequest?.status).toBe('denied');
    s.updateSettings({ economy: false });
    s.updateSettings({ economy: true });
    const d: any = await handleBridge(s, 'get_context', { include: ['timeline'] });
    expect(d.truncated?.why).toBe('reduce');
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

describe('segunda revisão: orientação ao Claude, notas e contexto', () => {
  it('edição vazia (botão de áudio sem vídeos) não cria histórico nem desatualiza o rascunho', () => {
    const s = setup();
    const rev = s.project.revision;
    s.propose(entradaSaida(rev));
    const past = s.past.length;
    s.dirty = false;
    expect(s.dispatch([]).ok).toBe(true);
    expect(s.project.revision).toBe(rev);
    expect(s.past).toHaveLength(past);
    expect(s.openProposal?.status).toBe('active');
    expect(s.dirty).toBe(false);
  });

  it('com "ajustar" ligado, renomear o projeto vai para o projeto, não para a etapa do Claude', () => {
    const s = setup();
    const r = s.propose(entradaSaida(s.project.revision));
    if (!r.ok) throw new Error();
    s.setAdjustMode(true);
    expect(s.adjustMode).toBe(true);
    expect(s.dispatch([{ op: 'renameProject', name: 'Meu vídeo' }])).toEqual({ ok: true, target: 'project' });
    expect(s.project.name).toBe('Meu vídeo');
    // O projeto mudou fora do rascunho: ele fica desatualizado, e descartá-lo não leva o nome.
    expect(r.proposal.status).toBe('stale');
    s.discardStep(r.proposal.id);
    expect(s.project.name).toBe('Meu vídeo');
  });

  it('com "ajustar" ligado e o rascunho ativo, importar mídia vai para o projeto, não para a etapa do Claude', () => {
    const s = setup();
    const r = s.propose(entradaSaida(s.project.revision));
    if (!r.ok) throw new Error();
    s.setAdjustMode(true);
    expect(r.proposal.status).toBe('active');
    const media = { id: 'm2', path: 'C:/v/b.mp4', name: 'b.mp4', duration: 4, width: 1280, height: 720, hasAudio: false };
    expect(s.dispatch([{ op: 'addMedia', media }, { op: 'addClip', clip: { kind: 'video', id: 'v2', mediaId: 'm2', start: 6 } }])).toEqual({ ok: true, target: 'project' });
    expect(s.project.media.map((m) => m.id)).toContain('m2');
    expect(findClip(s.project, 'v2')).toBeDefined();
    expect(r.proposal.steps.every((st) => st.manualOps.length === 0)).toBe(true);
    s.discardStep(r.proposal.id);
    expect(findClip(s.project, 'v2')).toBeDefined();
  });

  it('acrescentar a uma proposta desatualizada ou descartada orienta o Claude a esperar, não a refazer', () => {
    const s = setup();
    const rev = s.project.revision;
    const first = s.propose({ requestId: 'g1', baseRevision: rev, title: 'x', steps: [{ label: 'E', ops: [{ op: 'animate', clipId: 't1', preset: 'fadeIn' }] }] });
    if (!first.ok) throw new Error();
    const add = (requestId: string) =>
      s.propose({ requestId, baseRevision: rev, title: 'x', appendTo: first.proposal.id, steps: [{ label: 'S', ops: [{ op: 'animate', clipId: 't1', preset: 'fadeOut' }] }] });
    s.setSelection({ clipIds: ['c1'] });
    const stale = add('g2');
    expect(stale.ok === false && stale.code).toBe('proposal_closed');
    expect(stale.ok === false && stale.message).toMatch(/Não refaça/);
    expect(stale.ok === false && stale.details).toMatchObject({ status: 'stale', redoRequested: false });
    s.requestRedo();
    const redo = add('g3');
    expect(redo.ok === false && redo.message).toMatch(new RegExp(`replaces="${first.proposal.id}"`));
    s.discardStep(first.proposal.id);
    const gone = add('g4');
    expect(gone.ok === false && gone.message).toMatch(/Não a proponha de novo/);
    for (const r of [stale, redo, gone]) expect(r.ok === false && r.message).not.toMatch(/faça uma nova proposta/);
  });

  it('não reabre uma proposta concluída enquanto outra está desatualizada', () => {
    const s = setup();
    const a = s.propose({ requestId: 'A', baseRevision: s.project.revision, title: 'A', steps: [{ label: 'E', ops: [{ op: 'animate', clipId: 't1', preset: 'fadeIn' }] }] });
    if (!a.ok) throw new Error();
    s.acceptStep();
    expect(a.proposal.status).toBe('done');
    const b = s.propose({ requestId: 'B', baseRevision: s.project.revision, title: 'B', steps: [{ label: 'S', ops: [{ op: 'animate', clipId: 't1', preset: 'fadeOut' }] }] });
    if (!b.ok) throw new Error(b.message);
    s.setSelection({ clipIds: ['c1'] });
    expect(b.proposal.status).toBe('stale');
    const r = s.propose({ requestId: 'A2', baseRevision: s.project.revision, title: 'A', appendTo: a.proposal.id, steps: [{ label: 'Z', ops: [{ op: 'animate', clipId: 't1', preset: 'slowZoom' }] }] });
    expect(r.ok === false && r.code).toBe('proposal_pending');
    expect(a.proposal.status).toBe('done');
    expect(s.openProposal?.id).toBe(b.proposal.id);
  });

  it('espera cancelada ou substituída não leva as notas do usuário', async () => {
    const s = setup();
    const r = s.propose(entradaSaida(s.project.revision));
    if (!r.ok) throw new Error();
    const args = { proposalId: r.proposal.id, waitSeconds: 30, sinceVersion: r.proposal.version };
    // O Claude apertou "parar": a espera termina na hora.
    const ctrl = new AbortController();
    const abandoned = handleBridge(s, 'get_proposal', args, ctrl.signal);
    ctrl.abort();
    expect(await abandoned).toMatchObject({ error: 'cancelled' });
    // Uma espera abandonada sem aviso é substituída pela chamada nova, que recebe a nota.
    const old = handleBridge(s, 'get_proposal', args);
    const live = handleBridge(s, 'get_proposal', args);
    expect(await old).toMatchObject({ error: 'superseded' });
    s.addNote('mais devagar');
    expect(((await live) as { userNotes?: string[] }).userNotes).toEqual(['mais devagar']);
  });

  it('a nota vai para a espera mais nova quando há mais de uma proposta esperando', async () => {
    const s = setup();
    const one = (requestId: string, preset: 'fadeIn' | 'fadeOut') =>
      s.propose({ requestId, baseRevision: s.project.revision, title: requestId, steps: [{ label: 'E', ops: [{ op: 'animate', clipId: 't1', preset }] }] });
    const a = one('n1', 'fadeIn');
    if (!a.ok) throw new Error();
    s.acceptStep();
    expect(a.proposal.status).toBe('done');
    // Uma espera esquecida na proposta A (já aceita) e outra, mais nova, na proposta B.
    const older = handleBridge(s, 'get_proposal', { proposalId: a.proposal.id, waitSeconds: 30, sinceVersion: a.proposal.version });
    const b = one('n2', 'fadeOut');
    if (!b.ok) throw new Error();
    const newest = handleBridge(s, 'get_proposal', { proposalId: b.proposal.id, waitSeconds: 30, sinceVersion: b.proposal.version });
    s.addNote('azul');
    const [ra, rb] = (await Promise.all([older, newest])) as { userNotes?: string[] }[];
    expect(ra.userNotes).toBeUndefined();
    expect(rb.userNotes).toEqual(['azul']);
  });

  it('o contexto avisa o pedido de refazer e a resposta reduzida mantém a proposta pendente', async () => {
    const s = setup();
    const r = s.propose(entradaSaida(s.project.revision));
    if (!r.ok) throw new Error();
    s.setSelection({ clipIds: ['c1'] });
    const a: any = await handleBridge(s, 'get_context', {});
    expect(a.pendingProposal).toMatchObject({ status: 'stale', redoRequested: false });
    s.requestRedo();
    const b: any = await handleBridge(s, 'get_context', { knownRevision: a.revision });
    expect(b.unchanged).toBeUndefined();
    expect(b.pendingProposal).toMatchObject({ redoRequested: true });
    for (const preset of ['fadeIn', 'popOut', 'slowZoom', 'slideUpIn'] as const) expect(s.dispatch([{ op: 'animate', clipId: 't1', preset }]).ok).toBe(true);
    s.updateSettings({ contextCeilingBytes: 1024 });
    const c: any = await handleBridge(s, 'get_context', { include: ['timeline', 'media'] });
    expect(c.truncated).toBeDefined();
    expect(c.pendingProposal).toMatchObject({ id: r.proposal.id, status: 'stale', redoRequested: true });
    expect(c.size).toEqual(a.size);
    expect(new TextEncoder().encode(JSON.stringify(c)).length).toBeLessThanOrEqual(1024);
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

  it('recusa vale até o teto mudar', async () => {
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

describe('cortes e rascunhos', () => {
  it('um Ctrl+Z desfaz o corte inteiro', () => {
    const s = setup();
    const before = structuredClone(s.project.clips);
    expect(s.dispatch([{ op: 'removeRanges', ranges: [[1.5, 2.5]] }]).ok).toBe(true);
    s.undo();
    expect(s.project.clips).toEqual(before);
  });

  it('corte da IA: emenda, ripple, pedaço que não é "clipe novo" e ajuste manual no rascunho', () => {
    const s = setup();
    const steps = [{ label: 'Corte', ops: [{ op: 'removeRanges' as const, ranges: [[1.5, 2.5]] as [number, number][] }] }];
    expect(s.propose({ requestId: 'corte', baseRevision: s.project.revision, title: 'Corte', steps }).ok).toBe(true);
    const d = s.draftInfo;
    expect(d.seams).toEqual([{ at: 1.5, removed: 1 }]);
    expect(d.ripple).toBe(true);
    const piece = s.view.clips.find((c) => c.kind === 'video' && c.id !== 'v1')!;
    expect(d.createdClipIds.has(piece.id)).toBe(true);
    expect(d.addedClipIds.has(piece.id)).toBe(false);
    expect(s.draftInfo).toBe(d);
    s.setSelection({ clipIds: [piece.id] });
    expect(s.openProposal!.status).toBe('active');
    expect(s.dispatch([{ op: 'removeRanges', ranges: [[3, 3.5]] }])).toEqual({ ok: true, target: 'draft' });
    expect(s.draftInfo.seams).toEqual([{ at: 1.5, removed: 1 }, { at: 3, removed: 0.5 }]);
  });

  it('dividir um clipe fora do rascunho grava no projeto e desatualiza a proposta', () => {
    const s = setup();
    s.propose(entradaSaida(s.project.revision));
    expect(s.dispatch([{ op: 'splitClip', clipId: 'v1', at: 3 }])).toEqual({ ok: true, target: 'project' });
    expect(s.openProposal!.status).toBe('stale');
  });

  it('corte de 1 quadro ou maior: a emenda marca o lugar e o vídeo cortado fica fora da faixa do rascunho', () => {
    // v1 [0,6) mostra 2..8 do arquivo: os dois cortes ficam dentro dele. O de 1 quadro apara o pedaço da esquerda.
    const cases: [[number, number], number][] = [
      [[3, 3.033], 0.033],
      [[3, 3.5], 0.5],
    ];
    for (const [range, removed] of cases) {
      const s = setup();
      const steps = [{ label: 'Corte', ops: [{ op: 'removeRanges' as const, ranges: [range] }] }];
      expect(s.propose({ requestId: `corte-${removed}`, baseRevision: s.project.revision, title: 'Corte', steps }).ok).toBe(true);
      const d = s.draftInfo;
      expect(d.seams).toEqual([{ at: 3, removed }]);
      const vids = s.view.clips.filter((c) => c.kind === 'video').map((c) => c.id);
      expect(vids).toHaveLength(2);
      expect(d.range.filter((r) => vids.includes(r.clipId))).toEqual([]);
    }
  });

  it('aparar o fim do último vídeo não deixa emenda: a faixa do rascunho continua no clipe', () => {
    const s = setup();
    const steps = [{ label: 'Fim', ops: [{ op: 'removeRanges' as const, ranges: [[5.98, 6]] as [number, number][] }] }];
    expect(s.propose({ requestId: 'fim', baseRevision: s.project.revision, title: 'Fim', steps }).ok).toBe(true);
    const d = s.draftInfo;
    expect(d.seams).toEqual([]);
    expect(d.ripple).toBe(false);
    expect(d.range.find((r) => r.clipId === 'v1')).toEqual({ clipId: 'v1', start: 0, end: 5.98 });
  });

  it('sem etapa em rascunho, draftInfo é sempre o mesmo objeto vazio', () => {
    const s = setup();
    const empty = s.draftInfo;
    expect(s.draftInfo).toBe(empty);
    expect([empty.clipIds.size, empty.createdClipIds.size, empty.addedClipIds.size, empty.seams.length, empty.range.length]).toEqual([0, 0, 0, 0, 0]);
    expect(empty.ripple).toBe(false);
    s.propose(entradaSaida(s.project.revision));
    expect(s.draftInfo).not.toBe(empty);
    s.discardStep();
    s.discardStep();
    expect(s.activeStep).toBeUndefined();
    expect(s.draftInfo).toBe(empty);
  });

  /** Propõe uma etapa só com estas ops e devolve o draftInfo dela. */
  const proposeStep = (s: EditorSession, ops: Op[]) => {
    expect(s.propose({ requestId: 'faixa', baseRevision: s.project.revision, title: 'Corte', steps: [{ label: 'Corte', ops }] }).ok).toBe(true);
    return s.draftInfo;
  };
  /** A faixa do rascunho em ordem de início (e de id, no empate). */
  const sorted = (range: DraftInfo['range']) => [...range].sort((a, b) => a.start - b.start || (a.clipId < b.clipId ? -1 : 1));

  it('corte no fim, sem emenda: a faixa do rascunho marca o vídeo e o título que encurtaram', () => {
    const d = proposeStep(setup(), [{ op: 'removeRanges', ranges: [[5, 6]] }]);
    expect(d.seams).toEqual([]);
    expect(d.ripple).toBe(false);
    expect(sorted(d.range)).toEqual(sorted([{ clipId: 'v1', start: 0, end: 5 }, { clipId: 't1', start: 0, end: 5 }]));
  });

  it('corte no começo, sem emenda: a faixa marca o pedaço que ficou e o título', () => {
    const s = setup();
    const d = proposeStep(s, [{ op: 'removeRanges', ranges: [[0, 1]] }]);
    expect(d.seams).toEqual([]);
    expect(d.ripple).toBe(true);
    const vids = s.view.clips.filter((c) => c.kind === 'video');
    expect(vids).toHaveLength(1);
    expect(sorted(d.range)).toEqual(sorted([{ clipId: vids[0].id, start: 0, end: 5 }, { clipId: 't1', start: 0, end: 5 }]));
  });

  it('corte no meio do vídeo: a emenda marca o lugar e nada vai para a faixa', () => {
    expect(proposeStep(setup(), [{ op: 'removeRanges', ranges: [[3, 3.5]] }]).range).toEqual([]);
  });

  it('corte num trecho só de título: sem emenda, a faixa marca o título', () => {
    const s = new EditorSession();
    s.dispatch([
      { op: 'addMedia', media: { id: 'm1', path: 'C:/v/clip.mp4', name: 'clip.mp4', duration: 10, width: 1280, height: 720, hasAudio: true } },
      { op: 'addClip', clip: { kind: 'video', id: 'v1', mediaId: 'm1', start: 3, duration: 6 } },
      { op: 'addClip', clip: { kind: 'title', id: 't1', text: 'ABERTURA', start: 0, duration: 3 } },
    ]);
    const d = proposeStep(s, [{ op: 'removeRanges', ranges: [[1, 2]] }]);
    expect(d.seams).toEqual([]);
    expect(d.ripple).toBe(true);
    expect(d.range).toEqual([{ clipId: 't1', start: 0, end: 2 }]);
  });

  it('dividir sem cortar: a faixa marca os dois pedaços', () => {
    const s = setup();
    const d = proposeStep(s, [{ op: 'splitClip', clipId: 'v1', at: 3 }]);
    expect(d.seams).toEqual([]);
    const piece = s.view.clips.find((c) => c.kind === 'video' && c.id !== 'v1')!;
    expect(sorted(d.range)).toEqual([{ clipId: 'v1', start: 0, end: 3 }, { clipId: piece.id, start: 3, end: 6 }]);
  });

  it('corte com emenda e divisão na mesma etapa: só a divisão sem emenda vai para a faixa', () => {
    const s = setup();
    const d = proposeStep(s, [{ op: 'removeRanges', ranges: [[4, 4.5]] }, { op: 'splitClip', clipId: 'v1', at: 1 }]);
    expect(d.seams).toEqual([{ at: 4, removed: 0.5 }]);
    const piece = s.view.clips.find((c) => c.kind === 'video' && c.start === 1)!;
    expect(sorted(d.range)).toEqual([{ clipId: 'v1', start: 0, end: 1 }, { clipId: piece.id, start: 1, end: 4 }]);
  });
});

const media = (duration: number) => ({ id: 'm1', path: 'C:/v/a.mp4', name: 'a.mp4', duration, width: 1280, height: 720, hasAudio: true });

/** Sessão com o projeto gravado em C:/p/a.diretor (sem mudanças): v1 de 60 s e os clipes a mais. */
function sixty(extra: NewClipSpec[] = []): EditorSession {
  const s = new EditorSession();
  const ops: Op[] = [{ op: 'addMedia', media: media(60) }, { op: 'addClip', clip: { kind: 'video', id: 'v1', mediaId: 'm1' } }];
  for (const clip of extra) ops.push({ op: 'addClip', clip });
  s.load(applyOps(createProject(), ops).project, 'C:/p/a.diretor');
  return s;
}

/** Propõe uma etapa só, de corte, com estes trechos. */
function proposeCut(s: EditorSession, ranges: TimeRange[], label = 'Corte') {
  const r = s.propose({ baseRevision: s.project.revision, title: label, steps: [{ label, ops: [{ op: 'removeRanges', ranges }] }] });
  if (!r.ok) throw new Error(r.message);
  return r.proposal;
}

describe('ajustes seus no rascunho do Claude', () => {
  /** v1 de 60 s, legendas c0 [1, 2) "começo" e c9 [40, 42) "fim"; o Claude propõe cortar [10, 13]. */
  const fixture = () => {
    const s = sixty([
      { kind: 'caption', id: 'c0', text: 'começo', start: 1, duration: 1 },
      { kind: 'caption', id: 'c9', text: 'fim', start: 40, duration: 2 },
    ]);
    proposeCut(s, [[10, 13]]);
    return s;
  };
  /** Um corte seu de 0,4 s em 30 s do rascunho. */
  const cut = (s: EditorSession) => s.dispatch([{ op: 'removeRanges', ranges: [[30, 30.4]] }]);
  const textOf = (p: Project, id: string) => (findClip(p, id) as CaptionClip).text;

  it('um corte seu vai para o rascunho e conta como ajuste', () => {
    const s = fixture();
    expect(cut(s)).toEqual({ ok: true, target: 'draft' });
    expect(s.draftEdits).toBe(1);
    expect(s.dirty).toBe(false);
    s.undo();
    expect(s.draftEdits).toBe(0);
    s.redo();
    expect(s.draftEdits).toBe(1);
  });

  it('clicar em outro clipe não desatualiza um rascunho com ajustes', () => {
    const s = fixture();
    cut(s);
    s.setSelection({ clipIds: ['c0'] });
    expect(s.openProposal?.status).toBe('active');
    expect(projectDuration(s.view)).toBeCloseTo(56.6, 6);
  });

  it('mudança que vai para o projeto pergunta antes de perder os ajustes', () => {
    const s = fixture();
    cut(s);
    const edit: Op[] = [{ op: 'updateClip', clipId: 'c0', set: { text: 'x' } }];
    expect(s.dispatch(edit, undefined, () => false)).toEqual({ ok: false, message: '' });
    expect(s.openProposal?.status).toBe('active');
    expect(textOf(s.project, 'c0')).toBe('começo');
    expect(s.dispatch(edit, undefined, () => true)).toEqual({ ok: true, target: 'project' });
    expect(s.openProposal?.status).toBe('stale');
  });

  it('sem ajustes, não pergunta', () => {
    const s = fixture();
    const ask = () => {
      throw new Error('não devia perguntar');
    };
    expect(s.dispatch([{ op: 'updateClip', clipId: 'c0', set: { text: 'x' } }], undefined, ask)).toEqual({ ok: true, target: 'project' });
  });

  it('o Claude não substitui um rascunho com ajustes', () => {
    const s = fixture();
    cut(s);
    const open = s.openProposal!;
    const r = s.propose({ baseRevision: s.project.revision, title: 'Outro corte', replaces: open.id, steps: [{ label: 'Corte', ops: [{ op: 'removeRanges', ranges: [[20, 21]] }] }] });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('proposal_pending');
    expect(r.ok === false && r.message).toMatch(/aceitar ou descartar/);
    expect(r.ok === false && r.message).not.toMatch(/appendTo/);
    expect(s.openProposal?.id).toBe(open.id);
    expect(s.draftEdits).toBe(1);
  });
});

describe('rota com rascunho que não corta', () => {
  /** Vídeos [id, início, duração, in] de uma mídia de 60 s e o título T em [t0, t1); o Claude propõe a entrada de T. */
  const fixture = (vids: [string, number, number, number][], [t0, t1]: [number, number]) => {
    const ops: Op[] = [{ op: 'addMedia', media: media(60) }];
    for (const [id, start, duration, inn] of vids) ops.push({ op: 'addClip', clip: { kind: 'video', id, mediaId: 'm1', start, duration, in: inn } });
    ops.push({ op: 'addClip', clip: { kind: 'title', id: 'T', text: 'TÍTULO', start: t0, duration: t1 - t0 } });
    const s = new EditorSession();
    s.load(applyOps(createProject(), ops).project, null);
    const r = s.propose({ baseRevision: s.project.revision, title: 'Entrada', steps: [{ label: 'Entrada', ops: [{ op: 'animate', clipId: 'T', preset: 'fadeIn' }] }] });
    if (!r.ok) throw new Error(r.message);
    return s;
  };

  it('um corte antes do título vai para o projeto', () => {
    const s = fixture([['v1', 0, 60, 0]], [30, 33]);
    expect(s.dispatch([{ op: 'removeRanges', ranges: [[5, 6]] }])).toEqual({ ok: true, target: 'project' });
    expect(s.openProposal?.status).toBe('stale');
    expect(projectDuration(s.project)).toBe(59);
    expect(findClip(s.project, 'T')!.start).toBe(29);
    expect(s.past.at(-1)!.label).toBe('Apagar trecho');
    expect(s.discardStep()).toBe(true);
    expect(projectDuration(s.project)).toBe(59);
  });

  it('aparar o fim de v1 que só empurra o título vai para o projeto', () => {
    const s = fixture([['v1', 0, 30, 0], ['v2', 30, 30, 30]], [40, 43]);
    expect(s.dispatch([{ op: 'trimClip', clipId: 'v1', edge: 'end', delta: -1 }])).toEqual({ ok: true, target: 'project' });
  });

  it('um corte que atravessa o título vai para o rascunho', () => {
    const s = fixture([['v1', 0, 60, 0]], [30, 33]);
    expect(s.dispatch([{ op: 'removeRanges', ranges: [[31, 32]] }])).toEqual({ ok: true, target: 'draft' });
  });
});

describe('etapas de corte seguidas', () => {
  /** Mídia de 20 s, v1 [0, 20) e a legenda "alvo" em [7, 8). */
  const fixture = () => {
    const s = new EditorSession();
    s.load(
      applyOps(createProject(), [
        { op: 'addMedia', media: media(20) },
        { op: 'addClip', clip: { kind: 'video', id: 'v1', mediaId: 'm1' } },
        { op: 'addClip', clip: { kind: 'caption', id: 'alvo', text: 'alvo', start: 7, duration: 1 } },
      ]).project,
      null,
    );
    return s;
  };
  const cutStep = (label: string, ranges: TimeRange[]) => ({ label, ops: [{ op: 'removeRanges' as const, ranges }] });
  /** Duas etapas: tira [2, 3] e depois [6, 7] (que é onde a legenda "alvo" fica depois da primeira). */
  const proposeTwo = (s: EditorSession, second: { label: string; ops: Op[] } = cutStep('Segundo', [[6, 7]])) => {
    const r = s.propose({ baseRevision: s.project.revision, title: 'Cortes', steps: [cutStep('Primeiro', [[2, 3]]), second] });
    if (!r.ok) throw new Error(r.message);
    return r.proposal;
  };
  /** Vídeos como [início, duração, in], em ordem. */
  const vids = (p: Project) =>
    p.clips
      .filter((c): c is VideoClip => c.kind === 'video')
      .sort((a, b) => a.start - b.start)
      .map((c) => [c.start, c.duration, c.in]);

  it('aceitar as duas etapas tira a fala certa', () => {
    const s = fixture();
    proposeTwo(s);
    expect(s.acceptStep()).toBe(true);
    expect(s.acceptStep()).toBe(true);
    expect(vids(s.project)).toEqual([[0, 2, 0], [2, 4, 3], [6, 12, 8]]);
    expect(findClip(s.project, 'alvo')).toBeUndefined();
    expect(projectDuration(s.project)).toBe(18);
  });

  it('descartar a primeira desatualiza a segunda', () => {
    const s = fixture();
    const p = proposeTwo(s);
    s.discardStep();
    expect(p.status).toBe('stale');
    expect(p.staleReason).toMatch(/etapa anterior/);
    expect(vids(s.project)).toEqual([[0, 20, 0]]);
    expect(findClip(s.project, 'alvo')!.start).toBe(7);
  });

  it('um corte seu na primeira desatualiza a segunda', () => {
    const s = fixture();
    const p = proposeTwo(s);
    expect(s.dispatch([{ op: 'removeRanges', ranges: [[0.5, 1]] }])).toEqual({ ok: true, target: 'draft' });
    expect(s.acceptStep()).toBe(true);
    expect(p.status).toBe('stale');
    expect(findClip(s.project, 'alvo')).toBeDefined();
  });

  it('etapa sem tempo da linha do tempo segue depois de um descarte', () => {
    const s = fixture();
    const p = proposeTwo(s, { label: 'Texto', ops: [{ op: 'updateClip', clipId: 'alvo', set: { text: 'novo' } }] });
    s.discardStep();
    expect(p.status).toBe('active');
    expect(s.activeStep?.label).toBe('Texto');
  });

  it('o Claude não acrescenta etapas a um rascunho com ajustes seus', () => {
    const s = fixture();
    const first = s.propose({ baseRevision: s.project.revision, title: 'Cortes', steps: [cutStep('Primeiro', [[2, 3]])] });
    if (!first.ok) throw new Error(first.message);
    expect(s.dispatch([{ op: 'removeRanges', ranges: [[0.5, 1]] }])).toEqual({ ok: true, target: 'draft' });
    // O Claude não vê o seu corte: a legenda que ele acha em 6 está em 5,5 no rascunho.
    const more = s.propose({ baseRevision: s.project.revision, title: 'Cortes', appendTo: first.proposal.id, steps: [cutStep('Segundo', [[6, 7]])] });
    expect(more.ok).toBe(false);
    expect(more.ok === false && more.code).toBe('proposal_pending');
    expect(more.ok === false && more.message).toMatch(/aceitar ou descartar/);
    expect(first.proposal.steps).toHaveLength(1);
    // Sem o ajuste (Ctrl+Z), o Claude volta a poder acrescentar.
    s.undo();
    expect(s.draftEdits).toBe(0);
    expect(s.propose({ baseRevision: s.project.revision, title: 'Cortes', appendTo: first.proposal.id, steps: [cutStep('Segundo', [[6, 7]])] }).ok).toBe(true);
  });

  it('depois de aceitar um rascunho com ajustes seus, acrescentar pede o contexto novo', () => {
    const s = fixture();
    const old = s.project.revision;
    const first = s.propose({ baseRevision: old, title: 'Cortes', steps: [cutStep('Primeiro', [[2, 3]])] });
    if (!first.ok) throw new Error(first.message);
    s.dispatch([{ op: 'removeRanges', ranges: [[0.5, 1]] }]);
    expect(s.acceptStep()).toBe(true);
    expect(first.proposal.status).toBe('done');
    // Com a revisão de antes, o Claude ainda acha a legenda em 6.
    const stale = s.propose({ baseRevision: old, title: 'Cortes', appendTo: first.proposal.id, steps: [cutStep('Segundo', [[6, 7]])] });
    expect(stale.ok === false && stale.code).toBe('stale_revision');
    expect(stale.ok === false && stale.message).toMatch(/ajustes feitos à mão/);
    // Com o contexto novo, a legenda está em 5,5.
    expect(findClip(s.project, 'alvo')!.start).toBe(5.5);
    const fresh = s.propose({ baseRevision: s.project.revision, title: 'Cortes', appendTo: first.proposal.id, steps: [cutStep('Segundo', [[5.5, 6.5]])] });
    expect(fresh.ok).toBe(true);
    expect(s.acceptStep()).toBe(true);
    expect(findClip(s.project, 'alvo')).toBeUndefined();
    expect(projectDuration(s.project)).toBe(17.5);
  });

  it('uma divisão sua na primeira não desatualiza a segunda', () => {
    const s = fixture();
    const p = proposeTwo(s);
    const piece = s.view.clips.find((c) => c.kind === 'video' && c.start <= 12 && 12 < c.start + c.duration)!;
    expect(s.dispatch([{ op: 'splitClip', clipId: piece.id, at: 12 }])).toEqual({ ok: true, target: 'draft' });
    expect(s.acceptStep()).toBe(true);
    expect(p.status).toBe('active');
    expect(s.activeStep?.label).toBe('Segundo');
    expect(s.acceptStep()).toBe(true);
    expect(findClip(s.project, 'alvo')).toBeUndefined();
    expect(vids(s.project)).toEqual([[0, 2, 0], [2, 4, 3], [6, 5, 8], [11, 7, 13]]);
  });

  it('com o mesmo vídeo sobreposto, uma divisão sua também não desatualiza', () => {
    // Um trecho do mesmo vídeo por cima (5 a 8 s, do segundo 10 do arquivo) e uma cópia inteira por baixo.
    const extra: NewClipSpec[] = [
      { kind: 'video', id: 'ov', mediaId: 'm1', start: 5, duration: 3, in: 10 },
      { kind: 'video', id: 'v2', mediaId: 'm1' },
    ];
    // Por cima, só o pedaço comprido passa pelos 10 s; com a cópia inteira, os dois passam.
    for (const [layout, expected] of [[[extra[0]], 1], [[extra[1]], 2]] as const) {
      const pieces = (() => {
        const t = fixture();
        t.load(applyOps(t.project, layout.map((clip) => ({ op: 'addClip' as const, clip }))).project, null);
        proposeTwo(t, cutStep('Segundo', [[15, 16]]));
        return t.view.clips.filter((c) => c.kind === 'video' && c.start < 10 && 10 < c.start + c.duration).length;
      })();
      expect(pieces).toBe(expected);
      // Divide cada pedaço que passa pelos 10 s, um de cada vez, numa sessão nova.
      for (let k = 0; k < pieces; k++) {
        const s = fixture();
        s.load(applyOps(s.project, layout.map((clip) => ({ op: 'addClip' as const, clip }))).project, null);
        const p = proposeTwo(s, cutStep('Segundo', [[15, 16]]));
        const piece = s.view.clips.filter((c) => c.kind === 'video' && c.start < 10 && 10 < c.start + c.duration)[k];
        expect(s.dispatch([{ op: 'splitClip', clipId: piece.id, at: 10 }])).toEqual({ ok: true, target: 'draft' });
        expect(s.acceptStep()).toBe(true);
        expect(p.status).toBe('active');
        expect(s.activeStep?.label).toBe('Segundo');
      }
    }
    // Um corte seu de verdade ainda desatualiza, com o mesmo vídeo sobreposto.
    const s = fixture();
    s.load(applyOps(s.project, extra.map((clip) => ({ op: 'addClip' as const, clip }))).project, null);
    const p = proposeTwo(s, cutStep('Segundo', [[15, 16]]));
    expect(s.dispatch([{ op: 'removeRanges', ranges: [[0.5, 1]] }])).toEqual({ ok: true, target: 'draft' });
    expect(s.acceptStep()).toBe(true);
    expect(p.status).toBe('stale');
  });

  it('num projeto antigo com início fora do milissegundo, uma divisão sua também não desatualiza', () => {
    // Arquivos antigos guardam inícios no passo de 1/30 do campo "Início" (0,0666…), e abrem como estão.
    const old = applyOps(createProject(), [
      { op: 'addMedia', media: media(20) },
      { op: 'addClip', clip: { kind: 'video', id: 'v1', mediaId: 'm1' } },
      { op: 'addClip', clip: { kind: 'caption', id: 'alvo', text: 'alvo', start: 7, duration: 1 } },
    ]).project;
    const v1 = old.clips.find((c) => c.id === 'v1')!;
    v1.start = 2 / 30;
    v1.duration = 20 - 2 / 30;
    const s = new EditorSession();
    s.load(old, null);
    const p = proposeTwo(s, cutStep('Segundo', [[15, 16]]));
    const piece = s.view.clips.find((c) => c.kind === 'video' && c.start < 1 && 1 < c.start + c.duration)!;
    expect(s.dispatch([{ op: 'splitClip', clipId: piece.id, at: 1 }])).toEqual({ ok: true, target: 'draft' });
    expect(s.acceptStep()).toBe(true);
    expect(p.status).toBe('active');
    expect(s.activeStep?.label).toBe('Segundo');
  });

  it('num projeto antigo com início e duração fora do milissegundo, uma divisão sua também não desatualiza', () => {
    // Antes, a duração que o Claude mandava também ficava como veio (19,9666…).
    const old = applyOps(createProject(), [
      { op: 'addMedia', media: media(20) },
      { op: 'addClip', clip: { kind: 'video', id: 'v1', mediaId: 'm1' } },
      { op: 'addClip', clip: { kind: 'caption', id: 'alvo', text: 'alvo', start: 7, duration: 1 } },
    ]).project;
    const v1 = old.clips.find((c) => c.id === 'v1')!;
    v1.start = 2 / 30;
    v1.duration = 20 - 1 / 30;
    const s = new EditorSession();
    s.load(old, null);
    // A primeira etapa mexe no v1 inteiro, então a divisão dele vai para o rascunho dela.
    const q = s.propose({
      baseRevision: s.project.revision,
      title: 'Entrada e corte',
      steps: [{ label: 'Entrada', ops: [{ op: 'animate', clipId: 'v1', preset: 'fadeIn' }] }, cutStep('Segundo', [[15, 16]])],
    });
    if (!q.ok) throw new Error(q.message);
    expect(s.dispatch([{ op: 'splitClip', clipId: 'v1', at: 10 }])).toEqual({ ok: true, target: 'draft' });
    expect(s.acceptStep()).toBe(true);
    expect(q.proposal.status).toBe('active');
    expect(s.activeStep?.label).toBe('Segundo');
  });

  it('o Claude não acrescenta nem uma etapa que não corta a um rascunho com ajustes seus', () => {
    const s = fixture();
    const first = s.propose({ baseRevision: s.project.revision, title: 'Cortes', steps: [cutStep('Primeiro', [[2, 3]])] });
    if (!first.ok) throw new Error(first.message);
    s.dispatch([{ op: 'removeRanges', ranges: [[0.5, 1]] }]);
    const more = s.propose({
      baseRevision: s.project.revision,
      title: 'Cortes',
      appendTo: first.proposal.id,
      steps: [{ label: 'Texto', ops: [{ op: 'updateClip', clipId: 'alvo', set: { text: 'novo' } }] }],
    });
    expect(more.ok === false && more.code).toBe('proposal_pending');
    expect(first.proposal.steps).toHaveLength(1);
  });

  it('uma proposta nova, com um rascunho ajustado por você aberto, espera a sua decisão', () => {
    const s = fixture();
    const first = s.propose({ baseRevision: s.project.revision, title: 'Cortes', steps: [cutStep('Primeiro', [[2, 3]])] });
    if (!first.ok) throw new Error(first.message);
    const before = s.propose({ baseRevision: s.project.revision, title: 'Outra', steps: [cutStep('Outro', [[6, 7]])] });
    expect(before.ok === false && before.message).toMatch(/use replaces/);
    s.dispatch([{ op: 'removeRanges', ranges: [[0.5, 1]] }]);
    const after = s.propose({ baseRevision: s.project.revision, title: 'Outra', steps: [cutStep('Outro', [[6, 7]])] });
    expect(after.ok === false && after.code).toBe('proposal_pending');
    expect(after.ok === false && after.message).toMatch(/aceitar ou descartar/);
    expect(after.ok === false && after.message).not.toMatch(/use replaces/);
  });

  it('uma legenda posta pelo tempo depois de um corte seu fica desatualizada', () => {
    const nova = { label: 'Legenda', ops: [{ op: 'addClip' as const, clip: { kind: 'caption' as const, id: 'nova', text: 'nova', start: 6, duration: 1 } }] };
    // Sem ajuste seu, a legenda entra onde o Claude calculou.
    const ok = fixture();
    proposeTwo(ok, nova);
    expect(ok.acceptStep()).toBe(true);
    expect(ok.acceptStep()).toBe(true);
    expect(findClip(ok.project, 'nova')!.start).toBe(6);
    // Com o seu corte, o 6 já é outro ponto da fala: a etapa fica desatualizada.
    const s = fixture();
    const p = proposeTwo(s, nova);
    s.dispatch([{ op: 'removeRanges', ranges: [[0.5, 1]] }]);
    expect(s.acceptStep()).toBe(true);
    expect(p.status).toBe('stale');
    expect(p.staleReason).toMatch(/etapa anterior/);
    expect(findClip(s.project, 'nova')).toBeUndefined();
  });

  it('mover um clipe para um tempo depois de um descarte fica desatualizado', () => {
    const s = fixture();
    const p = proposeTwo(s, { label: 'Mover', ops: [{ op: 'updateClip', clipId: 'alvo', set: { start: 9 } }] });
    s.discardStep();
    expect(p.status).toBe('stale');
    expect(findClip(s.project, 'alvo')!.start).toBe(7);
  });

  it('get_proposal pede o contexto novo depois de aceitar uma etapa com ajustes seus', async () => {
    const plain = fixture();
    const a = plain.propose({ baseRevision: plain.project.revision, title: 'Cortes', steps: [cutStep('Primeiro', [[2, 3]])] });
    if (!a.ok) throw new Error(a.message);
    expect(plain.acceptStep()).toBe(true);
    expect(((await handleBridge(plain, 'get_proposal', { proposalId: a.proposal.id })) as { next: string }).next).toBe('Nada pendente.');
    const s = fixture();
    const first = s.propose({ baseRevision: s.project.revision, title: 'Cortes', steps: [cutStep('Primeiro', [[2, 3]])] });
    if (!first.ok) throw new Error(first.message);
    s.dispatch([{ op: 'removeRanges', ranges: [[0.5, 1]] }]);
    expect(s.acceptStep()).toBe(true);
    const out = (await handleBridge(s, 'get_proposal', { proposalId: first.proposal.id })) as { next: string };
    expect(out.next).toMatch(/^Nada pendente\./);
    expect(out.next).toMatch(/ajustes feitos à mão/);
    expect(out.next).toContain(`revisão ${s.project.revision}`);
    expect(out.next).toMatch(/get_context/);
  });

  it('appendTo com os tempos do rascunho segue normal', () => {
    const s = fixture();
    const first = s.propose({ baseRevision: s.project.revision, title: 'Cortes', steps: [cutStep('Primeiro', [[2, 3]])] });
    if (!first.ok) throw new Error(first.message);
    const more = s.propose({ baseRevision: s.project.revision, title: 'Cortes', appendTo: first.proposal.id, steps: [cutStep('Segundo', [[6, 7]])] });
    expect(more.ok).toBe(true);
    expect(s.acceptStep()).toBe(true);
    expect(s.activeStep?.label).toBe('Segundo');
    expect(s.acceptStep()).toBe(true);
    expect(findClip(s.project, 'alvo')).toBeUndefined();
  });

  it('get_context avisa a base de tempo', async () => {
    const s = fixture();
    proposeTwo(s);
    const cut = (await handleBridge(s, 'get_context', {})) as { pendingProposal: { timeBase?: unknown } };
    expect(typeof cut.pendingProposal.timeBase).toBe('string');
    const t = setup();
    t.propose(entradaSaida(t.project.revision));
    const anim = (await handleBridge(t, 'get_context', {})) as { pendingProposal: { timeBase?: unknown } };
    expect(anim.pendingProposal.timeBase).toBeUndefined();
  });
});

describe('avisos do corte e seleção do rascunho', () => {
  it('aviso de faixa travada sem jargão', () => {
    const s = sixty([{ kind: 'caption', id: 'c1', text: 'fala', start: 30, duration: 2 }]);
    expect(s.dispatch([{ op: 'updateTrack', trackId: 'trk_captions', set: { locked: true } }]).ok).toBe(true);
    const r = s.dispatch([{ op: 'removeRanges', ranges: [[30.5, 31]] }]);
    expect(r.ok === false && r.message).toBe('A faixa "Legendas" está travada e mudaria junto com o corte. Destrave a faixa para continuar.');
  });

  it('com rascunho que corta, trecho fora da view não vai para o projeto', () => {
    const s = sixty();
    proposeCut(s, [[10, 20]]);
    expect(s.dispatch([{ op: 'removeRanges', ranges: [[52, 55]] }])).toEqual({ ok: false, message: 'Nada para apagar nesses trechos.' });
    expect(s.openProposal?.status).toBe('active');
    expect(projectDuration(s.project)).toBe(60);
  });

  it('o rascunho do Claude não seleciona um clipe que ele mesmo tirou', () => {
    const cases: [[string, number, number, number][], TimeRange][] = [
      [[['v1', 0, 10, 0]], [0, 2]],
      [[['v1', 0, 10, 0], ['v2', 10, 10, 10]], [10, 20]],
    ];
    for (const [list, range] of cases) {
      const s = new EditorSession(videos(list));
      expect(s.selection.clipIds).toEqual([]);
      proposeCut(s, [range]);
      expect(s.selection.clipIds.every((id) => !!findClip(s.view, id))).toBe(true);
    }
  });
});
