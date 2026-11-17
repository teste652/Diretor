import { useEffect, useRef, useState } from 'react';
import { createProject, parseProject } from '../core/model';
import { connectBridge } from './bridgeClient';
import { ChatPanel } from './ChatPanel';
import { exportProject } from './exporter';
import { LeftPanel, importPaths } from './MediaPanel';
import { Preview, togglePlay } from './Preview';
import { playback, session, useSession } from './store';
import { addCaptionAtPlayhead, deleteSelection, Timeline } from './Timeline';
import { Icon, TextField, ToastHost, run, showToast } from './ui';

export async function saveProject(saveAs = false, path?: string): Promise<string | null> {
  const api = window.diretor;
  if (!api) return null;
  const file = await api.saveProject(session.project, path ?? (saveAs ? undefined : (session.filePath ?? undefined)));
  if (file) {
    session.markSaved(file);
    showToast('Projeto salvo.');
  }
  return file;
}

export async function openProject(path?: string): Promise<boolean> {
  const r = await window.diretor?.openProject(path);
  if (!r) return false;
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
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') (e.preventDefault(), togglePlay());
      else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) (e.preventDefault(), session.undo());
      else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) (e.preventDefault(), session.redo());
      else if (mod && e.key.toLowerCase() === 's') (e.preventDefault(), void saveProject(e.shiftKey));
      else if (mod && e.key.toLowerCase() === 'o') (e.preventDefault(), void openProject());
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
      else if (e.key === 'ArrowRight') playback.seek(playback.get().time + 1 / session.view.settings.fps);
      else if (e.key === 'ArrowLeft') playback.seek(playback.get().time - 1 / session.view.settings.fps);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

// Ganchos para o teste de ponta a ponta (scripts/e2e.mjs).
window.__diretor = { session, playback, importPaths, exportProject, saveProject, openProject, addCaptionAtPlayhead };
