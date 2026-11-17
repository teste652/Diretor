import { useEffect, useRef, useState } from 'react';
import { describeOp } from '../core/operations';
import type { Proposal } from '../core/session';
import { bridgeStats } from './bridgeClient';
import { useSession } from './store';
import { Icon, NumberField } from './ui';

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
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [s.activity.length]);

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

      <div className="feed" ref={feedRef}>
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
        <button className={`btn ${s.settings.economy ? 'on' : ''}`} onClick={() => setShowEco((v) => !v)} title="Modo econômico e teto de contexto">
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
          <button className="btn primary" disabled={p.redoRequested} onClick={() => s.requestRedo(p.id)}>
            {p.redoRequested ? 'Pedido enviado ao Claude' : 'Refazer com contexto atual'}
          </button>
          <button className="btn" onClick={() => s.discardStep(p.id)}>
            Descartar
          </button>
        </div>
      ) : (
        step?.status === 'draft' && (
          <div className="decision">
            <button className="btn primary lg" onClick={() => s.acceptStep(p.id)} data-testid="accept">
              Aceitar
            </button>
            <button className="btn lg" onClick={() => s.discardStep(p.id)} data-testid="discard">
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
