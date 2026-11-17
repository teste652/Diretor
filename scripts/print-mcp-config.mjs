// Mostra o trecho para colar no claude_desktop_config.json.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const server = resolve('dist/mcp/server.cjs');
if (!existsSync(server)) console.warn('Aviso: rode "npm run build" antes; dist/mcp/server.cjs ainda não existe.\n');
const electron = resolve('node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const withNode = { mcpServers: { diretor: { command: 'node', args: [server] } } };
const withElectron = { mcpServers: { diretor: { command: electron, args: [server], env: { ELECTRON_RUN_AS_NODE: '1' } } } };
console.log('Opção A (Node.js 18+ instalado):\n' + JSON.stringify(withNode, null, 2));
console.log('\nOpção B (sem Node, usando o Electron do projeto):\n' + JSON.stringify(withElectron, null, 2));
