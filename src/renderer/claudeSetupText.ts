// Textos do cartão "Conectar ao Claude Desktop", separados da tela para dar para testar.
import type { ConfigState, ConnectResult } from '../main/claudeDesktop';

export interface ClaudeStatus {
  configs: ConfigState[];
  serverFound: boolean;
  /** O Claude Desktop está aberto? null quando não dá para saber. */
  claudeRunning: boolean | null;
}
export interface ConnectReply {
  results?: ConnectResult[];
  error?: string;
  /** O Claude Desktop estava aberto na hora do clique? null quando não dá para saber. */
  claudeRunning?: boolean | null;
}
export interface Outcome {
  tone: 'ok' | 'warn' | 'error';
  text: string;
  /** Arquivo para o botão "Mostrar o arquivo". */
  file?: string;
  /** Como estava esse arquivo quando o Conectar não conseguiu gravar nele. */
  failed?: { state: 'invalid' | 'error'; error: string };
}

/**
 * Como fechar o Claude Desktop de verdade: fechar a janela deixa ele aberto perto do relógio
 * (no Windows, o ícone pode estar escondido na setinha ^ ao lado dos outros).
 */
export function quitHint(mac: boolean): string {
  return mac ? 'com ele na frente, aperte Cmd+Q' : 'botão direito no ícone dele, perto do relógio ou dentro da setinha ^, e Sair';
}

export const NOT_FOUND =
  'Não encontrei o Claude Desktop neste computador. Instale pelo site claude.ai/download, abra uma vez, feche e clique em Conectar.';

const isOk = (r: ConnectResult) => r.state === 'added' || r.state === 'updated' || r.state === 'unchanged';
const why = (r: ConnectResult) => ('error' in r ? r.error : 'erro desconhecido');

/**
 * O que dizer depois do clique em Conectar. "Pronto" só quando todos os arquivos foram gravados.
 * `claudeRunning` é o da última conferência, para quando a resposta não diz como estava na hora.
 */
export function connectOutcome(reply: ConnectReply, claudeRunning: boolean | null, mac = false): Outcome {
  if (reply.error) return { tone: 'error', text: reply.error };
  const running = reply.claudeRunning === undefined ? claudeRunning : reply.claudeRunning;
  const rs = reply.results ?? [];
  if (!rs.length) return { tone: 'error', text: NOT_FOUND };
  const bad = rs.filter((r) => !isOk(r));
  const okCount = rs.length - bad.length;
  if (!bad.length) {
    const next =
      running === true
        ? `Agora feche o Claude Desktop por completo (${quitHint(mac)}) e abra de novo.`
        : running === false
          ? 'Agora abra o Claude Desktop.'
          : `Agora abra o Claude Desktop. Se ele já estava aberto, feche por completo (${quitHint(mac)}) e abra de novo.`;
    return { tone: 'ok', text: `Pronto! ${next} O conector “diretor” aparece nele e é só pedir na conversa.` };
  }
  const first = bad[0];
  const failed = { state: first.state === 'invalid' ? ('invalid' as const) : ('error' as const), error: why(first) };
  // Colar a configuração não conserta um arquivo com erro de formato: é preciso corrigir o erro.
  const broken = failed.state === 'invalid';
  if (!okCount) {
    const what = broken
      ? 'Clique em “Mostrar o arquivo”, corrija o erro, salve e clique em Conectar de novo.'
      : 'Use “Copiar configuração” e cole à mão no arquivo (em “Mostrar o arquivo”).';
    return { tone: 'error', text: `Não consegui gravar a configuração do Claude Desktop (${why(first)}). ${what}`, file: first.file, failed };
  }
  const what = broken ? 'clique em “Mostrar o arquivo”, corrija o erro, salve e clique em Conectar de novo' : 'use “Copiar configuração” e cole à mão nesse arquivo';
  return {
    tone: 'warn',
    text: `Gravei em ${okCount} de ${rs.length} arquivos de configuração do Claude Desktop, mas não neste: ${first.file} (${why(first)}). Se o conector “diretor” não aparecer no Claude, ${what}.`,
    file: first.file,
    failed,
  };
}

export type SetupView = { kind: 'not-found' } | { kind: 'ready' } | { kind: 'broken'; error: string; file: string } | { kind: 'steps' };

/** O cartão antes do clique: não achou o Claude, já está tudo certo, arquivo com erro, ou os passos. */
export function setupView(st: ClaudeStatus): SetupView {
  if (!st.configs.length) return { kind: 'not-found' };
  if (st.configs.every((c) => c.state === 'connected')) return { kind: 'ready' };
  const broken = st.configs.filter((c) => c.state === 'invalid');
  if (broken.length === st.configs.length) {
    const b = broken[0];
    return { kind: 'broken', error: 'error' in b ? b.error : '', file: b.file };
  }
  return { kind: 'steps' };
}

/** O texto do cartão antes do clique (depois dele, vale o resultado do Conectar). */
export function setupMessage(view: SetupView, mac = false): string {
  switch (view.kind) {
    case 'not-found':
      return NOT_FOUND;
    case 'ready':
      return `O Claude Desktop já está configurado. Se o conector “diretor” não aparece nele, feche o Claude Desktop por completo (${quitHint(mac)}) e abra de novo.`;
    case 'broken':
      // Colar a configuração copiada não conserta um arquivo com erro: é preciso corrigir o erro.
      return `O arquivo de configuração do Claude Desktop tem um erro (${view.error}), então não mexi nele. Clique em “Mostrar o arquivo”, corrija o erro e salve. Aí o botão Conectar aparece aqui.`;
    default:
      return 'Um clique e o Claude Desktop passa a enxergar o Diretor. O resto da configuração dele fica como está.';
  }
}

/**
 * O resultado do último Conectar continua na tela depois de conferir de novo? Some quando
 * deixa de valer, e o cartão volta a dizer o que fazer agora:
 * - "Pronto" só enquanto está tudo gravado (se o Claude regravou o arquivo e tirou o
 *   Diretor, o cartão volta aos passos);
 * - um erro some quando tudo ficou certo, quando o arquivo dele mudou (corrigido, gravado à
 *   mão ou com outro problema), quando todos os arquivos estão com erro (o cartão mostra
 *   qual corrigir) e quando o Claude Desktop sumiu ou apareceu.
 */
export function keepOutcome(r: Outcome | null, st: ClaudeStatus): Outcome | null {
  if (!r) return r;
  const view = setupView(st);
  if (r.tone === 'ok') return view.kind === 'ready' ? r : null;
  if (view.kind === 'ready' || view.kind === 'broken') return null;
  if ((r.text === NOT_FOUND) !== (view.kind === 'not-found')) return null;
  if (r.file && r.failed) {
    const now = st.configs.find((c) => c.file === r.file);
    const same =
      r.failed.state === 'invalid'
        ? now?.state === 'invalid' && now.error === r.failed.error
        : now?.state === 'missing' || now?.state === 'outdated';
    if (!same) return null;
  }
  return r;
}

export const COPIED =
  'Configuração copiada. Se o arquivo do Claude Desktop estiver vazio, cole tudo. Se ele já tiver "mcpServers", cole lá dentro só o trecho do "diretor".';
