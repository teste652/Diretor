import { homedir } from 'node:os';
import { join } from 'node:path';

/** Arquivo com porta e token da ponte local. O editor grava; o servidor MCP lê. */
export function bridgeFilePath(): string {
  if (process.env.DIRETOR_BRIDGE_FILE) return process.env.DIRETOR_BRIDGE_FILE;
  const home = homedir();
  // Local (não "Roaming"): porta e token desta máquina não devem ir para perfis sincronizados na rede.
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Diretor', 'bridge.json');
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Diretor', 'bridge.json');
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'Diretor', 'bridge.json');
}
