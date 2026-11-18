import { useEffect, useRef, useState } from 'react';
import { describeOp } from '../core/operations';
import type { Proposal } from '../core/session';
import { bridgeStats } from './bridgeClient';
import { useSession } from './store';
import { Icon, NumberField, showToast } from './ui';

const STEP_LABEL: Record<string, string> = { waiting: 'na fila', draft: 'em rascunho', accepted: 'aceita', discarded: 'descartada', invalid: 'inválida' };
const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;

export function ChatPanel() {
  const s = useSession();
  const [note, setNote] = useState('');
  const [showEco, setShowEco] = useState(false);
  const [, force] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  const lastActivity = s.activity[s.activity.length - 1]?.id ?? 0;
  const p0 = s.openProposal;
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [lastActivity, p0?.id, p0?.current, p0?.status, s.contextRequest?.status]);

  const connected = Date.now() - bridgeStats.lastCallAt < 180_000;
  const p = s.openProposal;
  const req = s.contextRequest;

  return (
    <div className="panel">
      <div className="assist-tabs">
        <button className="tab active">
          {Icon.chat} Claude <span className={`dot ${connected ? 'on' : ''}`} style={{ marginLeft: 6 }} />
        </button>
        <button className="tab" disabled title="Fase 2">
          {Icon.code} Codex · Reserva
        </button>
      </div>
      <div className="status">
        {Icon.chat} {connected ? 'Claude conectado' : 'Aguardando o Claude Desktop'}
      </div>
      {!connected && (
        <p className="hint" style={{ padding: '0 14px' }}>
          Converse no Claude Desktop com o conector “diretor” ativo. As propostas aparecem aqui como rascunho. O editor funciona normalmente sem a IA.
        </p>
      )}

      {/* Uma área só rola: atividade, pedido de contexto e a proposta. Os botões de decisão ficam sempre à vista. */}
      <div className="assist-scroll" ref={feedRef}>
      {!connected && <ClaudeSetup />}
      <div className="feed">
        {s.activity.slice(-40).map((a) => (
          <div key={a.id} className={`item ${a.kind === 'note' ? 'note' : ''}`}>
            {a.bytesOut !== undefined && <span className="size">{kb(a.bytesOut)}</span>}
            {a.text}
          </div>
        ))}
      </div>

      {req?.status === 'pending' && (
        <div className="card stale">
          <span className="badge warn">Contexto maior</span>
          <h3>O Claude pediu {kb(req.bytes)} de contexto</h3>
          <p>O teto atual é {kb(s.settings.contextCeilingBytes)}. Só dados do projeto (texto e números); nenhuma imagem ou trecho de vídeo é enviado.</p>
          <div className="row">
            <button className="btn primary" onClick={() => s.answerContextRequest(true)}>
              Autorizar uma vez
            </button>
            <button className="btn" onClick={() => s.answerContextRequest(false)}>
              Recusar
            </button>
          </div>
        </div>
      )}

      {p && <ProposalCard p={p} />}

      </div>

      {/* Fora da área que rola: abre sempre à vista, logo acima da caixa de nota. */}
      {showEco && (
        <div className="eco-pop">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>Modo econômico</strong>
            <button className={`btn ${s.settings.economy ? 'on' : ''}`} onClick={() => s.updateSettings({ economy: !s.settings.economy })}>
              {s.settings.economy ? 'Ligado' : 'Desligado'}
            </button>
          </div>
          <div className="field">
            <label>Teto por ação (KB)</label>
            <NumberField value={s.settings.contextCeilingBytes / 1024} min={1} max={256} step={1} digits={1} onCommit={(v) => s.updateSettings({ contextCeilingBytes: Math.round(v * 1024) })} />
          </div>
          <p className="hint">
            Métricas do editor: {bridgeStats.calls} chamadas, {kb(bridgeStats.totalBytesOut)} enviados (≈{Math.round(bridgeStats.totalBytesOut / 4)} tokens, estimativa do editor). Cota e consumo reais de tokens são do Claude Desktop.
          </p>
        </div>
      )}

      <div className="composer">
        <input
          placeholder="Nota para o Claude…"
          title="O Claude lê a nota no próximo get_context"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              s.addNote(note);
              setNote('');
            }
          }}
        />
        <button className={`btn ${s.settings.economy ? 'on' : ''}`} onClick={() => setShowEco((v) => !v)} title="Modo econômico e teto de contexto" data-testid="eco-toggle">
          Modo econômico
        </button>
        <button
          className="btn ghost icon"
          title="Enviar nota"
          onClick={() => {
            s.addNote(note);
            setNote('');
          }}
        >
          {Icon.send}
        </button>
      </div>
      <div className="metrics">
        Último contexto: {kb(bridgeStats.lastBytesOut)} · teto {kb(s.settings.contextCeilingBytes)} (métrica do editor)
      </div>
    </div>
  );
}

function ProposalCard({ p }: { p: Proposal }) {
  const s = useSession();
  const step = p.steps[p.current];
  const stale = p.status === 'stale';
  // Trava curta quando a etapa muda: um clique duplo em Aceitar não decide a próxima etapa sem você vê-la.
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    setLocked(true);
    const t = setTimeout(() => setLocked(false), 500);
    return () => clearTimeout(t);
  }, [p.id, step?.id, p.status]);
  return (
    <div className={`card ${stale ? 'stale' : 'draft'}`} data-testid="proposal-card">
      <div className="row">
        <span style={{ color: 'var(--accent)' }}>{Icon.spark}</span>
        {stale ? <span className="badge warn">Desatualizado</span> : <span className="badge">Rascunho</span>}
        <span className="hint" style={{ marginLeft: 'auto' }}>
          Etapa {Math.min(p.current + 1, p.steps.length)} de {p.steps.length}
        </span>
      </div>
      <h3>{p.title}</h3>
      {p.summary && <p>{p.summary}</p>}
      {stale && <p style={{ color: 'var(--warn)' }}>{p.staleReason}</p>}
      <div className="steps">
        {p.steps.map((st, i) => (
          <div key={st.id} className={`step ${st.status === 'draft' && !stale ? 'draft' : ''}`} title={st.ops.map(describeOp).join(' · ')}>
            <span>
              {i + 1}. {st.label}
              {st.manualOps.length > 0 && ' (ajustada)'}
            </span>
            <span className="st">{STEP_LABEL[st.status]}</span>
          </div>
        ))}
      </div>
      {stale ? (
        <div className="row">
          <button className="btn primary" disabled={p.redoRequested || locked} onClick={() => s.requestRedo(p.id)}>
            {p.redoRequested ? 'Pedido registrado' : 'Refazer com contexto atual'}
          </button>
          <button className="btn" disabled={locked} onClick={() => s.discardStep(p.id)}>
            Descartar
          </button>
          {p.redoRequested && <p className="hint" style={{ width: '100%', margin: '4px 0 0' }}>Se o Claude estiver esperando, ele refaz sozinho. Se não, escreva “refaz” na conversa do Claude Desktop.</p>}
        </div>
      ) : (
        step?.status === 'draft' && (
          <div className="decision">
            <button className="btn primary lg" disabled={locked} onClick={() => s.acceptStep(p.id)} data-testid="accept">
              Aceitar
            </button>
            <button className="btn lg" disabled={locked} onClick={() => s.discardStep(p.id)} data-testid="discard">
              Descartar
            </button>
            <button className={`btn lg ${s.adjustMode ? 'on' : 'outline-accent'}`} onClick={() => s.setAdjustMode(!s.adjustMode)} title="Edições à mão vão para o rascunho">
              {Icon.sliders} {s.adjustMode ? 'Ajustando…' : 'Ajustar na linha do tempo'}
            </button>
          </div>
        )
      )}
    </div>
  );
}

type ClaudeStatus = Awaited<ReturnType<NonNullable<Window['diretor']>['claudeStatus']>>;
const RESTART_CLAUDE = 'feche o Claude Desktop por completo (botão direito no ícone dele, perto do relógio → Sair) e abra de novo';

/** Liga o Claude Desktop ao Diretor com um clique, sem editar arquivo à mão. */
function ClaudeSetup() {
  const api = window.diretor;
  const [st, setSt] = useState<ClaudeStatus | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string; file?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => api?.claudeStatus().then(setSt, () => undefined);
  useEffect(() => {
    void refresh();
  }, []);
  if (!api || !st) return null;

  const found = st.configs.length > 0;
  const broken = st.configs.find((c) => c.state === 'invalid');
  const ready = found && st.configs.every((c) => c.state === 'connected');

  const connect = async () => {
    setBusy(true);
    try {
      const r = await api.connectClaude();
      const rs = r.results ?? [];
      const ok = rs.some((x) => x.state === 'added' || x.state === 'updated' || x.state === 'unchanged');
      const bad = rs.find((x) => x.state === 'invalid' || x.state === 'error');
      if (r.error) setResult({ ok: false, text: r.error });
      else if (!rs.length) setResult({ ok: false, text: 'Ainda não encontrei o Claude Desktop. Instale pelo site claude.ai/download, abra uma vez e clique de novo.' });
      else if (ok) setResult({ ok: true, text: `Pronto! Agora ${RESTART_CLAUDE}. O conector “diretor” aparece nele e é só pedir na conversa.` });
      else setResult({ ok: false, text: `Não consegui gravar a configuração do Claude Desktop (${bad && 'error' in bad ? bad.error : 'erro desconhecido'}). Use “Copiar configuração” e cole à mão.`, file: bad?.file });
    } finally {
      setBusy(false);
      void refresh();
    }
  };
  const copy = async () => {
    await api.copyClaudeConfig();
    showToast('Configuração copiada. Cole no arquivo de configuração do Claude Desktop, dentro de "mcpServers".');
  };

  let text: string;
  if (result) text = result.text;
  else if (!found) text = 'Não encontrei o Claude Desktop neste computador. Instale pelo site claude.ai/download, abra uma vez e clique em Conectar.';
  else if (ready) text = `O Claude Desktop já está configurado. Se o conector “diretor” não aparece nele, ${RESTART_CLAUDE}.`;
  else if (broken && st.configs.every((c) => c.state === 'invalid')) text = `O arquivo de configuração do Claude Desktop tem um erro (${'error' in broken ? broken.error : ''}), então não mexi nele.`;
  else text = 'Um clique e o Claude Desktop passa a enxergar o Diretor. O resto da configuração dele fica como está.';
  const file = result?.file ?? (!result && broken && !ready ? broken.file : undefined);

  return (
    <div className={`card ${result?.ok || (!result && ready) ? 'draft' : ''}`} data-testid="claude-setup">
      <h3 style={{ marginTop: 0 }}>{result?.ok || (!result && ready) ? 'Claude Desktop configurado' : 'Conectar ao Claude Desktop'}</h3>
      <p data-testid="claude-setup-msg">{text}</p>
      {!st.serverFound && <p style={{ color: 'var(--warn)' }}>O servidor do Claude não está na pasta do Diretor. Instale o Diretor de novo.</p>}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {!result?.ok && !ready && (
          <button className="btn primary" disabled={busy} onClick={() => void connect()} data-testid="claude-connect">
            {busy ? 'Conectando…' : 'Conectar'}
          </button>
        )}
        <button className="btn" onClick={() => void copy()} data-testid="claude-copy" title="Para colar à mão no claude_desktop_config.json">
          Copiar configuração
        </button>
        {file && (
          <button className="btn ghost" onClick={() => void api.showItem(file)}>
            Mostrar o arquivo
          </button>
        )}
      </div>
    </div>
  );
}
