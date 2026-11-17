import { byteSize, handleBridge } from '../core/api';
import { session } from './store';

export const bridgeStats = { lastCallAt: 0, lastBytesOut: 0, totalBytesOut: 0, calls: 0 };

const LABEL: Record<string, string> = {
  status: 'Claude conferiu o editor',
  get_context: 'Claude leu o contexto',
  propose_edit: 'Claude enviou uma proposta',
  get_proposal: 'Claude consultou a proposta',
  cancel_proposal: 'Claude cancelou a proposta',
};

/** Atende as chamadas do servidor MCP usando a mesma sessão da interface. */
export function connectBridge(): () => void {
  const api = window.diretor;
  if (!api) return () => undefined;
  return api.onBridgeRequest(async ({ id, method, params }) => {
    let result: unknown;
    try {
      result = await handleBridge(session, method, params);
    } catch (e) {
      result = { error: 'internal', message: e instanceof Error ? e.message : String(e) };
    }
    const out = byteSize(result);
    bridgeStats.lastCallAt = Date.now();
    bridgeStats.lastBytesOut = out;
    bridgeStats.totalBytesOut += out;
    bridgeStats.calls++;
    session.log('tool', LABEL[method] ?? method, { bytesOut: out, bytesIn: byteSize(params) });
    api.bridgeRespond(id, result);
  });
}
