import { useEffect, useRef, useState } from 'react';
import { createProject, parseProject } from '../core/model';
import { connectBridge } from './bridgeClient';
import { ChatPanel } from './ChatPanel';
import { cancelExport, exportProject } from './exporter';
import { LeftPanel, importPaths } from './MediaPanel';
import { Preview, previewSettled, togglePlay } from './Preview';
import { playback, session, useSession } from './store';
import { addCaptionAtPlayhead, deleteSelection, Timeline } from './Timeline';
import type { Op } from '../core/operations';
import { Icon, TextField, ToastHost, run, showToast } from './ui';

export async function saveProject(saveAs = false, path?: string): Promise<string | null> {
  const api = window.diretor;
  if (!api) return null;
  const r = await api.saveProject(session.project, path ?? (saveAs ? undefined : (session.filePath ?? undefined)));
  if (!r) return null;
  if ('error' in r) {
    showToast(r.error, true);
    return null;
  }
  session.markSaved(r.path);
  showToast('Projeto salvo.');
  return r.path;
}

export async function openProject(path?: string): Promise<boolean> {
  if (session.dirty && !confirm('O projeto atual tem mudanças não salvas. Abrir outro e descartar essas mudanças?')) return false;
  const r = await window.diretor?.openProject(path);
  if (!r) return false;
  if ('error' in r) {
    showToast(r.error, true);
    return false;
  }
  try {
    session.load(parseProject(r.json), r.path);
    playback.set({ playing: false });
    playback.seek(0);
    return true;
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e), true);
    return false;
  }
}

function newProject() {
  if (session.dirty && !confirm('Descartar as mudanças não salvas?')) return;
  session.load(createProject(), null);
  playback.seek(0);
}

type ExportState = { frame: number; total: number; done?: string; error?: string } | null;

export function App() {
  const s = useSession();
  const [tab, setTab] = useState<'media' | 'props'>('media');
  const [exp, setExp] = useState<ExportState>(null);
  const cancel = useRef({ cancelled: false });

  useEffect(() => connectBridge(), []);

  // Seleção ou "ajustar" levam ao painel de propriedades.
  const selKey = s.selection.clipIds.join(',');
  useEffect(() => {
    if (selKey) setTab('props');
  }, [selKey]);
  useEffect(() => {
    if (s.adjustMode) setTab('props');
  }, [s.adjustMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // Salvar e abrir valem até dentro de um campo: o campo é confirmado antes (blur).
      if (mod && (key === 's' || key === 'o')) {
        e.preventDefault();
        if (el instanceof HTMLElement && el !== document.body) el.blur();
        setTimeout(() => void (key === 's' ? saveProject(e.shiftKey) : openProject()), 0);
        return;
      }
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
      if (e.code === 'Space') (e.preventDefault(), togglePlay());
      else if (mod && key === 'z' && !e.shiftKey) (e.preventDefault(), session.undo());
      else if (mod && (key === 'y' || (e.shiftKey && key === 'z'))) (e.preventDefault(), session.redo());
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelectedKeyframeOrClip();
      else if (e.key === 'ArrowRight') playback.seek(playback.get().time + 1 / session.view.settings.fps);
      else if (e.key === 'ArrowLeft') playback.seek(playback.get().time - 1 / session.view.settings.fps);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Fechar/recarregar com mudanças não salvas: o processo principal pergunta antes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!session.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Avisos curtos da sessão (ex.: Ctrl+Z com rascunho aberto).
  useEffect(() => {
    if (s.hint) showToast(s.hint.text);
  }, [s.hint?.at]);

  const doExport = async () => {
    if (s.openProposal?.status === 'active' && !confirm('Há um rascunho pendente. A exportação usa só o que já foi aceito. Continuar?')) return;
    cancel.current = { cancelled: false };
    setExp({ frame: 0, total: 1 });
    const r = await exportProject(session.project, { onProgress: (p) => setExp({ ...p }), signal: cancel.current });
    if (r.cancelled) return setExp(null);
    setExp((e) => ({ ...(e ?? { frame: 0, total: 1 }), done: r.ok ? r.outPath : undefined, error: r.ok ? undefined : r.error }));
  };

  return (
    <div className="app">
      <div className="titlebar">
        <span className="brand">Diretor</span>
        <span className="sep" />
        <span style={{ color: 'var(--muted)' }}>{Icon.folder}</span>
        <div className="nodrag" style={{ width: 240 }}>
          <TextField value={s.project.name} onCommit={(v) => v.trim() && run([{ op: 'renameProject', name: v }], 'Renomear projeto')} />
        </div>
        <button className="btn ghost" onClick={newProject}>
          Novo
        </button>
        <button className="btn ghost" onClick={() => void openProject()}>
          Abrir
        </button>
        <button className="btn ghost" onClick={() => void saveProject()}>
          Salvar
        </button>
        <span className="dirty">{s.dirty ? 'não salvo' : s.filePath ? 'salvo' : ''}</span>
        <span className="spacer" />
        <button className="btn primary" onClick={doExport} disabled={!s.project.clips.length}>
          {Icon.export} Exportar
        </button>
      </div>

      <div className="main">
        <LeftPanel tab={tab} setTab={setTab} />
        <Preview />
        <ChatPanel />
      </div>

      <Timeline />
      <ToastHost />

      {exp && (
        <div className="modal-bg">
          <div className="modal">
            <h3 style={{ marginTop: 0 }}>{exp.done ? 'Exportação concluída' : exp.error ? 'Falha na exportação' : 'Exportando MP4…'}</h3>
            {!exp.done && !exp.error && (
              <>
                <div className="progress">
                  <div style={{ width: `${(exp.frame / exp.total) * 100}%` }} />
                </div>
                <p className="hint">
                  Quadro {exp.frame} de {exp.total}. Tudo é processado no seu computador.
                </p>
                <button
                  className="btn"
                  onClick={() => {
                    cancel.current.cancelled = true;
                    void cancelExport();
                  }}
                >
                  Cancelar
                </button>
              </>
            )}
            {exp.done && (
              <>
                <p className="hint" style={{ wordBreak: 'break-all' }}>{exp.done}</p>
                <div className="row">
                  <button className="btn primary" onClick={() => window.diretor?.showItem(exp.done!)}>
                    Mostrar na pasta
                  </button>
                  <button className="btn" onClick={() => setExp(null)}>
                    Fechar
                  </button>
                </div>
              </>
            )}
            {exp.error && (
              <>
                <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--danger)', fontSize: 12 }}>{exp.error}</pre>
                <button className="btn" onClick={() => setExp(null)}>
                  Fechar
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Delete: com um ponto de animação selecionado, apaga os pontos daquele instante; senão, o clipe. */
function deleteSelectedKeyframeOrClip() {
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

// Ganchos para o teste de ponta a ponta (scripts/e2e.mjs).
window.__diretor = { session, playback, importPaths, exportProject, cancelExport, saveProject, openProject, addCaptionAtPlayhead, previewSettled };
