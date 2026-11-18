import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { describeOp } from '../core/operations';
import type { Proposal } from '../core/session';
import { bridgeStats } from './bridgeClient';
import { AI_APP, AI_LABEL, type AiKind, chat, type ChatImage, readImage, useChat } from './chat';
import { useSession } from './store';
import { COPIED, connectOutcome, type ClaudeStatus, keepOutcome, type Outcome, quitHint, setupMessage, setupView } from './claudeSetupText';
import { Icon, showToast } from './ui';

const STEP_LABEL: Record<string, string> = { waiting: 'na fila', draft: 'em rascunho', accepted: 'aceita', discarded: 'descartada', invalid: 'inválida' };

type FeedRow = { key: string; time: number; node: ReactNode };

export function ChatPanel() {
  const s = useSession();
  const ch = useChat();
  const [tab, setTab] = useState<AiKind>('claude');
  const [text, setText] = useState('');
  const [images, setImages] = useState<ChatImage[]>([]);
  const [showDesktop, setShowDesktop] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Imagens ainda sendo lidas: Enviar espera, para a imagem não ficar para a próxima mensagem.
  const [loadingImages, setLoadingImages] = useState(0);
  const [, force] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Procura o Claude Code e o Codex ao abrir e quando a pessoa volta para o Diretor (pode ter acabado de instalar).
  useEffect(() => {
    void chat.refresh();
    const back = () => {
      if (document.visibilityState === 'visible') void chat.refresh();
    };
    window.addEventListener('focus', back);
    const t = setInterval(() => force((n) => n + 1), 15_000);
    return () => {
      window.removeEventListener('focus', back);
      clearInterval(t);
    };
  }, []);

  // Ctrl+D (em qualquer lugar) ou o botão do microfone: cursor na caixa e ditado do Windows.
  const dictate = async () => {
    boxRef.current?.focus();
    const r = await window.diretor?.voiceDictate();
    if (!r || r.error) showToast(r?.error ?? 'O ditado por voz só funciona no aplicativo.', true);
  };
  useEffect(() => {
    const on = () => void dictate();
    window.addEventListener('diretor:dictate', on);
    return () => window.removeEventListener('diretor:dictate', on);
  }, []);

  const convo = ch.convos[tab];
  const cli = ch.cli[tab];
  const running = !!convo.runId;
  const lastActivity = s.activity[s.activity.length - 1]?.id ?? 0;
  const lastEntry = convo.entries[convo.entries.length - 1]?.id ?? 0;
  const p = s.openProposal;
  const req = s.contextRequest;
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [lastActivity, lastEntry, running, tab, p?.id, p?.current, p?.status, req?.status]);

  const connected = Date.now() - bridgeStats.lastDesktopCallAt < 180_000;

  const addFiles = async (list: Iterable<Blob>) => {
    // Copia a lista antes de esperar: o seletor de arquivos é limpo logo depois e a esvaziaria.
    const files = [...list];
    if (!files.length) return;
    setLoadingImages((n) => n + 1);
    const got: ChatImage[] = [];
    let skipped = 0;
    try {
      for (const f of files) {
        const img = await readImage(f).catch(() => null);
        if (img) got.push(img);
        else skipped++;
      }
    } finally {
      setLoadingImages((n) => n - 1);
    }
    if (skipped) showToast('Só dá para mandar imagens (PNG, JPG, WEBP ou GIF) que abram normalmente.', true);
    if (got.length) setImages((cur) => [...cur, ...got].slice(0, 8));
  };

  const send = async () => {
    const t = text.trim();
    if (running) {
      // Enquanto a IA trabalha, o que a pessoa escreve vira nota: ela lê na próxima consulta ao editor.
      if (!t) return;
      s.addNote(t);
      setText('');
      return;
    }
    if (!t && !images.length) return;
    if (loadingImages > 0) {
      showToast('Espere a imagem carregar.');
      return;
    }
    if (!cli) {
      showToast(`Instale o ${AI_APP[tab]} primeiro (botão acima).`, true);
      return;
    }
    setText('');
    setImages([]);
    await chat.send(tab, t, images);
  };

  // Uma linha do tempo só: a conversa e o que acontece no editor (propostas, decisões), na ordem.
  const rows: FeedRow[] = [
    ...s.activity.slice(-40).map((a) => ({
      key: `a${a.id}`,
      time: a.time,
      node: (
        <div className={`item ${a.kind === 'note' ? 'note' : ''}`}>{a.text}</div>
      ),
    })),
    ...convo.entries.slice(-80).map((e) => ({
      key: `c${e.id}`,
      time: e.time,
      node: <ChatBubble kind={tab} e={e} />,
    })),
  ].sort((a, b) => a.time - b.time);

  const statusText = running
    ? `${AI_LABEL[tab]} está trabalhando…`
    : cli
      ? `${AI_LABEL[tab]} pronto`
      : cli === null
        ? `${AI_APP[tab]} não encontrado`
        : 'Procurando…';

  return (
    <div
      className={`panel chat-panel ${dragging ? 'dragging' : ''}`}
      data-testid="chat-panel"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      <div className="assist-tabs">
        {(['claude', 'codex'] as AiKind[]).map((k) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)} data-testid={`ai-tab-${k}`}>
            {k === 'claude' ? Icon.chat : Icon.code} {AI_LABEL[k]}
            {k === 'codex' && <span className="tab-sub"> · Reserva</span>}
          </button>
        ))}
      </div>
      <div className="status">
        <span data-testid="ai-status">{statusText}</span>
        {convo.entries.length > 0 && (
          <button className="btn ghost small" style={{ marginLeft: 'auto' }} onClick={() => chat.reset(tab)} title="Começa uma conversa nova (a IA esquece o que foi dito; o projeto continua igual)" data-testid="ai-new">
            {Icon.newChat} Nova conversa
          </button>
        )}
      </div>

      <div className="assist-scroll" ref={feedRef}>
        {/* O Claude Desktop continua funcionando: fica como alternativa, no alto, sem atrapalhar a conversa. */}
        {tab === 'claude' && (
          <div className="desktop-alt">
            <button className="btn ghost small" onClick={() => setShowDesktop((v) => !v)} data-testid="desktop-toggle">
              {showDesktop ? 'Fechar' : 'Usar pelo Claude Desktop'}
            </button>
            {connected && <span className="hint"> · Claude Desktop conectado</span>}
            {showDesktop && <ClaudeSetup />}
          </div>
        )}
        {cli === null && <InstallCard kind={tab} platform={ch.platform} />}
        {cli && convo.entries.length === 0 && (
          <p className="hint" style={{ padding: '0 14px' }}>
            Escreva o que quer no vídeo, do seu jeito: “anima o título entrando de baixo”, “legenda do segundo 2 ao 5 dizendo…”. As mudanças aparecem como rascunho para você aceitar ou descartar. Ctrl+D para falar; cole ou arraste imagens.
          </p>
        )}
        <div className="feed">
          {rows.map((r) => (
            <Fragment key={r.key}>{r.node}</Fragment>
          ))}
          {running && (
            <div className="bubble assistant thinking" data-testid="ai-thinking">
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
        </div>

        {req?.status === 'pending' && (
          <div className="card stale">
            <span className="badge warn">Modo econômico</span>
            <h3>A IA quer ver mais do projeto</h3>
            <p>Para este pedido ela precisa de mais do que o modo econômico deixa. Só vão dados do projeto (texto e números); nenhuma imagem ou trecho de vídeo é enviado.</p>
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

        {p && <ProposalCard key={p.id} p={p} />}

      </div>

      <div className="composer chat-composer">
        {images.length > 0 && (
          <div className="attachments" data-testid="ai-attachments">
            {images.map((img, i) => (
              <div key={i} className="thumb">
                <img src={img.url} alt="" />
                <button title="Tirar" onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={boxRef}
          rows={2}
          data-testid="ai-input"
          placeholder={running ? `Nota para o ${AI_LABEL[tab]} (ele lê enquanto trabalha)…` : `Peça ao ${AI_LABEL[tab]}…  (Ctrl+D para falar)`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            // Excel e Word copiam texto junto com uma imagem dele: nesse caso vale o texto.
            if (e.clipboardData.getData('text/plain')) return;
            const files = [...e.clipboardData.items].filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter((f): f is File => !!f);
            if (!files.length) return;
            e.preventDefault();
            void addFiles(files);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="composer-row">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(e) => {
              const files = e.target.files ? [...e.target.files] : [];
              e.target.value = '';
              void addFiles(files);
            }}
          />
          <button className="btn ghost icon" title="Mandar imagem (ou cole com Ctrl+V, ou arraste para cá)" onClick={() => fileRef.current?.click()} disabled={running} data-testid="ai-attach">
            {Icon.clip}
          </button>
          <button className="btn ghost icon" title="Falar (Ctrl+D): abre o ditado por voz do Windows" onClick={() => void dictate()} data-testid="ai-mic">
            {Icon.mic}
          </button>
          {/* Um clique liga ou desliga. Ligado (azul), a IA vê só o essencial e pede licença para ver mais. */}
          <button
            className={`btn ${s.settings.economy ? 'on' : ''}`}
            aria-pressed={s.settings.economy}
            onClick={() => {
              const on = !s.settings.economy;
              s.updateSettings({ economy: on });
              showToast(on ? 'Modo econômico ligado: a IA vê só o essencial e pede licença para ver mais.' : 'Modo econômico desligado: a IA vê o projeto todo sem pedir licença, gastando mais do seu plano.');
            }}
            title={
              s.settings.economy
                ? 'Ligado: a IA vê só o essencial e pede licença para ver mais. Clique para desligar.'
                : 'Desligado: a IA vê o projeto todo sem pedir licença, gastando mais do seu plano. Clique para ligar.'
            }
            data-testid="eco-toggle"
          >
            Modo econômico
          </button>
          <span style={{ flex: 1 }} />
          {running ? (
            <button className="btn icon stop" title="Parar" onClick={() => chat.stop(tab)} data-testid="ai-stop">
              {Icon.stop}
            </button>
          ) : (
            <button className="btn primary icon" title="Enviar (Enter)" onClick={() => void send()} disabled={loadingImages > 0} data-testid="ai-send">
              {Icon.send}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ kind, e }: { kind: AiKind; e: import('./chat').ChatEntry }) {
  const [busy, setBusy] = useState(false);
  if (e.role === 'user')
    return (
      <div className="bubble user" data-testid="ai-msg-user">
        {e.images && e.images.length > 0 && (
          <div className="bubble-images">
            {e.images.map((u, i) => (
              <img key={i} src={u} alt="" />
            ))}
          </div>
        )}
        {e.text && <Markdown text={e.text} />}
      </div>
    );
  if (e.role === 'assistant')
    return (
      <div className="bubble assistant" data-testid="ai-msg-assistant">
        <Markdown text={e.text} />
      </div>
    );
  return (
    <div className={`bubble ${e.role}`} data-testid={`ai-msg-${e.role}`}>
      {e.text}
      {e.login && (
        <div className="row" style={{ marginTop: 6 }}>
          <button
            className="btn small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await window.diretor?.aiTerminal(kind, 'login');
              setBusy(false);
              if (r?.error) showToast(r.error, true);
            }}
          >
            Entrar na conta
          </button>
        </div>
      )}
    </div>
  );
}

/** O básico de Markdown que as respostas usam: parágrafos, listas, **negrito** e `código`. */
function Markdown({ text }: { text: string }) {
  const item = /^\s*(?:[-*•]|\d+[.)])\s+/;
  return (
    <>
      {text.split(/\n{2,}/).map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim());
        if (lines.length && lines.every((l) => item.test(l)))
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(item, ''))}</li>
              ))}
            </ul>
          );
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l.replace(/^#{1,6}\s+/, ''))}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
      <code key={i}>{part.slice(1, -1)}</code>
    ) : (
      part
    ),
  );
}

/** Sem o Claude Code (ou o Codex): um botão instala e já abre o login, numa janela do PowerShell. */
function InstallCard({ kind, platform }: { kind: AiKind; platform: string }) {
  const [opened, setOpened] = useState(false);
  const plan = kind === 'claude' ? 'Pro ou Max' : 'ChatGPT Plus ou maior';
  const open = async (action: 'install' | 'login') => {
    const r = await window.diretor?.aiTerminal(kind, action);
    if (r?.error) showToast(r.error, true);
    else setOpened(true);
  };
  return (
    <div className="card" data-testid="ai-install">
      <h3 style={{ marginTop: 0 }}>Instalar o {AI_APP[kind]}</h3>
      <p>
        O chat usa o {AI_APP[kind]} instalado neste computador, com a sua assinatura ({plan}). Não precisa de chave nem de pagar à parte.
      </p>
      {platform === 'win32' ? (
        <>
          <ol className="setup-steps">
            <li>Clique em Instalar. Abre uma janela azul que instala e depois pede para entrar na sua conta.</li>
            <li>Entre na conta e feche a janela.</li>
            <li>Volte para o Diretor: o chat aparece sozinho.</li>
          </ol>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => void open('install')} data-testid="ai-install-btn">
              Instalar
            </button>
            <button className="btn" onClick={() => void chat.refresh()}>
              Já instalei
            </button>
          </div>
          {opened && <p className="hint">Quando terminar na janela azul, volte aqui. Se não aparecer, clique em “Já instalei”.</p>}
        </>
      ) : (
        <p className="hint">
          Instale pelo terminal ({kind === 'claude' ? 'curl -fsSL https://claude.ai/install.sh | bash' : 'npm install -g @openai/codex'}), entre na conta e abra o Diretor de novo.
        </p>
      )}
    </div>
  );
}

function ProposalCard({ p }: { p: Proposal }) {
  const s = useSession();
  const step = p.steps[p.current];
  const stale = p.status === 'stale';
  // Trava curta quando a etapa muda: um clique duplo em Aceitar não decide a próxima etapa sem você vê-la.
  const [locked, setLocked] = useState(false);
  const [sentToChat, setSentToChat] = useState(false);
  // Proposta feita no chat do Diretor: "Refazer" já pede ao mesmo assistente (se ele não estiver ocupado).
  // Feita pelo Claude Desktop: só registra o pedido, e ele recebe na próxima consulta.
  const redo = async () => {
    s.requestRedo(p.id);
    const k = chat.ownerOf(p.id);
    if (k && chat.get().cli[k] && !chat.running(k)) setSentToChat(await chat.send(k, 'Refaça a proposta desatualizada com o contexto atual.'));
  };
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
          <button className="btn primary" disabled={p.redoRequested || locked} onClick={() => void redo()}>
            {p.redoRequested ? 'Pedido registrado' : 'Refazer com contexto atual'}
          </button>
          <button className="btn" disabled={locked} onClick={() => s.discardStep(p.id)}>
            Descartar
          </button>
          {p.redoRequested && !sentToChat && <p className="hint" style={{ width: '100%', margin: '4px 0 0' }}>Se a IA estiver esperando, ela refaz sozinha. Se não, escreva “refaz” no chat.</p>}
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
