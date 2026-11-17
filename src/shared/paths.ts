import { homedir } from 'node:os';
import { join } from 'node:path';

/** Arquivo com porta e token da ponte local. O editor grava; o servidor MCP lê. */
export function bridgeFilePath(): string {
  if (process.env.DIRETOR_BRIDGE_FILE) return process.env.DIRETOR_BRIDGE_FILE;
  const home = homedir();
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Diretor', 'bridge.json');
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Diretor', 'bridge.json');
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'Diretor', 'bridge.json');
}
