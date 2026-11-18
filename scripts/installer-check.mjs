// Testes do instalador do Windows (CI), depois do roteiro de ponta a ponta no app instalado.
//   node scripts/installer-check.mjs atualizar
//     Instala de novo por cima com o servidor do Claude aberto, como fica quando o Claude
//     Desktop está aberto: o instalador tem de fechar o servidor e trocar os arquivos.
//   node scripts/installer-check.mjs desinstalar
//     Desinstala e confere que o Diretor saiu da configuração do Claude Desktop, e só ele.
// Usa DIRETOR_APP (o Diretor.exe instalado) e release/Diretor-Setup.exe.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const mode = process.argv[2];
const app = process.env.DIRETOR_APP ? resolve(process.env.DIRETOR_APP) : null;
if (process.platform !== 'win32' || !app || !existsSync(app) || !['atualizar', 'desinstalar'].includes(mode)) {
  console.error('Uso, no Windows: DIRETOR_APP=<Diretor.exe instalado> node scripts/installer-check.mjs atualizar|desinstalar');
  process.exit(2);
}
const installDir = dirname(app);
const server = join(installDir, 'resources', 'app.asar.unpacked', 'dist', 'mcp', 'server.cjs');
const CONFIG = 'claude_desktop_config.json';
const results = [];
const check = (name, ok, extra = '') => {
  results.push(!!ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (mode === 'atualizar') {
  // O servidor aberto como o Claude Desktop abre: o próprio Diretor.exe rodando como Node, com a entrada ligada.
  const srv = spawn(app, [server], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DIRETOR_BRIDGE_FILE: join(process.env.RUNNER_TEMP ?? installDir, 'ponte-ci.json') },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  let exited = false;
  srv.on('exit', () => (exited = true));
  srv.stdin.on('error', () => undefined); // o instalador fecha o servidor com a entrada ainda aberta
  const replied = await new Promise((done) => {
    let buf = '';
    const t = setTimeout(() => done(false), 30_000);
    srv.stdout.on('data', (d) => {
      buf += d;
      if (/"id":1[,}]/.test(buf)) {
        clearTimeout(t);
        done(true);
      }
    });
    const hello = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ci', version: '1' } } };
    srv.stdin.write(JSON.stringify(hello) + '\n');
  });
  check('servidor do Claude aberto pelo Diretor.exe instalado, respondendo', replied && !exited);

  // Uma marca na pasta instalada: se a versão nova entrar no lugar da antiga, ela some.
  const mark = join(installDir, 'resources', 'marca-do-ci.txt');
  writeFileSync(mark, 'some quando a versão nova é instalada');
  const r = spawnSync(resolve('release', 'Diretor-Setup.exe'), ['/S'], { stdio: 'inherit', timeout: 300_000 });
  check('instalar por cima com o servidor do Claude aberto termina sem erro', r.status === 0, `código ${r.status}${r.error ? `, ${r.error.message}` : ''}`);
  for (let i = 0; i < 20 && !exited; i++) await wait(250);
  check('o instalador fechou o servidor do Claude', exited);
  check('a versão nova ficou no lugar da antiga', existsSync(app) && existsSync(server) && !existsSync(mark));
  if (!exited) srv.kill();
} else {
  // Uma configuração do Claude Desktop no perfil de verdade (esta máquina é do CI, sem Claude):
  // a da instalação clássica com o Diretor desta instalação, outro servidor e preferências,
  // e a do Claude Desktop 4 com um Diretor de outra instalação, que tem de ficar.
  const classic = join(process.env.APPDATA, 'Claude');
  const moved = join(process.env.LOCALAPPDATA, 'Claude-Data', 'claude_pzs8sxrjxfjjc');
  for (const d of [classic, moved]) {
    if (existsSync(join(d, CONFIG))) {
      console.error(`✗ Já existe uma configuração do Claude Desktop em ${d}. Este teste só roda numa máquina sem ele (CI).`);
      process.exit(2);
    }
  }
  if (/\s/.test(installDir)) {
    console.error(`✗ A pasta instalada tem espaço (${installDir}); o parâmetro _?= do desinstalador não aceita aspas.`);
    process.exit(2);
  }
  const mine = { command: app, args: [server], env: { ELECTRON_RUN_AS_NODE: '1' } };
  mkdirSync(classic, { recursive: true });
  writeFileSync(
    join(classic, CONFIG),
    JSON.stringify({ preferences: { ci: true }, mcpServers: { outro: { command: 'outro.exe', args: [] }, diretor: mine } }, null, 2).replace(/\n/g, '\r\n'),
  );
  const other = JSON.stringify({ mcpServers: { diretor: { command: 'node', args: ['C:\\dev\\diretor\\dist\\mcp\\server.cjs'] } } });
  mkdirSync(moved, { recursive: true });
  writeFileSync(join(moved, CONFIG), other);

  // _?= faz o desinstalador rodar daqui e esperar até o fim (sem ele, ele se copia e volta na hora).
  const r = spawnSync(join(installDir, 'Uninstall Diretor.exe'), ['/S', `_?=${installDir}`], { stdio: 'inherit', timeout: 300_000 });
  check('desinstalar sem perguntas', r.status === 0, `código ${r.status}${r.error ? `, ${r.error.message}` : ''}`);
  check('os arquivos do Diretor saíram', !existsSync(app) && !existsSync(server));
  const after = JSON.parse(readFileSync(join(classic, CONFIG), 'utf8'));
  check(
    'o Diretor saiu da configuração do Claude Desktop, e o resto ficou',
    after.mcpServers?.diretor === undefined && after.mcpServers?.outro?.command === 'outro.exe' && after.preferences?.ci === true,
    JSON.stringify(after),
  );
  check('o Diretor de outra instalação continua na configuração', readFileSync(join(moved, CONFIG), 'utf8') === other);
  rmSync(classic, { recursive: true, force: true });
  rmSync(join(process.env.LOCALAPPDATA, 'Claude-Data'), { recursive: true, force: true });
}

const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\n${failed} de ${results.length} verificações falharam` : `\n${results.length} de ${results.length} verificações passaram`);
process.exit(failed ? 1 : 0);
