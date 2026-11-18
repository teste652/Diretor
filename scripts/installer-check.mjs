// Testes do instalador do Windows (CI), depois do roteiro de ponta a ponta no app instalado.
//   node scripts/installer-check.mjs atualizar
//     Instala de novo por cima com o servidor do Claude aberto, como fica quando o Claude
//     Desktop está aberto: o instalador tem de fechar o servidor e trocar os arquivos.
//   node scripts/installer-check.mjs desinstalar
//     Desinstala e confere que o Diretor saiu da configuração do Claude Desktop, e só ele.
// Usa DIRETOR_APP (o Diretor.exe instalado) e release/Diretor-Setup.exe.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// Outro programa chamado Diretor.exe, fora da pasta instalada (como uma cópia de desenvolvimento):
// o instalador e o desinstalador só podem fechar o que roda da pasta deles. É o ping do Windows
// com outro nome, esperando alguns minutos.
function startBystander() {
  const dir = join(process.env.RUNNER_TEMP ?? tmpdir(), 'outro-diretor');
  mkdirSync(dir, { recursive: true });
  const exe = join(dir, 'Diretor.exe');
  copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'PING.EXE'), exe);
  const proc = spawn(exe, ['-n', '600', '127.0.0.1'], { stdio: 'ignore' });
  const state = { exited: false, proc };
  proc.on('exit', () => (state.exited = true));
  return state;
}
const bystanderName = 'um Diretor.exe de outra pasta continua aberto (só fecha o que roda da pasta instalada)';

// Quando o outro Diretor.exe foi fechado, o instalador não usou o PowerShell (fechou pelo nome do
// programa). Mostra o que o PowerShell de 32 bits, o que o instalador usa, responde aqui.
function powershellReport() {
  const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const tests = {
    'Get-CimInstance existe': 'if (Get-Command Get-CimInstance -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }',
    'política de execução': "if ((Get-ExecutionPolicy -Scope Process) -eq 'Restricted') { exit 1 } else { exit 0 }",
  };
  const withoutModules = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'psmodulepath'));
  console.log(`  PSModulePath: ${process.env.PSModulePath ?? '(nenhum)'}`);
  for (const [label, env] of [['com o ambiente deste passo', process.env], ['sem PSModulePath', withoutModules]]) {
    for (const [name, cmd] of Object.entries(tests)) {
      const r = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', cmd], { env, encoding: 'utf8', timeout: 60_000 });
      console.log(`  ${name}, ${label}: código ${r.status}${r.error ? `, ${r.error.message}` : ''}${r.stderr?.trim() ? `\n${r.stderr.trim()}` : ''}`);
    }
  }
}

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
  const bystander = startBystander();
  await wait(500);
  const r = spawnSync(resolve('release', 'Diretor-Setup.exe'), ['/S'], { stdio: 'inherit', timeout: 300_000 });
  check('instalar por cima com o servidor do Claude aberto termina sem erro', r.status === 0, `código ${r.status}${r.error ? `, ${r.error.message}` : ''}`);
  for (let i = 0; i < 20 && !exited; i++) await wait(250);
  check('o instalador fechou o servidor do Claude', exited);
  check('a versão nova ficou no lugar da antiga', existsSync(app) && existsSync(server) && !existsSync(mark));
  check(bystanderName, !bystander.exited);
  if (bystander.exited) powershellReport();
  if (!exited) srv.kill();
  bystander.proc.kill();
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
  const bystander = startBystander();
  await wait(500);
  const r = spawnSync(join(installDir, 'Uninstall Diretor.exe'), ['/S', `_?=${installDir}`], { stdio: 'inherit', timeout: 300_000 });
  check('desinstalar sem perguntas', r.status === 0, `código ${r.status}${r.error ? `, ${r.error.message}` : ''}`);
  check(bystanderName, !bystander.exited);
  if (bystander.exited) powershellReport();
  bystander.proc.kill();
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
