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
}
export interface Outcome {
  tone: 'ok' | 'warn' | 'error';
  text: string;
  /** Arquivo para o botão "Mostrar o arquivo". */
  file?: string;
}

/** Como fechar o Claude Desktop de verdade: fechar a janela deixa ele aberto perto do relógio. */
export function quitHint(mac: boolean): string {
  return mac ? 'com ele na frente, aperte Cmd+Q' : 'botão direito no ícone dele, perto do relógio → Sair';
}

export const NOT_FOUND =
  'Não encontrei o Claude Desktop neste computador. Instale pelo site claude.ai/download, abra uma vez, feche e clique em Conectar.';

const isOk = (r: ConnectResult) => r.state === 'added' || r.state === 'updated' || r.state === 'unchanged';
const why = (r: ConnectResult) => ('error' in r ? r.error : 'erro desconhecido');

/** O que dizer depois do clique em Conectar. "Pronto" só quando todos os arquivos foram gravados. */
export function connectOutcome(reply: ConnectReply, claudeRunning: boolean | null, mac = false): Outcome {
  if (reply.error) return { tone: 'error', text: reply.error };
  const rs = reply.results ?? [];
  if (!rs.length) return { tone: 'error', text: NOT_FOUND };
  const bad = rs.filter((r) => !isOk(r));
  const okCount = rs.length - bad.length;
  if (!bad.length) {
    const next = claudeRunning ? `Agora feche o Claude Desktop por completo (${quitHint(mac)}) e abra de novo.` : 'Agora abra o Claude Desktop.';
    return { tone: 'ok', text: `Pronto! ${next} O conector “diretor” aparece nele e é só pedir na conversa.` };
  }
  const first = bad[0];
  if (!okCount) {
    return {
      tone: 'error',
      text: `Não consegui gravar a configuração do Claude Desktop (${why(first)}). Use “Copiar configuração” e cole à mão no arquivo.`,
      file: first.file,
    };
  }
  return {
    tone: 'warn',
    text: `Gravei em ${okCount} de ${rs.length} arquivos de configuração do Claude Desktop, mas não neste: ${first.file} (${why(first)}). Se o conector “diretor” não aparecer no Claude, use “Copiar configuração” e cole nele à mão.`,
    file: first.file,
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

export const COPIED =
  'Configuração copiada. Se o arquivo do Claude Desktop estiver vazio, cole tudo. Se ele já tiver "mcpServers", cole lá dentro só o trecho do "diretor".';
