import { byteSize, handleBridge } from '../core/api';
import { chat } from './chat';
import { session } from './store';

/** lastDesktopCallAt: só as chamadas do Claude Desktop (as do chat do painel vêm marcadas). */
export const bridgeStats = { lastCallAt: 0, lastDesktopCallAt: 0, lastBytesOut: 0, totalBytesOut: 0, calls: 0 };

const LABEL: Record<string, string> = {
  status: 'conferiu o editor',
  get_context: 'leu o projeto',
  propose_edit: 'enviou uma proposta',
  get_proposal: 'conferiu a proposta',
  cancel_proposal: 'cancelou a proposta',
};

/** Atende as chamadas do servidor MCP usando a mesma sessão da interface. */
export function connectBridge(): () => void {
  const api = window.diretor;
  if (!api) return () => undefined;
  // Chamadas em andamento: o Claude pode desistir de uma (botão parar, tempo esgotado).
  const inflight = new Map<number, AbortController>();
  const offCancel = api.onBridgeCancel((id) => inflight.get(id)?.abort());
  const offRequest = api.onBridgeRequest(async ({ id, method, params, client }) => {
    const ctrl = new AbortController();
    inflight.set(id, ctrl);
    let result: unknown;
    try {
      result = await handleBridge(session, method, params, ctrl.signal);
    } catch (e) {
      result = { error: 'internal', message: e instanceof Error ? e.message : String(e) };
    } finally {
      inflight.delete(id);
    }
    // Ninguém espera mais esta resposta.
    if (ctrl.signal.aborted) return;
    const out = byteSize(result);
    bridgeStats.lastCallAt = Date.now();
    if (!client) bridgeStats.lastDesktopCallAt = Date.now();
    // Quem fez cada proposta: o "Refazer" pede a ele, e só a ele.
    const pid = (result as { id?: unknown } | null)?.id;
    if (method === 'propose_edit' && client && typeof pid === 'string') chat.markProposal(pid, client);
    bridgeStats.lastBytesOut = out;
    bridgeStats.totalBytesOut += out;
    bridgeStats.calls++;
    session.log('tool', `${client === 'codex' ? 'Codex' : 'Claude'} ${LABEL[method] ?? method}`, { bytesOut: out, bytesIn: byteSize(params) });
    api.bridgeRespond(id, result);
  });
  return () => {
    offRequest();
    offCancel();
    for (const c of inflight.values()) c.abort();
  };
}
