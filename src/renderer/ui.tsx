import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Op } from '../core/operations';
import { session } from './store';

/**
 * Campo numérico que só grava ao confirmar (Enter/sair do campo): uma entrada
 * de histórico por edição. O destino e os limites são os do momento em que você
 * entrou no campo: clicar em outro clipe enquanto digita não grava o número no
 * clipe errado nem o limita pelos valores do outro clipe.
 */
export function NumberField(props: { value: number; onCommit: (v: number) => void; step?: number; min?: number; max?: number; digits?: number; disabled?: boolean; title?: string }) {
  const digits = props.digits ?? 2;
  const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 10 ** digits) / 10 ** digits) : '');
  const [text, setText] = useState(fmt(props.value));
  const [focus, setFocus] = useState(false);
  const edit = useRef<{ onCommit: (v: number) => void; value: number; min?: number; max?: number; edited: boolean; cancelled: boolean } | null>(null);
  useEffect(() => {
    if (!focus) setText(fmt(props.value));
  }, [props.value, focus]);
  const finish = () => {
    const e = edit.current;
    edit.current = null;
    setFocus(false);
    if (!e || e.cancelled || !e.edited) return setText(fmt(props.value));
    const raw = text.trim().replace(',', '.');
    const v = Number(raw);
    if (!raw || !Number.isFinite(v)) return setText(fmt(e.value));
    const clamped = Math.min(e.max ?? Infinity, Math.max(e.min ?? -Infinity, v));
    if (Math.abs(clamped - e.value) > 1e-9) e.onCommit(clamped);
    else setText(fmt(e.value));
  };
  return (
    <input
      className="input"
      type="number"
      title={props.title}
      step={props.step ?? 0.1}
      min={props.min}
      max={props.max}
      value={text}
      disabled={props.disabled}
      onFocus={() => {
        edit.current = { onCommit: props.onCommit, value: props.value, min: props.min, max: props.max, edited: false, cancelled: false };
        setFocus(true);
      }}
      onBlur={finish}
      onChange={(e) => {
        if (edit.current) edit.current.edited = true;
        setText(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          if (edit.current) edit.current.cancelled = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function TextField(props: { value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  const [text, setText] = useState(props.value);
  const [focus, setFocus] = useState(false);
  const edit = useRef<{ onCommit: (v: string) => void; value: string; cancelled: boolean } | null>(null);
  useEffect(() => {
    if (!focus) setText(props.value);
  }, [props.value, focus]);
  const common = {
    className: 'input',
    value: text,
    placeholder: props.placeholder,
    onFocus: () => {
      edit.current = { onCommit: props.onCommit, value: props.value, cancelled: false };
      setFocus(true);
    },
    onBlur: () => {
      const e = edit.current;
      edit.current = null;
      setFocus(false);
      if (!e || e.cancelled || text === e.value) return setText(props.value);
      e.onCommit(text);
    },
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        if (edit.current) edit.current.cancelled = true;
        (e.target as HTMLElement).blur();
      }
      if (e.key === 'Enter' && !props.multiline) (e.target as HTMLElement).blur();
    },
  };
  return props.multiline ? <textarea {...common} /> : <input {...common} />;
}

/** Cor: mostra ao arrastar no seletor, mas grava uma vez só, quando o seletor fecha. */
export function ColorField(props: { value: string; onCommit: (v: string) => void; title?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState(props.value);
  const commitRef = useRef(props.onCommit);
  commitRef.current = props.onCommit;
  useEffect(() => setLocal(props.value), [props.value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => {
      if (el.value.toLowerCase() !== props.value.toLowerCase()) commitRef.current(el.value);
    };
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, [props.value]);
  return <input ref={ref} className="input" type="color" title={props.title} value={local} onChange={(e) => setLocal(e.target.value)} />;
}

// ---------- avisos ----------
type Toast = { text: string; error?: boolean } | null;
let toast: Toast = null;
const toastListeners = new Set<() => void>();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(text: string, error = false) {
  toast = { text, error };
  toastListeners.forEach((f) => f());
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast = null;
    toastListeners.forEach((f) => f());
  }, 3500);
}
export function ToastHost() {
  const t = useSyncExternalStore(
    (f) => (toastListeners.add(f), () => toastListeners.delete(f)),
    () => toast,
  );
  return t ? <div className={`toast ${t.error ? 'error' : ''}`}>{t.text}</div> : null;
}

/**
 * Envia operações pela camada única de edição e avisa se o editor recusou. Uma mudança que iria para o projeto
 * com um rascunho do Claude ajustado à mão pergunta antes (o rascunho ficaria desatualizado e os ajustes, perdidos).
 */
export function run(ops: Op[], label?: string): boolean {
  const r = session.dispatch(ops, label, () =>
    confirm('Esta mudança vai direto para o projeto e o rascunho do Claude fica desatualizado: os seus ajustes nele serão perdidos. Para guardá-los, cancele e aceite o rascunho antes. Continuar?'),
  );
  if (!r.ok && r.message) showToast(r.message, true);
  return r.ok;
}

// ---------- ícones (traço simples) ----------
const I = (d: ReactNode, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);
export const Icon = {
  play: I(<path d="M7 4.5v15l12-7.5z" fill="currentColor" />),
  pause: I(<><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" /><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" /></>),
  start: I(<><path d="M18 5v14L8 12z" fill="currentColor" /><path d="M6 5v14" /></>),
  end: I(<><path d="M6 5v14l10-7z" fill="currentColor" /><path d="M18 5v14" /></>),
  undo: I(<><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>),
  redo: I(<><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></>),
  trash: I(<><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>),
  plus: I(<path d="M12 5v14M5 12h14" />),
  export: I(<><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 13v7h14v-7" /></>),
  folder: I(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  eye: I(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  eyeOff: I(<><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6" /></>),
  lock: I(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>),
  unlock: I(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></>),
  send: I(<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z" />),
  spark: I(<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />),
  sliders: I(<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4" />),
  chat: I(<path d="M4 5h16v11H9l-5 4z" />),
  code: I(<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" />),
  volume: I(<><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 0 1 0 7" /></>),
  mute: I(<><path d="M4 9v6h4l5 4V5L8 9z" /><path d="m17 9 5 6M22 9l-5 6" /></>),
  text: I(<path d="M5 6V4h14v2M12 4v16M9 20h6" />),
  caption: I(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 13h4M13 13h4M7 16h10" /></>),
  image: I(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>),
  mic: I(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>),
  clip: I(<path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7" />),
  stop: I(<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />),
  newChat: I(<><path d="M4 5h16v11H9l-5 4z" /><path d="M12 8v5M9.5 10.5h5" /></>),
  scissors: I(<><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M8.5 7.8 20 18M8.5 16.2 20 6" /></>),
  // Trecho entre duas marcas, com um X: apagar o trecho marcado.
  cutRange: I(<><path d="M4 4v16M20 4v16" /><path d="m9 9 6 6M15 9l-6 6" /></>),
};
