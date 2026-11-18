import { useEffect, useRef, useState } from 'react';
import { describeOp } from '../core/operations';
import type { Proposal } from '../core/session';
import { bridgeStats } from './bridgeClient';
import { useSession } from './store';
import { COPIED, connectOutcome, type ClaudeStatus, keepOutcome, type Outcome, quitHint, setupMessage, setupView } from './claudeSetupText';
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

/** Liga o Claude Desktop ao Diretor com um clique, sem editar arquivo à mão. */
function ClaudeSetup() {
  const api = window.diretor;
  const [st, setSt] = useState<ClaudeStatus | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const mac = /Mac/.test(navigator.userAgent);
  // A conferência pode demorar (o PowerShell, no Windows): vale só a resposta mais nova, e nenhuma
  // pedida antes do último Conectar (ela leu o arquivo antes da gravação).
  const asked = useRef(0);
  const shown = useRef(0);
  const refresh = (fresh = false) => {
    if (!api) return;
    const id = ++asked.current;
    api.claudeStatus(fresh).then(
      (next) => {
        if (id <= shown.current) return;
        shown.current = id;
        setSt(next);
        setResult((r) => keepOutcome(r, next));
      },
      () => undefined,
    );
  };
  // Confere de novo de tempos em tempos: o Claude pode ser fechado, aberto ou instalado com o cartão na tela.
  // E na hora em que a pessoa volta para o Diretor (por exemplo, depois de fechar o Claude Desktop).
  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 5000);
    const back = () => {
      if (document.visibilityState === 'visible') refresh(true);
    };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, []);
  if (!api || !st) return null;

  const view = setupView(st);
  const quit = quitHint(mac);
  const connect = async () => {
    setBusy(true);
    try {
      const reply = await api.connectClaude();
      shown.current = asked.current;
      setResult(connectOutcome(reply, st.claudeRunning, mac));
    } catch (e) {
      setResult({ tone: 'error', text: `Não consegui conectar: ${(e as Error).message}` });
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const copy = async () => {
    await api.copyClaudeConfig();
    showToast(COPIED);
  };
  const done = result ? result.tone === 'ok' : view.kind === 'ready';
  const file = result?.file ?? (!result && view.kind === 'broken' ? view.file : undefined);
  const message = result ? result.text : setupMessage(view, mac);

  return (
    <div className={`card ${done ? 'draft' : ''}`} data-testid="claude-setup">
      <h3 style={{ marginTop: 0 }}>{done ? 'Claude Desktop configurado' : 'Conectar ao Claude Desktop'}</h3>
      <p data-testid="claude-setup-msg" style={result && result.tone !== 'ok' ? { color: 'var(--warn)' } : undefined}>
        {message}
      </p>
      {!result && view.kind === 'steps' && (
        <ol className="setup-steps">
          <li>Feche o Claude Desktop por completo ({quit}).</li>
          <li>Clique em Conectar.</li>
          <li>Abra o Claude Desktop de novo.</li>
        </ol>
      )}
      {!done && st.claudeRunning && view.kind === 'steps' && (
        <p style={{ color: 'var(--warn)' }} data-testid="claude-running">
          O Claude Desktop ainda está aberto. Feche ele {result ? `por completo (${quit}) ` : ''}antes de conectar: aberto, ele pode desfazer a
          mudança.
        </p>
      )}
      {!st.serverFound && <p style={{ color: 'var(--warn)' }}>O servidor do Claude não está na pasta do Diretor. Instale o Diretor de novo.</p>}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {!done && view.kind !== 'broken' && (
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
