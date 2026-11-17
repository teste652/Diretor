import { type MediaItem, newId, projectDuration } from '../core/model';
import type { Op } from '../core/operations';
import { Inspector } from './Inspector';
import { fmtTime, session, useSession } from './store';
import { Icon, run, showToast } from './ui';
import { mediaUrl } from './video';

/** Importa arquivos (sem copiar nem alterar os originais) e põe o primeiro na linha do tempo. */
export async function importPaths(paths: string[]): Promise<void> {
  const api = window.diretor;
  if (!api) return;
  for (const path of paths) {
    const info = await api.probeMedia(path);
    if (!info) {
      showToast(`Não consegui ler ${path}`, true);
      continue;
    }
    const media: MediaItem = { id: newId('med'), path, name: info.name, duration: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio };
    const p = session.project;
    const ops: Op[] = [{ op: 'addMedia', media }];
    const hasVideo = p.clips.some((c) => c.kind === 'video');
    if (!hasVideo) {
      // Primeiro vídeo: o formato do projeto segue o vídeo (até 1920 de largura).
      const k = Math.min(1, 1920 / media.width, 1920 / media.height);
      const even = (n: number) => Math.max(16, Math.round((n * k) / 2) * 2);
      ops.push({ op: 'setCanvas', width: even(media.width), height: even(media.height) });
    }
    const videoEnd = Math.max(0, ...p.clips.filter((c) => c.kind === 'video').map((c) => c.start + c.duration));
    ops.push({ op: 'addClip', clip: { kind: 'video', mediaId: media.id, start: hasVideo ? videoEnd : 0 } });
    run(ops, `Importar ${media.name}`);
  }
}

export function LeftPanel({ tab, setTab }: { tab: 'media' | 'props'; setTab: (t: 'media' | 'props') => void }) {
  return (
    <div className="panel">
      <div className="tabs">
        <button className={`tab ${tab === 'media' ? 'active' : ''}`} onClick={() => setTab('media')}>
          Mídia
        </button>
        <button className={`tab ${tab === 'props' ? 'active' : ''}`} onClick={() => setTab('props')}>
          Propriedades
        </button>
      </div>
      <div className="scroll">{tab === 'media' ? <MediaList /> : <Inspector />}</div>
    </div>
  );
}

function MediaList() {
  const s = useSession();
  const media = s.project.media;
  return (
    <>
      <button className="btn" style={{ width: '100%', height: 40 }} onClick={async () => importPaths((await window.diretor?.openMediaDialog()) ?? [])}>
        {Icon.plus} Adicionar mídia
      </button>
      {media.length === 0 && <div className="empty">Importe um MP4. O arquivo original nunca é alterado.</div>}
      {media.map((m) => {
        const used = s.project.clips.some((c) => c.kind === 'video' && c.mediaId === m.id);
        return (
          <div
            key={m.id}
            className={`media-card ${used ? 'used' : ''}`}
            title="Clique duplo para adicionar ao fim da linha do tempo"
            onDoubleClick={() => {
              const end = projectDuration(s.project);
              run([{ op: 'addClip', clip: { kind: 'video', mediaId: m.id, start: end } }], `Adicionar ${m.name}`);
            }}
          >
            <video src={`${mediaUrl(m.path)}#t=0.5`} muted preload="metadata" />
            <div className="meta">
              <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
              <span>{fmtTime(m.duration)}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}
