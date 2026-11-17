import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', sourcemap: true, logLevel: 'info' };

await Promise.all([
  build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.cjs', external: ['electron', 'ffmpeg-static'] }),
  build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.cjs', external: ['electron'] }),
  // O servidor MCP é autocontido: o Claude Desktop o executa com Node (ou com o próprio Electron).
  build({ ...common, entryPoints: ['src/mcp/server.ts'], outfile: 'dist/mcp/server.cjs' }),
]);
