import { useEffect, useRef, useState } from 'react';
import { createProject, parseProject } from '../core/model';
import { connectBridge } from './bridgeClient';
import { ChatPanel } from './ChatPanel';
import { cancelExport, exportProject, isExporting } from './exporter';
import { LeftPanel, importPaths } from './MediaPanel';
import { Preview, previewSettled, togglePlay } from './Preview';
import { marks, playback, session, setCompare, useSession } from './store';
import { addCaptionAtPlayhead, deleteMarkedRange, deleteSelectedKeyframeOrClip, splitAtPlayhead, Timeline } from './Timeline';
import { isTextEntry, withIn, withOut } from './timelineLogic';
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
  showToast(session.draftEdits > 0 ? 'Projeto salvo. Seus ajustes no rascunho do Claude só entram no projeto quando você aceitar o rascunho.' : 'Projeto salvo.');
  return r.path;
}

export async function openProject(path?: string): Promise<boolean> {
  if ((session.dirty || session.draftEdits) && !confirm('O projeto atual tem mudanças não salvas. Abrir outro e descartar essas mudanças?')) return false;
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
  if ((session.dirty || session.draftEdits) && !confirm('Descartar as mudanças não salvas?')) return;
  session.load(createProject(), null);
  playback.seek(0);
}

type ExportState = { frame: number; total: number; slowAudio?: boolean; done?: string; warning?: string; error?: string } | null;

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
    let dictatePending = false;
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
      // Ctrl+D: falar com a IA (vale em qualquer lugar, até com o cursor num campo). O ditado abre
      // quando o Ctrl é solto: com ele apertado, o Windows recebe Ctrl+Windows+H, que não abre nada.
      if (mod && key === 'd' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (!e.repeat) dictatePending = true;
        return;
      }
      // Num campo de texto as teclas são do texto; um controle deslizante em foco (zoom, volume) não segura os atalhos.
      if (isTextEntry(el as HTMLInputElement)) return;
      if (e.code === 'Space') (e.preventDefault(), togglePlay());
      else if (mod && key === 'z' && !e.shiftKey) (e.preventDefault(), session.undo());
      else if (mod && (key === 'y' || (e.shiftKey && key === 'z'))) (e.preventDefault(), session.redo());
      else if (mod && key === 'b') (e.preventDefault(), splitAtPlayhead());
      // Com Shift, o trecho marcado (antes do Delete comum, que tira o clipe selecionado).
      else if (e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace')) deleteMarkedRange();
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelectedKeyframeOrClip();
      // I e O marcam a agulha. No "Antes", primeiro a prévia volta para o "Depois", com a agulha no mesmo ponto do vídeo.
      else if (!mod && !e.altKey && key === 'i') (setCompare(false), marks.set(withIn(marks.get(), playback.get().time)));
      else if (!mod && !e.altKey && key === 'o') (setCompare(false), marks.set(withOut(marks.get(), playback.get().time)));
      else if (e.key === 'Escape') marks.set({ in: null, out: null });
      // preventDefault: o controle deslizante em foco não anda junto com a agulha.
      else if (e.key === 'ArrowRight') (e.preventDefault(), playback.seek(playback.get().time + 1 / session.view.settings.fps));
      else if (e.key === 'ArrowLeft') (e.preventDefault(), playback.seek(playback.get().time - 1 / session.view.settings.fps));
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!dictatePending || (e.key !== 'Control' && e.key !== 'Meta')) return;
      dictatePending = false;
      window.dispatchEvent(new Event('diretor:dictate'));
    };
    const onBlur = () => (dictatePending = false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Fechar/recarregar com mudanças não salvas ou exportando: o processo principal pergunta antes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!session.dirty && !session.draftEdits && !isExporting()) return;
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

  // Versão instalada, para dizer qual versão de teste está aberta.
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    window.diretor?.appInfo().then((i) => i.packaged && setVersion(i.version), () => undefined);
  }, []);

  const doExport = async () => {
    if (s.openProposal?.status === 'active' && !confirm('Há um rascunho pendente. A exportação usa só o que já foi aceito. Continuar?')) return;
    cancel.current = { cancelled: false };
    const project = session.project;
    // Até o motor de áudio novo, o som de muitos pedaços pode levar minutos a mais para ficar pronto.
    const slowAudio = project.clips.filter((c) => c.kind === 'video').length > 300;
    setExp({ frame: 0, total: 1, slowAudio });
    const r = await exportProject(project, { onProgress: (p) => setExp({ ...p, slowAudio }), signal: cancel.current });
    if (r.cancelled) return setExp(null);
    setExp((e) => ({ ...(e ?? { frame: 0, total: 1 }), done: r.ok ? r.outPath : undefined, warning: r.ok ? r.warning : undefined, error: r.ok ? undefined : r.error }));
  };

  return (
    <div className="app">
      <div className="titlebar">
        <span className="brand">Diretor</span>
        {version && <span className="version" data-testid="app-version">{version}</span>}
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
        <span className="dirty" title={s.draftEdits ? 'Seus ajustes no rascunho do Claude só entram no projeto quando você aceitar o rascunho.' : undefined}>
          {s.dirty || s.draftEdits ? 'não salvo' : s.filePath ? 'salvo' : ''}
        </span>
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
                  {exp.frame >= exp.total ? 'Finalizando e gravando o MP4…' : `Quadro ${exp.frame} de ${exp.total}.`} Tudo é processado no seu computador.
                </p>
                {exp.slowAudio && <p className="hint">Com muitos cortes, o som pode levar alguns minutos a mais para ficar pronto.</p>}
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
                {exp.warning && <p style={{ color: 'var(--warn)', fontSize: 12.5 }}>{exp.warning}</p>}
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
window.__diretor = { session, playback, importPaths, exportProject, cancelExport, saveProject, openProject, addCaptionAtPlayhead, previewSettled };
